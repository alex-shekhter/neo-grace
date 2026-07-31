#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
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

/** Write-scope snapshot recorded on an attempt event (A19.3). */
export type WriteEvidenceSnapshot =
  | { available: true; changedFiles: string[] }
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
  const mapped = cursorStateForEventKind(kind);
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task,
    state: "state" in mapped ? mapped.state : undefined,
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
    degradation: "unknown" in mapped ? mapped.degradation : undefined,
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
  const epochNode = buildEpochNode(epochNumber, wave, allocations, events, {
    dropPayload: options.injectDropPayload === true,
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
    const expected = payloadFingerprint(eventAttributesForLedger(event), event.children);
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

  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: epochNumber,
    task: events[events.length - 1]?.task,
    state: "idle",
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
      const parsedState = parseCursorState(stateText);
      if ("invalid" in parsedState) {
        // Unchecked cast hole (A19.2): unrecognized value takes degradation, then re-derive.
        degradation = {
          verdict: "unable-to-determine",
          reason: `cursor state ${JSON.stringify(parsedState.invalid)} is not a known CursorState; re-derived`,
        };
      } else {
        written = {
          changeId,
          bundlePath,
          epoch: epochText ? Number(epochText) : undefined,
          task,
          state: parsedState.state,
          sources: { epoch: "cursor", task: "cursor", state: "cursor" },
          inferred: false,
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
    let state: CursorState | undefined = "idle";
    let kindDegradation: AbsenceValue | undefined;
    if (events.length > 0 && lastEvent) {
      const mapped = cursorStateForEventKind(lastEvent.kind);
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
      sources: {
        epoch: events.length > 0 ? "events" : "ledger",
        task: lastEvent ? "events" : task ? "ledger" : "none",
        state: events.length > 0 ? "events" : "ledger",
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
 * Dumb counter (D9 / A19.1): counts attempt events for a task. Inspects nothing —
 * no signature, no outcome, no content condition.
 */
export function countTaskAttemptEvents(
  events: ReadonlyArray<{ task: string; kind: string }>,
  task: string,
): number {
  return events.filter((event) => event.task === task && event.kind === "attempt").length;
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

/** Snapshot repository write evidence for recording onto an attempt (A19.3). */
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
  return { available: true, changedFiles: [...changedFiles] };
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

  const writeEvidence = options.writeEvidence ?? snapshotWriteEvidence(projectRoot);
  const children: GraceXmlNode[] = [];
  if (options.outcome === "fail" && options.signature) {
    children.push(failureSignatureNode(options.signature));
  }
  children.push(writeEvidenceNode(writeEvidence));

  const id = nextEventId(bundlePath);
  writeEventFile(bundlePath, {
    id,
    task,
    kind: "attempt",
    attributes: { outcome: options.outcome },
    children,
  });

  const loose = listLooseEvents(bundlePath);
  const attemptCount = countTaskAttemptEvents(loose, task);
  const signatures = collectFailureSignatures(loose, task);

  // Escalation only on the fail path when the dumb attempt count hits the budget.
  // Counter itself has no outcome/signature condition (A19.1).
  if (options.outcome === "fail" && attemptCount >= FIX_ATTEMPT_BUDGET) {
    const escalationId = nextEventId(bundlePath);
    writeEventFile(bundlePath, {
      id: escalationId,
      task,
      kind: "escalation",
      children: signatures.map(failureSignatureNode),
    });
    const position: CursorPosition = {
      changeId,
      bundlePath,
      epoch: currentOpenEpochHint(bundlePath),
      task,
      state: "paused-pending-approval",
      sources: { epoch: "events", task: "events", state: "events" },
      inferred: false,
    };
    writeCursorFile(bundlePath, position);
    const message = formatEscalationMessage(task, signatures);
    return {
      position,
      eventId: id,
      attemptCount,
      escalated: true,
      signatures,
      message,
    };
  }

  const mapped = cursorStateForEventKind("attempt");
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task,
    state: "state" in mapped ? mapped.state : "in-progress",
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
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
  const mapped = cursorStateForEventKind("verification-unavailable");
  const position: CursorPosition = {
    changeId,
    bundlePath,
    epoch: currentOpenEpochHint(bundlePath),
    task,
    state: "state" in mapped ? mapped.state : "in-progress",
    sources: { epoch: "events", task: "events", state: "events" },
    inferred: false,
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
  const earlierSet = new Set(earlier.writeEvidence.changedFiles);
  const laterSet = new Set(later.writeEvidence.changedFiles);
  const same =
    earlierSet.size === laterSet.size && [...earlierSet].every((file) => laterSet.has(file));
  if (same) {
    return {
      verdict: "flaky",
      reason: "fail then pass with identical write evidence (no intervening write)",
    };
  }
  return {
    verdict: "retry",
    reason: "fail then pass with changed write evidence (intervening write)",
  };
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
      children: evidence.changedFiles.map((file) => ({
        tag: "File",
        attributes: {},
        children: [] as GraceXmlNode[],
        text: file,
      })),
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
  const changedFiles = node.children
    .filter((child) => child.tag === "File")
    .map((child) => child.text.trim())
    .filter(Boolean)
    .sort();
  return { available: true, changedFiles };
}

function collectFailureSignatures(events: LooseEvent[], task: string): FailureSignature[] {
  const signatures: FailureSignature[] = [];
  for (const event of events) {
    if (event.task !== task || event.kind !== "attempt") continue;
    if (event.attributes.outcome !== "fail") continue;
    const payload = readAttemptPayload(event);
    if (payload.signature) signatures.push(payload.signature);
  }
  return signatures;
}

function formatEscalationMessage(task: string, signatures: FailureSignature[]): string {
  const lines = [
    `Budget exhausted for ${task} after ${FIX_ATTEMPT_BUDGET} attempts — paused-pending-approval (replan decision owed; task has not failed).`,
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

function buildEpochNode(
  epochNumber: number,
  wave: string | undefined,
  allocations: RangeAllocation[],
  events: LooseEvent[],
  options: { dropPayload?: boolean } = {},
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
  return {
    tag: `Epoch-${epochNumber}`,
    attributes: wave ? { wave } : {},
    children,
    text: "",
  };
}

/** Ledger Event attributes: all loose root attrs except graceVersion (A18.2). */
function eventAttributesForLedger(event: LooseEvent): Record<string, string> {
  const attributes: Record<string, string> = { ...event.attributes };
  delete attributes.graceVersion;
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
    /** Extra root attributes (e.g. outcome). id/task/kind/graceVersion are forced. */
    attributes?: Record<string, string>;
    /** Extra root children (FailureSignature, WriteEvidence, …). */
    children?: GraceXmlNode[];
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
    description: "Run ledger and cursor: show, regenerate, advance, pause, resume, fold.",
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
