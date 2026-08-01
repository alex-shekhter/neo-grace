import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import { parseClaimedConfidence, CLAIMED_CONFIDENCE_LEVELS } from "../artifact/types";
import {
  advanceCursor,
  foldEpoch,
  recordAttempt,
} from "../grace-cursor";
import {
  ADJUDICATOR_TARGET_ASSERTIONS,
  collectCalibrationReport,
  formatCalibrationText,
} from "./report";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-cal-"));
  roots.push(root);
  return root;
}

function write(root: string, rel: string, contents: string): void {
  const filePath = path.join(root, rel);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeMinimalProject(root: string): void {
  write(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements graceVersion="1.0"><Summary>Required.</Summary></NgraceRequirements>`);
  write(root, `${ARTIFACT_DIR}/context/technology.xml`, `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`);
  write(root, `${ARTIFACT_DIR}/context/principles.xml`, `<NgracePrinciples graceVersion="1.0"><Principle>Safe.</Principle></NgracePrinciples>`);
  write(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<NgraceDeployment graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>CLI.</Reason></NgraceDeployment>`);
  write(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<NgraceUXGuidelines graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>CLI.</Reason></NgraceUXGuidelines>`);
  write(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
  );
  write(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path><Type>CORE_LOGIC</Type></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
  );
  write(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
  );
  write(
    root,
    `${ARTIFACT_DIR}/verification/main.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test</Command><Scenario>Example.</Scenario><TraceAssertion>runs.</TraceAssertion></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
  );
  write(
    root,
    "src/example.ts",
    `// START_MODULE_CONTRACT\n//   PURPOSE: Example\n//   SCOPE: test\n//   DEPENDS: none\n//   LINKS: M-EXAMPLE\n//   ROLE: RUNTIME\n//   MAP_MODE: EXPORTS\n// END_MODULE_CONTRACT\n//\n// START_MODULE_MAP\n//   example\n// END_MODULE_MAP\nexport const example = true;\n`,
  );
}

function writeApprovedPlan(
  root: string,
  changeId: string,
  options: { targetMustExist?: string; extraTarget?: string } = {},
): void {
  const target = options.targetMustExist ?? "src/example.ts";
  const extra = options.extraTarget ?? "";
  write(
    root,
    `${ARTIFACT_DIR}/changes/active/${changeId}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="approved"><${changeId}><Summary>Cal fixture.</Summary></${changeId}></NgraceChangeSpec>`,
  );
  write(
    root,
    `${ARTIFACT_DIR}/changes/active/${changeId}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="approved"><${changeId}>` +
      `<IntentSummary>Calibration fixture.</IntentSummary>` +
      `<BaselineAssertions><MustExist><Value>src/example.ts</Value></MustExist></BaselineAssertions>` +
      `<TargetAssertions><MustExist><Value>${target}</Value></MustExist>${extra}</TargetAssertions>` +
      `<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>` +
      `<ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>` +
      `<ImplementationPlan><T-001><Title>Task</Title><DependsOn></DependsOn>` +
      `<AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria>` +
      `<Verification><Command>true</Command></Verification></T-001></ImplementationPlan>` +
      `</${changeId}></NgraceChangePlan>`,
  );
}

function openAttemptTerminalFold(
  root: string,
  changeId: string,
  claims: Array<{ confidence: string; outcome?: "pass" | "fail" }>,
): void {
  advanceCursor(root, changeId, { task: "T-001", openEpoch: true });
  for (const claim of claims) {
    recordAttempt(root, changeId, {
      task: "T-001",
      outcome: claim.outcome ?? "pass",
      claimedConfidence: claim.confidence,
      writeEvidence: { available: true, files: [] },
      ...(claim.outcome === "fail"
        ? { signature: { kind: "test", key: "k" } }
        : {}),
    });
  }
  advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
  foldEpoch(root, changeId);
}

describe("parseClaimedConfidence ordinal", () => {
  it("accepts the three levels", () => {
    for (const level of CLAIMED_CONFIDENCE_LEVELS) {
      const parsed = parseClaimedConfidence(level);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toBe(level);
    }
  });

  it("rejects free text, percentages, and a fourth level", () => {
    expect(parseClaimedConfidence("pretty sure").ok).toBe(false);
    expect(parseClaimedConfidence("80%").ok).toBe(false);
    expect(parseClaimedConfidence("0.8").ok).toBe(false);
    expect(parseClaimedConfidence("very-high").ok).toBe(false);
    expect(parseClaimedConfidence("").ok).toBe(false);
  });
});

describe("collectCalibrationReport (per-epoch pairs, fold-time labels)", () => {
  it("N=0: honest empty summary, no rate table", () => {
    const root = createRoot();
    writeMinimalProject(root);
    const report = collectCalibrationReport(root);
    expect(report.included).toBe(0);
    expect(report.excluded).toBe(0);
    expect(report.pending).toBe(0);
    expect(report.summary).toContain("0 labeled pairs included");
    expect(report.summary).toContain("one folded epoch");
    expect(report.summary).toContain("claimedConfidence is not used by any gate");
    expect(report.summary.toLowerCase()).not.toContain("100%");
    expect(formatCalibrationText(report)).toContain("included (fold-adjudicated epochs): 0");
  });

  it("loose claimedConfidence is excluded (incomplete epoch), not included", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-EX");
    advanceCursor(root, "C-CAL-EX", {
      task: "T-001",
      openEpoch: true,
      executorIdentity: { model: "test-model", harness: "unit" },
    });
    recordAttempt(root, "C-CAL-EX", {
      task: "T-001",
      outcome: "pass",
      claimedConfidence: "medium",
      writeEvidence: { available: true, files: [] },
    });
    const report = collectCalibrationReport(root);
    expect(report.excluded).toBe(1);
    expect(report.included).toBe(0);
    expect(report.pairs[0]?.bucket).toBe("excluded");
    expect(report.pairs[0]?.claimCount).toBe(1);
    expect(report.summary).toContain("0 labeled pairs included");
  });

  it("N=1: one included pair names fold-time target-assertions adjudicator", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-ONE");
    openAttemptTerminalFold(root, "C-CAL-ONE", [{ confidence: "high" }]);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1);
    expect(report.excluded).toBe(0);
    const pair = report.pairs.find((p) => p.bucket === "included");
    expect(pair).toBeDefined();
    expect(pair!.claimCount).toBe(1);
    expect(pair!.claims[0]!.claimedConfidence).toBe("high");
    expect(pair!.adjudicatedOutcome).toBe("pass");
    expect(pair!.adjudicator).toBe(ADJUDICATOR_TARGET_ASSERTIONS);
    expect(pair!.adjudicatedAt).toBe("fold");
    expect(pair!.changeId).toBe("C-CAL-ONE");
    expect(pair!.epoch).toBe(1);
    expect(pair!.claims[0]!.attemptOutcome).toBe("pass");
    expect(report.summary).toContain("1 labeled pair included");
    expect(report.summary).toContain(`adjudicator=${ADJUDICATOR_TARGET_ASSERTIONS}`);
    expect(report.summary).toContain("adjudicatedAt=fold");
    expect(report.summary).not.toMatch(/%/);

    // Fold wrote durable CalibrationAdjudication into the ledger.
    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-ONE/run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain("CalibrationAdjudication");
    expect(ledger).toContain('outcome="pass"');
    expect(ledger).toContain('adjudicatedAt="fold"');
  });

  it("corr 155: two claims in one change are one labeled pair, not two", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-TWO");
    openAttemptTerminalFold(root, "C-CAL-TWO", [
      { confidence: "low" },
      { confidence: "high" },
    ]);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1);
    expect(report.pairs.filter((p) => p.bucket === "included")).toHaveLength(1);
    const pair = report.pairs.find((p) => p.bucket === "included")!;
    expect(pair.claimCount).toBe(2);
    expect(pair.claims.map((c) => c.claimedConfidence).sort()).toEqual(["high", "low"]);
    expect(pair.adjudicatedOutcome).toBe("pass");
    expect(report.summary).toContain("1 labeled pair included");
    expect(report.summary).toContain("claims(2)");
    // Must not say "2 labeled pairs".
    expect(report.summary).not.toMatch(/2 labeled pairs/);
  });

  it("corr 156: stored fail label does not move when the tree later becomes clean", () => {
    const root = createRoot();
    writeMinimalProject(root);
    // Fold while target is missing → fail stored at fold.
    writeApprovedPlan(root, "C-CAL-DUR", { targetMustExist: "src/missing-at-fold.ts" });
    openAttemptTerminalFold(root, "C-CAL-DUR", [
      { confidence: "medium", outcome: "pass" }, // agent pass ≠ score
    ]);

    const before = collectCalibrationReport(root);
    expect(before.included).toBe(1);
    expect(before.pairs[0]!.adjudicatedOutcome).toBe("fail");
    expect(before.pairs[0]!.claims[0]!.attemptOutcome).toBe("pass");

    // Tree now satisfies a different plan path — but we do not recompute labels.
    // Fix the missing file so a live re-eval would pass; stored label must stay fail.
    write(
      root,
      "src/missing-at-fold.ts",
      `// START_MODULE_CONTRACT\n//   PURPOSE: Late\n//   SCOPE: x\n//   DEPENDS: none\n//   LINKS: M-EXAMPLE\n//   ROLE: RUNTIME\n//   MAP_MODE: EXPORTS\n// END_MODULE_CONTRACT\n//\n// START_MODULE_MAP\n//   late\n// END_MODULE_MAP\nexport const late = true;\n`,
    );
    // Also re-point plan to existing example so target assertions would pass if recomputed.
    writeApprovedPlan(root, "C-CAL-DUR", { targetMustExist: "src/example.ts" });

    const after = collectCalibrationReport(root);
    expect(after.included).toBe(1);
    expect(after.pairs[0]!.adjudicatedOutcome).toBe("fail");
    expect(after.pairs[0]!.adjudicatedAt).toBe("fold");
    // Ledger still holds the stored fail.
    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-DUR/run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain('outcome="fail"');
  });

  it("pending when target assertions not evaluable at fold stays pending, never fail", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-PEND", {
      extraTarget: `<MustPassCommand><Command>bun test</Command></MustPassCommand>`,
    });
    openAttemptTerminalFold(root, "C-CAL-PEND", [{ confidence: "low" }]);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(0);
    expect(report.pending).toBe(1);
    expect(report.pairs[0]?.bucket).toBe("pending");
    expect(report.pairs[0]?.adjudicatedOutcome).toBeUndefined();
    expect(report.pairs[0]?.adjudicatedAt).toBe("fold");
    expect(report.summary).toContain("pending");
    expect(report.summary).toContain("not scored as fail");

    // Even if we later remove MustPassCommand (tree would pass), stored pending stays pending.
    writeApprovedPlan(root, "C-CAL-PEND");
    const after = collectCalibrationReport(root);
    expect(after.pending).toBe(1);
    expect(after.included).toBe(0);
    expect(after.pairs[0]?.bucket).toBe("pending");
  });

  it("included fail independent of agent pass (149 still holds)", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-FAIL", { targetMustExist: "src/missing-target.ts" });
    openAttemptTerminalFold(root, "C-CAL-FAIL", [
      { confidence: "medium", outcome: "pass" },
    ]);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1);
    expect(report.pairs[0]?.adjudicatedOutcome).toBe("fail");
    expect(report.pairs[0]?.claims[0]?.attemptOutcome).toBe("pass");
    expect(report.pairs[0]?.adjudicator).toBe(ADJUDICATOR_TARGET_ASSERTIONS);
  });

  it("recordAttempt rejects free text and percentages for claimedConfidence", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-BAD");
    advanceCursor(root, "C-CAL-BAD", { task: "T-001", openEpoch: true });
    expect(() =>
      recordAttempt(root, "C-CAL-BAD", {
        task: "T-001",
        outcome: "pass",
        claimedConfidence: "80%",
        writeEvidence: { available: true, files: [] },
      }),
    ).toThrow(/claimedConfidence/);
  });
});
