#!/usr/bin/env bun
/**
 * Verifies the claims in examples/polyglot/WALKTHROUGH.md.
 *
 * The walkthrough teaches by breaking the example and showing the diagnostic. Prose
 * cannot be checked, but the *claims* can: each break below is applied to a scratch
 * copy, and the issue code the walkthrough prints must actually be emitted. Without
 * this, a renamed issue code silently turns the tutorial into a lie — the failure mode
 * `validate:examples` was added to prevent for the example itself.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { lintGraceProject } from "../src/grace-lint";
import { loadGraceArtifactIndex } from "../src/query/core";
import { buildModuleHealth } from "../src/query/health";
import { resolveModule } from "../src/query/core";

const repoRoot = path.resolve(import.meta.dir, "..");
const examplePath = path.join(repoRoot, "examples/polyglot");
const walkthroughPath = path.join(examplePath, "WALKTHROUGH.md");

type Break = {
  section: string;
  file: string;
  find: string;
  replace: string;
  /** Issue code the walkthrough tells the reader to expect. */
  expect: string;
  /** Health blockers are not lint issues; check module health instead. */
  via?: { health: string };
};

const BREAKS: Break[] = [
  {
    section: "2.1 lie about your code",
    file: "services/api/internal/router/router.go",
    find: "//   Route - Dispatch a gateway request.",
    replace: "//   Route - Dispatch a gateway request.\n//   Shutdown - Gracefully stop the router.",
    expect: "markup.module-map-mismatch",
  },
  {
    section: "2.2 plan drifts from spec",
    file: ".ngrace/changes/active/C-ADD-KEYBOARD-NAV/spec.xml",
    find: "<AffectedAreas>",
    replace: "<AffectedAreas>\n      <M-API-ROUTER />",
    expect: "change.scope-does-not-cover-spec",
  },
  {
    section: "2.3 UI state with no evidence",
    file: ".ngrace/graph/ui.xml",
    find: "<ST-EMPTY />",
    replace: "<ST-EMPTY />\n        <ST-ERROR />",
    expect: "health.ui-state-unverified",
    via: { health: "M-WEB-LEDGER-TABLE" },
  },
  {
    section: "2.4 break a cross-service contract",
    file: ".ngrace/graph/contracts.xml",
    find: "<Version>1.2.0</Version>",
    replace: "<Version>v1.2</Version>",
    expect: "projection.graph.invalid-interface-contract",
  },
];

function scratchCopy(): string {
  const root = mkdtempSync(path.join(tmpdir(), "grace-walkthrough-"));
  cpSync(examplePath, root, { recursive: true });
  return root;
}

function codesFor(root: string, breakage: Break): string[] {
  if (breakage.via?.health) {
    const index = loadGraceArtifactIndex(root);
    const health = buildModuleHealth(index, resolveModule(index, breakage.via.health));
    return [...health.blockers, ...health.warnings].map((issue) => issue.code);
  }
  return lintGraceProject(root).issues.map((issue) => issue.code);
}

const failures: string[] = [];

// The example must be green before any break, or the breaks prove nothing.
{
  const baseline = lintGraceProject(examplePath);
  if (baseline.summary.errors !== 0) {
    failures.push(`baseline: examples/polyglot has ${baseline.summary.errors} errors before any break`);
  }
}

for (const breakage of BREAKS) {
  const root = scratchCopy();
  try {
    const target = path.join(root, breakage.file);
    const original = readFileSync(target, "utf8");
    if (!original.includes(breakage.find)) {
      failures.push(`${breakage.section}: anchor text not found in ${breakage.file} — the walkthrough's diff no longer matches the example`);
      continue;
    }
    writeFileSync(target, original.replace(breakage.find, breakage.replace));

    const codes = codesFor(root, breakage);
    if (!codes.includes(breakage.expect)) {
      failures.push(`${breakage.section}: expected ${breakage.expect}, got [${[...new Set(codes)].join(", ") || "nothing"}]`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Every code the walkthrough prints must be one the breaks actually produce.
{
  const prose = readFileSync(walkthroughPath, "utf8");
  for (const breakage of BREAKS) {
    if (!prose.includes(breakage.expect)) {
      failures.push(`${breakage.section}: WALKTHROUGH.md no longer mentions ${breakage.expect}`);
    }
  }
}

if (failures.length > 0) {
  console.error("✗ Walkthrough validation failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("\nWALKTHROUGH.md documents output the tool no longer produces. Fix the doc or the tool.");
  process.exit(1);
}

console.log(`✓ Walkthrough validated: ${BREAKS.length} documented breaks each produce their documented diagnostic.`);
