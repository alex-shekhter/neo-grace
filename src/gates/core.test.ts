import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { allGateCodes, isGateIssueCode } from "./catalog";
import {
  evaluateApproveGate,
  evaluateApplyGate,
  evaluateArchiveGate,
  evaluateAttemptGate,
  resolveProjectGateFailOn,
} from "./core";
import {
  listGateDecisions,
  listReviewVerdicts,
  recordGateDecision,
  recordReviewVerdict,
} from "./ledger";
import { advanceCursor, foldEpoch, listLooseEvents, recordAttempt, showCursor } from "../grace-cursor";

const tempRoots: string[] = [];

function tempProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-gate-"));
  tempRoots.push(root);
  writeMinimalNgraceProject(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

function activeBundle(root: string, changeId = "C-GATE") {
  writeChangeBundleFixture(root, {
    changeId,
    location: "active",
    specStatus: "approved",
    planStatus: "approved",
  });
  return path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
}

describe("gate catalog (D14)", () => {
  it("every catalog code is gate.* and none is a bare lint path", () => {
    const codes = allGateCodes();
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(isGateIssueCode(code)).toBe(true);
      expect(code.startsWith("gate.")).toBe(true);
    }
  });
});

describe("ledger Verdicts and Decisions (A30)", () => {
  it("records verdict and decision without creating run/ files", () => {
    const root = tempProject();
    activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "unable-to-determine", reason: "host-capability-missing" });
    recordGateDecision(root, "C-GATE", {
      gate: "apply",
      decision: "permit",
      requirements: [{ id: "review-verdict", required: true, present: true, blocking: false }],
    });
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "active", "C-GATE");
    expect(existsSync(path.join(bundle, "run"))).toBe(false);
    expect(listLooseEvents(bundle)).toHaveLength(0);
    expect(listReviewVerdicts(root, "C-GATE")).toHaveLength(1);
    expect(listGateDecisions(root, "C-GATE")).toHaveLength(1);
    const ledger = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(ledger).toContain("<Verdicts>");
    expect(ledger).toContain("<Decisions>");
    expect(ledger).not.toContain("Epoch-");
  });

  it("survives fold of a later epoch without losing sections (A30 probe)", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    recordGateDecision(root, "C-GATE", {
      gate: "approve",
      decision: "permit",
      requirements: [],
    });
    advanceCursor(root, "C-GATE", {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 10,
    });
    advanceCursor(root, "C-GATE", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-GATE");
    expect(listLooseEvents(bundle)).toHaveLength(0);
    expect(listReviewVerdicts(root, "C-GATE").map((v) => v.outcome)).toEqual(["pass"]);
    expect(listGateDecisions(root, "C-GATE").map((d) => d.gate)).toEqual(["approve"]);
    const ledger = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(ledger).toContain("<Epoch-1");
    expect(ledger).toContain("<Verdicts>");
    expect(ledger).toContain("<Decisions>");
  });

  it("absent Verdicts is not a pass — apply refuses (D5)", () => {
    const root = tempProject();
    activeBundle(root);
    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.no-verdict")).toBe(true);
  });
});

describe("approve gate", () => {
  it("refuses unresolved IC/INV clarification; ASSUMPTION does not block", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    // Patch spec with Clarification + Assumption
    const specPath = path.join(bundle, "spec.xml");
    let spec = readFileSync(specPath, "utf8");
    spec = spec.replace(
      "</C-GATE>",
      `<Clarifications><Clarification target="IC-EXAMPLE">need shape</Clarification></Clarifications>`
        + `<Assumptions><Assumption>we assume green tests</Assumption></Assumptions></C-GATE>`,
    );
    writeFileSync(specPath, spec);
    const refused = evaluateApproveGate(root, "C-GATE");
    expect(refused.decision).toBe("refuse");
    expect(refused.issues.some((i) => i.code === "gate.approve.clarification-unresolved")).toBe(true);

    // Resolve clarification
    spec = readFileSync(specPath, "utf8");
    spec = spec.replace(
      `target="IC-EXAMPLE"`,
      `target="IC-EXAMPLE" resolved="true"`,
    );
    writeFileSync(specPath, spec);
    const permitted = evaluateApproveGate(root, "C-GATE");
    expect(permitted.decision).toBe("permit");
  });

  it("clarification on non-satisfied AC does not block approve", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    const specPath = path.join(bundle, "spec.xml");
    let spec = readFileSync(specPath, "utf8");
    spec = spec.replace(
      "</C-GATE>",
      `<Clarifications><Clarification target="AC-OTHER">hole</Clarification></Clarifications></C-GATE>`,
    );
    writeFileSync(specPath, spec);
    expect(evaluateApproveGate(root, "C-GATE").decision).toBe("permit");
  });
});

describe("apply gate", () => {
  it("permits unable-to-determine; refuses no verdict (D11 pair)", () => {
    const root = tempProject();
    activeBundle(root);
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("refuse");
    recordReviewVerdict(root, "C-GATE", { outcome: "unable-to-determine", reason: "evidence gap" });
    const permitted = evaluateApplyGate(root, "C-GATE");
    expect(permitted.decision).toBe("permit");
    expect(permitted.verdict?.outcome).toBe("unable-to-determine");
  });

  it("host-capability-missing respects gateFailOn permissive vs strict", () => {
    const root = tempProject();
    activeBundle(root);
    recordReviewVerdict(root, "C-GATE", {
      outcome: "unable-to-determine",
      reason: "host-capability-missing",
    });
    // default gateFailOn = errors → refuse
    expect(resolveProjectGateFailOn(root)).toBe("errors");
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("refuse");

    writeFileSync(
      path.join(root, ".ngrace-lint.json"),
      JSON.stringify({ gateFailOn: "never" }),
    );
    expect(resolveProjectGateFailOn(root)).toBe("never");
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("permit");

    writeFileSync(
      path.join(root, ".ngrace-lint.json"),
      JSON.stringify({ gateFailOn: "errors" }),
    );
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("refuse");
  });

  it("refuses without a plan (A17.2)", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-NOPLAN",
      location: "active",
      specStatus: "approved",
      // planStatus omitted → no plan.xml
    });
    recordReviewVerdict(root, "C-NOPLAN", { outcome: "pass" });
    const result = evaluateApplyGate(root, "C-NOPLAN");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.no-plan")).toBe(true);
  });
});

describe("archive gate (A30.1 deadlock)", () => {
  it("permits with recorded apply decision and verdict when run/ empty", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    recordGateDecision(root, "C-GATE", {
      gate: "apply",
      decision: "permit",
      requirements: [],
    });
    expect(listLooseEvents(bundle)).toHaveLength(0);
    expect(evaluateArchiveGate(root, "C-GATE").decision).toBe("permit");
  });

  it("refuses when one loose run/ event exists", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    mkdirSync(path.join(bundle, "run"), { recursive: true });
    writeFileSync(
      path.join(bundle, "run", "1-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="progress"/>`,
    );
    expect(evaluateArchiveGate(root, "C-GATE").decision).toBe("refuse");
    expect(evaluateArchiveGate(root, "C-GATE").issues.some((i) => i.code === "gate.archive.open-epoch")).toBe(true);
  });
});

describe("escalated attempt refusal", () => {
  it("evaluateAttemptGate refuses when task is escalated", () => {
    const result = evaluateAttemptGate("C-X", "T-001", ["T-001"]);
    expect(result.decision).toBe("refuse");
    expect(result.issues[0]?.code).toBe("gate.attempt.escalated");
  });

  it("recordAttempt throws when task is escalated", () => {
    const root = tempProject();
    activeBundle(root);
    advanceCursor(root, "C-GATE", { task: "T-001", openEpoch: true, from: 1, to: 20 });
    recordAttempt(root, "C-GATE", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "a" },
    });
    recordAttempt(root, "C-GATE", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "b" },
    });
    const position = showCursor(root, "C-GATE");
    expect(position.escalatedTasks).toContain("T-001");
    expect(() =>
      recordAttempt(root, "C-GATE", {
        task: "T-001",
        outcome: "fail",
        signature: { kind: "test", key: "c" },
      }),
    ).toThrow(/gate\.attempt\.escalated/);
  });
});
