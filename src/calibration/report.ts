// START_MODULE_CONTRACT
//   PURPOSE: Calibration report over claimedConfidence vs independent adjudicators
//   SCOPE: Join agent-authored confidence to stored fold-time target-assertions outcomes
//   DEPENDS: none
//   LINKS: M-CALIBRATION
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ADJUDICATOR_TARGET_ASSERTIONS
//   CalibrationAdjudicatorId
//   CalibrationClaimSummary
//   CalibrationPairRow
//   CalibrationReport
//   collectCalibrationReport
//   formatCalibrationText
// END_MODULE_MAP

/**
 * Calibration report (D6 condition 4 / Phase 9 / A59 corr 155–156).
 *
 * Unit of a labeled pair: **one folded epoch that was adjudicated at fold time**
 * (CalibrationAdjudication), not one attempt. Multiple claimedConfidence attempts in
 * the same epoch are claims summarized on that single pair.
 *
 * Labels are **stored** at fold (evaluateTargetComplete once) and never recomputed
 * at report time — a corpus whose labels move is not a corpus.
 *
 * Incomplete epochs (claims still only in loose run/) are excluded as a class.
 * Stored pending stays pending; never silent-fail.
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
  listLedgerCalibrationEpochs,
  listLooseEvents,
  resolveChangeBundle,
  type LooseEvent,
} from "../grace-cursor";

/** Sole independent adjudicator for labeled pairs in Phase 9. */
export const ADJUDICATOR_TARGET_ASSERTIONS = "target-assertions" as const;

export type CalibrationAdjudicatorId = typeof ADJUDICATOR_TARGET_ASSERTIONS;

export type CalibrationClaimSummary = {
  eventId: number;
  taskId: string;
  claimedConfidence: ClaimedConfidence;
  /** Agent-authored attempt outcome — audit only, never the join score. */
  attemptOutcome: string | undefined;
};

/**
 * One labeled unit: one change-epoch with fold-time adjudication (or pending/excluded).
 * claimCount may be >1; included count is always one per such epoch.
 */
export type CalibrationPairRow = {
  changeId: string;
  epoch: number;
  claimCount: number;
  claims: CalibrationClaimSummary[];
  adjudicatedOutcome?: "pass" | "fail";
  adjudicator?: CalibrationAdjudicatorId;
  adjudicatedAt?: "fold";
  bucket: "included" | "excluded" | "pending";
  reason?: string;
};

export type CalibrationReport = {
  schemaVersion: "1.0.0";
  tool: "grace-calibration";
  root: string;
  /** Folded epochs with stored pass|fail adjudication. */
  included: number;
  /** Incomplete epochs (loose run/) that still hold claims. */
  excluded: number;
  /** Folded epochs with stored pending, or claims without stored adjudication. */
  pending: number;
  pairs: CalibrationPairRow[];
  promotionBar:
    | "claimedConfidence informs no gate; held-out calibration per context class is required before any consumer may use it";
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

function claimSummaryFromEvent(event: LooseEvent): CalibrationClaimSummary | undefined {
  const raw = event.attributes.claimedConfidence;
  if (raw === undefined || raw === "") return undefined;
  const parsed = parseClaimedConfidence(raw);
  if (!parsed.ok) return undefined;
  if (event.kind !== "attempt") return undefined;
  return {
    eventId: event.id,
    taskId: event.task,
    claimedConfidence: parsed.value,
    attemptOutcome: event.attributes.outcome,
  };
}

/**
 * Build the calibration report. Reads only stored fold-time adjudications —
 * never calls evaluateTargetComplete (corr 156).
 */
export function collectCalibrationReport(projectRoot: string): CalibrationReport {
  const root = path.resolve(projectRoot);
  const pairs: CalibrationPairRow[] = [];

  for (const changeId of listChangeIds(root)) {
    let bundlePath: string;
    try {
      bundlePath = resolveChangeBundle(root, changeId);
    } catch {
      continue;
    }

    // Incomplete epoch: claims only in loose run/ → one excluded unit per open epoch with claims.
    const looseClaims = listLooseEvents(bundlePath)
      .map(claimSummaryFromEvent)
      .filter((c): c is CalibrationClaimSummary => c !== undefined);
    if (looseClaims.length > 0) {
      pairs.push({
        changeId,
        epoch: 0,
        claimCount: looseClaims.length,
        claims: looseClaims,
        bucket: "excluded",
        reason: "incomplete epoch — claims still in loose run/ (not folded); no durable adjudication yet",
      });
    }

    // Folded epochs: only stored CalibrationAdjudication is evidence (corr 155–156).
    for (const epoch of listLedgerCalibrationEpochs(bundlePath, changeId)) {
      const claims = epoch.claims
        .map(claimSummaryFromEvent)
        .filter((c): c is CalibrationClaimSummary => c !== undefined);

      if (!epoch.adjudication) {
        // Pre-round-2 ledger or fold without adjudication path: not recomputed.
        if (claims.length === 0) continue;
        pairs.push({
          changeId,
          epoch: epoch.epoch,
          claimCount: claims.length,
          claims,
          bucket: "pending",
          reason:
            "no CalibrationAdjudication stored at fold; labels are never recomputed at report time",
        });
        continue;
      }

      const adj = epoch.adjudication;
      const claimCount = Math.max(adj.claimCount, claims.length);
      if (adj.outcome === "pass" || adj.outcome === "fail") {
        pairs.push({
          changeId,
          epoch: epoch.epoch,
          claimCount,
          claims,
          adjudicatedOutcome: adj.outcome,
          adjudicator: ADJUDICATOR_TARGET_ASSERTIONS,
          adjudicatedAt: "fold",
          bucket: "included",
        });
      } else {
        pairs.push({
          changeId,
          epoch: epoch.epoch,
          claimCount,
          claims,
          adjudicator: ADJUDICATOR_TARGET_ASSERTIONS,
          adjudicatedAt: "fold",
          bucket: "pending",
          reason:
            adj.reason ??
            "target-assertions could not produce a boolean at fold (pending, not fail)",
        });
      }
    }
  }

  pairs.sort((a, b) => {
    const c = a.changeId.localeCompare(b.changeId);
    if (c !== 0) return c;
    return a.epoch - b.epoch;
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

function formatClaimsBrief(claims: CalibrationClaimSummary[]): string {
  if (claims.length === 0) return "(no claim detail)";
  return claims
    .map((c) => `${c.taskId}#${c.eventId}=${c.claimedConfidence}`)
    .join(", ");
}

function buildSummary(
  included: number,
  excluded: number,
  pending: number,
  pairs: CalibrationPairRow[],
): string {
  if (included === 0 && excluded === 0 && pending === 0) {
    return (
      `Calibration report: 0 labeled pairs included, 0 epochs excluded as incomplete, 0 pending. ` +
      `No adjudicated claims with claimedConfidence are available to score. ` +
      `A labeled pair is one folded epoch adjudicated at fold time (not one attempt). ` +
      `claimedConfidence is not used by any gate.`
    );
  }

  if (included === 0) {
    const parts = [
      `Calibration report: 0 labeled pairs included, ${excluded} excluded as incomplete, ${pending} pending.`,
    ];
    if (pending > 0) {
      parts.push(
        `Pending epochs await a stored fold-time adjudication or still lack a boolean target-assertions outcome; they are not scored as fail.`,
      );
    }
    if (excluded > 0) {
      parts.push(`Excluded units are incomplete (unfolder) epochs that still hold claims.`);
    }
    parts.push(
      `A labeled pair is one folded epoch adjudicated at fold time. claimedConfidence is not used by any gate. No rate table — N included is 0.`,
    );
    return parts.join(" ");
  }

  if (included === 1) {
    const row = pairs.find((p) => p.bucket === "included")!;
    return (
      `Calibration report: 1 labeled pair included, ${excluded} excluded, ${pending} pending. ` +
      `Pair: ${row.changeId} Epoch-${row.epoch} adjudicated=${row.adjudicatedOutcome} ` +
      `adjudicator=${row.adjudicator} adjudicatedAt=${row.adjudicatedAt} ` +
      `claims(${row.claimCount}): ${formatClaimsBrief(row.claims)}. ` +
      `One observation is not a calibration claim; no percentage is reported. ` +
      `claimedConfidence is not used by any gate.`
    );
  }

  const byOutcome: Record<string, number> = {};
  for (const row of pairs.filter((p) => p.bucket === "included")) {
    const key = row.adjudicatedOutcome ?? "unknown";
    byOutcome[key] = (byOutcome[key] ?? 0) + 1;
  }
  const outcomePart = Object.keys(byOutcome)
    .sort()
    .map((k) => `${k}=${byOutcome[k]}`)
    .join(", ");
  return (
    `Calibration report: ${included} labeled pairs included (one per fold-adjudicated epoch), ` +
    `${excluded} excluded, ${pending} pending. Outcomes (descriptive, not a calibration claim): ${outcomePart}. ` +
    `Adjudicator: ${ADJUDICATOR_TARGET_ASSERTIONS} at fold. claimedConfidence is not used by any gate.`
  );
}

/** Text form for doctor and CLI. */
export function formatCalibrationText(report: CalibrationReport): string {
  const lines = [
    "Calibration",
    "-".repeat(12),
    report.summary,
    `  included (fold-adjudicated epochs): ${report.included}`,
    `  excluded (incomplete epochs): ${report.excluded}`,
    `  pending (no durable boolean outcome): ${report.pending}`,
    `  promotion: ${report.promotionBar}`,
  ];
  if (report.pairs.length > 0) {
    lines.push("  pairs:");
    for (const row of report.pairs) {
      if (row.bucket === "included") {
        lines.push(
          `    - ${row.changeId} Epoch-${row.epoch} bucket=included adjudicated=${row.adjudicatedOutcome} ` +
            `adjudicator=${row.adjudicator} adjudicatedAt=${row.adjudicatedAt} ` +
            `claims(${row.claimCount}): ${formatClaimsBrief(row.claims)}`,
        );
      } else {
        lines.push(
          `    - ${row.changeId} Epoch-${row.epoch || "open"} bucket=${row.bucket} ` +
            `claims(${row.claimCount})${row.reason ? ` reason=${row.reason}` : ""}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
