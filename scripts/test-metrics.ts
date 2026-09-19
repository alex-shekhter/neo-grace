#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Per-test metrics emitter
//   SCOPE: JUnit-derived per-test durations into a committed artifact
//   DEPENDS: none
//   LINKS: [M-RELEASE-AUTOMATION, V-M-RELEASE-AUTOMATION]
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   TestMetrics
//   artifactIsStale
//   parseJUnit
//   rankSlowest
// END_MODULE_MAP
/**
 * Run the suite once, record per-test durations. Informational: no duration is a
 * gate; the regression signal is a regenerated diff. No hostname is written.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type TestMetrics = {
  schemaVersion: "1.0.0";
  generated: string;
  files: Array<{ file: string; tests: number; ms: number }>;
  tests: Array<{ file: string; name: string; ms: number }>;
};

export function parseJUnit(xml: string, generated: string): TestMetrics {
  const files = new Map<string, { tests: number; ms: number }>();
  const tests: TestMetrics["tests"] = [];
  for (const match of xml.matchAll(/<testcase\b[^>]*>/g)) {
    const tag = match[0];
    const file = /\bfile="([^"]*)"/.exec(tag)?.[1] ?? "?";
    const name = /\bname="([^"]*)"/.exec(tag)?.[1] ?? "?";
    const ms = Number(/\btime="([^"]*)"/.exec(tag)?.[1] ?? "0") * 1000;
    const entry = files.get(file) ?? { tests: 0, ms: 0 };
    entry.tests += 1;
    entry.ms += ms;
    files.set(file, entry);
    tests.push({ file, name, ms });
  }
  return {
    schemaVersion: "1.0.0",
    generated,
    files: [...files].map(([file, v]) => ({ file, tests: v.tests, ms: v.ms })).sort((a, b) => a.file.localeCompare(b.file)),
    tests,
  };
}

export function rankSlowest(metrics: TestMetrics, n: number): TestMetrics["tests"] {
  return [...metrics.tests].sort((a, b) => b.ms - a.ms).slice(0, n);
}

function treeTestFiles(root: string): string[] {
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

function sourceCount(root: string, file: string): number {
  return (readFileSync(path.join(root, file), "utf8").match(/(?:^|\s)(?:it|test)\s*\(/g) ?? []).length;
}

/**
 * Staleness of the committed artifact against the tree, by the freshness predicate
 * (`test-metrics.test.ts`): the file list must match the tree walk and the per-file
 * count sum must equal the recorded test count. A fresh artifact is left untouched.
 */
export function artifactIsStale(root: string, outfile: string): boolean {
  if (!existsSync(outfile)) return true;
  let committed: TestMetrics;
  try {
    committed = JSON.parse(readFileSync(outfile, "utf8")) as TestMetrics;
  } catch {
    return true;
  }
  const declared = treeTestFiles(root);
  const committedFiles = committed.files.map((f) => f.file).sort();
  if (committedFiles.length !== declared.length) return true;
  for (let i = 0; i < declared.length; i += 1) {
    if (committedFiles[i] !== declared[i]) return true;
  }
  const sum = committed.files.reduce((acc, f) => acc + f.tests, 0);
  return sum !== committed.tests.length;
}

if (import.meta.main) {
  const root = process.cwd();
  const outfile = path.join(root, "test-metrics.json");
  const junit = path.join(os.tmpdir(), `ngrace-junit-${process.pid}.xml`);
  const generated = new Date().toISOString().slice(0, 10);
  const stale = artifactIsStale(root, outfile);
  // Provisional, tree-derived artifact: the suite's own freshness guard reads this
  // file, so a stale artifact must already name every current test file before the
  // metered run. A fresh artifact is left untouched and no provisional write lands.
  if (stale) {
    const provisionalFiles = treeTestFiles(root).map((file) => ({ file, tests: sourceCount(root, file), ms: 0 }));
    const provisional: TestMetrics = {
      schemaVersion: "1.0.0",
      generated,
      files: provisionalFiles,
      tests: provisionalFiles.flatMap((f) =>
        Array.from({ length: f.tests }, () => ({ file: f.file, name: "(provisional)", ms: 0 }))),
    };
    writeFileSync(outfile, `${JSON.stringify(provisional, null, 2)}\n`);
  }
  const run = spawnSync("bun", ["test", "--timeout=0", `--reporter=junit`, `--reporter-outfile=${junit}`], { stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
  const metrics = stale
    ? parseJUnit(readFileSync(junit, "utf8"), generated)
    : (JSON.parse(readFileSync(outfile, "utf8")) as TestMetrics);
  if (stale) {
    writeFileSync(outfile, `${JSON.stringify(metrics, null, 2)}\n`);
  }
  for (const [index, test] of rankSlowest(metrics, 10).entries()) {
    console.log(`${String(index + 1).padStart(2)}. ${test.ms.toFixed(0).padStart(6)} ms  ${test.file}  ${test.name}`);
  }
}
