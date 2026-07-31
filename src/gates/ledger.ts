/**
 * Bundle-scoped Verdicts and Decisions on run-ledger.xml (A30.2).
 * Siblings to Epoch-N; never loose run/ events (correction 61).
 * Write path: write, re-read, verify (D3 ordering; nothing to delete).
 */

import { existsSync, writeFileSync } from "node:fs";
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

const LEDGER_BUNDLE_SECTIONS = new Set(["Verdicts", "Decisions"]);

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

function writeAndVerifyLedger(bundlePath: string, root: GraceXmlNode): void {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  writeFileSync(ledgerPath, serializeGraceXmlDocument(root));
  const reRead = readGraceXmlArtifact(ledgerPath);
  const validation = validateRunLedgerArtifact(reRead);
  const errors = validation.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new GraceCommandError(
      "invalid-project",
      `run-ledger.xml failed verification after write: ${errors.map((e) => e.code).join(", ")}`,
      { issues: errors.map((e) => e.code) },
    );
  }
}

/** Append a review verdict to the ledger Verdicts section (A30.2). Leaves run/ untouched. */
export function recordReviewVerdict(
  projectRoot: string,
  changeId: string,
  verdict: ReviewVerdictRecord,
): ReviewVerdictRecord {
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

/** All recorded review verdicts (oldest first). Empty when section absent — not a pass (D5). */
export function listReviewVerdicts(projectRoot: string, changeId: string): ReviewVerdictRecord[] {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const wrapper = wrapperFromLedger(bundlePath, changeId);
  if (!wrapper) return [];
  const section = wrapper.children.find((child) => child.tag === "Verdicts");
  if (!section) return [];
  const out: ReviewVerdictRecord[] = [];
  for (const child of section.children) {
    if (child.tag !== "Verdict") continue;
    const outcome = child.attributes.outcome as ReviewVerdictOutcome | undefined;
    if (outcome !== "pass" && outcome !== "fail" && outcome !== "unable-to-determine") continue;
    out.push({
      outcome,
      reason: child.attributes.reason || undefined,
      note: child.text.trim() || undefined,
    });
  }
  return out;
}

/** Latest review verdict, if any. */
export function latestReviewVerdict(
  projectRoot: string,
  changeId: string,
): ReviewVerdictRecord | undefined {
  const all = listReviewVerdicts(projectRoot, changeId);
  return all[all.length - 1];
}

/** All recorded gate decisions (oldest first). */
export function listGateDecisions(projectRoot: string, changeId: string): GateDecisionRecord[] {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const wrapper = wrapperFromLedger(bundlePath, changeId);
  if (!wrapper) return [];
  const section = wrapper.children.find((child) => child.tag === "Decisions");
  if (!section) return [];
  const out: GateDecisionRecord[] = [];
  for (const child of section.children) {
    if (child.tag !== "Decision") continue;
    const gate = child.attributes.gate as GateId | undefined;
    const decision = child.attributes.decision as GateDecisionValue | undefined;
    if (
      (gate !== "approve" && gate !== "apply" && gate !== "archive")
      || (decision !== "permit" && decision !== "refuse")
    ) {
      continue;
    }
    const requirements: GateRequirementRecord[] = child.children
      .filter((req) => req.tag === "Requirement")
      .map((req) => ({
        id: req.attributes.id ?? "",
        required: req.attributes.required === "true",
        present: req.attributes.present === "true",
        blocking: req.attributes.blocking === "true",
        message: req.text.trim() || undefined,
      }));
    out.push({ gate, decision, requirements });
  }
  return out;
}

/** True when a permitting decision for `gate` exists in the durable Decisions section. */
export function hasPermittingDecision(
  projectRoot: string,
  changeId: string,
  gate: GateId,
): boolean {
  return listGateDecisions(projectRoot, changeId).some(
    (entry) => entry.gate === gate && entry.decision === "permit",
  );
}

/** Exported for tests — tags admitted as non-epoch ledger sections. */
export const LEDGER_NON_EPOCH_SECTIONS = LEDGER_BUNDLE_SECTIONS;
