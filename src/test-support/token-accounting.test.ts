import { describe, expect, it } from "bun:test";

import { minimalTsFixture } from "./fixtures";
import {
  commandOutputBytes,
  packageRoot,
  selectionRatio,
  skillTextLines,
} from "./token-accounting";

describe("token-accounting (D15)", () => {
  it("skillTextLines().total reports 709 for SKILL.md files at HEAD", () => {
    // Phase 2: three skills each gained a four-line <verdicts> block (636 → 648).
    // Phase 3: ngrace-cli cursor surface line + ngrace-execute advance/fold rule (648 → 650).
    // Phase 4: ngrace-execute attempt/budget/escalation rule (650 → 651).
    // Phase 5: gate calls in execute/plan + clarification + reviewer verdict-home note (651 → 674).
    // Phase 6: detachment contract + review-first path in reviewer/execute (674 → 709).
    const measured = skillTextLines();
    expect(measured.total).toBe(709);
    expect(Object.keys(measured.perSkill).length).toBe(16);
    // Sanity: known skills present
    expect(measured.perSkill["ngrace-init"]).toBeGreaterThan(0);
    expect(measured.perSkill["ngrace-migrate"]).toBeGreaterThan(0);
    // References are counted separately so skill-body deltas stay comparable
    expect(measured.referencesTotal).toBeGreaterThan(0);
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
