/**
 * Gate issue codes (D14). Must never be emitted by runLint — boundary test in
 * src/lint/core.test.ts. Codes are namespaced gate.* only.
 */

export type GateIssueSeverity = "error" | "warning";

export type GateIssueGuide = {
  code: string;
  title: string;
  explanation: string;
  remediation: string[];
  severity: GateIssueSeverity;
};

export const GATE_CATALOG: Record<string, GateIssueGuide> = {
  "gate.approve.clarification-unresolved": {
    code: "gate.approve.clarification-unresolved",
    title: "Unresolved Clarification Blocks Approve",
    explanation:
      "Plan approval requires contracts and invariants; an unresolved Clarification on an IC-* or INV-* "
      + "target means those fields have no trustworthy value (D12).",
    remediation: [
      "Resolve the Clarification (resolved=\"true\") after the answer is known.",
      "Or remove the hole once the contract/invariant is authored.",
    ],
    severity: "error",
  },
  "gate.apply.no-plan": {
    code: "gate.apply.no-plan",
    title: "Apply Requires A Plan",
    explanation:
      "applied without a plan was walked past as needs-plan for four review rounds (A17.2). "
      + "The apply gate refuses rather than advising.",
    remediation: ["Author plan.xml with $ngrace-plan before apply.", "Do not set status=applied on a spec-only bundle."],
    severity: "error",
  },
  "gate.apply.no-verdict": {
    code: "gate.apply.no-verdict",
    title: "Apply Requires A Recorded Review Verdict",
    explanation:
      "applied requires a recorded review verdict, not a clean one (D11). Absence of any verdict in the "
      + "ledger Verdicts section is not a pass.",
    remediation: [
      "Record a review verdict in run-ledger.xml Verdicts (Phase 6 produces content; Phase 5 records).",
      "unable-to-determine is a valid recorded verdict and permits apply when project policy allows.",
    ],
    severity: "error",
  },
  "gate.apply.verdict-host-capability": {
    code: "gate.apply.verdict-host-capability",
    title: "Review Verdict Absent For Host Capability",
    explanation:
      "A recorded verdict with reason host-capability-missing means the host could not produce a "
      + "detached review (D11). Whether that blocks is the project gateFailOn policy.",
    remediation: [
      "Run review on a host that supports detachment, or set gateFailOn to never if the project accepts the gap.",
      "Do not disguise host-capability-missing as pass.",
    ],
    severity: "error",
  },
  "gate.apply.clarification-unresolved": {
    code: "gate.apply.clarification-unresolved",
    title: "Unresolved Clarification On Satisfied AC",
    explanation:
      "An unresolved Clarification on an AC-* that a task Satisfies blocks apply (D12).",
    remediation: ["Resolve the clarification before apply.", "Or drop the Satisfies link if the criterion is out of scope."],
    severity: "error",
  },
  "gate.archive.open-epoch": {
    code: "gate.archive.open-epoch",
    title: "Archive Requires No Open Epoch",
    explanation:
      "Loose run/ events mean an open epoch. Archive precondition is no open epoch (D3, A10.10 §1). "
      + "Ledger Verdicts/Decisions are not open-epoch working set (A30.1).",
    remediation: ["Fold the open epoch with ngrace cursor fold before archive.", "Do not leave unterminated work in flight."],
    severity: "error",
  },
  "gate.attempt.escalated": {
    code: "gate.attempt.escalated",
    title: "Further Attempts Refused On Escalated Task",
    explanation:
      "A task in escalatedTasks owes a replan decision. Further attempts are refused until resume "
      + "resolves the escalation (A21.1 / A22.3).",
    remediation: [
      "Resolve with ngrace cursor resume after the replan decision.",
      "Do not continue fixing past the budget without approval.",
    ],
    severity: "error",
  },
};

/** True when a code is a gate.* code (for D14 boundary assertions). */
export function isGateIssueCode(code: string): boolean {
  return code.startsWith("gate.");
}

/** Every registered gate.* code — used by tests to prove the catalog is the only home. */
export function allGateCodes(): string[] {
  return Object.keys(GATE_CATALOG).sort();
}
