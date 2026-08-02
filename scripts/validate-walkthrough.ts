#!/usr/bin/env bun
/**
 * Verifies the claims in examples/polyglot/WALKTHROUGH.md.
 *
 * The walkthrough teaches by breaking the example and showing the diagnostic. Prose
 * cannot be checked, but the *claims* can: each break below is applied to a scratch
 * copy, and the issue code the walkthrough prints must actually be emitted. Without
 * this, a renamed issue code silently turns the tutorial into a lie — the failure mode
 * `validate:examples` was added to prevent for the example itself.
 *
 * Phase 11 also exercises the **lifecycle** steps on a scratch copy (never the repo
 * tree — gate approve writes run-ledger.xml) and fails if a step or its token is gone.
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { lintGraceProject } from "../src/grace-lint";
import { loadGraceArtifactIndex, resolveModule } from "../src/query/core";
import { buildModuleHealth } from "../src/query/health";
import { runReview } from "../src/review/core";

const repoRoot = path.resolve(import.meta.dir, "..");
const examplePath = path.join(repoRoot, "examples/polyglot");
const walkthroughPath = path.join(examplePath, "WALKTHROUGH.md");
const entry = path.join(repoRoot, "src/grace.ts");

type Break = {
  section: string;
  file: string;
  find: string;
  replace: string;
  expect: string;
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

const FORBIDDEN_PROSE: Array<{ id: string; re: RegExp; why: string }> = [
  { id: "ngrace-amend", re: /ngrace\s+amend\b/i, why: "ngrace amend was never shipped (A75/A76)" },
  { id: "ScopeAmendment-element", re: /<ScopeAmendment\b/, why: "ScopeAmendment element was never shipped" },
  {
    id: "verdict-outcome-not-run",
    re: /gate\s+verdict[^\n]*not-run|--outcome\s+not-run|outcome=["']not-run["']/i,
    why: "not-run is not a review-verdict token",
  },
];

const REQUIRED_LIFECYCLE_PROSE = [
  "gate approve",
  "context --task",
  "review.scope-outside-write-scope",
  "verification-unavailable",
  "not-run",
  "gate verdict",
  "cursor fold",
  "gate archive",
];

const LIFECYCLE_STEPS = 8;

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

function runCli(args: string[], root: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [entry, ...args, "--path", root], {
    encoding: "utf8",
    cwd: repoRoot,
    env: process.env,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const failures: string[] = [];

// Baseline: lint green.
{
  const baseline = lintGraceProject(examplePath);
  if (baseline.summary.errors !== 0) {
    failures.push(`baseline: examples/polyglot has ${baseline.summary.errors} errors before any break`);
  }
}

// Baseline: plain review green (corr 203 — project-wide detectors, not scoped input).
{
  const report = runReview(examplePath);
  const errors = report.findings.filter((f) => f.severity === "error");
  if (errors.length !== 0) {
    failures.push(
      `baseline review: plain ngrace review must be green; got ${errors.length} error(s): `
        + errors.map((e) => e.code).join(", "),
    );
  }
}

for (const breakage of BREAKS) {
  const root = scratchCopy();
  try {
    const target = path.join(root, breakage.file);
    const original = readFileSync(target, "utf8");
    if (!original.includes(breakage.find)) {
      failures.push(
        `${breakage.section}: anchor text not found in ${breakage.file} — the walkthrough's diff no longer matches the example`,
      );
      continue;
    }
    writeFileSync(target, original.replace(breakage.find, breakage.replace));

    const codes = codesFor(root, breakage);
    if (!codes.includes(breakage.expect)) {
      failures.push(
        `${breakage.section}: expected ${breakage.expect}, got [${[...new Set(codes)].join(", ") || "nothing"}]`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Prose claims.
{
  const prose = readFileSync(walkthroughPath, "utf8");
  for (const breakage of BREAKS) {
    if (!prose.includes(breakage.expect)) {
      failures.push(`${breakage.section}: WALKTHROUGH.md no longer mentions ${breakage.expect}`);
    }
  }
  for (const token of REQUIRED_LIFECYCLE_PROSE) {
    if (!prose.toLowerCase().includes(token.toLowerCase())) {
      failures.push(`lifecycle prose: WALKTHROUGH.md must mention \`${token}\``);
    }
  }
  for (const ban of FORBIDDEN_PROSE) {
    if (ban.re.test(prose)) {
      failures.push(`forbidden prose (${ban.id}): ${ban.why}`);
    }
  }
}

// Lifecycle on scratch (D16: each step fails when its token is removed — witnesses in A76).
{
  const root = scratchCopy();
  try {
    const approve = runCli(["gate", "approve", "--change", "C-ADD-KEYBOARD-NAV"], root);
    if (approve.exitCode !== 0 || !approve.stdout.includes("Decision: permit")) {
      failures.push(`lifecycle.1 approve: expected Decision: permit, exit=${approve.exitCode}`);
    }
    if (!existsSync(path.join(root, ".ngrace/changes/active/C-ADD-KEYBOARD-NAV/run-ledger.xml"))) {
      failures.push("lifecycle.1 approve: run-ledger.xml missing after permit");
    }

    const slice = runCli(["context", "--task", "T-001", "--change", "C-ADD-KEYBOARD-NAV"], root);
    if (slice.exitCode !== 0 || !slice.stdout.includes("T-001") || !slice.stdout.includes("LedgerTable")) {
      failures.push("lifecycle.2 context: expected task slice naming T-001 and LedgerTable");
    }

    const outOfScope = runReview(root, {
      changeId: "C-ADD-KEYBOARD-NAV",
      changedFiles: ["services/api/internal/router/router.go"],
    });
    if (!outOfScope.findings.some((f) => f.code === "review.scope-outside-write-scope")) {
      failures.push("lifecycle.3 scope: expected review.scope-outside-write-scope");
    }

    const plain = runReview(root);
    if (plain.findings.some((f) => f.severity === "error")) {
      failures.push(`lifecycle.4 review-green: plain review still has errors (${plain.findings.length})`);
    }

    const open = runCli(
      [
        "cursor",
        "advance",
        "--change",
        "C-ADD-KEYBOARD-NAV",
        "--task",
        "T-001",
        "--openEpoch",
        "--worker",
        "w0",
        "--from",
        "1",
        "--to",
        "10",
      ],
      root,
    );
    if (open.exitCode !== 0) {
      failures.push(`lifecycle.5 openEpoch: exit ${open.exitCode}`);
    }

    const unavailable = runCli(
      [
        "cursor",
        "verification-unavailable",
        "--change",
        "C-ADD-KEYBOARD-NAV",
        "--task",
        "T-001",
        "--reason",
        "walkthrough-ci",
        "--verdict",
        "not-run",
      ],
      root,
    );
    if (unavailable.exitCode !== 0) {
      failures.push("lifecycle.6 not-run: verification-unavailable failed");
    } else {
      const runDir = path.join(root, ".ngrace/changes/active/C-ADD-KEYBOARD-NAV/run");
      const eventName = existsSync(runDir)
        ? readdirSync(runDir).find((f) => f.includes("verification-unavailable"))
        : undefined;
      const body = eventName ? readFileSync(path.join(runDir, eventName), "utf8") : "";
      if (!body.includes('verdict="not-run"')) {
        failures.push('lifecycle.6 not-run: event file missing verdict="not-run"');
      }
    }

    const terminal = runCli(
      ["cursor", "advance", "--change", "C-ADD-KEYBOARD-NAV", "--task", "T-001", "--kind", "terminal"],
      root,
    );
    if (terminal.exitCode !== 0) {
      failures.push(`lifecycle.7 terminal: exit ${terminal.exitCode}`);
    }

    const fold = runCli(["cursor", "fold", "--change", "C-ADD-KEYBOARD-NAV"], root);
    if (fold.exitCode !== 0 || !fold.stdout.includes("Fold applied")) {
      failures.push(`lifecycle.7 fold: expected Fold applied, exit=${fold.exitCode}`);
    }

    const verdict = runCli(
      ["gate", "verdict", "--change", "C-ADD-KEYBOARD-NAV", "--outcome", "pass", "--scope", "bundle"],
      root,
    );
    if (verdict.exitCode !== 0 || !verdict.stdout.includes("outcome=pass")) {
      failures.push(`lifecycle.8 verdict: expected outcome=pass, exit=${verdict.exitCode}`);
    }

    const apply = runCli(["gate", "apply", "--change", "C-ADD-KEYBOARD-NAV"], root);
    if (apply.exitCode !== 0 || !apply.stdout.includes("Decision: permit")) {
      failures.push(`lifecycle.8 apply: expected Decision: permit, exit=${apply.exitCode}`);
    }

    const archive = runCli(["gate", "archive", "--change", "C-ADD-KEYBOARD-NAV"], root);
    if (archive.exitCode !== 0 || !archive.stdout.includes("Decision: permit")) {
      failures.push(`lifecycle.8 archive: expected Decision: permit, exit=${archive.exitCode}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
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

console.log(
  `✓ Walkthrough validated: ${BREAKS.length} documented breaks + ${LIFECYCLE_STEPS} lifecycle steps `
    + "each produce their documented diagnostic.",
);
