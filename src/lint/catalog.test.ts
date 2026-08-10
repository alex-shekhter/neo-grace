import { describe, expect, it } from "bun:test";

import { PATTERNS } from "../test-support/defect-corpus";
import { allGateCodes } from "../gates/catalog";
import { allReviewCodes } from "../review/catalog";
import {
  classifyIssueCode,
  getExactLintIssueGuide,
  getLintIssueGuide,
  isEmittableIssueCode,
  listAbsenceCatalogCodes,
  listExactGuideCodes,
  withLintIssueGuide,
  type DefectPatternId,
} from "./catalog";
import type { LintIssue } from "./types";

function bare(code: string): LintIssue {
  return { severity: "error", code, file: "x.ts", message: "m" };
}

describe("catalog issueClass (A5.1 route 2, A6.1)", () => {
  it("DefectPatternId stays in sync with D4 PATTERNS (A7.3 §1)", () => {
    // catalog.ts duplicates the union (invariant 7); this pins the two vocabularies.
    const catalogPatterns = [
      "confidently-wrong",
      "self-referential-comparison",
      "regex-over-structure",
      "zero-or-more-swallow",
      "unthreaded-construct",
    ] as const satisfies readonly DefectPatternId[];
    expect([...catalogPatterns].sort()).toEqual([...PATTERNS].sort());
  });

  it("classifies the three shipped absence codes from exact entries", () => {
    expect(listAbsenceCatalogCodes()).toEqual([
      "analysis.no-adapter",
      "analysis.runtime-missing",
      "assertion.command-not-evaluated",
    ]);
    for (const code of listAbsenceCatalogCodes()) {
      const guided = withLintIssueGuide(bare(code));
      expect(guided.issueClass).toBe("absence");
      const exact = getExactLintIssueGuide(code);
      expect(exact?.derivedFrom || exact?.proposedBy).toBeTruthy();
    }
  });

  it("does not classify analysis.adapter-failed as absence (A3.2 §1 ternary defect branch)", () => {
    expect(withLintIssueGuide(bare("analysis.adapter-failed")).issueClass).toBeUndefined();
    expect(getExactLintIssueGuide("analysis.adapter-failed")?.issueClass).toBeUndefined();
  });

  it("does not classify non-absence assertion.* codes via the prefix guide (A6.1 §2)", () => {
    for (const code of [
      "assertion.MustExist",
      "assertion.MustVerify",
      "assertion.invalid-pattern",
      "assertion.budget-no-match",
      "assertion.change-required",
    ]) {
      const guided = withLintIssueGuide(bare(code));
      expect(guided.issueClass).toBeUndefined();
    }
  });

  it("leaves uncatalogued codes without issueClass (A6.1 §3 defect default)", () => {
    expect(withLintIssueGuide(bare("future.unknown-code")).issueClass).toBeUndefined();
  });

  it("strips a caller-supplied issueClass when the exact entry has none", () => {
    const guided = withLintIssueGuide({
      ...bare("assertion.MustExist"),
      issueClass: "absence",
    });
    expect(guided.issueClass).toBeUndefined();
  });

  it("registers markup.near-miss-marker as a defect with justification, not absence (A8)", () => {
    const exact = getExactLintIssueGuide("markup.near-miss-marker");
    expect(exact).toBeDefined();
    expect(exact!.issueClass).toBeUndefined();
    expect(exact!.derivedFrom).toBeTruthy();
    expect(exact!.proposedBy).toBe("regex-over-structure");
    expect(withLintIssueGuide(bare("markup.near-miss-marker")).issueClass).toBeUndefined();
  });

  it("registers markup.unparsed-link-token (C-TOKEN-INTEGRITY T-001 / P0.2)", () => {
    const exact = getExactLintIssueGuide("markup.unparsed-link-token");
    expect(exact).toBeDefined();
    expect(exact!.title).toMatch(/unparsed|unrecognized|token/i);
    expect(exact!.explanation).toMatch(/LINKS|DEPENDS/);
    expect(exact!.explanation).toContain("[,;\\s]+");
    expect(exact!.remediation.length).toBeGreaterThan(0);
    // Silent free-text DEPENDS is no longer documented as ignored.
    expect(exact!.explanation).not.toMatch(/free-text.*ignored/i);
    expect(withLintIssueGuide(bare("markup.unparsed-link-token")).issueClass).toBeUndefined();
    expect(isEmittableIssueCode("markup.unparsed-link-token")).toBe(true);
  });

  it("registers C-TOKEN-INTEGRITY T-003/T-004 newly-erroring codes", () => {
    const codes = [
      "projection.index.owns-text",
      "projection.index.invalid-owns-child",
      "projection.index.invalid-document-child",
      "ledger.invalid-allocation",
      "ledger.invalid-event",
      "cursor.empty-escalated-task",
      "change.implementation-plan-invalid-child",
    ];
    for (const code of codes) {
      const exact = getExactLintIssueGuide(code);
      expect(exact).toBeDefined();
      expect(exact!.title.length).toBeGreaterThan(0);
      expect(exact!.explanation.length).toBeGreaterThan(0);
      expect(exact!.remediation.length).toBeGreaterThan(0);
      expect(isEmittableIssueCode(code)).toBe(true);
    }
  });

  it("registers all twelve ledger.* and cursor.* codes as defects with justification (A11.3)", () => {
    const codes = [
      "ledger.invalid-root-tag",
      "ledger.invalid-change-id",
      "ledger.bundle-id-mismatch",
      "ledger.non-monotonic-epoch",
      "ledger.reordered-epoch",
      "ledger.event-outside-allocation",
      "ledger.range-hole",
      "ledger.range-unterminated",
      "cursor.invalid-root-tag",
      "cursor.invalid-change-id",
      "cursor.bundle-id-mismatch",
      "cursor.unknown-task",
    ];
    for (const code of codes) {
      const exact = getExactLintIssueGuide(code);
      expect(exact).toBeDefined();
      expect(exact!.issueClass).toBeUndefined();
      expect(exact!.derivedFrom).toBeTruthy();
      expect(exact!.proposedBy).toBeTruthy();
      expect(withLintIssueGuide(bare(code)).issueClass).toBeUndefined();
    }
  });
});

describe("lint --explain honesty (Phase 11 / A76 corr 189, 202)", () => {
  it("classifies exact catalogue entries as exact", () => {
    expect(classifyIssueCode("ledger.invalid-root-tag")).toBe("exact");
    expect(getLintIssueGuide("ledger.invalid-root-tag").explanation).toContain("run-ledger.xml");
    expect(getLintIssueGuide("ledger.invalid-root-tag").explanation).not.toMatch(/signals drift/i);
  });

  it("classifies review.* and gate.* without exact entries as emittable-uncatalogued, never drift", () => {
    expect(classifyIssueCode("review.scope-outside-write-scope")).toBe("emittable-uncatalogued");
    expect(classifyIssueCode("gate.apply.no-verdict")).toBe("emittable-uncatalogued");
    for (const code of ["review.scope-outside-write-scope", "gate.apply.no-verdict", "health.missing-verification"]) {
      const guide = getLintIssueGuide(code);
      expect(guide.explanation).not.toMatch(/signals drift/i);
      expect(isEmittableIssueCode(code)).toBe(true);
    }
  });

  it("classifies garbage strings as unknown and never claims drift", () => {
    expect(classifyIssueCode("not.a.real.code")).toBe("unknown");
    expect(isEmittableIssueCode("not.a.real.code")).toBe(false);
    const guide = getLintIssueGuide("not.a.real.code");
    expect(guide.explanation).toMatch(/does not emit/i);
    expect(guide.explanation).not.toMatch(/signals drift/i);
  });

  it("pins every exact, review, and gate catalogue code into the emittable union (corr 202)", () => {
    for (const code of listExactGuideCodes()) {
      expect(isEmittableIssueCode(code)).toBe(true);
      expect(classifyIssueCode(code)).toBe("exact");
    }
    for (const code of allReviewCodes()) {
      expect(isEmittableIssueCode(code)).toBe(true);
    }
    for (const code of allGateCodes()) {
      expect(isEmittableIssueCode(code)).toBe(true);
    }
  });
});
