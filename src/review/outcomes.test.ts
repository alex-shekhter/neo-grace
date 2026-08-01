import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "../artifact/paths";
import { recordReviewVerdict } from "../gates/ledger";
import {
  PLAN_QUALITY_PROXY_CAVEAT,
  collectPlanQualityReport,
  computeConstituentTasksPassed,
  formatPlanQualityText,
  proposeResolutionClassification,
} from "./outcomes";

function createRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-plan-quality-"));
}

function writeFile(root: string, rel: string, contents: string) {
  const filePath = path.join(root, rel);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeMinimalProject(root: string) {
  writeFile(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements graceVersion="1.0"><Summary>Required.</Summary></NgraceRequirements>`);
  writeFile(root, `${ARTIFACT_DIR}/context/technology.xml`, `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`);
  writeFile(root, `${ARTIFACT_DIR}/context/principles.xml`, `<NgracePrinciples graceVersion="1.0"><Principle>Safe.</Principle></NgracePrinciples>`);
  writeFile(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<NgraceDeployment graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>CLI.</Reason></NgraceDeployment>`);
  writeFile(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<NgraceUXGuidelines graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>CLI.</Reason></NgraceUXGuidelines>`);
  writeFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
  );
  writeFile(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
  );
  writeFile(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
  );
  writeFile(
    root,
    `${ARTIFACT_DIR}/verification/main.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario><TraceAssertion>n/a</TraceAssertion></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
  );
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });
  writeFile(
    root,
    "src/example.ts",
    `// START_MODULE_CONTRACT
// PURPOSE: Example.
// SCOPE: Test.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// run - Run.
// END_MODULE_MAP
export function run() { return 1; }
`,
  );
}

function writeBundle(root: string, changeId: string, status = "approved") {
  const base = `${ARTIFACT_DIR}/changes/active/${changeId}`;
  writeFile(
    root,
    `${base}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="${status}"><${changeId}><Summary>Test.</Summary><AcceptanceCriteria><AC-ONE>one</AC-ONE></AcceptanceCriteria></${changeId}></NgraceChangeSpec>`,
  );
  writeFile(
    root,
    `${base}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="${status}"><${changeId}><IntentSummary>Test.</IntentSummary><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>One</Title><DependsOn></DependsOn><Satisfies><AC-ONE /></Satisfies><AcceptanceCriteria><Criterion>done</Criterion></AcceptanceCriteria></T-001></ImplementationPlan></${changeId}></NgraceChangePlan>`,
  );
}

describe("plan-quality report (D10 / Phase 10)", () => {
  it("N=0 empty project: honest empty sentence, no rate table, caveat present", () => {
    const root = createRoot();
    writeMinimalProject(root);
    const report = collectPlanQualityReport(root);
    expect(report.verdictsTotal).toBe(0);
    expect(report.scoped).toBe(0);
    expect(report.summary).toContain("0 review verdicts with recorded scope");
    expect(report.summary).toContain("No plan-quality rate is computed");
    expect(report.summary).not.toContain("0% plan defects");
    expect(report.summary).not.toContain("plan quality: OK");
    expect(report.proxyCaveat).toBe(PLAN_QUALITY_PROXY_CAVEAT);
    const text = formatPlanQualityText(report);
    expect(text).toContain(PLAN_QUALITY_PROXY_CAVEAT);
    // Caveat adjacent: appears in summary and as its own count line.
    expect(text.indexOf("Plan quality")).toBeLessThan(text.indexOf(PLAN_QUALITY_PROXY_CAVEAT));
  });

  it("unscoped historical verdicts are scope-not-recorded, never retro-labelled bundle (corr 182)", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-UNSCOPED");
    // Write without scope — the failure mode is inventing bundle because it "looks" bundle-shaped.
    recordReviewVerdict(root, "C-UNSCOPED", { outcome: "pass", note: "looks like a bundle close" });
    const report = collectPlanQualityReport(root);
    expect(report.verdictsTotal).toBe(1);
    expect(report.scopeNotRecorded).toBe(1);
    expect(report.scoped).toBe(0);
    expect(report.byScope.bundle).toBe(0);
    expect(report.rows[0]?.scopeStatus).toBe("scope-not-recorded");
    expect(report.rows[0]?.scope).toBeUndefined();
    // Discriminating negative: report must not invent scope=bundle for unscoped history.
    expect(report.summary).toContain("scope-not-recorded");
    expect(report.summary).not.toMatch(/bundle=1/);
  });

  it("task and wave scoped outcomes are counted separately and never pooled into one rate", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-SCOPED");
    recordReviewVerdict(root, "C-SCOPED", {
      outcome: "fail",
      scope: "task",
      task: "T-001",
      classification: "implementation",
    });
    recordReviewVerdict(root, "C-SCOPED", {
      outcome: "fail",
      scope: "wave",
      wave: "1",
      classification: "plan",
      constituentTasksPassed: true,
    });
    const report = collectPlanQualityReport(root);
    expect(report.byScope.task).toBe(1);
    expect(report.byScope.wave).toBe(1);
    expect(report.scoped).toBe(2);
    expect(report.classifications.implementation).toBe(1);
    expect(report.classifications.plan).toBe(1);
    expect(report.decompositionCandidates).toBe(1);
    // No single unlabeled "fail rate" field that pools scopes.
    expect((report as { failRate?: number }).failRate).toBeUndefined();
    expect(report.summary).toContain("task=1");
    expect(report.summary).toContain("wave=1");
    expect(report.summary).toContain("not pooled");
  });

  it("decomposition requires stored precondition true; false and unknown are not candidates", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-DECOMP");
    recordReviewVerdict(root, "C-DECOMP", {
      outcome: "fail",
      scope: "wave",
      wave: "1",
      constituentTasksPassed: false,
    });
    recordReviewVerdict(root, "C-DECOMP", {
      outcome: "fail",
      scope: "wave",
      wave: "2",
      constituentTasksPassedReason: "tasks-unverifiable",
    });
    const report = collectPlanQualityReport(root);
    expect(report.decompositionCandidates).toBe(0);
    expect(report.rows.every((r) => !r.isDecompositionCandidate)).toBe(true);
  });

  it("classification is read from stored attribute, not recomputed as sole truth", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-CLASS");
    // Explicit code-only assertion stored — not proposed by helper.
    recordReviewVerdict(root, "C-CLASS", {
      outcome: "fail",
      scope: "bundle",
      classification: "implementation",
    });
    const report = collectPlanQualityReport(root);
    expect(report.rows[0]?.classification).toBe("implementation");
    expect(report.rows[0]?.classificationStatus).toBe("stored");
    // Helper does not silently propose implementation.
    const proposal = proposeResolutionClassification(root, "C-CLASS");
    expect(proposal.proposal).toBe("unknown");
  });

  it("proposeResolutionClassification proposes plan only from supersede + Replacement", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-OLD", "superseded");
    writeFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-OLD/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-OLD><Replacement>C-NEW</Replacement><Summary>Old.</Summary><AcceptanceCriteria><AC-ONE>one</AC-ONE></AcceptanceCriteria></C-OLD></NgraceChangeSpec>`,
    );
    // Replacement target must exist for grammar; report proposal only needs the status+Replacement text.
    writeBundle(root, "C-NEW", "draft");
    const proposal = proposeResolutionClassification(root, "C-OLD");
    expect(proposal).toEqual({
      proposal: "plan",
      evidence: "superseded",
      replacement: "C-NEW",
    });
  });

  it("computeConstituentTasksPassed: all pass → true; one fail → false; missing wave → unknown", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-WAVE");
    writeFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-WAVE/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-WAVE>` +
        `<Epoch-1 wave="w1">` +
        `<Allocation worker="w0" from="1" to="99" />` +
        `<Event id="1" task="T-001" kind="opened"><Allocation worker="w0" from="1" to="99" /></Event>` +
        `<Event id="2" task="T-001" kind="attempt" outcome="pass" />` +
        `<Event id="3" task="T-001" kind="terminal" />` +
        `<Event id="4" task="T-002" kind="attempt" outcome="pass" />` +
        `<Event id="5" task="T-002" kind="terminal" />` +
        `</Epoch-1>` +
        `<Epoch-2 wave="w2">` +
        `<Allocation worker="w0" from="100" to="199" />` +
        `<Event id="100" task="T-001" kind="opened"><Allocation worker="w0" from="100" to="199" /></Event>` +
        `<Event id="101" task="T-001" kind="attempt" outcome="fail" />` +
        `<Event id="102" task="T-001" kind="terminal" />` +
        `</Epoch-2>` +
        `</C-WAVE></NgraceRunLedger>`,
    );
    expect(computeConstituentTasksPassed(root, "C-WAVE", "w1")).toEqual({ value: true });
    expect(computeConstituentTasksPassed(root, "C-WAVE", "w2")).toEqual({ value: false });
    const missing = computeConstituentTasksPassed(root, "C-WAVE", "nope");
    expect(missing.value).toBe("unknown");
  });

  it("proxy caveat appears in both summary and JSON-facing field (P6 adjacency)", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-CAVEAT");
    recordReviewVerdict(root, "C-CAVEAT", {
      outcome: "pass",
      scope: "bundle",
    });
    const report = collectPlanQualityReport(root);
    expect(report.proxyCaveat).toBe(PLAN_QUALITY_PROXY_CAVEAT);
    expect(report.summary.endsWith(PLAN_QUALITY_PROXY_CAVEAT) || report.summary.includes(PLAN_QUALITY_PROXY_CAVEAT)).toBe(
      true,
    );
    const text = formatPlanQualityText(report);
    const summaryIdx = text.indexOf("Plan-quality report:");
    const caveatIdx = text.lastIndexOf(PLAN_QUALITY_PROXY_CAVEAT);
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(caveatIdx).toBeGreaterThan(summaryIdx);
  });

  it("corr 183: clean tree has empty unreadable; totals unchanged", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-CLEAN");
    recordReviewVerdict(root, "C-CLEAN", { outcome: "pass", scope: "bundle" });
    const report = collectPlanQualityReport(root);
    expect(report.unreadable).toEqual([]);
    expect(report.verdictsTotal).toBe(1);
    expect(report.scoped).toBe(1);
    expect(report.summary).not.toContain("unreadable");
    expect(formatPlanQualityText(report)).toContain("unreadable bundles: 0");
  });

  it("corr 183: invalid scope makes bundle unreadable, not a silently shorter total", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-GOOD");
    writeBundle(root, "C-BAD");
    recordReviewVerdict(root, "C-GOOD", { outcome: "pass", scope: "bundle" });
    recordReviewVerdict(root, "C-BAD", { outcome: "pass" });
    // Hand-corrupt: invalid scope token — only reachable by edit, not by writer.
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-BAD", "run-ledger.xml");
    const raw = readFileSync(ledgerPath, "utf8");
    writeFileSync(
      ledgerPath,
      raw.replace('<Verdict outcome="pass"', '<Verdict outcome="pass" scope="squad"'),
    );

    const report = collectPlanQualityReport(root);
    // Failure mode this test forbids: C-BAD vanished and total shrank with no unreadable row.
    expect(report.unreadable.map((u) => u.changeId)).toEqual(["C-BAD"]);
    expect(report.unreadable[0]?.code).toBe("ledger.invalid-verdict");
    expect(report.unreadable[0]?.detail.toLowerCase()).toMatch(/scope|squad/);
    expect(report.verdictsTotal).toBe(1);
    expect(report.rows.every((r) => r.changeId !== "C-BAD")).toBe(true);
    expect(report.rows.some((r) => r.changeId === "C-GOOD")).toBe(true);
    expect(report.summary).toContain("1 bundle unreadable");
    expect(report.summary).toContain("ledger.invalid-verdict");
    expect(report.summary).toContain("C-BAD");
    expect(report.summary).toContain("excluded from every count");
    const text = formatPlanQualityText(report);
    expect(text).toContain("unreadable bundles: 1");
    expect(text).toContain("C-BAD");
  });

  it("corr 183: every bundle unreadable still names absence (N=0 readable stays honest)", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-ONLY");
    recordReviewVerdict(root, "C-ONLY", { outcome: "pass" });
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-ONLY", "run-ledger.xml");
    writeFileSync(
      ledgerPath,
      readFileSync(ledgerPath, "utf8").replace(
        '<Verdict outcome="pass"',
        '<Verdict outcome="pass" scope="squad"',
      ),
    );
    const report = collectPlanQualityReport(root);
    expect(report.verdictsTotal).toBe(0);
    expect(report.scoped).toBe(0);
    expect(report.unreadable).toHaveLength(1);
    expect(report.summary).toContain("0 review verdicts with recorded scope");
    expect(report.summary).toContain("1 bundle unreadable");
    expect(report.summary).toContain("No plan-quality rate is computed");
    expect(report.summary).not.toContain("plan quality: OK");
  });

  it("corr 183 adversarial: duplicate Verdicts section is unreadable absence", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-DUP");
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-DUP", "run-ledger.xml");
    writeFileSync(
      ledgerPath,
      `<NgraceRunLedger graceVersion="1.0"><C-DUP>` +
        `<Verdicts><Verdict outcome="pass" /></Verdicts>` +
        `<Verdicts><Verdict outcome="fail" /></Verdicts>` +
        `</C-DUP></NgraceRunLedger>`,
    );
    const report = collectPlanQualityReport(root);
    expect(report.unreadable.map((u) => u.changeId)).toEqual(["C-DUP"]);
    expect(report.unreadable[0]?.code).toBe("ledger.invalid-verdict");
    expect(report.verdictsTotal).toBe(0);
  });

  it("corr 183 adversarial: unexpected child under Verdicts is unreadable", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-BOGUS");
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-BOGUS", "run-ledger.xml");
    writeFileSync(
      ledgerPath,
      `<NgraceRunLedger graceVersion="1.0"><C-BOGUS>` +
        `<Verdicts><Verdict outcome="pass" /><Bogus /></Verdicts>` +
        `</C-BOGUS></NgraceRunLedger>`,
    );
    const report = collectPlanQualityReport(root);
    expect(report.unreadable.map((u) => u.changeId)).toEqual(["C-BOGUS"]);
    expect(report.verdictsTotal).toBe(0);
  });

  it("corr 183 adversarial: missing run-ledger is empty readable set, not unreadable", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeBundle(root, "C-NOLEDGER");
    // No run-ledger.xml written.
    const report = collectPlanQualityReport(root);
    expect(report.unreadable).toEqual([]);
    expect(report.verdictsTotal).toBe(0);
    expect(report.summary).not.toContain("unreadable");
  });
});
