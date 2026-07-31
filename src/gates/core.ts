/**
 * Transition gate evaluation (D5 gate half, D11, D12, D14).
 * Blocking is a property of the gate; mechanisms report (anti-pattern 9).
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { ANCHOR_PATTERNS } from "../artifact/types";
import { readGraceXmlArtifact, walkNodes } from "../artifact/xml";
import {
  listLooseEvents,
  listUnresolvedEscalatedTasks,
  listAccountingEvents,
  resolveChangeBundle,
} from "../grace-cursor";
import { loadGraceLintConfig } from "../lint/config";
import type { GateFailOn } from "../lint/types";
import { GATE_CATALOG, type GateIssueGuide } from "./catalog";
import {
  readPermittingDecision,
  readLatestReviewVerdict,
  type GateDecisionRecord,
  type GateId,
  type GateRequirementRecord,
  type ReviewVerdictRecord,
} from "./ledger";

export type GateIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  title?: string;
  explanation?: string;
  remediation?: string[];
};

export type GateEvaluation = {
  gate: GateId | "attempt";
  changeId: string;
  decision: "permit" | "refuse";
  requirements: GateRequirementRecord[];
  issues: GateIssue[];
  /** Latest verdict when relevant (apply) and readable. */
  verdict?: ReviewVerdictRecord;
  /** Set when the evaluation succeeded but appending the Decision failed (A31.5). */
  recordingError?: string;
};

function guideIssue(code: keyof typeof GATE_CATALOG, detail?: string): GateIssue {
  const guide: GateIssueGuide = GATE_CATALOG[code]!;
  return {
    severity: guide.severity,
    code: guide.code,
    title: guide.title,
    explanation: guide.explanation,
    remediation: guide.remediation,
    message: detail ? `${guide.title}: ${detail}` : guide.title,
  };
}

function requirement(
  id: string,
  required: boolean,
  present: boolean,
  message?: string,
): GateRequirementRecord {
  const blocking = required && !present;
  return { id, required, present, blocking, message };
}

/** Project gateFailOn; default errors (missing verdict fatal) aligned with D11 honesty. */
export function resolveProjectGateFailOn(projectRoot: string): GateFailOn {
  const { config } = loadGraceLintConfig(projectRoot);
  const value = config?.gateFailOn;
  if (value === "never" || value === "warnings" || value === "errors") return value;
  return "errors";
}

type ClarificationHit = {
  target: string;
  resolved: boolean;
  file: string;
};

function isClarificationTarget(target: string): boolean {
  return (
    ANCHOR_PATTERNS.interfaceContract.test(target)
    || ANCHOR_PATTERNS.invariant.test(target)
    || ANCHOR_PATTERNS.acceptanceCriterion.test(target)
  );
}

function listClarifications(file: string): ClarificationHit[] {
  if (!existsSync(file)) return [];
  const artifact = readGraceXmlArtifact(file);
  if (!artifact.root) return [];
  const hits: ClarificationHit[] = [];
  for (const node of walkNodes(artifact.root)) {
    if (node.tag !== "Clarification") continue;
    const target = (node.attributes.target ?? "").trim();
    if (!target) continue;
    const resolved =
      node.attributes.resolved === "true"
      || node.attributes.status === "resolved";
    hits.push({ target, resolved, file });
  }
  return hits;
}

function bundleClarifications(bundlePath: string): ClarificationHit[] {
  return [
    ...listClarifications(path.join(bundlePath, "spec.xml")),
    ...listClarifications(path.join(bundlePath, "plan.xml")),
  ];
}

function planSatisfiedAcceptanceCriteria(bundlePath: string): Set<string> {
  const planFile = path.join(bundlePath, "plan.xml");
  if (!existsSync(planFile)) return new Set();
  const artifact = readGraceXmlArtifact(planFile);
  if (!artifact.root) return new Set();
  const ids = new Set<string>();
  for (const node of walkNodes(artifact.root)) {
    if (node.tag !== "Satisfies") continue;
    for (const child of node.children) {
      if (ANCHOR_PATTERNS.acceptanceCriterion.test(child.tag)) ids.add(child.tag);
    }
  }
  return ids;
}

/** Plan status the way status derives it (grace-status readRootStatus) — A31.3. */
function readPlanStatus(bundlePath: string): string | undefined {
  const planFile = path.join(bundlePath, "plan.xml");
  if (!existsSync(planFile)) return undefined;
  const artifact = readGraceXmlArtifact(planFile);
  return artifact.root?.attributes.status;
}

/**
 * Pure attempt gate: refuse when task is in escalatedTasks (A21.1 / A22.3).
 * No grace-cursor IO — caller supplies the set (anti-pattern 9 / no import cycle).
 */
export function evaluateAttemptGate(
  changeId: string,
  task: string,
  escalatedTasks: readonly string[],
): GateEvaluation {
  const requirements: GateRequirementRecord[] = [];
  const issues: GateIssue[] = [];
  const free = !escalatedTasks.includes(task);
  requirements.push(
    requirement(
      "task-not-escalated",
      true,
      free,
      free ? undefined : `task ${task} is in escalatedTasks: ${escalatedTasks.join(", ")}`,
    ),
  );
  if (!free) {
    issues.push(guideIssue("gate.attempt.escalated", task));
  }
  return {
    gate: "attempt",
    changeId,
    decision: issues.some((i) => i.severity === "error") ? "refuse" : "permit",
    requirements,
    issues,
  };
}

export function evaluateApproveGate(projectRoot: string, changeId: string): GateEvaluation {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const clarifications = bundleClarifications(bundlePath);
  const unresolvedIcInv = clarifications.filter(
    (c) =>
      !c.resolved
      && (ANCHOR_PATTERNS.interfaceContract.test(c.target) || ANCHOR_PATTERNS.invariant.test(c.target)),
  );
  const requirements: GateRequirementRecord[] = [];
  const issues: GateIssue[] = [];

  const present = unresolvedIcInv.length === 0;
  requirements.push(
    requirement(
      "no-unresolved-ic-inv-clarification",
      true,
      present,
      present
        ? undefined
        : unresolvedIcInv.map((c) => `${c.target} (${c.file})`).join("; "),
    ),
  );
  if (!present) {
    issues.push(
      guideIssue(
        "gate.approve.clarification-unresolved",
        unresolvedIcInv.map((c) => c.target).join(", "),
      ),
    );
  }

  // Assumptions are never requirements (D12) — no check added.

  return {
    gate: "approve",
    changeId,
    decision: issues.some((i) => i.severity === "error") ? "refuse" : "permit",
    requirements,
    issues,
  };
}

export function evaluateApplyGate(projectRoot: string, changeId: string): GateEvaluation {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const requirements: GateRequirementRecord[] = [];
  const issues: GateIssue[] = [];
  const failOn = resolveProjectGateFailOn(projectRoot);

  // A31.3: consume planStatus the way status does; require approved (not existsSync).
  const planStatus = readPlanStatus(bundlePath);
  const planApproved = planStatus === "approved";
  requirements.push(
    requirement(
      "plan-present",
      true,
      planApproved,
      planStatus === undefined
        ? "plan.xml missing"
        : planApproved
          ? `status=${planStatus}`
          : `status=${planStatus} (required approved)`,
    ),
  );
  if (!planApproved) {
    issues.push(
      guideIssue(
        "gate.apply.no-plan",
        planStatus === undefined
          ? "plan.xml missing"
          : `plan status=${planStatus}; apply requires approved`,
      ),
    );
  }

  // A31.2: newest entry governs; unreadable newest is absence with ledger.invalid-verdict.
  const latest = readLatestReviewVerdict(projectRoot, changeId);
  let verdict: ReviewVerdictRecord | undefined;
  if (latest.state === "absent") {
    requirements.push(
      requirement("review-verdict", true, false, "no Verdicts section entry"),
    );
    issues.push(guideIssue("gate.apply.no-verdict"));
  } else if (latest.state === "invalid") {
    requirements.push(
      requirement(
        "review-verdict",
        true,
        false,
        `${latest.code}: newest entry unreadable (${latest.detail})`,
      ),
    );
    issues.push(
      guideIssue(
        "gate.apply.invalid-verdict",
        `${latest.code}: ${latest.detail}`,
      ),
    );
  } else {
    verdict = latest.verdict;
    requirements.push(
      requirement(
        "review-verdict",
        true,
        true,
        `outcome=${verdict.outcome}${verdict.reason ? ` reason=${verdict.reason}` : ""}`,
      ),
    );
    if (verdict.reason === "host-capability-missing") {
      // Verdict exists (D11 satisfied as a record); whether host-capability absence blocks is project policy.
      const blocks = failOn === "errors";
      requirements.push(
        requirement(
          "host-capability",
          blocks,
          !blocks,
          `reason=host-capability-missing gateFailOn=${failOn}`,
        ),
      );
      if (failOn === "errors") {
        issues.push(guideIssue("gate.apply.verdict-host-capability", `gateFailOn=${failOn}`));
      } else if (failOn === "warnings") {
        const warn = guideIssue("gate.apply.verdict-host-capability", `gateFailOn=${failOn}`);
        issues.push({ ...warn, severity: "warning" });
      }
    }
  }

  const satisfied = planSatisfiedAcceptanceCriteria(bundlePath);
  const unresolvedAc = bundleClarifications(bundlePath).filter(
    (c) => !c.resolved && ANCHOR_PATTERNS.acceptanceCriterion.test(c.target) && satisfied.has(c.target),
  );
  const acOk = unresolvedAc.length === 0;
  requirements.push(
    requirement(
      "no-unresolved-satisfied-ac-clarification",
      true,
      acOk,
      acOk ? undefined : unresolvedAc.map((c) => c.target).join(", "),
    ),
  );
  if (!acOk) {
    issues.push(
      guideIssue("gate.apply.clarification-unresolved", unresolvedAc.map((c) => c.target).join(", ")),
    );
  }

  return {
    gate: "apply",
    changeId,
    decision: issues.some((i) => i.severity === "error") ? "refuse" : "permit",
    requirements,
    issues,
    verdict,
  };
}

export function evaluateArchiveGate(projectRoot: string, changeId: string): GateEvaluation {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const loose = listLooseEvents(bundlePath);
  const open = loose.length > 0;
  const requirements: GateRequirementRecord[] = [];
  const issues: GateIssue[] = [];

  requirements.push(
    requirement(
      "no-open-epoch",
      true,
      !open,
      open ? `${loose.length} loose run/ event(s)` : "run/ empty",
    ),
  );
  if (open) {
    issues.push(guideIssue("gate.archive.open-epoch", `${loose.length} loose file(s)`));
  }

  return {
    gate: "archive",
    changeId,
    decision: issues.some((i) => i.severity === "error") ? "refuse" : "permit",
    requirements,
    issues,
  };
}

export function evaluateGate(
  projectRoot: string,
  changeId: string,
  gate: GateId,
): GateEvaluation {
  if (gate === "approve") return evaluateApproveGate(projectRoot, changeId);
  if (gate === "apply") return evaluateApplyGate(projectRoot, changeId);
  return evaluateArchiveGate(projectRoot, changeId);
}

/** Map evaluation to a durable decision record. */
export function evaluationToDecision(evaluation: GateEvaluation): GateDecisionRecord | null {
  if (evaluation.gate === "attempt") return null;
  return {
    gate: evaluation.gate,
    decision: evaluation.decision,
    requirements: evaluation.requirements,
  };
}

/**
 * Evaluate escalated-task attempt refusal using the durable stream (A21.1).
 * Used by cursor attempt CLI / recordAttempt.
 */
export function evaluateAttemptOnBundle(
  projectRoot: string,
  changeId: string,
  task: string,
): GateEvaluation {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const escalated = listUnresolvedEscalatedTasks(listAccountingEvents(bundlePath));
  return evaluateAttemptGate(changeId, task, escalated);
}

/** Status helper: applied archive without a permitting apply decision (A29.9 / A32.1). */
export function missingApplyGateRecord(projectRoot: string, changeId: string): boolean {
  return readPermittingDecision(projectRoot, changeId, "apply").state !== "permit";
}

/** Re-export clarification target check for grammar tests. */
export { isClarificationTarget };
