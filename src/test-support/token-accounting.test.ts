import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { minimalTsFixture } from "./fixtures";
import {
  commandOutputBytes,
  packageRoot,
  selectionRatio,
  skillTextLines,
} from "./token-accounting";

describe("token-accounting (D15)", () => {
  it("skillTextLines().total reports the measured SKILL.md line count at HEAD", () => {
    // Phase 2: three skills each gained a four-line <verdicts> block (636 → 648).
    // Phase 3: ngrace-cli cursor surface line + ngrace-execute advance/fold rule (648 → 650).
    // Phase 4: ngrace-execute attempt/budget/escalation rule (650 → 651).
    // Phase 5: gate calls in execute/plan + clarification + reviewer verdict-home note (651 → 674).
    // Phase 6: detachment contract + review-first path in reviewer/execute (674 → 709).
    // Phase 7: ngrace-fix localization path (709 → 715; +6 lines on ngrace-fix only).
    // Phase 7 round 2: capture run stream + ground honesty in ngrace-fix (715 → 720).
    // Phase 7 round 3: requirement/transcript semantics in ngrace-fix (720 → 721).
    // Phase 7 round 4: absent vs out-of-order in ngrace-fix (721 → 723).
    // Phase 8: ngrace-cli context --task/--skills line; execute preflight extended in-place (723 → 724).
    // Phase 9: ngrace-execute claimedConfidence + calibration promotion bar (724 → 728).
    // 6.1.0 docs pass: ngrace-cli gains gate/review/doctor and lint --explain lines (728 → 730).
    // C-EXECUTION-CONTRACT: ngrace-execute <cursor_kinds> protocol block (730 → 779; measured).
    // C-ESCALATION-HONESTY T-003: rewrite ngrace-execute R/D + resume --reason prose first,
    // then re-measure — total stayed 779 (in-place line-neutral rewrite of four budget sites
    // + resume How; not a target written toward). Pin remains exact toBe of that measure.
    const measured = skillTextLines();
    expect(measured.total).toBe(806);
    expect(measured.perSkill["ngrace-fix"]).toBe(32);
    expect(Object.keys(measured.perSkill).length).toBe(16);
    // Sanity: known skills present
    expect(measured.perSkill["ngrace-init"]).toBeGreaterThan(0);
    expect(measured.perSkill["ngrace-migrate"]).toBeGreaterThan(0);
    // References are counted separately so skill-body deltas stay comparable
    expect(measured.referencesTotal).toBeGreaterThan(0);
  });

  it("skillTextLines().totalBytes is UTF-8 byte sum of SKILL.md files (C-CONTRACT-DEBT T-001)", () => {
    // Measured after instrument landed (not written toward):
    //   bun -e 'import { skillTextLines } from "./src/test-support/token-accounting.ts";
    //           console.log(skillTextLines().totalBytes);'
    // → 53771 at C-CONTRACT-DEBT. C-GRAMMAR-SEAM T-004 skill-prose
    //   rewrite moved the UTF-8 sum; re-measured 53864. Line total
    //   stays 779 (frozen semantics; archived reports cite it).
    const measured = skillTextLines();
    expect(measured.total).toBe(806);
    expect(measured.totalBytes).toBe(55106);
    const sumBytes = Object.values(measured.perSkillBytes).reduce((a, b) => a + b, 0);
    expect(sumBytes).toBe(measured.totalBytes);
    expect(Object.keys(measured.perSkillBytes).length).toBe(16);
    expect(Object.keys(measured.perSkillBytes).sort()).toEqual(
      Object.keys(measured.perSkill).sort(),
    );
  });

  it("skillTextLines is deterministic for the same root", () => {
    const a = skillTextLines(packageRoot());
    const b = skillTextLines(packageRoot());
    expect(a).toEqual(b);
  });

  it("commandOutputBytes returns a positive size for lint on a fixture", () => {
    const root = minimalTsFixture();
    const { bytes, exitCode } = commandOutputBytes(["lint"], root);
    expect(exitCode).toBe(0);
    expect(bytes).toBeGreaterThan(0);
  });

  it("commandOutputBytes throws on nonzero exit instead of measuring error text", () => {
    expect(() =>
      commandOutputBytes(["lint", "--path", "/tmp/definitely-missing-ngrace-xyz"], packageRoot()),
    ).toThrow(/exited \d+/);
    expect(() => commandOutputBytes(["not-a-real-subcommand"], packageRoot())).toThrow(/exited \d+/);
  });

  it("selectionRatio is the fraction saved", () => {
    expect(selectionRatio(100, 40)).toBeCloseTo(0.6);
    expect(selectionRatio(100, 100)).toBe(0);
    expect(selectionRatio(0, 0)).toBe(0);
  });

  it("canonical SKILL.md D-numbers are immediately preceded by a plan id", () => {
    const skillsRoot = path.join(packageRoot(), "skills", "ngrace");
    const bare: string[] = [];
    const dNumber = /\bD\d+\b/g;
    for (const skill of readdirSync(skillsRoot).sort()) {
      const skillMd = path.join(skillsRoot, skill, "SKILL.md");
      if (!statSync(skillMd, { throwIfNoEntry: false })?.isFile()) continue;
      const text = readFileSync(skillMd, "utf8");
      for (const match of text.matchAll(dNumber)) {
        const before = text.slice(0, match.index);
        if (!/RM-[A-Z0-9-]+ $/.test(before)) {
          bare.push(`${skill}/SKILL.md:${match[0]}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });

  it("selectionRatio rejects selected outside [0, full] and non-finite inputs", () => {
    expect(() => selectionRatio(10, 11)).toThrow(RangeError);
    expect(() => selectionRatio(10, -1)).toThrow(RangeError);
    // full === 0 still rejects selected > 0 (probe: short-circuit used to skip the range check)
    expect(() => selectionRatio(0, 1)).toThrow(RangeError);
    expect(() => selectionRatio(-1, 0)).toThrow(RangeError);
    expect(() => selectionRatio(Number.NaN, 0)).toThrow(RangeError);
    expect(() => selectionRatio(1, Number.NaN)).toThrow(RangeError);
  });
});
