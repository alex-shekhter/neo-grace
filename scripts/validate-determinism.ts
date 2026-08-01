#!/usr/bin/env bun
/**
 * D4 determinism + no-regression ratchet gate.
 * Exits non-zero when two review runs diverge or the corpus ratchet would miss a prior catch.
 *
 * Falsification witnesses live in src/review/scorer.test.ts (D16) — this script is the green path.
 */

import { scoreCorpus, caughtBaseline, ratchetHolds, formatCorpusScore } from "../src/review/scorer";
import { runReview } from "../src/review/core";
import { corpus } from "../src/test-support/defect-corpus";
import { rmSync } from "node:fs";

function main(): void {
  // 1) Two-run identity on a defective fixture
  const entry = corpus().find((e) => e.id === "corpus-re-01-status-regex-on-xml");
  if (!entry) {
    console.error("determinism gate: missing corpus-re-01 fixture");
    process.exit(1);
  }
  const root = entry.build();
  try {
    entry.apply(root);
    const a = runReview(root, { processAudits: false, joinEngine: false });
    const b = runReview(root, { processAudits: false, joinEngine: false });
    const idsA = a.findings.map((f) => f.findingId).sort().join(",");
    const idsB = b.findings.map((f) => f.findingId).sort().join(",");
    if (idsA !== idsB || a.summary.findings !== b.summary.findings) {
      console.error("determinism gate FAILED: two runs diverged");
      console.error(" run1", idsA, a.summary.findings);
      console.error(" run2", idsB, b.summary.findings);
      process.exit(1);
    }
    console.log(`determinism: two-run identity ok (${a.summary.findings} findings)`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // 2) Corpus score + self-ratchet (baseline = current catches)
  const report = scoreCorpus();
  console.log(formatCorpusScore(report));
  if (report.preApplyReviewOverfires.length > 0) {
    console.error("determinism gate FAILED: pre-apply review overfires (A36.3)");
    process.exit(1);
  }
  if (report.mustFireFalse.overfired.length > 0) {
    console.error("determinism gate FAILED: mustFire false overfires");
    process.exit(1);
  }
  const reviewMisses = report.mustFireTrue.missed.filter((m) => m.surface === "review");
  if (reviewMisses.length > 0) {
    console.error("determinism gate FAILED: review-surface misses");
    for (const m of reviewMisses) {
      console.error(`  ${m.entryId} ${m.code}`);
    }
    process.exit(1);
  }

  const baseline = caughtBaseline(report);
  const ratchet = ratchetHolds(baseline, report);
  if (!ratchet.ok) {
    console.error("determinism gate FAILED: ratchet regression");
    for (const m of ratchet.missing) console.error(`  ${m}`);
    process.exit(1);
  }
  console.log(`determinism: ratchet ok (${baseline.length} caught keys)`);
  console.log("determinism gate: PASS");
}

main();
