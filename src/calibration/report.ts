// START_MODULE_CONTRACT
//   PURPOSE: Calibration report over claimedConfidence vs independent adjudicators
//   SCOPE: Join agent-authored confidence to target-assertions outcomes; never gate-consume
//   DEPENDS: none
//   LINKS: M-CALIBRATION
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ADJUDICATOR_TARGET_ASSERTIONS
//   CalibrationAdjudicatorId
//   CalibrationClaimRow
//   CalibrationReport
//   collectCalibrationReport
//   formatCalibrationText
// END_MODULE_MAP

/**
 * Calibration report (D6 condition 4 / Phase 9).
 *
 * Claim side: attempt events that carry claimedConfidence (agent-authored, write-only).
 * Outcome side: evaluateTargetComplete / target assertions — not the attempt's outcome
 * attribute (corr 149). Adjudicator provenance is always recorded (corr 150 / D15).
 *
 * Incomplete epochs (claims still only in loose run/) are excluded as a class.
 * Claims whose adjudicator cannot produce a boolean are pending — never silent fail.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { resolveNgracePaths } from "../artifact/project";
import {
  ANCHOR_PATTERNS,
  type ClaimedConfidence,
  parseClaimedConfidence,
} from "../artifact/types";
import {
  evaluateTargetComplete,
  listLedgerEvents,
  listLooseEvents,
  type LooseEvent,
  resolveChangeBundle,
} from "../grace-cursor";

/** Sole independent adjudicator for labeled pairs in Phase 9 (corr 150). */
export const ADJUDICATOR_TARGET_ASSERTIONS = "target-assertions" as const;

export type CalibrationAdjudicatorId = typeof ADJUDICATOR_TARGET_ASSERTIONS;

export type CalibrationClaimRow = {
  changeId: string;
  taskId: string;
  eventId: number;
  claimedConfidence: ClaimedConfidence;
  /** Agent-authored attempt outcome — recorded for audit, never the join score. */
  attemptOutcome: string | undefined;
  /** Independent adjudicator outcome when included; absent when pending/excluded. */
  adjudicatedOutcome?: "pass" | "fail";
  adjudicator?: CalibrationAdjudicatorId;
  bucket: "included" | "excluded" | "pending";
  /** Why excluded or pending (rule 11). */
  reason?: string;
};

export type CalibrationReport = {
  schemaVersion: "1.0.0";
  tool: "grace-calibration";
  root: string;
  included: number;
  excluded: number;
  pending: number;
  pairs: CalibrationClaimRow[];
  /** Promotion bar: this report never certifies gate consumption. */
  promotionBar:
    | "claimedConfidence informs no gate; held-out calibration per context class is required before any consumer may use it";
  /** Read-aloud summary sentence(s) for the current N. */
  summary: string;
};

function listChangeIds(projectRoot: string): string[] {
  const paths = resolveNgracePaths(projectRoot);
  const ids: string[] = [];
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ANCHOR_PATTERNS.change.test(entry.name)) {
        ids.push(entry.name);
      }
    }
  }
  return ids.sort();
}

function claimFromAttempt(
  event: LooseEvent,
  changeId: string,
  bucket: CalibrationClaimRow["bucket"],
  extras: Partial<CalibrationClaimRow> = {},
): CalibrationClaimRow | undefined {
  const raw = event.attributes.claimedConfidence;
  if (raw === undefined || raw === "") return undefined;
  const parsed = parseClaimedConfidence(raw);
  if (!parsed.ok) {
    // Malformed field: treat as non-claim for the corpus (write path should have rejected).
    return undefined;
  }
  if (event.kind !== "attempt") {
    // Standing rule: only attempt may carry the field. Skip non-attempts if present.
    return undefined;
  }
  return {
    changeId,
    taskId: event.task,
    eventId: event.id,
    claimedConfidence: parsed.value,
    attemptOutcome: event.attributes.outcome,
    bucket,
    ...extras,
  };
}

/**
 * Build the calibration report for a project.
 * Fixture numbers are never invented as live results — only events on disk are joined.
 */
export function collectCalibrationReport(projectRoot: string): CalibrationReport {
  const root = path.resolve(projectRoot);
  const pairs: CalibrationClaimRow[] = [];

  for (const changeId of listChangeIds(root)) {
    let bundlePath: string;
    try {
      bundlePath = resolveChangeBundle(root, changeId);
    } catch {
      continue;
    }

    // Incomplete epoch: claims only in loose run/ → excluded (D6 bias safeguard).
    for (const event of listLooseEvents(bundlePath)) {
      const row = claimFromAttempt(event, changeId, "excluded", {
        reason: "incomplete epoch — claim is still in loose run/ (not folded)",
      });
      if (row) pairs.push(row);
    }

    // Folded ledger claims: join to independent adjudicator.
    const ledgerClaims: CalibrationClaimRow[] = [];
    for (const event of listLedgerEvents(bundlePath)) {
      const row = claimFromAttempt(event, changeId, "pending");
      if (row) ledgerClaims.push(row);
    }
    if (ledgerClaims.length === 0) continue;

    const { complete, completeAbsence } = evaluateTargetComplete(root, changeId);

    for (const row of ledgerClaims) {
      if (complete === true) {
        pairs.push({
          ...row,
          bucket: "included",
          adjudicatedOutcome: "pass",
          adjudicator: ADJUDICATOR_TARGET_ASSERTIONS,
        });
      } else if (complete === false) {
        pairs.push({
          ...row,
          bucket: "included",
          adjudicatedOutcome: "fail",
          adjudicator: ADJUDICATOR_TARGET_ASSERTIONS,
        });
      } else {
        pairs.push({
          ...row,
          bucket: "pending",
          reason:
            completeAbsence?.reason ??
            "target-assertions could not produce a boolean outcome (pending, not fail)",
        });
      }
    }
  }

  pairs.sort((a, b) => {
    const c = a.changeId.localeCompare(b.changeId);
    if (c !== 0) return c;
    return a.eventId - b.eventId;
  });

  const included = pairs.filter((p) => p.bucket === "included").length;
  const excluded = pairs.filter((p) => p.bucket === "excluded").length;
  const pending = pairs.filter((p) => p.bucket === "pending").length;

  return {
    schemaVersion: "1.0.0",
    tool: "grace-calibration",
    root,
    included,
    excluded,
    pending,
    pairs,
    promotionBar:
      "claimedConfidence informs no gate; held-out calibration per context class is required before any consumer may use it",
    summary: buildSummary(included, excluded, pending, pairs),
  };
}

function buildSummary(
  included: number,
  excluded: number,
  pending: number,
  pairs: CalibrationClaimRow[],
): string {
  if (included === 0 && excluded === 0 && pending === 0) {
    return (
      `Calibration report: 0 labeled pairs included, 0 epochs excluded as incomplete, 0 pending. ` +
      `No adjudicated claims with claimedConfidence are available to score. ` +
      `claimedConfidence is not used by any gate.`
    );
  }

  if (included === 0) {
    const parts = [
      `Calibration report: 0 labeled pairs included, ${excluded} excluded as incomplete, ${pending} pending.`,
    ];
    if (pending > 0) {
      parts.push(
        `Pending claims await an independent adjudicator outcome (target-assertions); they are not scored as fail.`,
      );
    }
    if (excluded > 0) {
      parts.push(`Excluded claims sit in incomplete (unfolder) epochs.`);
    }
    parts.push(`claimedConfidence is not used by any gate. No rate table — N included is 0.`);
    return parts.join(" ");
  }

  if (included === 1) {
    const row = pairs.find((p) => p.bucket === "included")!;
    return (
      `Calibration report: 1 labeled pair included, ${excluded} excluded, ${pending} pending. ` +
      `Pair: ${row.changeId} ${row.taskId} event ${row.eventId} claimed=${row.claimedConfidence} ` +
      `adjudicated=${row.adjudicatedOutcome} adjudicator=${row.adjudicator}. ` +
      `One observation is not a calibration claim; no percentage is reported. ` +
      `claimedConfidence is not used by any gate.`
    );
  }

  // N small or larger: counts only — descriptive, not a self-certified calibration.
  const byLevel: Record<string, { pass: number; fail: number }> = {};
  for (const row of pairs.filter((p) => p.bucket === "included")) {
    const key = row.claimedConfidence;
    byLevel[key] ??= { pass: 0, fail: 0 };
    if (row.adjudicatedOutcome === "pass") byLevel[key]!.pass += 1;
    else byLevel[key]!.fail += 1;
  }
  const buckets = Object.keys(byLevel)
    .sort()
    .map((level) => {
      const b = byLevel[level]!;
      return `${level}: pass=${b.pass} fail=${b.fail}`;
    })
    .join("; ");
  return (
    `Calibration report: ${included} labeled pairs included, ${excluded} excluded, ${pending} pending. ` +
    `Counts by claimed level (descriptive, not a calibration claim): ${buckets}. ` +
    `Adjudicator for all included pairs: ${ADJUDICATOR_TARGET_ASSERTIONS}. ` +
    `claimedConfidence is not used by any gate.`
  );
}

/** Text form for doctor and CLI. */
export function formatCalibrationText(report: CalibrationReport): string {
  const lines = [
    "Calibration",
    "-".repeat(12),
    report.summary,
    `  included: ${report.included}`,
    `  excluded (incomplete epochs): ${report.excluded}`,
    `  pending (no adjudicator outcome yet): ${report.pending}`,
    `  promotion: ${report.promotionBar}`,
  ];
  if (report.pairs.length > 0) {
    lines.push("  pairs:");
    for (const row of report.pairs) {
      const adj =
        row.bucket === "included"
          ? ` adjudicated=${row.adjudicatedOutcome} adjudicator=${row.adjudicator}`
          : row.reason
            ? ` reason=${row.reason}`
            : "";
      lines.push(
        `    - ${row.changeId} ${row.taskId}#${row.eventId} claimed=${row.claimedConfidence} ` +
          `bucket=${row.bucket}${adj}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
