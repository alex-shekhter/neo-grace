#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { defineCommand, type CommandDef, runMain } from "citty";

import { ARTIFACT_DIR, resolveContainedProjectPath } from "./artifact/paths";
import { resolveNgracePaths } from "./artifact/project";
import {
  ANCHOR_PATTERNS,
  ARTIFACT_TAG_PREFIX,
  EPOCH_SECTION_PATTERN,
  FIX_BUDGET,
  NGRACE_ARTIFACT_VERSION,
  RANGE_TERMINATING_EVENT_KINDS,
  RUN_EVENT_FIELD_REGISTRY,
  runEventFieldsForKind,
} from "./artifact/types";
import {
  cursorNamedTask,
  validateRunCursorArtifact,
  validateRunLedgerArtifact,
} from "./artifact/grammar";
import { collectActiveChangeScopes, observedWriteScopeContains } from "./artifact/scope";
import { childText, readGraceXmlArtifact, type GraceXmlNode } from "./artifact/xml";
import { serializeGraceXmlDocument } from "./artifact/xml-serialize";
import { isGitWorktreeDirty } from "./grace-graph";
import { lintGraceProject } from "./lint/core";
import { GraceCommandError, runGraceCommand } from "./query/errors";

/** Cursor / position state for one change bundle. */
export type CursorState = "absent" | "idle" | "in-progress" | "paused" | "complete";

/** Authority of a regenerated or shown position field (A11.5). */
export type PositionSource = "ledger" | "events" | "inferred" | "cursor" | "none";

/**
 * Authored absence vocabulary reused from skills/ngrace/ngrace-cli/references/verdicts.md
 * (Phase 2). Never invent a second vocabulary (A13.2, anti-pattern 5).
 */
export type AbsenceVerdict = "not-run" | "unable-to-determine";

export type AbsenceValue = {
  verdict: AbsenceVerdict;
  reason: string;
};

export type CursorPosition = {
  changeId: string;
  bundlePath: string;
  epoch?: number;
  /** Known task id only — never a guessed id (A13.2). */
  task?: string;
  /**
   * When no file→task map exists (row 3), task is the absence value with reason.
   * Never a fabricated T-* id.
   */
  taskAbsence?: AbsenceValue;
  /**
   * Determined state only. When the mechanism never looked (git unavailable,
   * archived / missing active scope), leave undefined and set stateAbsence (A14.1).
   */
  state?: CursorState;
  /**
   * Honest third value when state could not be checked (correction 27).
   * Distinct reasons for git-unavailable vs no-active-scope.
   */
  stateAbsence?: AbsenceValue;
  /**
   * Three-valued (A14.2 / correction 28):
   * - true: TargetAssertions evaluated clean with no skipped command evidence
   * - false: TargetAssertions evaluated and not met
   * - undefined + completeAbsence: not evaluable (commands skipped, change not approved, …)
   */
  complete?: boolean;
  completeAbsence?: AbsenceValue;
  /** How each recoverable field was obtained. */
  sources: {
    epoch: PositionSource;
    task: PositionSource;
    state: PositionSource;
  };
  /** Non-recoverable ledger facts are never invented from inference (D1). */
  inferred: boolean;
  degradation?: AbsenceValue;
};

export type FoldResult = {
  changeId: string;
  bundlePath: string;
  epoch: number;
  wave?: string;
  eventCount: number;
  dryRun: boolean;
  applied: boolean;
};

export type RangeAllocation = { worker: string; from: number; to: number };

/**
 * Loose run/ event. Typed fields beyond id/task/kind come from RUN_EVENT_FIELD_REGISTRY
 * (A18.7) so listLooseEvents and buildEpochNode share one source — never re-list by name.
 */
export type LooseEvent = {
  id: number;
  task: string;
  kind: string;
  file: string;
  allocations?: RangeAllocation[];
  /** Registry attributes (outcome, ordinal, signature-*, write-evidence, …). */
  fields: Record<string, string>;
};

export type AttemptOutcome = "pass" | "fail";

export type AttemptRecordResult = {
  changeId: string;
  bundlePath: string;
  task: string;
  ordinal: number;
  outcome: AttemptOutcome;
  signatureKind?: string;
  signatureKey?: string;
  writeEvidence?: string;
  failedAttemptCount: number;
  budget: number;
  exhausted: boolean;
  /** Failure signatures of failed attempts for this task (for escalation message). */
  failureSignatures: Array<{ ordinal: number; kind?: string; key?: string }>;
  position: CursorPosition;
};

export type FlakeVerdict = "flaky" | "normal-retry" | "unable-to-determine";

export type FlakeClassification = {
  verdict: FlakeVerdict;
  reason?: string;
};

const EVENT_FILENAME = /^(\d+)-([A-Za-z0-9_-]+)-([A-Za-z0-9_-]+)\.xml$/;

/** Resolve a C-* bundle under active or archive. */
export function resolveChangeBundle(projectRoot: string, changeId: string): string {
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    throw new GraceCommandError("invalid-arguments", `Change id ${JSON.stringify(changeId)} must be a canonical C-* identifier.`);
  }
  const root = path.resolve(projectRoot);
  const paths = resolveNgracePaths(root);
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    const candidate = path.join(directory, changeId);
    if (existsSync(candidate)) return candidate;
  }
  throw new GraceCommandError("not-found", `Change bundle ${changeId} not found under ${ARTIFACT_DIR}/changes.`);
}

/** List loose run/ events ordered by allocated id (never by mtime). */
export function listLooseEvents(bundlePath: string): LooseEvent[] {
  const runDir = path.join(bundlePath, "run");
  if (!existsSync(runDir)) return [];
  const events: LooseEvent[] = [];
  for (const name of readdirSync(runDir)) {
    const match = EVENT_FILENAME.exec(name);
    if (!match) continue;
    const file = path.join(runDir, name);
    const id = Number(match[1]);
    const task = match[2]!;
    const kind = match[3]!;
    const parsed = readGraceXmlArtifact(file);
    const allocations =
      kind === "opened" && parsed.root
        ? parsed.root.children
            .filter((child) => child.tag === "Allocation")
            .map(parseAllocationNode)
            .filter((entry): entry is RangeAllocation => entry !== null)
        : undefined;
    // Read every registry field for this kind — do not re-list attribute names (A18.7, A5.4).
    const fields: Record<string, string> = {};
    if (parsed.root) {
      for (const field of runEventFieldsForKind(kind)) {
        const value = parsed.root.attributes[field.attribute];
        if (value !== undefined && value !== "") fields[field.attribute] = value;
      }
    }
    events.push({ id, task, kind, file, allocations, fields });
  }
  return events.sort((a, b) => a.id - b.id);
}

/** Show position: never writes; recovers rather than blocks (A11.5). */
export function showCursor(projectRoot: string, changeId: string): CursorPosition {
  const root = path.resolve(projectRoot);
  const bundlePath = resolveChangeBundle(root, changeId);
  return derivePosition(bundlePath, changeId, { preferWrittenCursor: true, projectRoot: root });
}

/**
 * Regenerate cursor projection from ledger → loose events → codebase evidence.
 * Writes only when apply is true (invariant 8 / A11.5).
 */
export function regenerateCursor(
  projectRoot: string,
  changeId: string,
  options: { apply?: boolean; allowDirty?: boolean } = {},
): { position: CursorPosition; dryRun: boolean; applied: boolean } {
  const root = path.resolve(projectRoot);
  if (options.apply && !options.allowDirty && isGitWorktreeDirty(root)) {
    throw new GraceCommandError(
      "invalid-arguments",
      "Refusing to write: git worktree is dirty. Commit/stash changes or pass --allow-dirty.",
    );
  }
  const bundlePath = resolveChangeBundle(root, changeId);
  const position = derivePosition(bundlePath, changeId, { preferWrittenCursor: false, projectRoot: root });
  const dryRun = !options.apply;
  if (dryRun) {
    return { position, dryRun: true, applied: false };
  }
  writeCursorFile(bundlePath, position);
  return { position, dryRun: false, applied: true };
}

/** Advance: append an event and update the cursor (writes). */
export function advanceCursor(
  projectRoot: string,
  changeId: string,
  options: {
    task: string;
    kind?: string;
    worker?: string;
    from?: number;
    to?: number;
    wave?: string;
    openEpoch?: boolean;
  },
): CursorPosition {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const runDir = path.join(bundlePath, "run");
  mkdirSync(runDir, { recursive: true });

  if (options.openEpoch) {
    const from = options.from ?? 1;
    const to = options.to ?? from + 98;
    const worker = options.worker ?? "w0";
    const id = nextEventId(bundlePath, from);
    const task = options.task;
    writeEventFile(bundlePath, {
      id,
      task,
      kind: "opened",
      allocations: [{ worker, from, to }],
      wave: options.wave,
    });
    const position: CursorPosition = {
      changeId,
      bundlePath,
      epoch: nextEpochNumber(bundlePath),
      task,
      state: "in-progress",
      sources: { epoch: "events", task: "events", state: "events" },
      inferred: false,
    };
    writeCursorFile(bundlePath, position);
    return position;
  }

  const kind = options.kind ?? "progress";
  const task = options.task;
  if (!ANCHOR_PATTERNS.task.test(task)) {
    throw new GraceCommandError("invalid-arguments", `Task ${JSON.stringify(task)} must be a canonical T-* id.`);
  }
  const id = nextEventId(bundlePath);
  writeEventFile(bundlePath, { id, task, kind });
  const state: CursorState =
    kind === "terminal" ? "complete" : kind === "pause" ? "paused" : "in-progress";
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task,
    state,
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
  };
  writeCursorFile(bundlePath, position);
  return position;
}

/** Pause: write a pause event and set cursor state paused. */
export function pauseCursor(projectRoot: string, changeId: string, task: string): CursorPosition {
  return advanceCursor(projectRoot, changeId, { task, kind: "pause" });
}

/** Resume: write a resume event and set cursor state in-progress. */
export function resumeCursor(projectRoot: string, changeId: string, task: string): CursorPosition {
  return advanceCursor(projectRoot, changeId, { task, kind: "resume" });
}

/**
 * Fold open-epoch loose events into run-ledger.xml.
 * Ordering: write → verify → delete (D3). Never delete first.
 *
 * injectFailure* hooks exist solely to test the D3 crash window (interrupted fold).
 * They ship in package.json#files with this module because the write surface is one
 * file; they are unreachable from the CLI. Trade recorded under A12.5 — kept deliberately
 * so the fold ordering gate stays mechanically testable without a second test-only package.
 */
export function foldEpoch(
  projectRoot: string,
  changeId: string,
  options: {
    wave?: string;
    /**
     * Explicit incomplete fold (A18.8): write Epoch-N complete="false" and skip
     * hole/unterminated refusal. Default remains refuse.
     */
    allowIncomplete?: boolean;
    /** Test-only: throw after ledger write and verify, before delete. */
    injectFailureAfterWrite?: boolean;
    /** Test-only: throw after write, before verify (still leaves both forms). */
    injectFailureBeforeVerify?: boolean;
  } = {},
): FoldResult {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const events = listLooseEvents(bundlePath);
  if (events.length === 0) {
    // Idempotent re-fold: nothing loose → success with last epoch if any.
    const ledgerEpochs = readLedgerEpochNumbers(bundlePath);
    const last = ledgerEpochs[ledgerEpochs.length - 1];
    if (last === undefined) {
      throw new GraceCommandError("invalid-arguments", `No loose run/ events to fold for ${changeId}.`);
    }
    return {
      changeId,
      bundlePath,
      epoch: last,
      eventCount: 0,
      dryRun: false,
      applied: true,
    };
  }

  const allocations = collectAllocations(events);
  if (allocations.length === 0) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Cannot fold ${changeId}: no Allocation found (emit an opened event with Allocation children first).`,
    );
  }

  // Membership + density before write (fold owns validation — A11.2).
  // allowIncomplete skips hole/unterminated only; outside-allocation still refuses (A18.8).
  const membershipIssues = validateEventsAgainstAllocations(events, allocations, {
    allowIncomplete: Boolean(options.allowIncomplete),
  });
  if (membershipIssues.length > 0) {
    throw new GraceCommandError("invalid-project", membershipIssues.join(" "));
  }

  const epochNumber = nextEpochNumber(bundlePath);
  const wave = options.wave ?? readWaveFromOpened(events);
  const epochNode = buildEpochNode(epochNumber, wave, allocations, events, {
    complete: options.allowIncomplete ? false : undefined,
  });
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");

  // --- write ---
  const nextLedger = appendEpochToLedger(bundlePath, changeId, epochNode);
  const serialized = serializeGraceXmlDocument(nextLedger);
  // Paths for destructive ops go through resolveContainedProjectPath.
  const containedLedger = resolveContainedProjectPath(bundlePath, "run-ledger.xml", {
    mode: "output",
    allowedRoot: bundlePath,
  });
  writeFileSync(containedLedger.absolutePath, serialized);

  if (options.injectFailureBeforeVerify) {
    throw new Error("injected failure before verify");
  }

  // --- verify ---
  const written = readGraceXmlArtifact(ledgerPath);
  const validation = validateRunLedgerArtifact(written);
  const identity = written.root?.children.find((c) => c.tag === changeId);
  const writtenEpoch = identity?.children.find((c) => c.tag === `Epoch-${epochNumber}`);
  if (!writtenEpoch) {
    throw new GraceCommandError(
      "invalid-project",
      `Fold verify failed: Epoch-${epochNumber} missing from written ledger.`,
    );
  }
  const writtenEvents = writtenEpoch.children.filter((c) => c.tag === "Event");
  if (writtenEvents.length !== events.filter((e) => e.kind !== "opened" || true).length) {
    // Count Event children vs loose events (opened is also an Event in the ledger).
    const expected = events.length;
    if (writtenEvents.length !== expected) {
      throw new GraceCommandError(
        "invalid-project",
        `Fold verify failed: expected ${expected} events, ledger has ${writtenEvents.length}.`,
      );
    }
  }
  const errors = validation.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new GraceCommandError(
      "invalid-project",
      `Fold verify failed: ${errors.map((e) => e.code).join(", ")}`,
      { issues: errors.map((e) => e.code) },
    );
  }

  if (options.injectFailureAfterWrite) {
    throw new Error("injected failure after write");
  }

  // --- delete (only after verify) ---
  for (const event of events) {
    const relative = path.relative(bundlePath, event.file).replaceAll("\\", "/");
    const contained = resolveContainedProjectPath(bundlePath, relative, {
      mode: "existing",
      allowedRoot: bundlePath,
    });
    unlinkSync(contained.absolutePath);
  }

  // Preserve pause/exhaustion across fold (A20.2): do not overwrite paused with idle.
  // After delete, derive from the events just folded (ledger is now the record).
  const lastEvent = events[events.length - 1];
  const foldedPaused = events.some(
    (event) =>
      (event.kind === "exhausted" || event.kind === "pause") &&
      !events.some(
        (later) =>
          later.id > event.id &&
          later.task === event.task &&
          (later.kind === "resume" || later.kind === "terminal"),
      ),
  );
  const state: CursorState = foldedPaused
    ? "paused"
    : lastEvent?.kind === "terminal"
      ? "complete"
      : "idle";
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: epochNumber,
    task: lastEvent?.task,
    state,
    sources: { epoch: "ledger", task: "ledger", state: "ledger" },
    inferred: false,
  };
  writeCursorFile(bundlePath, position);

  return {
    changeId,
    bundlePath,
    epoch: epochNumber,
    wave,
    eventCount: events.length,
    dryRun: false,
    applied: true,
  };
}

/** Derive position from ledger → events → optional written cursor → row-3 repository evidence (A13.2). */
export function derivePosition(
  bundlePath: string,
  changeId: string,
  options: { preferWrittenCursor?: boolean; projectRoot?: string } = {},
): CursorPosition {
  const projectRoot = path.resolve(options.projectRoot ?? path.join(bundlePath, "..", "..", ".."));
  const cursorPath = path.join(bundlePath, "run.xml");
  const events = listLooseEvents(bundlePath);
  const ledgerEpochs = readLedgerEpochNumbers(bundlePath);

  let degradation: CursorPosition["degradation"];
  let written: CursorPosition | undefined;

  if (options.preferWrittenCursor && existsSync(cursorPath)) {
    const artifact = readGraceXmlArtifact(cursorPath);
    const structural = validateRunCursorArtifact(artifact);
    const identityOk =
      structural.issues.every((i) => i.code !== "cursor.invalid-change-id" && i.code !== "cursor.invalid-root-tag");
    const identity = artifact.root
      ? artifact.root.children.find((c) => ANCHOR_PATTERNS.change.test(c.tag))?.tag
      : undefined;
    if (!identityOk || (identity && identity !== changeId)) {
      degradation = {
        verdict: "unable-to-determine",
        reason: identity && identity !== changeId
          ? `cursor identity ${identity} disagrees with bundle ${changeId}; re-derived`
          : "cursor untrustworthy; re-derived",
      };
    } else if (artifact.root) {
      const task = cursorNamedTask(artifact.root);
      const wrapper = artifact.root.children.find((c) => c.tag === changeId);
      const epochText = wrapper ? childText(wrapper, "Epoch") : undefined;
      const stateText = wrapper ? childText(wrapper, "State") : undefined;
      written = {
        changeId,
        bundlePath,
        epoch: epochText ? Number(epochText) : undefined,
        task,
        state: (stateText as CursorState) || "idle",
        sources: { epoch: "cursor", task: "cursor", state: "cursor" },
        inferred: false,
      };
    }
  } else if (options.preferWrittenCursor && !existsSync(cursorPath)) {
    // Missing cursor: silent for lint; show still re-derives (A11.5).
    degradation = {
      verdict: "not-run",
      reason: "cursor absent; position re-derived from ledger and events",
    };
  }

  if (written && !degradation) {
    return written;
  }

  // Row 1–2: ledger + loose events
  if (events.length > 0 || ledgerEpochs.length > 0) {
    const lastEvent = events[events.length - 1];
    const epoch =
      events.length > 0
        ? nextEpochNumber(bundlePath)
        : ledgerEpochs[ledgerEpochs.length - 1];
    const task = lastEvent?.task ?? lastTaskFromLedger(bundlePath);
    let state: CursorState = "idle";
    if (events.length > 0) {
      // exhausted is range-terminating but task-paused (A18.8); terminal closes complete.
      state =
        lastEvent?.kind === "pause" || lastEvent?.kind === "exhausted"
          ? "paused"
          : lastEvent?.kind === "terminal"
            ? "complete"
            : "in-progress";
    }
    return {
      changeId,
      bundlePath,
      epoch,
      task,
      state,
      sources: {
        epoch: events.length > 0 ? "events" : "ledger",
        task: lastEvent ? "events" : task ? "ledger" : "none",
        state: events.length > 0 ? "events" : "ledger",
      },
      inferred: false,
      degradation,
    };
  }

  // Row 3 (A13.2): repository evidence only — never invent a task id.
  return deriveRow3Position(projectRoot, bundlePath, changeId, degradation);
}

/**
 * Row 3 contract (A13.2 / A14.1–A14.2):
 * - state: in-progress iff OWS intersects git changed files; idle when checked and empty;
 *   stateAbsence when git unavailable or no active scope (never claim idle without looking)
 * - task: absence value with reason (never a task id — no file→task map in the model)
 * - epoch: absent
 * - complete: three-valued — true only when TargetAssertions evaluate clean with no
 *   skipped command evidence; false when evaluated and unmet; absence when not evaluable
 */
function deriveRow3Position(
  projectRoot: string,
  bundlePath: string,
  changeId: string,
  degradation: CursorPosition["degradation"],
): CursorPosition {
  const paths = resolveNgracePaths(projectRoot);
  const scopes = collectActiveChangeScopes(paths);
  const scope = scopes.find((entry) => entry.changeId === changeId);
  const { available, changedFiles } = listRepositoryChangedFiles(projectRoot);

  let state: CursorState | undefined;
  let stateAbsence: AbsenceValue | undefined;
  if (!available) {
    // Correction 27 path 1: listRepositoryChangedFiles saw a non-zero git exit.
    stateAbsence = {
      verdict: "unable-to-determine",
      reason:
        "repository changed-file set unavailable (git status exited non-zero); ObservedWriteScope intersection was not checked",
    };
  } else if (!scope) {
    // Correction 27 path 2: collectActiveChangeScopes reads only changesActiveDir.
    stateAbsence = {
      verdict: "unable-to-determine",
      reason:
        "bundle has no active ObservedWriteScope (archived or unreadable plan); repository intersection was not checked",
    };
  } else {
    const intersects = changedFiles.some((file) => observedWriteScopeContains(scope.observedWrites, file));
    state = intersects ? "in-progress" : "idle";
  }

  const taskAbsence: AbsenceValue = {
    verdict: "unable-to-determine",
    reason:
      "no ledger or loose events; ObservedWriteScope is bundle-level and no plan task carries a file list, so task identity cannot be recovered",
  };

  const { complete, completeAbsence } = evaluateTargetComplete(projectRoot, changeId);

  return {
    changeId,
    bundlePath,
    epoch: undefined,
    task: undefined,
    taskAbsence,
    state,
    stateAbsence,
    complete,
    completeAbsence,
    sources: {
      epoch: "none",
      task: "inferred",
      state: stateAbsence ? "none" : "inferred",
    },
    inferred: true,
    degradation: degradation ?? {
      verdict: "unable-to-determine",
      reason: "no ledger or loose events; position inferred from ObservedWriteScope and target assertions only",
    },
  };
}

/** Assertion codes that mean "could not evaluate", not "target not reached". */
const COMPLETE_NOT_EVALUABLE = new Set([
  "assertion.command-not-evaluated",
  "assertion.change-not-approved",
  "assertion.change-required",
  "assertion.invalid-change-id",
]);

/**
 * Three-valued complete (correction 28). Still uses runCommands: false (A5.2);
 * skipped command evidence becomes absence (not-run), not complete:true or complete:false.
 */
export function evaluateTargetComplete(
  projectRoot: string,
  changeId: string,
): { complete?: boolean; completeAbsence?: AbsenceValue } {
  const result = lintGraceProject(projectRoot, {
    assertionMode: "target",
    changeId,
    runCommands: false,
  });
  const assertionErrors = result.issues.filter(
    (issue) => issue.severity === "error" && issue.code.startsWith("assertion."),
  );
  const notEvaluable = assertionErrors.filter((issue) => COMPLETE_NOT_EVALUABLE.has(issue.code));
  if (notEvaluable.some((issue) => issue.code === "assertion.command-not-evaluated")) {
    return {
      complete: undefined,
      completeAbsence: {
        verdict: "not-run",
        reason:
          "MustPassCommand or MustPassBudget evidence was not executed (command execution not opted in); complete is not evaluable from structural target assertions alone",
      },
    };
  }
  if (notEvaluable.length > 0) {
    const first = notEvaluable[0]!;
    return {
      complete: undefined,
      completeAbsence: {
        verdict: "unable-to-determine",
        reason:
          first.code === "assertion.change-not-approved"
            ? "selected change is not an active approved bundle; target assertions were not evaluated"
            : `${first.code}: ${first.message}`,
      },
    };
  }
  return { complete: assertionErrors.length === 0 };
}

/** @deprecated Prefer evaluateTargetComplete — boolean collapses absence into false (A14.2). */
export function targetAssertionsClean(projectRoot: string, changeId: string): boolean {
  const { complete } = evaluateTargetComplete(projectRoot, changeId);
  return complete === true;
}

/**
 * Changed-file set matching collectObservedDrift's git porcelain parse
 * (grace-status.ts). No network; deterministic against the worktree.
 */
export function listRepositoryChangedFiles(projectRoot: string): { available: boolean; changedFiles: string[] } {
  const statusResult = Bun.spawnSync({
    cmd: ["git", "-c", "status.relativePaths=true", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (statusResult.exitCode !== 0) {
    return { available: false, changedFiles: [] };
  }
  const output = new TextDecoder().decode(statusResult.stdout);
  const records = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes("R") || status.includes("C")) {
      const sourcePath = records[index + 1];
      if (sourcePath) paths.push(sourcePath);
      index += 1;
    }
  }
  const changedFiles = [
    ...new Set(
      paths
        .map((entry) => entry.replaceAll("\\", "/").replace(/^\.\//, ""))
        .filter((entry) => entry !== "" && !entry.startsWith("../") && entry !== ".." && !path.posix.isAbsolute(entry)),
    ),
  ].sort();
  return { available: true, changedFiles };
}

export function formatCursorPosition(position: CursorPosition): string {
  const taskLine = position.task
    ? `Task: ${position.task}`
    : position.taskAbsence
      ? `Task: ${position.taskAbsence.verdict} — ${position.taskAbsence.reason}`
      : "Task: none";
  const stateLine = position.stateAbsence
    ? `State: ${position.stateAbsence.verdict} — ${position.stateAbsence.reason}`
    : `State: ${position.state ?? "none"}`;
  const completeLine = position.completeAbsence
    ? `Complete: ${position.completeAbsence.verdict} — ${position.completeAbsence.reason}`
    : `Complete: ${position.complete === undefined ? "n/a" : position.complete ? "yes" : "no"}`;
  const lines = [
    `Change: ${position.changeId}`,
    stateLine,
    `Epoch: ${position.epoch ?? "none"}`,
    taskLine,
    completeLine,
    `Inferred: ${position.inferred ? "yes" : "no"}`,
    `Sources: epoch=${position.sources.epoch} task=${position.sources.task} state=${position.sources.state}`,
  ];
  if (position.degradation) {
    lines.push(`Degradation: ${position.degradation.verdict} — ${position.degradation.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatFoldResult(result: FoldResult): string {
  return [
    result.applied ? "Fold applied" : "Fold dry-run",
    `Change: ${result.changeId}`,
    `Epoch: ${result.epoch}${result.wave ? ` wave=${result.wave}` : ""}`,
    `Events: ${result.eventCount}`,
  ].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseAllocationNode(node: GraceXmlNode): RangeAllocation | null {
  const worker = node.attributes.worker?.trim() || childText(node, "Worker")?.trim();
  const from = Number(node.attributes.from ?? childText(node, "From"));
  const to = Number(node.attributes.to ?? childText(node, "To"));
  if (!worker || !Number.isInteger(from) || !Number.isInteger(to) || from > to) return null;
  return { worker, from, to };
}

function collectAllocations(events: LooseEvent[]): RangeAllocation[] {
  const fromOpened = events.flatMap((event) => event.allocations ?? []);
  return fromOpened;
}

function validateEventsAgainstAllocations(
  events: LooseEvent[],
  allocations: RangeAllocation[],
  options: { allowIncomplete?: boolean } = {},
): string[] {
  const issues: string[] = [];
  for (const event of events) {
    const ok = allocations.some((a) => event.id >= a.from && event.id <= a.to);
    if (!ok) issues.push(`event ${event.id} outside every allocation`);
  }
  if (options.allowIncomplete) return issues;
  for (const allocation of allocations) {
    const inRange = events
      .filter((e) => e.id >= allocation.from && e.id <= allocation.to)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    if (inRange.length === 0) continue;
    const maxUsed = inRange[inRange.length - 1]!;
    const set = new Set(inRange);
    for (let id = allocation.from; id <= maxUsed; id += 1) {
      if (!set.has(id)) {
        issues.push(`range hole at ${id} for ${allocation.worker}`);
        break;
      }
    }
    // Range-terminating set: terminal | exhausted (A18.8, A19.3). Pause alone does not close.
    const hasTerminal = events.some(
      (e) =>
        e.id >= allocation.from && e.id <= allocation.to && RANGE_TERMINATING_EVENT_KINDS.has(e.kind),
    );
    if (!hasTerminal) issues.push(`unterminated range for ${allocation.worker}`);
  }
  return issues;
}

function buildEpochNode(
  epochNumber: number,
  wave: string | undefined,
  allocations: RangeAllocation[],
  events: LooseEvent[],
  options: { complete?: boolean } = {},
): GraceXmlNode {
  const children: GraceXmlNode[] = [
    ...allocations.map((allocation) => ({
      tag: "Allocation",
      attributes: {
        worker: allocation.worker,
        from: String(allocation.from),
        to: String(allocation.to),
      },
      children: [] as GraceXmlNode[],
      text: "",
    })),
    ...events.map((event) => {
      // Emit id/task/kind plus every registry field present — iterate the registry (A18.7).
      const attributes: Record<string, string> = {
        id: String(event.id),
        task: event.task,
        kind: event.kind,
      };
      for (const field of runEventFieldsForKind(event.kind)) {
        const value = event.fields[field.attribute];
        if (value !== undefined && value !== "") attributes[field.attribute] = value;
      }
      return {
        tag: "Event",
        attributes,
        children: [] as GraceXmlNode[],
        text: "",
      };
    }),
  ];
  const attributes: Record<string, string> = {};
  if (wave) attributes.wave = wave;
  // complete="false" only; omit attribute when complete (default) so older ledgers stay quiet.
  if (options.complete === false) attributes.complete = "false";
  return {
    tag: `Epoch-${epochNumber}`,
    attributes,
    children,
    text: "",
  };
}

function appendEpochToLedger(bundlePath: string, changeId: string, epochNode: GraceXmlNode): GraceXmlNode {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) {
    return {
      tag: `${ARTIFACT_TAG_PREFIX}RunLedger`,
      attributes: { graceVersion: NGRACE_ARTIFACT_VERSION },
      children: [
        {
          tag: changeId,
          attributes: {},
          children: [epochNode],
          text: "",
        },
      ],
      text: "",
    };
  }
  const existing = readGraceXmlArtifact(ledgerPath);
  if (!existing.root) {
    throw new GraceCommandError("invalid-project", `Existing run-ledger.xml at ${ledgerPath} is unreadable.`);
  }
  const root: GraceXmlNode = {
    tag: existing.root.tag,
    attributes: { ...existing.root.attributes },
    children: existing.root.children.map((child) => ({
      tag: child.tag,
      attributes: { ...child.attributes },
      children: [...child.children],
      text: child.text,
    })),
    text: existing.root.text,
  };
  let wrapper = root.children.find((c) => c.tag === changeId);
  if (!wrapper) {
    wrapper = { tag: changeId, attributes: {}, children: [], text: "" };
    root.children.push(wrapper);
  }
  // Idempotent: if Epoch-N already present with same tag, replace only when re-folding interrupted state
  // where loose files still exist — caller already verified events. Replace matching epoch if present.
  const existingIdx = wrapper.children.findIndex((c) => c.tag === epochNode.tag);
  if (existingIdx >= 0) {
    wrapper.children[existingIdx] = epochNode;
  } else {
    wrapper.children.push(epochNode);
  }
  return root;
}

function writeCursorFile(bundlePath: string, position: CursorPosition): void {
  const node: GraceXmlNode = {
    tag: `${ARTIFACT_TAG_PREFIX}RunCursor`,
    attributes: { graceVersion: NGRACE_ARTIFACT_VERSION },
    children: [
      {
        tag: position.changeId,
        attributes: {},
        children: [
          ...(position.epoch !== undefined
            ? [{ tag: "Epoch", attributes: {}, children: [] as GraceXmlNode[], text: String(position.epoch) }]
            : []),
          ...(position.task
            ? [{ tag: "Task", attributes: {}, children: [] as GraceXmlNode[], text: position.task }]
            : []),
          // Never write a confident State when only stateAbsence is known (A14.1).
          ...(position.state !== undefined
            ? [
                {
                  tag: "State",
                  attributes: {},
                  children: [] as GraceXmlNode[],
                  text: position.state === "absent" ? "idle" : position.state,
                },
              ]
            : []),
        ],
        text: "",
      },
    ],
    text: "",
  };
  const contained = resolveContainedProjectPath(bundlePath, "run.xml", {
    mode: "output",
    allowedRoot: bundlePath,
  });
  writeFileSync(contained.absolutePath, serializeGraceXmlDocument(node));
}

function writeEventFile(
  bundlePath: string,
  event: {
    id: number;
    task: string;
    kind: string;
    allocations?: RangeAllocation[];
    wave?: string;
    /** Registry fields (A18.7) — attribute names come from RUN_EVENT_FIELD_REGISTRY. */
    fields?: Record<string, string>;
  },
): void {
  const runDirRel = "run";
  const filename = `${event.id}-${event.task}-${event.kind}.xml`;
  const relative = `${runDirRel}/${filename}`;
  const children: GraceXmlNode[] = (event.allocations ?? []).map((allocation) => ({
    tag: "Allocation",
    attributes: {
      worker: allocation.worker,
      from: String(allocation.from),
      to: String(allocation.to),
    },
    children: [],
    text: "",
  }));
  if (event.wave) {
    children.push({ tag: "Wave", attributes: {}, children: [], text: event.wave });
  }
  const attributes: Record<string, string> = {
    graceVersion: NGRACE_ARTIFACT_VERSION,
    id: String(event.id),
    task: event.task,
    kind: event.kind,
  };
  // Only emit fields that the registry admits for this kind (A18.7).
  const fields = event.fields ?? {};
  for (const field of runEventFieldsForKind(event.kind)) {
    const value = fields[field.attribute];
    if (value !== undefined && value !== "") attributes[field.attribute] = value;
  }
  const node: GraceXmlNode = {
    tag: `${ARTIFACT_TAG_PREFIX}RunEvent`,
    attributes,
    children,
    text: "",
  };
  const contained = resolveContainedProjectPath(bundlePath, relative, {
    mode: "output",
    allowedRoot: bundlePath,
  });
  mkdirSync(path.dirname(contained.absolutePath), { recursive: true });
  writeFileSync(contained.absolutePath, serializeGraceXmlDocument(node));
}

function nextEventId(bundlePath: string, floor = 1): number {
  const existing = listLooseEvents(bundlePath);
  const ledgerMax = maxLedgerEventId(bundlePath);
  const looseMax = existing.reduce((max, event) => Math.max(max, event.id), 0);
  return Math.max(floor, looseMax + 1, ledgerMax + 1);
}

function maxLedgerEventId(bundlePath: string): number {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return 0;
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return 0;
  let max = 0;
  for (const wrapper of artifact.root.children) {
    for (const epoch of wrapper.children) {
      if (!EPOCH_SECTION_PATTERN.test(epoch.tag)) continue;
      for (const child of epoch.children) {
        if (child.tag !== "Event") continue;
        const id = Number(child.attributes.id);
        if (Number.isInteger(id)) max = Math.max(max, id);
      }
    }
  }
  return max;
}

function readLedgerEpochNumbers(bundlePath: string): number[] {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return [];
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return [];
  const numbers: number[] = [];
  for (const wrapper of artifact.root.children) {
    for (const child of wrapper.children) {
      const match = EPOCH_SECTION_PATTERN.exec(child.tag);
      if (match) numbers.push(Number(match[1]));
    }
  }
  return numbers.sort((a, b) => a - b);
}

function nextEpochNumber(bundlePath: string): number {
  const existing = readLedgerEpochNumbers(bundlePath);
  return (existing[existing.length - 1] ?? 0) + 1;
}

/**
 * Content-sensitive write evidence at attempt-record time (A19.1, A20.1, A21.1).
 * Digest folds:
 *   1. `git rev-parse HEAD` — committed movement between attempts moves the digest (A20.1)
 *   2. sorted (path, content-hash) pairs for ObservedWriteScope ∩ currently-changed files
 * An empty worktree intersection is not "nothing happened"; HEAD distinguishes committed
 * fixes from a true no-movement pair. An unresolvable HEAD is not folded as "" (A21.1) —
 * it is unavailable, same as git status failure or missing active scope.
 * Returns available:false when evidence cannot be recorded (flake → unable-to-determine).
 */
export function computeWriteEvidence(
  projectRoot: string,
  changeId: string,
): { available: boolean; digest?: string; reason?: string } {
  const paths = resolveNgracePaths(path.resolve(projectRoot));
  const scopes = collectActiveChangeScopes(paths);
  const scope = scopes.find((entry) => entry.changeId === changeId);
  if (!scope) {
    return { available: false, reason: "no active approved change scope for write-evidence capture" };
  }
  const { available, changedFiles } = listRepositoryChangedFiles(projectRoot);
  if (!available) {
    return { available: false, reason: "git status unavailable; write-evidence cannot be recorded" };
  }
  const head = resolveGitHead(projectRoot);
  // A21.1: failed measurement must not become a value (unborn HEAD / rev-parse failure).
  if (head === null) {
    return {
      available: false,
      reason: "git HEAD unresolvable (unborn or unreadable); write-evidence cannot be recorded",
    };
  }
  const intersecting = changedFiles
    .filter((file) => observedWriteScopeContains(scope.observedWrites, file))
    .sort((a, b) => a.localeCompare(b));
  const pairs: string[] = [];
  for (const relative of intersecting) {
    const absolute = path.join(projectRoot, relative);
    if (!existsSync(absolute)) continue;
    try {
      const content = readFileSync(absolute);
      const hash = createHash("sha256").update(content).digest("hex");
      pairs.push(`${relative}:${hash}`);
    } catch {
      // Unreadable file — skip; digest still reflects other paths.
    }
  }
  const digest = createHash("sha256")
    .update(`HEAD:${head}\n`)
    .update(pairs.join("\n"))
    .digest("hex");
  return { available: true, digest };
}

/** Current commit id, or null when HEAD is unavailable (no commits / not a git repo). */
function resolveGitHead(projectRoot: string): string | null {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const head = new TextDecoder().decode(result.stdout).trim();
  return head.length > 0 ? head : null;
}

/** Attempt events for a task across ledger + loose, ordered by event id (never clock). */
export function listAttemptEvents(
  bundlePath: string,
  task?: string,
): Array<{ id: number; task: string; fields: Record<string, string> }> {
  const attempts: Array<{ id: number; task: string; fields: Record<string, string> }> = [];
  for (const event of listLooseEvents(bundlePath)) {
    if (event.kind !== "attempt") continue;
    if (task && event.task !== task) continue;
    attempts.push({ id: event.id, task: event.task, fields: { ...event.fields } });
  }
  for (const event of listLedgerEvents(bundlePath)) {
    if (event.kind !== "attempt") continue;
    if (task && event.task !== task) continue;
    attempts.push({ id: event.id, task: event.task, fields: { ...event.fields } });
  }
  return attempts.sort((a, b) => a.id - b.id);
}

function listLedgerEvents(bundlePath: string): Array<{ id: number; task: string; kind: string; fields: Record<string, string> }> {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return [];
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return [];
  const events: Array<{ id: number; task: string; kind: string; fields: Record<string, string> }> = [];
  for (const wrapper of artifact.root.children) {
    for (const epoch of wrapper.children) {
      if (!EPOCH_SECTION_PATTERN.test(epoch.tag)) continue;
      for (const child of epoch.children) {
        if (child.tag !== "Event") continue;
        const id = Number(child.attributes.id);
        const task = (child.attributes.task ?? "").trim();
        const kind = (child.attributes.kind ?? "").trim();
        if (!Number.isInteger(id) || !task || !kind) continue;
        const fields: Record<string, string> = {};
        for (const field of RUN_EVENT_FIELD_REGISTRY) {
          const value = child.attributes[field.attribute];
          if (value !== undefined && value !== "") fields[field.attribute] = value;
        }
        events.push({ id, task, kind, fields });
      }
    }
  }
  return events;
}

function nextAttemptOrdinal(bundlePath: string, task: string): number {
  const existing = listAttemptEvents(bundlePath, task);
  let max = 0;
  for (const attempt of existing) {
    const ordinal = Number(attempt.fields.ordinal);
    if (Number.isInteger(ordinal) && ordinal > max) max = ordinal;
  }
  return max + 1;
}

function countFailedAttempts(bundlePath: string, task: string): number {
  return listAttemptEvents(bundlePath, task).filter((a) => a.fields.outcome === "fail").length;
}

/**
 * Record one verification attempt (A18.11). Reports; never blocks.
 * On the second failed attempt: emit range-terminating exhausted event and pause the cursor (D9).
 */
export function recordAttempt(
  projectRoot: string,
  changeId: string,
  options: {
    task: string;
    outcome: AttemptOutcome;
    signatureKind?: string;
    signatureKey?: string;
  },
): AttemptRecordResult {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const task = options.task;
  if (!ANCHOR_PATTERNS.task.test(task)) {
    throw new GraceCommandError("invalid-arguments", `Task ${JSON.stringify(task)} must be a canonical T-* id.`);
  }
  if (options.outcome !== "pass" && options.outcome !== "fail") {
    throw new GraceCommandError("invalid-arguments", `outcome must be pass|fail, got ${JSON.stringify(options.outcome)}`);
  }
  if (options.outcome === "fail" && (!options.signatureKind || !options.signatureKey)) {
    throw new GraceCommandError(
      "invalid-arguments",
      "outcome=fail requires --signature-kind and --signature-key.",
    );
  }

  const allocations = collectAllocations(listLooseEvents(bundlePath));
  if (allocations.length === 0) {
    throw new GraceCommandError(
      "invalid-arguments",
      `No open epoch allocation for ${changeId}; run ngrace cursor advance --open-epoch first.`,
    );
  }

  const ordinal = nextAttemptOrdinal(bundlePath, task);
  const evidence = computeWriteEvidence(projectRoot, changeId);
  const fields: Record<string, string> = {
    outcome: options.outcome,
    ordinal: String(ordinal),
  };
  if (options.signatureKind) fields["signature-kind"] = options.signatureKind;
  if (options.signatureKey) fields["signature-key"] = options.signatureKey;
  if (evidence.available && evidence.digest) fields["write-evidence"] = evidence.digest;

  const id = nextEventId(bundlePath);
  writeEventFile(bundlePath, { id, task, kind: "attempt", fields });

  const failedAttemptCount =
    countFailedAttempts(bundlePath, task); // includes the attempt just written
  const exhausted = options.outcome === "fail" && failedAttemptCount >= FIX_BUDGET;

  let position: CursorPosition;
  if (exhausted) {
    // Range-terminating exhausted event so the epoch can fold (A18.8); task is paused.
    const exhaustedId = nextEventId(bundlePath);
    writeEventFile(bundlePath, { id: exhaustedId, task, kind: "exhausted" });
    position = {
      changeId,
      bundlePath,
      epoch: currentOpenEpochHint(bundlePath),
      task,
      state: "paused",
      sources: { epoch: "events", task: "events", state: "events" },
      inferred: false,
    };
    writeCursorFile(bundlePath, position);
  } else {
    position = {
      changeId,
      bundlePath,
      epoch: currentOpenEpochHint(bundlePath),
      task,
      state: "in-progress",
      sources: { epoch: "events", task: "events", state: "events" },
      inferred: false,
    };
    writeCursorFile(bundlePath, position);
  }

  const failureSignatures = listAttemptEvents(bundlePath, task)
    .filter((a) => a.fields.outcome === "fail")
    .map((a) => ({
      ordinal: Number(a.fields.ordinal),
      kind: a.fields["signature-kind"],
      key: a.fields["signature-key"],
    }));

  return {
    changeId,
    bundlePath,
    task,
    ordinal,
    outcome: options.outcome,
    signatureKind: options.signatureKind,
    signatureKey: options.signatureKey,
    writeEvidence: fields["write-evidence"],
    failedAttemptCount,
    budget: FIX_BUDGET,
    exhausted,
    failureSignatures,
    position,
  };
}

/**
 * Flake classification as a pure read over recorded attempt digests (A18.10, A19.1, A20.1).
 * Compares consecutive fail→pass write-evidence fields — never re-queries the live worktree
 * for the between-attempts answer. Reports the **most recent** fail→pass pair (A20.3).
 */
export function classifyFlake(bundlePath: string, task: string): FlakeClassification {
  const attempts = listAttemptEvents(bundlePath, task);
  // Walk from the end so the most recent fail→pass pair wins (A20.3).
  for (let i = attempts.length - 2; i >= 0; i -= 1) {
    const current = attempts[i]!;
    const next = attempts[i + 1]!;
    if (current.fields.outcome !== "fail" || next.fields.outcome !== "pass") continue;
    const a = current.fields["write-evidence"];
    const b = next.fields["write-evidence"];
    if (!a || !b) {
      return {
        verdict: "unable-to-determine",
        reason:
          "write-evidence was not recorded on one or both attempts (git unavailable or no active scope at record time)",
      };
    }
    if (a === b) return { verdict: "flaky" };
    return { verdict: "normal-retry" };
  }
  return {
    verdict: "unable-to-determine",
    reason: "no fail→pass attempt pair present for this task",
  };
}

/**
 * Tasks currently paused-pending-approval for the status surface (A18.12 §3, A20.2).
 * Ledger is the truth: exhausted/pause events not later cleared by resume or terminal.
 * Reads loose ∪ ledger so the signal survives fold (D1).
 */
export function listPausedTasks(bundlePath: string): string[] {
  const events = [
    ...listLooseEvents(bundlePath).map((event) => ({ id: event.id, task: event.task, kind: event.kind })),
    ...listLedgerEvents(bundlePath).map((event) => ({ id: event.id, task: event.task, kind: event.kind })),
  ].sort((a, b) => a.id - b.id);

  const paused = new Set<string>();
  for (const event of events) {
    if (event.kind === "exhausted" || event.kind === "pause") {
      paused.add(event.task);
    } else if (event.kind === "resume" || event.kind === "terminal") {
      paused.delete(event.task);
    }
  }
  return [...paused].sort();
}

export function formatAttemptResult(result: AttemptRecordResult): string {
  const lines = [
    `Attempt: task=${result.task} ordinal=${result.ordinal} outcome=${result.outcome}`,
    `Budget: ${result.failedAttemptCount}/${result.budget} failed attempts`,
  ];
  if (result.signatureKind && result.signatureKey) {
    lines.push(`Signature: ${result.signatureKind} / ${result.signatureKey}`);
  }
  if (result.writeEvidence) lines.push(`Write-evidence: ${result.writeEvidence.slice(0, 16)}…`);
  if (result.exhausted) {
    lines.push("Exhausted: yes — task paused-pending-approval (escalation; not a failure)");
    lines.push("Failure signatures:");
    for (const signature of result.failureSignatures) {
      lines.push(
        `  - ordinal=${signature.ordinal} ${signature.kind ?? "?"} / ${signature.key ?? "?"}`,
      );
    }
  } else {
    lines.push("Exhausted: no");
  }
  lines.push(formatCursorPosition(result.position).trimEnd());
  return `${lines.join("\n")}\n`;
}

function currentOpenEpochHint(bundlePath: string): number {
  return nextEpochNumber(bundlePath);
}

function readWaveFromOpened(events: LooseEvent[]): string | undefined {
  for (const event of events) {
    if (event.kind !== "opened") continue;
    const parsed = readGraceXmlArtifact(event.file);
    if (!parsed.root) continue;
    const wave = childText(parsed.root, "Wave");
    if (wave?.trim()) return wave.trim();
  }
  return undefined;
}

function lastTaskFromLedger(bundlePath: string): string | undefined {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return undefined;
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return undefined;
  let last: string | undefined;
  for (const wrapper of artifact.root.children) {
    for (const epoch of wrapper.children) {
      if (!EPOCH_SECTION_PATTERN.test(epoch.tag)) continue;
      for (const child of epoch.children) {
        if (child.tag === "Event" && child.attributes.task) last = child.attributes.task;
      }
    }
  }
  return last;
}

function requireChangeId(args: { change?: unknown }): string {
  const changeId = String(args.change ?? "");
  if (!changeId) throw new GraceCommandError("invalid-arguments", "Pass --change C-*.");
  return changeId;
}

export const cursorCommand = defineCommand({
  meta: {
    name: "cursor",
    description: "Run ledger and cursor: show, regenerate, advance, pause, resume, fold, attempt.",
  },
  subCommands: {
    show: defineCommand({
      meta: { name: "show", description: "Show position (never writes; recovers rather than blocks)." },
      args: {
        path: { type: "string", alias: "p", description: "Project root", default: "." },
        change: { type: "string", description: "C-* change id", required: true },
        format: { type: "string", alias: "f", description: "text or json", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const position = showCursor(String(context.args.path ?? "."), requireChangeId(context.args));
          if (format === "json") process.stdout.write(`${JSON.stringify(position, null, 2)}\n`);
          else process.stdout.write(formatCursorPosition(position));
        }, "Unable to complete ngrace cursor show.");
      },
    }),
    regenerate: defineCommand({
      meta: {
        name: "regenerate",
        description: "Re-derive cursor from ledger, loose events, and codebase evidence. Dry-run by default.",
      },
      args: {
        path: { type: "string", alias: "p", description: "Project root", default: "." },
        change: { type: "string", description: "C-* change id", required: true },
        apply: { type: "boolean", description: "Write run.xml (default is dry-run)", default: false },
        allowDirty: { type: "boolean", description: "Allow writing when git worktree is dirty", default: false },
        format: { type: "string", alias: "f", description: "text or json", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const result = regenerateCursor(String(context.args.path ?? "."), requireChangeId(context.args), {
            apply: Boolean(context.args.apply),
            allowDirty: Boolean(context.args.allowDirty),
          });
          if (format === "json") {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            process.stdout.write(
              `${result.applied ? "Cursor regenerated" : "Cursor regenerate (dry-run; pass --apply to write)"}\n`,
            );
            process.stdout.write(formatCursorPosition(result.position));
          }
        }, "Unable to complete ngrace cursor regenerate.");
      },
    }),
    advance: defineCommand({
      meta: { name: "advance", description: "Append a run event and update the cursor." },
      args: {
        path: { type: "string", alias: "p", description: "Project root", default: "." },
        change: { type: "string", description: "C-* change id", required: true },
        task: { type: "string", description: "T-* task id", required: true },
        kind: { type: "string", description: "Event kind (default progress)", default: "progress" },
        openEpoch: { type: "boolean", description: "Open a new epoch with a range allocation", default: false },
        worker: { type: "string", description: "Worker id for openEpoch allocation" },
        from: { type: "string", description: "Allocation from id" },
        to: { type: "string", description: "Allocation to id" },
        wave: { type: "string", description: "Plan-side wave attribute" },
        format: { type: "string", alias: "f", description: "text or json", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const position = advanceCursor(String(context.args.path ?? "."), requireChangeId(context.args), {
            task: String(context.args.task),
            kind: context.args.kind ? String(context.args.kind) : undefined,
            openEpoch: Boolean(context.args.openEpoch),
            worker: context.args.worker ? String(context.args.worker) : undefined,
            from: context.args.from ? Number(context.args.from) : undefined,
            to: context.args.to ? Number(context.args.to) : undefined,
            wave: context.args.wave ? String(context.args.wave) : undefined,
          });
          if (format === "json") process.stdout.write(`${JSON.stringify(position, null, 2)}\n`);
          else process.stdout.write(formatCursorPosition(position));
        }, "Unable to complete ngrace cursor advance.");
      },
    }),
    pause: defineCommand({
      meta: { name: "pause", description: "Record a pause event and set cursor paused." },
      args: {
        path: { type: "string", alias: "p", default: "." },
        change: { type: "string", required: true },
        task: { type: "string", required: true },
        format: { type: "string", alias: "f", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const position = pauseCursor(
            String(context.args.path ?? "."),
            requireChangeId(context.args),
            String(context.args.task),
          );
          if (format === "json") process.stdout.write(`${JSON.stringify(position, null, 2)}\n`);
          else process.stdout.write(formatCursorPosition(position));
        }, "Unable to complete ngrace cursor pause.");
      },
    }),
    resume: defineCommand({
      meta: { name: "resume", description: "Record a resume event and set cursor in-progress." },
      args: {
        path: { type: "string", alias: "p", default: "." },
        change: { type: "string", required: true },
        task: { type: "string", required: true },
        format: { type: "string", alias: "f", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const position = resumeCursor(
            String(context.args.path ?? "."),
            requireChangeId(context.args),
            String(context.args.task),
          );
          if (format === "json") process.stdout.write(`${JSON.stringify(position, null, 2)}\n`);
          else process.stdout.write(formatCursorPosition(position));
        }, "Unable to complete ngrace cursor resume.");
      },
    }),
    fold: defineCommand({
      meta: { name: "fold", description: "Fold loose run/ events into run-ledger.xml (write, verify, delete)." },
      args: {
        path: { type: "string", alias: "p", default: "." },
        change: { type: "string", required: true },
        wave: { type: "string", description: "Plan-side wave attribute on Epoch-N" },
        allowIncomplete: {
          type: "boolean",
          description: "Fold an incomplete epoch as complete=false (explicit; default refuses holes/unterminated)",
          default: false,
        },
        format: { type: "string", alias: "f", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const result = foldEpoch(String(context.args.path ?? "."), requireChangeId(context.args), {
            wave: context.args.wave ? String(context.args.wave) : undefined,
            allowIncomplete: Boolean(context.args.allowIncomplete),
          });
          if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          else process.stdout.write(formatFoldResult(result));
        }, "Unable to complete ngrace cursor fold.");
      },
    }),
    attempt: defineCommand({
      meta: {
        name: "attempt",
        description:
          "Record a verification attempt (ordinal, outcome, signature, write-evidence). Reports; never blocks.",
      },
      args: {
        path: { type: "string", alias: "p", default: "." },
        change: { type: "string", required: true },
        task: { type: "string", required: true },
        outcome: { type: "string", required: true, description: "pass or fail" },
        signatureKind: { type: "string", description: "Failure signature kind (required when outcome=fail)" },
        signatureKey: { type: "string", description: "Failure signature key (required when outcome=fail)" },
        format: { type: "string", alias: "f", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const outcomeRaw = String(context.args.outcome);
          if (outcomeRaw !== "pass" && outcomeRaw !== "fail") {
            throw new GraceCommandError("invalid-arguments", `outcome must be pass|fail, got ${JSON.stringify(outcomeRaw)}`);
          }
          const result = recordAttempt(String(context.args.path ?? "."), requireChangeId(context.args), {
            task: String(context.args.task),
            outcome: outcomeRaw,
            signatureKind: context.args.signatureKind ? String(context.args.signatureKind) : undefined,
            signatureKey: context.args.signatureKey ? String(context.args.signatureKey) : undefined,
          });
          if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          else process.stdout.write(formatAttemptResult(result));
        }, "Unable to complete ngrace cursor attempt.");
      },
    }),
  },
});

if (import.meta.main) {
  await runMain(cursorCommand as CommandDef);
}
