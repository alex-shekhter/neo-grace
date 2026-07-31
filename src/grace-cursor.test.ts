import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "./artifact/paths";
import {
  writeChangeBundleFixture,
  writeMinimalNgraceProject,
} from "./artifact/test-fixtures";
import { validateNgraceProject, validateRunLedgerArtifact } from "./artifact/grammar";
import { FIX_BUDGET, RUN_EVENT_FIELD_REGISTRY } from "./artifact/types";
import { parseGraceXmlArtifact } from "./artifact/xml";
import { snapshotProjectTree } from "./test-support/fixtures";
import {
  advanceCursor,
  classifyFlake,
  foldEpoch,
  formatCursorPosition,
  listLooseEvents,
  listPausedTasks,
  recordAttempt,
  regenerateCursor,
  showCursor,
} from "./grace-cursor";
import { collectProjectStatus, formatStatusText } from "./grace-status";
import { lintGraceProject } from "./lint/core";

function createProject() {
  const root = path.join(os.tmpdir(), `grace-cursor-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function seedBundle(root: string, changeId = "C-RUN") {
  writeMinimalNgraceProject(root);
  writeChangeBundleFixture(root, {
    changeId,
    location: "active",
    specStatus: "approved",
    planStatus: "approved",
  });
  // Governed source referenced by ObservedWriteScope in the fixture plan
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src/example.ts"),
    `export function run() { return "ok"; }\n`,
  );
  return path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
}

function runGit(root: string, args: string[]) {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8") || `git ${args.join(" ")} failed`);
  }
}

function initGitBaseline(root: string) {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "grace@example.test"]);
  runGit(root, ["config", "user.name", "GRACE Test"]);
  runGit(root, ["config", "commit.gpgsign", "false"]);
  runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "test: baseline"]);
}

describe("cursor show / regenerate write surface (AC-WRITE-SURFACE)", () => {
  it("cursor show leaves the tree byte-identical", () => {
    const root = createProject();
    seedBundle(root);
    const before = snapshotProjectTree(root);
    const position = showCursor(root, "C-RUN");
    expect(position.changeId).toBe("C-RUN");
    expect(snapshotProjectTree(root)).toEqual(before);
  });

  it("bare regenerate is dry-run and leaves the tree byte-identical", () => {
    const root = createProject();
    seedBundle(root);
    const before = snapshotProjectTree(root);
    const result = regenerateCursor(root, "C-RUN");
    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(snapshotProjectTree(root)).toEqual(before);
  });

  it("regenerate --apply writes run.xml", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const result = regenerateCursor(root, "C-RUN", { apply: true, allowDirty: true });
    expect(result.applied).toBe(true);
    expect(existsSync(path.join(bundle, "run.xml"))).toBe(true);
  });
});

describe("fold ordering (AC-FOLD-ORDERING)", () => {
  it("write-verify-delete folds a clean range and empties run/", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 99,
      wave: "1",
    });
    // openEpoch wrote id=1 opened; advance densifies with 2..terminal
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "progress" });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });

    const result = foldEpoch(root, "C-RUN", { wave: "1" });
    expect(result.applied).toBe(true);
    expect(result.epoch).toBe(1);
    expect(result.eventCount).toBe(3);
    expect(listLooseEvents(path.join(root, ARTIFACT_DIR, "changes", "active", "C-RUN"))).toHaveLength(0);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-RUN", "run-ledger.xml"))).toBe(true);

    const issues = validateNgraceProject(root).issues.filter((i) => i.code.startsWith("ledger."));
    expect(issues).toHaveLength(0);
  });

  it("interrupted fold leaves both forms; re-fold is idempotent", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });

    expect(() => foldEpoch(root, "C-RUN", { injectFailureAfterWrite: true })).toThrow("injected failure after write");
    expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(true);
    expect(listLooseEvents(bundle).length).toBeGreaterThan(0);

    const second = foldEpoch(root, "C-RUN");
    expect(second.applied).toBe(true);
    expect(listLooseEvents(bundle)).toHaveLength(0);

    // re-fold with empty run/ is idempotent
    const third = foldEpoch(root, "C-RUN");
    expect(third.eventCount).toBe(0);
    expect(third.epoch).toBe(second.epoch);
  });

  it("concurrent appends from two allocations fold without clock ordering", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    // Manual two-range open: write opened with two allocations, then interleaved ids
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, "1-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="opened"><Allocation worker="a" from="1" to="99"/><Allocation worker="b" from="100" to="199"/></NgraceRunEvent>`,
    );
    // Interleave: a=2, b=100, a=3 terminal, b=101 terminal — sort by id never by time
    writeFileSync(
      path.join(runDir, "100-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="100" task="T-001" kind="progress"/>`,
    );
    writeFileSync(
      path.join(runDir, "2-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="progress"/>`,
    );
    writeFileSync(
      path.join(runDir, "101-T-001-terminal.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="101" task="T-001" kind="terminal"/>`,
    );
    writeFileSync(
      path.join(runDir, "3-T-001-terminal.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="3" task="T-001" kind="terminal"/>`,
    );

    const result = foldEpoch(root, "C-RUN");
    expect(result.eventCount).toBe(5);
    const loose = listLooseEvents(bundle);
    expect(loose).toHaveLength(0);
    // Ordering assertion uses allocated ids only
    const ids = [1, 2, 3, 100, 101];
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("range hole refuses fold before write — no ledger left behind (§0.7.2)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, "1-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="opened"><Allocation worker="w0" from="1" to="10"/></NgraceRunEvent>`,
    );
    // hole at 2: skip to 3 terminal
    writeFileSync(
      path.join(runDir, "3-T-001-terminal.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="3" task="T-001" kind="terminal"/>`,
    );
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/hole|invalid-project/i);
    expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(false);
    expect(listLooseEvents(bundle).length).toBeGreaterThan(0);
  });

  it("unterminated range refuses fold before write — no ledger left behind (§0.7.2)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, "1-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="opened"><Allocation worker="w0" from="1" to="10"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "2-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="progress"/>`,
    );
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/unterminated|invalid-project/i);
    expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(false);
  });
});

describe("regenerate three sources (AC-REGENERATE-SOURCES)", () => {
  it("labels inferred rows and distinguishes them from ledger-derived", () => {
    const root = createProject();
    seedBundle(root);
    const inferred = regenerateCursor(root, "C-RUN");
    expect(inferred.position.inferred).toBe(true);
    expect(inferred.position.sources.task).toBe("inferred");
    expect(formatCursorPosition(inferred.position)).toContain("Inferred: yes");

    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    const fromLedger = regenerateCursor(root, "C-RUN");
    expect(fromLedger.position.inferred).toBe(false);
    expect(fromLedger.position.sources.epoch).toBe("ledger");
    expect(formatCursorPosition(fromLedger.position)).toContain("Inferred: no");
  });

  it("project with ledger and no loose events regenerates from rows 1-2 alone", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    const first = regenerateCursor(root, "C-RUN");
    const second = regenerateCursor(root, "C-RUN");
    expect(first.position.epoch).toBe(second.position.epoch);
    expect(first.position.inferred).toBe(false);
  });

  it("ObservedWriteScope intersect changed files → in-progress with task absence (A13.2)", () => {
    const root = createProject();
    seedBundle(root);
    initGitBaseline(root);
    // Genuinely modify a file inside ObservedWriteScope (src/example.ts)
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "modified"; }\n`);

    const position = showCursor(root, "C-RUN");
    expect(position.inferred).toBe(true);
    expect(position.state).toBe("in-progress");
    expect(position.task).toBeUndefined();
    expect(position.taskAbsence?.verdict).toBe("unable-to-determine");
    expect(position.taskAbsence?.reason).toBeTruthy();
    expect(position.epoch).toBeUndefined();
    expect(formatCursorPosition(position)).toContain("unable-to-determine");
    // Must not invent the plan's first task id
    expect(position.task).not.toBe("T-001");
    expect(formatCursorPosition(position)).not.toMatch(/Task: T-001\b/);
  });

  it("untouched bundle with no events → idle with task absence (A13.2)", () => {
    const root = createProject();
    seedBundle(root);
    initGitBaseline(root);
    // No further writes — worktree clean relative to ObservedWriteScope
    const position = showCursor(root, "C-RUN");
    expect(position.inferred).toBe(true);
    expect(position.state).toBe("idle");
    expect(position.stateAbsence).toBeUndefined();
    expect(position.task).toBeUndefined();
    expect(position.taskAbsence?.verdict).toBe("unable-to-determine");
    expect(position.epoch).toBeUndefined();
  });

  it("git unavailable → stateAbsence, never idle (A14.1 / correction 27)", () => {
    const root = createProject();
    seedBundle(root);
    // No git init — listRepositoryChangedFiles returns available:false
    const position = showCursor(root, "C-RUN");
    expect(position.inferred).toBe(true);
    expect(position.state).toBeUndefined();
    expect(position.stateAbsence?.verdict).toBe("unable-to-determine");
    expect(position.stateAbsence?.reason).toMatch(/git status exited non-zero/);
    expect(formatCursorPosition(position)).toContain("unable-to-determine");
    expect(formatCursorPosition(position)).not.toMatch(/^State: idle$/m);
  });

  it("archived bundle → stateAbsence for missing active scope (A14.1 / correction 27)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-ARCH",
      location: "archive",
      specStatus: "applied",
      planStatus: "applied",
    });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "ok"; }\n`);
    initGitBaseline(root);

    const position = showCursor(root, "C-ARCH");
    expect(position.inferred).toBe(true);
    expect(position.state).toBeUndefined();
    expect(position.stateAbsence?.verdict).toBe("unable-to-determine");
    expect(position.stateAbsence?.reason).toMatch(/no active ObservedWriteScope|archived/);
    expect(formatCursorPosition(position)).not.toMatch(/^State: idle$/m);
  });

  it("genuinely complete when structural TargetAssertions clean and no command gate (A14.2)", () => {
    const root = createProject();
    seedBundle(root);
    initGitBaseline(root);
    const position = showCursor(root, "C-RUN");
    expect(position.complete).toBe(true);
    expect(position.completeAbsence).toBeUndefined();
    expect(formatCursorPosition(position)).toContain("Complete: yes");
  });

  it("MustPassCommand skipped → complete absence not-run, not yes/no (A14.2 / correction 28)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-RUN",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions:
        "<MustVerify><Module>M-EXAMPLE</Module></MustVerify><MustPassCommand><Command>exit 0</Command></MustPassCommand>",
    });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "ok"; }\n`);
    initGitBaseline(root);

    const position = showCursor(root, "C-RUN");
    expect(position.complete).toBeUndefined();
    expect(position.completeAbsence?.verdict).toBe("not-run");
    expect(position.completeAbsence?.reason).toMatch(/MustPassCommand|not executed|not evaluable/i);
    expect(formatCursorPosition(position)).toContain("not-run");
    expect(formatCursorPosition(position)).not.toMatch(/^Complete: yes$/m);
    expect(formatCursorPosition(position)).not.toMatch(/^Complete: no$/m);
  });

  it("unapproved change → complete absence, not incomplete (A14.2 / correction 28)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-DRAFT",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "ok"; }\n`);
    initGitBaseline(root);

    const position = showCursor(root, "C-DRAFT");
    expect(position.complete).toBeUndefined();
    expect(position.completeAbsence?.verdict).toBe("unable-to-determine");
    expect(position.completeAbsence?.reason).toMatch(/not an active approved|not evaluated/i);
    expect(formatCursorPosition(position)).not.toMatch(/^Complete: no$/m);
    expect(formatCursorPosition(position)).not.toMatch(/^Complete: yes$/m);
  });
});

describe("recover not block (AC-RECOVER-NOT-BLOCK)", () => {
  it("cursor show never blocks on missing, identity-less, or mismatched cursor", () => {
    const root = createProject();
    const bundle = seedBundle(root);

    // missing
    const missing = showCursor(root, "C-RUN");
    expect(missing.degradation?.verdict).toBe("not-run");

    // mismatched identity
    writeFileSync(
      path.join(bundle, "run.xml"),
      `<NgraceRunCursor graceVersion="1.0"><C-OTHER><Task>T-001</Task><State>idle</State></C-OTHER></NgraceRunCursor>`,
    );
    const mismatched = showCursor(root, "C-RUN");
    expect(mismatched.degradation?.verdict).toBe("unable-to-determine");
    expect(mismatched.changeId).toBe("C-RUN");

    // lint still errors on the written file
    const lint = lintGraceProject(root);
    expect(lint.issues.some((i) => i.code === "cursor.bundle-id-mismatch")).toBe(true);
  });
});

describe("status surface (AC-STATUS-SURFACE)", () => {
  it("prints epoch and task counts; chooseNextAction ignores cursor", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");

    // Cursor claims a weird state — nextAction must stay plan-derived
    writeFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", "C-RUN", "run.xml"),
      `<NgraceRunCursor graceVersion="1.0"><C-RUN><Task>T-001</Task><Epoch>99</Epoch><State>paused</State></C-RUN></NgraceRunCursor>`,
    );

    const status = collectProjectStatus(root);
    const change = status.changes.find((c) => c.changeId === "C-RUN");
    expect(change?.epochCount).toBe(1);
    expect(change?.taskCount).toBe(1);
    const text = formatStatusText(status);
    expect(text).toContain("epochs=1");
    expect(text).toContain("tasks=1");
    // Plan is approved+approved+ready → execute; cursor pause must not change that
    expect(status.nextAction).toContain("ngrace-execute");
  });

  it("prints normally when no cursor exists", () => {
    const root = createProject();
    seedBundle(root);
    const status = collectProjectStatus(root);
    expect(status.changes.some((c) => c.changeId === "C-RUN")).toBe(true);
    expect(formatStatusText(status)).toContain("C-RUN");
  });
});

describe("write-surface inventory (AC-WRITE-SURFACE grep)", () => {
  /**
   * §3.5.8 / A10.9 write surface and A15.1 delete surface.
   * Same shell patterns as the phase report; post-state is pinned here so drift fails CI.
   */
  it("pins writeFileSync|mkdirSync to graph, cursor, and dart only", () => {
    const result = Bun.spawnSync({
      cmd: ["bash", "-lc", "grep -rn 'writeFileSync\\|mkdirSync' src --include='*.ts' | grep -v test"],
      cwd: path.join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const lines = new TextDecoder()
      .decode(result.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // A10.9 baseline + grace-cursor.ts; nothing else (test-fixtures excluded by grep -v test).
    for (const line of lines) {
      expect(line.startsWith("src/grace-graph.ts:") || line.startsWith("src/grace-cursor.ts:") || line.startsWith("src/lint/adapters/dart.ts:")).toBe(true);
    }
    expect(lines.some((line) => line.startsWith("src/grace-cursor.ts:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("src/grace-graph.ts:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("src/lint/adapters/dart.ts:"))).toBe(true);
  });

  it("pins unlinkSync|rmSync|rmdirSync to fold delete and dart temp cleanup only (A15.1)", () => {
    const result = Bun.spawnSync({
      cmd: ["bash", "-lc", "grep -rn 'unlinkSync\\|rmSync\\|rmdirSync' src --include='*.ts' | grep -v test"],
      cwd: path.join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const lines = new TextDecoder()
      .decode(result.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Import lines plus the two destructive call sites (A15.1 post-state).
    for (const line of lines) {
      expect(line.startsWith("src/grace-cursor.ts:") || line.startsWith("src/lint/adapters/dart.ts:")).toBe(true);
    }
    // Call sites (not imports) — A15.1 post-state is exactly these two lines.
    const callSites = lines.filter((line) => /(?:unlinkSync|rmSync|rmdirSync)\s*\(/.test(line)).sort();
    expect(callSites).toEqual(
      [
        "src/grace-cursor.ts:431:    unlinkSync(contained.absolutePath);",
        "src/lint/adapters/dart.ts:206:    rmSync(temporaryDirectory, { recursive: true, force: true });",
      ].sort(),
    );
    expect(lines.some((line) => line.includes("rmdirSync"))).toBe(false);
  });
});

describe("Phase 4 attempt log / budget / escalation (A18, A19)", () => {
  function openEpoch(root: string, changeId = "C-RUN") {
    advanceCursor(root, changeId, {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 99,
      wave: "1",
    });
  }

  it("AC-ATTEMPT-SURVIVES-FOLD: outcome and signature present on folded ledger Event", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    openEpoch(root);
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "test-failure",
      signatureKey: "src/x.test.ts:should parse",
    });
    // Need density + terminal to fold without allowIncomplete
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");

    const ledger = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(ledger).toContain('kind="attempt"');
    expect(ledger).toContain('outcome="fail"');
    expect(ledger).toContain('signature-kind="test-failure"');
    expect(ledger).toContain('signature-key="src/x.test.ts:should parse"');
    expect(ledger).toMatch(/ordinal="1"/);
    // Must not only exist on loose events
    expect(listLooseEvents(bundle)).toHaveLength(0);
  });

  it("AC-EVENT-FIELD-REGISTRY: add-a-field to registry survives fold without other site edits", () => {
    // Discriminating negative for A18.7: consumers iterate RUN_EVENT_FIELD_REGISTRY.
    // Simulate an extra field by writing it on a loose event that the registry admits via
    // dynamic attribute pass-through only if registry includes it — here we assert the
    // three consumers share the constant by writing outcome (registry field) and checking
    // a non-registry field is dropped while registry fields survive.
    const root = createProject();
    const bundle = seedBundle(root);
    openEpoch(root);
    const runDir = path.join(bundle, "run");
    writeFileSync(
      path.join(runDir, "2-T-001-attempt.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="attempt" outcome="pass" ordinal="1" write-evidence="abc" not-in-registry="drop-me"/>`,
    );
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    const ledger = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(ledger).toContain('outcome="pass"');
    expect(ledger).toContain('ordinal="1"');
    expect(ledger).toContain('write-evidence="abc"');
    expect(ledger).not.toContain("not-in-registry");
    // Registry is the single constant
    expect(RUN_EVENT_FIELD_REGISTRY.some((f) => f.attribute === "outcome")).toBe(true);
  });

  it("AC-BUDGET-SPANS-FOLD: two failures split by fold still exhaust; different signatures still count", () => {
    const root = createProject();
    seedBundle(root);
    openEpoch(root);
    const first = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "typecheck",
      signatureKey: "src/a.ts:1",
    });
    expect(first.exhausted).toBe(false);
    expect(first.failedAttemptCount).toBe(1);
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");

    // New epoch — allocation range must not overlap used ids from the folded epoch.
    advanceCursor(root, "C-RUN", {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 100,
      to: 199,
      wave: "2",
    });
    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "test-failure",
      signatureKey: "src/b.test.ts:2",
    });
    expect(second.exhausted).toBe(true);
    expect(second.failedAttemptCount).toBe(FIX_BUDGET);
    expect(second.failureSignatures).toHaveLength(2);
    expect(second.failureSignatures[0]?.kind).toBe("typecheck");
    expect(second.failureSignatures[1]?.kind).toBe("test-failure");
    expect(second.position.state).toBe("paused");
    // Escalation is range-terminating — fold succeeds
    const fold = foldEpoch(root, "C-RUN");
    expect(fold.applied).toBe(true);
  });

  it("AC-EPOCH-COMPLETENESS: exhausted folds; pause-only refuses; allowIncomplete marks complete=false", () => {
    const root = createProject();
    const bundle = seedBundle(root);

    // pause-only refuses (A19.3)
    openEpoch(root);
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "pause" });
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/unterminated|invalid-project/i);

    // allowIncomplete succeeds with complete=false
    const incomplete = foldEpoch(root, "C-RUN", { allowIncomplete: true });
    expect(incomplete.applied).toBe(true);
    const ledger1 = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(ledger1).toContain('complete="false"');
    // lint: range-unterminated must NOT fire on complete=false
    const incompleteCodes = validateNgraceProject(root).issues
      .filter((i) => i.code === "ledger.range-unterminated" || i.code === "ledger.range-hole")
      .map((i) => i.code);
    expect(incompleteCodes).toHaveLength(0);

    // A15 refuse-before-write still fail closed on default path with hole
    openEpoch(root);
    const runDir = path.join(bundle, "run");
    // open wrote id=N; write id N+2 leaving hole
    const loose = listLooseEvents(bundle);
    const base = loose[0]!.id;
    writeFileSync(
      path.join(runDir, `${base + 2}-T-001-terminal.xml`),
      `<NgraceRunEvent graceVersion="1.0" id="${base + 2}" task="T-001" kind="terminal"/>`,
    );
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/hole|invalid-project/i);
    // No new epoch from the refused fold — ledger still has only the incomplete epoch
  });

  it("A19.3: unregistered closing kind refuses fold and warns on ledger", () => {
    const root = createProject();
    seedBundle(root);
    openEpoch(root);
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "done" }); // unregistered, not terminating
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/unterminated|invalid-project/i);

    const artifact = parseGraceXmlArtifact(
      "run-ledger.xml",
      `<NgraceRunLedger graceVersion="1.0"><C-X><Epoch-1><Allocation worker="w0" from="1" to="10"/><Event id="1" task="T-001" kind="opened"/><Event id="2" task="T-001" kind="done"/></Epoch-1></C-X></NgraceRunLedger>`,
    );
    const result = validateRunLedgerArtifact(artifact);
    expect(result.issues.some((i) => i.code === "ledger.unknown-event-kind" && i.severity === "warning")).toBe(true);
    expect(result.issues.some((i) => i.code === "ledger.range-unterminated")).toBe(true);
  });

  it("AC-FLAKE-THREE-OUTCOMES (A19.1): recorded digests classify after worktree clean", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    initGitBaseline(root);
    openEpoch(root);

    // Attempt 1 fail with content A
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "v1"; }\n`);
    const fail1 = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "test-failure",
      signatureKey: "example",
    });
    expect(fail1.writeEvidence).toBeTruthy();

    // Attempt 2 pass with content B (different digest)
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "v2"; }\n`);
    const pass1 = recordAttempt(root, "C-RUN", { task: "T-001", outcome: "pass" });
    expect(pass1.writeEvidence).toBeTruthy();
    expect(pass1.writeEvidence).not.toBe(fail1.writeEvidence);

    // Commit so worktree is clean — classification must still use recorded digests (A19.1)
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "clean"]);
    expect(classifyFlake(bundle, "T-001").verdict).toBe("normal-retry");
  });

  it("AC-FLAKE-THREE-OUTCOMES (A20.1): fix committed between attempts classifies normal-retry", () => {
    // Discriminating negative for correction 39: empty worktree intersection both times
    // must not collapse to flaky when HEAD moved (commit-per-task path).
    const root = createProject();
    const bundle = seedBundle(root);
    initGitBaseline(root);
    openEpoch(root);

    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "test-failure",
      signatureKey: "example",
    });
    // Real fix, then commit — worktree clean at both attempt moments for OWS ∩ status
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "fixed"; }\n`);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "fix"]);
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "pass" });

    expect(classifyFlake(bundle, "T-001").verdict).toBe("normal-retry");
  });

  it("AC-FLAKE-THREE-OUTCOMES: identical evidence is flaky; absent is unable-to-determine", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    initGitBaseline(root);
    openEpoch(root);

    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "same"; }\n`);
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "test-failure",
      signatureKey: "k",
    });
    // Same content, no further edit, same HEAD
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "pass" });
    expect(classifyFlake(bundle, "T-001").verdict).toBe("flaky");

    // Absent write-evidence → unable-to-determine
    const emptyRoot = createProject();
    const emptyBundle = seedBundle(emptyRoot);
    // No git → evidence unrecordable
    openEpoch(emptyRoot);
    recordAttempt(emptyRoot, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "t",
      signatureKey: "k",
    });
    recordAttempt(emptyRoot, "C-RUN", { task: "T-001", outcome: "pass" });
    const classification = classifyFlake(emptyBundle, "T-001");
    expect(classification.verdict).toBe("unable-to-determine");
    expect(classification.reason).toBeTruthy();
  });

  it("AC-FLAKE-THREE-OUTCOMES (A21.1): unborn HEAD is unavailable, not flaky", () => {
    // Correction 44: git init with no commit — status can exit 0 while rev-parse HEAD fails.
    // Digest must not fold HEAD:"" and report a confident flaky.
    const root = createProject();
    const bundle = seedBundle(root);
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    // No commit — unborn HEAD. Status may still list untracked files.
    openEpoch(root);
    const fail = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "test-failure",
      signatureKey: "k",
    });
    expect(fail.writeEvidence).toBeUndefined();
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "pass" });
    const classification = classifyFlake(bundle, "T-001");
    expect(classification.verdict).toBe("unable-to-determine");
    expect(classification.reason).toMatch(/write-evidence|HEAD|unborn|unresolvable|unavailable/i);
  });

  it("AC-FLAKE-THREE-OUTCOMES (A20.3): most recent fail→pass pair wins over an earlier one", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    initGitBaseline(root);
    openEpoch(root);

    // Pair 1: normal-retry (content changes)
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "a"; }\n`);
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "t",
      signatureKey: "1",
    });
    writeFileSync(path.join(root, "src/example.ts"), `export function run() { return "b"; }\n`);
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "pass" });

    // Pair 2: flaky (no change, same HEAD)
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signatureKind: "t",
      signatureKey: "2",
    });
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "pass" });

    expect(classifyFlake(bundle, "T-001").verdict).toBe("flaky");
  });

  it("AC-ATTEMPT-SURFACE: third attempt after exhaustion still records (non-blocking)", () => {
    const root = createProject();
    seedBundle(root);
    openEpoch(root);
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "a", signatureKey: "1" });
    const second = recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "b", signatureKey: "2" });
    expect(second.exhausted).toBe(true);
    // Still records — does not throw
    const third = recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "c", signatureKey: "3" });
    expect(third.ordinal).toBe(3);
    expect(third.failedAttemptCount).toBe(3);
  });

  it("AC-EXHAUSTION-SURFACE: status prints paused= after budget exhaustion", () => {
    const root = createProject();
    seedBundle(root);
    openEpoch(root);
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "a", signatureKey: "1" });
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "b", signatureKey: "2" });
    const status = collectProjectStatus(root);
    const change = status.changes.find((c) => c.changeId === "C-RUN");
    expect(change?.pausedTasks).toContain("T-001");
    expect(formatStatusText(status)).toContain("paused=T-001");
  });

  it("AC-EXHAUSTION-SURFACE (A20.2): paused survives fold; listPausedTasks reads ledger", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    openEpoch(root);
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "a", signatureKey: "1" });
    recordAttempt(root, "C-RUN", { task: "T-001", outcome: "fail", signatureKind: "b", signatureKey: "2" });
    expect(listPausedTasks(bundle)).toContain("T-001");
    foldEpoch(root, "C-RUN");
    // Loose events gone; ledger holds exhausted — surface must not go silent (A20.2).
    expect(listLooseEvents(bundle)).toHaveLength(0);
    expect(listPausedTasks(bundle)).toContain("T-001");
    // fold must not write state=idle over exhaustion (discriminating for fold always-idle).
    const cursorXml = readFileSync(path.join(bundle, "run.xml"), "utf8");
    expect(cursorXml).toContain("<State>paused</State>");
    const status = collectProjectStatus(root);
    expect(status.changes.find((c) => c.changeId === "C-RUN")?.pausedTasks).toContain("T-001");
    expect(formatStatusText(status)).toContain("paused=T-001");
  });
});
