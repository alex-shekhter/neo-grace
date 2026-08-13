import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "../artifact/paths";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { PATTERNS } from "../test-support/defect-corpus";
import { allGateCodes, GATE_CATALOG } from "../gates/catalog";
import { allReviewCodes, guideFor, REVIEW_CATALOG } from "../review/catalog";
import { lintGraceProject } from "./core";
import {
  classifyIssueCode,
  getExactLintIssueGuide,
  getLintIssueGuide,
  getLintIssueGuideResolution,
  isEmittableIssueCode,
  listAbsenceCatalogCodes,
  listExactGuideCodes,
  withLintIssueGuide,
  type DefectPatternId,
  type LintIssueGuideResolution,
} from "./catalog";
import type { LintIssue } from "./types";

function bare(code: string): LintIssue {
  return { severity: "error", code, file: "x.ts", message: "m" };
}

/**
 * C-TOKEN-INTEGRITY T-005 / C-CURSOR-INTEGRITY T-001 (F10) — enumerate issue-code
 * literals emitted from production src/.
 * Scans issue()/markupIssue()/guideIssue() call sites, makeFinding(code, …)
 * positional form (review/core.ts), and severity+code object forms.
 * Bound expansions of known dynamic emitters are listed explicitly (not guessed).
 */
function collectEmittedIssueCodes(srcRoot: string): string[] {
  const codes = new Set<string>();
  const skipFiles = new Set([
    path.join(srcRoot, "lint/catalog.ts"),
    path.join(srcRoot, "gates/catalog.ts"),
    path.join(srcRoot, "review/catalog.ts"),
  ]);
  const codeLit = /["']([a-z]+(?:\.[a-z0-9][a-z0-9._-]*)+)["']/g;
  const litArg = /\b(?:issue|markupIssue|guideIssue)\(\s*["'](?:error|warning|info)["']\s*,\s*["']([a-z][a-z0-9._-]*)["']/;
  const pushArg = /\bpushIssue\(\s*[^,]+,\s*["'](?:error|warning)["']\s*,\s*["']([a-z][a-z0-9._-]*)["']/;
  // F10: makeFinding(code, file, message, …) — first positional string is the code.
  const makeFindingArg = /\bmakeFinding\(\s*["']([a-z][a-z0-9._-]*)["']/;
  const severityCode = /\bseverity:\s*["'](?:error|warning)["']\s*,\s*code:\s*["']([a-z][a-z0-9._-]*)["']/;
  const codeSeverity = /\bcode:\s*["']([a-z][a-z0-9._-]*)["']\s*,\s*severity:\s*["'](?:error|warning)["']/;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "test-support" || entry === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      if (skipFiles.has(full)) continue;
      const text = readFileSync(full, "utf8");
      for (const re of [litArg, pushArg, makeFindingArg, severityCode, codeSeverity]) {
        for (const m of text.matchAll(new RegExp(re.source, "g"))) {
          codes.add(m[1]!);
        }
      }
      // Collect code-like string literals inside issue/markupIssue/guideIssue call spans
      // (covers ternaries and multi-line argument lists).
      for (const m of text.matchAll(/\b(?:issue|markupIssue|guideIssue)\(/g)) {
        let i = m.index! + m[0].length;
        let depth = 1;
        while (i < text.length && depth > 0) {
          const ch = text[i]!;
          if (ch === "(") depth += 1;
          else if (ch === ")") depth -= 1;
          i += 1;
        }
        const span = text.slice(m.index!, i);
        for (const cm of span.matchAll(codeLit)) {
          const code = cm[1]!;
          if (/^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9._-]*)+$/.test(code)) {
            codes.add(code);
          }
        }
      }
      // issues.push({ severity, code, ... }) object form in lint/core and similar
      for (const m of text.matchAll(/\.push\(\s*\{[^}]{0,500}\}/g)) {
        const span = m[0];
        if (!span.includes("code:") || !(span.includes("severity") || span.includes("message") || span.includes("file"))) {
          continue;
        }
        for (const cm of span.matchAll(/code:\s*["']([a-z]+(?:\.[a-z0-9][a-z0-9._-]*)+)["']/g)) {
          codes.add(cm[1]!);
        }
      }
    }
  };
  walk(srcRoot);

  // Bound expansions of dynamic emitters (documented; scanner cannot resolve variables).
  for (const kind of [
    "MustExist", "MustNotExist", "MustOwn", "MustLink", "MustVerify", "MustPassCommand",
    "MustContain", "MustNotContain", "MustMatchPattern", "MustUseToken", "MustNotUseLiteral",
    "MustCoverStates", "MustConform", "MustUphold", "MustPassBudget",
  ]) {
    codes.add(`assertion.${kind}`);
  }
  for (const code of [
    "change.spec-missing-section", "change.spec-duplicate-section",
    "change.plan-missing-section", "change.plan-duplicate-section",
    "change.task-missing-section", "change.task-duplicate-section",
    "projection.graph.duplicate-route", "projection.verification.duplicate-route",
    "projection.graph.unindexed-document", "projection.verification.unindexed-document",
    "artifact.forbidden-status-attribute", "artifact.forbidden-root-attribute",
    "graph.invalid-document-wrapper", "verification.invalid-document-wrapper",
    "design-context.bundle-id-mismatch",
    "analysis.adapter-failed", "analysis.runtime-missing",
    "markup.module-map-mismatch",
    // makeFinding(ATTEMPT_PAIR_FINDING_CODE, …) in review/core.ts — constant, not a string literal
    "review.attempt-pair-identical-tree",
    // makeFinding(WRITE_EVIDENCE_SCOPE_FINDING_CODE, …) — constant, not a string literal
    "review.write-evidence-outside-scope",
  ]) {
    codes.add(code);
  }

  return [...codes].sort();
}

/**
 * Frozen allowlist of production-emitted **lint-namespace** codes that resolve only through
 * PREFIX_GUIDES (or peer emittable surfaces) — generic prose, not an exact guide.
 * Adding a code here is a visible diff; new emissions must take an exact guide instead.
 * C-TOKEN-INTEGRITY T-005: do not put the eight newly-erroring codes on this list.
 * C-CURSOR-INTEGRITY T-001 (F10): review.* and gate.* are **not** on this list — they route
 * to REVIEW_CATALOG / GATE_CATALOG (see hasExactSurfaceGuide). Count is lint-only.
 * Count is not a pin. Authority may shrink when constructed codes graduate to exact guides.
 */
const PREFIX_COVERED_LEGACY_CODES: readonly string[] = [
  // --- analysis.* ---
  "analysis.heuristic-confidence",
  "analysis.heuristic-map-mismatch",
  // --- artifact.* ---
  "artifact.forbidden-root-attribute",
  "artifact.forbidden-status-attribute",
  "artifact.invalid-root-tag",
  "artifact.malformed-semantic-anchor",
  "artifact.missing-grace-version",
  "artifact.semantic-anchor-attribute",
  "artifact.semantic-anchor-has-attributes",
  "artifact.unexpected-root-tag",
  "artifact.unsupported-grace-version",
  // --- assertion.* ---
  "assertion.MustConform",
  "assertion.MustContain",
  "assertion.MustCoverStates",
  "assertion.MustExist",
  "assertion.MustLink",
  "assertion.MustMatchPattern",
  "assertion.MustNotContain",
  "assertion.MustNotExist",
  "assertion.MustNotUseLiteral",
  "assertion.MustOwn",
  "assertion.MustPassBudget",
  "assertion.MustPassCommand",
  "assertion.MustUphold",
  "assertion.MustUseToken",
  "assertion.MustVerify",
  "assertion.change-not-approved",
  "assertion.change-required",
  "assertion.empty-section",
  "assertion.invalid-change-id",
  "assertion.invalid-path",
  "assertion.invalid-section-shape",
  "assertion.invalid-shape",
  "assertion.unknown-kind",
  // --- change.* ---
  "change.applied-plan-missing",
  "change.archive-status-mismatch",
  "change.bundle-id-mismatch",
  "change.duplicate-task-id",
  "change.empty-section",
  "change.invalid-active-status",
  "change.invalid-archive-status",
  "change.invalid-bundle-id",
  "change.invalid-root-tag",
  "change.invalid-status",
  "change.invalid-wrapper",
  "change.missing-status",
  "change.plan-duplicate-section",
  "change.plan-invalid-section-shape",
  "change.plan-missing-section",
  "change.plan-missing-task",
  "change.plan-requires-approved-spec",
  "change.spec-duplicate-section",
  "change.spec-missing-section",
  "change.spec-plan-id-mismatch",
  "change.superseded-replacement-not-found",
  "change.superseded-self-replacement",
  "change.task-duplicate-section",
  "change.task-empty-acceptance",
  "change.task-empty-title",
  "change.task-empty-verification",
  "change.task-missing-section",
  "change.unexpected-file",
  // --- context.* ---
  "context.applicability-duplicate",
  "context.applicability-invalid",
  "context.applicability-missing",
  "context.empty-artifact",
  "context.not-applicable-reason-missing",
  "context.unexpected-root-tag",
  "context.ux-not-applicable-reason-insufficient",
  // gate.* codes route to GATE_CATALOG (C-CURSOR-INTEGRITY T-001 / F10) — not listed here.
  // --- graph.* ---
  "graph.duplicate-module-state",
  "graph.index-invalid-documents-section",
  "graph.invalid-document-wrapper",
  "graph.invalid-module-state",
  // --- markup.* ---
  "markup.duplicate-contract-field",
  "markup.duplicate-marker",
  "markup.invalid-map-mode",
  "markup.invalid-role",
  "markup.mismatched-marker",
  "markup.missing-contract-field",
  "markup.missing-end-marker",
  "markup.missing-module-contract",
  "markup.module-map-forbidden",
  "markup.module-map-mismatch",
  "markup.module-map-missing",
  "markup.overlapping-markers",
  "markup.reversed-marker",
  "markup.role-map-mode-mismatch",
  "markup.summary-item-undescribed",
  // --- project.* ---
  "project.grace3-detected",
  "project.missing-change-directory",
  "project.missing-grace",
  // --- projection.* ---
  "projection.graph.dangling-link",
  "projection.graph.duplicate-anchor",
  "projection.graph.duplicate-document-route",
  "projection.graph.duplicate-route",
  "projection.graph.missing-anchor",
  "projection.graph.nested-anchors",
  "projection.graph.ownership-mismatch",
  "projection.graph.unindexed-document",
  "projection.graph.unlisted-anchor",
  "projection.graph.wrapper-mismatch",
  "projection.index.duplicate-path",
  "projection.index.invalid-path",
  "projection.index.missing-path",
  "projection.verification.dangling-module",
  "projection.verification.duplicate-anchor",
  "projection.verification.duplicate-cwd",
  "projection.verification.duplicate-document-route",
  "projection.verification.duplicate-route",
  "projection.verification.invalid-cwd",
  "projection.verification.invalid-test-file",
  "projection.verification.missing-anchor",
  "projection.verification.missing-module-coverage",
  "projection.verification.nested-anchors",
  "projection.verification.ownership-mismatch",
  "projection.verification.unindexed-document",
  "projection.verification.unlisted-anchor",
  "projection.verification.wrapper-mismatch",
  // --- scope.* ---
  "scope.empty-durable-scope",
  "scope.empty-observed-write-scope",
  "scope.invalid-context-artifact",
  "scope.invalid-durable-shape",
  "scope.invalid-observed-shape",
  "scope.invalid-path",
  "scope.none-with-entries",
  "scope.parallel-durable-overlap",
  "scope.unsupported-glob",
];

/**
 * F10 / C-CURSOR-INTEGRITY T-001 — production-emitted review.* codes without an exact
 * REVIEW_CATALOG guide. makeFinding visibility surfaces these; do not mass-author guides
 * here. New codes from later tasks (e.g. review.attempt-pair-identical-tree from
 * C-SUBSTANTIATION-HONESTY) must get exact REVIEW_CATALOG guides, not a seat on this list.
 *
 * Count: 0 (2026-08-10). All thirteen production review codes already have REVIEW_CATALOG
 * guides; the allowlist exists so a future pre-existing gap is an explicit diff.
 */
const REVIEW_PREFIX_COVERED_LEGACY_CODES: readonly string[] = [
  // (empty — all makeFinding-visible review.* codes have exact REVIEW_CATALOG guides)
];

/**
 * Whether an emitted code has a home on its correct catalog surface (F10 namespace routing).
 * review.* → REVIEW_CATALOG (guideFor); gate.* → GATE_CATALOG; else lint exact / allowlist.
 * Never uses getExactLintIssueGuide for review.* or gate.*.
 */
function hasExactSurfaceGuide(code: string): boolean {
  if (code.startsWith("review.")) {
    return guideFor(code) !== undefined || REVIEW_PREFIX_COVERED_LEGACY_CODES.includes(code);
  }
  if (code.startsWith("gate.")) {
    return Object.prototype.hasOwnProperty.call(GATE_CATALOG, code);
  }
  if (getExactLintIssueGuide(code)) {
    return true;
  }
  return PREFIX_COVERED_LEGACY_CODES.includes(code);
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

describe("catalog exact-guide completeness (C-TOKEN-INTEGRITY T-005 / C-CURSOR-INTEGRITY T-001 F10)", () => {
  const tokenIntegrityCodes = [
    "markup.unparsed-link-token",
    "projection.index.owns-text",
    "projection.index.invalid-owns-child",
    "projection.index.invalid-document-child",
    "ledger.invalid-allocation",
    "ledger.invalid-event",
    "cursor.empty-escalated-task",
    "change.implementation-plan-invalid-child",
  ] as const;

  it("requires every emitted production code to have an exact surface guide or frozen allowlist seat", () => {
    const srcRoot = path.join(import.meta.dir, "..");
    const emitted = collectEmittedIssueCodes(srcRoot);
    expect(emitted.length).toBeGreaterThan(50);

    const lintAllowlist = new Set(PREFIX_COVERED_LEGACY_CODES);
    const reviewAllowlist = new Set(REVIEW_PREFIX_COVERED_LEGACY_CODES);
    const orphaned: string[] = [];
    for (const code of emitted) {
      if (code.startsWith("review.")) {
        // F10: review.* never routes to getExactLintIssueGuide.
        expect(getExactLintIssueGuide(code)).toBeUndefined();
        if (guideFor(code)) {
          expect(reviewAllowlist.has(code)).toBe(false);
          continue;
        }
        if (!reviewAllowlist.has(code)) orphaned.push(code);
        continue;
      }
      if (code.startsWith("gate.")) {
        // F10: gate.* never routes to getExactLintIssueGuide.
        expect(getExactLintIssueGuide(code)).toBeUndefined();
        if (!Object.prototype.hasOwnProperty.call(GATE_CATALOG, code)) {
          orphaned.push(code);
        }
        continue;
      }
      const exact = getExactLintIssueGuide(code);
      if (exact) {
        expect(lintAllowlist.has(code)).toBe(false);
        continue;
      }
      if (!lintAllowlist.has(code)) {
        orphaned.push(code);
      }
    }
    expect(orphaned).toEqual([]);
  });

  it("keeps C-TOKEN-INTEGRITY newly-erroring codes on exact guides, never the allowlist", () => {
    const allowlist = new Set(PREFIX_COVERED_LEGACY_CODES);
    for (const code of tokenIntegrityCodes) {
      expect(getExactLintIssueGuide(code)).toBeDefined();
      expect(allowlist.has(code)).toBe(false);
      expect(classifyIssueCode(code)).toBe("exact");
    }
  });

  it("F10: scanner sees makeFinding positional codes; all review catalog codes are guided", () => {
    const srcRoot = path.join(import.meta.dir, "..");
    const emitted = collectEmittedIssueCodes(srcRoot);
    const reviewEmitted = emitted.filter((c) => c.startsWith("review."));
    // Blind spot closed: makeFinding surface is visible (was zero before T-001).
    // C-SUBSTANTIATION-HONESTY renames attempt-pair code; cardinality stays ≥14.
    expect(reviewEmitted.length).toBeGreaterThanOrEqual(14);
    for (const code of allReviewCodes()) {
      expect(emitted).toContain(code);
      expect(guideFor(code)).toBeDefined();
      expect(getExactLintIssueGuide(code)).toBeUndefined();
      expect(hasExactSurfaceGuide(code)).toBe(true);
    }
  });

  it("F10: review.* emission is not a lint-catalog orphan (namespace routing)", () => {
    // Permanent regression of the F10 probe: a review code without a lint exact guide
    // is still surface-guided via REVIEW_CATALOG — completeness must not demand lint.
    const code = "review.scope-outside-write-scope";
    expect(getExactLintIssueGuide(code)).toBeUndefined();
    expect(guideFor(code)).toBeDefined();
    expect(hasExactSurfaceGuide(code)).toBe(true);
    // C-SUBSTANTIATION-HONESTY: live attempt-pair code in REVIEW_CATALOG (exact guide, not F10 allowlist).
    const registered = "review.attempt-pair-identical-tree";
    expect(getExactLintIssueGuide(registered)).toBeUndefined();
    expect(guideFor(registered)).toBeDefined();
    expect(hasExactSurfaceGuide(registered)).toBe(true);
    expect(REVIEW_PREFIX_COVERED_LEGACY_CODES.includes(registered)).toBe(false);
    expect(guideFor("review.attempt-pair-unsubstantiated")).toBeUndefined();
    // C-DECLARED-WRITES: write-evidence-outside-scope guided (add, not rename).
    const weScope = "review.write-evidence-outside-scope";
    expect(getExactLintIssueGuide(weScope)).toBeUndefined();
    expect(guideFor(weScope)).toBeDefined();
    expect(hasExactSurfaceGuide(weScope)).toBe(true);
    expect(REVIEW_PREFIX_COVERED_LEGACY_CODES.includes(weScope)).toBe(false);
    // A still-uncatalogued review code remains a review-surface orphan, not a lint orphan.
    const future = "review.future-uncatalogued-probe";
    expect(getExactLintIssueGuide(future)).toBeUndefined();
    expect(guideFor(future)).toBeUndefined();
    expect(hasExactSurfaceGuide(future)).toBe(false);
  });

  it("F10 discriminating negative: an unguided lint-namespace code still fails completeness", () => {
    const invented = "lint.cursor-integrity-unguided-probe";
    expect(getExactLintIssueGuide(invented)).toBeUndefined();
    expect(PREFIX_COVERED_LEGACY_CODES.includes(invented)).toBe(false);
    expect(hasExactSurfaceGuide(invented)).toBe(false);
    // Simulate completeness: inventing an emission of this code yields an orphan.
    const orphaned: string[] = [];
    for (const code of [invented]) {
      if (!hasExactSurfaceGuide(code)) orphaned.push(code);
    }
    expect(orphaned).toEqual([invented]);
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

/**
 * AC-COVERAGE-UNIVERSE + AC-COVERAGE-NO-BOILERPLATE (C-EXPLAIN-COVERAGE T-001).
 * Universe is collectEmittedIssueCodes (production emission sites; skips the
 * three catalog files). Residual: a new emission form the scanner does not
 * see is invisible until listed. Predicate binds to the resolution path
 * (which branch produced the guide), not to --explain prose. Family prefix
 * guides pass; remediations of the five change.task-*dependency* codes are
 * a later task, not this predicate.
 */
const SURFACE_SPECIFIC_RESOLUTIONS = new Set<LintIssueGuideResolution>([
  "exact",
  "prefix",
  "review-catalog",
  "gate-catalog",
]);

describe("AC-COVERAGE-NO-BOILERPLATE (C-EXPLAIN-COVERAGE T-001)", () => {
  it("every collectEmittedIssueCodes member resolves via a surface-specific guide path", () => {
    const srcRoot = path.join(import.meta.dir, "..");
    const universe = collectEmittedIssueCodes(srcRoot);
    const fallbackHits = universe.filter((code) => {
      return !SURFACE_SPECIFIC_RESOLUTIONS.has(getLintIssueGuideResolution(code));
    });
    expect(fallbackHits).toEqual([]);
  });

  it("does not put the resolution path on the guide object or lint issue payload", () => {
    const code = "xml.parse";
    const guide = getLintIssueGuide(code);
    const issue = withLintIssueGuide(bare(code));
    expect("resolution" in guide).toBe(false);
    expect("resolution" in issue).toBe(false);
    expect(JSON.stringify(issue)).not.toContain("resolution");
  });
});

/**
 * AC-WIRE-CATALOG-GUIDES (C-EXPLAIN-COVERAGE T-001). Field equality against
 * the catalog objects themselves. Classification stays emittable-uncatalogued;
 * none of these codes is an EXACT_GUIDES key.
 */
describe("AC-WIRE-CATALOG-GUIDES (C-EXPLAIN-COVERAGE T-001)", () => {
  it("copies REVIEW_CATALOG title, explanation, and remediation for every registered review code", () => {
    const reviewCodes = Object.keys(REVIEW_CATALOG);
    expect(reviewCodes).toContain("review.scope-outside-write-scope");
    for (const code of reviewCodes) {
      const catalog = REVIEW_CATALOG[code]!;
      const guide = getLintIssueGuide(code);
      expect(guide.title).toBe(catalog.title);
      expect(guide.explanation).toBe(catalog.explanation);
      expect(guide.remediation).toEqual(catalog.remediation);
      expect(classifyIssueCode(code)).toBe("emittable-uncatalogued");
      expect(getExactLintIssueGuide(code)).toBeUndefined();
    }
  });

  it("copies GATE_CATALOG title, explanation, and remediation for every registered gate code", () => {
    const gateCodes = Object.keys(GATE_CATALOG);
    expect(gateCodes).toContain("gate.apply.no-verdict");
    for (const code of gateCodes) {
      const catalog = GATE_CATALOG[code]!;
      const guide = getLintIssueGuide(code);
      expect(guide.title).toBe(catalog.title);
      expect(guide.explanation).toBe(catalog.explanation);
      expect(guide.remediation).toEqual(catalog.remediation);
      expect(classifyIssueCode(code)).toBe("emittable-uncatalogued");
      expect(getExactLintIssueGuide(code)).toBeUndefined();
    }
  });
});

/**
 * AC-FIX-SHAPE (C-EXPLAIN-COVERAGE T-002). Six plants via lintGraceProject
 * on temp projects. Binding is a closed expected-shape list per code,
 * authored here, asserted against both the emitted issue.message and
 * getLintIssueGuide(code).remediation. Family archive-placement is a
 * required negative. The four siblings must not name invalid's three
 * DependsOn authoring shapes.
 */
const FIX_SHAPE_DEPENDENCY_CODES = [
  "change.task-invalid-dependency",
  "change.task-unknown-dependency",
  "change.task-self-dependency",
  "change.task-dependency-cycle",
  "change.task-duplicate-dependency",
] as const;

const FIX_SHAPE_INVALID_SHAPES = [
  "multi-value text list of T-NNN ids (comma, semicolon, or whitespace)",
  "<Task>T-NNN</Task> children",
  "self-closing <T-NNN /> anchor children",
] as const;

const FIX_SHAPE_EXPECTED: Record<string, readonly string[]> = {
  "change.task-invalid-dependency": FIX_SHAPE_INVALID_SHAPES,
  "change.task-unknown-dependency": ["depends on unknown task"],
  "change.task-self-dependency": ["cannot depend on itself"],
  "change.task-dependency-cycle": ["dependency cycle involving"],
  "change.task-duplicate-dependency": ["repeats dependency"],
  "markup.unparsed-link-token": ["M-*", "DF-*", "V-M-*", "comma, semicolon, or whitespace"],
};

const FAMILY_ARCHIVE_PLACEMENT = "Keep draft and approved bundles";

type DependencyPlantKind = "invalid" | "unknown" | "self" | "cycle" | "duplicate";

function fixtureTask(id: string, dependsOn?: string): string {
  const dep = dependsOn === undefined
    ? "<DependsOn></DependsOn>"
    : `<DependsOn>${dependsOn}</DependsOn>`;
  return `<${id}><Title>Task ${id}</Title>${dep}<AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></${id}>`;
}

function writePlantPlan(root: string, changeId: string, tasksXml: string): void {
  const plan = `<NgraceChangePlan graceVersion="1.0" status="approved"><${changeId}><IntentSummary>Apply the fixture change.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan>${tasksXml}</ImplementationPlan></${changeId}></NgraceChangePlan>`;
  writeFileSync(path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml"), plan);
}

function plantFixShape(kind: DependencyPlantKind | "markup"): {
  code: string;
  issue: LintIssue;
  guide: ReturnType<typeof getLintIssueGuide>;
  firedDependencyCodes: string[];
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-fix-shape-"));
  writeMinimalNgraceProject(root);
  writeChangeBundleFixture(root, {
    changeId: "C-EXAMPLE",
    location: "active",
    specStatus: "approved",
    planStatus: "approved",
  });

  const kindToCode: Record<DependencyPlantKind | "markup", string> = {
    invalid: "change.task-invalid-dependency",
    unknown: "change.task-unknown-dependency",
    self: "change.task-self-dependency",
    cycle: "change.task-dependency-cycle",
    duplicate: "change.task-duplicate-dependency",
    markup: "markup.unparsed-link-token",
  };
  const code = kindToCode[kind];

  if (kind === "markup") {
    const file = path.join(root, "src", "example.ts");
    const text = readFileSync(file, "utf8").replace("LINKS: M-EXAMPLE", "LINKS: M-EXAMPLE, TYPO-BAD");
    writeFileSync(file, text);
  } else {
    const tasks =
      kind === "invalid" ? fixtureTask("T-001", "not-a-task")
      : kind === "unknown" ? fixtureTask("T-001", "T-999")
      : kind === "self" ? fixtureTask("T-001", "T-001")
      : kind === "cycle" ? fixtureTask("T-001", "T-002") + fixtureTask("T-002", "T-001")
      : fixtureTask("T-001") + fixtureTask("T-002", "T-001 T-001");
    writePlantPlan(root, "C-EXAMPLE", tasks);
  }

  const result = lintGraceProject(root);
  const firedDependencyCodes = result.issues
    .map((issue) => issue.code)
    .filter((fired) => (FIX_SHAPE_DEPENDENCY_CODES as readonly string[]).includes(fired));
  const issue = result.issues.find((item) => item.code === code);
  if (!issue) {
    throw new Error(`plant ${kind} did not fire ${code}; codes=${result.issues.map((item) => item.code).join(",")}`);
  }
  return { code, issue, guide: getLintIssueGuide(code), firedDependencyCodes };
}

describe("AC-FIX-SHAPE (C-EXPLAIN-COVERAGE T-002)", () => {
  const plants: Array<{ kind: DependencyPlantKind; code: typeof FIX_SHAPE_DEPENDENCY_CODES[number] }> = [
    { kind: "invalid", code: "change.task-invalid-dependency" },
    { kind: "unknown", code: "change.task-unknown-dependency" },
    { kind: "self", code: "change.task-self-dependency" },
    { kind: "cycle", code: "change.task-dependency-cycle" },
    { kind: "duplicate", code: "change.task-duplicate-dependency" },
  ];

  for (const { kind, code } of plants) {
    it(`binds ${code} remediation to the shapes that plant's emitted message names`, () => {
      const planted = plantFixShape(kind);
      expect(planted.issue.code).toBe(code);
      expect(planted.firedDependencyCodes).toEqual([code]);
      const remediation = planted.guide.remediation.join("\n");
      for (const shape of FIX_SHAPE_EXPECTED[code]!) {
        expect(planted.issue.message).toContain(shape);
        expect(remediation).toContain(shape);
      }
      expect(remediation).not.toContain(FAMILY_ARCHIVE_PLACEMENT);
      if (code !== "change.task-invalid-dependency") {
        for (const shape of FIX_SHAPE_INVALID_SHAPES) {
          expect(remediation).not.toContain(shape);
        }
      }
    });
  }

  it("markup.unparsed-link-token remains the already-green discrimination anchor", () => {
    const planted = plantFixShape("markup");
    expect(planted.issue.code).toBe("markup.unparsed-link-token");
    expect(planted.firedDependencyCodes).toEqual([]);
    const remediation = planted.guide.remediation.join("\n");
    for (const shape of FIX_SHAPE_EXPECTED["markup.unparsed-link-token"]!) {
      expect(planted.issue.message).toContain(shape);
      expect(remediation).toContain(shape);
    }
    expect(planted.guide.explanation).toContain("[,;\\s]+");
  });
});

/** Closed expected-shape list (F43): literal bytes the exact guides must name first. */
const CLARIFICATION_WORKING_FORM_SHAPES = [
  "exactly one self-closing IC-*, INV-*, or AC-* child",
] as const;

const CLARIFICATION_SHAPE_GUIDE_CODES = [
  "change.invalid-clarification",
  "change.invalid-clarification-target",
] as const;

function clarificationGuideTeachingText(code: string): string {
  const exact = getExactLintIssueGuide(code);
  expect(exact).toBeDefined();
  return [exact!.explanation, ...exact!.remediation].join("\n");
}

function assertGuideTeachesWorkingForm(text: string): void {
  const firstShapeAt = Math.min(
    ...CLARIFICATION_WORKING_FORM_SHAPES.map((shape) => {
      const idx = text.indexOf(shape);
      expect(idx).toBeGreaterThanOrEqual(0);
      return idx;
    }),
  );
  const before = text.slice(0, firstShapeAt);
  expect(before).not.toMatch(/target\s+attribute/i);
  expect(before).not.toContain('target="');
  expect(text).not.toMatch(/target\s+attribute/i);
  expect(text).not.toContain('target="');
  expect(text).not.toContain("target='");
}

describe("C-GRAMMAR-SEAM T-001 Clarification-shape exact guides", () => {
  it("change.invalid-clarification and change.invalid-clarification-target exact guides name the child form first", () => {
    for (const code of CLARIFICATION_SHAPE_GUIDE_CODES) {
      expect(classifyIssueCode(code)).toBe("exact");
      assertGuideTeachesWorkingForm(clarificationGuideTeachingText(code));
    }
  });
});
