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
import { extractObservedWriteScopeFromPlan } from "./scope-helpers";
import { listRepositoryChangedFiles } from "../grace-cursor";
import {
  REVIEW_CATALOG,
  guideFor,
  type ReviewIssueGuide,
} from "./catalog";

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

export type ReviewResult = {
  schemaVersion: "1.0.0";
  tool: "ngrace-review";
  root: string;
  findings: ReviewFinding[];
  summary: { findings: number; errors: number; warnings: number };
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
  /** Explicit changed paths for process audits (overrides git when set). */
  changedFiles?: string[];
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

const KNOWN_VERIFICATION_CHILDREN = new Set([
  "Command",
  "Scenario",
  "Marker",
  "TraceAssertion",
  "TestFile",
  "File",
  "Cwd",
  "Notes",
  "Description",
  "Expected",
  "Id",
  "Module",
]);

function detectConfidentlyWrong(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Markers claimed in verification but never emitted in runtime sources.
  const verificationRel = `${ARTIFACT_DIR}/verification/main.xml`;
  const verification = readText(root, verificationRel);
  if (verification) {
    const markers = [...verification.matchAll(/<Marker>([^<]+)<\/Marker>/g)].map((m) => m[1]!.trim());
    const sourceFiles = listFilesRecursive(root, "src").filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    const sourceBlob = sourceFiles.map((f) => readText(root, f) ?? "").join("\n");
    for (const marker of markers) {
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

  // MustExist targets that do not exist on disk.
  for (const planRel of listFilesRecursive(root, `${ARTIFACT_DIR}/changes`).filter((f) =>
    f.endsWith("plan.xml"),
  )) {
    const plan = readText(root, planRel);
    if (!plan) continue;
    for (const match of plan.matchAll(/<MustExist>\s*<Value>([^<]+)<\/Value>\s*<\/MustExist>/g)) {
      const target = match[1]!.trim();
      if (!target || target.startsWith("M-") || target.startsWith("V-") || target.startsWith("AC-")) {
        continue;
      }
      const abs = path.join(root, target);
      if (!existsSync(abs)) {
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
    const plan = readText(root, planRel);
    if (!plan) continue;
    // MustMatchPattern whose File is this plan
    const posixPlan = planRel.replaceAll("\\", "/");
    const fileMatch = plan.match(
      /<MustMatchPattern>\s*<File>([^<]+)<\/File>\s*<Pattern>([^<]*)<\/Pattern>\s*<\/MustMatchPattern>/,
    );
    if (fileMatch) {
      const file = fileMatch[1]!.trim().replaceAll("\\", "/");
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

function detectRegexOverStructure(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const rel of listFilesRecursive(root, "src").filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".test.ts"),
  )) {
    // Do not flag the review surface itself (detectors contain the defective shapes as data)
    // or the corpus seed file (stores defect text as fixtures).
    if (rel.startsWith("src/review/") || rel.includes("defect-corpus")) continue;
    const text = readText(root, rel);
    if (!text) continue;

    // re-01 shape: status= attribute guard via regex + .test(
    if (
      /status\\s\*=\\s\*\[?["']approved["']\]?/.test(text)
      || /\/status\\s\*=\\s\*/.test(text)
      || /\/status\s*=\s*\[?["']approved["']/.test(text)
    ) {
      if (/\.test\s*\(/.test(text)) {
        findings.push(
          makeFinding(
            "review.regex-over-structure",
            rel,
            "File uses a regular expression as a structural guard over text that has structure.",
            "status-attr-regex",
            "status-eq-regex",
          ),
        );
        continue;
      }
    }

    // re-02 shape: /export function (\w+)/ scan of raw source
    if (/\/export function\s*[(\\]]/.test(text) || /\/export function \(\\w\+\)/.test(text)) {
      if (/\.exec\s*\(|\.test\s*\(/.test(text)) {
        findings.push(
          makeFinding(
            "review.regex-over-structure",
            rel,
            "File uses a regular expression as a structural guard over text that has structure.",
            "export-function-regex",
            "export-fn-regex",
          ),
        );
        continue;
      }
    }

    // re-03 shape: line-oriented START_MODULE_CONTRACT marker regex as a governance guard
    // Require both the marker token inside a regex and a line-anchored pattern (^\s*).
    if (
      /START_MODULE_CONTRACT/.test(text)
      && /\/\^/.test(text)
      && /START_MODULE_CONTRACT/.test(text)
      && /\.test\s*\(/.test(text)
      && /function\s+\w+\s*\([^)]*source|function\s+\w+\s*\([^)]*line|fileLooksGoverned|hasGraceMarkers/.test(
        text,
      )
    ) {
      findings.push(
        makeFinding(
          "review.regex-over-structure",
          rel,
          "Line-oriented marker regex over source without structure awareness.",
          "marker-line-regex",
          "start-module-contract-regex",
        ),
      );
    }
  }
  return findings;
}

function detectZeroOrMoreSwallow(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const planRel of listFilesRecursive(root, `${ARTIFACT_DIR}/changes`).filter((f) =>
    f.endsWith("plan.xml"),
  )) {
    const plan = readText(root, planRel);
    if (!plan) continue;
    // Task with empty DependsOn and title that claims sequencing
    const taskBlocks = [
      ...plan.matchAll(
        /<(T-\d+)>\s*<Title>([^<]*)<\/Title>\s*<DependsOn>\s*<\/DependsOn>/g,
      ),
    ];
    for (const block of taskBlocks) {
      const taskId = block[1]!;
      const title = block[2]!;
      if (/\bafter\b|\bsecond\b|\bthen\b|\bfollow/i.test(title)) {
        findings.push(
          makeFinding(
            "review.zero-or-more-swallow",
            planRel,
            `${taskId} title claims sequencing ("${title}") but DependsOn is empty.`,
            "empty-depends-with-sequence-title",
            `task:${taskId}:empty-depends`,
          ),
        );
      }
    }
  }
  return findings;
}

function detectUnthreadedConstruct(root: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const verificationRel = `${ARTIFACT_DIR}/verification/main.xml`;
  const verification = readText(root, verificationRel);
  if (!verification) return findings;

  // Children of V-M-* that are not known verification tags
  const vmBlocks = [...verification.matchAll(/<(V-M-[A-Z0-9-]+)>([\s\S]*?)<\/\1>/g)];
  for (const block of vmBlocks) {
    const body = block[2]!;
    const children = [...body.matchAll(/<([A-Za-z][\w-]*)(?:\s[^>]*)?>/g)].map((m) => m[1]!);
    for (const child of children) {
      if (KNOWN_VERIFICATION_CHILDREN.has(child)) continue;
      if (child.startsWith("/") || child === block[1]) continue;
      findings.push(
        makeFinding(
          "review.unthreaded-construct",
          verificationRel,
          `Verification child <${child}> under ${block[1]} is not threaded through health or assertion evaluation.`,
          "unknown-verification-child",
          `vm-child:${block[1]}:${child}`,
        ),
      );
    }
  }
  return findings;
}

export function runPatternDetectors(root: string): ReviewFinding[] {
  return [
    ...detectConfidentlyWrong(root),
    ...detectSelfReferential(root),
    ...detectRegexOverStructure(root),
    ...detectZeroOrMoreSwallow(root),
    ...detectUnthreadedConstruct(root),
  ];
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

export function auditScopeOutsideWriteScope(
  changedFiles: string[],
  scopeFiles: string[],
  scopeGlobs: string[],
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileSet = new Set(scopeFiles.map(normalizeRel));
  for (const changed of changedFiles.map(normalizeRel)) {
    if (fileSet.has(changed)) continue;
    const globHit = scopeGlobs.some((glob) => matchSimpleGlob(glob, changed));
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
// Public entry
// ---------------------------------------------------------------------------

export function runReview(projectRoot: string, options: ReviewOptions = {}): ReviewResult {
  const root = path.resolve(projectRoot);
  const runPatterns = options.patterns !== false;
  const runProcess = options.processAudits !== false;
  const runJoin = options.joinEngine !== false;

  const findings: ReviewFinding[] = [];

  if (runPatterns) {
    findings.push(...runPatternDetectors(root));
  }

  if (runJoin && options.joinProbes && options.joinProbes.length > 0) {
    findings.push(...runJoinProbes(options.joinProbes));
  }

  if (runProcess) {
    let changedFiles = options.changedFiles;
    let scopeFiles: string[] = [];
    let scopeGlobs: string[] = [];

    if (options.changeId) {
      const paths = resolveNgracePaths(root);
      const planPath = path.join(paths.changesActiveDir, options.changeId, "plan.xml");
      if (existsSync(planPath)) {
        const extracted = extractObservedWriteScopeFromPlan(planPath, root);
        scopeFiles = extracted.files;
        scopeGlobs = extracted.globs;
      }
      if (!changedFiles) {
        const listed = listRepositoryChangedFiles(root);
        if (listed.available) changedFiles = listed.changedFiles;
      }
    }

    if (changedFiles && (scopeFiles.length > 0 || scopeGlobs.length > 0)) {
      findings.push(...auditScopeOutsideWriteScope(changedFiles, scopeFiles, scopeGlobs));
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
    summary: {
      findings: findings.length,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    },
  };
}

export function formatReviewResult(result: ReviewResult): string {
  const lines = [
    "neo-grace Review Report",
    "=======================",
    `Root: ${result.root}`,
    `Findings: ${result.summary.findings} (errors: ${result.summary.errors}, warnings: ${result.summary.warnings})`,
    "",
  ];
  if (result.findings.length === 0) {
    lines.push("No review findings.");
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

// Re-export catalog helpers used by boundary tests
export { isReviewIssueCode, allReviewCodes, REVIEW_CATALOG } from "./catalog";
