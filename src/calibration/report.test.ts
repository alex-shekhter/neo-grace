import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import { parseClaimedConfidence, CLAIMED_CONFIDENCE_LEVELS } from "../artifact/types";
import {
  advanceCursor,
  foldEpoch,
  recordAttempt,
  recordCalibrationRestatement,
} from "../grace-cursor";
import {
  ADJUDICATOR_TARGET_ASSERTIONS,
  CONTEXT_CLASS_NOT_STORED,
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
  options: {
    targetMustExist?: string;
    extraTarget?: string;
    satisfies?: boolean;
  } = {},
): void {
  const target = options.targetMustExist ?? "src/example.ts";
  const extra = options.extraTarget ?? "";
  const satisfies =
    options.satisfies === false
      ? `<Satisfies></Satisfies>`
      : `<Satisfies><AC-ONE /></Satisfies>`;
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
      `<ImplementationPlan><T-001><Title>Task</Title><DependsOn></DependsOn>${satisfies}` +
      `<AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria>` +
      `<Verification><Command>true</Command></Verification></T-001></ImplementationPlan>` +
      `</${changeId}></NgraceChangePlan>`,
  );
}

const DEFAULT_WRITE_EVIDENCE = {
  available: true as const,
  files: [
    {
      path: "src/example.ts",
      kind: "content" as const,
      digest: "a".repeat(64),
    },
  ],
};

function openAttemptTerminalFold(
  root: string,
  changeId: string,
  claims: Array<{ confidence: string; outcome?: "pass" | "fail" }>,
  options: {
    writeEvidence?: import("../grace-cursor").WriteEvidenceSnapshot;
  } = {},
): void {
  advanceCursor(root, changeId, { task: "T-001", openEpoch: true });
  for (const claim of claims) {
    recordAttempt(root, changeId, {
      task: "T-001",
      outcome: claim.outcome ?? "pass",
      claimedConfidence: claim.confidence,
      writeEvidence: options.writeEvidence ?? DEFAULT_WRITE_EVIDENCE,
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

  it("corr 161 A7.2: fold-time record reports adjudicatedAt=fold and is included", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-FOLD");
    openAttemptTerminalFold(root, "C-CAL-FOLD", [{ confidence: "medium" }]);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1);
    expect(report.backfilled).toBe(0);
    const pair = report.pairs.find((p) => p.bucket === "included")!;
    expect(pair.adjudicatedAt).toBe("fold");
    expect(report.summary).toContain("adjudicatedAt=fold");
    expect(report.summary).toContain("1 labeled pair included");
    expect(formatCalibrationText(report)).toContain("backfilled (excluded from computation): 0");
  });

  it("corr 161 A7.2: backfilled record reports adjudicatedAt=backfill and is not included", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-BF");
    openAttemptTerminalFold(root, "C-CAL-BF", [{ confidence: "high" }]);

    // Hand-edit the stored adjudication moment to backfill (simulates a contaminated write).
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-BF/run-ledger.xml");
    const ledger = readFileSync(ledgerPath, "utf8").replace(
      'adjudicatedAt="fold"',
      'adjudicatedAt="backfill"',
    );
    writeFileSync(ledgerPath, ledger);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(0);
    expect(report.backfilled).toBe(1);
    expect(report.pending).toBe(0);
    const pair = report.pairs.find((p) => p.bucket === "backfilled")!;
    expect(pair).toBeDefined();
    expect(pair.adjudicatedAt).toBe("backfill");
    expect(pair.adjudicatedOutcome).toBe("pass");
    expect(report.summary).toContain("0 labeled pairs included");
    expect(report.summary).toContain("1 backfilled");
    expect(report.summary).toContain("adjudicatedAt=backfill");
    expect(report.summary).toContain("excluded from calibration computation");
    // Must not pool backfill into the included count or invent a rate.
    expect(report.summary).not.toMatch(/1 labeled pair included/);
    expect(report.summary.toLowerCase()).not.toContain("100%");
    const text = formatCalibrationText(report);
    expect(text).toContain("backfilled (excluded from computation): 1");
    expect(text).toContain("bucket=backfilled");
    expect(text).toContain("adjudicatedAt=backfill");
  });

  it("corr 161: restatement overrides stored fold without editing the restated ledger", () => {
    const root = createRoot();
    writeMinimalProject(root);
    // Contaminated historical pair: still says fold on disk.
    writeApprovedPlan(root, "C-CAL-OLD");
    openAttemptTerminalFold(root, "C-CAL-OLD", [{ confidence: "medium" }]);
    // Authoring change that records the restatement (must have its own fold first).
    writeApprovedPlan(root, "C-CAL-NEW");
    openAttemptTerminalFold(root, "C-CAL-NEW", [{ confidence: "low" }]);

    recordCalibrationRestatement(root, "C-CAL-NEW", {
      changeId: "C-CAL-OLD",
      epoch: 1,
      adjudicatedAt: "backfill",
      reason: "hand-migrated after fold; fold path had not written CalibrationAdjudication",
    });

    // Archive of OLD still says fold on disk.
    const oldLedger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-OLD/run-ledger.xml"),
      "utf8",
    );
    expect(oldLedger).toContain('adjudicatedAt="fold"');
    expect(oldLedger).not.toContain("backfill");

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1); // only C-CAL-NEW
    expect(report.backfilled).toBe(1); // C-CAL-OLD via restatement
    const oldPair = report.pairs.find((p) => p.changeId === "C-CAL-OLD")!;
    expect(oldPair.bucket).toBe("backfilled");
    expect(oldPair.adjudicatedAt).toBe("backfill");
    expect(oldPair.reason).toContain("hand-migrated");
    const newPair = report.pairs.find((p) => p.changeId === "C-CAL-NEW")!;
    expect(newPair.bucket).toBe("included");
    expect(newPair.adjudicatedAt).toBe("fold");
    expect(report.summary).toContain("1 labeled pair included");
    expect(report.summary).toContain("1 backfilled");
    expect(formatCalibrationText(report)).toContain("C-CAL-OLD Epoch-1 bucket=backfilled");
    expect(formatCalibrationText(report)).toContain("adjudicatedAt=backfill");
  });

  it("corr 161: adjudicatedAt is read from the record, not synthesized as fold", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-READ");
    openAttemptTerminalFold(root, "C-CAL-READ", [{ confidence: "medium" }]);
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-READ/run-ledger.xml");
    // If the parser synthesized "fold", flipping the attribute would still report fold.
    writeFileSync(
      ledgerPath,
      readFileSync(ledgerPath, "utf8").replace('adjudicatedAt="fold"', 'adjudicatedAt="backfill"'),
    );
    const report = collectCalibrationReport(root);
    expect(report.pairs[0]!.adjudicatedAt).toBe("backfill");
    expect(report.pairs[0]!.bucket).toBe("backfilled");
    expect(report.included).toBe(0);
  });

  it("corr 165: fold stores derived context class; report buckets by it at N=1", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-CTX", { satisfies: true });
    openAttemptTerminalFold(root, "C-CAL-CTX", [{ confidence: "high" }]);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1);
    const pair = report.pairs.find((p) => p.bucket === "included")!;
    expect(pair.context).toBeDefined();
    expect(pair.context!.taskKind).toBe("satisfies-ac");
    expect(pair.context!.adapterPresence).toBe("present"); // src/example.ts or similar in evidence
    expect(pair.context!.wroteVsRead).toBe("wrote");
    expect(pair.context!.sequentialVsParallel).toBe("sequential");
    expect(pair.context!.key).toContain("satisfies-ac");
    expect(report.byContextClass).toHaveLength(1);
    expect(report.byContextClass[0]!.count).toBe(1);
    expect(report.byContextClass[0]!.contextClass).toBe(pair.context!.key);
    expect(report.summary).toContain("By context class: 1 class with 1 row");
    expect(report.summary).toContain(`contextClass=${pair.context!.key}`);
    expect(formatCalibrationText(report)).toContain("by context class:");
    expect(formatCalibrationText(report)).toContain(pair.context!.key);

    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-CTX/run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain('taskKind="satisfies-ac"');
    expect(ledger).toContain('sequentialVsParallel="sequential"');
    expect(ledger).toContain("contextClass=");
  });

  it("corr 165 A7.2: taskKind no-satisfies vs satisfies-ac both observed", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-NS", { satisfies: false });
    openAttemptTerminalFold(root, "C-CAL-NS", [{ confidence: "low" }]);
    writeApprovedPlan(root, "C-CAL-SA", { satisfies: true });
    openAttemptTerminalFold(root, "C-CAL-SA", [{ confidence: "high" }]);

    const report = collectCalibrationReport(root);
    const ns = report.pairs.find((p) => p.changeId === "C-CAL-NS")!;
    const sa = report.pairs.find((p) => p.changeId === "C-CAL-SA")!;
    expect(ns.context!.taskKind).toBe("no-satisfies");
    expect(sa.context!.taskKind).toBe("satisfies-ac");
    expect(ns.context!.key).not.toBe(sa.context!.key);
  });

  it("corr 165 A7.2: wrote vs read-only both observed", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-WROTE");
    openAttemptTerminalFold(root, "C-CAL-WROTE", [{ confidence: "medium" }]);

    writeApprovedPlan(root, "C-CAL-READO");
    advanceCursor(root, "C-CAL-READO", { task: "T-001", openEpoch: true });
    recordAttempt(root, "C-CAL-READO", {
      task: "T-001",
      outcome: "pass",
      claimedConfidence: "medium",
      writeEvidence: { available: true, files: [] },
    });
    advanceCursor(root, "C-CAL-READO", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-CAL-READO");

    const report = collectCalibrationReport(root);
    expect(report.pairs.find((p) => p.changeId === "C-CAL-WROTE")!.context!.wroteVsRead).toBe(
      "wrote",
    );
    expect(report.pairs.find((p) => p.changeId === "C-CAL-READO")!.context!.wroteVsRead).toBe(
      "read-only",
    );
  });

  it("corr 165 A7.2: sequential vs parallel both observed", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-SEQ");
    openAttemptTerminalFold(root, "C-CAL-SEQ", [{ confidence: "medium" }]);

    writeApprovedPlan(root, "C-CAL-PAR");
    advanceCursor(root, "C-CAL-PAR", {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 50,
    });
    // Second worker allocation on the opened event → parallel (unused range is fine).
    const openedPath = path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-PAR/run");
    const openedFile = readdirSync(openedPath).find((f) => f.includes("opened"))!;
    const openedAbs = path.join(openedPath, openedFile);
    let openedXml = readFileSync(openedAbs, "utf8");
    // Insert a second Allocation before the closing Event tag.
    if (!openedXml.includes('worker="w1"')) {
      openedXml = openedXml.replace(
        /(<Allocation[^/]*\/>)/,
        `$1<Allocation worker="w1" from="51" to="99" />`,
      );
      writeFileSync(openedAbs, openedXml);
    }
    expect(readFileSync(openedAbs, "utf8")).toContain('worker="w1"');
    recordAttempt(root, "C-CAL-PAR", {
      task: "T-001",
      outcome: "pass",
      claimedConfidence: "medium",
      writeEvidence: DEFAULT_WRITE_EVIDENCE,
    });
    advanceCursor(root, "C-CAL-PAR", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-CAL-PAR");

    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-PAR/run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain('worker="w1"');
    expect(ledger).toContain('sequentialVsParallel="parallel"');

    const report = collectCalibrationReport(root);
    expect(report.pairs.find((p) => p.changeId === "C-CAL-SEQ")!.context!.sequentialVsParallel).toBe(
      "sequential",
    );
    expect(report.pairs.find((p) => p.changeId === "C-CAL-PAR")!.context!.sequentialVsParallel).toBe(
      "parallel",
    );
  });

  it("corr 165 A7.2: adapter present vs absent both observed", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-ADP");
    openAttemptTerminalFold(root, "C-CAL-ADP", [{ confidence: "medium" }]);

    writeApprovedPlan(root, "C-CAL-NOA");
    advanceCursor(root, "C-CAL-NOA", { task: "T-001", openEpoch: true });
    recordAttempt(root, "C-CAL-NOA", {
      task: "T-001",
      outcome: "pass",
      claimedConfidence: "low",
      writeEvidence: {
        available: true,
        files: [
          {
            kind: "content",
            path: ".ngrace/changes/active/C-CAL-NOA/plan.xml",
            digest: "e".repeat(64),
          },
        ],
      },
    });
    advanceCursor(root, "C-CAL-NOA", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-CAL-NOA");

    const report = collectCalibrationReport(root);
    expect(report.pairs.find((p) => p.changeId === "C-CAL-ADP")!.context!.adapterPresence).toBe(
      "present",
    );
    expect(report.pairs.find((p) => p.changeId === "C-CAL-NOA")!.context!.adapterPresence).toBe(
      "absent",
    );
  });

  it("corr 165: authored context on a claim is ignored at fold; write surface rejects smuggled attrs", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-AUTH");
    advanceCursor(root, "C-CAL-AUTH", { task: "T-001", openEpoch: true });

    // Hand-written loose attempt with authored contextClass — fold must ignore it when deriving.
    const runDir = path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-AUTH/run");
    for (const f of readdirSync(runDir)) {
      if (f.includes("attempt")) rmSync(path.join(runDir, f));
    }
    writeFileSync(
      path.join(runDir, "2-T-001-attempt.xml"),
      `<Event graceVersion="1.0" id="2" task="T-001" kind="attempt" outcome="pass" claimedConfidence="medium" contextClass="authored-evil" taskKind="authored-evil">` +
        `<WriteEvidence available="true"><File digest="${"f".repeat(64)}">src/example.ts</File></WriteEvidence></Event>`,
    );
    advanceCursor(root, "C-CAL-AUTH", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-CAL-AUTH");

    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-AUTH/run-ledger.xml"),
      "utf8",
    );
    // Event may retain authored attrs as raw history; CalibrationAdjudication must not.
    const adj = ledger.match(/<CalibrationAdjudication[^/]*\/>/)?.[0] ?? "";
    expect(adj).not.toContain("authored-evil");
    expect(adj).toContain('taskKind="satisfies-ac"');
    expect(adj).toContain('contextClass="satisfies-ac|present|wrote|sequential"');
    const report = collectCalibrationReport(root);
    expect(report.pairs[0]!.context!.taskKind).toBe("satisfies-ac");
    expect(report.pairs[0]!.context!.key).not.toContain("authored");
  });

  it("corr 165: rejectAuthoredContextAttributes rejects each forbidden name", () => {
    const { rejectAuthoredContextAttributes } =
      require("../grace-cursor") as typeof import("../grace-cursor");
    for (const name of [
      "taskKind",
      "adapterPresence",
      "wroteVsRead",
      "sequentialVsParallel",
      "contextClass",
    ]) {
      expect(() => rejectAuthoredContextAttributes({ [name]: "authored" })).toThrow(
        new RegExp(`Context feature ${name} must not be authored`),
      );
    }
    expect(() => rejectAuthoredContextAttributes({ outcome: "pass" })).not.toThrow();
  });

  it("corr 165: pre-round-4 pair without context uses context-not-stored bucket sentinel", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeApprovedPlan(root, "C-CAL-OLD");
    openAttemptTerminalFold(root, "C-CAL-OLD", [{ confidence: "medium" }]);
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes/active/C-CAL-OLD/run-ledger.xml");
    // Strip context attributes to simulate pre-round-4 storage.
    let ledger = readFileSync(ledgerPath, "utf8");
    for (const attr of [
      "taskKind",
      "adapterPresence",
      "wroteVsRead",
      "sequentialVsParallel",
      "contextClass",
    ]) {
      ledger = ledger.replace(new RegExp(`\\s${attr}="[^"]*"`, "g"), "");
    }
    writeFileSync(ledgerPath, ledger);

    const report = collectCalibrationReport(root);
    expect(report.included).toBe(1);
    expect(report.pairs[0]!.context).toBeUndefined();
    expect(report.byContextClass[0]!.contextClass).toBe(CONTEXT_CLASS_NOT_STORED);
    expect(report.summary).toContain(CONTEXT_CLASS_NOT_STORED);
  });

  it("N=0 surfaces empty context-class section (not suppressed)", () => {
    const root = createRoot();
    writeMinimalProject(root);
    const report = collectCalibrationReport(root);
    expect(report.byContextClass).toEqual([]);
    expect(report.summary).toContain("By context class: (none — N included is 0)");
    expect(formatCalibrationText(report)).toContain("by context class:");
    expect(formatCalibrationText(report)).toContain("(none — N included is 0)");
  });
});

