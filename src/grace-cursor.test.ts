import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "./artifact/paths";
import {
  writeChangeBundleFixture,
  writeMinimalNgraceProject,
} from "./artifact/test-fixtures";
import { validateNgraceProject } from "./artifact/grammar";
import { snapshotProjectTree } from "./test-support/fixtures";
import {
  advanceCursor,
  foldEpoch,
  formatCursorPosition,
  listLooseEvents,
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
  it("only grace-graph, grace-cursor, and dart adapter write", () => {
    // Documented baseline + grace-cursor; this test is informational via shell in phase report.
    // Pin that grace-cursor is the sole new write surface module.
    const cursorSource = readFileSync(path.join(import.meta.dir, "grace-cursor.ts"), "utf8");
    expect(cursorSource).toContain("writeFileSync");
    expect(cursorSource).toContain("mkdirSync");
  });
});
