// START_MODULE_CONTRACT
//   PURPOSE: Transition gate surface
//   SCOPE: Approve, apply, archive evaluation and ledger decisions
//   DEPENDS: none
//   LINKS: M-GATES
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DecisionListResult
//   GateDecisionRecord
//   GateDecisionValue
//   GateId
//   GateRequirementRecord
//   LEDGER_NON_EPOCH_SECTIONS
//   LatestReviewVerdict
//   LedgerVerdictsSurface
//   LedgerWrapperSurface
//   PermittingDecisionStatus
//   ResolutionClassification
//   ReviewVerdictOutcome
//   ReviewVerdictRecord
//   ReviewVerdictScope
//   hasPermittingDecision
//   classifyApprovedArtifact
//   stampApproveArtifact
//   supersedeChangeBundle
//   ApprovedArtifactClassification
//   ApprovedArtifactName
//   latestReviewVerdict
//   listGateDecisions
//   listReviewVerdicts
//   parseResolutionClassification
//   parseReviewVerdictScope
//   readGateDecisions
//   readLatestReviewVerdict
//   readLedgerVerdictsSurface
//   readLedgerWrapper
//   readPermittingDecision
//   recordGateDecision
//   recordReviewVerdict
// END_MODULE_MAP
/**
 * Bundle-scoped Verdicts and Decisions on run-ledger.xml (A30.2).
 * Siblings to Epoch-N; never loose run/ events (correction 61).
 * Write path: validate constructed tree, write, re-read, verify, restore on failure (A31.5).
 * Read path: newest entry governs; unreadable is absence with reason, never skip (A31.2).
 * Section boundary: duplicate or validator-rejected section is invalid, not first-wins (A32.1 / 68).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { spawnShellCommand } from "../artifact/assertions";
import { isCloseBoundCriterion, validateRunLedgerArtifact } from "../artifact/grammar";
import { ARTIFACT_DIR } from "../artifact/paths";
import { ANCHOR_PATTERNS, ARTIFACT_TAG_PREFIX, NGRACE_ARTIFACT_VERSION } from "../artifact/types";
import { cloneXmlNode, parseGraceXmlArtifact, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "../artifact/xml";
import { serializeGraceXmlDocument } from "../artifact/xml-serialize";
import { resolveChangeBundle } from "../grace-cursor";
import { GraceCommandError } from "../query/errors";

export type ReviewVerdictOutcome = "pass" | "fail" | "unable-to-determine";

/**
 * D10 review scope, extended with `bundle` (A71 / corr 182).
 * Historical unscoped verdicts stay scope-not-recorded — never retro-labelled bundle.
 */
export type ReviewVerdictScope = "task" | "wave" | "bundle";

/** Stored at resolution (rule 13) — implementation vs plan defect (D10). */
export type ResolutionClassification = "implementation" | "plan";

export type ReviewVerdictRecord = {
  outcome: ReviewVerdictOutcome;
  /** D5 reason when outcome is an absence (e.g. host-capability-missing). */
  reason?: string;
  /** Optional free text. */
  note?: string;
  /**
   * Optional D10 scope. Absent means scope-not-recorded at report time —
   * never defaulted to task, wave, or bundle (D5 / rule 13 / corr 182).
   */
  scope?: ReviewVerdictScope;
  /** Task id when scope=task (optional label). */
  task?: string;
  /** Wave id when scope=wave (optional label; used for precondition join). */
  wave?: string;
  /**
   * Stored resolution classification (implementation | plan). Written at resolution
   * time; report reads this field, never re-derives as sole truth (P3 / rule 13).
   */
  classification?: ResolutionClassification;
  /**
   * Stored when scope=wave and outcome=fail: whether every constituent task passed
   * its own verification at record time. Absent + reason when unknown.
   */
  constituentTasksPassed?: boolean;
  /** D5 reason when constituentTasksPassed could not be determined. */
  constituentTasksPassedReason?: string;
};

export type GateId = "approve" | "apply" | "archive";
export type GateDecisionValue = "permit" | "refuse";

export type GateRequirementRecord = {
  id: string;
  required: boolean;
  present: boolean;
  blocking: boolean;
  message?: string;
};

export type GateDecisionRecord = {
  gate: GateId;
  decision: GateDecisionValue;
  requirements: GateRequirementRecord[];
  /** First observed HEAD object name on a permitting approve. Omitted when never observed. */
  baseCommit?: string;
  /** SHA-256 lowercase hex of the targeted artifact bytes after the status write. */
  fingerprint?: string;
  /** Which artifact this permitting approve targeted. */
  artifact?: "spec" | "plan";
  /** Present and true only on a forced permit. Omit when unused; never store false. */
  forced?: boolean;
  /** Operator-supplied reason stored only with forced true. */
  reason?: string;
};

/** Newest-governs read of the Verdicts section (A31.2). Invalid is never skipped. */
export type LatestReviewVerdict =
  | { state: "absent" }
  | { state: "invalid"; code: string; detail: string }
  | { state: "present"; verdict: ReviewVerdictRecord };

/** Newest-governs scan of Decisions; any unreadable entry is invalid, never skipped (A31.2 / A32.1). */
export type DecisionListResult =
  | { state: "ok"; decisions: GateDecisionRecord[]; sectionPresent: boolean }
  | { state: "invalid"; code: string; detail: string };

/**
 * Permit lookup with reason (A32.1 / A33.1).
 * - absent: no Decisions section (pre-gate bundles; not a violation)
 * - no-permit: Decisions section exists but holds no permitting apply
 * - invalid: unreadable section
 */
export type PermittingDecisionStatus =
  | { state: "permit" }
  | { state: "absent"; reason: "no-decisions-section" }
  | { state: "no-permit" }
  | { state: "invalid"; code: string; detail: string };

const LEDGER_BUNDLE_SECTIONS = new Set(["Verdicts", "Decisions"]);

const VALID_OUTCOMES = new Set<string>(["pass", "fail", "unable-to-determine"]);
const VALID_SCOPES = new Set<string>(["task", "wave", "bundle"]);
const VALID_CLASSIFICATIONS = new Set<string>(["implementation", "plan"]);
const VALID_GATES = new Set<string>(["approve", "apply", "archive"]);
const VALID_DECISIONS = new Set<string>(["permit", "refuse"]);

export function parseReviewVerdictScope(value: string): ReviewVerdictScope {
  if (!VALID_SCOPES.has(value)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported verdict scope \`${value}\`. Use task, wave, or bundle.`,
    );
  }
  return value as ReviewVerdictScope;
}

export function parseResolutionClassification(value: string): ResolutionClassification {
  if (!VALID_CLASSIFICATIONS.has(value)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported resolution classification \`${value}\`. Use implementation or plan.`,
    );
  }
  return value as ResolutionClassification;
}

function emptyLedgerRoot(changeId: string): GraceXmlNode {
  return {
    tag: `${ARTIFACT_TAG_PREFIX}RunLedger`,
    attributes: { graceVersion: NGRACE_ARTIFACT_VERSION },
    children: [{ tag: changeId, attributes: {}, children: [], text: "" }],
    text: "",
  };
}

function loadOrCreateLedgerRoot(bundlePath: string, changeId: string): GraceXmlNode {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) {
    return emptyLedgerRoot(changeId);
  }
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) {
    throw new GraceCommandError("invalid-project", `Existing run-ledger.xml at ${ledgerPath} is unreadable.`);
  }
  return cloneXmlNode(artifact.root);
}

function ensureWrapper(root: GraceXmlNode, changeId: string): GraceXmlNode {
  let wrapper = root.children.find((child) => child.tag === changeId);
  if (!wrapper) {
    wrapper = { tag: changeId, attributes: {}, children: [], text: "" };
    root.children.push(wrapper);
  }
  return wrapper;
}

function ensureSection(wrapper: GraceXmlNode, sectionTag: "Verdicts" | "Decisions"): GraceXmlNode {
  const existing = wrapper.children.find((child) => child.tag === sectionTag);
  if (existing) return existing;
  const section: GraceXmlNode = { tag: sectionTag, attributes: {}, children: [], text: "" };
  // Append after any Epoch-N sections so fold's epoch walk stays contiguous at the front.
  wrapper.children.push(section);
  return section;
}

/**
 * Validate the constructed tree, write, re-read, verify; restore prior bytes on failure (A31.5).
 * Never leaves a failed write on disk. Does not delete a good prior file.
 */
function writeAndVerifyLedger(bundlePath: string, root: GraceXmlNode): void {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  const priorBytes = existsSync(ledgerPath) ? readFileSync(ledgerPath) : null;

  const preValidation = validateRunLedgerArtifact({
    file: ledgerPath,
    root,
    issues: [],
  });
  const preErrors = preValidation.issues.filter((issue) => issue.severity === "error");
  if (preErrors.length > 0) {
    throw new GraceCommandError(
      "invalid-project",
      `run-ledger.xml failed verification before write: ${preErrors.map((e) => e.code).join(", ")}`,
      { issues: preErrors.map((e) => e.code) },
    );
  }

  writeFileSync(ledgerPath, serializeGraceXmlDocument(root));

  const reRead = readGraceXmlArtifact(ledgerPath);
  const postValidation = validateRunLedgerArtifact(reRead);
  const postErrors = postValidation.issues.filter((issue) => issue.severity === "error");
  if (postErrors.length > 0) {
    if (priorBytes !== null) {
      writeFileSync(ledgerPath, priorBytes);
    } else if (existsSync(ledgerPath)) {
      unlinkSync(ledgerPath);
    }
    throw new GraceCommandError(
      "invalid-project",
      `run-ledger.xml failed verification after write; prior content restored: ${postErrors.map((e) => e.code).join(", ")}`,
      { issues: postErrors.map((e) => e.code) },
    );
  }
}

/** Append a review verdict to the ledger Verdicts section (A30.2). Leaves run/ untouched. */
export function recordReviewVerdict(
  projectRoot: string,
  changeId: string,
  verdict: ReviewVerdictRecord,
): ReviewVerdictRecord {
  if (!VALID_OUTCOMES.has(verdict.outcome)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported verdict outcome \`${verdict.outcome}\`. Use pass, fail, or unable-to-determine.`,
    );
  }
  if (verdict.scope !== undefined && !VALID_SCOPES.has(verdict.scope)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported verdict scope \`${verdict.scope}\`. Use task, wave, or bundle.`,
    );
  }
  if (verdict.classification !== undefined && !VALID_CLASSIFICATIONS.has(verdict.classification)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported resolution classification \`${verdict.classification}\`. Use implementation or plan.`,
    );
  }
  // Corr 184: constituentTasksPassed applies only to wave-scoped fail — never silent drop.
  const ctpSupplied =
    verdict.constituentTasksPassed !== undefined ||
    Boolean(verdict.constituentTasksPassedReason?.trim());
  if (ctpSupplied && !(verdict.scope === "wave" && verdict.outcome === "fail")) {
    throw new GraceCommandError(
      "invalid-arguments",
      "constituentTasksPassed applies only to wave-scoped fail verdicts",
    );
  }

  // Stored fields only — never invent scope or classification defaults (D5 / corr 182).
  const stored: ReviewVerdictRecord = {
    outcome: verdict.outcome,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(verdict.note ? { note: verdict.note } : {}),
    ...(verdict.scope ? { scope: verdict.scope } : {}),
    ...(verdict.task ? { task: verdict.task } : {}),
    ...(verdict.wave ? { wave: verdict.wave } : {}),
    ...(verdict.classification ? { classification: verdict.classification } : {}),
  };
  if (verdict.scope === "wave" && verdict.outcome === "fail") {
    if (verdict.constituentTasksPassed !== undefined) {
      stored.constituentTasksPassed = verdict.constituentTasksPassed;
      if (verdict.constituentTasksPassedReason) {
        stored.constituentTasksPassedReason = verdict.constituentTasksPassedReason;
      }
    } else if (verdict.constituentTasksPassedReason) {
      stored.constituentTasksPassedReason = verdict.constituentTasksPassedReason;
    }
  }

  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const closeChildren = evaluateCloseEvidenceChildren(projectRoot, bundlePath);
  if (
    verdict.outcome === "pass"
    && closeChildren.some((child) =>
      child.children.some((node) => node.tag === "Result" && node.text.trim() === "fail"))
  ) {
    throw new GraceCommandError(
      "invalid-arguments",
      "CloseEvidence Command exited non-zero; refuse to record outcome pass.",
    );
  }
  const root = loadOrCreateLedgerRoot(bundlePath, changeId);
  const wrapper = ensureWrapper(root, changeId);
  const section = ensureSection(wrapper, "Verdicts");
  const attributes: Record<string, string> = { outcome: stored.outcome };
  if (stored.reason) attributes.reason = stored.reason;
  if (stored.scope) attributes.scope = stored.scope;
  if (stored.task) attributes.task = stored.task;
  if (stored.wave) attributes.wave = stored.wave;
  if (stored.classification) attributes.classification = stored.classification;
  if (stored.constituentTasksPassed !== undefined) {
    attributes.constituentTasksPassed = stored.constituentTasksPassed ? "true" : "false";
  }
  if (stored.constituentTasksPassedReason) {
    attributes.constituentTasksPassedReason = stored.constituentTasksPassedReason;
  }
  section.children.push({
    tag: "Verdict",
    attributes,
    children: closeChildren,
    text: stored.note ?? "",
  });
  writeAndVerifyLedger(bundlePath, root);
  return stored;
}

function isAppliedArchiveBundle(bundlePath: string, specStatus: string | undefined): boolean {
  const archiveMarker = `${path.sep}changes${path.sep}archive${path.sep}`;
  return bundlePath.includes(archiveMarker) && specStatus === "applied";
}

function evaluateCloseEvidenceChildren(projectRoot: string, bundlePath: string): GraceXmlNode[] {
  const specPath = path.join(bundlePath, "spec.xml");
  if (!existsSync(specPath)) return [];
  const spec = readGraceXmlArtifact(specPath);
  if (!isAppliedArchiveBundle(bundlePath, spec.root?.attributes.status)) {
    return [];
  }
  const wrapper = spec.root?.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
  if (!wrapper) return [];
  const children: GraceXmlNode[] = [];
  for (const section of wrapper.children.filter((child) => child.tag === "AcceptanceCriteria")) {
    for (const node of walkNodes(section)) {
      if (node === section || !isCloseBoundCriterion(node)) continue;
      const close = node.children.find((child) => child.tag === "CloseEvidence");
      if (!close) continue;
      let exitCode = 0;
      let result: "pass" | "fail" = "pass";
      for (const command of close.children.filter((child) => child.tag === "Command" && child.text.trim())) {
        const spawned = spawnShellCommand(command.text.trim(), projectRoot);
        const code = spawned.exitCode ?? 1;
        exitCode = code;
        if (code !== 0) {
          result = "fail";
          break;
        }
      }
      children.push({
        tag: node.tag,
        attributes: {},
        children: [
          { tag: "Exit", attributes: {}, children: [], text: String(exitCode) },
          { tag: "Result", attributes: {}, children: [], text: result },
        ],
        text: "",
      });
    }
  }
  return children;
}

/** Append a gate decision to the ledger Decisions section (A30.2). Leaves run/ untouched. */
export function recordGateDecision(
  projectRoot: string,
  changeId: string,
  decision: GateDecisionRecord,
): GateDecisionRecord {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const root = loadOrCreateLedgerRoot(bundlePath, changeId);
  const wrapper = ensureWrapper(root, changeId);
  const section = ensureSection(wrapper, "Decisions");
  const reqChildren: GraceXmlNode[] = decision.requirements.map((req) => ({
    tag: "Requirement",
    attributes: {
      id: req.id,
      required: req.required ? "true" : "false",
      present: req.present ? "true" : "false",
      blocking: req.blocking ? "true" : "false",
    },
    children: [],
    text: req.message ?? "",
  }));
  const attributes: Record<string, string> = {
    gate: decision.gate,
    decision: decision.decision,
  };
  if (decision.gate === "approve" && decision.decision === "permit") {
    const stored = firstStoredBaseCommit(section);
    const incoming = (decision.baseCommit ?? "").trim();
    const value = stored ?? (incoming || undefined);
    if (value) attributes.baseCommit = value;
    if (decision.fingerprint) attributes.fingerprint = decision.fingerprint;
    if (decision.artifact) attributes.artifact = decision.artifact;
    if (decision.forced === true) {
      attributes.forced = "true";
      const reason = (decision.reason ?? "").trim();
      if (reason) attributes.reason = reason;
    }
  }
  section.children.push({
    tag: "Decision",
    attributes,
    children: reqChildren,
    text: "",
  });
  writeAndVerifyLedger(bundlePath, root);
  return decision;
}

/**
 * Sole three-exit classification for run-ledger.xml → change wrapper
 * (C-LEGIBLE-FAILURE / AC-SINGLE-CLASSIFICATION).
 *
 * exists → regular file → parses → correct root → wrapper for changeId.
 * No second production definition of this chain may exist.
 */
export type LedgerWrapperSurface =
  | { state: "absent-no-file" }
  | { state: "unreadable"; code: string; detail: string }
  | { state: "ok"; wrapper: GraceXmlNode };

/**
 * Classify ledger file presence and the change-id wrapper under the ledger root.
 * Callers map exits into their own result types; they must not re-implement this chain.
 */
export function readLedgerWrapper(bundlePath: string, changeId: string): LedgerWrapperSurface {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) {
    return { state: "absent-no-file" };
  }

  try {
    const st = statSync(ledgerPath);
    if (!st.isFile()) {
      return {
        state: "unreadable",
        code: "xml.parse",
        detail: `run-ledger.xml is not a regular file (${st.isDirectory() ? "directory" : "special"})`,
      };
    }
  } catch (error) {
    return {
      state: "unreadable",
      code: "xml.parse",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let artifact: ReturnType<typeof readGraceXmlArtifact>;
  try {
    artifact = readGraceXmlArtifact(ledgerPath);
  } catch (error) {
    return {
      state: "unreadable",
      code: "xml.parse",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!artifact.root) {
    const issue = artifact.issues[0];
    return {
      state: "unreadable",
      code: issue?.code ?? "xml.parse",
      detail: issue?.message ?? "run-ledger.xml could not be parsed",
    };
  }

  // Corr 187: a non-ledger root with a matching wrapper must not look like ok/empty.
  // Match lint code ledger.invalid-root-tag (grammar validateRunLedger).
  const expectedRoot = `${ARTIFACT_TAG_PREFIX}RunLedger`;
  if (artifact.root.tag !== expectedRoot) {
    return {
      state: "unreadable",
      code: "ledger.invalid-root-tag",
      detail: `Unsupported run ledger root tag '${artifact.root.tag}'. Expected ${expectedRoot}.`,
    };
  }

  const wrapper = artifact.root.children.find((child) => child.tag === changeId);
  if (!wrapper) {
    return {
      state: "unreadable",
      code: "ledger.bundle-id-mismatch",
      detail: `run-ledger.xml has no wrapper for ${changeId}`,
    };
  }

  return { state: "ok", wrapper };
}

/**
 * Distinguishes absent-no-file vs unreadable vs ok for plan-quality and other consumers
 * that must not shrink a corpus silently (corr 185–187 / A31.2 / D5).
 *
 * Shared prefix (exists → parse → wrapper) is readLedgerWrapper only. This function
 * continues with Verdicts section → children after ok(wrapper).
 */
export type LedgerVerdictsSurface =
  | { state: "absent-no-file" }
  | { state: "unreadable"; code: string; detail: string }
  | { state: "ok"; verdicts: ReviewVerdictRecord[] };

export function readLedgerVerdictsSurface(
  projectRoot: string,
  changeId: string,
): LedgerVerdictsSurface {
  let bundlePath: string;
  try {
    bundlePath = resolveChangeBundle(projectRoot, changeId);
  } catch {
    return { state: "absent-no-file" };
  }

  const classified = readLedgerWrapper(bundlePath, changeId);
  if (classified.state === "absent-no-file") {
    return { state: "absent-no-file" };
  }
  if (classified.state === "unreadable") {
    return { state: "unreadable", code: classified.code, detail: classified.detail };
  }

  const { wrapper } = classified;
  const selected = selectUniqueSection(wrapper, "Verdicts");
  if (selected.state === "absent") {
    return { state: "ok", verdicts: [] };
  }
  if (selected.state === "invalid") {
    return {
      state: "unreadable",
      code: "ledger.invalid-verdict",
      detail: selected.detail,
    };
  }

  const verdicts: ReviewVerdictRecord[] = [];
  for (const child of selected.section.children) {
    if (child.tag !== "Verdict") {
      return {
        state: "unreadable",
        code: "ledger.invalid-verdict",
        detail: `unexpected <${child.tag}> under Verdicts`,
      };
    }
    const parsed = parseVerdictNode(child);
    if ("invalid" in parsed) {
      return {
        state: "unreadable",
        code: "ledger.invalid-verdict",
        detail: parsed.invalid,
      };
    }
    verdicts.push(parsed);
  }
  return { state: "ok", verdicts };
}

function parseVerdictNode(child: GraceXmlNode): ReviewVerdictRecord | { invalid: string } {
  const outcome = child.attributes.outcome;
  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    return { invalid: `outcome=${outcome ?? "(missing)"}` };
  }
  const scopeRaw = (child.attributes.scope ?? "").trim();
  if (scopeRaw && !VALID_SCOPES.has(scopeRaw)) {
    return { invalid: `scope=${scopeRaw}` };
  }
  const classRaw = (child.attributes.classification ?? "").trim();
  if (classRaw && !VALID_CLASSIFICATIONS.has(classRaw)) {
    return { invalid: `classification=${classRaw}` };
  }
  const ctpRaw = (child.attributes.constituentTasksPassed ?? "").trim();
  if (ctpRaw && ctpRaw !== "true" && ctpRaw !== "false") {
    return { invalid: `constituentTasksPassed=${ctpRaw}` };
  }
  const record: ReviewVerdictRecord = {
    outcome: outcome as ReviewVerdictOutcome,
    reason: child.attributes.reason || undefined,
    note: child.text.trim() || undefined,
  };
  // Never invent scope when attribute is absent (corr 182 retro-label forbid).
  if (scopeRaw) record.scope = scopeRaw as ReviewVerdictScope;
  if (child.attributes.task?.trim()) record.task = child.attributes.task.trim();
  if (child.attributes.wave?.trim()) record.wave = child.attributes.wave.trim();
  if (classRaw) record.classification = classRaw as ResolutionClassification;
  if (ctpRaw === "true") record.constituentTasksPassed = true;
  if (ctpRaw === "false") record.constituentTasksPassed = false;
  if (child.attributes.constituentTasksPassedReason?.trim()) {
    record.constituentTasksPassedReason = child.attributes.constituentTasksPassedReason.trim();
  }
  return record;
}

function parseDecisionNode(child: GraceXmlNode): GateDecisionRecord | { invalid: string } {
  const gate = child.attributes.gate;
  const decision = child.attributes.decision;
  if (!gate || !VALID_GATES.has(gate) || !decision || !VALID_DECISIONS.has(decision)) {
    return {
      invalid: `gate=${gate ?? "(missing)"} decision=${decision ?? "(missing)"}`,
    };
  }
  const requirements: GateRequirementRecord[] = [];
  for (const req of child.children) {
    if (req.tag !== "Requirement") {
      return { invalid: `non-Requirement child <${req.tag}> under Decision` };
    }
    if (!(req.attributes.id ?? "").trim()) {
      return { invalid: "Requirement missing id" };
    }
    requirements.push({
      id: req.attributes.id ?? "",
      required: req.attributes.required === "true",
      present: req.attributes.present === "true",
      blocking: req.attributes.blocking === "true",
      message: req.text.trim() || undefined,
    });
  }
  const record: GateDecisionRecord = {
    gate: gate as GateId,
    decision: decision as GateDecisionValue,
    requirements,
  };
  const baseCommit = (child.attributes.baseCommit ?? "").trim();
  if (baseCommit) record.baseCommit = baseCommit;
  const fingerprint = (child.attributes.fingerprint ?? "").trim();
  if (fingerprint) record.fingerprint = fingerprint;
  const artifact = (child.attributes.artifact ?? "").trim();
  if (artifact === "spec" || artifact === "plan") record.artifact = artifact;
  if ((child.attributes.forced ?? "").trim() === "true") record.forced = true;
  const reason = (child.attributes.reason ?? "").trim();
  if (reason) record.reason = reason;
  return record;
}

function firstStoredBaseCommit(section: GraceXmlNode): string | undefined {
  for (const child of section.children) {
    if (child.tag !== "Decision") continue;
    if (child.attributes.gate !== "approve") continue;
    if (child.attributes.decision !== "permit") continue;
    const value = (child.attributes.baseCommit ?? "").trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Select the unique named section under the change wrapper (A32.1 / correction 68).
 * Duplicate sections make "newest" undefined → invalid, never first-wins.
 */
function selectUniqueSection(
  wrapper: GraceXmlNode,
  tag: "Verdicts" | "Decisions",
):
  | { state: "absent" }
  | { state: "invalid"; detail: string }
  | { state: "ok"; section: GraceXmlNode } {
  const matches = wrapper.children.filter((child) => child.tag === tag);
  if (matches.length === 0) return { state: "absent" };
  if (matches.length > 1) {
    return {
      state: "invalid",
      detail: `duplicate ${tag} sections (${matches.length}); newest is undefined`,
    };
  }
  return { state: "ok", section: matches[0]! };
}

/**
 * Newest Verdict entry governs (A31.2). Section must be unique and every child
 * validator-clean (A32.1) — filter is not a read strategy.
 */
export function readLatestReviewVerdict(projectRoot: string, changeId: string): LatestReviewVerdict {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const classified = readLedgerWrapper(bundlePath, changeId);
  if (classified.state === "absent-no-file") return { state: "absent" };
  if (classified.state === "unreadable") {
    return {
      state: "invalid",
      code: classified.code,
      detail: classified.detail,
    };
  }
  const { wrapper } = classified;
  const selected = selectUniqueSection(wrapper, "Verdicts");
  if (selected.state === "absent") return { state: "absent" };
  if (selected.state === "invalid") {
    return {
      state: "invalid",
      code: "ledger.invalid-verdict",
      detail: selected.detail,
    };
  }
  const { section } = selected;
  if (section.children.length === 0) return { state: "absent" };

  // Every child must be a valid Verdict — no filter, no skip (A32.1 second facet).
  const parsedEntries: ReviewVerdictRecord[] = [];
  for (const child of section.children) {
    if (child.tag !== "Verdict") {
      return {
        state: "invalid",
        code: "ledger.invalid-verdict",
        detail: `unexpected <${child.tag}> under Verdicts`,
      };
    }
    const parsed = parseVerdictNode(child);
    if ("invalid" in parsed) {
      return {
        state: "invalid",
        code: "ledger.invalid-verdict",
        detail: parsed.invalid,
      };
    }
    parsedEntries.push(parsed);
  }
  return { state: "present", verdict: parsedEntries[parsedEntries.length - 1]! };
}

/**
 * All recorded review verdicts (oldest first). Throws when the section is duplicated
 * or any child is unreadable so callers cannot convert an absence into a shorter list.
 */
export function listReviewVerdicts(projectRoot: string, changeId: string): ReviewVerdictRecord[] {
  const read = readLatestReviewVerdict(projectRoot, changeId);
  if (read.state === "invalid") {
    throw new GraceCommandError(
      "invalid-project",
      `${read.code}: ${read.detail}`,
      { issues: [read.code] },
    );
  }
  if (read.state === "absent") return [];
  // Re-walk for the full list (section already known clean via readLatest).
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const classified = readLedgerWrapper(bundlePath, changeId);
  if (classified.state !== "ok") return [];
  const selected = selectUniqueSection(classified.wrapper, "Verdicts");
  if (selected.state !== "ok") return [];
  return selected.section.children.map((child) => {
    const parsed = parseVerdictNode(child);
    if ("invalid" in parsed) {
      throw new GraceCommandError(
        "invalid-project",
        `ledger.invalid-verdict: ${parsed.invalid}`,
        { issues: ["ledger.invalid-verdict"] },
      );
    }
    return parsed;
  });
}

/** @deprecated Prefer readLatestReviewVerdict — this collapses invalid to undefined. */
export function latestReviewVerdict(
  projectRoot: string,
  changeId: string,
): ReviewVerdictRecord | undefined {
  const read = readLatestReviewVerdict(projectRoot, changeId);
  return read.state === "present" ? read.verdict : undefined;
}

/** All recorded gate decisions with no silent skip of unreadable entries (A31.2 / A32.1). */
export function readGateDecisions(projectRoot: string, changeId: string): DecisionListResult {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const classified = readLedgerWrapper(bundlePath, changeId);
  if (classified.state === "absent-no-file") {
    return { state: "ok", decisions: [], sectionPresent: false };
  }
  if (classified.state === "unreadable") {
    return {
      state: "invalid",
      code: classified.code,
      detail: classified.detail,
    };
  }
  const selected = selectUniqueSection(classified.wrapper, "Decisions");
  if (selected.state === "absent") return { state: "ok", decisions: [], sectionPresent: false };
  if (selected.state === "invalid") {
    return {
      state: "invalid",
      code: "ledger.invalid-decision",
      detail: selected.detail,
    };
  }
  const out: GateDecisionRecord[] = [];
  for (const child of selected.section.children) {
    if (child.tag !== "Decision") {
      return {
        state: "invalid",
        code: "ledger.invalid-decision",
        detail: `unexpected <${child.tag}> under Decisions`,
      };
    }
    const parsed = parseDecisionNode(child);
    if ("invalid" in parsed) {
      return {
        state: "invalid",
        code: "ledger.invalid-decision",
        detail: parsed.invalid,
      };
    }
    out.push(parsed);
  }
  return { state: "ok", decisions: out, sectionPresent: true };
}

/**
 * All recorded gate decisions (oldest first). Throws when any entry is unreadable
 * so callers cannot convert an absence into a shorter valid list (A31.2).
 */
export function listGateDecisions(projectRoot: string, changeId: string): GateDecisionRecord[] {
  const result = readGateDecisions(projectRoot, changeId);
  if (result.state === "invalid") {
    throw new GraceCommandError(
      "invalid-project",
      `${result.code}: ${result.detail}`,
      { issues: [result.code] },
    );
  }
  return result.decisions;
}

/**
 * Permit lookup that keeps the reason when the Decisions section is unreadable (A32.1)
 * and distinguishes no section (A33.1 grandfather) from section-without-permit (violation).
 */
export function readPermittingDecision(
  projectRoot: string,
  changeId: string,
  gate: GateId,
): PermittingDecisionStatus {
  const result = readGateDecisions(projectRoot, changeId);
  if (result.state === "invalid") {
    return {
      state: "invalid",
      code: result.code,
      detail: result.detail,
    };
  }
  if (result.decisions.some((entry) => entry.gate === gate && entry.decision === "permit")) {
    return { state: "permit" };
  }
  if (!result.sectionPresent) {
    return { state: "absent", reason: "no-decisions-section" };
  }
  return { state: "no-permit" };
}

/**
 * True when a permitting decision for `gate` exists. Prefer `readPermittingDecision`
 * when the absence reason must reach a report (A32.1).
 */
export function hasPermittingDecision(
  projectRoot: string,
  changeId: string,
  gate: GateId,
): boolean {
  return readPermittingDecision(projectRoot, changeId, gate).state === "permit";
}

/** Exported for tests — tags admitted as non-epoch ledger sections. */
export const LEDGER_NON_EPOCH_SECTIONS = LEDGER_BUNDLE_SECTIONS;

export type ApprovedArtifactName = "spec" | "plan";

export type ApprovedArtifactClassification =
  | { kind: "never-asked" }
  | { kind: "mismatch" }
  | { kind: "match" }
  | { kind: "unfingerprinted"; trackedChanged: boolean }
  | { kind: "git-unavailable"; absence: { verdict: "unable-to-determine"; reason: string } };

function applyingApproveDecision(
  decisions: GateDecisionRecord[],
  artifact: ApprovedArtifactName,
): GateDecisionRecord | undefined {
  const permits = decisions.filter((entry) => entry.gate === "approve" && entry.decision === "permit");
  const named = permits.filter((entry) => entry.artifact === "spec" || entry.artifact === "plan");
  if (named.length > 0) {
    const forFile = permits.filter((entry) => entry.artifact === artifact);
    return forFile.length > 0 ? forFile[forFile.length - 1] : undefined;
  }
  return permits.length > 0 ? permits[permits.length - 1] : undefined;
}

function readTrackedChangedFiles(projectRoot: string):
  | { kind: "ok"; tracked: Set<string> }
  | { kind: "unavailable" } {
  const statusResult = Bun.spawnSync({
    cmd: ["git", "-c", "status.relativePaths=true", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (statusResult.exitCode !== 0) return { kind: "unavailable" };
  const output = new TextDecoder().decode(statusResult.stdout);
  const records = output.split("\0");
  const tracked = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
    if (status === "??") continue;
    const filePath = record.slice(3).replaceAll("\\", "/").replace(/^\.\//, "");
    if (!filePath || filePath.startsWith("../") || filePath === ".." || path.posix.isAbsolute(filePath)) continue;
    tracked.add(filePath);
  }
  return { kind: "ok", tracked };
}

/**
 * Three-way classification of one approved spec or plan. Owns the porcelain read.
 * Callers pass no changed-file set.
 */
export function classifyApprovedArtifact(
  projectRoot: string,
  changeId: string,
  artifact: ApprovedArtifactName,
): ApprovedArtifactClassification {
  const listed = readGateDecisions(projectRoot, changeId);
  const decisions = listed.state === "ok" ? listed.decisions : [];
  const applying = applyingApproveDecision(decisions, artifact);
  if (!applying) return { kind: "never-asked" };
  const fingerprint = (applying.fingerprint ?? "").trim();
  if (fingerprint) {
    const filePath = path.join(
      resolveChangeBundle(projectRoot, changeId),
      artifact === "spec" ? "spec.xml" : "plan.xml",
    );
    const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    return digest === fingerprint ? { kind: "match" } : { kind: "mismatch" };
  }
  const porcelain = readTrackedChangedFiles(projectRoot);
  if (porcelain.kind === "unavailable") {
    return {
      kind: "git-unavailable",
      absence: { verdict: "unable-to-determine", reason: "git unavailable" },
    };
  }
  const bundlePath = path
    .relative(path.resolve(projectRoot), resolveChangeBundle(projectRoot, changeId))
    .replaceAll(path.sep, "/");
  const relative = `${bundlePath}/${artifact === "spec" ? "spec.xml" : "plan.xml"}`;
  return { kind: "unfingerprinted", trackedChanged: porcelain.tracked.has(relative) };
}

function rootOpeningTag(fileText: string): string | undefined {
  const end = fileText.indexOf(">");
  if (end < 0) return undefined;
  return fileText.slice(0, end + 1);
}

type CompactStatusAttribute = {
  quote: '"' | "'";
  value: string;
  start: number;
  end: number;
};

function locateCompactStatus(open: string, quote: '"' | "'"): CompactStatusAttribute | undefined {
  const key = `status=${quote}`;
  const start = open.indexOf(key);
  if (start < 0) return undefined;
  const from = start + key.length;
  const end = open.indexOf(quote, from);
  if (end < 0) return undefined;
  return { quote, value: open.slice(from, end), start, end };
}

function findCompactStatusAttribute(open: string): CompactStatusAttribute | undefined {
  const doubleQuoted = locateCompactStatus(open, '"');
  const singleQuoted = locateCompactStatus(open, "'");
  if (doubleQuoted && singleQuoted) {
    return doubleQuoted.start < singleQuoted.start ? doubleQuoted : singleQuoted;
  }
  return doubleQuoted ?? singleQuoted;
}

function rootStatusFromFile(filePath: string): string | undefined {
  const text = readFileSync(filePath, "utf8");
  const open = rootOpeningTag(text);
  if (!open) return undefined;
  return findCompactStatusAttribute(open)?.value;
}

function withOpeningTagStatus(text: string, to: string): string | undefined {
  const open = rootOpeningTag(text);
  if (!open) return undefined;
  const found = findCompactStatusAttribute(open);
  if (!found) return undefined;
  return `${open.slice(0, found.start)}status=${found.quote}${to}${found.quote}${open.slice(found.end + 1)}${text.slice(open.length)}`;
}

function writeDraftRootToApproved(filePath: string): void {
  const text = readFileSync(filePath, "utf8");
  const open = rootOpeningTag(text);
  const found = open ? findCompactStatusAttribute(open) : undefined;
  if (open && found && found.value === "draft") {
    const next = withOpeningTagStatus(text, "approved");
    if (next !== undefined) {
      writeFileSync(filePath, next);
      return;
    }
  }
  const parsed = parseGraceXmlArtifact(filePath, text);
  if (parsed.root?.attributes.status === "draft") {
    throw new GraceCommandError(
      "invalid-project",
      `Could not locate a compact opening-tag status attribute to write on ${filePath}; grammar parse reads status draft.`,
    );
  }
}

function changeLocationDir(projectRoot: string, location: "active" | "archive", changeId: string): string {
  return path.join(projectRoot, ARTIFACT_DIR, "changes", location, changeId);
}

function replacementIdsFromWrapper(wrapper: GraceXmlNode): string[] {
  return [...new Set(wrapper.children.flatMap((child) => {
    if (ANCHOR_PATTERNS.change.test(child.tag)) return [child.tag];
    if (
      (child.tag === "Replacement" || child.tag === "ReplacementChange")
      && ANCHOR_PATTERNS.change.test(child.text.trim())
    ) {
      return [child.text.trim()];
    }
    return [];
  }))];
}

function insertReplacementElement(text: string, wrapperTag: string, replacementId: string): string {
  const open = rootOpeningTag(text);
  if (!open) {
    throw new GraceCommandError("invalid-project", "Change artifact is missing a root opening tag.");
  }
  const rest = text.slice(open.length);
  const match = rest.match(new RegExp(`<${wrapperTag}\\b[^>]*>`));
  if (!match || match.index === undefined) {
    throw new GraceCommandError("invalid-project", `Could not locate wrapper opening tag ${wrapperTag}.`);
  }
  const at = open.length + match.index + match[0].length;
  return `${text.slice(0, at)}<Replacement>${replacementId}</Replacement>${text.slice(at)}`;
}

function nextSupersededArtifactBytes(filePath: string, replacementId: string): string {
  const text = readFileSync(filePath, "utf8");
  const parsed = parseGraceXmlArtifact(filePath, text);
  const status = parsed.root?.attributes.status;
  const wrapper = parsed.root?.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
  if (!wrapper) {
    throw new GraceCommandError("invalid-project", `Change artifact ${filePath} is missing a C-* wrapper.`);
  }
  let next = text;
  if (status === "draft" || status === "approved") {
    const swapped = withOpeningTagStatus(text, "superseded");
    if (swapped === undefined) {
      throw new GraceCommandError(
        "invalid-project",
        `Could not locate a compact opening-tag status attribute to write on ${filePath}; grammar parse reads status ${status}.`,
      );
    }
    next = swapped;
  } else if (status === "superseded") {
    next = text;
  } else {
    throw new GraceCommandError(
      "invalid-arguments",
      `Cannot supersede a ${status ?? "missing-status"} artifact at ${filePath}.`,
    );
  }
  const existing = replacementIdsFromWrapper(wrapper);
  if (existing.length === 0) {
    return insertReplacementElement(next, wrapper.tag, replacementId);
  }
  if (existing.length === 1 && existing[0] === replacementId) {
    return next;
  }
  throw new GraceCommandError(
    "invalid-arguments",
    `Existing replacement set on ${filePath} is not empty and is not exactly ${replacementId}.`,
  );
}

function isExdev(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EXDEV";
}

/**
 * Surgical superseded write, Replacement insert, and same-filesystem rename. Command-path only.
 *
 * The `io` bag exists solely to test the EXDEV refuse-after-rollback path: a cross-device rename
 * cannot be provoked through a spawned CLI, and chmod yields EACCES rather than EXDEV. It follows
 * the precedent of the injectFailure* hooks at grace-cursor.ts:1053 — unreachable from the CLI,
 * shipped with this module because the write surface is one file, and kept so the rollback
 * ordering stays mechanically testable without a second test-only package.
 */
export function supersedeChangeBundle(
  projectRoot: string,
  changeId: string,
  replacementId: string,
  io: { renameSync?: typeof renameSync } = {},
): void {
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change id '${changeId}' does not match the accepted pattern C- then uppercase kebab.`,
    );
  }
  if (!ANCHOR_PATTERNS.change.test(replacementId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Replacement id '${replacementId}' does not match the accepted pattern C- then uppercase kebab.`,
    );
  }
  if (replacementId === changeId) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Replacement ${replacementId} equals the change being superseded.`,
    );
  }
  const activeDir = changeLocationDir(projectRoot, "active", changeId);
  const archiveDir = changeLocationDir(projectRoot, "archive", changeId);
  const replacementActive = changeLocationDir(projectRoot, "active", replacementId);
  const replacementArchive = changeLocationDir(projectRoot, "archive", replacementId);
  if (!existsSync(replacementActive) && !existsSync(replacementArchive)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Replacement ${replacementId} is missing as a directory under active/ or archive/.`,
    );
  }
  if (existsSync(archiveDir) && !existsSync(activeDir)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change ${changeId} is already under archive/ and not under active/; supersede only moves an active bundle.`,
    );
  }
  if (!existsSync(activeDir) || !statSync(activeDir).isDirectory()) {
    throw new GraceCommandError(
      "not-found",
      `Change ${changeId} is not a directory under active/.`,
    );
  }
  if (existsSync(archiveDir)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Archive destination already exists for ${changeId}.`,
    );
  }
  const specPath = path.join(activeDir, "spec.xml");
  const planPath = path.join(activeDir, "plan.xml");
  if (!existsSync(specPath)) {
    throw new GraceCommandError("not-found", `spec.xml not found in ${changeId}.`);
  }
  const specBefore = readFileSync(specPath, "utf8");
  const planExists = existsSync(planPath);
  const planBefore = planExists ? readFileSync(planPath, "utf8") : undefined;
  const nextSpec = nextSupersededArtifactBytes(specPath, replacementId);
  const nextPlan = planExists ? nextSupersededArtifactBytes(planPath, replacementId) : undefined;
  let wroteSpec = false;
  let wrotePlan = false;
  try {
    if (nextSpec !== specBefore) {
      writeFileSync(specPath, nextSpec);
      wroteSpec = true;
    }
    if (planExists && nextPlan !== undefined && nextPlan !== planBefore) {
      writeFileSync(planPath, nextPlan);
      wrotePlan = true;
    }
    const archiveParent = path.dirname(archiveDir);
    if (!existsSync(archiveParent)) {
      mkdirSync(archiveParent, { recursive: true });
    }
    (io.renameSync ?? renameSync)(activeDir, archiveDir);
  } catch (error) {
    if (wrotePlan && planBefore !== undefined && existsSync(planPath)) {
      writeFileSync(planPath, planBefore);
    }
    if (wroteSpec && existsSync(specPath)) {
      writeFileSync(specPath, specBefore);
    }
    if (isExdev(error)) {
      throw new GraceCommandError(
        "invalid-project",
        `Cross-device rename (EXDEV) is refused after rollback for ${changeId}.`,
      );
    }
    if (error instanceof GraceCommandError) throw error;
    throw new GraceCommandError(
      "invalid-project",
      `Supersede failed after rollback: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

function selectApproveTarget(
  bundlePath: string,
  artifact?: ApprovedArtifactName,
): { artifact: ApprovedArtifactName; filePath: string } {
  const specPath = path.join(bundlePath, "spec.xml");
  const planPath = path.join(bundlePath, "plan.xml");
  if (artifact === "spec") {
    if (!existsSync(specPath)) {
      throw new GraceCommandError("not-found", "spec.xml not found in the change bundle.");
    }
    return { artifact: "spec", filePath: specPath };
  }
  if (artifact === "plan") {
    if (!existsSync(planPath)) {
      throw new GraceCommandError("not-found", "plan.xml not found in the change bundle.");
    }
    return { artifact: "plan", filePath: planPath };
  }
  const specExists = existsSync(specPath);
  const planExists = existsSync(planPath);
  const specStatus = specExists ? rootStatusFromFile(specPath) : undefined;
  const planStatus = planExists ? rootStatusFromFile(planPath) : undefined;
  if (specExists && specStatus !== "approved") {
    return { artifact: "spec", filePath: specPath };
  }
  if (planExists && planStatus !== "approved") {
    return { artifact: "plan", filePath: planPath };
  }
  if (planExists) {
    return { artifact: "plan", filePath: planPath };
  }
  return { artifact: "spec", filePath: specPath };
}

/** Surgical draft-to-approved write, then SHA-256 of the on-disk bytes. Command-path only. */
export function stampApproveArtifact(
  projectRoot: string,
  changeId: string,
  artifact?: ApprovedArtifactName,
): { artifact: ApprovedArtifactName; fingerprint: string } {
  const target = selectApproveTarget(resolveChangeBundle(projectRoot, changeId), artifact);
  writeDraftRootToApproved(target.filePath);
  return {
    artifact: target.artifact,
    fingerprint: createHash("sha256").update(readFileSync(target.filePath)).digest("hex"),
  };
}
