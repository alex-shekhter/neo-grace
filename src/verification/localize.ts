// START_MODULE_CONTRACT
//   PURPOSE: Failure localization
//   SCOPE: Marker divergence comparison and verification localize CLI
//   DEPENDS: none
//   LINKS: M-LOCALIZE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ADMISSIBLE_REVIEW_CODES
//   AdmissibleReviewCode
//   BlockLocation
//   Divergence
//   FlakePair
//   LocalizationResult
//   LocalizeInput
//   OBSERVED_GROUND
//   ProcessContextFinding
//   assertAdmissibilityClosedByName
//   countRequiredInObserved
//   excludedReviewCodesForLocalization
//   filterAdmissibleReviewFindings
//   findLatestFailPassPair
//   firstDivergentBlock
//   flakePairFromChange
//   formatDivergenceLine
//   formatLocalizationText
//   isAdmissibleLocalizationReviewCode
//   loadReviewJsonFindings
//   localizeFailure
//   parseObservedMarkers
//   projectMarkerAlphabet
//   resolveBlockLocations
//   resolveModuleForTestPath
//   splitObservedByEntry
// END_MODULE_MAP
/**
 * Deterministic failure localization (D8, Phase 7 / A41–A44).
 *
 * Inputs: expected markers from a V-M-* entry (document order), observed markers
 * parsed from a caller-supplied log against the project-wide alphabet, optional
 * review JSON and optional flake pair from ledger attempts (--change).
 *
 * Ground for `observed` (A43.2 / corr 109): declared markers textually present in
 * the supplied log, in log order, at most one count per line. This is NOT "markers
 * the run emitted" — assertion diffs that echo a marker string can still appear.
 * Capture the run's own output, not only the test framework failure report.
 *
 * Expected vs observed (A44.1 / corr 112): expected is a **requirement list** in
 * declaration order; observed is a **transcript**. The comparator is an ordered
 * subsequence scan — "did the transcript contain the required markers, in order?"
 * Extra and repeated own-marker occurrences are context, not divergence.
 *
 * Route (1) — binary runs tests — is deferred (A42.1). parseObservedMarkers takes
 * a string so a later C-* can hand it spawn output without touching the comparator.
 *
 * Absence verdicts are always unable-to-determine in v1 (A42.1); not-run is unused.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyFlakeFromEvidence,
  listAccountingEvents,
  readAttemptPayload,
  resolveChangeBundle,
  type AbsenceValue,
  type FlakeVerdict,
  type LooseEvent,
  type WriteEvidenceSnapshot,
} from "../grace-cursor";
import { parseMarkerBlockName } from "../project-utils";
import { isLikelyTestPath } from "../query/core";
import type { GraceArtifactIndex, ModuleRecord, ModuleVerificationRecord } from "../query/types";
import { allReviewCodes, isReviewIssueCode } from "../review/catalog";

/** D8 admissible process-audit codes — closed by name (A42.4). Mechanization is necessary, not sufficient. */
export const ADMISSIBLE_REVIEW_CODES = [
  "review.scope-outside-write-scope",
  "review.test-assertion-weakened",
  "review.compat-new-error",
] as const;

export type AdmissibleReviewCode = (typeof ADMISSIBLE_REVIEW_CODES)[number];

const ADMISSIBLE_SET = new Set<string>(ADMISSIBLE_REVIEW_CODES);

/** Declared in text/JSON so callers know the parse is textual presence, not emission certainty (A43.2). */
export const OBSERVED_GROUND =
  "declared markers textually present in the supplied log, in log order (at most one count per line); not proven run emissions";

/**
 * First unmet requirement under subsequence scan (A45.1 / corr 114).
 *
 * Two findings that previously shared one shape:
 * - requirement-absent: the marker never appears in the transcript → look upstream
 * - requirement-out-of-order: the marker appears only before the cursor → sequencing, not "never ran"
 *
 * On out-of-order, do not present another observed token as a substitute for the missing slot.
 */
export type Divergence =
  | {
      kind: "requirement-absent";
      /** Index into the expected (requirement) list. */
      index: number;
      expected: string;
      /**
       * Token at the scan cursor when the requirement was unmet, if any.
       * Context only — not "what ran instead of expected."
       */
      atCursor?: string;
    }
  | {
      kind: "requirement-out-of-order";
      /** Index into the expected (requirement) list. */
      index: number;
      expected: string;
      /** Index into the observed transcript where expected first appeared (before the cursor). */
      appearedAt: number;
    };

export type BlockLocation = {
  path: string;
  startLine: number;
  endLine: number;
};

export type ProcessContextFinding = {
  code: string;
  findingId?: string;
  message?: string;
  file?: string;
  severity?: string;
};

export type LocalizationResult = {
  schemaVersion: "1.0.0";
  tool: "ngrace-verification-localize";
  verificationId?: string;
  moduleId?: string;
  /** When module could not be resolved. */
  moduleAbsence?: AbsenceValue;
  expected: string[];
  observed: string[];
  /** Ground for `observed` — always the same string (A43.2 / rule 8). */
  observedGround: string;
  /** Markers from other V-M-* entries seen in the log, log order (A42.3). */
  foreignMarkers: string[];
  /**
   * First unmet required-marker index, or null when every requirement appears in order
   * in the observed transcript (or when own+foreign are both empty — A43.1 absence path).
   * Suppressed when flake is flaky (D8 / corr 98).
   */
  divergence: Divergence | null;
  /** True when a flaky fail→pass pair suppressed a causal divergence claim. */
  divergenceSuppressed?: boolean;
  /**
   * Per-requirement counts in the observed transcript when requirements are met and at
   * least one required marker appears more than once (A44.1 — repeats are context).
   */
  observedRequirementCounts?: Array<{ marker: string; count: number }>;
  /** Resolved BLOCK_* regions for the divergent marker (A42.2). */
  locations: BlockLocation[];
  locationAbsence?: AbsenceValue;
  processContext: ProcessContextFinding[];
  flake?: { verdict: FlakeVerdict; reason: string };
  /**
   * Top-level absence when localization cannot answer (missing log, empty log, marker-less entry, etc.).
   * Always unable-to-determine in v1 (A42.1).
   */
  absence?: AbsenceValue;
};

export type FlakePair = {
  earlier: { outcome: string; writeEvidence: WriteEvidenceSnapshot };
  later: { outcome: string; writeEvidence: WriteEvidenceSnapshot };
};

function inability(reason: string): AbsenceValue {
  return { verdict: "unable-to-determine", reason };
}

/**
 * firstDivergentBlock — pure comparator under requirement/transcript semantics (D8 / A44–A45).
 *
 * Expected is a requirement list in declaration order; observed is a transcript.
 * Divergence is the first required marker not found at or after the scan cursor
 * (ordered subsequence). Extra and repeated observed markers are not divergence.
 *
 * When unmet, discriminates (A45.1):
 *   - requirement-absent — want never appears in observed
 *   - requirement-out-of-order — want appears only before the cursor (ran too early)
 *
 * Axes (restated from A42.6; seven-count does not survive):
 *   1. first unmet at 0 / mid / end (each with kind)
 *   2. all met → null
 *   3. repeats absorbed → null
 *   4. order violated → requirement-out-of-order
 * Parser cases remain separate.
 */
export function firstDivergentBlock(
  expected: readonly string[],
  observed: readonly string[],
): Divergence | null {
  let cursor = 0;
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i]!;
    let found = -1;
    for (let j = cursor; j < observed.length; j += 1) {
      if (observed[j] === want) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      // Discriminator (A45.1): does want appear anywhere in the full transcript?
      let earlier = -1;
      for (let j = 0; j < cursor; j += 1) {
        if (observed[j] === want) {
          earlier = j;
          break;
        }
      }
      if (earlier >= 0) {
        return {
          kind: "requirement-out-of-order",
          index: i,
          expected: want,
          appearedAt: earlier,
        };
      }
      return {
        kind: "requirement-absent",
        index: i,
        expected: want,
        atCursor: cursor < observed.length ? observed[cursor] : undefined,
      };
    }
    cursor = found + 1;
  }
  return null;
}

/** Count how many times each required marker appears in the observed transcript. */
export function countRequiredInObserved(
  expected: readonly string[],
  observed: readonly string[],
): Array<{ marker: string; count: number }> {
  return expected.map((marker) => ({
    marker,
    count: observed.filter((m) => m === marker).length,
  }));
}

/**
 * Parse observed markers from a log against a declared alphabet.
 *
 * Ground (A43.2): textual presence of declared markers, **at most one count per line**,
 * lines in file order. A line that mentions the marker twice is one hit (description, not
 * two emissions). Across lines, every line that contains a marker contributes once —
 * repeats stay in the transcript and are absorbed by the subsequence comparator (A44.1).
 *
 * Prefers longer alphabet entries when two share a start position on the same line.
 */
export function parseObservedMarkers(
  logText: string,
  alphabet: readonly string[],
): string[] {
  if (!logText || alphabet.length === 0) {
    return [];
  }
  const unique = [...new Set(alphabet.filter(Boolean))];
  if (unique.length === 0) {
    return [];
  }
  const byLength = [...unique].sort((a, b) => b.length - a.length);
  const result: string[] = [];
  for (const line of logText.split("\n")) {
    if (!line) continue;
    // At most one marker count per line: first (longest-preferred) non-overlapping hit on the line.
    let best: { pos: number; marker: string } | undefined;
    for (const marker of byLength) {
      const idx = line.indexOf(marker);
      if (idx < 0) continue;
      if (!best || idx < best.pos || (idx === best.pos && marker.length > best.marker.length)) {
        best = { pos: idx, marker };
      }
    }
    if (best) {
      result.push(best.marker);
    }
  }
  return result;
}

/** Project-wide marker alphabet from every V-M-* entry (A42.3). */
export function projectMarkerAlphabet(index: GraceArtifactIndex): string[] {
  const markers: string[] = [];
  for (const entry of index.verifications) {
    for (const marker of entry.requiredLogMarkers) {
      markers.push(marker);
    }
  }
  return [...new Set(markers)];
}

/**
 * Split a project-wide observed sequence into entry-owned vs foreign (A42.3).
 * Comparison uses only the entry's markers; foreign are reported for diagnosis.
 */
export function splitObservedByEntry(
  projectObserved: readonly string[],
  entryMarkers: readonly string[],
): { observed: string[]; foreignMarkers: string[] } {
  const owned = new Set(entryMarkers);
  const observed: string[] = [];
  const foreignMarkers: string[] = [];
  for (const marker of projectObserved) {
    if (owned.has(marker)) {
      observed.push(marker);
    } else {
      foreignMarkers.push(marker);
    }
  }
  return { observed, foreignMarkers };
}

/**
 * Resolve a divergent marker to source regions via parseMarkerBlockName + linked blocks (A42.2).
 */
export function resolveBlockLocations(
  marker: string | undefined,
  moduleRecord: ModuleRecord | undefined,
): { locations: BlockLocation[]; locationAbsence?: AbsenceValue } {
  if (marker == null || marker === "") {
    return {
      locations: [],
      locationAbsence: inability("no divergent marker to resolve to a BLOCK_* region"),
    };
  }
  const blockName = parseMarkerBlockName(marker);
  if (!blockName) {
    return {
      locations: [],
      locationAbsence: inability(
        `marker ${JSON.stringify(marker)} has no [BLOCK_*] suffix; cannot resolve a source region`,
      ),
    };
  }
  if (!moduleRecord) {
    return {
      locations: [],
      locationAbsence: inability(
        `block ${blockName} cannot be resolved without a module; no linked runtime files in scope`,
      ),
    };
  }
  const locations: BlockLocation[] = [];
  for (const file of moduleRecord.localFiles) {
    // Runtime files only — tests are not the emission site (shared isLikelyTestPath, corr 111).
    if (isLikelyTestPath(file.path)) {
      continue;
    }
    for (const block of file.blocks) {
      if (block.name === blockName) {
        locations.push({
          path: file.path,
          startLine: block.startLine,
          endLine: block.endLine,
        });
      }
    }
  }
  if (locations.length === 0) {
    return {
      locations: [],
      locationAbsence: inability(
        `no linked runtime file exposes BLOCK_${blockName} for marker ${JSON.stringify(marker)}`,
      ),
    };
  }
  // Multi-file: report all (A42.2); do not pick one.
  return { locations };
}

/**
 * Join a failing test path to a module (A41.2 corr 97).
 * Prefer V-M-* testFiles; fall back to governed file LINKS.
 */
export function resolveModuleForTestPath(
  index: GraceArtifactIndex,
  testPath: string,
): { moduleId: string; verificationId?: string } | { absence: AbsenceValue } {
  const normalized = testPath.replaceAll("\\", "/");
  for (const entry of index.verifications) {
    for (const file of entry.testFiles) {
      if (
        file.replaceAll("\\", "/") === normalized
        || file.replaceAll("\\", "/").endsWith("/" + normalized)
        || normalized.endsWith("/" + file.replaceAll("\\", "/"))
      ) {
        if (entry.moduleId) {
          return { moduleId: entry.moduleId, verificationId: entry.id };
        }
      }
    }
  }
  for (const moduleRecord of index.modules) {
    for (const file of moduleRecord.localFiles) {
      const p = file.path.replaceAll("\\", "/");
      if (p === normalized || p.endsWith("/" + normalized) || normalized.endsWith("/" + p)) {
        return { moduleId: moduleRecord.id };
      }
    }
  }
  return {
    absence: inability(
      `test path ${JSON.stringify(testPath)} is not listed on any V-M-* testFiles and is not a governed file of any module`,
    ),
  };
}

/** True when a review code is D8-admissible process context (A42.4 closed-by-name). */
export function isAdmissibleLocalizationReviewCode(code: string): boolean {
  return ADMISSIBLE_SET.has(code);
}

/**
 * Filter review findings to the three D8-named codes. Never produce a divergence index.
 */
export function filterAdmissibleReviewFindings(
  findings: readonly ProcessContextFinding[],
): ProcessContextFinding[] {
  return findings.filter((f) => isAdmissibleLocalizationReviewCode(f.code));
}

/**
 * Read ngrace review --format json document (A42.5).
 * Accepts either the bare ReviewResult shape or the CLI wrapper `{ ok, ...result }`.
 */
export function loadReviewJsonFindings(filePath: string): ProcessContextFinding[] | { absence: AbsenceValue } {
  if (!existsSync(filePath)) {
    return { absence: inability(`review JSON file not found: ${filePath}`) };
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      absence: inability(
        `review JSON unreadable: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      absence: inability(
        `review JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { absence: inability("review JSON root must be an object") };
  }
  const doc = parsed as Record<string, unknown>;
  const findingsRaw = doc.findings;
  if (!Array.isArray(findingsRaw)) {
    return { absence: inability("review JSON must contain a findings array (ngrace review --format json)") };
  }
  const findings: ProcessContextFinding[] = [];
  for (const item of findingsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code : "";
    if (!code) continue;
    findings.push({
      code,
      findingId: typeof row.findingId === "string" ? row.findingId : undefined,
      message: typeof row.message === "string" ? row.message : undefined,
      file: typeof row.file === "string" ? row.file : undefined,
      severity: typeof row.severity === "string" ? row.severity : undefined,
    });
  }
  return findings;
}

/**
 * Build a flake pair from durable attempt events (ledger∪loose) for a change (A43.3 / A44.2).
 * Adjacency is within a **task's** attempt sequence (group by task, order by id), not the
 * global event stream — interleaved tasks are the wave model (A44.2 / corr 113).
 * Uses the most recent fail→pass pair that both carry write evidence, optionally scoped to a task.
 */
export function flakePairFromChange(
  projectRoot: string,
  changeId: string,
  task?: string,
): FlakePair | { absence: AbsenceValue } {
  let bundlePath: string;
  try {
    bundlePath = resolveChangeBundle(projectRoot, changeId);
  } catch (error) {
    return {
      absence: inability(
        `cannot load change ${changeId} for flake classification: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  // Rule 9 (A20.5): durable record, not cursor cache.
  const events = listAccountingEvents(bundlePath).filter((event) => event.kind === "attempt");
  const scoped = task
    ? events.filter((event) => event.task === task)
    : events;
  const pair = findLatestFailPassPair(scoped);
  if (!pair) {
    return {
      absence: inability(
        task
          ? `no fail→pass attempt pair with write evidence for task ${task} in ${changeId}`
          : `no fail→pass attempt pair with write evidence in ${changeId}`,
      ),
    };
  }
  return pair;
}

/**
 * Find the latest fail→pass pair with write evidence, grouping by task first (A44.2).
 * Global adjacency of T1-fail / T2-attempt / T1-pass must still yield a pair for T1.
 */
export function findLatestFailPassPair(events: LooseEvent[]): FlakePair | null {
  const byTask = new Map<string, LooseEvent[]>();
  for (const event of events) {
    const list = byTask.get(event.task) ?? [];
    list.push(event);
    byTask.set(event.task, list);
  }
  let latest: FlakePair | null = null;
  let latestLaterId = -1;
  for (const group of byTask.values()) {
    const ordered = [...group].sort((a, b) => a.id - b.id);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const earlier = ordered[i]!;
      const later = ordered[i + 1]!;
      const ep = readAttemptPayload(earlier);
      const lp = readAttemptPayload(later);
      if (ep.outcome !== "fail" || lp.outcome !== "pass") continue;
      if (!ep.writeEvidence || !lp.writeEvidence) continue;
      if (later.id > latestLaterId) {
        latestLaterId = later.id;
        latest = {
          earlier: { outcome: "fail", writeEvidence: ep.writeEvidence },
          later: { outcome: "pass", writeEvidence: lp.writeEvidence },
        };
      }
    }
  }
  return latest;
}

export type LocalizeInput = {
  index: GraceArtifactIndex;
  /** V-M-* entry to localize against. */
  verification: ModuleVerificationRecord;
  module?: ModuleRecord;
  /** Log text (caller-supplied; never invented from source). */
  logText: string | null;
  /** Why logText is null, when known. */
  logAbsenceReason?: string;
  /** Optional failing test path for module join override / secondary. */
  testFile?: string;
  /** Raw findings from --review-json (already parsed) or undefined when flag absent. */
  reviewFindings?: ProcessContextFinding[];
  /**
   * Optional fail then pass write-evidence pair for flake classification.
   * Produced by CLI via --change → flakePairFromChange (A43.3). When omitted, flake is not reported.
   */
  flakePair?: FlakePair;
};

/**
 * Assemble a localization result. Pure over its inputs (no spawn, no git).
 */
export function localizeFailure(input: LocalizeInput): LocalizationResult {
  const { verification, index } = input;
  const base: LocalizationResult = {
    schemaVersion: "1.0.0",
    tool: "ngrace-verification-localize",
    verificationId: verification.id,
    moduleId: verification.moduleId ?? input.module?.id,
    expected: [...verification.requiredLogMarkers],
    observed: [],
    observedGround: OBSERVED_GROUND,
    foreignMarkers: [],
    divergence: null,
    locations: [],
    processContext: [],
  };

  // Module join from test file when provided.
  if (input.testFile) {
    const joined = resolveModuleForTestPath(index, input.testFile);
    if ("absence" in joined) {
      base.moduleAbsence = joined.absence;
    } else {
      base.moduleId = joined.moduleId;
      if (joined.verificationId) {
        base.verificationId = joined.verificationId;
      }
    }
  } else if (!base.moduleId) {
    base.moduleAbsence = inability(
      `verification ${verification.id} has no moduleId and no --test-file was supplied`,
    );
  }

  // Marker-less entry — absence, not a confident empty answer (§7.7.2).
  if (verification.requiredLogMarkers.length === 0) {
    base.absence = inability(
      `${verification.id} declares no required log markers; cannot localize by marker sequence`,
    );
    return withProcessAndFlake(base, input);
  }

  // Log required.
  if (input.logText == null) {
    base.absence = inability(
      input.logAbsenceReason
        ?? "no log supplied; pass --log <file> or --log - (stdin). Localization never invents an observed sequence from source text",
    );
    return withProcessAndFlake(base, input);
  }

  const alphabet = projectMarkerAlphabet(index);
  const projectObserved = parseObservedMarkers(input.logText, alphabet);
  const { observed, foreignMarkers } = splitObservedByEntry(
    projectObserved,
    verification.requiredLogMarkers,
  );
  base.observed = observed;
  base.foreignMarkers = foreignMarkers;

  // A43.1 / corr 108: zero marker evidence (own empty AND foreign empty) is absence,
  // not a confident divergence at 0 with a source location.
  if (observed.length === 0 && foreignMarkers.length === 0) {
    base.absence = inability(
      "log carries no declared marker of any entry; cannot distinguish a run that died before the first marker from a log that never carried markers",
    );
    // No divergence index, no location — evidence did not settle either (A43.1, §7.7).
    return withProcessAndFlake(base, input);
  }

  // own empty + foreign non-empty: first unmet requirement at 0 — log demonstrably carries markers.
  // own non-empty: ordered-subsequence compare (A44.1).
  const divergence = firstDivergentBlock(verification.requiredLogMarkers, observed);
  base.divergence = divergence;

  if (divergence) {
    // Locate the unmet *requirement* (expected). For out-of-order this is the block that
    // ran too early — the sentence in formatLocalizationText says sequencing, not "never ran".
    const markerForLocation = divergence.expected;
    const moduleRecord =
      input.module
      ?? (base.moduleId
        ? index.modules.find((m) => m.id === base.moduleId)
        : undefined);
    const resolved = resolveBlockLocations(markerForLocation, moduleRecord);
    base.locations = resolved.locations;
    if (resolved.locationAbsence) {
      base.locationAbsence = resolved.locationAbsence;
    }
  } else {
    // Requirements met: report repeat counts as context when any required marker appears >1×.
    const counts = countRequiredInObserved(verification.requiredLogMarkers, observed);
    if (counts.some((row) => row.count > 1)) {
      base.observedRequirementCounts = counts;
    }
  }

  // Stack-trace ban: never set locations from frames. Explicit: never parse stack frames.

  return withProcessAndFlake(base, input);
}

function withProcessAndFlake(
  base: LocalizationResult,
  input: LocalizeInput,
): LocalizationResult {
  if (input.reviewFindings) {
    base.processContext = filterAdmissibleReviewFindings(input.reviewFindings);
  }

  if (input.flakePair) {
    const flake = classifyFlakeFromEvidence(input.flakePair.earlier, input.flakePair.later);
    base.flake = flake;
    if (flake.verdict === "flaky" && base.divergence) {
      // D8: flaky results are noise, not a localization signal.
      base.divergenceSuppressed = true;
      base.divergence = null;
      base.locations = [];
      base.locationAbsence = inability(
        "divergence suppressed: fail→pass with identical write evidence is flaky (D8); not a causal first divergent block",
      );
    }
  }

  return base;
}

/**
 * Human sentence for a divergence (A45.1). Out-of-order must not read as "B never ran"
 * or name another marker as a substitute for the missing slot.
 */
export function formatDivergenceLine(d: Divergence): string {
  if (d.kind === "requirement-out-of-order") {
    return (
      `First divergent block: index ${d.index} requirement-out-of-order`
      + ` expected=${JSON.stringify(d.expected)}`
      + ` appeared-at=${d.appearedAt}`
      + ` (ran too early — look at sequencing, not the block as missing)`
    );
  }
  // requirement-absent
  const cursorNote =
    d.atCursor !== undefined
      ? ` at-cursor=${JSON.stringify(d.atCursor)} (next token; not a substitute for the missing requirement)`
      : " (never appeared in the log)";
  return (
    `First divergent block: index ${d.index} requirement-absent`
    + ` expected=${JSON.stringify(d.expected)}`
    + cursorNote
  );
}

/** Format localization result as human-readable text. */
export function formatLocalizationText(result: LocalizationResult): string {
  const lines: string[] = [
    "neo-grace Verification Localize",
    "===============================",
  ];
  if (result.verificationId) {
    lines.push(`Verification: ${result.verificationId}`);
  }
  if (result.moduleId) {
    lines.push(`Module: ${result.moduleId}`);
  }
  if (result.moduleAbsence) {
    lines.push(
      `Module: ${result.moduleAbsence.verdict} — ${result.moduleAbsence.reason}`,
    );
  }
  if (result.absence) {
    lines.push(`Absence: ${result.absence.verdict} — ${result.absence.reason}`);
  }
  lines.push(`Expected (${result.expected.length}): ${result.expected.join(" → ") || "(none)"}`);
  lines.push(`Observed (${result.observed.length}): ${result.observed.join(" → ") || "(none)"}`);
  lines.push(`Observed ground: ${result.observedGround}`);
  if (result.foreignMarkers.length > 0) {
    lines.push(
      `Foreign markers observed (${result.foreignMarkers.length}): ${result.foreignMarkers.join(" → ")}`,
    );
  }
  if (result.divergenceSuppressed) {
    lines.push("First divergent block: suppressed (flaky classification)");
  } else if (result.divergence) {
    lines.push(formatDivergenceLine(result.divergence));
  } else if (!result.absence) {
    lines.push(
      "First divergent block: (none — all required markers found in order; failure is elsewhere)",
    );
  }
  if (result.observedRequirementCounts && result.observedRequirementCounts.length > 0) {
    const parts = result.observedRequirementCounts.map(
      (row) => `${row.marker}×${row.count}`,
    );
    lines.push(
      `Observed requirement counts: ${parts.join(", ")} (repeats absorbed; not a divergence)`,
    );
  }
  if (result.locations.length > 0) {
    lines.push("Location:");
    for (const loc of result.locations) {
      lines.push(`  ${loc.path}:${loc.startLine}-${loc.endLine}`);
    }
  } else if (result.locationAbsence) {
    lines.push(
      `Location: ${result.locationAbsence.verdict} — ${result.locationAbsence.reason}`,
    );
  }
  if (result.processContext.length > 0) {
    lines.push("Process context (D8 mechanized subset):");
    for (const finding of result.processContext) {
      lines.push(
        `  ${finding.code}${finding.findingId ? ` [${finding.findingId}]` : ""}${finding.message ? ` — ${finding.message}` : ""}`,
      );
    }
  }
  if (result.flake) {
    lines.push(`Flake: ${result.flake.verdict} — ${result.flake.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Exhaustive list of review codes excluded from localization (for table-driven tests). */
export function excludedReviewCodesForLocalization(): string[] {
  return allReviewCodes().filter((code) => !isAdmissibleLocalizationReviewCode(code));
}

/** Sanity: admissible set is subset of catalog and closed by name. */
export function assertAdmissibilityClosedByName(): void {
  for (const code of ADMISSIBLE_REVIEW_CODES) {
    if (!isReviewIssueCode(code)) {
      throw new Error(`admissible code ${code} is not a review.* code`);
    }
  }
}
