import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ARTIFACT_DIR } from "../artifact/paths";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { allGateCodes, isGateIssueCode } from "./catalog";
import {
  evaluateApproveGate,
  evaluateApplyGate,
  evaluateArchiveGate,
  evaluateAttemptGate,
  evaluateGate,
  evaluationToDecision,
  resolveProjectGateFailOn,
} from "./core";
import {
  listGateDecisions,
  listReviewVerdicts,
  readGateDecisions,
  readLatestReviewVerdict,
  readPermittingDecision,
  recordGateDecision,
  recordReviewVerdict,
} from "./ledger";
import { advanceCursor, foldEpoch, listLooseEvents, recordAttempt, showCursor } from "../grace-cursor";
import { formatGateEvaluation, gateCommand } from "./command";

const tempRoots: string[] = [];
const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const GRACE_BIN = path.join(REPO_ROOT, "src/grace.ts");

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

function runGateCli(args: string[], cwd = REPO_ROOT) {
  return spawnSync("bun", ["run", GRACE_BIN, "gate", ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

describe("gate catalog (D14)", () => {
  it("every catalog code is gate.* and none is a bare lint path", () => {
    const codes = allGateCodes();
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(isGateIssueCode(code)).toBe(true);
      expect(code.startsWith("gate.")).toBe(true);
    }
    expect(codes).toContain("gate.apply.invalid-verdict");
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

  it("Phase 10: stores scope and classification; unscoped never invents scope (corr 182)", () => {
    const root = tempProject();
    activeBundle(root);
    recordReviewVerdict(root, "C-GATE", {
      outcome: "fail",
      scope: "wave",
      wave: "1",
      classification: "plan",
      constituentTasksPassed: true,
    });
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    const all = listReviewVerdicts(root, "C-GATE");
    expect(all[0]?.scope).toBe("wave");
    expect(all[0]?.classification).toBe("plan");
    expect(all[0]?.constituentTasksPassed).toBe(true);
    // Second verdict unscoped — must not gain a default scope on read.
    expect(all[1]?.scope).toBeUndefined();
    expect(all[1]?.outcome).toBe("pass");
    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", "C-GATE", "run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain('scope="wave"');
    expect(ledger).toContain('classification="plan"');
    // Unscoped entry has outcome only — no scope= invented (self-closing or open).
    expect(ledger).toMatch(/<Verdict outcome="pass"[ />]/);
    expect(ledger).not.toMatch(/<Verdict outcome="pass"[^>]*scope=/);
  });

  it("corr 184: constituentTasksPassed outside wave+fail is rejected, not dropped", () => {
    const root = tempProject();
    activeBundle(root);
    expect(() =>
      recordReviewVerdict(root, "C-GATE", {
        outcome: "pass",
        scope: "task",
        task: "T-001",
        constituentTasksPassed: true,
      }),
    ).toThrow(/constituentTasksPassed applies only to wave-scoped fail verdicts/);
    // Silent path would have stored a pass with no ctp — ensure nothing was written.
    expect(listReviewVerdicts(root, "C-GATE")).toHaveLength(0);
  });

  it("corr 185: gates still fail closed on truncated ledger (no throw, no permit)", () => {
    const root = tempProject();
    activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    const ledgerPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-GATE", "run-ledger.xml");
    const full = readFileSync(ledgerPath, "utf8");
    writeFileSync(ledgerPath, full.slice(0, Math.floor(full.length / 2)));

    // Must not throw — gate evaluates and refuses (fail closed).
    const evaluation = evaluateGate(root, "C-GATE", "apply");
    expect(evaluation.decision).toBe("refuse");
    expect(evaluation.requirements.some((r) => r.id === "review-verdict" && r.blocking)).toBe(true);
    // Legacy read still collapses to absent (empty list), not a throw.
    expect(listReviewVerdicts(root, "C-GATE")).toEqual([]);
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

describe("correction 62 — invocable verdict writer", () => {
  it("ngrace gate verdict records a Verdict the apply gate can consume", () => {
    const root = tempProject();
    activeBundle(root);
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("refuse");

    const recorded = runGateCli(
      ["verdict", "--change", "C-GATE", "--outcome", "pass", "--path", root, "--format", "json"],
      root,
    );
    expect(recorded.status).toBe(0);
    const body = JSON.parse(recorded.stdout);
    expect(body.ok).toBe(true);
    expect(body.verdict.outcome).toBe("pass");
    expect(listReviewVerdicts(root, "C-GATE")).toHaveLength(1);

    const applied = evaluateApplyGate(root, "C-GATE");
    expect(applied.decision).toBe("permit");
    expect(applied.verdict?.outcome).toBe("pass");
  });

  it("gate subCommands includes verdict (counterpart Writers surface)", () => {
    const keys = Object.keys(gateCommand.subCommands ?? {});
    expect(keys).toContain("verdict");
    expect(keys).toContain("approve");
    expect(keys).toContain("apply");
    expect(keys).toContain("archive");
  });
});

describe("correction 63 — malformed newest verdict does not promote older", () => {
  it("refuses when newest is outcome=failed after an older pass", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    const ledgerPath = path.join(bundle, "run-ledger.xml");
    let xml = readFileSync(ledgerPath, "utf8");
    // Exact A31 fixture: older valid + newer malformed.
    xml = xml.replace("</Verdicts>", `<Verdict outcome="failed" /></Verdicts>`);
    writeFileSync(ledgerPath, xml);

    const latest = readLatestReviewVerdict(root, "C-GATE");
    expect(latest.state).toBe("invalid");
    if (latest.state === "invalid") {
      expect(latest.code).toBe("ledger.invalid-verdict");
      expect(latest.detail).toContain("failed");
    }

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);
    expect(result.issues.some((i) => i.message.includes("ledger.invalid-verdict"))).toBe(true);
    // Must NOT report present=true on the older pass.
    const reviewReq = result.requirements.find((r) => r.id === "review-verdict");
    expect(reviewReq?.present).toBe(false);
    expect(result.verdict).toBeUndefined();
  });

  it("listReviewVerdicts throws rather than silently dropping invalid entries", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    const ledgerPath = path.join(bundle, "run-ledger.xml");
    let xml = readFileSync(ledgerPath, "utf8");
    xml = xml.replace("</Verdicts>", `<Verdict outcome="failed" /></Verdicts>`);
    writeFileSync(ledgerPath, xml);
    expect(() => listReviewVerdicts(root, "C-GATE")).toThrow(/ledger\.invalid-verdict/);
  });
});

describe("correction 68 — newest-governs at the section boundary (A32.1)", () => {
  it("duplicate Verdicts sections: refuse; do not permit on first section's pass", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    // A32 fixture: first section pass, second fail — first-wins would permit.
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><C-GATE>`
        + `<Verdicts><Verdict outcome="pass" /></Verdicts>`
        + `<Verdicts><Verdict outcome="fail" /></Verdicts>`
        + `</C-GATE></NgraceRunLedger>`,
    );
    const latest = readLatestReviewVerdict(root, "C-GATE");
    expect(latest.state).toBe("invalid");
    if (latest.state === "invalid") {
      expect(latest.code).toBe("ledger.invalid-verdict");
      expect(latest.detail).toMatch(/duplicate/i);
    }
    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);
    expect(result.verdict).toBeUndefined();
    const reviewReq = result.requirements.find((r) => r.id === "review-verdict");
    expect(reviewReq?.present).toBe(false);
  });

  it("stray non-Verdict child under Verdicts: refuse; do not filter to pass", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><C-GATE>`
        + `<Verdicts><Verdict outcome="pass" /><Bogus /></Verdicts>`
        + `</C-GATE></NgraceRunLedger>`,
    );
    const latest = readLatestReviewVerdict(root, "C-GATE");
    expect(latest.state).toBe("invalid");
    if (latest.state === "invalid") {
      expect(latest.code).toBe("ledger.invalid-verdict");
      expect(latest.detail).toMatch(/Bogus/);
    }
    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);
    expect(result.verdict).toBeUndefined();
  });

  it("silent direction: one well-formed section, newest of several entries governs", () => {
    const root = tempProject();
    activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    recordReviewVerdict(root, "C-GATE", { outcome: "fail" });
    const latest = readLatestReviewVerdict(root, "C-GATE");
    expect(latest.state).toBe("present");
    if (latest.state === "present") {
      expect(latest.verdict.outcome).toBe("fail");
    }
    // fail is a recorded verdict — apply permits under D11 (any recorded outcome).
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("permit");
    expect(evaluateApplyGate(root, "C-GATE").verdict?.outcome).toBe("fail");
  });

  it("silent direction: no Verdicts section is absence, not invalid", () => {
    const root = tempProject();
    activeBundle(root);
    const latest = readLatestReviewVerdict(root, "C-GATE");
    expect(latest.state).toBe("absent");
    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.no-verdict")).toBe(true);
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(false);
  });

  it("duplicate Decisions sections: not a permit; reason reaches readPermittingDecision", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><C-GATE>`
        + `<Decisions><Decision gate="apply" decision="permit" /></Decisions>`
        + `<Decisions><Decision gate="apply" decision="refuse" /></Decisions>`
        + `</C-GATE></NgraceRunLedger>`,
    );
    const decisions = readGateDecisions(root, "C-GATE");
    expect(decisions.state).toBe("invalid");
    if (decisions.state === "invalid") {
      expect(decisions.code).toBe("ledger.invalid-decision");
      expect(decisions.detail).toMatch(/duplicate/i);
    }
    const permit = readPermittingDecision(root, "C-GATE", "apply");
    expect(permit.state).toBe("invalid");
    if (permit.state === "invalid") {
      expect(permit.code).toBe("ledger.invalid-decision");
      expect(permit.detail).toMatch(/duplicate/i);
    }
  });
});

describe("correction 69 — absent Decisions is not applied-without-gate-record (A33.1)", () => {
  it("no Decisions section → absent, not no-permit", () => {
    const root = tempProject();
    activeBundle(root);
    // no run-ledger → no Decisions section
    const permit = readPermittingDecision(root, "C-GATE", "apply");
    expect(permit.state).toBe("absent");
    if (permit.state === "absent") {
      expect(permit.reason).toBe("no-decisions-section");
    }
  });

  it("Decisions section without apply permit → no-permit", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordGateDecision(root, "C-GATE", {
      gate: "approve",
      decision: "permit",
      requirements: [],
    });
    const permit = readPermittingDecision(root, "C-GATE", "apply");
    expect(permit.state).toBe("no-permit");
  });
});

describe("correction 64 — apply requires approved plan, not existsSync", () => {
  it("refuses status=draft plan even when plan.xml exists", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-DRAFT",
      location: "active",
      specStatus: "approved",
      planStatus: "draft",
    });
    recordReviewVerdict(root, "C-DRAFT", { outcome: "pass" });
    const result = evaluateApplyGate(root, "C-DRAFT");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.no-plan")).toBe(true);
    const planReq = result.requirements.find((r) => r.id === "plan-present");
    expect(planReq?.present).toBe(false);
    expect(planReq?.message).toMatch(/draft/);
  });
});

describe("correction 65 — --format json is pure JSON", () => {
  it("archive --format json parses with JSON.parse (no trailing usage)", () => {
    const root = tempProject();
    activeBundle(root);
    const result = runGateCli(
      ["archive", "--change", "C-GATE", "--path", root, "--format", "json", "--record=false"],
      root,
    );
    expect(result.status).toBe(0);
    // Strict parse of entire stdout — fails if usage prose follows the object.
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.decision).toBe("permit");
    expect(result.stdout).not.toMatch(/Usage:/);
  });
});

describe("correction 66 — recorder validates before write and keeps the answer", () => {
  it("pre-existing invalid verdict: gate still answers; decision count does not grow", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    // Seed a clean pass verdict, then corrupt it in place so the tree is invalid.
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    const ledgerPath = path.join(bundle, "run-ledger.xml");
    let xml = readFileSync(ledgerPath, "utf8");
    xml = xml.replace('outcome="pass"', 'outcome="failed"');
    writeFileSync(ledgerPath, xml);
    const before = readFileSync(ledgerPath, "utf8");
    const decisionCountBefore = (before.match(/<Decision\b/g) ?? []).length;

    // Evaluate + attempt record: evaluation must survive recording failure (A31.5).
    const evaluation = evaluateGate(root, "C-GATE", "apply");
    expect(evaluation.decision).toBe("refuse");
    expect(evaluation.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);

    const decision = evaluationToDecision(evaluation)!;
    let recordingError: string | undefined;
    try {
      recordGateDecision(root, "C-GATE", decision);
    } catch (error) {
      recordingError = error instanceof Error ? error.message : String(error);
    }
    expect(recordingError).toBeDefined();
    expect(recordingError).toMatch(/ledger\.invalid-verdict|failed verification/);

    // Prior bytes restored / untouched — no new Decision appended.
    const after = readFileSync(ledgerPath, "utf8");
    const decisionCountAfter = (after.match(/<Decision\b/g) ?? []).length;
    expect(decisionCountAfter).toBe(decisionCountBefore);

    // formatGateEvaluation still surfaces the decision when recordingError is set.
    evaluation.recordingError = recordingError;
    const text = formatGateEvaluation(evaluation);
    expect(text).toContain("Decision: refuse");
    expect(text).toContain("Recording: failed");
  });

  it("CLI apply reports decision when recording fails", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    const ledgerPath = path.join(bundle, "run-ledger.xml");
    let xml = readFileSync(ledgerPath, "utf8");
    xml = xml.replace('outcome="pass"', 'outcome="bogus"');
    writeFileSync(ledgerPath, xml);

    const result = runGateCli(
      ["apply", "--change", "C-GATE", "--path", root, "--format", "json"],
      root,
    );
    // Evaluation is refused (invalid verdict) and recording may also fail — either way JSON has decision.
    expect(result.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.decision).toBe("refuse");
    expect(parsed.ok).toBe(true);
    // Must not be the silent error envelope that loses the answer.
    expect(parsed.gate).toBe("apply");
  });
});

describe("correction 67 — no dead parseGate / void suppression", () => {
  it("command module has no parseGate and no void parseGate", () => {
    const source = readFileSync(path.join(import.meta.dir, "command.ts"), "utf8");
    expect(source).not.toMatch(/\bfunction parseGate\b/);
    expect(source).not.toMatch(/void parseGate/);
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

  /**
   * C-REPORT-HONESTY T-002: honest no-open-epoch detail over orphans (F14),
   * without weakening refuse on real foldable loose events.
   */
  it("AC-TOKEN-ORPHAN-TRIPLE (2): orphan-only run/ permits with message not 'run/ empty' and names orphan", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-ORPHAN",
      location: "archive",
      specStatus: "applied",
      planStatus: "applied",
    });
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-ORPHAN");
    mkdirSync(path.join(bundle, "run"), { recursive: true });
    // Copy shape of live NaN orphan — tests never mutate archive/.
    const liveNan = path.join(
      REPO_ROOT,
      ARTIFACT_DIR,
      "changes/archive/C-TOKEN-INTEGRITY/run/NaN-T-001-opened.xml",
    );
    writeFileSync(path.join(bundle, "run", "NaN-T-001-opened.xml"), readFileSync(liveNan));
    expect(listLooseEvents(bundle)).toHaveLength(0);

    const result = evaluateArchiveGate(root, "C-ORPHAN");
    expect(result.decision).toBe("permit");
    const req = result.requirements.find((r) => r.id === "no-open-epoch");
    expect(req?.present).toBe(true);
    expect(req?.message).not.toBe("run/ empty");
    expect(req?.message).toMatch(/no foldable|foldable/i);
    expect(req?.message).toMatch(/NaN-T-001-opened\.xml/);
  });

  it("AC-ARCHIVE-STILL-REFUSES-LOOSE: ≥1 foldable loose event refuses no-open-epoch", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-LOOSE",
      location: "archive",
      specStatus: "applied",
      planStatus: "applied",
    });
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-LOOSE");
    mkdirSync(path.join(bundle, "run"), { recursive: true });
    writeFileSync(
      path.join(bundle, "run", "3-T-002-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="3" task="T-002" kind="progress"/>`,
    );
    expect(listLooseEvents(bundle).length).toBeGreaterThanOrEqual(1);

    const result = evaluateArchiveGate(root, "C-LOOSE");
    expect(result.decision).toBe("refuse");
    const req = result.requirements.find((r) => r.id === "no-open-epoch");
    expect(req?.present).toBe(false);
    expect(result.issues.some((i) => i.code === "gate.archive.open-epoch")).toBe(true);
  });

  it("AC-MEMBERSHIP-ONE-DEFINITION: evaluateArchiveGate uses listLooseEvents / listRunOrphans from run-membership", () => {
    const coreSrc = readFileSync(path.join(REPO_ROOT, "src/gates/core.ts"), "utf8");
    // Prefer direct import from artifact host (D2 construction).
    expect(coreSrc).toMatch(/listLooseEvents/);
    expect(coreSrc).toMatch(/listRunOrphans/);
    expect(coreSrc).toMatch(/from\s+["']\.\.\/artifact\/run-membership["']/);
    // Predicate remains listLooseEvents length === 0 (message-only change on permit).
    const archiveFn = coreSrc.slice(coreSrc.indexOf("export function evaluateArchiveGate"));
    const body = archiveFn.slice(0, archiveFn.indexOf("\nexport function"));
    expect(body).toMatch(/listLooseEvents\s*\(/);
    expect(body).toMatch(/loose\.length\s*[!=]==?\s*0|loose\.length\s*>\s*0|!open/);
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
