// START_MODULE_CONTRACT
//   PURPOSE: Review surface
//   SCOPE: Process audits, pattern detectors, and review.* findings
//   DEPENDS: none
//   LINKS: M-REVIEW
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   HunkCoverageInput
//   JoinProbe
//   REVIEW_CATALOG
//   RegexOverStructureScan
//   ReviewFinding
//   ReviewOptions
//   ReviewResult
//   ScopeAuditReport
//   TestFileDiff
//   allReviewCodes
//   AttemptPairEvidenceInput
//   auditAttemptPairWriteEvidence
//   auditCompatNewErrors
//   auditHunkCoverage
//   auditScopeOutsideWriteScope
//   auditTestWeakening
//   expandScopePathsForArchiveIdentity
//   findingId
//   formatReviewResult
//   isReviewIssueCode
//   listRuntimeSourceFilesForMarkerScan
//   resolveChangePlanPath
//   runJoinProbes
//   runPatternDetectors
//   runPatternDetectorsWithMeta
//   runReview
//   ScopeAuditIdentity
// END_MODULE_MAP
/**
 * Review surface (D4, D14, §6.4, A35/A36): pattern detectors, process audits,
 * join engine, and deterministic finding IDs.
 *
 * Does not write Verdicts, Decisions, or status (F1). Recording stays on ngrace gate verdict.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import { resolveNgracePaths } from "../artifact/project";
import {
  isRegisteredSemanticAnchor,
  VERIFICATION_THREADED_CHILD_TAGS,
} from "../artifact/types";
import { readGraceXmlArtifact, walkNodes } from "../artifact/xml";
import { extractObservedWriteScopeFromPlan } from "./scope-helpers";
import {
  listFilesChangedAgainstBase,
  listLedgerEvents,
  listLooseEvents,
  listRepositoryChangedFiles,
  readAttemptPayload,
  resolveChangeBundle,
  type AbsenceValue,
  type LooseEvent,
  type WriteEvidenceSnapshot,
} from "../grace-cursor";
import { CODE_EXTENSIONS } from "../language-registry";
import {
  getModuleImplementationFiles,
  isLikelyTestPath,
  loadGraceArtifactIndex,
} from "../query/core";
import {
  REVIEW_CATALOG,
  guideFor,
  type ReviewIssueGuide,
} from "./catalog";
import {
  SHAPE_DATA_MARKER,
  patternSourceLooksLikeMarkupGuard,
} from "./shape-data";

export type ReviewFinding = {
  severity: "error" | "warning";
  code: string;
  file: string;
  message: string;
  title?: string;
  explanation?: string;
  remediation?: string[];
  /** Deterministic id — stable across reruns and unrelated blank-line edits. */
  findingId: string;
  ruleId: string;
  /** Content-stable anchor (never line number alone). */
  anchorOrHunkKey: string;
};

/**
 * Scope-audit outcome for a named --change (A66.4 five states).
 * Always present when changeId was requested; absent when process audits are off
 * or no changeId was given.
 */
export type ScopeAuditReport = {
  status: "ran" | "not-run" | "unable-to-determine";
  reason: string;
  changeId: string;
  /** Where plan.xml was read, when resolved. */
  planLocation?: "active" | "archive";
  /** How the changed-file set was obtained when the audit ran. */
  inputSource?: "explicit" | "base" | "porcelain";
  baseRef?: string;
  changedFileCount?: number;
  /** True when status=ran over a caller-supplied empty --changed-files set (state 5). */
  callerSuppliedEmpty?: boolean;
  absence?: AbsenceValue;
};

export type ReviewResult = {
  schemaVersion: "1.0.0";
  tool: "ngrace-review";
  root: string;
  findings: ReviewFinding[];
  /**
   * Paths skipped because they hold detector shapes as data (A38.2 / corr 90).
   * Always reported — silent exemptions are anti-pattern 8.
   */
  shapeDataExemptions: string[];
  /** Present when --change was set and process audits ran. */
  scopeAudit?: ScopeAuditReport;
  summary: {
    findings: number;
    errors: number;
    warnings: number;
    /** Count of shape-data exemptions (same as shapeDataExemptions.length). */
    shapeDataExemptions: number;
  };
};

export type HunkCoverageInput = {
  hunkKey: string;
  file: string;
  covered: boolean;
};

export type TestFileDiff = {
  file: string;
  before: string;
  after: string;
};

/**
 * Join-engine probe for A34.1 fixtures. Process-shaped by default (A36.2):
 * emits family-B codes unless the caller asserts a corpus pattern instance.
 */
export type JoinProbe =
  | {
      kind: "scope-home";
      recordScope: "task" | "epoch" | "bundle" | "project";
      homeAdmits: Array<"task" | "epoch" | "bundle" | "project">;
      file: string;
    }
  | {
      kind: "writer-command";
      exportedWriters: string[];
      invocableCommands: string[];
      file: string;
    }
  | {
      kind: "lint-vs-reader";
      lintRejects: boolean;
      readerTreatsAsBenign: boolean;
      file: string;
      condition: string;
    }
  | {
      kind: "diagnostic-vs-preexisting";
      diagnosticCode: string;
      preexistingCanNeverClear: boolean;
      file: string;
    };

export type ReviewOptions = {
  changeId?: string;
  /**
   * Explicit changed paths for process audits. When **defined** (including `[]`),
   * the set is caller-owned: no porcelain fallback (A66 Q5 / corr 169).
   */
  changedFiles?: string[];
  /**
   * Git base ref for a three-dot (`base...HEAD`) name-only diff (A66.3).
   * Ignored when `changedFiles` is defined.
   */
  baseRef?: string;
  testFileDiffs?: TestFileDiff[];
  lintCodesBefore?: string[];
  lintCodesAfter?: string[];
  hunkCoverage?: HunkCoverageInput[];
  joinProbes?: JoinProbe[];
  /** Disable pattern detectors (tests of process audits alone). */
  patterns?: boolean;
  processAudits?: boolean;
  joinEngine?: boolean;
};

/** Resolve plan.xml under active/ first, then archive/ (read-only; corr 139). */
export function resolveChangePlanPath(
  projectRoot: string,
  changeId: string,
): { planPath: string; location: "active" | "archive" } | undefined {
  const paths = resolveNgracePaths(path.resolve(projectRoot));
  const active = path.join(paths.changesActiveDir, changeId, "plan.xml");
  if (existsSync(active)) return { planPath: active, location: "active" };
  const archived = path.join(paths.changesArchiveDir, changeId, "plan.xml");
  if (existsSync(archived)) return { planPath: archived, location: "archive" };
  return undefined;
}

// ---------------------------------------------------------------------------
// Finding IDs (step 6.5.2)
// ---------------------------------------------------------------------------

/**
 * Deterministic finding id. Never uses line numbers alone, timestamps,
 * iteration order, or narration.
 */
export function findingId(parts: {
  auditOrPatternId: string;
  file: string;
  anchorOrHunkKey: string;
  ruleId: string;
}): string {
  const payload = [
    parts.auditOrPatternId,
    normalizeRel(parts.file),
    parts.anchorOrHunkKey,
    parts.ruleId,
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function normalizeRel(file: string): string {
  return file.replaceAll("\\", "/");
}

function makeFinding(
  code: keyof typeof REVIEW_CATALOG | string,
  file: string,
  message: string,
  ruleId: string,
  anchorOrHunkKey: string,
): ReviewFinding {
  const guide: ReviewIssueGuide | undefined = guideFor(code);
  const auditOrPatternId = guide?.proposedBy ?? code;
  return {
    severity: guide?.severity ?? "error",
    code,
    file: normalizeRel(file),
    message,
    title: guide?.title,
    explanation: guide?.explanation,
    remediation: guide?.remediation,
    ruleId,
    anchorOrHunkKey,
    findingId: findingId({
      auditOrPatternId,
      file: normalizeRel(file),
      anchorOrHunkKey,
      ruleId,
    }),
  };
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

function listFilesRecursive(root: string, relDir = ""): string[] {
  const abs = path.join(root, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const full = path.join(root, rel);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(root, rel));
    } else if (entry.isFile()) {
      out.push(rel.replaceAll("\\", "/"));
    }
  }
  return out;
}

function readText(root: string, rel: string): string | undefined {
  const full = path.join(root, rel);
  if (!existsSync(full) || !statSync(full).isFile()) return undefined;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Family A — pattern detectors
// ---------------------------------------------------------------------------

/**
 * Runtime sources that may emit verification markers (corr 205-A).
 *
 * Preferred source of truth: graph-linked implementation files via
 * `getModuleImplementationFiles` (same set health uses). Rejected alternative:
 * only TypeScript under a top-level `src/` directory — polyglot monorepos put
 * Go/Rust elsewhere and non-TS markers were false-positive confidently-wrong.
 *
 * Fallback when the index cannot load or no linked files exist: every path under
 * the project root whose extension is in `CODE_EXTENSIONS`, excluding tests and
 * `.ngrace/` / `node_modules` / `.git`.
 */
export function listRuntimeSourceFilesForMarkerScan(root: string): string[] {
  const linked = tryLinkedImplementationPaths(root);
  if (linked.length > 0) {
    return linked;
  }
  return listCodeExtensionRuntimeSources(root);
}

function tryLinkedImplementationPaths(root: string): string[] {
  try {
    const index = loadGraceArtifactIndex(root);
    const paths = new Set<string>();
    for (const moduleRecord of index.modules.values()) {
      for (const file of getModuleImplementationFiles(moduleRecord)) {
        paths.add(file.path.replaceAll("\\", "/"));
      }
    }
    return [...paths].sort();
  } catch {
    return [];
  }
}

function listCodeExtensionRuntimeSources(root: string): string[] {
  return listFilesRecursive(root).filter((rel) => {
    if (
      rel.startsWith(`${ARTIFACT_DIR}/`)
      || rel.startsWith("node_modules/")
      || rel.startsWith(".git/")
    ) {
      return false;
    }
    if (isLikelyTestPath(rel)) return false;
    const ext = path.extname(rel).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  }).sort();
}

function detectConfidentlyWrong(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const sourceFiles = listRuntimeSourceFilesForMarkerScan(root);
  const sourceBlob = sourceFiles.map((f) => readText(root, f) ?? "").join("\n");

  // Markers claimed in verification but never emitted in runtime sources (XML walk, not regex).
  for (const verificationRel of listFilesRecursive(root, `${ARTIFACT_DIR}/verification`).filter(
    (f) => f.endsWith(".xml"),
  )) {
    const abs = path.join(root, verificationRel);
    if (!existsSync(abs)) continue;
    const artifact = readGraceXmlArtifact(abs);
    if (!artifact.root) continue;
    for (const node of walkNodes(artifact.root)) {
      if (node.tag !== "Marker") continue;
      const marker = node.text.trim();
      if (!marker) continue;
      if (!sourceBlob.includes(marker)) {
        findings.push(
          makeFinding(
            "review.confidently-wrong",
            verificationRel,
            `Verification requires marker ${marker} that no runtime source emits.`,
            "marker-not-emitted",
            `marker:${marker}`,
          ),
        );
      }
    }
  }

  // MustExist targets that do not exist on disk (corr 205-B).
  // Semantic anchors (ANCHOR_PATTERNS) are not disk paths — never check them as files.
  for (const planRel of listFilesRecursive(root, `${ARTIFACT_DIR}/changes`).filter((f) =>
    f.endsWith("plan.xml"),
  )) {
    const abs = path.join(root, planRel);
    const artifact = readGraceXmlArtifact(abs);
    if (!artifact.root) continue;
    for (const node of walkNodes(artifact.root)) {
      if (node.tag !== "MustExist") continue;
      const valueNode = node.children.find((c) => c.tag === "Value");
      const target = (valueNode?.text ?? node.text).trim();
      if (!target || isRegisteredSemanticAnchor(target)) {
        continue;
      }
      if (!existsSync(path.join(root, target))) {
        findings.push(
          makeFinding(
            "review.confidently-wrong",
            planRel,
            `MustExist claims ${target} which is not present on disk.`,
            "must-exist-missing",
            `must-exist:${target}`,
          ),
        );
      }
    }
  }

  return findings;
}

function detectSelfReferential(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const rel of listFilesRecursive(root, "src").filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.js"))) {
    // Review-surface unit tests hold defect shapes as fixtures (held-out controls); not production tests.
    if (rel.startsWith("src/review/")) continue;
    const text = readText(root, rel);
    if (!text) continue;
    // expect(x).toBe(x) / expect(src).toEqual(src)
    if (/\bexpect\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/.test(text)) {
      findings.push(
        makeFinding(
          "review.self-referential-comparison",
          rel,
          "Test asserts a value equals itself (both sides share one origin).",
          "expect-same-identifier",
          "expect-self",
        ),
      );
    }
    // readFileSync of sibling source then compare to itself
    if (
      /readFileSync\s*\(/.test(text)
      && /\bexpect\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*\1\s*\)/.test(text)
    ) {
      // already covered above; keep one finding
    }
  }

  for (const planRel of listFilesRecursive(root, `${ARTIFACT_DIR}/changes`).filter((f) =>
    f.endsWith("plan.xml"),
  )) {
    const abs = path.join(root, planRel);
    const artifact = readGraceXmlArtifact(abs);
    if (!artifact.root) continue;
    const posixPlan = planRel.replaceAll("\\", "/");
    for (const node of walkNodes(artifact.root)) {
      if (node.tag !== "MustMatchPattern") continue;
      const fileNode = node.children.find((c) => c.tag === "File");
      const file = (fileNode?.text ?? "").trim().replaceAll("\\", "/");
      if (!file) continue;
      if (file === posixPlan || file.endsWith(posixPlan) || posixPlan.endsWith(file)) {
        findings.push(
          makeFinding(
            "review.self-referential-comparison",
            planRel,
            "Baseline MustMatchPattern targets the plan itself as oracle.",
            "plan-matches-self",
            `must-match:${file}`,
          ),
        );
      }
    }
  }

  return findings;
}

/**
 * Extract pattern *sources* from regex literals and `new RegExp(...)` so we can
 * judge whether the pattern carries markup/attribute syntax (A37.1 shape, not fixture literals).
 */
function extractRegexPatternSources(source: string): string[] {
  const out: string[] = [];
  // new RegExp("..." | '...' | `...`) — first argument only
  for (const m of source.matchAll(
    /new\s+RegExp\s*\(\s*(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
  )) {
    const raw = m[1]!;
    out.push(raw.slice(1, -1));
  }
  // Regex literals immediately consumed as guards: /.../.test( / .exec( / .match(
  for (const m of source.matchAll(
    /\/((?:\\.|[^/\n\\])+)\/[gimsuy]*(?=\s*\.\s*(?:test|exec|match)\s*\()/g,
  )) {
    out.push(m[1]!);
  }
  // Assignment forms: const re = /.../
  for (const m of source.matchAll(
    /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\/((?:\\.|[^/\n\\])+)\/[gimsuy]*/g,
  )) {
    out.push(m[1]!);
  }
  return [...new Set(out)];
}

function fileHoldsShapesAsData(rel: string, text: string): boolean {
  // Corpus stores defect text as fixtures (not a production guard).
  if (rel.includes("defect-corpus")) return true;
  // Explicit opt-in for shape-as-data modules (A37.3 / corr 88) — not a directory prefix.
  if (text.includes(SHAPE_DATA_MARKER)) return true;
  return false;
}

function usesRegexAsGuard(text: string): boolean {
  return /\.test\s*\(|\.exec\s*\(|\.match\s*\(/.test(text);
}

/**
 * Identifiers bound to a call result: `const X = f(...)` or `const X = a.b(...)`.
 * A marker line-scan over such an identifier is a transformed-value scan (A38.1 / corr 89).
 * The helper's *name* is irrelevant — only the dataflow matters.
 */
function identifiersAssignedFromCall(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*\s*\(/g,
  )) {
    ids.add(m[1]!);
  }
  return ids;
}

/**
 * Bare-identifier subjects of *line-oriented* `.split("\n")` chained to an array
 * callback: `source.split("\n").some(...)`.
 *
 * Does not match call-expression subjects (`normalize(source).split(...)`) — those
 * end in `)` before `.split` (A39.1 / corr 92).
 * Non-newline splits (e.g. `body.split(/\s+/)`) are not line scans.
 */
function lineScanBareIdentifierSubjects(text: string): string[] {
  const subjects: string[] = [];
  // Chained: ID.split("\n").(some|every|filter|find) — "\n" as two source chars \ + n
  // Identifier must be immediately before `.split` (not `source).split` from a call arg).
  for (const m of text.matchAll(
    /\b([A-Za-z_$][\w$]*)\s*\.\s*split\s*\(\s*(?:"\\n"|'\\n'|`\\n`)\s*\)\s*\.\s*(?:some|every|filter|find)\s*\(/g,
  )) {
    subjects.push(m[1]!);
  }
  return subjects;
}

/**
 * True when a *call expression* is the subject of a newline split chained to a
 * callback: `normalize(source).split("\n").some(...)` (A39.1 / corr 92).
 * Same dataflow as binding the call result to a name, without requiring the name.
 */
function hasCallExpressionLineScanSubject(text: string): boolean {
  return /\)\s*\.\s*split\s*\(\s*(?:"\\n"|'\\n'|`\\n`)\s*\)\s*\.\s*(?:some|every|filter|find)\s*\(/.test(
    text,
  );
}

/**
 * Defective comment-marker line guard: line-anchored START_MODULE_* regex used as a
 * governance check on *raw* input (corpus re-03 family).
 *
 * Discriminator is dataflow (A38.1 / corr 89), not a production symbol name:
 * re-03 scans the function's raw parameter (`source.split…`); the correct scanner
 * scans a value derived by a transform (`const searchable = f(text)` then split).
 * Marker token must appear *inside a pattern source*, not merely in prose.
 */
/**
 * Comment-prefix tokens in a regex *pattern source*. Literals write `//` as `\/\/`,
 * so a raw `/\/\//` check on the source string misses pure-// scanners (A38 probe / 91).
 */
function patternSourceHasCommentPrefix(patternSource: string): boolean {
  // Decode one level of common regex escapes so `\/\/` becomes `//`.
  const decoded = patternSource.replace(/\\([\\/"'ntr])/g, (_m, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    return ch;
  });
  return /\/\/|#|--/.test(decoded);
}

function isDefectiveUnstrippedMarkerLineGuard(text: string): boolean {
  const patterns = extractRegexPatternSources(text);
  const markerInPattern = patterns.some((p) =>
    /START_MODULE_CONTRACT|START_MODULE_MAP|START_BLOCK_/.test(p),
  );
  const lineAnchoredMarker = patterns.some(
    (p) =>
      p.startsWith("^")
      && /START_MODULE_CONTRACT|START_MODULE_MAP|START_BLOCK_/.test(p)
      && patternSourceHasCommentPrefix(p),
  );
  if (!markerInPattern || !lineAnchoredMarker) return false;
  if (!usesRegexAsGuard(text)) return false;

  const transformed = identifiersAssignedFromCall(text);
  const bareSubjects = lineScanBareIdentifierSubjects(text);
  const inlineCallSubject = hasCallExpressionLineScanSubject(text);

  // Chained scans: fire only when a bare identifier subject is not call-derived.
  // Call-expression subjects (inline transform) are call-derived without a binding (92).
  if (bareSubjects.length > 0 || inlineCallSubject) {
    const rawBare = bareSubjects.filter((s) => !transformed.has(s));
    return rawBare.length > 0;
  }

  // No chained split-callback: still silent when a call-derived intermediate is
  // newline-split (for-loop / indexed / two-step scan over the transformed value).
  for (const id of transformed) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      new RegExp(
        String.raw`\b${escaped}\s*\.\s*split\s*\(\s*(?:"\\n"|'\\n'|` + "`\\n`" + String.raw`)\s*\)`,
      ).test(text)
    ) {
      return false;
    }
  }
  // Marker line-regex used as a guard with no transformed line-scan subject.
  // Covers two-step raw form: `const lines = source.split("\n"); lines.some(...)` (d).
  return true;
}

export type RegexOverStructureScan = {
  findings: ReviewFinding[];
  shapeDataExemptions: string[];
};

function detectRegexOverStructure(root: string): RegexOverStructureScan {
  const findings: ReviewFinding[] = [];
  const shapeDataExemptions: string[] = [];
  for (const rel of listFilesRecursive(root, "src").filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".test.ts"),
  )) {
    const text = readText(root, rel);
    if (!text) continue;
    // Corr 88 / 90: exempt only shape-as-data files; report every exemption.
    if (fileHoldsShapesAsData(rel, text)) {
      shapeDataExemptions.push(normalizeRel(rel));
      continue;
    }
    if (!usesRegexAsGuard(text)) continue;

    const patterns = extractRegexPatternSources(text);
    const markupPattern = patterns.find((p) => patternSourceLooksLikeMarkupGuard(p));
    if (markupPattern) {
      findings.push(
        makeFinding(
          "review.regex-over-structure",
          rel,
          "File uses a regular expression as a structural guard over text that has structure.",
          "markup-or-attribute-regex-guard",
          `pattern:${markupPattern.slice(0, 48)}`,
        ),
      );
      continue;
    }

    if (isDefectiveUnstrippedMarkerLineGuard(text)) {
      findings.push(
        makeFinding(
          "review.regex-over-structure",
          rel,
          "Line-oriented marker regex over source without stripping structured regions first.",
          "unstripped-marker-line-guard",
          "marker-line-unstripped",
        ),
      );
    }
  }
  shapeDataExemptions.sort((a, b) => a.localeCompare(b));
  return { findings, shapeDataExemptions };
}

function detectZeroOrMoreSwallow(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const planRel of listFilesRecursive(root, `${ARTIFACT_DIR}/changes`).filter((f) =>
    f.endsWith("plan.xml"),
  )) {
    const abs = path.join(root, planRel);
    const artifact = readGraceXmlArtifact(abs);
    if (!artifact.root) continue;
    for (const node of walkNodes(artifact.root)) {
      if (!/^T-\d+$/.test(node.tag)) continue;
      const title = node.children.find((c) => c.tag === "Title")?.text.trim() ?? "";
      const depends = node.children.find((c) => c.tag === "DependsOn");
      const emptyDepends =
        depends !== undefined
        && depends.children.length === 0
        && !depends.text.trim();
      if (!emptyDepends) continue;
      if (/\bafter\b|\bsecond\b|\bthen\b|\bfollow|\bcompletes?\b|\bonce\b.*\bT-\d+/i.test(title)) {
        findings.push(
          makeFinding(
            "review.zero-or-more-swallow",
            planRel,
            `${node.tag} title claims sequencing ("${title}") but DependsOn is empty.`,
            "empty-depends-with-sequence-title",
            `task:${node.tag}:empty-depends`,
          ),
        );
      }
    }
  }
  return findings;
}

function detectUnthreadedConstruct(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const verificationRel of listFilesRecursive(root, `${ARTIFACT_DIR}/verification`).filter(
    (f) => f.endsWith(".xml"),
  )) {
    const abs = path.join(root, verificationRel);
    const artifact = readGraceXmlArtifact(abs);
    if (!artifact.root) continue;
    for (const node of walkNodes(artifact.root)) {
      if (!/^V-M-/.test(node.tag)) continue;
      for (const child of node.children) {
        // corr 205-C: set shared with projections evidence + structure tags
        if (VERIFICATION_THREADED_CHILD_TAGS.has(child.tag)) continue;
        findings.push(
          makeFinding(
            "review.unthreaded-construct",
            verificationRel,
            `Verification child <${child.tag}> under ${node.tag} is not threaded through health or assertion evaluation.`,
            "unknown-verification-child",
            `vm-child:${node.tag}:${child.tag}`,
          ),
        );
      }
    }
  }
  return findings;
}

export function runPatternDetectors(root: string): ReviewFinding[] {
  return runPatternDetectorsWithMeta(root).findings;
}

/** Pattern detectors plus shape-data exemption paths (A38.2). */
export function runPatternDetectorsWithMeta(root: string): {
  findings: ReviewFinding[];
  shapeDataExemptions: string[];
} {
  const regexScan = detectRegexOverStructure(root);
  return {
    findings: [
      ...detectConfidentlyWrong(root),
      ...detectSelfReferential(root),
      ...regexScan.findings,
      ...detectZeroOrMoreSwallow(root),
      ...detectUnthreadedConstruct(root),
    ],
    shapeDataExemptions: regexScan.shapeDataExemptions,
  };
}

// ---------------------------------------------------------------------------
// Family C — join engine (A34.1 pairs as process-shaped codes per A36.2)
// ---------------------------------------------------------------------------

export function runJoinProbes(probes: JoinProbe[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const probe of probes) {
    if (probe.kind === "scope-home") {
      if (!probe.homeAdmits.includes(probe.recordScope)) {
        findings.push(
          makeFinding(
            "review.counterpart-scope-mismatch",
            probe.file,
            `Record scope "${probe.recordScope}" is not admitted by home constraints [${probe.homeAdmits.join(", ")}].`,
            "join-scope-home",
            `scope:${probe.recordScope}`,
          ),
        );
      }
    } else if (probe.kind === "writer-command") {
      for (const writer of probe.exportedWriters) {
        if (!probe.invocableCommands.includes(writer)) {
          findings.push(
            makeFinding(
              "review.counterpart-writer-missing",
              probe.file,
              `Exported writer "${writer}" has no invocable command surface.`,
              "join-writer-command",
              `writer:${writer}`,
            ),
          );
        }
      }
    } else if (probe.kind === "lint-vs-reader") {
      if (probe.lintRejects && probe.readerTreatsAsBenign) {
        findings.push(
          makeFinding(
            "review.counterpart-reader-tolerates",
            probe.file,
            `Lint rejects "${probe.condition}" but a blocking reader treats it as benign.`,
            "join-lint-reader",
            `cond:${probe.condition}`,
          ),
        );
      }
    } else if (probe.kind === "diagnostic-vs-preexisting") {
      if (probe.preexistingCanNeverClear) {
        findings.push(
          makeFinding(
            "review.counterpart-grandfather-gap",
            probe.file,
            `Diagnostic ${probe.diagnosticCode} fires permanently on artifacts that can never clear it.`,
            "join-grandfather",
            `diag:${probe.diagnosticCode}`,
          ),
        );
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Family B — process audits (§6.4)
// ---------------------------------------------------------------------------

export type ScopeAuditIdentity = {
  /** Reviewed change id (C-*). Required for archive identity (corr 171). */
  changeId: string;
  /** Where plan.xml was resolved. Archive enables active↔archive aliases for this id only. */
  planLocation: "active" | "archive";
};

/**
 * Corr 171: when the plan resolved from `archive/<id>/`, declared paths under
 * `active/<id>/…` name the same bundle artifacts now living under `archive/<id>/…`.
 * Expand only that id's prefixes — never a global `.ngrace/changes/` swap (other bundles
 * must still flag as out of scope).
 */
export function expandScopePathsForArchiveIdentity(
  paths: string[],
  identity: ScopeAuditIdentity | undefined,
): string[] {
  if (!identity || identity.planLocation !== "archive" || !identity.changeId) {
    return paths.map(normalizeRel);
  }
  const activePrefix = `.ngrace/changes/active/${identity.changeId}/`;
  const archivePrefix = `.ngrace/changes/archive/${identity.changeId}/`;
  const out = new Set<string>();
  for (const raw of paths) {
    const n = normalizeRel(raw);
    out.add(n);
    if (n.startsWith(activePrefix)) {
      out.add(archivePrefix + n.slice(activePrefix.length));
    } else if (n.startsWith(archivePrefix)) {
      out.add(activePrefix + n.slice(archivePrefix.length));
    }
  }
  return [...out].sort();
}

export function auditScopeOutsideWriteScope(
  changedFiles: string[],
  scopeFiles: string[],
  scopeGlobs: string[],
  identity?: ScopeAuditIdentity,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const expandedFiles = expandScopePathsForArchiveIdentity(scopeFiles, identity);
  const expandedGlobs = expandScopePathsForArchiveIdentity(scopeGlobs, identity);
  const fileSet = new Set(expandedFiles);
  for (const changed of changedFiles.map(normalizeRel)) {
    if (fileSet.has(changed)) continue;
    const globHit = expandedGlobs.some((glob) => matchSimpleGlob(glob, changed));
    if (globHit) continue;
    if (scopeFiles.length === 0 && scopeGlobs.length === 0) continue;
    findings.push(
      makeFinding(
        "review.scope-outside-write-scope",
        changed,
        `Changed file ${changed} is outside ObservedWriteScope.`,
        "scope-outside",
        `file:${changed}`,
      ),
    );
  }
  return findings;
}

/** Minimal glob: `**` / `*` only, for process-audit tests and plan globs. */
function matchSimpleGlob(glob: string, file: string): boolean {
  const g = glob.replaceAll("\\", "/");
  const f = file.replaceAll("\\", "/");
  if (g === f) return true;
  // **/*.ts style
  const escaped = g
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(f);
}

export function auditTestWeakening(diffs: TestFileDiff[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const diff of diffs) {
    const beforeAsserts = countAssertions(diff.before);
    const afterAsserts = countAssertions(diff.after);
    if (afterAsserts < beforeAsserts) {
      findings.push(
        makeFinding(
          "review.test-assertion-weakened",
          diff.file,
          `Test file lost assertions (${beforeAsserts} → ${afterAsserts}).`,
          "assert-count-drop",
          `asserts:${beforeAsserts}->${afterAsserts}`,
        ),
      );
    }
    // expect(...).toBe(true) replacing a specific value is a weakening signal when toBe(true) increased
    const beforeStrict = (diff.before.match(/\.toBe\s*\(\s*[^t]/g) ?? []).length;
    const afterStrict = (diff.after.match(/\.toBe\s*\(\s*[^t]/g) ?? []).length;
    const beforeLoose = (diff.before.match(/\.toBeTruthy\s*\(|\.toBe\s*\(\s*true\s*\)/g) ?? []).length;
    const afterLoose = (diff.after.match(/\.toBeTruthy\s*\(|\.toBe\s*\(\s*true\s*\)/g) ?? []).length;
    if (afterStrict < beforeStrict && afterLoose > beforeLoose) {
      findings.push(
        makeFinding(
          "review.test-assertion-weakened",
          diff.file,
          "Strict equality assertions were replaced with looser checks.",
          "strict-to-loose",
          "strict-to-loose",
        ),
      );
    }
  }
  return findings;
}

function countAssertions(source: string): number {
  return (source.match(/\bexpect\s*\(/g) ?? []).length
    + (source.match(/\bassert\s*\(/g) ?? []).length;
}

export function auditCompatNewErrors(
  codesBefore: string[],
  codesAfter: string[],
): ReviewFinding[] {
  const before = new Set(codesBefore);
  const findings: ReviewFinding[] = [];
  for (const code of codesAfter) {
    if (!before.has(code)) {
      findings.push(
        makeFinding(
          "review.compat-new-error",
          "*",
          `New issue code ${code} appeared on a previously clean comparison set.`,
          "compat-new",
          `code:${code}`,
        ),
      );
    }
  }
  return findings;
}

export function auditHunkCoverage(hunks: HunkCoverageInput[]): ReviewFinding[] {
  return hunks
    .filter((h) => !h.covered)
    .map((h) =>
      makeFinding(
        "review.hunk-uncovered",
        h.file,
        `Changed hunk ${h.hunkKey} has no covering test attribution.`,
        "hunk-uncovered",
        h.hunkKey,
      ),
    );
}

// ---------------------------------------------------------------------------
// Attempt-pair write evidence (P0.10 / F9.3 / C-CURSOR-INTEGRITY T-006)
// ---------------------------------------------------------------------------

/** One fail→pass pair with WriteEvidence content digests (path → digest). */
export type AttemptPairEvidenceInput = {
  changeId: string;
  /** Plan ObservedWriteScope file paths (normalized). Globs not expanded here — callers pass files. */
  scopeFiles: string[];
  pairs: Array<{
    task: string;
    failEventId: number;
    passEventId: number;
    /** Content digests from fail attempt WriteEvidence (path → digest). */
    failDigests: Record<string, string>;
    /** Content digests from pass attempt WriteEvidence (path → digest). */
    passDigests: Record<string, string>;
  }>;
};

/** True when path is a test file excluded from the "must differ" set (F9.3 / derivation). */
function isTestPathForAttemptPair(filePath: string): boolean {
  const n = normalizeRel(filePath);
  return n.endsWith(".test.ts") || n.endsWith(".test.js");
}

/**
 * Paths that can *substantiate* a fail→pass pair (F9.3 / p0-cursor-derivation).
 * Non-test `src/` only. Docs, plan/spec, and .ngrace run artifacts do not clear the
 * finding — "if only docs change the finding still fires" (derivation §P0.10).
 */
function isSubstantiatingPath(filePath: string): boolean {
  const n = normalizeRel(filePath);
  if (isTestPathForAttemptPair(n)) return false;
  return n === "src" || n.startsWith("src/");
}

/**
 * Content digests from a WriteEvidence snapshot (available content files only).
 * Absent/undetermined entries are not comparable substantiation.
 */
function contentDigestsFromEvidence(evidence: WriteEvidenceSnapshot | undefined): Record<string, string> {
  if (!evidence || !evidence.available) return {};
  const out: Record<string, string> = {};
  for (const file of evidence.files) {
    if (file.kind === "content" && file.digest) {
      out[normalizeRel(file.path)] = file.digest;
    }
  }
  return out;
}

/**
 * F9.3: when no non-test ObservedWriteScope path has a WriteEvidence change
 * across a fail→pass pair, raise a warning finding.
 *
 * A non-test OWS path "changes" when:
 * - content digests differ on both sides, or
 * - it appears on only one side (e.g. production file written after the fail —
 *   the textbook red-first shape; that *substantiates* the pair).
 *
 * Empty non-test evidence (test-only deliverable) raises — digests cannot read
 * task intent (F9.3). Does not exempt "honest" gaps from "unsubstantiated" ones.
 */
export function auditAttemptPairWriteEvidence(input: AttemptPairEvidenceInput): ReviewFinding[] {
  const scopeSet = new Set(input.scopeFiles.map(normalizeRel));
  const findings: ReviewFinding[] = [];

  for (const pair of input.pairs) {
    const failD = Object.fromEntries(
      Object.entries(pair.failDigests).map(([p, d]) => [normalizeRel(p), d]),
    );
    const passD = Object.fromEntries(
      Object.entries(pair.passDigests).map(([p, d]) => [normalizeRel(p), d]),
    );

    let substantiatingSeen = 0;
    let substantiatingChanged = 0;
    for (const scopePath of scopeSet) {
      if (!isSubstantiatingPath(scopePath)) continue;
      const a = failD[scopePath];
      const b = passD[scopePath];
      if (a === undefined && b === undefined) continue;
      substantiatingSeen += 1;
      // Differing digests, or presence on only one side (production written after fail).
      if (a !== b) substantiatingChanged += 1;
    }

    // Raise when no substantiating src/ non-test path changed (T-005 test-only shape included).
    if (substantiatingChanged > 0) continue;

    const anchor = `attempt-pair:${pair.task}:${pair.failEventId}->${pair.passEventId}`;
    const message =
      `Fail→pass attempt pair ${pair.task} (events ${pair.failEventId}→${pair.passEventId}) `
      + `has no differing non-test src/ ObservedWriteScope WriteEvidence digest`
      + (substantiatingSeen === 0
        ? " (no non-test src/ scope path in WriteEvidence — test-only deliverable or empty set)."
        : ` (${substantiatingSeen} non-test src/ path(s) seen, all identical across the pair).`)
      + " Red-first is not corroborated by production-file digests (F9.3).";

    findings.push(
      makeFinding(
        "review.attempt-pair-unsubstantiated",
        `.ngrace/changes/active/${input.changeId}/run`,
        message,
        "attempt-pair-write-evidence",
        anchor,
      ),
    );
  }
  return findings;
}

/**
 * Load fail→pass attempt pairs for a change from loose run/ + folded ledger.
 * Read-only. Pairs each pass with the most recent prior fail on the same task.
 */
function loadAttemptPairsFromBundle(
  projectRoot: string,
  changeId: string,
): AttemptPairEvidenceInput["pairs"] {
  let bundlePath: string;
  try {
    bundlePath = resolveChangeBundle(projectRoot, changeId);
  } catch {
    return [];
  }
  const events: LooseEvent[] = [
    ...listLedgerEvents(bundlePath),
    ...listLooseEvents(bundlePath),
  ]
    .filter((e) => e.kind === "attempt")
    .sort((a, b) => a.id - b.id);

  const lastFailByTask = new Map<string, LooseEvent>();
  const pairs: AttemptPairEvidenceInput["pairs"] = [];

  for (const event of events) {
    const payload = readAttemptPayload(event);
    const outcome = (payload.outcome ?? event.attributes.outcome ?? "").trim();
    if (outcome === "fail") {
      lastFailByTask.set(event.task, event);
      continue;
    }
    if (outcome !== "pass") continue;
    const failEvent = lastFailByTask.get(event.task);
    if (!failEvent) continue;
    const failPayload = readAttemptPayload(failEvent);
    pairs.push({
      task: event.task,
      failEventId: failEvent.id,
      passEventId: event.id,
      failDigests: contentDigestsFromEvidence(failPayload.writeEvidence),
      passDigests: contentDigestsFromEvidence(payload.writeEvidence),
    });
    lastFailByTask.delete(event.task);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function runReview(projectRoot: string, options: ReviewOptions = {}): ReviewResult {
  const root = path.resolve(projectRoot);
  const runPatterns = options.patterns !== false;
  const runProcess = options.processAudits !== false;
  const runJoin = options.joinEngine !== false;

  const findings: ReviewFinding[] = [];
  let shapeDataExemptions: string[] = [];

  if (runPatterns) {
    const patternResult = runPatternDetectorsWithMeta(root);
    findings.push(...patternResult.findings);
    shapeDataExemptions = patternResult.shapeDataExemptions;
  }

  if (runJoin && options.joinProbes && options.joinProbes.length > 0) {
    findings.push(...runJoinProbes(options.joinProbes));
  }

  let scopeAudit: ScopeAuditReport | undefined;

  if (runProcess) {
    if (options.changeId) {
      const changeId = options.changeId;
      const resolved = resolveChangePlanPath(root, changeId);
      if (!resolved) {
        const reason = `no plan found for ${changeId} under active/ or archive/`;
        scopeAudit = {
          status: "not-run",
          reason,
          changeId,
          absence: { verdict: "not-run", reason },
        };
      } else {
        const extracted = extractObservedWriteScopeFromPlan(resolved.planPath, root);
        const scopeFiles = extracted.files;
        const scopeGlobs = extracted.globs;
        const input = resolveScopeChangedFiles(root, options);
        if (input.kind === "absence") {
          scopeAudit = {
            status: input.absence.verdict === "not-run" ? "not-run" : "unable-to-determine",
            reason: input.absence.reason,
            changeId,
            planLocation: resolved.location,
            absence: input.absence,
          };
        } else if (scopeFiles.length === 0 && scopeGlobs.length === 0) {
          const reason = `plan for ${changeId} has empty ObservedWriteScope`;
          scopeAudit = {
            status: "not-run",
            reason,
            changeId,
            planLocation: resolved.location,
            absence: { verdict: "not-run", reason },
          };
        } else {
          const callerSuppliedEmpty =
            input.source === "explicit" && input.files.length === 0;
          const scopeFindings = auditScopeOutsideWriteScope(
            input.files,
            scopeFiles,
            scopeGlobs,
            { changeId, planLocation: resolved.location },
          );
          findings.push(...scopeFindings);
          const outOfScope = scopeFindings.length;
          scopeAudit = {
            status: "ran",
            reason: callerSuppliedEmpty
              ? `ran over caller-supplied empty set against ObservedWriteScope for ${changeId}`
              : outOfScope === 0
                ? `ran over ${input.files.length} changed file(s) against ObservedWriteScope for ${changeId}; no out-of-scope paths`
                : `ran over ${input.files.length} changed file(s) against ObservedWriteScope for ${changeId}; ${outOfScope} out-of-scope`,
            changeId,
            planLocation: resolved.location,
            inputSource: input.source,
            baseRef: input.baseRef,
            changedFileCount: input.files.length,
            callerSuppliedEmpty: callerSuppliedEmpty || undefined,
          };
        }
      }
    }

    if (options.testFileDiffs) {
      findings.push(...auditTestWeakening(options.testFileDiffs));
    }
    if (options.lintCodesBefore && options.lintCodesAfter) {
      findings.push(...auditCompatNewErrors(options.lintCodesBefore, options.lintCodesAfter));
    }
    if (options.hunkCoverage) {
      findings.push(...auditHunkCoverage(options.hunkCoverage));
    }

    // P0.10 / F9.3: fail→pass WriteEvidence audit when reviewing a named change.
    if (options.changeId) {
      const changeId = options.changeId;
      const resolved = resolveChangePlanPath(root, changeId);
      const scopeFiles = resolved
        ? extractObservedWriteScopeFromPlan(resolved.planPath, root).files
        : [];
      const pairs = loadAttemptPairsFromBundle(root, changeId);
      if (pairs.length > 0) {
        findings.push(
          ...auditAttemptPairWriteEvidence({
            changeId,
            scopeFiles,
            pairs,
          }),
        );
      }
    }
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file)
      || a.code.localeCompare(b.code)
      || a.findingId.localeCompare(b.findingId),
  );

  return {
    schemaVersion: "1.0.0",
    tool: "ngrace-review",
    root,
    findings,
    shapeDataExemptions,
    scopeAudit,
    summary: {
      findings: findings.length,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      shapeDataExemptions: shapeDataExemptions.length,
    },
  };
}

type ScopeChangedFilesResolution =
  | { kind: "files"; files: string[]; source: "explicit" | "base" | "porcelain"; baseRef?: string }
  | { kind: "absence"; absence: AbsenceValue };

/**
 * Resolve the changed-file set for the scope audit.
 * - defined `changedFiles` (incl. []) → caller-owned explicit set (A66 Q5)
 * - else `baseRef` → three-dot name-only (A66.3)
 * - else porcelain: non-empty usable; empty or unavailable → not-run / unable-to-determine (corr 169)
 */
function resolveScopeChangedFiles(
  root: string,
  options: ReviewOptions,
): ScopeChangedFilesResolution {
  if (options.changedFiles !== undefined) {
    const files = [
      ...new Set(
        options.changedFiles
          .map((entry) => entry.replaceAll("\\", "/").replace(/^\.\//, "").trim())
          .filter((entry) => entry !== ""),
      ),
    ].sort();
    return { kind: "files", files, source: "explicit" };
  }
  if (options.baseRef !== undefined && options.baseRef !== null && String(options.baseRef).trim() !== "") {
    const listed = listFilesChangedAgainstBase(root, String(options.baseRef));
    if (!listed.available) {
      return { kind: "absence", absence: listed.absence };
    }
    return {
      kind: "files",
      files: listed.changedFiles,
      source: "base",
      baseRef: String(options.baseRef).trim(),
    };
  }
  const listed = listRepositoryChangedFiles(root);
  if (!listed.available) {
    return {
      kind: "absence",
      absence: {
        verdict: "unable-to-determine",
        reason: "git status unavailable; cannot derive changed files (supply --base or --changed-files)",
      },
    };
  }
  if (listed.changedFiles.length === 0) {
    return {
      kind: "absence",
      absence: {
        verdict: "not-run",
        reason:
          "no changed files available (working tree clean; supply --base or --changed-files)",
      },
    };
  }
  return { kind: "files", files: listed.changedFiles, source: "porcelain" };
}

export function formatReviewResult(result: ReviewResult): string {
  const lines = [
    "neo-grace Review Report",
    "=======================",
    `Root: ${result.root}`,
    `Findings: ${result.summary.findings} (errors: ${result.summary.errors}, warnings: ${result.summary.warnings})`,
    `Shape-data exemptions: ${result.summary.shapeDataExemptions}`,
    "",
  ];
  if (result.shapeDataExemptions.length > 0) {
    for (const p of result.shapeDataExemptions) {
      lines.push(`  - ${p}`);
    }
    lines.push("");
  }

  if (result.scopeAudit) {
    lines.push(formatScopeAuditLine(result.scopeAudit));
    lines.push("");
  }

  if (result.findings.length === 0) {
    // A66.4 / rule 11: "No review findings" is false when the scope audit did not run.
    const scopeSkipped =
      result.scopeAudit
      && (result.scopeAudit.status === "not-run"
        || result.scopeAudit.status === "unable-to-determine");
    if (!scopeSkipped) {
      lines.push("No review findings.");
    }
    return lines.join("\n");
  }
  lines.push("Findings");
  for (const f of result.findings) {
    lines.push(
      `- [${f.severity}] ${f.code} ${f.file} — ${f.message} (id=${f.findingId})`,
    );
  }
  return lines.join("\n");
}

function formatScopeAuditLine(audit: ScopeAuditReport): string {
  if (audit.status === "not-run" || audit.status === "unable-to-determine") {
    return `Scope audit: ${audit.status} — ${audit.reason}`;
  }
  // status === "ran"
  if (audit.callerSuppliedEmpty) {
    return (
      `Scope audit: ran over 0 changed files against ObservedWriteScope for ${audit.changeId}`
      + ` (input: caller-supplied empty set). No out-of-scope paths.`
    );
  }
  const sourceLabel =
    audit.inputSource === "base" && audit.baseRef
      ? `base ${audit.baseRef}`
      : audit.inputSource === "explicit"
        ? "explicit --changed-files"
        : audit.inputSource === "porcelain"
          ? "working-tree porcelain"
          : "unknown";
  const n = audit.changedFileCount ?? 0;
  const planBit = audit.planLocation ? ` [${audit.planLocation}]` : "";
  if (audit.reason.includes("no out-of-scope")) {
    return (
      `Scope audit: ran over ${n} changed file(s) against ObservedWriteScope for ${audit.changeId}${planBit}`
      + ` (input: ${sourceLabel}). No out-of-scope paths.`
    );
  }
  return (
    `Scope audit: ran over ${n} changed file(s) against ObservedWriteScope for ${audit.changeId}${planBit}`
    + ` (input: ${sourceLabel}).`
  );
}

// Re-export catalog helpers used by boundary tests
export { isReviewIssueCode, allReviewCodes, REVIEW_CATALOG } from "./catalog";
