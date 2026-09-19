import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { artifactIsStale, parseJUnit, rankSlowest, type TestMetrics } from "./test-metrics";

const repoRoot = path.resolve(import.meta.dir, "..");
const ARTIFACT = path.join(repoRoot, "test-metrics.json");

function allTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(root, rel))) {
      if (entry === "node_modules" || entry === ".git" || entry === ".ngrace") continue;
      const full = path.join(rel, entry);
      if (statSync(path.join(root, full)).isDirectory()) walk(full);
      else if (entry.endsWith(".test.ts")) out.push(full);
    }
  };
  for (const dir of ["src", "scripts"]) walk(dir);
  return out.sort();
}

describe("C-TEST-TIME-BUDGET-2-3EC1F016 per-test metrics", () => {
  it("the artifact is fresh: every test file once, counts agree, no machine identifier", () => {
    const raw = readFileSync(ARTIFACT, "utf8");
    const metrics = JSON.parse(raw) as TestMetrics;
    // No machine identifier: the artifact has exactly the four declared keys, and the
    // JUnit `hostname` attribute is never parsed (see the parseJUnit guard below).
    expect(Object.keys(metrics).sort()).toEqual(["files", "generated", "schemaVersion", "tests"]);
    const declared = allTestFiles(repoRoot);
    expect(metrics.files.map((f) => f.file).sort()).toEqual(declared);
    expect(metrics.files.reduce((sum, f) => sum + f.tests, 0)).toBe(metrics.tests.length);
  });

  it("a planted slow test moves the emitted ranking (a relation, not a threshold)", () => {
    const metrics: TestMetrics = {
      schemaVersion: "1.0.0",
      generated: "2026-09-17",
      files: [{ file: "x.test.ts", tests: 2, ms: 2000 }],
      tests: [
        { file: "x.test.ts", name: "fast", ms: 1 },
        { file: "x.test.ts", name: "planted", ms: 2000 },
      ],
    };
    expect(rankSlowest(metrics, 1)[0]!.name).toBe("planted");
  });

  it("parseJUnit drops the hostname and sums per file", () => {
    const xml = `<testsuites hostname="some-machine"><testsuite name="a.test.ts"><testcase file="a.test.ts" name="t1" time="0.5"/><testcase file="a.test.ts" name="t2" time="0.25"/></testsuite></testsuites>`;
    const metrics = parseJUnit(xml, "2026-09-17");
    expect(JSON.stringify(metrics)).not.toContain("some-machine");
    expect(metrics.files).toEqual([{ file: "a.test.ts", tests: 2, ms: 750 }]);
  });
});

describe("C-CI-LINT-AND-PLAN-SHAPE-1-3526D6F0 metrics stale gate", () => {
  it("is false when the committed artifact matches the tree and true when it does not", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "test-metrics-stale-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(path.join(root, "src", "a.test.ts"), "import { test, expect } from \"bun:test\"; test(\"a\", () => expect(1).toBe(1));\n");
    writeFileSync(path.join(root, "src", "b.test.ts"), "import { test, expect } from \"bun:test\"; test(\"b\", () => expect(1).toBe(1));\n");
    const outfile = path.join(root, "test-metrics.json");
    const fresh: TestMetrics = {
      schemaVersion: "1.0.0",
      generated: "2026-09-19",
      files: [
        { file: "src/a.test.ts", tests: 1, ms: 1 },
        { file: "src/b.test.ts", tests: 1, ms: 1 },
      ],
      tests: [
        { file: "src/a.test.ts", name: "a", ms: 1 },
        { file: "src/b.test.ts", name: "b", ms: 1 },
      ],
    };
    writeFileSync(outfile, JSON.stringify(fresh));
    expect(artifactIsStale(root, outfile)).toBe(false);

    writeFileSync(outfile, JSON.stringify({ ...fresh, files: [fresh.files[0]!] }));
    expect(artifactIsStale(root, outfile)).toBe(true);

    writeFileSync(outfile, JSON.stringify({ ...fresh, files: [...fresh.files, { file: "src/c.test.ts", tests: 1, ms: 1 }] }));
    expect(artifactIsStale(root, outfile)).toBe(true);

    writeFileSync(outfile, JSON.stringify({ ...fresh, tests: [fresh.tests[0]!] }));
    expect(artifactIsStale(root, outfile)).toBe(true);

    expect(artifactIsStale(root, path.join(root, "absent.json"))).toBe(true);
  });
});
