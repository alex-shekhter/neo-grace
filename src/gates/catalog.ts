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
//   GATE_CATALOG
//   GateIssueGuide
//   GateIssueSeverity
//   allGateCodes
//   isGateIssueCode
// END_MODULE_MAP
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
    title: "Apply Requires An Approved Plan",
    explanation:
      "applied without a plan was walked past as needs-plan for four review rounds (A17.2). "
      + "The apply gate requires plan.xml with status=approved — the same planStatus status derives "
      + "(A31.3). A draft is not enough.",
    remediation: [
      "Author plan.xml with $ngrace-plan and approve it before apply.",
      "Do not set status=applied on a draft or spec-only bundle.",
    ],
    severity: "error",
  },
  "gate.apply.no-verdict": {
    code: "gate.apply.no-verdict",
    title: "Apply Requires A Recorded Review Verdict",
    explanation:
      "applied requires a recorded review verdict, not a clean one (D11). Absence of any verdict in the "
      + "ledger Verdicts section is not a pass.",
    remediation: [
      "Record with `ngrace gate verdict --change C-ID --outcome pass|fail|unable-to-determine` (A31.1).",
      "unable-to-determine is a valid recorded verdict and permits apply when project policy allows.",
    ],
    severity: "error",
  },
  "gate.apply.unbound-pass": {
    code: "gate.apply.unbound-pass",
    title: "Apply Refuses An Unbound Pass Verdict",
    explanation:
      "outcome pass must carry snapshotDigest bound to the persisted Finding children. A pass with no digest is not a review that ran.",
    remediation: [
      "Record pass through `ngrace gate verdict` so runReview supplies snapshotDigest.",
      "Do not hand-write a pass Verdict without a digest, including the empty-set digest.",
    ],
    severity: "error",
  },
  "gate.apply.digest-mismatch": {
    code: "gate.apply.digest-mismatch",
    title: "Apply Refuses A Verdict Whose Digest Does Not Match Findings",
    explanation:
      "snapshotDigest must equal the canonical SHA-256 of changeId plus Finding children sorted by code, file, and findingId. Apply reads persisted children and does not re-run review.",
    remediation: [
      "Re-record the verdict with `ngrace gate verdict` instead of editing Finding children or snapshotDigest by hand.",
    ],
    severity: "error",
  },
  "gate.apply.ack-mismatch": {
    code: "gate.apply.ack-mismatch",
    title: "Apply Refuses A Pass Whose Acks Do Not Match Persisted Findings",
    explanation:
      "outcome pass requires Ack children one-for-one with persisted findingIds, each carrying the Verdict snapshotDigest. A review.* finding about the work, including write-evidence-outside-scope, is acknowledgeable.",
    remediation: [
      "Pass `--ack-finding` once per displayed findingId from `ngrace review --change`.",
      "Do not author an ObservedWriteScope exception list.",
    ],
    severity: "error",
  },
  "gate.apply.outcome-fail": {
    code: "gate.apply.outcome-fail",
    title: "Apply Refuses A Fail Verdict",
    explanation:
      "A recorded outcome fail is the human reject. Presence of a verdict remains required; fail is not a permitting close. Switch to ngrace supersede.",
    remediation: [
      "Record outcome pass with matching `--ack-finding` flags if the work should close.",
      "Or run `ngrace supersede` when the reject stands.",
    ],
    severity: "error",
  },
  "gate.apply.invalid-verdict": {
    code: "gate.apply.invalid-verdict",
    title: "Newest Review Verdict Is Unreadable",
    explanation:
      "The newest <Verdict> entry governs; an unreadable newest entry is an absence with reason "
      + "ledger.invalid-verdict, never a fallthrough to an older valid entry (A31.2).",
    remediation: [
      "Fix or remove the malformed newest <Verdict> (outcome must be pass|fail|unable-to-determine).",
      "Re-record with `ngrace gate verdict --change C-ID --outcome …`.",
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
