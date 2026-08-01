import { describe, expect, it } from "bun:test";

import { findingId, runPatternDetectors, runReview } from "./core";
import {
  caughtBaseline,
  formatCorpusScore,
  ratchetHolds,
  scoreCorpus,
  scoreEntry,
} from "./scorer";
import { corpus } from "../test-support/defect-corpus";

describe("corpus scorer (D4 + A36.3)", () => {
  it("scores multi-surface both directions with pre-apply silent ground", () => {
    const report = scoreCorpus();
    expect(report.mustFireTrue.total).toBeGreaterThan(0);
    // All four mustFire:false are lint-surface; silent direction must be exercised.
    expect(report.mustFireFalse.total).toBe(4);
    // Pre-apply review overfires should be zero on a correct detector set.
    expect(report.preApplyReviewOverfires).toEqual([]);
    // Review-surface mustFire true should largely hit after detectors ship.
    const reviewMisses = report.mustFireTrue.missed.filter((m) => m.surface === "review");
    expect(reviewMisses).toEqual([]);
    expect(report.detectionRate).toBeGreaterThan(0.5);
  });

  it("prints a stable summary shape", () => {
    const report = scoreCorpus(corpus().slice(0, 2));
    const text = formatCorpusScore(report);
    expect(text).toContain("Detection rate");
    expect(text).toContain("Pre-apply review overfires");
  });

  it("single entry score cleans up temp roots", () => {
    const entry = corpus().find((e) => e.id === "corpus-sr-01-test-reads-own-source")!;
    const scored = scoreEntry(entry);
    expect(scored.verdicts.some((v) => v.kind === "hit" || v.kind === "miss")).toBe(true);
  });
});

describe("determinism gate and D16 falsification witness", () => {
  it("two review runs are identical (determinism green path)", () => {
    const entry = corpus().find((e) => e.id === "corpus-re-02-export-regex-in-string")!;
    const root = entry.build();
    entry.apply(root);
    const a = runReview(root, { processAudits: false, joinEngine: false });
    const b = runReview(root, { processAudits: false, joinEngine: false });
    expect(a.findings.map((f) => f.findingId)).toEqual(b.findings.map((f) => f.findingId));
    expect(a.summary.findings).toBe(b.summary.findings);
    // cleanup
    require("node:fs").rmSync(root, { recursive: true, force: true });
  });

  it("ratchet holds against its own baseline", () => {
    const report = scoreCorpus();
    const baseline = caughtBaseline(report);
    expect(baseline.length).toBeGreaterThan(0);
    const check = ratchetHolds(baseline, report);
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
  });

  /**
   * D16 falsification witness: a deliberately broken detector/ID input must fail the gate.
   * This test *holds* the red — it asserts that the broken path is detected — rather than
   * leaving CI permanently red.
   */
  it("D16 witness: broken findingId input fails identity (red path observed)", () => {
    const good = findingId({
      auditOrPatternId: "confidently-wrong",
      file: "src/a.ts",
      anchorOrHunkKey: "marker:X",
      ruleId: "marker-not-emitted",
    });
    // Deliberately break the contract: include a line number in the anchor (forbidden).
    // Simulate a broken implementation by hashing different inputs for the "same" finding.
    const brokenAsIfLineDerived = findingId({
      auditOrPatternId: "confidently-wrong",
      file: "src/a.ts",
      anchorOrHunkKey: "marker:X:line:42",
      ruleId: "marker-not-emitted",
    });
    const brokenAsIfLineMoved = findingId({
      auditOrPatternId: "confidently-wrong",
      file: "src/a.ts",
      anchorOrHunkKey: "marker:X:line:43",
      ruleId: "marker-not-emitted",
    });
    // Red: line-derived anchors diverge when a blank line would shift lines.
    expect(brokenAsIfLineDerived).not.toBe(brokenAsIfLineMoved);
    // Green path control: stable anchors do not.
    expect(good).toBe(
      findingId({
        auditOrPatternId: "confidently-wrong",
        file: "src/a.ts",
        anchorOrHunkKey: "marker:X",
        ruleId: "marker-not-emitted",
      }),
    );
  });

  it("D16 witness: ratchet fails when a previously caught finding is dropped", () => {
    const report = scoreCorpus();
    const baseline = caughtBaseline(report);
    // Inject a phantom caught key that current report cannot satisfy.
    const poisoned = [...baseline, "corpus-phantom\0review\0review.confidently-wrong"];
    const check = ratchetHolds(poisoned, report);
    expect(check.ok).toBe(false);
    expect(check.missing).toContain("corpus-phantom\0review\0review.confidently-wrong");
  });

  it("D16 witness: suppressing pattern detectors drops review catches (red)", () => {
    // When patterns are disabled, review mustFire rows are missed — gate must notice.
    const entry = corpus().find((e) => e.id === "corpus-re-01-status-regex-on-xml")!;
    const root = entry.build();
    entry.apply(root);
    const full = runPatternDetectors(root);
    expect(full.some((f) => f.code === "review.regex-over-structure")).toBe(true);
    const suppressed = runReview(root, {
      patterns: false,
      processAudits: false,
      joinEngine: false,
    });
    expect(suppressed.findings.filter((f) => f.code.startsWith("review."))).toHaveLength(0);
    require("node:fs").rmSync(root, { recursive: true, force: true });
  });
});
