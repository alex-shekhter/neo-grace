/**
 * Deterministic failure localization (D8, Phase 7 / A41–A43).
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

export type Divergence = {
  index: number;
  expected: string | undefined;
  observed: string | undefined;
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
   * First divergent index, or null when sequences agree or when own+foreign are both empty
   * (A43.1 — zero marker evidence is absence, not divergence at 0).
   * Suppressed when flake is flaky (D8 / corr 98).
   */
  divergence: Divergence | null;
  /** True when a flaky fail→pass pair suppressed a causal divergence claim. */
  divergenceSuppressed?: boolean;
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
 * firstDivergentBlock — pure comparator (D8 / §7.4).
 * Seven axes: index 0, mid, end, observed shorter, observed longer, repeated (via longer), identical.
 */
export function firstDivergentBlock(
  expected: readonly string[],
  observed: readonly string[],
): Divergence | null {
  const max = Math.max(expected.length, observed.length);
  for (let i = 0; i < max; i += 1) {
    if (expected[i] !== observed[i]) {
      return {
        index: i,
        expected: expected[i],
        observed: observed[i],
      };
    }
  }
  return null;
}

/**
 * Parse observed markers from a log against a declared alphabet.
 *
 * Ground (A43.2): textual presence of declared markers, **at most one count per line**,
 * lines in file order. A line that mentions the marker twice is one hit (description, not
 * two emissions). Across lines, every line that contains a marker contributes once —
 * repeated emission on separate lines still reaches the observed-longer axis (A42.6).
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
 * Build a flake pair from durable attempt events (ledger∪loose) for a change (A43.3 / corr 110).
 * Uses the most recent fail→pass pair that both carry write evidence, optionally scoped to a task.
 * Returns null when no suitable pair exists (caller reports no flake field, not AbsenceValue — flag was asked).
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

function findLatestFailPassPair(events: LooseEvent[]): FlakePair | null {
  const ordered = [...events].sort((a, b) => a.id - b.id);
  let latest: FlakePair | null = null;
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const earlier = ordered[i]!;
    const later = ordered[i + 1]!;
    if (earlier.task !== later.task) continue;
    const ep = readAttemptPayload(earlier);
    const lp = readAttemptPayload(later);
    if (ep.outcome !== "fail" || lp.outcome !== "pass") continue;
    if (!ep.writeEvidence || !lp.writeEvidence) continue;
    latest = {
      earlier: { outcome: "fail", writeEvidence: ep.writeEvidence },
      later: { outcome: "pass", writeEvidence: lp.writeEvidence },
    };
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

  // own empty + foreign non-empty: divergence at 0 stands — log demonstrably carries markers.
  // own non-empty: normal compare.
  const divergence = firstDivergentBlock(verification.requiredLogMarkers, observed);
  base.divergence = divergence;

  if (divergence) {
    const markerForLocation = divergence.expected ?? divergence.observed;
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
    lines.push(
      `First divergent block: index ${result.divergence.index}`
        + ` expected=${JSON.stringify(result.divergence.expected ?? null)}`
        + ` observed=${JSON.stringify(result.divergence.observed ?? null)}`,
    );
  } else if (!result.absence) {
    lines.push("First divergent block: (none — sequences agree; failure is elsewhere)");
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
