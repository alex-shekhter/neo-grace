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

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { validateRunLedgerArtifact } from "../artifact/grammar";
import { ARTIFACT_TAG_PREFIX, NGRACE_ARTIFACT_VERSION } from "../artifact/types";
import { readGraceXmlArtifact, type GraceXmlNode } from "../artifact/xml";
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

function cloneNode(node: GraceXmlNode): GraceXmlNode {
  return {
    tag: node.tag,
    attributes: { ...node.attributes },
    children: node.children.map(cloneNode),
    text: node.text,
  };
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
  return cloneNode(artifact.root);
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
    children: [],
    text: stored.note ?? "",
  });
  writeAndVerifyLedger(bundlePath, root);
  return stored;
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
  section.children.push({
    tag: "Decision",
    attributes: {
      gate: decision.gate,
      decision: decision.decision,
    },
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
  return {
    gate: gate as GateId,
    decision: decision as GateDecisionValue,
    requirements,
  };
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
