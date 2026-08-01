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
 * Calibration report (D6 condition 4 / Phase 9 / A59 corr 155–156 / A61 corr 160–161).
 *
 * Unit of a labeled pair: **one folded epoch that was adjudicated at fold time**
 * (CalibrationAdjudication with adjudicatedAt=fold), not one attempt. Multiple
 * claimedConfidence attempts in the same epoch are claims summarized on that single pair.
 *
 * Labels are **stored** at fold (evaluateTargetComplete once) and never recomputed
 * at report time — a corpus whose labels move is not a corpus.
 *
 * Backfilled adjudications (adjudicatedAt=backfill, or restated to backfill) are
 * **excluded from calibration computation** and counted on their own line (A61 corr 161).
 * They remain visible so contaminated history is not silently dropped or silently pooled.
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
  listCalibrationRestatements,
  listLedgerCalibrationEpochs,
  listLooseEvents,
  resolveChangeBundle,
  type CalibrationAdjudicatedAt,
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
 * One labeled unit: one change-epoch with stored adjudication (or pending/excluded).
 * claimCount may be >1; included count is always one per fold-adjudicated epoch.
 */
export type CalibrationPairRow = {
  changeId: string;
  epoch: number;
  claimCount: number;
  claims: CalibrationClaimSummary[];
  adjudicatedOutcome?: "pass" | "fail";
  adjudicator?: CalibrationAdjudicatorId;
  adjudicatedAt?: CalibrationAdjudicatedAt;
  bucket: "included" | "excluded" | "pending" | "backfilled";
  reason?: string;
};

export type CalibrationReport = {
  schemaVersion: "1.0.0";
  tool: "grace-calibration";
  root: string;
  /** Folded epochs with stored pass|fail adjudication written at fold time. */
  included: number;
  /** Incomplete epochs (loose run/) that still hold claims. */
  excluded: number;
  /** Folded epochs with stored pending, or claims without stored adjudication. */
  pending: number;
  /**
   * Pass|fail adjudications that were backfilled (or restated as backfill).
   * Visible, never pooled into included (A61 corr 161).
   */
  backfilled: number;
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
 * never calls evaluateTargetComplete (corr 156). Applies CalibrationRestatements
 * as provenance overrides without mutating archives (A61).
 */
export function collectCalibrationReport(projectRoot: string): CalibrationReport {
  const root = path.resolve(projectRoot);
  const pairs: CalibrationPairRow[] = [];
  const restatements = listCalibrationRestatements(root);
  const restatementByKey = new Map(
    restatements.map((r) => [`${r.changeId}#${r.epoch}`, r] as const),
  );

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
        // Pre-round-2 ledger, unreadable adjudicatedAt, or fold without adjudication path.
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
      // Restatement supersedes stored adjudicatedAt without editing the archive (A61).
      const restatement = restatementByKey.get(`${changeId}#${epoch.epoch}`);
      const adjudicatedAt: CalibrationAdjudicatedAt = restatement
        ? restatement.adjudicatedAt
        : adj.adjudicatedAt;

      if (adj.outcome === "pass" || adj.outcome === "fail") {
        if (adjudicatedAt === "backfill") {
          pairs.push({
            changeId,
            epoch: epoch.epoch,
            claimCount,
            claims,
            adjudicatedOutcome: adj.outcome,
            adjudicator: ADJUDICATOR_TARGET_ASSERTIONS,
            adjudicatedAt: "backfill",
            bucket: "backfilled",
            reason:
              restatement?.reason ??
              "backfilled adjudication — excluded from calibration computation (not scored with fold-time pairs)",
          });
        } else {
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
        }
      } else {
        // pending outcome stays pending regardless of adjudicatedAt (A7.2).
        pairs.push({
          changeId,
          epoch: epoch.epoch,
          claimCount,
          claims,
          adjudicator: ADJUDICATOR_TARGET_ASSERTIONS,
          adjudicatedAt,
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
  const backfilled = pairs.filter((p) => p.bucket === "backfilled").length;

  return {
    schemaVersion: "1.0.0",
    tool: "grace-calibration",
    root,
    included,
    excluded,
    pending,
    backfilled,
    pairs,
    promotionBar:
      "claimedConfidence informs no gate; held-out calibration per context class is required before any consumer may use it",
    summary: buildSummary(included, excluded, pending, backfilled, pairs),
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
  backfilled: number,
  pairs: CalibrationPairRow[],
): string {
  const backfillClause =
    backfilled > 0
      ? ` ${backfilled} backfilled (excluded from computation; adjudicatedAt=backfill).`
      : "";

  if (included === 0 && excluded === 0 && pending === 0 && backfilled === 0) {
    return (
      `Calibration report: 0 labeled pairs included, 0 epochs excluded as incomplete, 0 pending, 0 backfilled. ` +
      `No adjudicated claims with claimedConfidence are available to score. ` +
      `A labeled pair is one folded epoch adjudicated at fold time (not one attempt). ` +
      `claimedConfidence is not used by any gate.`
    );
  }

  if (included === 0) {
    const parts = [
      `Calibration report: 0 labeled pairs included, ${excluded} excluded as incomplete, ${pending} pending, ${backfilled} backfilled.`,
    ];
    if (pending > 0) {
      parts.push(
        `Pending epochs await a stored fold-time adjudication or still lack a boolean target-assertions outcome; they are not scored as fail.`,
      );
    }
    if (excluded > 0) {
      parts.push(`Excluded units are incomplete (unfolder) epochs that still hold claims.`);
    }
    if (backfilled > 0) {
      parts.push(
        `Backfilled pairs carry a stored outcome with adjudicatedAt=backfill; they are visible and excluded from calibration computation.`,
      );
    }
    parts.push(
      `A labeled pair is one folded epoch adjudicated at fold time. claimedConfidence is not used by any gate. No rate table — N included is 0.`,
    );
    return parts.join(" ");
  }

  if (included === 1) {
    const row = pairs.find((p) => p.bucket === "included")!;
    return (
      `Calibration report: 1 labeled pair included, ${excluded} excluded, ${pending} pending, ${backfilled} backfilled. ` +
      `Pair: ${row.changeId} Epoch-${row.epoch} adjudicated=${row.adjudicatedOutcome} ` +
      `adjudicator=${row.adjudicator} adjudicatedAt=${row.adjudicatedAt} ` +
      `claims(${row.claimCount}): ${formatClaimsBrief(row.claims)}.` +
      `${backfillClause} ` +
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
    `${excluded} excluded, ${pending} pending, ${backfilled} backfilled. ` +
    `Outcomes (descriptive, not a calibration claim): ${outcomePart}. ` +
    `Adjudicator: ${ADJUDICATOR_TARGET_ASSERTIONS} at fold.` +
    `${backfillClause} claimedConfidence is not used by any gate.`
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
    `  backfilled (excluded from computation): ${report.backfilled}`,
    `  promotion: ${report.promotionBar}`,
  ];
  if (report.pairs.length > 0) {
    lines.push("  pairs:");
    for (const row of report.pairs) {
      if (row.bucket === "included" || row.bucket === "backfilled") {
        lines.push(
          `    - ${row.changeId} Epoch-${row.epoch} bucket=${row.bucket} adjudicated=${row.adjudicatedOutcome} ` +
            `adjudicator=${row.adjudicator} adjudicatedAt=${row.adjudicatedAt} ` +
            `claims(${row.claimCount}): ${formatClaimsBrief(row.claims)}` +
            (row.reason ? ` reason=${row.reason}` : ""),
        );
      } else {
        lines.push(
          `    - ${row.changeId} Epoch-${row.epoch || "open"} bucket=${row.bucket} ` +
            `claims(${row.claimCount})${row.reason ? ` reason=${row.reason}` : ""}` +
            (row.adjudicatedAt ? ` adjudicatedAt=${row.adjudicatedAt}` : ""),
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
