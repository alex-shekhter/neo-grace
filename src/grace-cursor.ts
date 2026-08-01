#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Cursor and run ledger write surface
//   SCOPE: Show, regenerate, advance, fold, and attempt recording
//   DEPENDS: none
//   LINKS: M-CURSOR
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AbsenceValue
//   AbsenceVerdict
//   CURSOR_STATES
//   CALIBRATION_ADJUDICATED_AT
//   CalibrationAdjudicatedAt
//   CalibrationAdjudicationRecord
//   CalibrationRestatement
//   ChangedFileEvidence
//   CursorPosition
//   CursorState
//   FIX_ATTEMPT_BUDGET
//   FailureSignature
//   FileContentEvidence
//   FlakeVerdict
//   FoldResult
//   KnownEventKind
//   LedgerCalibrationEpoch
//   LooseEvent
//   PositionSource
//   RangeAllocation
//   RecordAttemptResult
//   WriteEvidenceSnapshot
//   advanceCursor
//   classifyFlakeFromEvidence
//   countTaskAttemptEvents
//   cursorCommand
//   cursorStateForEventKind
//   deriveAttemptOrdinal
//   derivePosition
//   deriveStateFromEvents
//   digestProjectFile
//   evaluateTargetComplete
//   expectedLedgerEventAttributes
//   foldEpoch
//   formatCursorPosition
//   formatFoldResult
//   lastResolvingResumeId
//   listAccountingEvents
//   listCalibrationRestatements
//   listLedgerCalibrationEpochs
//   listLedgerEvents
//   listLooseEvents
//   listRepositoryChangedFiles
//   listUnresolvedEscalatedTasks
//   parseCursorState
//   pauseCursor
//   readAttemptPayload
//   recordAttempt
//   recordCalibrationRestatement
//   recordVerificationUnavailable
//   regenerateCursor
//   rejectAuthoredContextAttributes
//   resolveChangeBundle
//   resumeCursor
//   showCursor
//   snapshotWriteEvidence
//   targetAssertionsClean
// END_MODULE_MAP

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
  parseClaimedConfidence,
  type ClaimedConfidence,
  NGRACE_ARTIFACT_VERSION,
} from "./artifact/types";
import {
  cursorNamedTask,
  validateRunCursorArtifact,
  validateRunLedgerArtifact,
} from "./artifact/grammar";
import { collectActiveChangeScopes, observedWriteScopeContains } from "./artifact/scope";
import { childText, readGraceXmlArtifact, type GraceXmlNode } from "./artifact/xml";
import { serializeGraceXmlDocument, serializeGraceXmlNode } from "./artifact/xml-serialize";
import {
  AUTHORED_CONTEXT_ATTRIBUTE_NAMES,
  deriveCalibrationContext,
  parseCalibrationContextAttributes,
  serializeCalibrationContextAttributes,
  type CalibrationContextClass,
} from "./calibration/context";
import { isGitWorktreeDirty } from "./grace-graph";
import { lintGraceProject } from "./lint/core";
import { GraceCommandError, runGraceCommand } from "./query/errors";
import type { FailureSignature } from "./artifact/types";

/** Cursor / position state for one change bundle. */
export type CursorState =
  | "absent"
  | "idle"
  | "in-progress"
  | "paused"
  | "paused-pending-approval"
  | "complete";

/** Closed set for parsing written cursor state (A19.2). */
export const CURSOR_STATES: readonly CursorState[] = [
  "absent",
  "idle",
  "in-progress",
  "paused",
  "paused-pending-approval",
  "complete",
] as const;

/**
 * D9: judgment, not derived. Two fix attempts per task before escalation to replan.
 * The counter counts attempt events and inspects nothing (A19.1).
 */
export const FIX_ATTEMPT_BUDGET = 2;

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

/**
 * Write-scope snapshot recorded on an attempt event (A19.3 / A20.3 / A21.2).
 * Per-file content digests distinguish "same path set, content changed" (retry)
 * from "identical snapshot" (flaky). Undetermined digests are AbsenceValue, never
 * magic strings compared as content (correction 42).
 */
export type FileContentEvidence =
  | { kind: "content"; digest: string }
  /** File did not exist — genuine comparable evidence (both-absent ⇒ no change). */
  | { kind: "absent" }
  /** Digest could not be taken — not evidence; classifier returns unable-to-determine. */
  | { kind: "undetermined"; absence: AbsenceValue };

export type ChangedFileEvidence = {
  path: string;
} & FileContentEvidence;

export type WriteEvidenceSnapshot =
  | { available: true; files: ChangedFileEvidence[] }
  | { available: false; absence: AbsenceValue };

/** Flake classifier verdicts (D8 / A18.6). */
export type FlakeVerdict = "flaky" | "retry" | "unable-to-determine";

export type { FailureSignature };

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
  /**
   * Tasks with an unresolved escalation (A23.1 / correction 45).
   * Empty when none. When non-empty, `task` is drawn from this set so the
   * state/task pair does not attribute the owed decision to an unrelated task.
   * Phase 5 gates need *which* tasks are blocked, not only that some are.
   */
  escalatedTasks: string[];
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
 * Loose run/ event. Payload (attributes beyond id/task/kind, and children) must
 * survive fold (A18.2 / correction 31). listLooseEvents is the A5.4 inventory site.
 */
export type LooseEvent = {
  id: number;
  task: string;
  kind: string;
  file: string;
  allocations?: RangeAllocation[];
  /** Root attributes from the loose file (includes id/task/kind; may include outcome, …). */
  attributes: Record<string, string>;
  /** Root children (Allocation, FailureSignature, WriteEvidence, Wave, …). */
  children: GraceXmlNode[];
};

/** Known event kinds with exhaustive kind→state mapping (A18.5 / A19.2). */
const KNOWN_KIND_STATE = {
  opened: "in-progress",
  progress: "in-progress",
  resume: "in-progress",
  attempt: "in-progress",
  "verification-unavailable": "in-progress",
  pause: "paused",
  terminal: "complete",
  escalation: "paused-pending-approval",
} as const satisfies Record<string, CursorState>;

export type KnownEventKind = keyof typeof KNOWN_KIND_STATE;

/**
 * Deliberate resolvers for paused-pending-approval (A21.1 / correction 41).
 * Execution by-products (attempt, progress, verification-unavailable) do NOT clear escalation.
 * Refusing further work is a Phase 5 gate — this phase only keeps the position honest.
 */
const ESCALATION_RESOLVER_KINDS = new Set<string>(["resume"]);

/**
 * One shared exhaustive kind→state map for write and read paths (correction 34).
 * Unrecognized kinds do not resolve to in-progress.
 */
export function cursorStateForEventKind(
  kind: string,
): { state: CursorState } | { unknown: true; degradation: AbsenceValue } {
  if (Object.prototype.hasOwnProperty.call(KNOWN_KIND_STATE, kind)) {
    return { state: KNOWN_KIND_STATE[kind as KnownEventKind] };
  }
  return {
    unknown: true,
    degradation: {
      verdict: "unable-to-determine",
      reason: `unrecognized event kind ${JSON.stringify(kind)}; not mapped to a cursor state`,
    },
  };
}

/**
 * Tasks with an unresolved escalation (A22.1 / A23.1).
 * Per-task set: escalation adds, resolving resume removes only that task.
 * Sorted for stable CursorPosition / XML output.
 */
export function listUnresolvedEscalatedTasks(
  events: ReadonlyArray<{ id: number; kind: string; task?: string }>,
): string[] {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  const unresolved = new Set<string>();
  for (const event of ordered) {
    const taskKey = (event.task ?? "").trim();
    if (!taskKey) continue;
    if (event.kind === "escalation") {
      unresolved.add(taskKey);
      continue;
    }
    if (ESCALATION_RESOLVER_KINDS.has(event.kind)) {
      unresolved.delete(taskKey);
    }
  }
  return [...unresolved].sort();
}

/**
 * Id of the last `resume` that **removed an unresolved escalation** for `task` (A24).
 * Ordinary resumes (nothing to resolve) do not open a budget window.
 * Returns 0 when the task has never had a resolving resume — counter then counts all attempts.
 */
export function lastResolvingResumeId(
  events: ReadonlyArray<{ id: number; kind: string; task?: string }>,
  task: string,
): number {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  const unresolved = new Set<string>();
  let last = 0;
  for (const event of ordered) {
    const taskKey = (event.task ?? "").trim();
    if (!taskKey) continue;
    if (event.kind === "escalation") {
      unresolved.add(taskKey);
      continue;
    }
    if (ESCALATION_RESOLVER_KINDS.has(event.kind)) {
      if (unresolved.has(taskKey)) {
        unresolved.delete(taskKey);
        if (taskKey === task) last = event.id;
      }
    }
  }
  return last;
}

/**
 * Derive cursor state from the full event stream (A21.1 / A22.1).
 * Escalation is a **per-task** fact: sticky until that task's explicit resolver (`resume`).
 * Bundle-level CursorPosition stays single-valued — paused-pending-approval while any
 * task remains unresolved, otherwise the last non-escalation mapping (correction 43).
 * last-event-wins alone also cleared a still-owed decision (correction 41).
 */
export function deriveStateFromEvents(
  events: ReadonlyArray<{ id: number; kind: string; task?: string }>,
): { state: CursorState } | { unknown: true; degradation: AbsenceValue } {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  if (ordered.length === 0) return { state: "idle" };

  const unresolvedEscalations = new Set<string>();
  let lastNonSticky:
    | { state: CursorState }
    | { unknown: true; degradation: AbsenceValue }
    | undefined;

  for (const event of ordered) {
    const taskKey = (event.task ?? "").trim();
    if (event.kind === "escalation") {
      if (taskKey) unresolvedEscalations.add(taskKey);
      continue;
    }
    if (ESCALATION_RESOLVER_KINDS.has(event.kind)) {
      // resume --task X removes only X; other tasks stay escalated (correction 43).
      if (taskKey) unresolvedEscalations.delete(taskKey);
      lastNonSticky = cursorStateForEventKind(event.kind);
      continue;
    }
    // Non-resolvers never clear escalations. Still update lastNonSticky so another
    // task's progress is not swallowed when the set later becomes empty (A22.1).
    lastNonSticky = cursorStateForEventKind(event.kind);
  }

  if (unresolvedEscalations.size > 0) {
    return { state: "paused-pending-approval" };
  }
  return lastNonSticky ?? { state: "idle" };
}

/**
 * Shared projection for every write/read path (A22.3 / A23.1).
 * When escalatedTasks is non-empty, task is drawn from that set so the pair does not lie.
 */
function positionProjectionFromBundle(
  bundlePath: string,
  options: { preferredTask?: string; lastEventTask?: string } = {},
): {
  state?: CursorState;
  degradation?: AbsenceValue;
  escalatedTasks: string[];
  task?: string;
} {
  const stream = listAccountingEvents(bundlePath);
  const escalatedTasks = listUnresolvedEscalatedTasks(stream);
  const mapped = deriveStateFromEvents(stream);
  const fallback = options.preferredTask ?? options.lastEventTask;
  const task =
    escalatedTasks.length > 0
      ? fallback && escalatedTasks.includes(fallback)
        ? fallback
        : escalatedTasks[0]
      : fallback;
  if ("state" in mapped) {
    return { state: mapped.state, escalatedTasks, task };
  }
  return { state: undefined, degradation: mapped.degradation, escalatedTasks, task };
}

/** Parse a written State element against the widened CursorState union (A19.2). */
export function parseCursorState(
  text: string | undefined,
): { state: CursorState } | { invalid: string } {
  const value = (text ?? "").trim();
  if (!value) return { state: "idle" };
  if ((CURSOR_STATES as readonly string[]).includes(value)) {
    return { state: value as CursorState };
  }
  return { invalid: value };
}

/**
 * Loose event filenames: `{id}-{task}-{kind}.xml`.
 * Task is always T-NNN (no internal hyphens after the T-digits form); kind may contain
 * hyphens (`verification-unavailable`). Do not use a fully free-form middle group — it
 * steals the kind's hyphens (A19.1).
 */
const EVENT_FILENAME = /^(\d+)-(T-[0-9]{3})-(.+)\.xml$/;

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
    const idFromName = Number(match[1]);
    const taskFromName = match[2]!;
    const kindFromName = match[3]!;
    const parsed = readGraceXmlArtifact(file);
    // Prefer XML attributes when present (authoritative payload); filename is discovery.
    const id = parsed.root?.attributes.id ? Number(parsed.root.attributes.id) : idFromName;
    const task = (parsed.root?.attributes.task ?? taskFromName).trim() || taskFromName;
    const kind = (parsed.root?.attributes.kind ?? kindFromName).trim() || kindFromName;
    if (!Number.isInteger(id) || id <= 0) continue;
    const attributes: Record<string, string> = parsed.root
      ? { ...parsed.root.attributes }
      : { id: String(id), task, kind };
    attributes.id = String(id);
    attributes.task = task;
    attributes.kind = kind;
    const children = parsed.root ? parsed.root.children.map(cloneXmlNode) : [];
    const allocations =
      kind === "opened"
        ? children
            .filter((child) => child.tag === "Allocation")
            .map(parseAllocationNode)
            .filter((entry): entry is RangeAllocation => entry !== null)
        : undefined;
    events.push({ id, task, kind, file, allocations, attributes, children });
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
    /**
     * Optional harness-stated executor identity on kind=opened (D6 / P1).
     * Unverifiable by ngrace; may be absent. Never invent a default model name.
     */
    executorIdentity?: { model?: string; harness?: string };
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
    const openChildren: GraceXmlNode[] = [];
    if (options.executorIdentity) {
      const model = options.executorIdentity.model?.trim();
      const harness = options.executorIdentity.harness?.trim();
      if (model || harness) {
        const attrs: Record<string, string> = {};
        if (model) attrs.model = model;
        if (harness) attrs.harness = harness;
        openChildren.push({
          tag: "ExecutorIdentity",
          attributes: attrs,
          children: [],
          text: "",
        });
      }
    }
    writeEventFile(bundlePath, {
      id,
      task,
      kind: "opened",
      allocations: [{ worker, from, to }],
      wave: options.wave,
      children: openChildren.length > 0 ? openChildren : undefined,
    });
    const position: CursorPosition = {
      changeId,
      bundlePath,
      epoch: nextEpochNumber(bundlePath),
      task,
      state: "in-progress",
      escalatedTasks: [],
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
  // Correction 40: attempt / verification-unavailable / escalation are reserved —
  // advance would write a bare kind=attempt that still counts against the budget.
  if (kind === "attempt" || kind === "verification-unavailable" || kind === "escalation") {
    throw new GraceCommandError(
      "invalid-arguments",
      kind === "attempt"
        ? `kind "attempt" is reserved; use ngrace cursor attempt --outcome … (and --signature-kind/--signature-key on fail).`
        : kind === "verification-unavailable"
          ? `kind "verification-unavailable" is reserved; use ngrace cursor verification-unavailable --reason ….`
          : `kind "escalation" is reserved; it is written by the fix budget on the second failed attempt.`,
    );
  }
  const id = nextEventId(bundlePath);
  writeEventFile(bundlePath, { id, task, kind });
  // A21.1 / A23.1: derive state + escalatedTasks; task drawn from set when non-empty.
  const derived = positionProjectionFromBundle(bundlePath, { preferredTask: task });
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task: derived.task,
    state: derived.state,
    escalatedTasks: derived.escalatedTasks,
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
    degradation: derived.degradation,
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
    /** Test-only: throw after ledger write and verify, before delete. */
    injectFailureAfterWrite?: boolean;
    /** Test-only: throw after write, before verify (still leaves both forms). */
    injectFailureBeforeVerify?: boolean;
    /**
     * Test-only: serialize Event nodes as id/task/kind only (correction 31 shape).
     * Verify must fail and leave every loose file on disk (AC-FOLD-PRESERVES-PAYLOAD).
     */
    injectDropPayload?: boolean;
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
  const membershipIssues = validateEventsAgainstAllocations(events, allocations);
  if (membershipIssues.length > 0) {
    throw new GraceCommandError("invalid-project", membershipIssues.join(" "));
  }

  const epochNumber = nextEpochNumber(bundlePath);
  const wave = options.wave ?? readWaveFromOpened(events);
  // A59 corr 155–156: adjudicate once at fold when claims exist; store durable label.
  // Unit of adjudication is the change/epoch, not each attempt.
  // A63 corr 165: also store derived context class at fold (not recomputed later).
  const calibrationAdjudication =
    options.injectDropPayload === true
      ? undefined
      : buildCalibrationAdjudicationAtFold(projectRoot, changeId, events, allocations);
  const epochNode = buildEpochNode(epochNumber, wave, allocations, events, {
    dropPayload: options.injectDropPayload === true,
    calibrationAdjudication,
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

  // --- verify (payload compare, not count — A18.2) ---
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
  if (writtenEvents.length !== events.length) {
    throw new GraceCommandError(
      "invalid-project",
      `Fold verify failed: expected ${events.length} events, ledger has ${writtenEvents.length}.`,
    );
  }
  for (const event of events) {
    const writtenEvent = writtenEvents.find((node) => Number(node.attributes.id) === event.id);
    if (!writtenEvent) {
      throw new GraceCommandError(
        "invalid-project",
        `Fold verify failed: event id ${event.id} missing from written ledger.`,
      );
    }
    // Correction 38 (A20.2): expected is derived from the loose event as parsed from disk,
    // via expectedLedgerEventAttributes — NOT through eventAttributesForLedger (the writer).
    // A drop inside the writer transform must not redefine the expectation.
    const expected = payloadFingerprint(expectedLedgerEventAttributes(event), event.children);
    const actual = payloadFingerprint(writtenEvent.attributes, writtenEvent.children);
    if (expected !== actual) {
      throw new GraceCommandError(
        "invalid-project",
        `Fold verify failed: event ${event.id} payload mismatch (attributes or children dropped or altered).`,
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

  // A22.2 / A23.1: derive like every other write path (no literal idle; task from escalated set).
  const derived = positionProjectionFromBundle(bundlePath, {
    lastEventTask: events[events.length - 1]?.task,
  });
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: epochNumber,
    task: derived.task,
    state: derived.state,
    escalatedTasks: derived.escalatedTasks,
    sources: { epoch: "ledger", task: "ledger", state: "ledger" },
    inferred: false,
    degradation: derived.degradation,
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
      const parsedState = parseCursorState(stateText);
      if ("invalid" in parsedState) {
        // Unchecked cast hole (A19.2): unrecognized value takes degradation, then re-derive.
        degradation = {
          verdict: "unable-to-determine",
          reason: `cursor state ${JSON.stringify(parsedState.invalid)} is not a known CursorState; re-derived`,
        };
      } else {
        // A25.1 / correction 47: escalation is durable — always from ledger∪loose, never from
        // the written cursor. epoch/task stay cached; "is a decision owed" does not.
        // File EscalatedTask / file ppa are compared only to announce disagreement (D1).
        const stream = listAccountingEvents(bundlePath);
        const escalatedTasks = listUnresolvedEscalatedTasks(stream);
        const mapped = deriveStateFromEvents(stream);
        const streamState = "state" in mapped ? mapped.state : undefined;
        const streamStateSource: PositionSource =
          stream.length > 0 ? (events.length > 0 ? "events" : "ledger") : "ledger";
        const fromFile = wrapper
          ? wrapper.children
              .filter((c) => c.tag === "EscalatedTask")
              .map((c) => c.text.trim())
              .filter((t) => ANCHOR_PATTERNS.task.test(t))
              .sort()
          : [];
        const fileState = parsedState.state;
        const setsEqual =
          fromFile.length === escalatedTasks.length &&
          fromFile.every((t, i) => t === escalatedTasks[i]);
        const fileClaimsPpa = fileState === "paused-pending-approval";
        const streamClaimsPpa = escalatedTasks.length > 0;
        const escalationDisagrees = !setsEqual || fileClaimsPpa !== streamClaimsPpa;

        let escalationDegradation: AbsenceValue | undefined;
        if (escalationDisagrees) {
          escalationDegradation = {
            verdict: "unable-to-determine",
            reason:
              "written cursor escalation disagrees with durable event stream; escalation derived from ledger and events",
          };
        }

        // State: ppa (and its clearance) always from the stream; other states may lag on the cache.
        let state: CursorState | undefined;
        let stateSource: PositionSource;
        if (streamClaimsPpa) {
          state = "paused-pending-approval";
          stateSource = streamStateSource;
        } else if (fileClaimsPpa || fromFile.length > 0) {
          // Stale cursor claimed escalation the stream has resolved.
          state = streamState ?? "in-progress";
          stateSource = streamStateSource;
        } else if (streamState === undefined && "degradation" in mapped) {
          state = undefined;
          stateSource = streamStateSource;
        } else {
          state = fileState;
          stateSource = "cursor";
        }

        // When set non-empty, task from set (correction 45); otherwise cached Task.
        const pairedTask =
          escalatedTasks.length > 0
            ? task && escalatedTasks.includes(task)
              ? task
              : escalatedTasks[0]
            : task;

        written = {
          changeId,
          bundlePath,
          epoch: epochText ? Number(epochText) : undefined,
          task: pairedTask,
          state,
          escalatedTasks,
          sources: { epoch: "cursor", task: "cursor", state: stateSource },
          inferred: false,
          degradation:
            escalationDegradation ??
            ("degradation" in mapped ? mapped.degradation : undefined),
        };
      }
    }
  } else if (options.preferWrittenCursor && !existsSync(cursorPath)) {
    // Missing cursor: silent for lint; show still re-derives (A11.5).
    degradation = {
      verdict: "not-run",
      reason: "cursor absent; position re-derived from ledger and events",
    };
  }

  // Prefer-written hybrid may carry escalation degradation and still answer (correction 47).
  // Identity / invalid-state degradations leave `written` unset and fall through to re-derive.
  if (written) {
    return written;
  }

  // Row 1–2: ledger + loose events
  if (events.length > 0 || ledgerEpochs.length > 0) {
    const lastEvent = events[events.length - 1];
    const epoch =
      events.length > 0
        ? nextEpochNumber(bundlePath)
        : ledgerEpochs[ledgerEpochs.length - 1];
    // A21.1 / A23.1: full stream; task from escalated set when non-empty (not last-event-wins alone).
    const stream = listAccountingEvents(bundlePath);
    const escalatedTasks = listUnresolvedEscalatedTasks(stream);
    const lastTask = lastEvent?.task ?? lastTaskFromLedger(bundlePath);
    const task =
      escalatedTasks.length > 0
        ? lastTask && escalatedTasks.includes(lastTask)
          ? lastTask
          : escalatedTasks[0]
        : lastTask;
    let state: CursorState | undefined = "idle";
    let kindDegradation: AbsenceValue | undefined;
    if (stream.length > 0) {
      const mapped = deriveStateFromEvents(stream);
      if ("state" in mapped) {
        state = mapped.state;
      } else {
        state = undefined;
        kindDegradation = mapped.degradation;
      }
    }
    return {
      changeId,
      bundlePath,
      epoch,
      task,
      state,
      escalatedTasks,
      sources: {
        epoch: events.length > 0 ? "events" : "ledger",
        task:
          escalatedTasks.length > 0
            ? stream.length > 0
              ? events.length > 0
                ? "events"
                : "ledger"
              : "none"
            : lastEvent
              ? "events"
              : task
                ? "ledger"
                : "none",
        state: stream.length > 0 ? (events.length > 0 ? "events" : "ledger") : "ledger",
      },
      inferred: false,
      degradation: degradation ?? kindDegradation,
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
    escalatedTasks: [],
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

/**
 * Dumb counter (D9 / A19.1 / A24): counts attempt events for a task **inside the
 * current budget window**. Window start is the last resume that resolved an
 * escalation for that task (not every resume). Inspects nothing on each attempt —
 * no signature, no outcome, no content condition. The ledger keeps full history;
 * windowing is a read, never a rewrite (D1).
 */
export function countTaskAttemptEvents(
  events: ReadonlyArray<{ id: number; task: string; kind: string }>,
  task: string,
): number {
  const windowStart = lastResolvingResumeId(events, task);
  return events.filter(
    (event) => event.task === task && event.kind === "attempt" && event.id > windowStart,
  ).length;
}

/** Derived ordinal: 1-based count of this task's attempts with id <= eventId (A18.3). */
export function deriveAttemptOrdinal(
  events: ReadonlyArray<{ id: number; task: string; kind: string }>,
  task: string,
  eventId: number,
): number {
  return events.filter(
    (event) => event.task === task && event.kind === "attempt" && event.id <= eventId,
  ).length;
}

/** Snapshot repository write evidence for recording onto an attempt (A19.3 / A20.3). */
export function snapshotWriteEvidence(projectRoot: string): WriteEvidenceSnapshot {
  const { available, changedFiles } = listRepositoryChangedFiles(projectRoot);
  if (!available) {
    return {
      available: false,
      absence: {
        verdict: "unable-to-determine",
        reason:
          "repository changed-file set unavailable (git status exited non-zero); write evidence was not recorded",
      },
    };
  }
  const root = path.resolve(projectRoot);
  const files: ChangedFileEvidence[] = changedFiles.map((relative) => ({
    path: relative,
    ...digestProjectFile(root, relative),
  }));
  return { available: true, files };
}

/**
 * Content evidence for one project-relative path (A21.2).
 * Returns structured evidence — never magic strings in a digest field.
 * Values: content (sha256), absent (comparable), undetermined (not comparable).
 */
export function digestProjectFile(projectRoot: string, relativePath: string): FileContentEvidence {
  const absolute = path.join(projectRoot, relativePath);
  if (!existsSync(absolute)) {
    return { kind: "absent" };
  }
  try {
    return {
      kind: "content",
      digest: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
    };
  } catch {
    return {
      kind: "undetermined",
      absence: {
        verdict: "unable-to-determine",
        reason: `file content unreadable at ${relativePath}; digest was not taken`,
      },
    };
  }
}

/**
 * Durable+ephemeral event set for policy accounting (A20.1 / standing rule 9).
 * Merges ledger and loose by id (loose wins on collision during interrupted fold).
 */
export function listAccountingEvents(bundlePath: string): LooseEvent[] {
  const byId = new Map<number, LooseEvent>();
  for (const event of listLedgerEvents(bundlePath)) {
    byId.set(event.id, event);
  }
  for (const event of listLooseEvents(bundlePath)) {
    byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export type RecordAttemptResult = {
  position: CursorPosition;
  eventId: number;
  attemptCount: number;
  escalated: boolean;
  signatures: FailureSignature[];
  /** Human-readable escalation or progress message (shown verbatim on exhaustion). */
  message: string;
};

/**
 * Record one verification-cycle attempt (D6). Immediate write — advance precedent (A18.7).
 * On the second failed attempt (attempt count >= FIX_ATTEMPT_BUDGET after a fail),
 * writes an escalation event and transitions to paused-pending-approval (A19.2).
 */
export function recordAttempt(
  projectRoot: string,
  changeId: string,
  options: {
    task: string;
    outcome: "pass" | "fail";
    signature?: FailureSignature;
    /**
     * Optional agent-authored claimed confidence (D6). Write-only; no gate may read it.
     * Join score comes from independent adjudicators (target-assertions), never from
     * this attempt's outcome attribute (corr 149).
     */
    claimedConfidence?: ClaimedConfidence | string;
    /** Override snapshotted write evidence (tests). Default: snapshotWriteEvidence. */
    writeEvidence?: WriteEvidenceSnapshot;
  },
): RecordAttemptResult {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const task = options.task;
  if (!ANCHOR_PATTERNS.task.test(task)) {
    throw new GraceCommandError("invalid-arguments", `Task ${JSON.stringify(task)} must be a canonical T-* id.`);
  }
  if (options.outcome === "fail" && !options.signature) {
    throw new GraceCommandError(
      "invalid-arguments",
      "Failed attempts require a FailureSignature (kind + key).",
    );
  }

  let claimedConfidenceAttr: string | undefined;
  if (options.claimedConfidence !== undefined && options.claimedConfidence !== "") {
    const parsed = parseClaimedConfidence(String(options.claimedConfidence));
    if (!parsed.ok) {
      throw new GraceCommandError("invalid-arguments", parsed.reason);
    }
    claimedConfidenceAttr = parsed.value;
  }

  // A21.1 / A22.3 / A29.10: refuse further attempts on escalated tasks via gate evaluation
  // (anti-pattern 9 — policy lives in src/gates/, mechanism only calls it).
  const escalated = listUnresolvedEscalatedTasks(listAccountingEvents(bundlePath));
  if (escalated.includes(task)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `gate.attempt.escalated: task ${task} is paused-pending-approval; resolve with ngrace cursor resume before further attempts.`,
      { issues: ["gate.attempt.escalated"] },
    );
  }

  const writeEvidence = options.writeEvidence ?? snapshotWriteEvidence(projectRoot);
  const children: GraceXmlNode[] = [];
  if (options.outcome === "fail" && options.signature) {
    children.push(failureSignatureNode(options.signature));
  }
  children.push(writeEvidenceNode(writeEvidence));

  const id = nextEventId(bundlePath);
  const attributes: Record<string, string> = { outcome: options.outcome };
  if (claimedConfidenceAttr) {
    attributes.claimedConfidence = claimedConfidenceAttr;
  }
  writeEventFile(bundlePath, {
    id,
    task,
    kind: "attempt",
    attributes,
    children,
  });

  // Standing rule 9 / A20.1 / A24: count from durable+loose inside the resolution window.
  const accounting = listAccountingEvents(bundlePath);
  const attemptCount = countTaskAttemptEvents(accounting, task);
  const signatures = collectFailureSignatures(accounting, task);

  // Escalation only on the fail path when the dumb attempt count hits the budget.
  // Counter itself has no outcome/signature condition (A19.1); window is recording-side (A24).
  if (options.outcome === "fail" && attemptCount >= FIX_ATTEMPT_BUDGET) {
    const escalationId = nextEventId(bundlePath);
    writeEventFile(bundlePath, {
      id: escalationId,
      task,
      kind: "escalation",
      children: signatures.map(failureSignatureNode),
    });
    // A22.3 / A23.1: every write path derives — escalatedTasks + task from set.
    const derived = positionProjectionFromBundle(bundlePath, { preferredTask: task });
    const position: CursorPosition = {
      changeId,
      bundlePath,
      epoch: currentOpenEpochHint(bundlePath),
      task: derived.task ?? task,
      state: derived.state ?? "paused-pending-approval",
      escalatedTasks: derived.escalatedTasks,
      sources: { epoch: "events", task: "events", state: "events" },
      inferred: false,
      degradation: derived.degradation,
    };
    writeCursorFile(bundlePath, position);
    const message = formatEscalationMessage(task, attemptCount, signatures);
    return {
      position,
      eventId: id,
      attemptCount,
      escalated: true,
      signatures,
      message,
    };
  }

  const derived = positionProjectionFromBundle(bundlePath, { preferredTask: task });
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task: derived.task ?? task,
    state: derived.state ?? "in-progress",
    escalatedTasks: derived.escalatedTasks,
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
    degradation: derived.degradation,
  };
  writeCursorFile(bundlePath, position);
  return {
    position,
    eventId: id,
    attemptCount,
    escalated: false,
    signatures,
    message:
      options.outcome === "pass"
        ? `Attempt ${attemptCount} for ${task}: pass`
        : `Attempt ${attemptCount} for ${task}: fail (${options.signature?.kind}:${options.signature?.key})`,
  };
}

/**
 * Verification could not run — record verification-unavailable, never an attempt (A19.1).
 * Does not count against FIX_ATTEMPT_BUDGET.
 */
export function recordVerificationUnavailable(
  projectRoot: string,
  changeId: string,
  options: { task: string; absence: AbsenceValue },
): CursorPosition {
  const bundlePath = resolveChangeBundle(projectRoot, changeId);
  const task = options.task;
  if (!ANCHOR_PATTERNS.task.test(task)) {
    throw new GraceCommandError("invalid-arguments", `Task ${JSON.stringify(task)} must be a canonical T-* id.`);
  }
  const id = nextEventId(bundlePath);
  writeEventFile(bundlePath, {
    id,
    task,
    kind: "verification-unavailable",
    attributes: {
      verdict: options.absence.verdict,
      reason: options.absence.reason,
    },
  });
  // A21.1 / A23.1: VU must not clear an unresolved escalation; task from escalated set.
  const derived = positionProjectionFromBundle(bundlePath, { preferredTask: task });
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task: derived.task ?? task,
    state: derived.state ?? "in-progress",
    escalatedTasks: derived.escalatedTasks,
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
    degradation: derived.degradation,
  };
  writeCursorFile(bundlePath, position);
  return position;
}

/**
 * Classify fail→pass pair from recorded write evidence (A19.3). Issues no git call.
 */
export function classifyFlakeFromEvidence(
  earlier: { outcome: string; writeEvidence: WriteEvidenceSnapshot },
  later: { outcome: string; writeEvidence: WriteEvidenceSnapshot },
): { verdict: FlakeVerdict; reason: string } {
  if (earlier.outcome !== "fail" || later.outcome !== "pass") {
    return {
      verdict: "unable-to-determine",
      reason: "flake classification requires a fail then pass attempt pair",
    };
  }
  if (!earlier.writeEvidence.available || !later.writeEvidence.available) {
    return {
      verdict: "unable-to-determine",
      reason:
        "write evidence unavailable on one or both attempts; cannot distinguish flaky from retry",
    };
  }
  // A21.2: undetermined digests are absence, not comparable content.
  const undetermined = [...earlier.writeEvidence.files, ...later.writeEvidence.files].find(
    (file) => file.kind === "undetermined",
  );
  if (undetermined && undetermined.kind === "undetermined") {
    return {
      verdict: "unable-to-determine",
      reason: `write evidence digest undetermined (${undetermined.absence.reason}); cannot distinguish flaky from retry`,
    };
  }
  // A20.3: compare path + content/absent pairs (not path sets alone).
  const earlierKey = writeEvidenceFingerprint(earlier.writeEvidence.files);
  const laterKey = writeEvidenceFingerprint(later.writeEvidence.files);
  if (earlierKey === laterKey) {
    return {
      verdict: "flaky",
      reason: "fail then pass with identical write evidence (paths and content digests match)",
    };
  }
  return {
    verdict: "retry",
    reason: "fail then pass with changed write evidence (path set or content digest differs)",
  };
}

/**
 * Stable fingerprint of path + determined evidence only.
 * Caller must reject undetermined files first (A21.2).
 */
function writeEvidenceFingerprint(files: ChangedFileEvidence[]): string {
  return files
    .map((file) => {
      if (file.kind === "content") return `${file.path}\0content\0${file.digest}`;
      if (file.kind === "absent") return `${file.path}\0absent`;
      // undetermined should not reach here
      return `${file.path}\0undetermined`;
    })
    .sort()
    .join("\n");
}

/** Read write evidence and outcome from a loose (or folded-equivalent) event. */
export function readAttemptPayload(event: LooseEvent): {
  outcome?: string;
  signature?: FailureSignature;
  writeEvidence?: WriteEvidenceSnapshot;
} {
  const outcome = event.attributes.outcome;
  let signature: FailureSignature | undefined;
  let writeEvidence: WriteEvidenceSnapshot | undefined;
  for (const child of event.children) {
    if (child.tag === "FailureSignature") {
      const kind = child.attributes.kind?.trim();
      const key = child.attributes.key?.trim();
      if (kind && key) signature = { kind, key };
    }
    if (child.tag === "WriteEvidence") {
      writeEvidence = parseWriteEvidenceNode(child);
    }
  }
  return { outcome, signature, writeEvidence };
}

/** Events from the folded ledger (Event children), ordered by id. Payload preserved (A18.2). */
export function listLedgerEvents(bundlePath: string): LooseEvent[] {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return [];
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return [];
  const events: LooseEvent[] = [];
  for (const wrapper of artifact.root.children) {
    for (const epoch of wrapper.children) {
      if (!EPOCH_SECTION_PATTERN.test(epoch.tag)) continue;
      for (const child of epoch.children) {
        if (child.tag !== "Event") continue;
        const id = Number(child.attributes.id);
        const task = (child.attributes.task ?? "").trim();
        const kind = (child.attributes.kind ?? "").trim();
        if (!Number.isInteger(id) || !task || !kind) continue;
        events.push({
          id,
          task,
          kind,
          file: ledgerPath,
          attributes: { ...child.attributes },
          children: child.children.map(cloneXmlNode),
        });
      }
    }
  }
  return events.sort((a, b) => a.id - b.id);
}

/** One folded epoch's claims + stored CalibrationAdjudication (A59 corr 155–156). */
export type LedgerCalibrationEpoch = {
  changeId: string;
  epoch: number;
  claims: LooseEvent[];
  adjudication: CalibrationAdjudicationRecord | undefined;
};

/**
 * Read folded epochs that carry claimedConfidence claims and any stored adjudication.
 * Report never recomputes labels — only stored CalibrationAdjudication counts as adjudicated.
 */
export function listLedgerCalibrationEpochs(bundlePath: string, changeId: string): LedgerCalibrationEpoch[] {
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) return [];
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) return [];
  const rows: LedgerCalibrationEpoch[] = [];
  for (const wrapper of artifact.root.children) {
    if (wrapper.tag !== changeId) continue;
    for (const epoch of wrapper.children) {
      const match = EPOCH_SECTION_PATTERN.exec(epoch.tag);
      if (!match) continue;
      const epochNumber = Number(match[1]);
      const claims: LooseEvent[] = [];
      let adjudication: CalibrationAdjudicationRecord | undefined;
      for (const child of epoch.children) {
        if (child.tag === "Event") {
          const id = Number(child.attributes.id);
          const task = (child.attributes.task ?? "").trim();
          const kind = (child.attributes.kind ?? "").trim();
          if (!Number.isInteger(id) || !task || !kind) continue;
          const event: LooseEvent = {
            id,
            task,
            kind,
            file: ledgerPath,
            attributes: { ...child.attributes },
            children: child.children.map(cloneXmlNode),
          };
          if (attemptHasClaimedConfidence(event)) claims.push(event);
        }
        if (child.tag === "CalibrationAdjudication") {
          adjudication = parseCalibrationAdjudicationNode(child);
        }
      }
      if (claims.length === 0 && !adjudication) continue;
      rows.push({ changeId, epoch: epochNumber, claims, adjudication });
    }
  }
  return rows.sort((a, b) => a.epoch - b.epoch);
}

/** Moments at which a CalibrationAdjudication may have been written (A61 corr 161). */
export const CALIBRATION_ADJUDICATED_AT = ["fold", "backfill"] as const;
export type CalibrationAdjudicatedAt = (typeof CALIBRATION_ADJUDICATED_AT)[number];

function parseAdjudicatedAt(raw: string | undefined): CalibrationAdjudicatedAt | undefined {
  const value = (raw ?? "").trim();
  if (value === "fold" || value === "backfill") return value;
  return undefined;
}

function parseCalibrationAdjudicationNode(node: GraceXmlNode): CalibrationAdjudicationRecord | undefined {
  const outcome = (node.attributes.outcome ?? "").trim();
  if (outcome !== "pass" && outcome !== "fail" && outcome !== "pending") return undefined;
  const claimCount = Number(node.attributes.claimCount ?? "0");
  // Read from the record (A61 corr 161). Missing attribute is not silently "fold" —
  // only an explicit value is evidence of a moment. Legacy records without the attribute
  // surface as undefined and the report treats them as pending provenance.
  const adjudicatedAt = parseAdjudicatedAt(node.attributes.adjudicatedAt);
  if (adjudicatedAt === undefined) return undefined;
  // Context class (A63 corr 165): present on fold-time records from round 4+; optional.
  const context = parseCalibrationContextAttributes(node.attributes);
  return {
    adjudicator: "target-assertions",
    outcome,
    reason: node.attributes.reason?.trim() || undefined,
    claimCount: Number.isInteger(claimCount) ? claimCount : 0,
    claims: (node.attributes.claims ?? "").trim(),
    adjudicatedAt,
    context,
  };
}

/**
 * One restatement of a stored CalibrationAdjudication's provenance (A61).
 * Lives under the *authoring* change's ledger as a sibling of Epoch-N; never
 * mutates the restated archive. Report applies these as overrides.
 */
export type CalibrationRestatement = {
  /** Change whose stored adjudication is being restated. */
  changeId: string;
  epoch: number;
  adjudicatedAt: "backfill";
  reason?: string;
  /** Bundle that authored this restatement (where the ledger section lives). */
  authoringChangeId: string;
};

/**
 * Scan all change ledgers for CalibrationRestatements sections.
 * Restatements supersede stored adjudicatedAt without editing archives.
 */
export function listCalibrationRestatements(projectRoot: string): CalibrationRestatement[] {
  const root = path.resolve(projectRoot);
  const paths = resolveNgracePaths(root);
  const out: CalibrationRestatement[] = [];
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ANCHOR_PATTERNS.change.test(entry.name)) continue;
      const authoringChangeId = entry.name;
      const ledgerPath = path.join(directory, authoringChangeId, "run-ledger.xml");
      if (!existsSync(ledgerPath)) continue;
      const artifact = readGraceXmlArtifact(ledgerPath);
      if (!artifact.root) continue;
      const wrapper = artifact.root.children.find((c) => c.tag === authoringChangeId);
      if (!wrapper) continue;
      for (const section of wrapper.children) {
        if (section.tag !== "CalibrationRestatements") continue;
        for (const child of section.children) {
          if (child.tag !== "Restatement") continue;
          const changeId = (child.attributes.changeId ?? "").trim();
          const epoch = Number(child.attributes.epoch ?? "");
          const adjudicatedAt = parseAdjudicatedAt(child.attributes.adjudicatedAt);
          if (!ANCHOR_PATTERNS.change.test(changeId)) continue;
          if (!Number.isInteger(epoch) || epoch < 1) continue;
          // Only backfill restatements are defined (restate contaminated fold claims).
          if (adjudicatedAt !== "backfill") continue;
          out.push({
            changeId,
            epoch,
            adjudicatedAt: "backfill",
            reason: child.attributes.reason?.trim() || child.text.trim() || undefined,
            authoringChangeId,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Append or replace a CalibrationRestatements section on the authoring change's ledger.
 * Does not edit the restated change's archive. Requires an existing run-ledger.xml
 * (fold first, then restate).
 */
export function recordCalibrationRestatement(
  projectRoot: string,
  authoringChangeId: string,
  restatement: {
    changeId: string;
    epoch: number;
    adjudicatedAt: "backfill";
    reason?: string;
  },
): void {
  if (!ANCHOR_PATTERNS.change.test(authoringChangeId)) {
    throw new GraceCommandError("invalid-arguments", `Invalid authoring change id: ${authoringChangeId}`);
  }
  if (!ANCHOR_PATTERNS.change.test(restatement.changeId)) {
    throw new GraceCommandError("invalid-arguments", `Invalid restated change id: ${restatement.changeId}`);
  }
  if (!Number.isInteger(restatement.epoch) || restatement.epoch < 1) {
    throw new GraceCommandError("invalid-arguments", `Restatement epoch must be a positive integer.`);
  }
  if (restatement.adjudicatedAt !== "backfill") {
    throw new GraceCommandError("invalid-arguments", `Only adjudicatedAt=backfill restatements are supported.`);
  }

  const bundlePath = resolveChangeBundle(projectRoot, authoringChangeId);
  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) {
    throw new GraceCommandError(
      "invalid-project",
      `Cannot record restatement: ${authoringChangeId} has no run-ledger.xml (fold first).`,
    );
  }
  const artifact = readGraceXmlArtifact(ledgerPath);
  if (!artifact.root) {
    throw new GraceCommandError("invalid-project", `run-ledger.xml at ${ledgerPath} is unreadable.`);
  }
  const root: GraceXmlNode = {
    tag: artifact.root.tag,
    attributes: { ...artifact.root.attributes },
    children: artifact.root.children.map(cloneXmlNode),
    text: artifact.root.text,
  };
  let wrapper = root.children.find((c) => c.tag === authoringChangeId);
  if (!wrapper) {
    throw new GraceCommandError(
      "invalid-project",
      `run-ledger.xml does not contain wrapper ${authoringChangeId}.`,
    );
  }

  const restatementNode: GraceXmlNode = {
    tag: "Restatement",
    attributes: {
      changeId: restatement.changeId,
      epoch: String(restatement.epoch),
      adjudicatedAt: "backfill",
      ...(restatement.reason ? { reason: restatement.reason } : {}),
    },
    children: [],
    text: "",
  };

  let section = wrapper.children.find((c) => c.tag === "CalibrationRestatements");
  if (!section) {
    section = { tag: "CalibrationRestatements", attributes: {}, children: [], text: "" };
    wrapper.children.push(section);
  }
  // Replace matching (changeId, epoch) or append.
  const idx = section.children.findIndex(
    (c) =>
      c.tag === "Restatement" &&
      (c.attributes.changeId ?? "").trim() === restatement.changeId &&
      Number(c.attributes.epoch ?? "") === restatement.epoch,
  );
  if (idx >= 0) {
    section.children[idx] = restatementNode;
  } else {
    section.children.push(restatementNode);
  }

  const contained = resolveContainedProjectPath(bundlePath, "run-ledger.xml", {
    mode: "output",
    allowedRoot: bundlePath,
  });
  writeFileSync(contained.absolutePath, serializeGraceXmlDocument(root));
}

function failureSignatureNode(signature: FailureSignature): GraceXmlNode {
  return {
    tag: "FailureSignature",
    attributes: { kind: signature.kind, key: signature.key },
    children: [],
    text: "",
  };
}

function writeEvidenceNode(evidence: WriteEvidenceSnapshot): GraceXmlNode {
  if (evidence.available) {
    return {
      tag: "WriteEvidence",
      attributes: { available: "true" },
      children: evidence.files.map((file): GraceXmlNode => {
        if (file.kind === "content") {
          return {
            tag: "File",
            attributes: { digest: file.digest },
            children: [],
            text: file.path,
          };
        }
        if (file.kind === "absent") {
          return {
            tag: "File",
            attributes: { status: "absent" },
            children: [],
            text: file.path,
          };
        }
        return {
          tag: "File",
          attributes: {
            status: "undetermined",
            verdict: file.absence.verdict,
            reason: file.absence.reason,
          },
          children: [],
          text: file.path,
        };
      }),
      text: "",
    };
  }
  return {
    tag: "WriteEvidence",
    attributes: {
      available: "false",
      verdict: evidence.absence.verdict,
      reason: evidence.absence.reason,
    },
    children: [],
    text: "",
  };
}

function parseWriteEvidenceNode(node: GraceXmlNode): WriteEvidenceSnapshot {
  if (node.attributes.available === "false") {
    return {
      available: false,
      absence: {
        verdict: (node.attributes.verdict === "not-run" ? "not-run" : "unable-to-determine") as AbsenceVerdict,
        reason: node.attributes.reason ?? "write evidence unavailable",
      },
    };
  }
  const files: ChangedFileEvidence[] = node.children
    .filter((child) => child.tag === "File")
    .map((child): ChangedFileEvidence | null => {
      const filePath = child.text.trim();
      if (!filePath) return null;
      const status = (child.attributes.status ?? "").trim();
      const digestAttr = (child.attributes.digest ?? "").trim();
      if (status === "absent") {
        return { path: filePath, kind: "absent" };
      }
      if (status === "undetermined") {
        return {
          path: filePath,
          kind: "undetermined",
          absence: {
            verdict: child.attributes.verdict === "not-run" ? "not-run" : "unable-to-determine",
            reason: child.attributes.reason ?? "digest undetermined",
          },
        };
      }
      if (digestAttr && digestAttr !== "unknown" && digestAttr !== "unreadable" && digestAttr !== "absent") {
        return { path: filePath, kind: "content", digest: digestAttr };
      }
      // Legacy sentinel strings or missing digest → undetermined (A21.2), never comparable content.
      if (digestAttr === "absent") {
        return { path: filePath, kind: "absent" };
      }
      return {
        path: filePath,
        kind: "undetermined",
        absence: {
          verdict: "unable-to-determine",
          reason:
            digestAttr === "unreadable" || digestAttr === "unknown" || digestAttr === ""
              ? `legacy or missing digest attribute (${digestAttr || "empty"}); not treated as content`
              : `unrecognized digest sentinel ${JSON.stringify(digestAttr)}`,
        },
      };
    })
    .filter((file): file is ChangedFileEvidence => file !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
  return { available: true, files };
}

/**
 * Failure signatures on fail-attempts in the current budget window (A24).
 * Same window as countTaskAttemptEvents — current round only, full history stays in the ledger.
 */
function collectFailureSignatures(events: LooseEvent[], task: string): FailureSignature[] {
  const windowStart = lastResolvingResumeId(events, task);
  const signatures: FailureSignature[] = [];
  for (const event of events) {
    if (event.task !== task || event.kind !== "attempt") continue;
    if (event.id <= windowStart) continue;
    if (event.attributes.outcome !== "fail") continue;
    const payload = readAttemptPayload(event);
    if (payload.signature) signatures.push(payload.signature);
  }
  return signatures;
}

/** Measured attemptCount, not FIX_ATTEMPT_BUDGET (correction 46). */
function formatEscalationMessage(
  task: string,
  attemptCount: number,
  signatures: FailureSignature[],
): string {
  const lines = [
    `Budget exhausted for ${task} after ${attemptCount} attempts — paused-pending-approval (replan decision owed; task has not failed).`,
    `Signatures (${signatures.length}):`,
    ...signatures.map((signature, index) => `  ${index + 1}. ${signature.kind}: ${signature.key}`),
  ];
  return `${lines.join("\n")}\n`;
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
  ];
  // A5.4 drop site for escalatedTasks (correction 45).
  if (position.escalatedTasks.length > 0) {
    lines.push(`EscalatedTasks: ${position.escalatedTasks.join(", ")}`);
  }
  lines.push(
    completeLine,
    `Inferred: ${position.inferred ? "yes" : "no"}`,
    `Sources: epoch=${position.sources.epoch} task=${position.sources.task} state=${position.sources.state}`,
  );
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

function validateEventsAgainstAllocations(events: LooseEvent[], allocations: RangeAllocation[]): string[] {
  const issues: string[] = [];
  for (const event of events) {
    const ok = allocations.some((a) => event.id >= a.from && event.id <= a.to);
    if (!ok) issues.push(`event ${event.id} outside every allocation`);
  }
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
    const hasTerminal = events.some(
      (e) => e.id >= allocation.from && e.id <= allocation.to && e.kind === "terminal",
    );
    if (!hasTerminal) issues.push(`unterminated range for ${allocation.worker}`);
  }
  return issues;
}

/** Stored beside claims in the same epoch (A59 corr 155–156). Immutable after write. */
export type CalibrationAdjudicationRecord = {
  adjudicator: "target-assertions";
  /** pass | fail when evaluable; pending when complete is undefined. */
  outcome: "pass" | "fail" | "pending";
  /** When outcome is pending, the absence reason. */
  reason?: string;
  claimCount: number;
  /** Claimed confidence levels in document order, comma-separated (e.g. "low,high"). */
  claims: string;
  /**
   * Adjudication moment, read from the record (A61 corr 161).
   * - fold: written by foldEpoch when the epoch closed
   * - backfill: written or restated after the outcome was already known (excluded from computation)
   */
  adjudicatedAt: CalibrationAdjudicatedAt;
  /**
   * Context class derived at fold from ledger + bundle (A63 corr 165 / §9.5.3).
   * Absent on pre-round-4 records; report buckets those under context-not-stored.
   */
  context?: CalibrationContextClass;
};

function attemptHasClaimedConfidence(event: LooseEvent): boolean {
  const raw = event.attributes.claimedConfidence;
  return event.kind === "attempt" && typeof raw === "string" && raw.trim() !== "";
}

/**
 * One adjudication per fold that contains claimedConfidence attempts (corr 155–156).
 * Uses evaluateTargetComplete (three-valued); never the attempt outcome attribute.
 * Derives and stores context class (corr 165) — ignores any authored context on claims.
 */
function buildCalibrationAdjudicationAtFold(
  projectRoot: string,
  changeId: string,
  events: LooseEvent[],
  allocations: RangeAllocation[],
): CalibrationAdjudicationRecord | undefined {
  const claimEvents = events.filter(attemptHasClaimedConfidence);
  if (claimEvents.length === 0) return undefined;

  const claims = claimEvents
    .map((event) => (event.attributes.claimedConfidence ?? "").trim())
    .filter((level) => level.length > 0);
  const { complete, completeAbsence } = evaluateTargetComplete(projectRoot, changeId);

  // Context is derived by join; authored attributes on claim events are ignored.
  const context = deriveCalibrationContext({
    projectRoot,
    changeId,
    events,
    claimEvents,
    allocations,
  });

  const base = {
    adjudicator: "target-assertions" as const,
    claimCount: claimEvents.length,
    claims: claims.join(","),
    adjudicatedAt: "fold" as const,
    context,
  };

  if (complete === true) {
    return { ...base, outcome: "pass" };
  }
  if (complete === false) {
    return { ...base, outcome: "fail" };
  }
  return {
    ...base,
    outcome: "pending",
    reason:
      completeAbsence?.reason ??
      "target-assertions could not produce a boolean outcome at fold (pending, not fail)",
  };
}

function calibrationAdjudicationNode(record: CalibrationAdjudicationRecord): GraceXmlNode {
  const attributes: Record<string, string> = {
    adjudicator: record.adjudicator,
    outcome: record.outcome,
    claimCount: String(record.claimCount),
    claims: record.claims,
    adjudicatedAt: record.adjudicatedAt,
  };
  if (record.reason) attributes.reason = record.reason;
  if (record.context) {
    Object.assign(attributes, serializeCalibrationContextAttributes(record.context));
  }
  return {
    tag: "CalibrationAdjudication",
    attributes,
    children: [],
    text: "",
  };
}

function buildEpochNode(
  epochNumber: number,
  wave: string | undefined,
  allocations: RangeAllocation[],
  events: LooseEvent[],
  options: {
    dropPayload?: boolean;
    calibrationAdjudication?: CalibrationAdjudicationRecord;
  } = {},
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
      // injectDropPayload reproduces correction 31: id/task/kind only, no children.
      if (options.dropPayload) {
        return {
          tag: "Event",
          attributes: {
            id: String(event.id),
            task: event.task,
            kind: event.kind,
          },
          children: [] as GraceXmlNode[],
          text: "",
        };
      }
      return {
        tag: "Event",
        attributes: eventAttributesForLedger(event),
        children: event.children.map(cloneXmlNode),
        text: "",
      };
    }),
  ];
  // Durable fold-time label (corr 156) — sibling of Events, not recomputed at report time.
  if (options.calibrationAdjudication) {
    children.push(calibrationAdjudicationNode(options.calibrationAdjudication));
  }
  return {
    tag: `Epoch-${epochNumber}`,
    attributes: wave ? { wave } : {},
    children,
    text: "",
  };
}

/**
 * Writer-side transform when building ledger Event nodes (A18.2).
 * Intentionally separate from expectedLedgerEventAttributes so a defect inside the
 * writer cannot redefine verify's expectation (A20.2 / correction 38).
 */
function eventAttributesForLedger(event: LooseEvent): Record<string, string> {
  const attributes: Record<string, string> = { ...event.attributes };
  delete attributes.graceVersion;
  attributes.id = String(event.id);
  attributes.task = event.task;
  attributes.kind = event.kind;
  return attributes;
}

/**
 * Legitimate fold transform applied to a disk-parsed loose event for verify's
 * expected side (A20.2). Strips graceVersion; normalizes id/task/kind.
 * Covered by its own unit assertion — not shared with the writer function.
 */
export function expectedLedgerEventAttributes(event: LooseEvent): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.attributes)) {
    if (key === "graceVersion") continue;
    attributes[key] = value;
  }
  attributes.id = String(event.id);
  attributes.task = event.task;
  attributes.kind = event.kind;
  return attributes;
}

/** Stable payload fingerprint for fold verify (order-independent attrs). */
function payloadFingerprint(attributes: Record<string, string>, children: GraceXmlNode[]): string {
  const keys = Object.keys(attributes).sort();
  const attrPart = keys.map((key) => `${key}=${attributes[key] ?? ""}`).join("\0");
  const childPart = children.map((child) => serializeGraceXmlNode(child)).join("");
  return `${attrPart}\n${childPart}`;
}

function cloneXmlNode(node: GraceXmlNode): GraceXmlNode {
  return {
    tag: node.tag,
    attributes: { ...node.attributes },
    children: node.children.map(cloneXmlNode),
    text: node.text,
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
          // A5.4: EscalatedTask children (correction 45) — empty set omits elements.
          ...position.escalatedTasks.map((escalatedTask) => ({
            tag: "EscalatedTask",
            attributes: {},
            children: [] as GraceXmlNode[],
            text: escalatedTask,
          })),
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

/**
 * Refuse agent-authored context dimensions on run events (D6 / §9.5.3).
 * Context is derived at fold and stored on CalibrationAdjudication only.
 */
export function rejectAuthoredContextAttributes(
  attributes: Record<string, string> | undefined,
): void {
  if (!attributes) return;
  for (const name of AUTHORED_CONTEXT_ATTRIBUTE_NAMES) {
    if (Object.prototype.hasOwnProperty.call(attributes, name)) {
      throw new GraceCommandError(
        "invalid-arguments",
        `Context feature ${name} must not be authored on a run event; it is derived at fold (D6 / §9.5.3).`,
      );
    }
  }
}

function writeEventFile(
  bundlePath: string,
  event: {
    id: number;
    task: string;
    kind: string;
    allocations?: RangeAllocation[];
    wave?: string;
    /** Extra root attributes (e.g. outcome). id/task/kind/graceVersion are forced. */
    attributes?: Record<string, string>;
    /** Extra root children (FailureSignature, WriteEvidence, …). */
    children?: GraceXmlNode[];
  },
): void {
  rejectAuthoredContextAttributes(event.attributes);
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
  for (const child of event.children ?? []) {
    children.push(cloneXmlNode(child));
  }
  const attributes: Record<string, string> = {
    ...(event.attributes ?? {}),
    graceVersion: NGRACE_ARTIFACT_VERSION,
    id: String(event.id),
    task: event.task,
    kind: event.kind,
  };
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
    description:
      "Run ledger and cursor: show, regenerate, advance, attempt, verification-unavailable, pause, resume, fold.",
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
      meta: {
        name: "advance",
        description:
          "Append a structural run event (opened/progress/pause/resume/terminal). Use `cursor attempt` for verification cycles.",
      },
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
        executorModel: {
          type: "string",
          description: "Optional harness-stated model id on openEpoch (ExecutorIdentity; may be absent)",
        },
        executorHarness: {
          type: "string",
          description: "Optional harness-stated host id on openEpoch (ExecutorIdentity; may be absent)",
        },
        format: { type: "string", alias: "f", description: "text or json", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const model = context.args.executorModel ? String(context.args.executorModel).trim() : "";
          const harness = context.args.executorHarness ? String(context.args.executorHarness).trim() : "";
          const position = advanceCursor(String(context.args.path ?? "."), requireChangeId(context.args), {
            task: String(context.args.task),
            kind: context.args.kind ? String(context.args.kind) : undefined,
            openEpoch: Boolean(context.args.openEpoch),
            worker: context.args.worker ? String(context.args.worker) : undefined,
            from: context.args.from ? Number(context.args.from) : undefined,
            to: context.args.to ? Number(context.args.to) : undefined,
            wave: context.args.wave ? String(context.args.wave) : undefined,
            executorIdentity:
              model || harness
                ? {
                    model: model || undefined,
                    harness: harness || undefined,
                  }
                : undefined,
          });
          if (format === "json") process.stdout.write(`${JSON.stringify(position, null, 2)}\n`);
          else process.stdout.write(formatCursorPosition(position));
        }, "Unable to complete ngrace cursor advance.");
      },
    }),
    attempt: defineCommand({
      meta: {
        name: "attempt",
        description:
          "Record a verification-cycle attempt (outcome pass|fail; signature required on fail). Optional claimedConfidence is write-only analysis data — not used as the calibration score.",
      },
      args: {
        path: { type: "string", alias: "p", description: "Project root", default: "." },
        change: { type: "string", description: "C-* change id", required: true },
        task: { type: "string", description: "T-* task id", required: true },
        outcome: { type: "string", description: "pass or fail", required: true },
        signatureKind: { type: "string", description: "Failure signature kind (required when outcome=fail)" },
        signatureKey: { type: "string", description: "Failure signature key (required when outcome=fail)" },
        claimedConfidence: {
          type: "string",
          description: "Optional low|medium|high self-report (analysis only; no gate may read it)",
        },
        format: { type: "string", alias: "f", description: "text or json", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const outcomeRaw = String(context.args.outcome ?? "").trim();
          if (outcomeRaw !== "pass" && outcomeRaw !== "fail") {
            throw new GraceCommandError(
              "invalid-arguments",
              `outcome must be "pass" or "fail" (got ${JSON.stringify(outcomeRaw)}).`,
            );
          }
          const signatureKind = context.args.signatureKind ? String(context.args.signatureKind) : undefined;
          const signatureKey = context.args.signatureKey ? String(context.args.signatureKey) : undefined;
          const claimedRaw = context.args.claimedConfidence
            ? String(context.args.claimedConfidence).trim()
            : undefined;
          const result = recordAttempt(String(context.args.path ?? "."), requireChangeId(context.args), {
            task: String(context.args.task),
            outcome: outcomeRaw,
            claimedConfidence: claimedRaw,
            signature:
              outcomeRaw === "fail" && signatureKind && signatureKey
                ? { kind: signatureKind, key: signatureKey }
                : undefined,
          });
          if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          else {
            process.stdout.write(result.message);
            process.stdout.write(formatCursorPosition(result.position));
          }
        }, "Unable to complete ngrace cursor attempt.");
      },
    }),
    "verification-unavailable": defineCommand({
      meta: {
        name: "verification-unavailable",
        description: "Record that verification could not run (not an attempt; does not count against the budget).",
      },
      args: {
        path: { type: "string", alias: "p", description: "Project root", default: "." },
        change: { type: "string", description: "C-* change id", required: true },
        task: { type: "string", description: "T-* task id", required: true },
        reason: { type: "string", description: "Why verification could not run", required: true },
        verdict: {
          type: "string",
          description: "not-run or unable-to-determine (default unable-to-determine)",
          default: "unable-to-determine",
        },
        format: { type: "string", alias: "f", description: "text or json", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const verdictRaw = String(context.args.verdict ?? "unable-to-determine").trim();
          if (verdictRaw !== "not-run" && verdictRaw !== "unable-to-determine") {
            throw new GraceCommandError(
              "invalid-arguments",
              `verdict must be "not-run" or "unable-to-determine" (got ${JSON.stringify(verdictRaw)}).`,
            );
          }
          const position = recordVerificationUnavailable(
            String(context.args.path ?? "."),
            requireChangeId(context.args),
            {
              task: String(context.args.task),
              absence: {
                verdict: verdictRaw,
                reason: String(context.args.reason ?? ""),
              },
            },
          );
          if (format === "json") process.stdout.write(`${JSON.stringify(position, null, 2)}\n`);
          else process.stdout.write(formatCursorPosition(position));
        }, "Unable to complete ngrace cursor verification-unavailable.");
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
        format: { type: "string", alias: "f", default: "text" },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const result = foldEpoch(String(context.args.path ?? "."), requireChangeId(context.args), {
            wave: context.args.wave ? String(context.args.wave) : undefined,
          });
          if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          else process.stdout.write(formatFoldResult(result));
        }, "Unable to complete ngrace cursor fold.");
      },
    }),
  },
});

if (import.meta.main) {
  await runMain(cursorCommand as CommandDef);
}
