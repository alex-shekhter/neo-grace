import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  appendCommandRunEvent,
  classifyFlakeFromEvidence,
  countTaskAttemptEvents,
  cursorStateForEventKind,
  decideFixBudgetEscalation,
  deriveAttemptOrdinal,
  deriveStateFromEvents,
  expectedLedgerEventAttributes,
  FIX_DISTINCT_SIGNATURE_BUDGET,
  FIX_SIGNATURE_REPEAT_BUDGET,
  fixBudgetSkillRequiredSubstrings,
  foldEpoch,
  formatCursorPosition,
  KNOWN_EVENT_KINDS,
  lastResolvingResumeId,
  listAccountingEvents,
  listLedgerEvents,
  listLooseEvents,
  listRunOrphans,
  listUnresolvedEscalatedTasks,
  listWindowFailSignatures,
  parseCursorState,
  readAttemptPayload,
  recordAttempt,
  recordVerificationUnavailable,
  recoverCursor,
  regenerateCursor,
  resumeCursor,
  showCursor,
  type ChangedFileEvidence,
  type KnownEventKind,
  type WriteEvidenceSnapshot,
} from "./grace-cursor";
import { GraceCommandError } from "./query/errors";
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
  // writeMinimalNgraceProject already writes governed src/example.ts (LINKS: M-EXAMPLE)
  // matching ObservedWriteScope in the fixture plan (C-GRAPH-COVERAGE layer 3).
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
  it("pins writeFileSync|mkdirSync to graph, cursor, gates ledger, and dart only", () => {
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
    // A10.9 baseline + grace-cursor + gates/ledger (A30 Verdicts/Decisions write); nothing else.
    for (const line of lines) {
      expect(
        line.startsWith("src/grace-graph.ts:")
          || line.startsWith("src/grace-cursor.ts:")
          || line.startsWith("src/gates/ledger.ts:")
          || line.startsWith("src/lint/adapters/dart.ts:"),
      ).toBe(true);
    }
    expect(lines.some((line) => line.startsWith("src/grace-cursor.ts:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("src/grace-graph.ts:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("src/gates/ledger.ts:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("src/lint/adapters/dart.ts:"))).toBe(true);
  });

  it("pins unlinkSync|rmSync|rmdirSync to fold delete, ledger rollback, and dart temp cleanup (A15.1 / A31.5)", () => {
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
    // Import lines plus call sites: fold delete, ledger post-write rollback (A31.5), dart temp,
    // review scorer temp-project cleanup (Phase 6 corpus scoring).
    for (const line of lines) {
      expect(
        line.startsWith("src/grace-cursor.ts:")
          || line.startsWith("src/gates/ledger.ts:")
          || line.startsWith("src/lint/adapters/dart.ts:")
          || line.startsWith("src/review/scorer.ts:"),
      ).toBe(true);
    }
    const callSites = lines.filter((line) => /(?:unlinkSync|rmSync|rmdirSync)\s*\(/.test(line)).sort();
    const cursorUnlink = callSites.find((line) => line.startsWith("src/grace-cursor.ts:"));
    const ledgerUnlink = callSites.find((line) => line.startsWith("src/gates/ledger.ts:"));
    const dartRm = callSites.find((line) => line.startsWith("src/lint/adapters/dart.ts:"));
    const scorerRm = callSites.find((line) => line.startsWith("src/review/scorer.ts:"));
    expect(cursorUnlink).toMatch(/^src\/grace-cursor\.ts:\d+:\s*unlinkSync\(contained\.absolutePath\);$/);
    expect(ledgerUnlink).toMatch(/^src\/gates\/ledger\.ts:\d+:\s*unlinkSync\(ledgerPath\);$/);
    expect(dartRm).toMatch(/^src\/lint\/adapters\/dart\.ts:\d+:\s*rmSync\(temporaryDirectory, \{ recursive: true, force: true \}\);$/);
    expect(scorerRm).toMatch(/^src\/review\/scorer\.ts:\d+:\s*rmSync\(root, \{ recursive: true, force: true \}\);$/);
    expect(callSites).toHaveLength(4);
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
    // Second same-signature fail escalates R — still has attempt events.
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "a", key: "1" },
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

describe("signature fix budget R/D (C-ESCALATION-HONESTY / AC-SIGNATURE-BUDGET-SEQUENCES)", () => {
  const A = { kind: "k", key: "a" };
  const B = { kind: "k", key: "b" };
  const C = { kind: "k", key: "c" };
  const D = { kind: "k", key: "d" };

  function failSig(
    root: string,
    signature: { kind: string; key: string },
    task = "T-001",
  ) {
    return recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature,
      writeEvidence: evidencePaths([]),
    });
  }

  it("constants pin R=2 and D=4 exactly (F23)", () => {
    expect(FIX_SIGNATURE_REPEAT_BUDGET).toBe(2);
    expect(FIX_DISTINCT_SIGNATURE_BUDGET).toBe(4);
  });

  it("fail(A) does not escalate", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const r = failSig(root, A);
    expect(r.escalated).toBe(false);
    expect(r.trigger).toBeUndefined();
  });

  it("fail(A), fail(A) escalates with trigger R", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    expect(failSig(root, A).escalated).toBe(false);
    const second = failSig(root, A);
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    expect(second.position.state).toBe("paused-pending-approval");
    expect(second.message).toContain("trigger R");
    expect(second.message).toContain("k:a");
    expect(second.message).toContain("paused-pending-approval");
    expect(second.message).toMatch(/has not failed|decision owed/i);
    expect(second.message).not.toMatch(/task failed/i);
    expect(second.message).not.toMatch(/after \d+ attempts/);
  });

  it("fail(A), fail(B) does not escalate (different signatures — red-first progress)", () => {
    // Consequence of approved rule, not accommodation: two distinct reds are not thrash.
    // Replaces the pre-C-ESCALATION-HONESTY §4.5.2 pin that treated any two fails as thrash.
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    expect(failSig(root, A).escalated).toBe(false);
    const second = failSig(root, B);
    expect(second.escalated).toBe(false);
    expect(second.trigger).toBeUndefined();
    expect(second.position.state).not.toBe("paused-pending-approval");
  });

  it("fail(A), pass, fail(B) does not escalate", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, A);
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "pass",
      writeEvidence: evidencePaths(["src/x.ts"]),
    });
    const third = failSig(root, B);
    expect(third.escalated).toBe(false);
    expect(third.trigger).toBeUndefined();
  });

  it("fail(A), pass, fail(A) escalates with trigger R (intervening pass ignored for R)", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, A);
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "pass",
      writeEvidence: evidencePaths(["src/x.ts"]),
    });
    const third = failSig(root, A);
    expect(third.escalated).toBe(true);
    expect(third.trigger).toBe("R");
  });

  it("pass, fail(A) does not escalate (attempt-count rule regression)", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "pass",
      writeEvidence: evidencePaths([]),
    });
    const second = failSig(root, A);
    expect(second.escalated).toBe(false);
    expect(second.trigger).toBeUndefined();
  });

  it("fail(A), fail(B), fail(A) escalates with R not D (distinct=2)", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, A);
    failSig(root, B);
    const third = failSig(root, A);
    expect(third.escalated).toBe(true);
    expect(third.trigger).toBe("R");
    expect(third.message).toContain("trigger R");
    expect(third.message).not.toContain("trigger D");
  });

  it("fail(A), fail(B), fail(C) does not escalate (backstop not at 3)", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, A);
    failSig(root, B);
    const third = failSig(root, C);
    expect(third.escalated).toBe(false);
    expect(third.trigger).toBeUndefined();
  });

  it("fail(A), fail(B), pass, fail(C) does not escalate", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, A);
    failSig(root, B);
    recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "pass",
      writeEvidence: evidencePaths(["src/x.ts"]),
    });
    const fourth = failSig(root, C);
    expect(fourth.escalated).toBe(false);
  });

  it("fail(A), fail(B), fail(C), fail(D) escalates with trigger D on the fourth", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    expect(failSig(root, A).escalated).toBe(false);
    expect(failSig(root, B).escalated).toBe(false);
    expect(failSig(root, C).escalated).toBe(false);
    const fourth = failSig(root, D);
    expect(fourth.escalated).toBe(true);
    expect(fourth.trigger).toBe("D");
    expect(fourth.message).toContain("trigger D");
    expect(fourth.message).toContain(String(FIX_DISTINCT_SIGNATURE_BUDGET));
    expect(fourth.message).toContain("distinct unresolved failures");
    expect(fourth.message).not.toMatch(/after \d+ attempts/);
    expect(fourth.message).toContain("k: a");
    expect(fourth.message).toContain("k: d");
  });

  it("verification-unavailable ×2 does not exhaust the budget", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: "first skip" },
    });
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: "second skip" },
    });
    expect(showCursor(root, "C-RUN").state).not.toBe("paused-pending-approval");
    const after = failSig(root, A);
    expect(after.escalated).toBe(false);
  });

  it("same kind different key is not a repeat of each other", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, { kind: "test", key: "one" });
    const second = failSig(root, { kind: "test", key: "two" });
    expect(second.escalated).toBe(false);
  });

  it("different kind same key is not a repeat of each other", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, { kind: "alpha", key: "shared" });
    const second = failSig(root, { kind: "beta", key: "shared" });
    expect(second.escalated).toBe(false);
  });

  it("equality is exact (case-sensitive): K vs k does not count as repeat", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, { kind: "Test", key: "X" });
    const second = failSig(root, { kind: "test", key: "x" });
    expect(second.escalated).toBe(false);
  });

  it("decideFixBudgetEscalation unit: R before D; empty → no escalate", () => {
    expect(decideFixBudgetEscalation([])).toEqual({ escalate: false });
    expect(decideFixBudgetEscalation([A])).toEqual({ escalate: false });
    expect(decideFixBudgetEscalation([A, A])).toEqual({
      escalate: true,
      trigger: "R",
      repeated: A,
    });
    expect(decideFixBudgetEscalation([A, B, C])).toEqual({ escalate: false });
    const d = decideFixBudgetEscalation([A, B, C, D]);
    expect(d.escalate).toBe(true);
    if (d.escalate) {
      expect(d.trigger).toBe("D");
      if (d.trigger === "D") expect(d.distinctCount).toBe(4);
    }
    // Interaction: third is repeat of A → R, even though distinct would grow
    expect(decideFixBudgetEscalation([A, B, A])).toEqual({
      escalate: true,
      trigger: "R",
      repeated: A,
    });
  });

  it("R message names repeated signature; D message names distinct backstop (wrong-trigger ban)", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root, A);
    const r = failSig(root, A);
    expect(r.trigger).toBe("R");
    expect(r.message).toContain("repeated failure signature k:a");
    expect(r.message).toContain("trigger R");
    expect(r.message).not.toContain("trigger D");

    const root2 = createProject();
    seedBundle(root2);
    advanceCursor(root2, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    failSig(root2, A);
    failSig(root2, B);
    failSig(root2, C);
    const d = failSig(root2, D);
    expect(d.trigger).toBe("D");
    expect(d.message).toContain("trigger D");
    expect(d.message).not.toContain("trigger R");
    expect(d.message).not.toContain("repeated failure signature");
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
      signature: { kind: "a", key: "1" }, // R: same signature twice
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
      signature: { kind: "a", key: "1" },
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
  it("post-fold second same-signature fail escalates R — budget does not reset (folded twin)", () => {
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

    // Epoch 2: same signature again — R across fold (window not reset by fold).
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 100, to: 199, wave: "2" });
    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths(["src/x.ts"]),
    });
    expect(second.attemptCount).toBe(2);
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    expect(second.position.state).toBe("paused-pending-approval");
  });

  it("post-fold R escalation lists this-window same-signature fails (folded twin)", () => {
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
      signature: { kind: "test-failure", key: "suite-a" },
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    expect(second.signatures).toEqual([
      { kind: "test-failure", key: "suite-a" },
      { kind: "test-failure", key: "suite-a" },
    ]);
    expect(second.message).toContain("suite-a");
    expect(second.message).toContain("trigger R");
    const accounting = listAccountingEvents(
      path.join(root, ARTIFACT_DIR, "changes", "active", "C-RUN"),
    );
    expect(countTaskAttemptEvents(accounting, "T-001")).toBe(2);
    expect(listWindowFailSignatures(accounting, "T-001")).toHaveLength(2);
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
      signature: { kind: "test-failure", key: "suite-a" }, // R
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
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
    const resumed = resumeCursor(root, "C-RUN", "T-001", {
      reason: "replan after sticky-escalation check",
    });
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
    const sig = { kind: "test-failure", key: `${task}-repeat` };
    recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: sig,
      writeEvidence: evidencePaths([]),
    });
    const second = recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: sig, // R: same signature twice
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
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

    // Only T-001's own resume clears the set (reason required for escalation clear).
    const cleared = resumeCursor(root, "C-RUN", "T-001", {
      reason: "replan: clear T-001 after plurality check",
    });
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
    resumeCursor(root, "C-RUN", "T-001", {
      reason: "replan: clear T-001 after progress-while-escalated check",
    });
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
      signature: { kind: "test-failure", key: "suite-a" },
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
      signature: { kind: "test", key: "a" }, // R
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
    resumeCursor(root, "C-RUN", "T-001", { reason: "replan: resolve before stale-cursor fixture" });
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
    resumeCursor(root, "C-RUN", "T-001", { reason: "replan: resolve after fold for stale-cursor twin" });
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
      signature: { kind: "test", key: "a" },
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
      signature: { kind: "a", key: "1" },
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

  it("window: escalate R, resume, two more same-key fails — re-escalate R this-window only", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = fail(root, "T-001", "a");
    expect(first.escalated).toBe(false);
    const second = fail(root, "T-001", "a"); // R
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    expect(second.attemptCount).toBe(2);
    expect(second.signatures).toEqual([
      { kind: "test", key: "a" },
      { kind: "test", key: "a" },
    ]);

    resumeCursor(root, "C-RUN", "T-001", { reason: "replan: open new budget window after R" });
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");

    const third = fail(root, "T-001", "c");
    expect(third.escalated).toBe(false);
    expect(third.attemptCount).toBe(1); // window after resolving resume

    const fourth = fail(root, "T-001", "c"); // R again in new window
    expect(fourth.escalated).toBe(true);
    expect(fourth.trigger).toBe("R");
    expect(fourth.attemptCount).toBe(2); // not 4
    expect(fourth.signatures).toEqual([
      { kind: "test", key: "c" },
      { kind: "test", key: "c" },
    ]);
    expect(fourth.message).toContain("trigger R");
    expect(fourth.message).toContain("test:c");
    expect(fourth.message).not.toContain("test: a");
    expect(fourth.message).not.toMatch(/test: a\b/);
    expect(fourth.message).toMatch(/Signatures \(2\)/);
  });

  it("negative: two ordinary resumes do not open a budget window; same-key pair still escalates R", () => {
    // Ordinary resumes do not resolve an escalation → window start stays 0.
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = fail(root, "T-001", "pre");
    expect(first.escalated).toBe(false);
    expect(first.attemptCount).toBe(1);

    resumeCursor(root, "C-RUN", "T-001"); // ordinary — nothing to resolve
    resumeCursor(root, "C-RUN", "T-001"); // still ordinary

    const second = fail(root, "T-001", "pre"); // same key → R
    expect(second.attemptCount).toBe(2); // full history still counted
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    expect(second.signatures.map((s) => s.key)).toEqual(["pre", "pre"]);
  });

  it("transition: window + escalatedTasks hold after fold", () => {
    // Leaves both plurality and transition axes: escalate T-001, T-002 terminal, fold,
    // then resume and re-exhaust window; also check escalatedTasks before resume after fold.
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    fail(root, "T-001", "a");
    fail(root, "T-001", "a"); // R
    advanceCursor(root, "C-RUN", { task: "T-002", kind: "terminal" });
    foldEpoch(root, "C-RUN");

    const afterFold = showCursor(root, "C-RUN");
    expect(afterFold.state).toBe("paused-pending-approval");
    expect(afterFold.task).toBe("T-001");
    expect(afterFold.escalatedTasks).toEqual(["T-001"]);
    expect(listLooseEvents(bundle)).toHaveLength(0);

    // Resume opens a window; two more same-key fails re-escalate R.
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 100, to: 199 });
    resumeCursor(root, "C-RUN", "T-001", { reason: "replan: open window after fold" });
    fail(root, "T-001", "c");
    const reEsc = fail(root, "T-001", "c");
    expect(reEsc.escalated).toBe(true);
    expect(reEsc.trigger).toBe("R");
    expect(reEsc.attemptCount).toBe(2);
    expect(reEsc.signatures.map((s) => s.key)).toEqual(["c", "c"]);
    expect(reEsc.message).toContain("trigger R");
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

// ---------------------------------------------------------------------------
// C-ESCALATION-HONESTY T-002 — resume reason on escalation clear
// ---------------------------------------------------------------------------

describe("resume reason on escalation clear (C-ESCALATION-HONESTY T-002)", () => {
  function escalateR(root: string, task = "T-001", key = "a") {
    advanceCursor(root, "C-RUN", { task, openEpoch: true, from: 1, to: 99 });
    recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: { kind: "test", key },
      writeEvidence: evidencePaths([]),
    });
    const second = recordAttempt(root, "C-RUN", {
      task,
      outcome: "fail",
      signature: { kind: "test", key },
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    return second;
  }

  function reasonFromResumeEvent(event: { kind: string; children: { tag: string; text: string }[] }) {
    expect(event.kind).toBe("resume");
    const reasonChild = event.children.find((c) => c.tag === "Reason");
    expect(reasonChild).toBeDefined();
    return reasonChild!.text;
  }

  it("AC-RESUME-REASON-REQUIRED: absent reason refuses before write; task stays escalated (resumeCursor)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    escalateR(root);
    const before = listLooseEvents(bundle).map((e) => e.id);
    expect(listUnresolvedEscalatedTasks(listAccountingEvents(bundle))).toEqual(["T-001"]);

    let caught: unknown;
    try {
      resumeCursor(root, "C-RUN", "T-001");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    expect((caught as GraceCommandError).code).toBe("invalid-arguments");
    expect((caught as GraceCommandError).message).toMatch(/--reason/);

    const after = listLooseEvents(bundle);
    expect(after.map((e) => e.id)).toEqual(before);
    expect(after.some((e) => e.kind === "resume")).toBe(false);
    expect(listUnresolvedEscalatedTasks(listAccountingEvents(bundle))).toEqual(["T-001"]);
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");
    expect(showCursor(root, "C-RUN").escalatedTasks).toEqual(["T-001"]);
  });

  it("AC-RESUME-REASON-REQUIRED: whitespace-only reason refuses before write (resumeCursor)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    escalateR(root);
    const before = listLooseEvents(bundle).map((e) => e.id);

    let caught: unknown;
    try {
      resumeCursor(root, "C-RUN", "T-001", { reason: "   \n\t  " });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    expect((caught as GraceCommandError).code).toBe("invalid-arguments");
    expect((caught as GraceCommandError).message).toMatch(/--reason/);

    expect(listLooseEvents(bundle).map((e) => e.id)).toEqual(before);
    expect(listLooseEvents(bundle).some((e) => e.kind === "resume")).toBe(false);
    expect(listUnresolvedEscalatedTasks(listAccountingEvents(bundle))).toEqual(["T-001"]);
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");
  });

  it("AC-RESUME-REASON-REQUIRED: advance --kind resume without reason refuses before write", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    escalateR(root);
    const before = listLooseEvents(bundle).map((e) => e.id);

    let caught: unknown;
    try {
      advanceCursor(root, "C-RUN", { task: "T-001", kind: "resume" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    expect((caught as GraceCommandError).code).toBe("invalid-arguments");
    expect((caught as GraceCommandError).message).toMatch(/--reason/);

    expect(listLooseEvents(bundle).map((e) => e.id)).toEqual(before);
    expect(listLooseEvents(bundle).some((e) => e.kind === "resume")).toBe(false);
    expect(listUnresolvedEscalatedTasks(listAccountingEvents(bundle))).toEqual(["T-001"]);
    expect(showCursor(root, "C-RUN").state).toBe("paused-pending-approval");
  });

  it("AC-RESUME-REASON-RECORDED: special-character reason exact toBe on loose event and after fold", () => {
    // Counterweight: free-text replan prose with XML-significant chars + newline.
    const specialReason =
      'replan: use assertX & not assertY; guard <foo> and >bar; quotes "double" and \'single\'\nsecond line';
    const root = createProject();
    const bundle = seedBundle(root);
    escalateR(root);

    const resumed = resumeCursor(root, "C-RUN", "T-001", { reason: specialReason });
    expect(resumed.state).toBe("in-progress");
    expect(showCursor(root, "C-RUN").escalatedTasks).toEqual([]);

    const looseResume = listLooseEvents(bundle).find((e) => e.kind === "resume");
    expect(looseResume).toBeDefined();
    expect(reasonFromResumeEvent(looseResume!)).toBe(specialReason);
    // Must be a child element, not attributes.reason (VU's home).
    expect(looseResume!.attributes.reason).toBeUndefined();

    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    expect(listLooseEvents(bundle)).toHaveLength(0);

    const ledgerResume = listLedgerEvents(bundle).find((e) => e.kind === "resume");
    expect(ledgerResume).toBeDefined();
    expect(reasonFromResumeEvent(ledgerResume!)).toBe(specialReason);
    expect(ledgerResume!.attributes.reason).toBeUndefined();
  });

  it("AC-RESUME-REASON-RECORDED: advance --kind resume with reason records Reason child", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    escalateR(root);
    const reason = "advance-path replan: switch suite order";
    const resumed = advanceCursor(root, "C-RUN", { task: "T-001", kind: "resume", reason });
    expect(resumed.state).toBe("in-progress");
    const looseResume = listLooseEvents(bundle).find((e) => e.kind === "resume");
    expect(looseResume).toBeDefined();
    expect(reasonFromResumeEvent(looseResume!)).toBe(reason);
  });

  it("AC-RESUME-ORDINARY-WITHOUT-REASON: pause then resume without reason still works", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "pause" });
    expect(showCursor(root, "C-RUN").state).toBe("paused");
    expect(listUnresolvedEscalatedTasks(listAccountingEvents(bundle))).toEqual([]);

    const resumed = resumeCursor(root, "C-RUN", "T-001");
    expect(resumed.state).toBe("in-progress");
    const looseResume = listLooseEvents(bundle).find((e) => e.kind === "resume");
    expect(looseResume).toBeDefined();
    expect(looseResume!.children.find((c) => c.tag === "Reason")).toBeUndefined();
    expect(listUnresolvedEscalatedTasks(listAccountingEvents(bundle))).toEqual([]);
  });

  it("AC-RESUME-ORDINARY-WITHOUT-REASON: ordinary resume may still record optional reason", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "pause" });
    const reason = "optional note on ordinary resume";
    const resumed = resumeCursor(root, "C-RUN", "T-001", { reason });
    expect(resumed.state).toBe("in-progress");
    const looseResume = listLooseEvents(bundle).find((e) => e.kind === "resume");
    expect(reasonFromResumeEvent(looseResume!)).toBe(reason);
  });

  it("AC-BUDGET-WINDOW-PRESERVED: escalate → reason-resume → fail(C)×2 escalates R this-window only", () => {
    const root = createProject();
    seedBundle(root);
    escalateR(root, "T-001", "prior-window-a");

    resumeCursor(root, "C-RUN", "T-001", {
      reason: "replan: abandon prior-window signatures; new approach on C",
    });
    expect(showCursor(root, "C-RUN").state).toBe("in-progress");

    const firstC = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "C" },
      writeEvidence: evidencePaths([]),
    });
    expect(firstC.escalated).toBe(false);
    expect(firstC.signatures).toEqual([{ kind: "test", key: "C" }]);

    const secondC = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "C" },
      writeEvidence: evidencePaths([]),
    });
    expect(secondC.escalated).toBe(true);
    expect(secondC.trigger).toBe("R");
    expect(secondC.signatures).toEqual([
      { kind: "test", key: "C" },
      { kind: "test", key: "C" },
    ]);
    // Prior-window signature must not appear in this window's list or message.
    expect(secondC.signatures.some((s) => s.key === "prior-window-a")).toBe(false);
    expect(secondC.message).toContain("trigger R");
    expect(secondC.message).toContain("test:C");
    expect(secondC.message).not.toContain("prior-window-a");
    expect(secondC.attemptCount).toBe(2);
  });

  it("AC-BUDGET-WINDOW-PRESERVED: ordinary non-resolving resume does not reset the window", () => {
    const root = createProject();
    seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const first = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "pre" },
      writeEvidence: evidencePaths([]),
    });
    expect(first.escalated).toBe(false);

    resumeCursor(root, "C-RUN", "T-001"); // ordinary — nothing to resolve; no reason required
    resumeCursor(root, "C-RUN", "T-001");

    const second = recordAttempt(root, "C-RUN", {
      task: "T-001",
      outcome: "fail",
      signature: { kind: "test", key: "pre" },
      writeEvidence: evidencePaths([]),
    });
    expect(second.escalated).toBe(true);
    expect(second.trigger).toBe("R");
    expect(second.signatures.map((s) => s.key)).toEqual(["pre", "pre"]);
  });

  it("verification-unavailable attributes.reason is unchanged (NonGoal)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 99 });
    const vuReason = "harness missing binary & not a Reason child";
    recordVerificationUnavailable(root, "C-RUN", {
      task: "T-001",
      absence: { verdict: "not-run", reason: vuReason },
    });
    const vu = listLooseEvents(bundle).find((e) => e.kind === "verification-unavailable");
    expect(vu).toBeDefined();
    expect(vu!.attributes.reason).toBe(vuReason);
    expect(vu!.children.find((c) => c.tag === "Reason")).toBeUndefined();
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

describe("numeric epoch bounds (C-CURSOR-INTEGRITY T-002 / P0.4)", () => {
  const repoRoot = path.resolve(import.meta.dir, "..");

  function listRunFiles(root: string, changeId = "C-RUN"): string[] {
    const runDir = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run");
    if (!existsSync(runDir)) return [];
    return readdirSync(runDir).sort();
  }

  function cliOpenEpoch(root: string, from: string, to: string) {
    return Bun.spawnSync({
      cmd: [
        process.execPath,
        "./src/grace.ts",
        "cursor",
        "advance",
        "--change",
        "C-RUN",
        "--task",
        "T-001",
        "--open-epoch",
        "--from",
        from,
        "--to",
        to,
        "--path",
        root,
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  it("AC-EPOCH-BOUNDS-REJECT: CLI --from T-001 --to T-001 exits non-zero and writes no run/*", () => {
    const root = createProject();
    seedBundle(root);
    const result = cliOpenEpoch(root, "T-001", "T-001");
    const stderr = Buffer.from(result.stderr).toString("utf8");
    const stdout = Buffer.from(result.stdout).toString("utf8");
    const combined = `${stdout}\n${stderr}`;
    expect(result.exitCode).not.toBe(0);
    expect(combined).toMatch(/positive integer/i);
    expect(combined).toMatch(/event id/i);
    expect(combined).toMatch(/task id/i);
    expect(listRunFiles(root)).toEqual([]);
    expect(listRunFiles(root).some((f) => f.startsWith("NaN-"))).toBe(false);
  });

  it("AC-EPOCH-BOUNDS-CLASS: refuses non-integer, zero, negative, float, and from>to via CLI", () => {
    const cases: Array<[string, string]> = [
      ["abc", "10"],
      ["1.5", "10"],
      ["0", "10"],
      ["-1", "10"],
      ["10", "1"],
    ];
    for (const [from, to] of cases) {
      const root = createProject();
      seedBundle(root);
      const result = cliOpenEpoch(root, from, to);
      const combined = `${Buffer.from(result.stdout).toString("utf8")}\n${Buffer.from(result.stderr).toString("utf8")}`;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toMatch(/positive integer|event id|from|to/i);
      expect(listRunFiles(root)).toEqual([]);
    }
  });

  it("AC-EPOCH-BOUNDS-LIBRARY: advanceCursor refuses NaN, 0, -1, 1.5, and from>to; writes nothing", () => {
    const invalid: Array<{ from: number; to: number; label: string }> = [
      { from: Number("T-001"), to: Number("T-001"), label: "NaN task-id" },
      { from: NaN, to: 10, label: "NaN from" },
      { from: 0, to: 10, label: "zero" },
      { from: -1, to: 10, label: "negative" },
      { from: 1.5, to: 10, label: "float" },
      { from: 10, to: 1, label: "from>to" },
    ];
    for (const { from, to, label } of invalid) {
      const root = createProject();
      seedBundle(root);
      let threw: Error | undefined;
      try {
        advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from, to });
      } catch (error) {
        threw = error as Error;
      }
      expect(threw, label).toBeDefined();
      expect(threw!.message, label).toMatch(/positive integer/i);
      expect(threw!.message, label).toMatch(/event id/i);
      expect(threw!.message, label).toMatch(/task id/i);
      expect(listRunFiles(root), label).toEqual([]);
    }
  });

  it("valid --from 1 --to 10 still opens (library and CLI)", () => {
    const root = createProject();
    seedBundle(root);
    const position = advanceCursor(root, "C-RUN", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    expect(position.state).toBe("in-progress");
    expect(listRunFiles(root).some((f) => f.endsWith("-opened.xml"))).toBe(true);

    const root2 = createProject();
    seedBundle(root2);
    const result = cliOpenEpoch(root2, "1", "10");
    expect(result.exitCode).toBe(0);
    expect(listRunFiles(root2).length).toBeGreaterThan(0);
  });
});

/**
 * F8.1-shaped fixture: NaN-* opened (EVENT_FILENAME :459 class) + valid loose
 * integer events + optional well-named invalid-id file (:470 class). Temp only.
 */
function seedF8Shape(
  root: string,
  options: {
    changeId?: string;
    withInvalidIdFile?: boolean;
    withTerminal?: boolean;
    validIds?: number[];
  } = {},
): string {
  const changeId = options.changeId ?? "C-RUN";
  const bundle = seedBundle(root, changeId);
  const runDir = path.join(bundle, "run");
  mkdirSync(runDir, { recursive: true });
  // Live F8 shape — no recoverable event id.
  writeFileSync(
    path.join(runDir, "NaN-T-001-opened.xml"),
    `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-001" kind="opened"><Allocation worker="w0" from="NaN" to="NaN" /></NgraceRunEvent>`,
  );
  const validIds = options.validIds ?? [1, 2, 3];
  for (const id of validIds) {
    const kind = id === validIds[0] ? "progress" : id === validIds[validIds.length - 1] && options.withTerminal ? "terminal" : "progress";
    writeFileSync(
      path.join(runDir, `${id}-T-001-${kind}.xml`),
      `<NgraceRunEvent graceVersion="1.0" id="${id}" task="T-001" kind="${kind}"/>`,
    );
  }
  if (options.withInvalidIdFile) {
    // Well-named file (:459 match) whose XML id fails the positive-integer guard (:470).
    writeFileSync(
      path.join(runDir, "99-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="abc" task="T-001" kind="progress"/>`,
    );
  }
  return bundle;
}

describe("orphan inventory both skip classes (C-CURSOR-INTEGRITY T-003 / D8.7 / F8.2)", () => {
  it("listLooseEvents alone is blind to NaN-* and to well-named invalid-id files", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { withInvalidIdFile: true, validIds: [1, 2] });
    const loose = listLooseEvents(bundle);
    expect(loose.map((e) => e.id)).toEqual([1, 2]);
    expect(loose.some((e) => String(e.id) === "NaN")).toBe(false);
    expect(loose.some((e) => e.file.includes("NaN-"))).toBe(false);
    expect(loose.some((e) => e.file.includes("99-T-001"))).toBe(false);
  });

  it("AC-ORPHAN-BOTH-SKIPS: listRunOrphans reports EVENT_FILENAME miss (NaN-*) and invalid-id", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { withInvalidIdFile: true, validIds: [1, 2] });
    const orphans = listRunOrphans(bundle);
    const byClass = Object.fromEntries(orphans.map((o) => [o.class, o]));
    expect(orphans.length).toBeGreaterThanOrEqual(2);
    expect(byClass["event-filename"]).toBeDefined();
    expect(byClass["event-filename"]!.name).toBe("NaN-T-001-opened.xml");
    expect(byClass["event-filename"]!.recoverable).toBe(false);
    expect(byClass["event-filename"]!.reason).toMatch(/event id|filename|recoverable/i);
    expect(byClass["invalid-id"]).toBeDefined();
    expect(byClass["invalid-id"]!.name).toBe("99-T-001-progress.xml");
    expect(byClass["invalid-id"]!.recoverable).toBe(false);
    expect(byClass["invalid-id"]!.rawId).toBe("abc");
  });

  it("discriminating negative: :470-only inventory misses NaN-* (event-filename class required)", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { withInvalidIdFile: true, validIds: [1] });
    const orphans = listRunOrphans(bundle);
    // A reader that only checked positive-integer id after EVENT_FILENAME match
    // would report invalid-id but not NaN-*. Both classes must be present.
    expect(orphans.some((o) => o.class === "event-filename" && o.name.startsWith("NaN-"))).toBe(true);
    expect(orphans.some((o) => o.class === "invalid-id")).toBe(true);
  });

  it("discriminating negative: :459-only inventory misses well-named non-integer id", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { withInvalidIdFile: true, validIds: [1] });
    const orphans = listRunOrphans(bundle);
    // A reader that only flagged EVENT_FILENAME misses would report NaN-* but not 99-*.
    expect(orphans.some((o) => o.class === "invalid-id" && o.name === "99-T-001-progress.xml")).toBe(true);
    expect(orphans.some((o) => o.class === "event-filename")).toBe(true);
  });

  it("D8.7: listLooseEvents primary list stays ordered positive-integer only (unchanged contract)", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { withInvalidIdFile: true, validIds: [3, 1, 2] });
    const loose = listLooseEvents(bundle);
    expect(loose.map((e) => e.id)).toEqual([1, 2, 3]);
    // Orphans are not mixed into the primary list.
    for (const event of loose) {
      expect(Number.isInteger(event.id) && event.id > 0).toBe(true);
    }
    const orphanNames = new Set(listRunOrphans(bundle).map((o) => o.name));
    expect(orphanNames.has("NaN-T-001-opened.xml")).toBe(true);
    expect(orphanNames.has("99-T-001-progress.xml")).toBe(true);
    expect(loose.every((e) => !orphanNames.has(path.basename(e.file)))).toBe(true);
  });
});

describe("cursor recover diagnose (C-CURSOR-INTEGRITY T-004 / P0.6)", () => {
  const repoRoot = path.resolve(import.meta.dir, "..");

  function cliRecover(root: string, changeId = "C-RUN", extra: string[] = []) {
    return Bun.spawnSync({
      cmd: [
        process.execPath,
        "./src/grace.ts",
        "cursor",
        "recover",
        "--change",
        changeId,
        "--path",
        root,
        ...extra,
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  it("AC-RECOVER-DIAGNOSE: subcommand exists and reports F8.1 shape on a temp copy", () => {
    const root = createProject();
    seedF8Shape(root, { validIds: [1, 2, 3], withTerminal: false });
    const result = cliRecover(root);
    const stdout = Buffer.from(result.stdout).toString("utf8");
    const stderr = Buffer.from(result.stderr).toString("utf8");
    const combined = `${stdout}\n${stderr}`;
    // Diagnose is informational; exit 0 with a report a reviewer can run.
    expect(result.exitCode).toBe(0);
    expect(combined).toMatch(/unrecoverable orphan/i);
    expect(combined).toMatch(/NaN-T-001-opened\.xml/);
    expect(combined).toMatch(/no recoverable event id/i);
    expect(combined).toMatch(/missing|no valid|covering allocation/i);
    expect(combined).toMatch(/1\s*[.…]{1,3}\s*3|from=1.*to=3|1\.\.3|range.*1.*3/i);
    expect(combined).toMatch(/fold.*block/i);
  });

  it("AC-RECOVER-DIAGNOSE: library diagnosis fields are stable for JSON consumers", () => {
    const root = createProject();
    seedF8Shape(root, { validIds: [1, 2, 3] });
    const diagnosis = recoverCursor(root, "C-RUN");
    expect(diagnosis.fixApplied).toBe(false);
    expect(diagnosis.orphans.some((o) => o.name === "NaN-T-001-opened.xml" && o.recoverable === false)).toBe(true);
    expect(diagnosis.coveringAllocation).toBe("missing");
    expect(diagnosis.looseEventRange).toEqual({ from: 1, to: 3 });
    expect(diagnosis.looseEventIds).toEqual([1, 2, 3]);
    expect(diagnosis.foldBlocked).toBe(true);
    expect(diagnosis.foldBlockReasons.some((r) => /allocation/i.test(r))).toBe(true);
  });

  it("does not mutate the temp run/ on diagnose (and never touches live C-TOKEN)", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { validIds: [1, 2] });
    const before = readdirSync(path.join(bundle, "run")).sort();
    const nanBefore = readFileSync(path.join(bundle, "run", "NaN-T-001-opened.xml"), "utf8");
    recoverCursor(root, "C-RUN");
    expect(readdirSync(path.join(bundle, "run")).sort()).toEqual(before);
    expect(readFileSync(path.join(bundle, "run", "NaN-T-001-opened.xml"), "utf8")).toBe(nanBefore);
  });
});

describe("recover --fix and auto-open (C-CURSOR-INTEGRITY T-005 / P0.6 / D8.2 / D8.3)", () => {
  const repoRoot = path.resolve(import.meta.dir, "..");

  function cliRecoverFix(root: string, changeId = "C-RUN") {
    return Bun.spawnSync({
      cmd: [
        process.execPath,
        "./src/grace.ts",
        "cursor",
        "recover",
        "--change",
        changeId,
        "--fix",
        "--path",
        root,
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  it("AC-RECOVER-FIX-PRESERVES-ORPHAN: --fix covers valid ids; NaN-* stays on disk and diagnosed; fold succeeds", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { validIds: [1, 2, 3], withTerminal: true });
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const nanBefore = readFileSync(nanPath, "utf8");

    // Pre-fix diagnosis: missing covering allocation, orphan visible, fold blocked for allocation.
    const pre = recoverCursor(root, "C-RUN");
    expect(pre.coveringAllocation).toBe("missing");
    expect(pre.foldBlocked).toBe(true);
    expect(pre.foldBlockReasons.some((r) => /allocation/i.test(r))).toBe(true);
    expect(pre.orphans.some((o) => o.name === "NaN-T-001-opened.xml")).toBe(true);
    expect(collectAllocationsSafe(bundle)).toHaveLength(0);

    // --fix writes covering allocation for valid integer stream only (A29.2: derived bounds).
    const fixed = recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    expect(fixed.fixApplied).toBe(true);
    expect(fixed.coveringAllocation).toBe("present");
    expect(fixed.validAllocations.length).toBeGreaterThan(0);
    const cover = fixed.validAllocations[0]!;
    expect(cover.from).toBeLessThanOrEqual(1);
    expect(cover.to).toBeGreaterThanOrEqual(3);

    // D8.3 / F8.1: orphan still on disk with identical bytes.
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
    // And recover still reports it as unrecoverable orphan (deletion would pass a weaker bar).
    const after = recoverCursor(root, "C-RUN");
    expect(after.orphans.some((o) => o.name === "NaN-T-001-opened.xml" && o.recoverable === false)).toBe(true);
    expect(after.orphans.some((o) => o.class === "event-filename")).toBe(true);

    // Valid stream is foldable; fold must not require the orphan as a member.
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    expect(folded.eventCount).toBeGreaterThanOrEqual(3);
    // Orphan survives fold of the valid stream (fold only deletes listLooseEvents files).
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
  });

  it("AC-RECOVER-FIX: auto-open on fold also leaves NaN-* orphan on disk (F8.1 single-controller)", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { validIds: [1, 2, 3], withTerminal: true });
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const nanBefore = readFileSync(nanPath, "utf8");
    // F8.1 is single-controller (worker w0 on the NaN allocation only) → fold auto-opens.
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
    expect(listRunOrphans(bundle).some((o) => o.name === "NaN-T-001-opened.xml")).toBe(true);
  });

  it("AC-RECOVER-FIX-PRESERVES-ORPHAN: CLI --fix leaves NaN-* and still diagnoses it", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { validIds: [1, 2], withTerminal: true });
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const result = cliRecoverFix(root);
    expect(result.exitCode).toBe(0);
    const text = `${Buffer.from(result.stdout).toString("utf8")}\n${Buffer.from(result.stderr).toString("utf8")}`;
    expect(text).toMatch(/Fix applied:\s*yes/i);
    expect(existsSync(nanPath)).toBe(true);
    const again = cliRecoverFix(root); // second call: covering already present, still diagnose
    // Diagnose path (without needing fix) — use library
    const diag = recoverCursor(root, "C-RUN");
    expect(diag.orphans.some((o) => o.name.startsWith("NaN-"))).toBe(true);
    expect(again.exitCode).toBe(0);
  });

  it("AC-AUTO-OPEN-SINGLE-CONTROLLER: fold synthesizes covering opened when single worker", () => {
    const root = createProject();
    // No opened, no NaN — pure loose progress without allocation (single-controller).
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    for (const [id, kind] of [
      [1, "progress"],
      [2, "progress"],
      [3, "terminal"],
    ] as const) {
      writeFileSync(
        path.join(runDir, `${id}-T-001-${kind}.xml`),
        `<NgraceRunEvent graceVersion="1.0" id="${id}" task="T-001" kind="${kind}"/>`,
      );
    }
    // Pre-fix: fold fails without allocation / auto-open.
    // After fix: fold auto-opens single-controller covering allocation and succeeds.
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    expect(folded.eventCount).toBeGreaterThanOrEqual(3);
  });

  it("AC-AUTO-OPEN multi-worker: recover --fix refuses when >1 distinct worker", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    // No valid covering allocation; two worker names appear on broken opened-like files
    // that still contribute worker identity via Allocation attributes.
    writeFileSync(
      path.join(runDir, "NaN-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-001" kind="opened"><Allocation worker="wA" from="NaN" to="NaN"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "NaN-T-002-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-002" kind="opened"><Allocation worker="wB" from="NaN" to="NaN"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "1-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="progress"/>`,
    );
    writeFileSync(
      path.join(runDir, "2-T-001-terminal.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="terminal"/>`,
    );
    let threw: Error | undefined;
    try {
      recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    } catch (error) {
      threw = error as Error;
    }
    expect(threw).toBeDefined();
    expect(threw!.message).toMatch(/multiple workers|multi-worker|explicit epoch/i);
    // Valid stream still unallocated.
    expect(collectAllocationsSafe(bundle).length).toBe(0);
  });

  it("AC-AUTO-OPEN multi-worker: fold refuses auto-open when >1 distinct worker", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, "NaN-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-001" kind="opened"><Allocation worker="alpha" from="NaN" to="NaN"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "NaN-T-002-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-002" kind="opened"><Allocation worker="beta" from="NaN" to="NaN"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "1-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="progress"/>`,
    );
    writeFileSync(
      path.join(runDir, "2-T-001-terminal.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="terminal"/>`,
    );
    let threw: Error | undefined;
    try {
      foldEpoch(root, "C-RUN");
    } catch (error) {
      threw = error as Error;
    }
    expect(threw).toBeDefined();
    expect(threw!.message).toMatch(/Allocation|multiple workers|multi-worker|explicit/i);
  });
});

/** Test helper: allocations visible to listLooseEvents (valid opened only). */
function collectAllocationsSafe(bundlePath: string) {
  return listLooseEvents(bundlePath).flatMap((e) => e.allocations ?? []);
}

// ---------------------------------------------------------------------------
// C-RECOVER-FOLDABLE T-001 / T-002 / T-003 — F13 effective-range supersession
// ---------------------------------------------------------------------------

/** Live F13 damaged shape (C-TOKEN-INTEGRITY snapshot): dead w0:[1,19], terminal@20, NaN orphan. */
function seedDamagedTokenShape(root: string, changeId = "C-RUN"): string {
  const bundle = seedBundle(root, changeId);
  const runDir = path.join(bundle, "run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "NaN-T-001-opened.xml"),
    `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-001" kind="opened"><Allocation worker="w0" from="NaN" to="NaN" /></NgraceRunEvent>`,
  );
  for (let id = 1; id <= 18; id += 1) {
    writeFileSync(
      path.join(runDir, `${id}-T-001-progress.xml`),
      `<NgraceRunEvent graceVersion="1.0" id="${id}" task="T-001" kind="progress"/>`,
    );
  }
  // Dead covering opened — closed ceiling, no terminal in range (first --fix under F13).
  writeFileSync(
    path.join(runDir, "19-T-005-opened.xml"),
    `<NgraceRunEvent graceVersion="1.0" id="19" task="T-005" kind="opened"><Allocation worker="w0" from="1" to="19" /></NgraceRunEvent>`,
  );
  writeFileSync(
    path.join(runDir, "20-T-005-terminal.xml"),
    `<NgraceRunEvent graceVersion="1.0" id="20" task="T-005" kind="terminal"/>`,
  );
  return bundle;
}

describe("C-RECOVER-FOLDABLE T-001: effective allocation supersession (F13 / D9 / D9.1)", () => {
  const repoRoot = path.resolve(import.meta.dir, "..");

  it("red-first F13: clean no-terminal shape — after --fix + operator terminal, fold was blocked", () => {
    // Pre-fix property: writeCoveringOpened closed at openedId; terminal lands outside.
    // After the product fix this test still documents the sequence and expects fold to succeed.
    const root = createProject();
    const bundle = seedF8Shape(root, { validIds: [1, 2, 3], withTerminal: false });
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const nanBefore = readFileSync(nanPath, "utf8");
    const beforeFiles = new Map(
      readdirSync(path.join(bundle, "run")).map((name) => [
        name,
        readFileSync(path.join(bundle, "run", name), "utf8"),
      ]),
    );

    const fixed = recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    expect(fixed.fixApplied).toBe(true);
    // D9: no pre-existing run/* event file rewritten.
    for (const [name, content] of beforeFiles) {
      expect(readFileSync(path.join(bundle, "run", name), "utf8")).toBe(content);
    }
    // --fix must not emit terminal (A29.2 / F12).
    expect(listLooseEvents(bundle).some((e) => e.kind === "terminal")).toBe(false);
    const cover = fixed.validAllocations[0]!;
    expect(cover.from).toBeLessThanOrEqual(1);
    // Ceiling: max(covering requirement, openedId + 98)
    const coveringOpened = listLooseEvents(bundle).find((e) => e.kind === "opened");
    expect(coveringOpened).toBeDefined();
    const openedId = coveringOpened!.id;
    expect(cover.to).toBeGreaterThanOrEqual(openedId + 98);

    // Operator terminal (not --fix).
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
    const afterFold = recoverCursor(root, "C-RUN");
    expect(afterFold.orphans.some((o) => o.name === "NaN-T-001-opened.xml" && o.recoverable === false)).toBe(true);
  });

  it("discriminating negative: sole live effective range without terminal still blocks fold", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, "1-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="opened"><Allocation worker="w0" from="1" to="99" /></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "2-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="progress"/>`,
    );
    // No terminal — live effective range must still require termination.
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/unterminated/i);
  });

  it("D9 / LWW: dead prior allocation is superseded; no rewrite of recorded events", () => {
    const root = createProject();
    const bundle = seedDamagedTokenShape(root);
    const deadPath = path.join(bundle, "run", "19-T-005-opened.xml");
    const deadBefore = readFileSync(deadPath, "utf8");
    const fixed = recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    expect(fixed.fixApplied).toBe(true);
    expect(readFileSync(deadPath, "utf8")).toBe(deadBefore);
    // Effective set is the latest opened only — covering present, fold not blocked for dead range.
    expect(fixed.coveringAllocation).toBe("present");
    expect(fixed.foldBlocked).toBe(false);
    expect(fixed.validAllocations).toHaveLength(1);
    expect(fixed.validAllocations[0]!.to).toBeGreaterThanOrEqual(20);
    // Raw stream still has two opened allocations on disk.
    expect(collectAllocationsSafe(bundle).length).toBeGreaterThanOrEqual(2);
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
  });

  it("flag honesty: --fix help still says extend-allocation and describes effective extend", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "cursor", "recover", "--help"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = `${Buffer.from(result.stdout).toString("utf8")}\n${Buffer.from(result.stderr).toString("utf8")}`;
    expect(result.exitCode).toBe(0);
    expect(text).toMatch(/extend-allocation/i);
    expect(text).toMatch(/effective/i);
    expect(text).toMatch(/append|supersed/i);
  });

  it("auto-open shares writeCoveringOpened headroom (no carve-out)", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    for (const [id, kind] of [
      [1, "progress"],
      [2, "progress"],
      [3, "terminal"],
    ] as const) {
      writeFileSync(
        path.join(runDir, `${id}-T-001-${kind}.xml`),
        `<NgraceRunEvent graceVersion="1.0" id="${id}" task="T-001" kind="${kind}"/>`,
      );
    }
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    // Auto-open wrote a covering opened; its ceiling must include openedId+98 headroom.
    // After fold, loose events are gone — inspect ledger Epoch Allocation.
    const ledger = readFileSync(path.join(bundle, "run-ledger.xml"), "utf8");
    expect(ledger).toMatch(/Allocation[^>]*to="10[0-9]"|to="9[0-9]"/);
    // openedId becomes 4 after events 1..3; to >= 4+98 = 102
    expect(ledger).toMatch(/to="102"/);
  });

  it("carried D8.2: multi-worker recover --fix still refuses", () => {
    const root = createProject();
    const bundle = seedBundle(root);
    const runDir = path.join(bundle, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, "NaN-T-001-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-001" kind="opened"><Allocation worker="wA" from="NaN" to="NaN"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "NaN-T-002-opened.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-002" kind="opened"><Allocation worker="wB" from="NaN" to="NaN"/></NgraceRunEvent>`,
    );
    writeFileSync(
      path.join(runDir, "1-T-001-progress.xml"),
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="progress"/>`,
    );
    expect(() => recoverCursor(root, "C-RUN", { fix: "extend-allocation" })).toThrow(
      /multiple workers|multi-worker|explicit epoch/i,
    );
    expect(collectAllocationsSafe(bundle).length).toBe(0);
  });

  it("carried D8.3: orphan survives --fix and fold on clean path", () => {
    const root = createProject();
    const bundle = seedF8Shape(root, { validIds: [1, 2], withTerminal: false });
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const nanBefore = readFileSync(nanPath, "utf8");
    recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    expect(existsSync(nanPath)).toBe(true);
    expect(recoverCursor(root, "C-RUN").orphans.some((o) => o.name.startsWith("NaN-"))).toBe(true);
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    foldEpoch(root, "C-RUN");
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
    expect(listRunOrphans(bundle).some((o) => o.name === "NaN-T-001-opened.xml")).toBe(true);
  });
});

describe("C-RECOVER-FOLDABLE T-002: damaged-shape repair", () => {
  it("red-first then green: dead w0:[1,19] + terminal@20 + NaN orphan folds after --fix", () => {
    const root = createProject();
    const bundle = seedDamagedTokenShape(root);
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const nanBefore = readFileSync(nanPath, "utf8");
    const deadBefore = readFileSync(path.join(bundle, "run", "19-T-005-opened.xml"), "utf8");

    const pre = recoverCursor(root, "C-RUN");
    expect(pre.foldBlocked).toBe(true);
    expect(pre.coveringAllocation).toBe("missing");
    expect(pre.foldBlockReasons.some((r) => /outside|unterminated/i.test(r))).toBe(true);
    expect(pre.orphans.some((o) => o.name === "NaN-T-001-opened.xml")).toBe(true);
    expect(() => foldEpoch(root, "C-RUN")).toThrow(/outside|unterminated|Allocation/i);

    const fixed = recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    expect(fixed.fixApplied).toBe(true);
    // D9: dead opened file unchanged; --fix did not rewrite it and did not emit another terminal.
    expect(readFileSync(path.join(bundle, "run", "19-T-005-opened.xml"), "utf8")).toBe(deadBefore);
    const terminals = listLooseEvents(bundle).filter((e) => e.kind === "terminal");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]!.id).toBe(20);
    expect(fixed.coveringAllocation).toBe("present");
    expect(fixed.foldBlocked).toBe(false);
    const cover = fixed.validAllocations[0]!;
    const newOpened = listLooseEvents(bundle).filter((e) => e.kind === "opened").sort((a, b) => b.id - a.id)[0]!;
    expect(cover.to).toBeGreaterThanOrEqual(Math.max(20, newOpened.id + 98));
    expect(existsSync(nanPath)).toBe(true);
    expect(recoverCursor(root, "C-RUN").orphans.some((o) => o.name === "NaN-T-001-opened.xml")).toBe(true);

    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
    expect(listRunOrphans(bundle).some((o) => o.name === "NaN-T-001-opened.xml" && o.recoverable === false)).toBe(
      true,
    );
  });
});

describe("C-RECOVER-FOLDABLE T-003: clean no-terminal E2E (no withTerminal pre-seed)", () => {
  it("clean shape: --fix → operator terminal (with intervening progress) → fold; orphan survives", () => {
    const root = createProject();
    // Explicitly no terminal anywhere — withTerminal must not be used to satisfy this path.
    const bundle = seedF8Shape(root, { validIds: [1, 2, 3], withTerminal: false });
    expect(listLooseEvents(bundle).some((e) => e.kind === "terminal")).toBe(false);
    const nanPath = path.join(bundle, "run", "NaN-T-001-opened.xml");
    const nanBefore = readFileSync(nanPath, "utf8");

    recoverCursor(root, "C-RUN", { fix: "extend-allocation" });
    expect(listLooseEvents(bundle).some((e) => e.kind === "terminal")).toBe(false);
    // Intervening work within headroom, then operator terminal.
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "progress" });
    advanceCursor(root, "C-RUN", { task: "T-001", kind: "terminal" });
    const folded = foldEpoch(root, "C-RUN");
    expect(folded.applied).toBe(true);
    expect(existsSync(nanPath)).toBe(true);
    expect(readFileSync(nanPath, "utf8")).toBe(nanBefore);
    expect(listRunOrphans(bundle).some((o) => o.name === "NaN-T-001-opened.xml")).toBe(true);
  });

  it("regression bar: neither clean nor damaged path pre-seeds terminal inside pre-fix range", () => {
    // Clean path uses withTerminal: false; damaged path places terminal outside dead [1,19].
    const rootClean = createProject();
    const clean = seedF8Shape(rootClean, { validIds: [1, 2, 3], withTerminal: false });
    expect(listLooseEvents(clean).every((e) => e.kind !== "terminal")).toBe(true);

    const rootDamaged = createProject();
    const damaged = seedDamagedTokenShape(rootDamaged);
    const preFixTerminals = listLooseEvents(damaged).filter((e) => e.kind === "terminal");
    expect(preFixTerminals).toHaveLength(1);
    expect(preFixTerminals[0]!.id).toBe(20);
    // Terminal is outside the dead allocation [1,19] — not a withTerminal-inside-range seed.
    const dead = listLooseEvents(damaged).find((e) => e.id === 19);
    expect(dead?.allocations?.[0]).toEqual({ worker: "w0", from: 1, to: 19 });
    expect(preFixTerminals[0]!.id).toBeGreaterThan(19);
  });
});

describe("C-CALIBRATION-COMMAND-EVIDENCE T-002: fold joins command-run evidence", () => {
  const DEFAULT_WRITE_EVIDENCE: WriteEvidenceSnapshot = {
    available: true,
    files: [{ path: "src/example.ts", kind: "content", digest: "a".repeat(64) }],
  };

  /** Adjudication outcome only — attempt events also carry outcome= attributes. */
  function adjudicationOutcome(ledger: string): string | undefined {
    return ledger.match(/<CalibrationAdjudication\b[^>]*\boutcome="([^"]+)"/)?.[1];
  }

  function adjudicationBlock(ledger: string): string {
    return ledger.match(/<CalibrationAdjudication\b[^/]*\/>/)?.[0]
      ?? ledger.match(/<CalibrationAdjudication\b[\s\S]*?<\/CalibrationAdjudication>/)?.[0]
      ?? "";
  }

  function seedCalBundle(
    root: string,
    changeId: string,
    command: string,
  ): string {
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions:
        `<MustExist><Value>src/example.ts</Value></MustExist>`
        + `<MustPassCommand><Command>${command}</Command></MustPassCommand>`,
    });
    return path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
  }

  function openClaimAndTerminal(root: string, changeId: string): void {
    advanceCursor(root, changeId, { task: "T-001", openEpoch: true });
    recordAttempt(root, changeId, {
      task: "T-001",
      outcome: "pass",
      claimedConfidence: "medium",
      writeEvidence: DEFAULT_WRITE_EVIDENCE,
    });
  }

  it("red-first: planted matching command-run evidence is joined at fold → pass (pre-fix ignored records → pending)", () => {
    const root = createProject();
    const changeId = "C-JOIN-PASS";
    // Use a non-existent shell command so fold-time spawn (if any) cannot invent a pass.
    const command = "ngrace-command-run-evidence-marker-xyzzy-never-spawn";
    seedCalBundle(root, changeId, command);
    openClaimAndTerminal(root, changeId);
    appendCommandRunEvent(root, changeId, {
      command,
      exitCode: 0,
      assertionPassed: true,
      assertionKind: "MustPassCommand",
      source: "lint-run-commands",
    });
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    foldEpoch(root, changeId);

    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain("CalibrationAdjudication");
    expect(adjudicationBlock(ledger)).toContain('adjudicatedAt="fold"');
    // Pre-fix: evaluateTargetComplete(runCommands:false) stored pending and ignored records.
    // After join: matching assertionPassed=true evidence → pass.
    expect(adjudicationOutcome(ledger)).toBe("pass");
  });

  it("matching assertionPassed=false evidence → fold stores fail", () => {
    const root = createProject();
    const changeId = "C-JOIN-FAIL";
    const command = "exit 0";
    seedCalBundle(root, changeId, command);
    openClaimAndTerminal(root, changeId);
    appendCommandRunEvent(root, changeId, {
      command,
      exitCode: 1,
      assertionPassed: false,
      assertionKind: "MustPassCommand",
      source: "lint-run-commands",
    });
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    foldEpoch(root, changeId);

    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    expect(adjudicationOutcome(ledger)).toBe("fail");
    expect(adjudicationBlock(ledger)).toContain('adjudicatedAt="fold"');
  });

  it("no matching recorded evidence → pending with reason naming absent recorded evidence", () => {
    const root = createProject();
    const changeId = "C-JOIN-ABSENT";
    seedCalBundle(root, changeId, "exit 0");
    openClaimAndTerminal(root, changeId);
    // No command-run planted.
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    foldEpoch(root, changeId);

    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    expect(adjudicationOutcome(ledger)).toBe("pending");
    expect(adjudicationBlock(ledger)).toMatch(/absent recorded evidence/i);
    expect(adjudicationBlock(ledger)).toContain('adjudicatedAt="fold"');
  });

  it("match-key edit: evidence for A does not cover plan command B → pending; re-record B → pass", () => {
    const root = createProject();
    const changeId = "C-JOIN-EDIT";
    const commandA = "exit 0";
    const commandB = "true";
    seedCalBundle(root, changeId, commandA);
    openClaimAndTerminal(root, changeId);
    appendCommandRunEvent(root, changeId, {
      command: commandA,
      exitCode: 0,
      assertionPassed: true,
      assertionKind: "MustPassCommand",
      source: "lint-run-commands",
    });
    // Edit plan command A → B without new evidence.
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions:
        `<MustExist><Value>src/example.ts</Value></MustExist>`
        + `<MustPassCommand><Command>${commandB}</Command></MustPassCommand>`,
    });
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    foldEpoch(root, changeId);

    const ledger1 = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    expect(adjudicationOutcome(ledger1)).toBe("pending");
    expect(adjudicationBlock(ledger1)).toMatch(/absent recorded evidence/i);

    // Recovery: open new epoch covering post-fold ids (default from=1 would hole).
    const bundlePath = path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
    const maxFolded = listLedgerEvents(bundlePath).reduce((m, e) => Math.max(m, e.id), 0);
    const from = maxFolded + 1;
    advanceCursor(root, changeId, {
      task: "T-001",
      openEpoch: true,
      from,
      to: from + 98,
    });
    recordAttempt(root, changeId, {
      task: "T-001",
      outcome: "pass",
      claimedConfidence: "high",
      writeEvidence: DEFAULT_WRITE_EVIDENCE,
    });
    appendCommandRunEvent(root, changeId, {
      command: commandB,
      exitCode: 0,
      assertionPassed: true,
      assertionKind: "MustPassCommand",
      source: "lint-run-commands",
    });
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    foldEpoch(root, changeId);

    const ledger2 = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    // Both epochs present: first pending, second pass (append-only).
    const outcomes = [...ledger2.matchAll(/<CalibrationAdjudication\b[^>]*\boutcome="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(outcomes).toEqual(["pending", "pass"]);
  });

  it("D6.6: fold never spawns — non-existent command with planted pass evidence still folds pass", () => {
    const root = createProject();
    const changeId = "C-JOIN-NOSPAWN";
    const command = "definitely-not-a-real-binary-for-fold-join-test-$$";
    seedCalBundle(root, changeId, command);
    openClaimAndTerminal(root, changeId);
    appendCommandRunEvent(root, changeId, {
      command,
      exitCode: 0,
      assertionPassed: true,
      assertionKind: "MustPassCommand",
      source: "lint-run-commands",
    });
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    // If fold spawned this command it would fail (non-zero). Join-only must pass.
    foldEpoch(root, changeId);
    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    expect(adjudicationOutcome(ledger)).toBe("pass");
  });

  it("AC-D65: fold still writes CalibrationAdjudication when claimedConfidence exists", () => {
    const root = createProject();
    const changeId = "C-JOIN-D65";
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions: `<MustExist><Value>src/example.ts</Value></MustExist>`,
    });
    openClaimAndTerminal(root, changeId);
    advanceCursor(root, changeId, { task: "T-001", kind: "terminal" });
    foldEpoch(root, changeId);
    const ledger = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "run-ledger.xml"),
      "utf8",
    );
    expect(ledger).toContain("CalibrationAdjudication");
    expect(adjudicationBlock(ledger)).toContain('adjudicatedAt="fold"');
    expect(adjudicationOutcome(ledger)).toBe("pass");
  });

  it("kind=command-run is registered so cursor state does not degrade", () => {
    const resolved = cursorStateForEventKind("command-run");
    expect("state" in resolved).toBe(true);
    if ("state" in resolved) {
      expect(resolved.state).toBe("in-progress");
    }
  });
});

/**
 * Collect `<kind id="…">` values that are children of a `<cursor_kinds>` block.
 * Kinds outside the block do not count (AC-KIND-COMPLETENESS-TIED-TO-CODE).
 * Incidental English, backticks, or headings without that element do not match.
 */
function parseSkillCursorKindIds(skillMarkdown: string): string[] {
  const blockMatch = skillMarkdown.match(/<cursor_kinds>([\s\S]*?)<\/cursor_kinds>/);
  if (!blockMatch) return [];
  const ids: string[] = [];
  for (const match of blockMatch[1].matchAll(/<kind\s+id="([^"]+)"\s*>/g)) {
    ids.push(match[1]!);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// C-ESCALATION-HONESTY T-003 — skill prose agrees with live threshold constants
// ---------------------------------------------------------------------------

/**
 * Stale attempt-count budget claims (F21). Any match means the skill still
 * teaches "any two fails exhaust the budget" (or "after the second fail")
 * instead of triggers R/D. One sweep covers the four measured sites and any
 * fifth residual of the same family — not four hand-written exact strings
 * that TargetAssertions MustNotContain only partially cover.
 *
 * Sites measured at plan-authoring:
 *   rule 5            "Two failed attempts exhaust the fix budget…"
 *   attempt Meaning   "Two failed attempts exhaust the budget…"
 *   escalation When   "two failed attempts have exhausted…"
 *   escalation How    "…after the second failed attempt"
 */
const STALE_ATTEMPT_COUNT_BUDGET_CLAIM =
  /two failed attempts exhaust|two failed attempts have exhausted|second failed attempt|failed attempts exhaust the (?:fix )?budget/i;

const NGRACE_EXECUTE_SKILL_PATHS = [
  "skills/ngrace/ngrace-execute/SKILL.md",
  "plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md",
] as const;

describe("fix-budget skill prose agrees with constants (C-ESCALATION-HONESTY T-003 / AC-PROSE-ENFORCEMENT-AGREE)", () => {
  /**
   * Bidirectional agreement (both skill trees):
   * - Mutate FIX_DISTINCT_SIGNATURE_BUDGET (or REPEAT) without skill → required
   *   substring becomes e.g. "5 distinct failing signatures" → skill still has
   *   "4 …" → toContain fails (code→skill direction).
   * - Mutate a skill sentence (drop "4 distinct failing signatures" or restore
   *   a stale attempt-count claim) while constants stay → toContain / stale
   *   sweep fails (skill→code direction).
   * - Edit only canonical → packaged fails its loop iteration; parity also fails
   *   validate-marketplace (AC-SKILL-MIRROR-IDENTICAL is separate).
   * Kind-set completeness alone does not satisfy this AC (C-EXECUTION-CONTRACT trap).
   */
  it("both skill trees contain live threshold substrings and no stale attempt-count claim", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    const required = fixBudgetSkillRequiredSubstrings();
    // Pins the helper shape the skill must match (digits mid-sentence, not English words).
    expect([...required]).toEqual([
      `${FIX_SIGNATURE_REPEAT_BUDGET} failed attempts of the same signature`,
      `${FIX_DISTINCT_SIGNATURE_BUDGET} distinct failing signatures`,
    ]);

    for (const rel of NGRACE_EXECUTE_SKILL_PATHS) {
      const text = readFileSync(path.join(repoRoot, rel), "utf8");
      for (const sub of required) {
        expect({ path: rel, missing: sub, present: text.includes(sub) }).toEqual({
          path: rel,
          missing: sub,
          present: true,
        });
      }
      // Plan TargetAssertions MustNotContain only the rule-5 sentence; this
      // sweep also catches attempt Meaning / escalation When / How residues.
      const stale = STALE_ATTEMPT_COUNT_BUDGET_CLAIM.exec(text);
      expect({ path: rel, staleMatch: stale?.[0] ?? null }).toEqual({
        path: rel,
        staleMatch: null,
      });
    }
  });

  it("both skill trees document escalation-clearing resume requires --reason; ordinary resume does not", () => {
    // T-002 contract surface: F22 replan reason on escalation clear only.
    // Co-occurrence (not bare toContain): "--reason" alone matches verification-unavailable
    // and rule 5; "cursor resume" alone matches the pre-T-002 How form that T-002 refuses.
    // The claim is that each documented resume entry path's command form itself carries
    // --reason. A full-literal pin of the entire command would also catch a stripped flag
    // but would redden on a harmless placeholder rename (C-ID → CHANGE-ID).
    const resumeCmdHasReason = /ngrace cursor resume\b[^`\n]*--reason/;
    const advanceResumeCmdHasReason = /ngrace cursor advance\b[^`\n]*--kind resume[^`\n]*--reason/;
    const repoRoot = path.resolve(import.meta.dir, "..");
    for (const rel of NGRACE_EXECUTE_SKILL_PATHS) {
      const text = readFileSync(path.join(repoRoot, rel), "utf8");
      expect({
        path: rel,
        resumeCmdHasReason: resumeCmdHasReason.test(text),
        advanceResumeCmdHasReason: advanceResumeCmdHasReason.test(text),
      }).toEqual({
        path: rel,
        resumeCmdHasReason: true,
        advanceResumeCmdHasReason: true,
      });
      // Ordinary non-clearing resume must remain allowed without reason.
      expect(text).toMatch(/ordinary resume|does not clear an escalation/i);
      expect(text).toMatch(/without `--reason`|without --reason/i);
    }
  });

  it("canonical and packaged ngrace-execute skill bodies are byte-identical", () => {
    // AC-SKILL-MIRROR-IDENTICAL — same check validate-marketplace uses directionally.
    const repoRoot = path.resolve(import.meta.dir, "..");
    const a = readFileSync(path.join(repoRoot, NGRACE_EXECUTE_SKILL_PATHS[0]));
    const b = readFileSync(path.join(repoRoot, NGRACE_EXECUTE_SKILL_PATHS[1]));
    expect(Buffer.compare(a, b)).toBe(0);
  });
});

describe("KNOWN_EVENT_KINDS export and ngrace-execute completeness (C-EXECUTION-CONTRACT)", () => {
  it("exports a frozen list definitionally tied to KNOWN_KIND_STATE keys", () => {
    // Import-only: does not parse grace-cursor.ts source (F10 / AC-EXPORT-MINIMAL).
    expect(Object.isFrozen(KNOWN_EVENT_KINDS)).toBe(true);
    expect(KNOWN_EVENT_KINDS.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const kind of KNOWN_EVENT_KINDS) {
      expect(seen.has(kind)).toBe(false);
      seen.add(kind);
      const resolved = cursorStateForEventKind(kind);
      expect("state" in resolved).toBe(true);
    }
    // Denominator is the export alone — currently 9 keys of KNOWN_KIND_STATE.
    expect(KNOWN_EVENT_KINDS.length).toBe(9);
    expect([...KNOWN_EVENT_KINDS]).toEqual([
      "opened",
      "progress",
      "resume",
      "attempt",
      "verification-unavailable",
      "command-run",
      "pause",
      "terminal",
      "escalation",
    ]);
  });

  it("ngrace-execute documents every exported kind with a structural <kind id> marker", () => {
    // Sole denominator: imported KNOWN_EVENT_KINDS (not a fixed string list, not a source parse).
    // Adding a tenth key to KNOWN_KIND_STATE without a skill marker fails this suite.
    // A check that only greps for "terminal" or parses grace-cursor.ts would fail AC-KIND-COMPLETENESS-TIED-TO-CODE.
    const repoRoot = path.resolve(import.meta.dir, "..");
    const skillPath = path.join(repoRoot, "skills/ngrace/ngrace-execute/SKILL.md");
    const skill = readFileSync(skillPath, "utf8");
    const documented = parseSkillCursorKindIds(skill);
    const documentedSet = new Set(documented);
    const missing = KNOWN_EVENT_KINDS.filter((kind) => !documentedSet.has(kind));
    const exportSet = new Set<string>(KNOWN_EVENT_KINDS);
    const extras = documented.filter((id) => !exportSet.has(id));
    const duplicateIds = documented.filter((id, index) => documented.indexOf(id) !== index);

    // F12.2: report missing count and missing kind ids — not a bare expect(false).
    expect({
      missingCount: missing.length,
      missing,
      denominator: KNOWN_EVENT_KINDS.length,
      extras,
      duplicateIds,
    }).toEqual({
      missingCount: 0,
      missing: [],
      denominator: KNOWN_EVENT_KINDS.length,
      extras: [],
      duplicateIds: [],
    });

    for (const kind of KNOWN_EVENT_KINDS) {
      expect(documented.filter((id) => id === kind)).toHaveLength(1);
    }
  });
});


