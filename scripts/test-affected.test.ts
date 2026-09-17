import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { selectAffectedTests } from "./test-affected";

const repoRoot = path.resolve(import.meta.dir, "..");
const ALL_TESTS = ["src/gates/core.test.ts", "src/lint/core.test.ts", "scripts/audit-regressions.test.ts"];

function everySpecOrPlan(root: string): string[] {
  const out: string[] = [];
  const changes = path.join(root, ".ngrace/changes");
  for (const location of ["active", "archive"]) {
    const dir = path.join(changes, location);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const bundle = path.join(dir, entry);
      if (!statSync(bundle).isDirectory()) continue;
      for (const file of ["spec.xml", "plan.xml"]) {
        const full = path.join(bundle, file);
        if (existsSync(full)) out.push(full);
      }
    }
  }
  return out;
}

describe("C-TEST-TIME-BUDGET-2-3EC1F016 selective runner", () => {
  it("selects a changed file's test, and falls back to the full suite on an unmapped source", () => {
    const mapped = selectAffectedTests(["src/gates/core.ts"], ALL_TESTS);
    expect(mapped.fallbackToFullSuite).toBe(false);
    expect(mapped.tests).toContain("src/gates/core.test.ts");
    expect(mapped.tests).not.toContain("src/lint/core.test.ts");

    const unmapped = selectAffectedTests(["src/mystery.ts"], ALL_TESTS);
    expect(unmapped.fallbackToFullSuite).toBe(true);
    expect(unmapped.tests).toEqual([...ALL_TESTS].sort());

    const empty = selectAffectedTests([], ALL_TESTS);
    expect(empty.fallbackToFullSuite).toBe(true);
  });

  it("never gates: no aggregate script and no CloseEvidence invokes the runner", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const name of ["validate:ci", "validate:release"]) {
      expect(pkg.scripts[name], name).toContain("bun run test");
      expect(pkg.scripts[name], name).not.toContain("test:affected");
    }
    const offenders: string[] = [];
    for (const file of everySpecOrPlan(repoRoot)) {
      const text = readFileSync(file, "utf8");
      if (/<CloseEvidence>[\s\S]*?test:affected[\s\S]*?<\/CloseEvidence>/.test(text)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
