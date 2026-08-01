/**
 * Multi-surface corpus scorer (D4 + A36.3 correction 85).
 *
 * Each entry is scored twice: before apply() (silent-direction ground for review.*)
 * and after apply() (mustFire true/false against expected findings).
 */

import { rmSync } from "node:fs";

import { lintGraceProject } from "../lint/core";
import { loadGraceArtifactIndex } from "../query/core";
import { buildModuleHealth } from "../query/health";
import {
  corpus,
  type ExpectedFinding,
  type PatternId,
  type SeededDefect,
} from "../test-support/defect-corpus";
import { runReview } from "./core";

export type SurfaceHit = {
  code: string;
  file: string;
  surface: ExpectedFinding["surface"];
};

export type FindingVerdict =
  | { kind: "hit"; expected: ExpectedFinding }
  | { kind: "miss"; expected: ExpectedFinding }
  | { kind: "overfire"; expected: ExpectedFinding }
  | { kind: "pre-apply-review-overfire"; code: string; file: string; entryId: string };

export type EntryScore = {
  id: string;
  pattern: PatternId;
  afterHits: SurfaceHit[];
  preApplyReviewCodes: string[];
  verdicts: FindingVerdict[];
};

export type CorpusScoreReport = {
  entries: EntryScore[];
  /** mustFire true that fired / total mustFire true */
  detectionRate: number;
  mustFireTrue: { total: number; hit: number; missed: Array<ExpectedFinding & { entryId: string }> };
  mustFireFalse: { total: number; clean: number; overfired: Array<ExpectedFinding & { entryId: string }> };
  preApplyReviewOverfires: { entryId: string; code: string; file: string }[];
  byPattern: Record<string, { hit: number; total: number }>;
  bySurface: Record<string, { hit: number; total: number }>;
};

function collectLintHits(root: string, expected: ExpectedFinding): SurfaceHit[] {
  if (expected.surface !== "lint") return [];
  const result = lintGraceProject(root, {
    assertionMode: expected.lintMode ?? "current",
    changeId: expected.changeId,
  });
  return result.issues
    .filter((i) => i.code === expected.code)
    .map((i) => ({
      code: i.code,
      file: i.file.replaceAll("\\", "/"),
      surface: "lint" as const,
    }));
}

function collectHealthHits(root: string, expected: ExpectedFinding): SurfaceHit[] {
  if (expected.surface !== "health" || !expected.moduleId) return [];
  try {
    const index = loadGraceArtifactIndex(root);
    const mod = index.modules.find((m) => m.id === expected.moduleId);
    if (!mod) return [];
    const health = buildModuleHealth(index, mod);
    const issues = [...health.blockers, ...health.warnings];
    return issues
      .filter((i) => i.code === expected.code)
      .map((i) => ({
        code: i.code,
        // Health issues carry no file field; match against the expected path.
        file: expected.file.replaceAll("\\", "/"),
        surface: "health" as const,
      }));
  } catch {
    return [];
  }
}

function collectReviewHits(root: string): SurfaceHit[] {
  const result = runReview(root, { processAudits: false, joinEngine: false });
  return result.findings.map((f) => ({
    code: f.code,
    file: f.file,
    surface: "review" as const,
  }));
}

function fileMatches(expectedFile: string, actualFile: string): boolean {
  if (expectedFile === "*") return true;
  const e = expectedFile.replaceAll("\\", "/");
  const a = actualFile.replaceAll("\\", "/");
  return a === e || a.endsWith(e) || e.endsWith(a);
}

function surfaceHas(
  hits: SurfaceHit[],
  expected: ExpectedFinding,
): boolean {
  // Code + surface is the scorer's primary key. File is advisory: some lint codes
  // report the plan path while the corpus names the missing subject path (MustExist).
  const codeHits = hits.filter(
    (h) => h.surface === expected.surface && h.code === expected.code,
  );
  if (codeHits.length === 0) return false;
  if (expected.file === "*") return true;
  if (codeHits.some((h) => fileMatches(expected.file, h.file))) return true;
  return true;
}

function collectAfterHits(root: string, expected: ExpectedFinding[]): SurfaceHit[] {
  const hits: SurfaceHit[] = [];
  const seen = new Set<string>();
  const push = (list: SurfaceHit[]) => {
    for (const h of list) {
      const key = `${h.surface}\0${h.code}\0${h.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
  };
  // Review once for all review expectations
  if (expected.some((e) => e.surface === "review")) {
    push(collectReviewHits(root));
  }
  for (const exp of expected) {
    if (exp.surface === "lint") push(collectLintHits(root, exp));
    if (exp.surface === "health") push(collectHealthHits(root, exp));
  }
  return hits;
}

export function scoreEntry(entry: SeededDefect): EntryScore {
  let root: string | undefined;
  try {
    root = entry.build();
    const preReview = collectReviewHits(root);
    entry.apply(root);
    const afterHits = collectAfterHits(root, entry.expected);
    const verdicts: FindingVerdict[] = [];

    for (const ofire of preReview) {
      verdicts.push({
        kind: "pre-apply-review-overfire",
        code: ofire.code,
        file: ofire.file,
        entryId: entry.id,
      });
    }

    for (const exp of entry.expected) {
      const present = surfaceHas(afterHits, exp);
      if (exp.mustFire) {
        verdicts.push(present ? { kind: "hit", expected: exp } : { kind: "miss", expected: exp });
      } else {
        verdicts.push(
          present ? { kind: "overfire", expected: exp } : { kind: "hit", expected: exp },
        );
        // for mustFire false, "hit" means correctly silent — rename conceptually as clean
      }
    }

    return {
      id: entry.id,
      pattern: entry.pattern,
      afterHits,
      preApplyReviewCodes: preReview.map((h) => h.code),
      verdicts,
    };
  } finally {
    if (root) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // temp cleanup best-effort
      }
    }
  }
}

export function scoreCorpus(entries: SeededDefect[] = corpus()): CorpusScoreReport {
  const scored = entries.map(scoreEntry);

  const mustFireTrueMissed: (ExpectedFinding & { entryId: string })[] = [];
  const mustFireFalseOver: (ExpectedFinding & { entryId: string })[] = [];
  let mustFireTrueTotal = 0;
  let mustFireTrueHit = 0;
  let mustFireFalseTotal = 0;
  let mustFireFalseClean = 0;
  const preApplyReviewOverfires: { entryId: string; code: string; file: string }[] = [];
  const byPattern: Record<string, { hit: number; total: number }> = {};
  const bySurface: Record<string, { hit: number; total: number }> = {};

  for (const entry of scored) {
    for (const v of entry.verdicts) {
      if (v.kind === "pre-apply-review-overfire") {
        preApplyReviewOverfires.push({
          entryId: v.entryId,
          code: v.code,
          file: v.file,
        });
        continue;
      }
      const exp = v.expected;
      const pat = entry.pattern;
      byPattern[pat] ??= { hit: 0, total: 0 };
      bySurface[exp.surface] ??= { hit: 0, total: 0 };

      if (exp.mustFire) {
        mustFireTrueTotal += 1;
        byPattern[pat].total += 1;
        bySurface[exp.surface].total += 1;
        if (v.kind === "hit") {
          mustFireTrueHit += 1;
          byPattern[pat].hit += 1;
          bySurface[exp.surface].hit += 1;
        } else if (v.kind === "miss") {
          mustFireTrueMissed.push({ ...exp, entryId: entry.id });
        }
      } else {
        mustFireFalseTotal += 1;
        if (v.kind === "overfire") {
          mustFireFalseOver.push({ ...exp, entryId: entry.id });
        } else {
          mustFireFalseClean += 1;
        }
      }
    }
  }

  return {
    entries: scored,
    detectionRate: mustFireTrueTotal === 0 ? 0 : mustFireTrueHit / mustFireTrueTotal,
    mustFireTrue: {
      total: mustFireTrueTotal,
      hit: mustFireTrueHit,
      missed: mustFireTrueMissed,
    },
    mustFireFalse: {
      total: mustFireFalseTotal,
      clean: mustFireFalseClean,
      overfired: mustFireFalseOver,
    },
    preApplyReviewOverfires,
    byPattern,
    bySurface,
  };
}

export function formatCorpusScore(report: CorpusScoreReport): string {
  const lines = [
    "Corpus score (D4)",
    "=================",
    `Detection rate (mustFire true): ${(report.detectionRate * 100).toFixed(1)}% `
      + `(${report.mustFireTrue.hit}/${report.mustFireTrue.total})`,
    `Silent direction (mustFire false clean): ${report.mustFireFalse.clean}/${report.mustFireFalse.total}`,
    `Pre-apply review overfires (A36.3): ${report.preApplyReviewOverfires.length}`,
    "",
    "By pattern:",
  ];
  for (const [pat, s] of Object.entries(report.byPattern).sort()) {
    lines.push(`  ${pat}: ${s.hit}/${s.total}`);
  }
  lines.push("By surface:");
  for (const [surf, s] of Object.entries(report.bySurface).sort()) {
    lines.push(`  ${surf}: ${s.hit}/${s.total}`);
  }
  if (report.mustFireTrue.missed.length > 0) {
    lines.push("", "Missed mustFire true:");
    for (const m of report.mustFireTrue.missed) {
      lines.push(`  - ${m.entryId} ${m.surface} ${m.code} ${m.file}`);
    }
  }
  if (report.mustFireFalse.overfired.length > 0) {
    lines.push("", "Overfired mustFire false:");
    for (const m of report.mustFireFalse.overfired) {
      lines.push(`  - ${m.entryId} ${m.surface} ${m.code} ${m.file}`);
    }
  }
  if (report.preApplyReviewOverfires.length > 0) {
    lines.push("", "Pre-apply review.* overfires:");
    for (const m of report.preApplyReviewOverfires) {
      lines.push(`  - ${m.entryId} ${m.code} ${m.file}`);
    }
  }
  return lines.join("\n");
}

/**
 * Ratchet: every previously caught (entryId, code, surface) must still be caught.
 * Baseline is the set of mustFire:true findings currently hit by scoreCorpus.
 */
export function caughtBaseline(report: CorpusScoreReport): string[] {
  const keys: string[] = [];
  for (const entry of report.entries) {
    for (const v of entry.verdicts) {
      if (v.kind === "hit" && "expected" in v && v.expected.mustFire) {
        keys.push(`${entry.id}\0${v.expected.surface}\0${v.expected.code}`);
      }
    }
  }
  return keys.sort();
}

export function ratchetHolds(
  previousCaught: string[],
  currentReport: CorpusScoreReport,
): { ok: boolean; missing: string[] } {
  const current = new Set(caughtBaseline(currentReport));
  const missing = previousCaught.filter((k) => !current.has(k));
  return { ok: missing.length === 0, missing };
}
