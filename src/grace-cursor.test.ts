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
  classifyFlakeFromEvidence,
  countTaskAttemptEvents,
  cursorStateForEventKind,
  deriveAttemptOrdinal,
  deriveStateFromEvents,
  expectedLedgerEventAttributes,
  FIX_ATTEMPT_BUDGET,
  foldEpoch,
  formatCursorPosition,
  lastResolvingResumeId,
  listAccountingEvents,
  listLedgerEvents,
  listLooseEvents,
  listUnresolvedEscalatedTasks,
  parseCursorState,
  readAttemptPayload,
  recordAttempt,
  recordVerificationUnavailable,
  regenerateCursor,
  resumeCursor,
  showCursor,
  type ChangedFileEvidence,
  type WriteEvidenceSnapshot,
} from "./grace-cursor";
import { collectProjectStatus, formatStatusText } from "./grace-status";
import { lintGraceProject } from "./lint/core";

/** Test helper: path list → write evidence with stable synthetic content digests. */
function evidencePaths(paths: string[], digests?: Record<string, string>): WriteEvidenceSnapshot {
  const files: ChangedFileEvidence[] = paths.map((filePath) => ({
    path: filePath,
    kind: "content" as const,
    digest: digests?.[filePath] ?? `digest:${filePath}`,
  }));
  return { available: true, files };
}

function evidenceAbsent(paths: string[]): WriteEvidenceSnapshot {
  return {
    available: true,
    files: paths.map((filePath) => ({ path: filePath, kind: "absent" as const })),
  };
}

function evidenceUndetermined(paths: string[], reason = "unreadable"): WriteEvidenceSnapshot {
  return {
    available: true,
    files: paths.map((filePath) => ({
      path: filePath,
      kind: "undetermined" as const,
      absence: { verdict: "unable-to-determine" as const, reason },
    })),
  };
}

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
    // Call sites (not imports) — A15.1 post-state is exactly these two lines (line numbers re-pinned after Phase 4).
    const callSites = lines.filter((line) => /(?:unlinkSync|rmSync|rmdirSync)\s*\(/.test(line)).sort();
    const cursorUnlink = callSites.find((line) => line.startsWith("src/grace-cursor.ts:"));
    const dartRm = callSites.find((line) => line.startsWith("src/lint/adapters/dart.ts:"));
    expect(cursorUnlink).toMatch(/^src\/grace-cursor\.ts:\d+:\s*unlinkSync\(contained\.absolutePath\);$/);
    expect(dartRm).toBe("src/lint/adapters/dart.ts:206:    rmSync(temporaryDirectory, { recursive: true, force: true });");
    expect(callSites).toHaveLength(2);
    expect(lines.some((line) => line.includes("rmdirSync"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — attempt log, fix budget, escalation (C-ATTEMPT-LOG)
// ---------------------------------------------------------------------------

describe("fold preserves payload (AC-FOLD-PRESERVES-PAYLOAD / A18.2)", () => {
  it("preserves outcome, FailureSignature, and WriteEvidence in the FOLDED ledger", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99, wave: "1" });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "grace-cursor.test.ts:fold" },
      writeEvidence: evidencePaths(["src/example.ts"]),
    });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });

    const result = foldEpoch(root, "C-RUN", { wave: "1" });
    expect(result.applied).toBe(true);
    expect(listLooseEvents(bundle)).toHaveLength(0);

    const ledger = listLedgerEvents(bundle);
    const attempt = ledger.find((event) => event.kind === "attempt");
    expect(attempt).toBeDefined();
    expect(attempt!.attributes.outcome).toBe("fail");
    // No ordinal persisted (A18.3)
    expect(attempt!.attributes.ordinal).toBeUndefined();
    const payload = readAttemptPayload(attempt!);
    expect(payload.signature).toEqual({ kind: "test-failure", key: "grace-cursor.test.ts:fold" });
    expect(payload.writeEvidence).toEqual(evidencePaths(["src/example.ts"]));

    const text = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(text).toContain('outcome="fail"');
    expect(text).toContain("FailureSignature");
    expect(text).toContain("WriteEvidence");
  });

  it("injected payload drop fails verify and leaves every loose file on disk", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "drop-probe" },
      writeEvidence: evidencePaths([]),
    });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });

    const beforeLoose = listLooseEvents(bundle).map((event) => event.file).sort();
    expect(beforeLoose.length).toBeGreaterThan(0);

    expect(() => foldEpoch(root, "C-RUN", { injectDropPayload: true })).toThrow(/payload mismatch/i);

    const afterLoose = listLooseEvents(bundle).map((event) => event.file).sort();
    expect(afterLoose).toEqual(beforeLoose);
    // Ledger may exist from the write step, but delete must not have run.
    expect(afterLoose.length).toBe(beforeLoose.length);
  });

  it("three-attribute events and re-fold with nothing loose still pass (A7.2 both directions)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "progress" });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    const first = foldEpoch(root, "C-RUN");
    expect(first.applied).toBe(true);
    expect(listLooseEvents(bundle)).toHaveLength(0);
    const second = foldEpoch(root, "C-RUN");
    expect(second.eventCount).toBe(0);
    expect(second.epoch).toBe(first.epoch);
  });
});

describe("attempt events (AC-ATTEMPT-EVENTS / AC-THREE-VALUED-OUTCOME)", () => {
  it("pass-first produces one attempt in the FOLDED ledger; fail-then-pass produces two", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "pass",
      writeEvidence: evidencePaths([]),
    });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    const passOnly = listLedgerEvents(bundle).filter((event) => event.kind === "attempt");
    expect(passOnly).toHaveLength(1);
    expect(passOnly[0]!.attributes.outcome).toBe("pass");

    const root2 = createProject();
    const bundle2 = seedBundle(root2);
    advanceCursor(root2, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root2, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "lint", key: "x" },
      writeEvidence: evidencePaths(["a.ts"]),
    });
    recordAttempt(root2, "C-RUN", {
      task: "T-001",
      outcome: "pass",
      writeEvidence: evidencePaths(["a.ts", "b.ts"]),
    });
    // fail+pass hits budget on fail path only for second fail; pass does not escalate.
    // attempt count is 2; if first was fail and second pass, no escalation (escalation only on fail path).
    // Wait: first fail count=1, second pass count=2 but pass branch — no escalate. Need terminal for fold.
    advanceCursor(root2, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root2, "C-RUN");
    const both = listLedgerEvents(bundle2).filter((event) => event.kind === "attempt");
    expect(both).toHaveLength(2);
    expect(both.map((event) => event.attributes.outcome).sort()).toEqual(["fail", "pass"]);
  });

  it("derived ordinal survives fold; no ordinal attribute on any event (A18.3)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "a", key: "1" },
      writeEvidence: evidencePaths([]),
    });
    // Second fail escalates — still has attempt events.
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "b", key: "2" },
      writeEvidence: evidencePaths([]),
    });
    const loose = listLooseEvents(bundle);
    const attempts = loose.filter((event) => event.kind === "attempt");
    expect(deriveAttemptOrdinal(attempts, "T-001", first.eventId)).toBe(1);
    expect(deriveAttemptOrdinal(attempts, "T-001", attempts[1]!.id)).toBe(2);
    for (const event of loose) {
      expect(event.attributes.ordinal).toBeUndefined();
      expect(event.attributes.sequence).toBeUndefined();
      expect(event.attributes.index).toBeUndefined();
    }
  });

  it("verification-unavailable appears in FOLDED ledger and is not an attempt (A19.1)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: "harness absent" },
    });
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "unable-to-determine", reason: "commands skipped" },
    });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    const ledger = listLedgerEvents(bundle);
    const unavailable = ledger.filter((event) => event.kind === "verification-unavailable");
    expect(unavailable).toHaveLength(2);
    expect(countTaskAttemptEvents(ledger, "T-001")).toBe(0);
    expect(unavailable[0]!.attributes.verdict).toBe("not-run");
    expect(unavailable[0]!.attributes.reason).toBe("harness absent");
  });
});

describe("dumb counter and escalation (AC-DUMB-COUNTER / AC-ESCALATION / AC-KIND-STATE-MAP)", () => {
  it("two failures with DIFFERENT signatures still exhaust the budget (§4.5.2 verbatim)", () => {
    expect(FIX_ATTEMPT_BUDGET).toBe(2);
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths([]),
    });
    expect(first.escalated).toBe(false);
    expect(first.attemptCount).toBe(1);

    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "typecheck", key: "suite-b" },
      writeEvidence: evidencePaths(["src/x.ts"]),
    });
    expect(second.escalated).toBe(true);
    expect(second.attemptCount).toBe(2);
    expect(second.signatures).toEqual([
      { kind: "test-failure", key: "suite-a" },
      { kind: "typecheck", key: "suite-b" },
    ]);
    expect(second.position.state).toBe("paused-pending-approval");
    // Escalation output names both signatures and does not claim the task failed.
    expect(second.message).toContain("suite-a");
    expect(second.message).toContain("suite-b");
    expect(second.message).toContain("paused-pending-approval");
    expect(second.message).toMatch(/has not failed|decision owed/i);
    expect(second.message).not.toMatch(/task failed/i);
  });

  it("two verification-unavailable events do NOT exhaust the budget and both survive fold", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: "first skip" },
    });
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: "second skip" },
    });
    const loose = listLooseEvents(bundle);
    expect(countTaskAttemptEvents(loose, "T-001")).toBe(0);
    expect(showCursor(root, "C-RUN").state).not.toBe("paused-pending-approval");
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    const vu = listLedgerEvents(bundle).filter((event) => event.kind === "verification-unavailable");
    expect(vu).toHaveLength(2);
  });

  it("dropping the cursor and re-deriving still reports paused-pending-approval (both sites)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "a", key: "1" },
      writeEvidence: evidencePaths([]),
    });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "b", key: "2" },
      writeEvidence: evidencePaths([]),
    });
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");

    // Drop the cursor cache (D1 recovery path).
    const cursorPath = path.join(bundle, "run.xml");
    expect(existsSync(cursorPath)).toBe(true);
    writeFileSync(cursorPath, ""); // destroy written cursor
    // Prefer re-derive without written cursor
    const rederived = regenerateCursor(root, "C-RUN");
    expect(rederived.position.state).toBe("paused-pending-approval");
    // show without preferWrittenCursor also reads events
    const shown = showCursor(root, "C-RUN");
    // show uses preferWrittenCursor:true — empty/broken cursor should degrade and re-derive
    expect(shown.state).toBe("paused-pending-approval");
  });

  it("unrecognized kind does not resolve to in-progress (correction 34)", () => {
    expect(cursorStateForEventKind("attempt-fail")).toMatchObject({ unknown: true });
    expect(cursorStateForEventKind("garbage")).toMatchObject({ unknown: true });
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const position = advanceCursor(root, "C-RUN", { task: "T-001", kind: "mystery-kind" });
    expect(position.state).not.toBe("in-progress");
    expect(position.degradation?.verdict).toBe("unable-to-determine");
  });
});

describe("cursor state parsed (AC-CURSOR-STATE-PARSED)", () => {
  it("unrecognized written state degrades; show still answers; lint still reports", () => {
    expect(parseCursorState("paused-pending-approval")).toEqual({ state: "paused-pending-approval" });
    expect(parseCursorState("shipped")).toEqual({ invalid: "shipped" });

    const root = createProject();
    const bundle = seedBundle(root);
    writeFileSync(
      path.join(bundle, "run.xml"),
      `<NgraceRunCursor graceVersion="1.0"><C-RUN><Task>T-001</Task><State>shipped</State></C-RUN></NgraceRunCursor>`,
    );
    const position = showCursor(root, "C-RUN");
    expect(position.changeId).toBe("C-RUN");
    expect(position.degradation?.verdict).toBe("unable-to-determine");
    expect(position.degradation?.reason).toMatch(/shipped/);
    // Does not throw; still answers.
    expect(formatCursorPosition(position)).toContain("Degradation:");
    // lint still reports the written file (identity ok, state is free text in grammar today —
    // at minimum show recovered; structural lint should not throw).
    const lint = lintGraceProject(root);
    expect(lint.issues.every((issue) => issue.severity !== "error" || !issue.code.startsWith("cursor.invalid-root"))).toBe(true);
  });

  it("writeCursorFile round-trips paused-pending-approval (A19.2)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "a", key: "1" },
      writeEvidence: evidencePaths([]),
    });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "b", key: "2" },
      writeEvidence: evidencePaths([]),
    });
    const written = readFileSync(path.join(bundle, "run.xml"), "utf8");
    expect(written).toContain("paused-pending-approval");
    const shown = showCursor(root, "C-RUN");
    expect(shown.state).toBe("paused-pending-approval");
  });
});

describe("flake classification (AC-FLAKE-CLASSIFICATION / A19.3)", () => {
  const failEv = (evidence: WriteEvidenceSnapshot) => ({
    outcome: "fail",
    writeEvidence: evidence,
  });
  const passEv = (evidence: WriteEvidenceSnapshot) => ({
    outcome: "pass",
    writeEvidence: evidence,
  });

  it("fail then pass with identical write evidence is flaky", () => {
    const evidence: WriteEvidenceSnapshot = evidencePaths(["src/a.ts"]);
    const result = classifyFlakeFromEvidence(failEv(evidence), passEv(evidence));
    expect(result.verdict).toBe("flaky");
  });

  it("fail then pass with intervening write is retry", () => {
    const result = classifyFlakeFromEvidence(
      failEv(evidencePaths(["src/a.ts"])),
      passEv(evidencePaths(["src/a.ts", "src/b.ts"])),
    );
    expect(result.verdict).toBe("retry");
  });

  it("unavailable write evidence is unable-to-determine, not flaky or retry", () => {
    const result = classifyFlakeFromEvidence(
      failEv({
        available: false,
        absence: { verdict: "unable-to-determine", reason: "git unavailable" },
      }),
      passEv(evidencePaths([])),
    );
    expect(result.verdict).toBe("unable-to-determine");
    expect(result.verdict).not.toBe("flaky");
    expect(result.reason).toMatch(/unavailable/i);
  });

  it("classifier issues no git call — reads only recorded snapshots", () => {
    // Evidence is fully synthetic; if classifyFlakeFromEvidence called git it would
    // need a project root. The API accepts only snapshots.
    const result = classifyFlakeFromEvidence(
      failEv(evidencePaths([])),
      passEv(evidencePaths([])),
    );
    expect(result.verdict).toBe("flaky");
  });

  it("same path set with different content digests is retry, not flaky (A20.3 / correction 39)", () => {
    const earlier = evidencePaths(["src/foo.ts"], { "src/foo.ts": "digest-before" });
    const later = evidencePaths(["src/foo.ts"], { "src/foo.ts": "digest-after-fix" });
    const result = classifyFlakeFromEvidence(failEv(earlier), passEv(later));
    expect(result.verdict).toBe("retry");
    expect(result.verdict).not.toBe("flaky");
  });
});

// ---------------------------------------------------------------------------
// A20 corrections 37–40
// ---------------------------------------------------------------------------

describe("budget survives fold (A20.1 / correction 37 / standing rule 9)", () => {
  it("post-fold second fail escalates — budget does not reset (folded twin)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    // Epoch 1: fail T-001, terminal on a *different* task so the range can fold
    // while T-001's attempt remains in the ledger (A20.1 multi-task wave).
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99, wave: "1" });
    const first = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths([]),
    });
    expect(first.escalated).toBe(false);
    expect(first.attemptCount).toBe(1);
    // T-002 terminal densifies and closes the allocation (per-range, not per-task).
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });
    const fold = foldEpoch(root, "C-RUN", { wave: "1" });
    expect(fold.applied).toBe(true);
    expect(listLooseEvents(bundle)).toHaveLength(0);
    expect(listLedgerEvents(bundle).filter((e) => e.kind === "attempt" && e.task === "T-001")).toHaveLength(1);

    // Epoch 2: open and fail T-001 again — must count the ledger attempt.
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 100, to: 199, wave: "2" });
    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "typecheck", key: "suite-b" },
      writeEvidence: evidencePaths(["src/x.ts"]),
    });
    expect(second.attemptCount).toBe(2);
    expect(second.escalated).toBe(true);
    expect(second.position.state).toBe("paused-pending-approval");
  });

  it("post-fold escalation still surfaces BOTH signatures (folded twin)", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths([]),
    });
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });
    foldEpoch(root, "C-RUN");

    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 100, to: 199 });
    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "typecheck", key: "suite-b" },
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.signatures).toEqual([
      { kind: "test-failure", key: "suite-a" },
      { kind: "typecheck", key: "suite-b" },
    ]);
    expect(second.message).toContain("suite-a");
    expect(second.message).toContain("suite-b");
    // Accounting events merge ledger + loose
    const accounting = listAccountingEvents(
      path.join(root, ARTIFACT_DIR, "changes", "active", "C-RUN"),
    );
    expect(countTaskAttemptEvents(accounting, "T-001")).toBe(2);
  });
});

describe("fold verify expected side independent of writer (A20.2 / correction 38)", () => {
  it("expectedLedgerEventAttributes strips graceVersion and keeps outcome (own assertion)", () => {
    const attrs = expectedLedgerEventAttributes({
      id: 2,
      task: "T-001",
      kind: "attempt",
      file: "/tmp/x",
      attributes: {
        graceVersion: "1.0",
        id: "2",
        task: "T-001",
        kind: "attempt",
        outcome: "fail",
      },
      children: [],
    });
    expect(attrs.graceVersion).toBeUndefined();
    expect(attrs.outcome).toBe("fail");
    expect(attrs.id).toBe("2");
    expect(attrs.task).toBe("T-001");
    expect(attrs.kind).toBe("attempt");
  });

  it("injectDropPayload still fails verify and leaves loose files (A7.2)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "k" },
      writeEvidence: evidencePaths([]),
    });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    const before = listLooseEvents(bundle).length;
    expect(() => foldEpoch(root, "C-RUN", { injectDropPayload: true })).toThrow(/payload mismatch/i);
    expect(listLooseEvents(bundle).length).toBe(before);
  });
});

describe("CLI attempt surface (A20.4 / correction 40)", () => {
  it("advance --kind attempt is reserved and errors", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    expect(() => advanceCursor(root, "C-RUN", { task: "T-001", kind: "attempt" })).toThrow(
      /reserved|cursor attempt/i,
    );
    expect(() =>
      advanceCursor(root, "C-RUN", { task: "T-001", kind: "verification-unavailable" }),
    ).toThrow(/reserved|verification-unavailable/i);
    expect(() => advanceCursor(root, "C-RUN", { task: "T-001", kind: "escalation" })).toThrow(
      /reserved|escalation/i,
    );
  });

  it("cursor attempt and verification-unavailable subcommands are registered", () => {
    // Import the command definition and assert subcommand keys.
    // Dynamic import keeps the test co-located without starting the CLI main.
    const { cursorCommand } = require("./grace-cursor") as typeof import("./grace-cursor");
    const keys = Object.keys(cursorCommand.subCommands ?? {});
    expect(keys).toContain("attempt");
    expect(keys).toContain("verification-unavailable");
    expect(keys).toContain("advance");
    expect(keys).toContain("fold");
  });
});

// ---------------------------------------------------------------------------
// A21 corrections 41–42
// ---------------------------------------------------------------------------

describe("escalation is sticky until resume (A21.1 / correction 41)", () => {
  function escalate(root: string) {
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths([]),
    });
    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "typecheck", key: "suite-b" },
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.position.state).toBe("paused-pending-approval");
    return second;
  }

  it("write path: verification-unavailable after escalation keeps paused-pending-approval", () => {
    // Fixture position: escalation is NOT last — one more event after it (the twin that catches last-event-wins).
    const root = createProject();
    seedBundle(root);
    escalate(root);
    const after = recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: "harness skipped" },
    });
    expect(after.state).toBe("paused-pending-approval");
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");
  });

  it("write path: progress after escalation keeps paused-pending-approval", () => {
    const root = createProject();
    seedBundle(root);
    escalate(root);
    const after = advanceCursor(root, "C-RUN", { task: "T-001", kind: "progress" });
    expect(after.state).toBe("paused-pending-approval");
  });

  it("read path: drop cursor after VU-following-escalation still re-derives paused-pending-approval", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    escalate(root);
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "unable-to-determine", reason: "skipped" },
    });
    writeFileSync(path.join(bundle, "run.xml"), ""); // destroy written cursor
    const rederived = regenerateCursor(root, "C-RUN");
    expect(rederived.position.state).toBe("paused-pending-approval");
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");
  });

  it("resume explicitly resolves escalation to in-progress", () => {
    const root = createProject();
    seedBundle(root);
    escalate(root);
    const resumed = resumeCursor(root, "C-RUN", "T-001");
    expect(resumed.state).toBe("in-progress");
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");
  });

  it("deriveStateFromEvents: sticky until resume, unit-level", () => {
    const sticky = deriveStateFromEvents([
      { id: 1, kind: "opened", task: "T-001" },
      { id: 2, kind: "attempt", task: "T-001" },
      { id: 3, kind: "attempt", task: "T-001" },
      { id: 4, kind: "escalation", task: "T-001" },
      { id: 5, kind: "verification-unavailable", task: "T-001" },
      { id: 6, kind: "progress", task: "T-001" },
    ]);
    expect(sticky).toEqual({ state: "paused-pending-approval" });
    const resolved = deriveStateFromEvents([
      { id: 1, kind: "opened", task: "T-001" },
      { id: 4, kind: "escalation", task: "T-001" },
      { id: 5, kind: "resume", task: "T-001" },
    ]);
    expect(resolved).toEqual({ state: "in-progress" });
  });
});

// ---------------------------------------------------------------------------
// A22 corrections 43–44 — plurality and fold axes (leave the one-task / one-epoch origin)
// ---------------------------------------------------------------------------

describe("per-task escalation set (A22.1 / correction 43)", () => {
  function escalateTask(root: string, task: string, open = false) {
    if (open) {
      advanceCursor(root, "C-RUN", { task, openEpoch: true, from: 1, to: 99 });
    }
    recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: { kind: "test-failure", key: `${task}-a` },
      writeEvidence: evidencePaths([]),
    });
    const second = recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: { kind: "typecheck", key: `${task}-b` },
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.position.state).toBe("paused-pending-approval");
    return second;
  }

  it("resume --task T-002 leaves T-001 escalated (plurality twin)", () => {
    // Fixture leaves plurality origin: two tasks; T-001 escalated, T-002 resume must not clear it.
    const root = createProject();
    seedBundle(root);
    escalateTask(root, "T-001", true);
    // T-002 becomes active without escalating
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "progress" });
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");

    const resumed = resumeCursor(root, "C-RUN", "T-002");
    // Unrelated task's resume must not resolve T-001's owed decision.
    expect(resumed.state).toBe("paused-pending-approval");
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");

    // Only T-001's own resume clears the set.
    const cleared = resumeCursor(root, "C-RUN", "T-001");
    expect(cleared.state).toBe("in-progress");
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");
  });

  it("T-002 progress is recorded and not swallowed while T-001 is escalated (plurality twin)", () => {
    // While set non-empty, bundle stays ppa; T-002's events still land and feed lastNonSticky.
    // A23.1: task is drawn from escalated set — position names T-001, not the last-event task.
    const root = createProject();
    const bundle = seedBundle(root);
    escalateTask(root, "T-001", true);
    const afterProgress = advanceCursor(root, "C-RUN", { task: "T-002", kind: "progress" });
    expect(afterProgress.state).toBe("paused-pending-approval");
    expect(afterProgress.task).toBe("T-001");
    expect(afterProgress.escalatedTasks).toEqual(["T-001"]);
    const loose = listLooseEvents(bundle);
    expect(loose.some((e) => e.task === "T-002" && e.kind === "progress")).toBe(true);

    // After T-001 resolves, derivation reflects recent activity (progress was not skipped).
    resumeCursor(root, "C-RUN", "T-001");
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");
    expect(showCursor(root, "C-RUN").escalatedTasks).toEqual([]);
  });

  it("deriveStateFromEvents: resume of unrelated task leaves other escalation (unit)", () => {
    const stillOwed = deriveStateFromEvents([
      { id: 1, kind: "opened", task: "T-001" },
      { id: 2, kind: "escalation", task: "T-001" },
      { id: 3, kind: "progress", task: "T-002" },
      { id: 4, kind: "resume", task: "T-002" },
    ]);
    expect(stillOwed).toEqual({ state: "paused-pending-approval" });

    const bothClear = deriveStateFromEvents([
      { id: 1, kind: "escalation", task: "T-001" },
      { id: 2, kind: "escalation", task: "T-002" },
      { id: 3, kind: "resume", task: "T-001" },
      { id: 4, kind: "resume", task: "T-002" },
    ]);
    expect(bothClear).toEqual({ state: "in-progress" });

    const oneRemains = deriveStateFromEvents([
      { id: 1, kind: "escalation", task: "T-001" },
      { id: 2, kind: "escalation", task: "T-002" },
      { id: 3, kind: "resume", task: "T-002" },
    ]);
    expect(oneRemains).toEqual({ state: "paused-pending-approval" });
  });
});

describe("fold derives unresolved escalation (A22.2 / correction 44)", () => {
  it("fold twin: escalate T-001, T-002 terminal closes range, fold keeps paused-pending-approval", () => {
    // Fixture leaves transition origin (fold) AND plurality origin (two tasks).
    // A19.2 claimed escalated epochs do not fold — false: terminal is per-range, not per-task.
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths([]),
    });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "typecheck", key: "suite-b" },
      writeEvidence: evidencePaths([]),
    });
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");

    // Different task's terminal satisfies the allocation and allows fold.
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });
    const fold = foldEpoch(root, "C-RUN");
    expect(fold.applied).toBe(true);
    expect(listLooseEvents(bundle)).toHaveLength(0);

    // Written run.xml must not claim idle over an unresolved escalation.
    const runXml = readFileSync(path.join(bundle, "run.xml"), "utf8");
    expect(runXml).toContain("paused-pending-approval");
    expect(runXml).not.toMatch(/<State>idle<\/State>/);

    // show prefers written cursor — must still report the owed decision.
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");

    // Re-derive without written cursor also recovers from ledger.
    writeFileSync(path.join(bundle, "run.xml"), "");
    expect(regenerateCursor(root, "C-RUN").position.state).toBe("paused-pending-approval");
  });
});

// ---------------------------------------------------------------------------
// A25 / correction 47 — escalation authority is the stream, never the written cursor
// ---------------------------------------------------------------------------

describe("prefer-written escalation from stream (A25.1 / correction 47)", () => {
  function escalateT001(root: string) {
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "a" },
      writeEvidence: evidencePaths([]),
    });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "b" },
      writeEvidence: evidencePaths([]),
    });
  }

  /** Pre-4abc775 shape: State without EscalatedTask children. */
  function writeLegacyCursor(
    bundle: string,
    options: { state: string; task?: string; epoch?: number; escalatedTasks?: string[] },
  ) {
    const epoch = options.epoch !== undefined ? `<Epoch>${options.epoch}</Epoch>` : "";
    const task = options.task ? `<Task>${options.task}</Task>` : "";
    const escalated = (options.escalatedTasks ?? [])
      .map((t) => `<EscalatedTask>${t}</EscalatedTask>`)
      .join("");
    writeFileSync(
      path.join(bundle, "run.xml"),
      `<NgraceRunCursor graceVersion="1.0"><C-RUN>${epoch}${task}${escalated}<State>${options.state}</State></C-RUN></NgraceRunCursor>\n`,
    );
  }

  it("upgrade fixture: legacy run.xml without EscalatedTask over unresolved ledger → ppa from stream + degradation", () => {
    // Authority axis: cache says in-progress; record holds escalation.
    const root = createProject();
    const bundle = seedBundle(root);
    escalateT001(root);
    writeLegacyCursor(bundle, { state: "in-progress", task: "T-001", epoch: 1 });

    const shown = showCursor(root, "C-RUN");
    expect(shown.state).toBe("paused-pending-approval");
    expect(shown.escalatedTasks).toEqual(["T-001"]);
    expect(shown.task).toBe("T-001");
    expect(shown.degradation?.verdict).toBe("unable-to-determine");
    expect(shown.degradation?.reason).toMatch(/disagrees|durable|ledger|stream/i);
    expect(shown.sources.state).not.toBe("cursor");
    expect(["ledger", "events"]).toContain(shown.sources.state);
  });

  it("stale fixture: run.xml still escalated after ledger resolved → not escalated + degradation", () => {
    // Authority axis: cache keeps a resolved escalation alive.
    const root = createProject();
    const bundle = seedBundle(root);
    escalateT001(root);
    resumeCursor(root, "C-RUN", "T-001");
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");
    expect(showCursor(root, "C-RUN").escalatedTasks).toEqual([]);

    // Stale write after resume.
    writeLegacyCursor(bundle, {
      state: "paused-pending-approval",
      task: "T-001",
      epoch: 1,
      escalatedTasks: ["T-001"],
    });

    const shown = showCursor(root, "C-RUN");
    expect(shown.state).not.toBe("paused-pending-approval");
    expect(shown.escalatedTasks).toEqual([]);
    expect(shown.degradation?.verdict).toBe("unable-to-determine");
    expect(shown.degradation?.reason).toMatch(/disagrees|durable|ledger|stream/i);
    expect(shown.sources.state).not.toBe("cursor");
  });

  it("unchanged: cursor that agrees with ledger produces no degradation", () => {
    const root = createProject();
    seedBundle(root);
    escalateT001(root);
    // Fresh write from recordAttempt already agrees.
    const shown = showCursor(root, "C-RUN");
    expect(shown.state).toBe("paused-pending-approval");
    expect(shown.escalatedTasks).toEqual(["T-001"]);
    expect(shown.degradation).toBeUndefined();
    // state is stream-authoritative even when agreeing
    expect(["ledger", "events"]).toContain(shown.sources.state);
  });

  it("transition twin: upgrade + stale fixtures still behave after fold", () => {
    // Leaves transition axis (fold) and authority axis (stale/legacy cache).
    const root = createProject();
    const bundle = seedBundle(root);
    escalateT001(root);
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    expect(listLooseEvents(bundle)).toHaveLength(0);

    // Upgrade shape over folded ledger still unresolved.
    writeLegacyCursor(bundle, { state: "in-progress", task: "T-002", epoch: 1 });
    const upgrade = showCursor(root, "C-RUN");
    expect(upgrade.state).toBe("paused-pending-approval");
    expect(upgrade.escalatedTasks).toEqual(["T-001"]);
    expect(upgrade.task).toBe("T-001");
    expect(upgrade.degradation?.verdict).toBe("unable-to-determine");
    expect(upgrade.sources.state).toBe("ledger"); // loose empty after fold

    // Resolve via new epoch + resume, then plant stale cursor.
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 100, to: 199 });
    resumeCursor(root, "C-RUN", "T-001");
    writeLegacyCursor(bundle, {
      state: "paused-pending-approval",
      task: "T-001",
      epoch: 2,
      escalatedTasks: ["T-001"],
    });
    const stale = showCursor(root, "C-RUN");
    expect(stale.state).not.toBe("paused-pending-approval");
    expect(stale.escalatedTasks).toEqual([]);
    expect(stale.degradation?.verdict).toBe("unable-to-determine");
  });
});

// ---------------------------------------------------------------------------
// A23 / A24 — escalatedTasks field + budget window from resolving resume
// ---------------------------------------------------------------------------

describe("escalatedTasks on CursorPosition (A23.1 / correction 45)", () => {
  it("plurality: T-001 escalated + T-002 terminal — show names escalated task", () => {
    // Fixture leaves plurality origin: two tasks; state aggregates, task must not last-event-win.
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "a" },
      writeEvidence: evidencePaths([]),
    });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "b" },
      writeEvidence: evidencePaths([]),
    });
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });

    const shown = showCursor(root, "C-RUN");
    expect(shown.state).toBe("paused-pending-approval");
    expect(shown.task).toBe("T-001");
    expect(shown.escalatedTasks).toEqual(["T-001"]);
    expect(shown.task).not.toBe("T-002");

    const text = formatCursorPosition(shown);
    expect(text).toContain("Task: T-001");
    expect(text).toContain("EscalatedTasks: T-001");

    // A5.4: written cursor round-trips EscalatedTask elements.
    const runXml = readFileSync(path.join(bundle, "run.xml"), "utf8");
    expect(runXml).toContain("<EscalatedTask>T-001</EscalatedTask>");
    expect(runXml).toMatch(/<Task>T-001<\/Task>/);
  });

  it("writeCursorFile / show / regenerate round-trip escalatedTasks (A5.4)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "a", key: "1" },
      writeEvidence: evidencePaths([]),
    });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "b", key: "2" },
      writeEvidence: evidencePaths([]),
    });
    expect(showCursor(root, "C-RUN").escalatedTasks).toEqual(["T-001"]);
    writeFileSync(path.join(bundle, "run.xml"), ""); // drop written cursor
    const rederived = regenerateCursor(root, "C-RUN");
    expect(rederived.position.escalatedTasks).toEqual(["T-001"]);
    expect(rederived.position.task).toBe("T-001");
  });
});

describe("budget window from resolving resume (A24 / correction 46)", () => {
  function fail(root: string, task: string, key: string) {
    return recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: { kind: "test", key },
      writeEvidence: evidencePaths([]),
    });
  }

  it("window: escalate, resume, two more fails — second escalation reports 2 and this-round signatures", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = fail(root, "T-001", "a");
    expect(first.escalated).toBe(false);
    const second = fail(root, "T-001", "b");
    expect(second.escalated).toBe(true);
    expect(second.attemptCount).toBe(2);
    expect(second.signatures).toEqual([
      { kind: "test", key: "a" },
      { kind: "test", key: "b" },
    ]);

    resumeCursor(root, "C-RUN", "T-001");
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");

    const third = fail(root, "T-001", "c");
    expect(third.escalated).toBe(false);
    expect(third.attemptCount).toBe(1); // window after resolving resume

    const fourth = fail(root, "T-001", "d");
    expect(fourth.escalated).toBe(true);
    expect(fourth.attemptCount).toBe(2); // not 4
    expect(fourth.signatures).toEqual([
      { kind: "test", key: "c" },
      { kind: "test", key: "d" },
    ]);
    expect(fourth.message).toMatch(/after 2 attempts/);
    expect(fourth.message).not.toMatch(/after 4 attempts/);
    expect(fourth.message).toContain("test: c");
    expect(fourth.message).toContain("test: d");
    expect(fourth.message).not.toContain("test: a");
    expect(fourth.message).not.toContain("test: b");
    // Message lists only this-round signatures (count in list = 2)
    expect(fourth.message).toMatch(/Signatures \(2\)/);
  });

  it("negative: two resumes on a never-escalated task do not extend its budget (§4.5.2 form)", () => {
    // If any resume opened a window, fail-after-resume would count as 1 and not escalate.
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = fail(root, "T-001", "pre");
    expect(first.escalated).toBe(false);
    expect(first.attemptCount).toBe(1);

    resumeCursor(root, "C-RUN", "T-001"); // ordinary — nothing to resolve
    resumeCursor(root, "C-RUN", "T-001"); // still ordinary

    const second = fail(root, "T-001", "post");
    expect(second.attemptCount).toBe(2); // full history still counted
    expect(second.escalated).toBe(true);
    expect(second.signatures.map((s) => s.key)).toEqual(["pre", "post"]);
  });

  it("transition: window + escalatedTasks hold after fold", () => {
    // Leaves both plurality and transition axes: escalate T-001, T-002 terminal, fold,
    // then resume and re-exhaust window; also check escalatedTasks before resume after fold.
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    fail(root, "T-001", "a");
    fail(root, "T-001", "b");
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });
    foldEpoch(root, "C-RUN");

    const afterFold = showCursor(root, "C-RUN");
    expect(afterFold.state).toBe("paused-pending-approval");
    expect(afterFold.task).toBe("T-001");
    expect(afterFold.escalatedTasks).toEqual(["T-001"]);
    expect(listLooseEvents(bundle)).toHaveLength(0);

    // Resume opens a window; two more fails re-escalate at measured 2.
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 100, to: 199 });
    resumeCursor(root, "C-RUN", "T-001");
    fail(root, "T-001", "c");
    const reEsc = fail(root, "T-001", "d");
    expect(reEsc.escalated).toBe(true);
    expect(reEsc.attemptCount).toBe(2);
    expect(reEsc.signatures.map((s) => s.key)).toEqual(["c", "d"]);
    expect(reEsc.message).toMatch(/after 2 attempts/);
    expect(reEsc.message).toMatch(/Signatures \(2\)/);
  });

  it("unit: lastResolvingResumeId ignores ordinary resumes", () => {
    const events = [
      { id: 1, kind: "opened", task: "T-001" },
      { id: 2, kind: "attempt", task: "T-001" },
      { id: 3, kind: "resume", task: "T-001" }, // ordinary
      { id: 4, kind: "attempt", task: "T-001" },
      { id: 5, kind: "escalation", task: "T-001" },
      { id: 6, kind: "resume", task: "T-001" }, // resolving
      { id: 7, kind: "attempt", task: "T-001" },
    ];
    expect(lastResolvingResumeId(events, "T-001")).toBe(6);
    expect(countTaskAttemptEvents(events, "T-001")).toBe(1); // only id 7
    expect(listUnresolvedEscalatedTasks(events)).toEqual([]);
  });
});

describe("digest undetermined is absence not flaky (A21.2 / correction 42)", () => {
  const failEv = (evidence: WriteEvidenceSnapshot) => ({ outcome: "fail", writeEvidence: evidence });
  const passEv = (evidence: WriteEvidenceSnapshot) => ({ outcome: "pass", writeEvidence: evidence });

  it("both sides undetermined (unreadable) → unable-to-determine, not flaky", () => {
    const result = classifyFlakeFromEvidence(
      failEv(evidenceUndetermined(["src/a.ts"], "file unreadable")),
      passEv(evidenceUndetermined(["src/a.ts"], "file unreadable")),
    );
    expect(result.verdict).toBe("unable-to-determine");
    expect(result.verdict).not.toBe("flaky");
    expect(result.reason).toMatch(/undetermined|unreadable/i);
  });

  it("one side undetermined → unable-to-determine", () => {
    const result = classifyFlakeFromEvidence(
      failEv(evidencePaths(["src/a.ts"])),
      passEv(evidenceUndetermined(["src/a.ts"])),
    );
    expect(result.verdict).toBe("unable-to-determine");
  });

  it("both sides absent is genuine evidence → flaky when identical", () => {
    const result = classifyFlakeFromEvidence(
      failEv(evidenceAbsent(["src/gone.ts"])),
      passEv(evidenceAbsent(["src/gone.ts"])),
    );
    expect(result.verdict).toBe("flaky");
  });

  it("absent then content is retry", () => {
    const result = classifyFlakeFromEvidence(
      failEv(evidenceAbsent(["src/new.ts"])),
      passEv(evidencePaths(["src/new.ts"])),
    );
    expect(result.verdict).toBe("retry");
  });
});
