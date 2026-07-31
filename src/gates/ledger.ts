/**
 * Bundle-scoped Verdicts and Decisions on run-ledger.xml (A30.2).
 * Siblings to Epoch-N; never loose run/ events (correction 61).
 * Write path: validate constructed tree, write, re-read, verify, restore on failure (A31.5).
 * Read path: newest entry governs; unreadable is absence with reason, never skip (A31.2).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { validateRunLedgerArtifact } from "../artifact/grammar";
import { ARTIFACT_TAG_PREFIX, NGRACE_ARTIFACT_VERSION } from "../artifact/types";
import { readGraceXmlArtifact, type GraceXmlNode } from "../artifact/xml";
import { serializeGraceXmlDocument } from "../artifact/xml-serialize";
import { resolveChangeBundle } from "../grace-cursor";
import { GraceCommandError } from "../query/errors";

export type ReviewVerdictOutcome = "pass" | "fail" | "unable-to-determine";

export type ReviewVerdictRecord = {
  outcome: ReviewVerdictOutcome;
  /** D5 reason when outcome is an absence (e.g. host-capability-missing). */
  reason?: string;
  /** Optional free text. */
  note?: string;
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
  | { state: "invalid"; code: "ledger.invalid-verdict"; detail: string }
  | { state: "present"; verdict: ReviewVerdictRecord };

/** Newest-governs scan of Decisions; any unreadable entry is invalid, never skipped (A31.2). */
export type DecisionListResult =
  | { state: "ok"; decisions: GateDecisionRecord[] }
  | { state: "invalid"; code: "ledger.invalid-decision"; detail: string };

const LEDGER_BUNDLE_SECTIONS = new Set(["Verdicts", "Decisions"]);

const VALID_OUTCOMES = new Set<string>(["pass", "fail", "unable-to-determine"]);
const VALID_GATES = new Set<string>(["approve", "apply", "archive"]);
const VALID_DECISIONS = new Set<string>(["permit", "refuse"]);

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
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const root = loadOrCreateLedgerRoot(bundlePath, changeId);
  const wrapper = ensureWrapper(root, changeId);
  const section = ensureSection(wrapper, "Verdicts");
  const attributes: Record<string, string> = { outcome: verdict.outcome };
  if (verdict.reason) attributes.reason = verdict.reason;
  section.children.push({
    tag: "Verdict",
    attributes,
    children: [],
    text: verdict.note ?? "",
  });
  writeAndVerifyLedger(bundlePath, root);
  return verdict;
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

function wrapperFromLedger(bundlePath: string, changeId: string): GraceXmlNode | null {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return null;
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return null;
  return artifact.root.children.find((child) => child.tag === changeId) ?? null;
}

function parseVerdictNode(child: GraceXmlNode): ReviewVerdictRecord | { invalid: string } {
  const outcome = child.attributes.outcome;
  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    return { invalid: `outcome=${outcome ?? "(missing)"}` };
  }
  return {
    outcome: outcome as ReviewVerdictOutcome,
    reason: child.attributes.reason || undefined,
    note: child.text.trim() || undefined,
  };
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
 * Newest Verdict entry governs (A31.2). An unreadable newest entry is
 * `{ state: "invalid" }` — never a silent fallthrough to an older valid entry.
 */
export function readLatestReviewVerdict(projectRoot: string, changeId: string): LatestReviewVerdict {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const wrapper = wrapperFromLedger(bundlePath, changeId);
  if (!wrapper) return { state: "absent" };
  const section = wrapper.children.find((child) => child.tag === "Verdicts");
  if (!section) return { state: "absent" };
  const verdictNodes = section.children.filter((child) => child.tag === "Verdict");
  if (verdictNodes.length === 0) return { state: "absent" };
  const newest = verdictNodes[verdictNodes.length - 1]!;
  const parsed = parseVerdictNode(newest);
  if ("invalid" in parsed) {
    return {
      state: "invalid",
      code: "ledger.invalid-verdict",
      detail: parsed.invalid,
    };
  }
  return { state: "present", verdict: parsed };
}

/**
 * All recorded review verdicts (oldest first). Throws when any entry is unreadable
 * so callers cannot convert an absence into a shorter valid list (A31.2).
 */
export function listReviewVerdicts(projectRoot: string, changeId: string): ReviewVerdictRecord[] {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const wrapper = wrapperFromLedger(bundlePath, changeId);
  if (!wrapper) return [];
  const section = wrapper.children.find((child) => child.tag === "Verdicts");
  if (!section) return [];
  const out: ReviewVerdictRecord[] = [];
  for (const child of section.children) {
    if (child.tag !== "Verdict") {
      throw new GraceCommandError(
        "invalid-project",
        `ledger.invalid-verdict: unexpected <${child.tag}> under Verdicts`,
        { issues: ["ledger.invalid-verdict"] },
      );
    }
    const parsed = parseVerdictNode(child);
    if ("invalid" in parsed) {
      throw new GraceCommandError(
        "invalid-project",
        `ledger.invalid-verdict: ${parsed.invalid}`,
        { issues: ["ledger.invalid-verdict"] },
      );
    }
    out.push(parsed);
  }
  return out;
}

/** @deprecated Prefer readLatestReviewVerdict — this collapses invalid to undefined. */
export function latestReviewVerdict(
  projectRoot: string,
  changeId: string,
): ReviewVerdictRecord | undefined {
  const read = readLatestReviewVerdict(projectRoot, changeId);
  return read.state === "present" ? read.verdict : undefined;
}

/** All recorded gate decisions with no silent skip of unreadable entries (A31.2). */
export function readGateDecisions(projectRoot: string, changeId: string): DecisionListResult {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const wrapper = wrapperFromLedger(bundlePath, changeId);
  if (!wrapper) return { state: "ok", decisions: [] };
  const section = wrapper.children.find((child) => child.tag === "Decisions");
  if (!section) return { state: "ok", decisions: [] };
  const out: GateDecisionRecord[] = [];
  for (const child of section.children) {
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
  return { state: "ok", decisions: out };
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
 * True when a permitting decision for `gate` exists. An unreadable Decisions
 * section is not a permit (absence with reason, never a promoted older value).
 */
export function hasPermittingDecision(
  projectRoot: string,
  changeId: string,
  gate: GateId,
): boolean {
  const result = readGateDecisions(projectRoot, changeId);
  if (result.state === "invalid") return false;
  return result.decisions.some(
    (entry) => entry.gate === gate && entry.decision === "permit",
  );
}

/** Exported for tests — tags admitted as non-epoch ledger sections. */
export const LEDGER_NON_EPOCH_SECTIONS = LEDGER_BUNDLE_SECTIONS;
