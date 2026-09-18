#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Selective developer-loop test runner
//   SCOPE: Changed-file to test-file selection; never a gate
//   DEPENDS: none
//   LINKS: [M-RELEASE-AUTOMATION, V-M-RELEASE-AUTOMATION]
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AFFECTED_EDGES
//   AffectedSelection
//   allTestFiles
//   selectAffectedTests
// END_MODULE_MAP
/**
 * Dev-loop convenience: run the tests a change touches, not the whole suite.
 * Never a gate — CI and the close always run `bun run test`.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type AffectedSelection = {
  tests: string[];
  fallbackToFullSuite: boolean;
  reasons: string[];
};

/** Explicit source -> tests edges for files whose test is not a path neighbour. */
export const AFFECTED_EDGES: Record<string, string[]> = {
  "package.json": ["scripts/audit-regressions.test.ts", "scripts/publish-workflow.test.ts"],
  ".github/workflows/validate.yml": ["scripts/audit-regressions.test.ts", "scripts/publish-workflow.test.ts"],
  ".github/workflows/publish.yml": ["scripts/publish-workflow.test.ts"],
  "src/gates/ledger.ts": ["src/gates/core.test.ts", "src/grace-status.test.ts"],
  "src/gates/core.ts": ["src/gates/core.test.ts"],
  // C-INSPECTION-SURFACE-1-2628AA2B T-004: the new root has no path-neighbour test
  // (`src/query/change.test.ts` is where its cases live), and `src/query/render.ts`
  // and `src/grace.ts` have no neighbour either, so without these edges every edit to
  // a file this bundle writes would send the dev loop to the whole suite.
  "src/grace-change.ts": ["src/query/change.test.ts"],
  "src/query/render.ts": ["src/grace-query.test.ts"],
  "src/grace.ts": ["src/query/command.test.ts"],
  "README.md": ["src/test-support/token-accounting.test.ts"],
  "test-metrics.json": ["scripts/test-metrics.test.ts"],
};

function conventionalCandidates(file: string): string[] {
  const out: string[] = [];
  if (file.endsWith(".test.ts")) out.push(file);
  out.push(file.replace(/\.ts$/, ".test.ts"));
  return out;
}

/** Fail-safe: any unmapped source under src/ or scripts/ runs the whole suite. */
export function selectAffectedTests(
  changedFiles: readonly string[],
  allTestFiles: readonly string[],
  edges: Record<string, string[]> = AFFECTED_EDGES,
): AffectedSelection {
  if (changedFiles.length === 0) {
    return { tests: [...allTestFiles].sort(), fallbackToFullSuite: true, reasons: ["no changed files; running the full suite"] };
  }
  const known = new Set(allTestFiles);
  const selected = new Set<string>();
  const reasons: string[] = [];
  let unmapped = false;
  for (const file of changedFiles) {
    if (file.endsWith(".test.ts") && known.has(file)) {
      selected.add(file);
      reasons.push(`${file}: changed test`);
      continue;
    }
    const mapped = edges[file];
    if (mapped && mapped.length > 0) {
      for (const test of mapped) if (known.has(test)) selected.add(test);
      reasons.push(`${file}: mapped -> ${mapped.join(", ")}`);
      continue;
    }
    const conventional = conventionalCandidates(file).filter((candidate) => known.has(candidate));
    if (conventional.length > 0) {
      for (const test of conventional) selected.add(test);
      reasons.push(`${file}: conventional -> ${conventional.join(", ")}`);
      continue;
    }
    if (file.startsWith("src/") || file.startsWith("scripts/")) {
      unmapped = true;
      reasons.push(`${file}: unmapped source; running the full suite`);
    } else {
      reasons.push(`${file}: no test surface`);
    }
  }
  if (unmapped || selected.size === 0) {
    return { tests: [...allTestFiles].sort(), fallbackToFullSuite: true, reasons };
  }
  return { tests: [...selected].sort(), fallbackToFullSuite: false, reasons };
}

export function allTestFiles(root: string): string[] {
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

if (import.meta.main) {
  const base = process.argv[2] ?? "origin/main";
  const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" });
  const changed = (diff.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const selection = selectAffectedTests(changed, allTestFiles(process.cwd()));
  for (const reason of selection.reasons) console.log(`select: ${reason}`);
  console.log(selection.fallbackToFullSuite ? "selection: full suite" : `selection: ${selection.tests.length} test file(s)`);
  const args = selection.fallbackToFullSuite
    ? ["test", "--timeout=0"]
    : ["test", "--timeout=0", ...selection.tests];
  process.exit(spawnSync("bun", args, { stdio: "inherit" }).status ?? 1);
}
