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
  readLedgerVerdictsSurface,
  readLedgerWrapper,
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
    // Honest classification: unreadable is invalid, not collapsed empty list.
    // listReviewVerdicts throws on invalid (existing contract); gate path stays refuse.
    expect(readLatestReviewVerdict(root, "C-GATE").state).toBe("invalid");
    expect(() => listReviewVerdicts(root, "C-GATE")).toThrow(/xml\.parse|unreadable|Invalid/i);
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

/**
 * C-REPORT-HONESTY T-005 / AC-APPLY-VERDICT-DIAGNOSTICS (P0.7).
 * Apply refuse on missing/unusable verdict must name path, count, and why newest failed —
 * not catalog title alone or bare "no Verdicts section entry".
 */
describe("C-REPORT-HONESTY T-005 apply verdict diagnostics (P0.7)", () => {
  function reviewVerdictReq(result: ReturnType<typeof evaluateApplyGate>) {
    return result.requirements.find((r) => r.id === "review-verdict");
  }
  function noVerdictIssue(result: ReturnType<typeof evaluateApplyGate>) {
    return result.issues.find((i) => i.code === "gate.apply.no-verdict");
  }
  function combinedDiagText(result: ReturnType<typeof evaluateApplyGate>): string {
    const req = reviewVerdictReq(result)?.message ?? "";
    const issue = noVerdictIssue(result)?.message ?? "";
    const invalid = result.issues.find((i) => i.code === "gate.apply.invalid-verdict")?.message ?? "";
    return `${req}\n${issue}\n${invalid}`;
  }

  it("no run-ledger.xml: refuse names missing ledger path and count 0", () => {
    const root = tempProject();
    activeBundle(root);
    // Fixture creates no ledger until a writer runs.
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes/active/C-GATE/run-ledger.xml"))).toBe(false);

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(noVerdictIssue(result)).toBeDefined();
    const text = combinedDiagText(result);
    // Must not be catalog-title-only or bare "no Verdicts section entry".
    expect(text).not.toBe("Apply Requires A Recorded Review Verdict");
    expect(text.trim()).not.toBe("no Verdicts section entry");
    expect(text).toMatch(/run-ledger\.xml/);
    expect(text).toMatch(/missing|not found|absent/i);
    expect(text).toMatch(/count\s*=\s*0|0\s*Verdict|Verdict child count=0/i);
    // Path looked at (bundle ledger location).
    expect(text).toMatch(/C-GATE/);
  });

  it("ledger present, no Verdicts section: refuse names path and count 0", () => {
    const root = tempProject();
    activeBundle(root);
    // Create ledger without Verdicts (approve Decision only).
    recordGateDecision(root, "C-GATE", {
      gate: "approve",
      decision: "permit",
      requirements: [],
    });
    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes/active/C-GATE/run-ledger.xml"),
      "utf8",
    );
    expect(ledger).not.toContain("<Verdicts");

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(noVerdictIssue(result)).toBeDefined();
    const text = combinedDiagText(result);
    expect(text).not.toBe("Apply Requires A Recorded Review Verdict");
    expect(text.trim()).not.toBe("no Verdicts section entry");
    expect(text).toMatch(/run-ledger\.xml|looked at/i);
    expect(text).toMatch(/C-GATE/);
    expect(text).toMatch(/count\s*=\s*0|0\s*Verdict|Verdict child count=0/i);
  });

  it("Verdicts present but empty: refuse names path and count 0", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><C-GATE><Verdicts></Verdicts></C-GATE></NgraceRunLedger>`,
    );

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(noVerdictIssue(result)).toBeDefined();
    const text = combinedDiagText(result);
    expect(text).not.toBe("Apply Requires A Recorded Review Verdict");
    expect(text.trim()).not.toBe("no Verdicts section entry");
    expect(text).toMatch(/run-ledger\.xml|looked at/i);
    expect(text).toMatch(/C-GATE/);
    expect(text).toMatch(/count\s*=\s*0|0\s*Verdict|Verdict child count=0/i);
  });

  it("newest entry unreadable: refuse names path, code, and reason", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><C-GATE><Verdicts><Verdict outcome="failed"/></Verdicts></C-GATE></NgraceRunLedger>`,
    );

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);
    const text = combinedDiagText(result);
    expect(text).toMatch(/run-ledger\.xml|looked at/i);
    expect(text).toMatch(/C-GATE/);
    expect(text).toMatch(/ledger\.invalid-verdict/);
    expect(text).toMatch(/outcome=failed|unreadable|did not qualify|invalid/i);
  });

  it("unparseable ledger: invalid-verdict names path and reason; decision stays refuse", () => {
    // Honest classification: unreadable maps to invalid (not collapsed absent/no-verdict).
    // Decision remains refuse (AC-GATE-COMPAT). Count is undetermined — not 0.
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(path.join(bundle, "run-ledger.xml"), "not xml at all <<<");

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);
    expect(noVerdictIssue(result)).toBeUndefined();
    const text = combinedDiagText(result);
    expect(text).toMatch(/run-ledger\.xml|looked at/i);
    expect(text).toMatch(/C-GATE/);
    expect(text).toMatch(/unreadable|xml\.parse|not expected|parse/i);
    // Must not assert a determined zero when nothing was counted.
    expect(text).not.toMatch(/Verdict child count=0/);
  });

  it("wrong change wrapper: invalid-verdict with ledger.bundle-id-mismatch; decision refuse", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><C-OTHER><Verdicts><Verdict outcome="pass"/></Verdicts></C-OTHER></NgraceRunLedger>`,
    );

    const surface = readLedgerVerdictsSurface(root, "C-GATE");
    const latest = readLatestReviewVerdict(root, "C-GATE");
    expect(surface).toEqual(
      expect.objectContaining({ state: "unreadable", code: "ledger.bundle-id-mismatch" }),
    );
    expect(latest).toEqual(
      expect.objectContaining({ state: "invalid", code: "ledger.bundle-id-mismatch" }),
    );

    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("refuse");
    expect(result.issues.some((i) => i.code === "gate.apply.invalid-verdict")).toBe(true);
    expect(noVerdictIssue(result)).toBeUndefined();
  });

  it("corrupt ledger: deliberate regression would permit or throw — refuse holds (AC-GATE-COMPAT)", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    writeFileSync(path.join(bundle, "run-ledger.xml"), "not xml at all <<<");

    let threw = false;
    let result: ReturnType<typeof evaluateApplyGate> | undefined;
    try {
      result = evaluateApplyGate(root, "C-GATE");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result!.decision).toBe("refuse");
    // Not a silent pass / permit on unreadable content.
    expect(result!.decision).not.toBe("permit");
  });

  it("immediate evaluateApplyGate after recordReviewVerdict permits (no flush)", () => {
    const root = tempProject();
    activeBundle(root);
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("refuse");
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    // Immediate — no re-read loop, no delay, no flush.
    const result = evaluateApplyGate(root, "C-GATE");
    expect(result.decision).toBe("permit");
    expect(result.verdict?.outcome).toBe("pass");
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

/**
 * C-FLAG-HONESTY T-002 — F18 gate --record space form.
 * Temp fixtures only; never a live or archived bundle.
 */
function countDecisionElements(ledgerPath: string): number {
  if (!existsSync(ledgerPath)) return 0;
  return (readFileSync(ledgerPath, "utf8").match(/<Decision\b/g) ?? []).length;
}

function fixtureLedgerPath(root: string, changeId = "C-GATE"): string {
  return path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml");
}

describe("C-FLAG-HONESTY T-002 — gate --record space form (F18)", () => {
  it("AC-SPACE-FORM-FAILS-LOUD: --record false exits non-zero, names both working forms, Decision count unchanged", () => {
    const root = tempProject();
    const bundle = activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    // Seed one Decision so "unchanged" is a real equality, not absence→absence.
    recordGateDecision(root, "C-GATE", {
      gate: "approve",
      decision: "permit",
      requirements: [{ id: "no-unresolved-ic-inv-clarification", required: true, present: true, blocking: false }],
    });
    const before = countDecisionElements(ledgerPath);
    expect(before).toBe(1);

    for (const gate of ["approve", "apply", "archive"] as const) {
      const result = runGateCli(
        [gate, "--change", "C-GATE", "--path", root, "--record", "false"],
        root,
      );
      // Exit code is GraceCommandError.exitCode (default 1) via runGraceCommand — exact pin.
      expect(result.status).toBe(1);
      // C-LEGIBLE-FAILURE T-003: message is the single stderr line (not a stack).
      const lines = result.stderr.replace(/\n$/, "").split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("--record=false");
      expect(lines[0]).toContain("--no-record");
      // Actual refuseBooleanSpaceForm wording (not a family of plausible paraphrases).
      expect(lines[0]).toContain("bare `--record` means true");
      expect(result.stderr).not.toMatch(/at refuseBooleanSpaceForm|at async runCommand/);
      expect(countDecisionElements(ledgerPath)).toBe(before);
    }
    // Bundle path still only the seeded Decision (no archive write, no second Decision).
    expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(true);
  });

  it("AC-CHANNEL-JSON-ENVELOPE: --format json + space-form → entire stdout is GraceCommandErrorEnvelope", () => {
    const root = tempProject();
    activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    expect(countDecisionElements(ledgerPath)).toBe(0);

    const result = runGateCli(
      ["approve", "--change", "C-GATE", "--path", root, "--record", "false", "--format", "json"],
      root,
    );
    expect(result.status).toBe(1);
    // Entire stdout must parse — no stack prefix/suffix.
    const body = JSON.parse(result.stdout);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid-arguments");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message).toContain("--record=false");
    expect(result.stdout).not.toMatch(/at refuseBooleanSpaceForm|GraceCommandError:/);
    // AC-CHANNEL-SIDE-EFFECT-HELD: no ledger created when none existed.
    expect(existsSync(ledgerPath)).toBe(false);
    expect(countDecisionElements(ledgerPath)).toBe(0);
  });

  it("AC-CHANNEL-SIDE-EFFECT-HELD: Decision count toBe before/after on space-form refuse", () => {
    const root = tempProject();
    activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    recordGateDecision(root, "C-GATE", {
      gate: "approve",
      decision: "permit",
      requirements: [{ id: "no-unresolved-ic-inv-clarification", required: true, present: true, blocking: false }],
    });
    const before = countDecisionElements(ledgerPath);
    expect(before).toBe(1);

    const result = runGateCli(
      ["approve", "--change", "C-GATE", "--path", root, "--record", "false"],
      root,
    );
    expect(result.status).toBe(1);
    expect(countDecisionElements(ledgerPath)).toBe(before);
  });

  it("AC-BARE-FLAG-STILL-TRUE: bare --record still records (means true)", () => {
    const root = tempProject();
    activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    expect(countDecisionElements(ledgerPath)).toBe(0);

    const result = runGateCli(
      ["approve", "--change", "C-GATE", "--path", root, "--record"],
      root,
    );
    expect(result.status).toBe(0);
    expect(countDecisionElements(ledgerPath)).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/does not accept a space-separated value/);
  });

  it("AC-WORKING-FORMS default-true half: --record=false writes no Decision", () => {
    const root = tempProject();
    activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    expect(countDecisionElements(ledgerPath)).toBe(0);

    const result = runGateCli(
      ["approve", "--change", "C-GATE", "--path", root, "--record=false"],
      root,
    );
    // Counterweight: equals form must not be rejected as the space-form error.
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Decision:\s*permit|decision.*permit/i);
    expect(countDecisionElements(ledgerPath)).toBe(0);
  });

  it("AC-WORKING-FORMS default-true half: --record=true records a Decision", () => {
    const root = tempProject();
    activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    expect(countDecisionElements(ledgerPath)).toBe(0);

    const result = runGateCli(
      ["approve", "--change", "C-GATE", "--path", root, "--record=true"],
      root,
    );
    expect(result.status).toBe(0);
    expect(countDecisionElements(ledgerPath)).toBe(1);
  });

  it("AC-WORKING-FORMS default-true half: --no-record writes no Decision", () => {
    const root = tempProject();
    activeBundle(root);
    const ledgerPath = fixtureLedgerPath(root);
    expect(countDecisionElements(ledgerPath)).toBe(0);

    const result = runGateCli(
      ["approve", "--change", "C-GATE", "--path", root, "--no-record"],
      root,
    );
    expect(result.status).toBe(0);
    expect(countDecisionElements(ledgerPath)).toBe(0);
  });

  it("A31.4: gate approve|apply|archive|verdict still resolve under --record=false", () => {
    const root = tempProject();
    activeBundle(root);
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });

    for (const gate of ["approve", "apply", "archive"] as const) {
      const result = runGateCli(
        [gate, "--change", "C-GATE", "--path", root, "--record=false", "--format", "json"],
        root,
      );
      expect(result.status).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body.ok).toBe(true);
      expect(body.gate).toBe(gate);
      // Must not be the bare parent usage text.
      expect(result.stdout).not.toMatch(/Usage:\s*ngrace gate/);
    }

    const verdict = runGateCli(
      ["verdict", "--change", "C-GATE", "--outcome", "pass", "--path", root, "--format", "json"],
      root,
    );
    expect(verdict.status).toBe(0);
    expect(JSON.parse(verdict.stdout).ok).toBe(true);
  });
});

describe("C-LEGIBLE-FAILURE T-002 — three exits and single classification", () => {
  it("construction: sole readLedgerWrapper export; former null-collapse helper absent from production source", async () => {
    const src = await Bun.file(path.join(import.meta.dir, "ledger.ts")).text();
    expect(src).not.toMatch(/\bwrapperFromLedger\b/);
    expect(src.match(/\bexport function readLedgerWrapper\b/g)?.length).toBe(1);
    // Shared prefix only — surface must not re-implement existsSync on the ledger path.
    const surfaceBody = src.slice(src.indexOf("export function readLedgerVerdictsSurface"));
    const untilNextExport = surfaceBody.slice(0, surfaceBody.indexOf("\nexport function", 1));
    expect(untilNextExport).toContain("readLedgerWrapper");
    expect(untilNextExport).not.toMatch(/existsSync\s*\(/);
  });

  it("AC-THREE-EXITS matrix: missing / unparseable / wrong-wrapper / clean", () => {
    // missing → absent-no-file
    {
      const root = tempProject();
      const bundle = activeBundle(root);
      expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(false);
      const w = readLedgerWrapper(bundle, "C-GATE");
      expect(w).toEqual({ state: "absent-no-file" });
      expect(readLedgerVerdictsSurface(root, "C-GATE")).toEqual({ state: "absent-no-file" });
      expect(readLatestReviewVerdict(root, "C-GATE")).toEqual({ state: "absent" });
    }

    // unparseable → unreadable, not absent
    {
      const root = tempProject();
      const bundle = activeBundle(root);
      writeFileSync(path.join(bundle, "run-ledger.xml"), "not xml at all <<<");
      const w = readLedgerWrapper(bundle, "C-GATE");
      expect(w.state).toBe("unreadable");
      if (w.state === "unreadable") {
        // Exact code, not a parse-family regex: a drift to another parse code is a
        // contract change and must redden here (plan: "exact codes/details where stable").
        expect(w.code).toBe("xml.parse");
        expect(w.detail.length).toBeGreaterThan(0);
      }
      const surface = readLedgerVerdictsSurface(root, "C-GATE");
      expect(surface.state).toBe("unreadable");
      const latest = readLatestReviewVerdict(root, "C-GATE");
      expect(latest.state).toBe("invalid");
      // Discriminating: unreadable is not collapsed to absent.
      expect(latest.state).not.toBe("absent");
    }

    // wrong wrapper → unreadable ledger.bundle-id-mismatch, not absent
    {
      const root = tempProject();
      const bundle = activeBundle(root);
      writeFileSync(
        path.join(bundle, "run-ledger.xml"),
        `<NgraceRunLedger graceVersion="1.0"><C-OTHER><Verdicts><Verdict outcome="pass"/></Verdicts></C-OTHER></NgraceRunLedger>`,
      );
      const w = readLedgerWrapper(bundle, "C-GATE");
      expect(w).toEqual(
        expect.objectContaining({ state: "unreadable", code: "ledger.bundle-id-mismatch" }),
      );
      expect(readLedgerVerdictsSurface(root, "C-GATE")).toEqual(
        expect.objectContaining({ state: "unreadable", code: "ledger.bundle-id-mismatch" }),
      );
      expect(readLatestReviewVerdict(root, "C-GATE")).toEqual(
        expect.objectContaining({ state: "invalid", code: "ledger.bundle-id-mismatch" }),
      );
      const decisions = readGateDecisions(root, "C-GATE");
      expect(decisions).toEqual(
        expect.objectContaining({ state: "invalid", code: "ledger.bundle-id-mismatch" }),
      );
    }

    // clean → ok
    {
      const root = tempProject();
      const bundle = activeBundle(root);
      recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
      const w = readLedgerWrapper(bundle, "C-GATE");
      expect(w.state).toBe("ok");
      if (w.state === "ok") {
        expect(w.wrapper.tag).toBe("C-GATE");
      }
      expect(readLatestReviewVerdict(root, "C-GATE")).toEqual(
        expect.objectContaining({ state: "present" }),
      );
      expect(evaluateApplyGate(root, "C-GATE").decision).toBe("permit");
    }
  });

  it("AC-GATE-COMPAT: green fixture permit/refuse decisions are exact toBe pins", () => {
    const root = tempProject();
    activeBundle(root);
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("refuse");
    recordReviewVerdict(root, "C-GATE", { outcome: "pass" });
    expect(evaluateApplyGate(root, "C-GATE").decision).toBe("permit");
    expect(evaluateApproveGate(root, "C-GATE").decision).toBe("permit");
  });
});
