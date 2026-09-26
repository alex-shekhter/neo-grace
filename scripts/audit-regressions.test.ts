import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type AuditRegressionCase = {
  id: string;
  testFile: string;
  evidence: string;
  platforms: readonly ("linux" | "windows" | "macos")[];
};

const repoRoot = path.resolve(import.meta.dir, "..");
const allPlatforms = ["linux", "windows", "macos"] as const;

const AUDIT_REGRESSION_CASES: readonly AuditRegressionCase[] = [
  { id: "malformed-anchor", testFile: "src/artifact/grammar.test.ts", evidence: "artifact.malformed-semantic-anchor", platforms: allPlatforms },
  { id: "anchor-attributes", testFile: "src/artifact/grammar.test.ts", evidence: "artifact.semantic-anchor-has-attributes", platforms: allPlatforms },
  { id: "empty-change-contract", testFile: "src/artifact/grammar.test.ts", evidence: "change.empty-section", platforms: allPlatforms },
  { id: "invalid-task-dag", testFile: "src/artifact/grammar.test.ts", evidence: "change.task-dependency-cycle", platforms: allPlatforms },
  { id: "path-traversal", testFile: "src/artifact/paths.test.ts", evidence: "path.traversal", platforms: allPlatforms },
  { id: "symlink-escape", testFile: "src/artifact/paths.test.ts", evidence: "path.symlink-escape", platforms: allPlatforms },
  { id: "assertion-arity", testFile: "src/artifact/assertions.test.ts", evidence: "assertion.invalid-shape", platforms: allPlatforms },
  { id: "command-not-evaluated", testFile: "src/artifact/assertions.test.ts", evidence: "assertion.command-not-evaluated", platforms: allPlatforms },
  { id: "final-lifecycle-validation", testFile: "src/grace-lint.test.ts", evidence: "final assertion mode", platforms: allPlatforms },
  { id: "single-quote-approved-status", testFile: "src/grace-lint.test.ts", evidence: "attribute quote style", platforms: allPlatforms },
  { id: "duplicate-owns", testFile: "src/artifact/projections.test.ts", evidence: "projection.graph.duplicate-route", platforms: allPlatforms },
  { id: "exact-evidence-tags", testFile: "src/artifact/projections.test.ts", evidence: "excludes naked <File> siblings", platforms: allPlatforms },
  { id: "document-anchor-overlap", testFile: "src/artifact/scope.test.ts", evidence: "expands durable document ownership", platforms: allPlatforms },
  { id: "known-disjoint-document-anchor", testFile: "src/artifact/scope.test.ts", evidence: "anchors owned by another known document", platforms: allPlatforms },
  { id: "disjoint-extension-globs", testFile: "src/artifact/scope.test.ts", evidence: "differing extension globs disjoint", platforms: allPlatforms },
  { id: "windows-case-collision", testFile: "src/artifact/scope.test.ts", evidence: "case-insensitive collision semantics on Windows", platforms: ["windows"] },
  { id: "invalid-navigation-root", testFile: "src/grace-query.test.ts", evidence: "fails closed before returning records", platforms: allPlatforms },
  { id: "invalid-navigation-operational-contract", testFile: "src/grace-query.test.ts", evidence: "active assertion or scope contracts are invalid", platforms: allPlatforms },
  { id: "structured-json-error", testFile: "src/grace-query.test.ts", evidence: "ok: false", platforms: allPlatforms },
  { id: "structured-lint-error", testFile: "src/grace-lint.test.ts", evidence: "invalid options and missing project paths", platforms: allPlatforms },
  { id: "structured-status-error", testFile: "src/grace-status.test.ts", evidence: "invalid options and missing paths", platforms: allPlatforms },
  { id: "grace3-validation-isolation", testFile: "src/grace-lint.test.ts", evidence: "project.grace3-detected", platforms: allPlatforms },
  { id: "stale-not-ready", testFile: "src/grace-status.test.ts", evidence: "stale-plan", platforms: allPlatforms },
  { id: "route-aware-drift", testFile: "src/grace-status.test.ts", evidence: "exact declared document or owning anchor route", platforms: allPlatforms },
  { id: "index-drift-attribution", testFile: "src/grace-status.test.ts", evidence: "graph index drift", platforms: allPlatforms },
  { id: "approved-contract-drift", testFile: "src/grace-status.test.ts", evidence: "approved contract drift", platforms: allPlatforms },
  { id: "untracked-approved-bundle", testFile: "src/grace-status.test.ts", evidence: "newly created untracked approved bundle", platforms: allPlatforms },
  { id: "empty-context-artifact", testFile: "src/artifact/grammar.test.ts", evidence: "empty context artifacts", platforms: allPlatforms },
  { id: "design-context-identity", testFile: "src/artifact/grammar.test.ts", evidence: "canonical design-context identity", platforms: allPlatforms },
  { id: "python-unicode", testFile: "src/lint/adapters/python.test.ts", evidence: "UTF-8", platforms: allPlatforms },
  { id: "python-unicode-module-map", testFile: "src/project-utils.test.ts", evidence: "Unicode identifiers in exact Python MODULE_MAP parity", platforms: allPlatforms },
  { id: "typescript-namespace-export", testFile: "src/lint/adapters/typescript.test.ts", evidence: "namespace re-export names exactly", platforms: allPlatforms },
  { id: "dart-valid-invocation", testFile: "src/lint/adapters/dart.test.ts", evidence: "temporary analyzer file", platforms: allPlatforms },
  { id: "adapter-runtime-missing", testFile: "src/project-utils.test.ts", evidence: "analysis.runtime-missing", platforms: allPlatforms },
  { id: "approved-plan-immutability", testFile: "scripts/skill-contracts.test.ts", evidence: "approved_plan_immutability", platforms: allPlatforms },
  { id: "migration-cleanup-gates", testFile: "scripts/skill-contracts.test.ts", evidence: "git availability/worktree inspection", platforms: allPlatforms },
  { id: "stable-release-ancestry", testFile: "scripts/release-bump.test.ts", evidence: "release PR branch based on current origin/main", platforms: allPlatforms },
  { id: "stable-release-finalization", testFile: "scripts/release-finalize.test.ts", evidence: "clean synchronized main", platforms: allPlatforms },
  { id: "stable-release-protections", testFile: "scripts/release-check.test.ts", evidence: "without requiring PR approvals", platforms: allPlatforms },
  { id: "windows-ci", testFile: ".github/workflows/validate.yml", evidence: "windows-compatibility", platforms: ["windows"] },
  { id: "real-dart-ci", testFile: ".github/workflows/validate.yml", evidence: "dart-lang/setup-dart", platforms: ["linux"] },
];

describe("Critical, High, and Medium audit regression matrix", () => {
  for (const regression of AUDIT_REGRESSION_CASES) {
    it(`${regression.id} maps to deterministic regression evidence`, () => {
      const content = readFileSync(path.join(repoRoot, regression.testFile), "utf8");
      expect(content).toContain(regression.evidence);
      expect(regression.platforms.length).toBeGreaterThan(0);
    });
  }

  it("keeps Windows-only coverage conditional while retaining portable case tests", () => {
    const scopeTests = readFileSync(path.join(repoRoot, "src/artifact/scope.test.ts"), "utf8");
    expect(scopeTests).toContain('process.platform === "win32" ? it : it.skip');
    expect(scopeTests).toContain("normalizes backslashes and follows explicit case semantics");
  });

  it("keeps scripts under the root typecheck and the root lint", () => {
    const tsconfig = JSON.parse(readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8")) as { include?: string[] };
    expect(tsconfig.include ?? []).toContain("scripts/**/*.ts");
    const lintConfig = JSON.parse(readFileSync(path.join(repoRoot, ".ngrace-lint.json"), "utf8")) as { ignoredDirs?: string[] };
    expect(lintConfig.ignoredDirs ?? []).not.toContain("scripts");
    const claude = readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
    expect(claude).not.toContain("is deferred to a later");
    expect(claude).toContain("C-SCRIPTS-ADOPTION-2-36DEB1BD");
    const result = spawnSync("bun", ["run", "typecheck"], { cwd: repoRoot, encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C-TEST-TIMEOUT-CEILING-2-7AD2A006: no per-test timeout pin, one job ceiling.
// A timeout pin is a numeric last argument to `it(`/`test(` in either syntactic
// form, recognized as a group of at least four digits so the repository's four
// single-digit non-timeout numeric lines cannot be flagged.
// ---------------------------------------------------------------------------

const TIMEOUT_SHAPED = /[0-9_]{4,}/;

/** Every *.test.ts under the tree, excluding node_modules, .git and .ngrace. */
export function collectTestFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".ngrace") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectTestFiles(full, acc);
    else if (name.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

export function findTimeoutPins(root: string): Array<{ file: string; line: number; text: string }> {
  const pins: Array<{ file: string; line: number; text: string }> = [];
  for (const full of collectTestFiles(root)) {
    const rel = path.relative(root, full);
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((line, i) => {
      const oneLine = /\},\s*([0-9][0-9_]*)\s*\);/.exec(line);
      if (oneLine && TIMEOUT_SHAPED.test(oneLine[1]!)) {
        pins.push({ file: rel, line: i + 1, text: line.trim() });
        return;
      }
      const bare = /^\s+([0-9][0-9_]*)\s*,\s*$/.exec(line);
      if (bare && TIMEOUT_SHAPED.test(bare[1]!)) {
        let j = i + 1;
        while (j < lines.length && lines[j]!.trim() === "") j++;
        if (j < lines.length && /^\s*\);\s*$/.test(lines[j]!)) {
          pins.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    });
  }
  return pins;
}

/** Jobs in a workflow's bytes whose steps run the suite but carry no timeout-minutes. */
export function suiteJobsMissingCeiling(xml: string, expected = "30"): string[] {
  const jobs: Array<{ name: string; body: string[] }> = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of xml.split("\n")) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      if (current) jobs.push(current);
      current = { name: m[1]!, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) jobs.push(current);
  const suiteRun = /(bun run test\b|bun test\b|validate:ci|validate:cli|validate:determinism)/;
  const missing: string[] = [];
  for (const job of jobs) {
    const runsSuite = job.body.some((l) => l.includes("run:") && suiteRun.test(l));
    if (!runsSuite) continue;
    const ceiling = job.body.some((l) => new RegExp(`^    timeout-minutes:\\s*${expected}\\s*$`).test(l));
    if (!ceiling) missing.push(job.name);
  }
  return missing;
}

describe("C-TEST-TIMEOUT-CEILING-2-7AD2A006 suite hygiene", () => {
  it("no *.test.ts carries a numeric per-test timeout", () => {
    expect(findTimeoutPins(repoRoot)).toEqual([]);
  });

  it("every suite-running workflow job declares timeout-minutes: 30", () => {
    for (const file of [".github/workflows/validate.yml", ".github/workflows/publish.yml"]) {
      const missing = suiteJobsMissingCeiling(readFileSync(path.join(repoRoot, file), "utf8"));
      expect(missing, `${file}: suite-running jobs without a ceiling`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// C-CLONE-FAITHFUL-TESTS-1-D68520A2: no test sources a fixture from a path git
// does not track. A test that reads a .gitignore'd or untracked repository path
// passes only where that path exists (the maintainer's tree) and dies in every
// clone. The guard expresses a READ, never the appearance of an ignored path:
// it keys on filesystem-read call sites and the path literals in their arguments.
//
// Limits, stated so a later reader cannot mistake a pass for total coverage:
//   (1) a path assembled entirely from separate segments is not detected — the
//       flush engine's declared-input buffer read (root + ".ngrace" + "scratch"
//       + the file name) is the verb's input, not a fixture, and must not be
//       flagged;
//   (2) the guard covers `.ts` only; a non-TypeScript artifact is out of scope;
//   (3) a read of an ignored *directory* is detected only where that directory
//       exists on disk: `git check-ignore` matches a trailing-slash pattern
//       against a bare directory path only when it can see the directory, so
//       this branch fires in the maintainer's tree and not in a clone. Reads of
//       ignored *files* — the class this guard exists for — are detected in both.
// ---------------------------------------------------------------------------

const FIXTURE_READ_APIS = [
  "readFileSync", "readFile", "readdirSync", "existsSync", "statSync",
  "lstatSync", "cpSync", "copyFileSync", "openSync", "createReadStream",
  "realpathSync",
];

/** Argument text of every filesystem-read call site in `src`. */
function fixtureReadArguments(src: string): string[] {
  const out: string[] = [];
  for (const api of FIXTURE_READ_APIS) {
    const re = new RegExp(`\\b${api}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length;
      let depth = 1;
      const start = i;
      while (i < src.length && depth > 0) {
        const c = src[i]!;
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      }
      out.push(src.slice(start, i - 1));
    }
  }
  return out;
}

function fixturePathLiterals(args: string): string[] {
  const out: string[] = [];
  for (const m of args.matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) out.push(m[2]!);
  return out;
}

function isRepoRelativeLiteral(literal: string): boolean {
  if (!literal || literal.startsWith("/") || literal.includes("..")) return false;
  return literal !== "utf8" && literal !== "utf-8" && literal !== ".";
}

/** Every *.ts under src/ and scripts/, excluding node_modules and .git. */
export function collectGuardSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const r = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(r);
      else if (ent.name.endsWith(".ts")) out.push(r);
    }
  };
  for (const dir of ["src", "scripts"]) walk(dir);
  return out.sort();
}

/**
 * Keys on filesystem-read call sites, then asks git about each
 * repository-relative literal with one `git ls-files -z` snapshot and one
 * batched `git check-ignore --stdin` pass — never a process per literal.
 * Returns `file: literal` hits.
 */
export function findUntrackedFixtureReads(root: string): string[] {
  const files = collectGuardSourceFiles(root);
  const candidates = new Map<string, string[]>();
  for (const file of files) {
    const src = readFileSync(path.join(root, file), "utf8");
    for (const args of fixtureReadArguments(src)) {
      for (const literal of fixturePathLiterals(args)) {
        if (!isRepoRelativeLiteral(literal)) continue;
        candidates.set(literal, [...(candidates.get(literal) ?? []), file]);
      }
    }
  }
  const literals = [...candidates.keys()];
  const tracked = new Set(
    spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .stdout.split("\0")
      .filter(Boolean),
  );
  const ignored = new Set(
    spawnSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      encoding: "utf8",
      input: `${literals.join("\n")}\n`,
    })
      .stdout.split("\n")
      .filter(Boolean),
  );
  const hits: string[] = [];
  for (const [literal, owners] of candidates) {
    const exists = existsSync(path.join(root, literal));
    const untracked = exists && !tracked.has(literal) && ![...tracked].some((p) => p.startsWith(`${literal}/`));
    if (!ignored.has(literal) && !untracked) continue;
    for (const owner of owners) hits.push(`${owner}: ${literal}`);
  }
  return hits.sort();
}

describe("C-CLONE-FAITHFUL-TESTS-1-D68520A2 fixture-read hygiene", () => {
  it("no .ts under src/ or scripts/ reads a path git ignores or leaves untracked", () => {
    expect(findUntrackedFixtureReads(repoRoot), "a filesystem read of a git-untracked repository path").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-TEST-TIME-BUDGET-2-3EC1F016 T-001: `validate:ci` runs each test file once.
// Only `validate:ci` is guarded; `validate:release` deliberately keeps
// `validate:cli` and is asserted to still do so.
// ---------------------------------------------------------------------------

function resolvesToTests(segment: string, scripts: Record<string, string>): boolean {
  if (/^bun (?:run )?test\b/.test(segment)) return true;
  const named = /^bun run ([a-z0-9:-]+)$/.exec(segment);
  if (named && scripts[named[1]!]) {
    return scripts[named[1]!].split("&&").map((s) => s.trim()).some((inner) => /^bun (?:run )?test\b/.test(inner));
  }
  return false;
}

// C-CI-LINT-AND-PLAN-SHAPE-1-3526D6F0 T-003: the suite segment is the JUnit-emitting
// measured runner (`bun run test:metrics`), still exactly one suite invocation.
const SUITE_SEGMENT = /^bun (?:run )?(?:test|test:metrics)$/;

export function validateCiRerunsSuite(scripts: Record<string, string>): string[] {
  const command = scripts["validate:ci"];
  if (!command) return ["validate:ci: missing"];
  const segments = command.split("&&").map((s) => s.trim()).filter(Boolean);
  const suites = segments.filter((s) => SUITE_SEGMENT.test(s));
  const extras = segments.filter((s) => resolvesToTests(s, scripts) && !SUITE_SEGMENT.test(s));
  return suites.length === 1 && extras.length === 0
    ? []
    : [`validate:ci: full-suite=${suites.length} extra=${extras.join(", ") || "none"}`];
}

describe("C-TEST-TIME-BUDGET-2-3EC1F016 validate:ci one suite run", () => {
  it("validate:ci contains the full suite and no other test command; validate:release is untouched", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(validateCiRerunsSuite(pkg.scripts)).toEqual([]);
    expect(pkg.scripts["validate:release"]).toContain("validate:cli");
  });
});

// ---------------------------------------------------------------------------
// C-TEST-TIME-BUDGET-2-3EC1F016 T-008: coverage never falls. No test file
// carries fewer `it(`/`test(` declarations than at the spec's base commit.
// ---------------------------------------------------------------------------

const COVERAGE_BASE = "2434fd467458e15c12414a74e37b09f9d71bdfd2";

function declaredTests(text: string): number {
  return (text.match(/(?:^|\s)(?:it|test)\s*\(/g) ?? []).length;
}

export function coverageRegressions(root: string): string[] {
  const out: string[] = [];
  for (const file of collectTestFiles(root)) {
    const rel = path.relative(root, file);
    const atHead = declaredTests(readFileSync(file, "utf8"));
    const base = spawnSync("git", ["show", `${COVERAGE_BASE}:${rel}`], { cwd: root, encoding: "utf8" });
    if (base.status !== 0) continue;
    if (atHead < declaredTests(base.stdout ?? "")) out.push(`${rel}: ${atHead} < base`);
  }
  return out;
}

describe("C-TEST-TIME-BUDGET-2-3EC1F016 coverage never falls", () => {
  it("no *.test.ts has fewer test declarations than at the base commit", () => {
    expect(coverageRegressions(repoRoot)).toEqual([]);
  });
});

describe("C-CI-LINT-AND-PLAN-SHAPE-1-3526D6F0 CI governance lint", () => {
  it("validate:ci contains the assertions-off governance lint and no current-mode lint of this root", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const command = pkg.scripts["validate:ci"];
    expect(command).toContain("bun ./src/grace.ts lint --path . --assertions none --fail-on errors");
    expect(command).not.toContain("--assertions current");
  });
});

/** The fetch-depth declared on the `validate` job's own Checkout step, or null when absent. */
export function validateJobCheckoutDepth(xml: string): string | null {
  const jobs: Array<{ name: string; body: string[] }> = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of xml.split("\n")) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      if (current) jobs.push(current);
      current = { name: m[1]!, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) jobs.push(current);
  const job = jobs.find((candidate) => candidate.name === "validate");
  if (!job) return null;
  let inCheckout = false;
  for (const line of job.body) {
    if (/^\s+- name: Checkout\s*$/.test(line)) {
      inCheckout = true;
      continue;
    }
    if (!inCheckout) continue;
    const depth = /^\s+fetch-depth:\s*(\S+)\s*$/.exec(line);
    if (depth) return depth[1]!;
    if (/^\s+- name:\s/.test(line)) inCheckout = false;
  }
  return null;
}

describe("C-LINUX-VALIDATION-REPAIR-1-DE5A1A05 checkout and README guards", () => {
  it("the validate job checks out full history for the pinned baseline control", () => {
    const xml = readFileSync(path.join(repoRoot, ".github/workflows/validate.yml"), "utf8");
    expect(validateJobCheckoutDepth(xml), "validate checkout fetch-depth").toBe("0");
  });

  it("README documents the fail-closed candidate refusal", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("never delete a candidate whose identity they cannot prove");
  });
});

/** The Windows job's own `run:` invocation that selects the grace-generate pin tests. */
export function windowsPinInvocation(xml: string): string | undefined {
  const jobs: Array<{ name: string; body: string[] }> = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of xml.split("\n")) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      if (current) jobs.push(current);
      current = { name: m[1]!, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) jobs.push(current);
  const job = jobs.find((candidate) => candidate.name === "windows-compatibility");
  if (!job) return undefined;
  const line = job.body.find((l) => l.includes("run:") && l.includes("src/grace-generate.test.ts"));
  return line?.trim();
}

describe("C-LINUX-VALIDATION-REPAIR-1-DE5A1A05 Windows pin invocation guard", () => {
  it("the Windows job selects every required pin direction", () => {
    const xml = readFileSync(path.join(repoRoot, ".github/workflows/validate.yml"), "utf8");
    expect(() => Bun.YAML.parse(xml), "the workflow must parse before Actions can run any job").not.toThrow();
    const invocation = windowsPinInvocation(xml);
    expect(invocation, "the Windows pin invocation exists").toBeDefined();
    for (const needle of [
      "AC-PIN-ACQUISITION: an ordinary mint",
      "AC-PIN-ACQUISITION: a forced open failure",
      "AC-PIN-RELEASE: releaseAcquiredCandidate",
      "AC-PIN-RELEASE-NO-LEAK",
      "AC-PIN-RELEASE-LIFETIME",
      "AC-PIN-RELEASE-API: successful writeSpecNew closes its record",
      "AC-PIN-RELEASE-API: a publish failure closes the pin exactly once",
      "AC-WINDOWS-DIRECTORY-PIN",
    ]) {
      expect(invocation, `windows pin invocation must keep ${needle}`).toContain(needle);
    }
  });
});

/** The Windows job's own `run:` invocation that selects the implicit-supersede owner tests. */
export function windowsSupersedeInvocation(xml: string): string | undefined {
  const jobs: Array<{ name: string; body: string[] }> = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of xml.split("\n")) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      if (current) jobs.push(current);
      current = { name: m[1]!, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) jobs.push(current);
  const job = jobs.find((candidate) => candidate.name === "windows-compatibility");
  if (!job) return undefined;
  const line = job.body.find((l) => l.includes("run:") && l.includes("src/grace-supersede.test.ts"));
  return line?.trim();
}

describe("C-LINUX-VALIDATION-REPAIR-2-D4F54467 Windows supersede invocation guard", () => {
  it("the Windows job selects the implicit-supersede pin release owner", () => {
    const xml = readFileSync(path.join(repoRoot, ".github/workflows/validate.yml"), "utf8");
    const invocation = windowsSupersedeInvocation(xml);
    expect(invocation, "the Windows supersede invocation exists").toBeDefined();
    for (const needle of [
      "AC-SUPERSEDE-PIN-RELEASE: a successful implicit mint",
      "AC-SUPERSEDE-PIN-RELEASE: a post-mint failure removal",
      "AC-SUPERSEDE-PIN-RELEASE: a post-mint refusal/residue",
      "AC-SUPERSEDE-PIN-RELEASE: a pre-publication mint failure",
    ]) {
      expect(invocation, `windows supersede invocation must keep ${needle}`).toContain(needle);
    }
    expect(invocation, "the supersede invocation stays filtered to the owner tests").toContain("-t");
  });
});

describe("C-LINUX-VALIDATION-REPAIR-2-D4F54467 writer owner platform guard", () => {
  it("the writer owner is declared with a plain it(), never a Linux-only skip", () => {
    const src = readFileSync(path.join(repoRoot, "src/grace-generate.test.ts"), "utf8");
    expect(src).toMatch(/it\("AC-PIN-RELEASE-API: successful writeSpecNew closes its record before returning"/);
    expect(src).not.toMatch(/itLinux\("AC-PIN-RELEASE-API: successful writeSpecNew closes its record/);
    expect(src).not.toMatch(/it\.skip\("AC-PIN-RELEASE-API: successful writeSpecNew closes its record/);
  });
});

/** Exact committed bytes of the predecessor's archive arrival at `9bdf72e` (the governed supersede move). */
export const PREDECESSOR_ARCHIVE_SHA256: Record<string, string> = {
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-1-DE5A1A05/spec.xml": "44669e46bd860a3cd54038798e25f996da78e5b88015ce6fd6421fd46165642e",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-1-DE5A1A05/plan.xml": "4e979a2682c68a85c0d0019d36f94767990cd244c86a909fea67b3d23aaf22e1",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-1-DE5A1A05/design-context.xml": "387dc9f528ad9bd88f2a21265eb8acc51307438b8355077f4bd7515fb9a43e21",
};

describe("C-LINUX-VALIDATION-REPAIR-2-D4F54467 predecessor archive byte guard", () => {
  it("the predecessor archive arrival keeps its committed post-supersede bytes", () => {
    for (const [rel, digest] of Object.entries(PREDECESSOR_ARCHIVE_SHA256)) {
      const bytes = readFileSync(path.join(repoRoot, rel));
      expect(createHash("sha256").update(bytes).digest("hex"), `${rel} must keep the bytes committed at 9bdf72e`).toBe(digest);
    }
  });
});

const REPORT_FORMAT_LINES = [
  "- STATUS: what landed and what is blocked.",
  "- DEVIATIONS: anything differing from the plan or prompt; say `none` if there is no deviation.",
  "- EVIDENCE: suite pass/fail counts, lint error count and distinct codes, and CI exit code; say `not run` for an unavailable measure.",
  "- DISCRIMINATION: each probe as mutate -> observed -> restored; say `none` when no probe applies.",
  "- AMBIGUITIES AND PROBLEMS: every ambiguity, contradiction, or block encountered, including ones resolved or worked around; say `none` if there are none.",
  "- WRONG: where the prompt, plan, or spec is wrong; say `none` if none is known.",
] as const;

function reportFormatProblems(content: string): string[] {
  const start = content.indexOf("## Response Format\n");
  if (start < 0) return ["Response Format section"];
  const next = content.indexOf("\n## ", start + 1);
  const section = content.slice(start, next < 0 ? undefined : next);
  const problems: string[] = [];
  let previous = -1;
  for (const line of REPORT_FORMAT_LINES) {
    const position = section.indexOf(line);
    if (position < 0 || position <= previous) problems.push(line);
    else previous = position;
  }
  return problems;
}

describe("C-LINUX-VALIDATION-REPAIR-3-7EB3B2C3 response format guard", () => {
  it("the AGENTS target keeps all six fields and their guidance", () => {
    const agentsPath = path.join(repoRoot, "AGENTS.md");
    if (process.platform === "win32" && !lstatSync(agentsPath).isSymbolicLink()) {
      expect(readFileSync(agentsPath, "utf8").trim()).toBe("CLAUDE.md");
    } else {
      expect(readlinkSync(agentsPath)).toBe("CLAUDE.md");
    }
    const content = readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
    expect(reportFormatProblems(content)).toEqual([]);
    for (const line of REPORT_FORMAT_LINES) {
      expect(reportFormatProblems(content.replace(line, "")), `${line} must be required`).toContain(line);
    }
  });
});

export const SECOND_PREDECESSOR_ARCHIVE_SHA256: Record<string, string> = {
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-2-D4F54467/spec.xml": "81e24a146ecd768853a73e72209f7e3cbac980d078f16523f7ac670b7d85efda",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-2-D4F54467/plan.xml": "7a6def8dfa80b075a035f0dee32984be838723b93837e3a2f2f8b8eba8a124f0",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-2-D4F54467/design-context.xml": "174e2a72373cf15669728d528f87dca7472e36aef258c6acd1d5d5a7d653f67e",
};

describe("C-LINUX-VALIDATION-REPAIR-2-D4F54467 (second arrival) predecessor archive byte guard", () => {
  it("the second-arrival archive keeps its exact post-supersede bytes", () => {
    for (const [rel, digest] of Object.entries(SECOND_PREDECESSOR_ARCHIVE_SHA256)) {
      const bytes = readFileSync(path.join(repoRoot, rel));
      expect(createHash("sha256").update(bytes).digest("hex"), `${rel} must keep its post-supersede bytes`).toBe(digest);
    }
  });
});

export const THIRD_ARRIVAL_ARCHIVE_SHA256: Record<string, string> = {
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-3-7EB3B2C3/spec.xml": "5793a14cc630f6ae10d3ce9e9a87aa2b2b9d4189632cb7bcabf3944f8dc86f78",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-3-7EB3B2C3/plan.xml": "8710763f8dd1cb078256ef36592fc4d9d95af52d10824bcfca2f4204908451da",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-3-7EB3B2C3/design-context.xml": "1e81d42538c9e61e5a42d1c7365dd4b4a805f878b6f5bc53553d4db1c89461f0",
};

describe("C-LINUX-VALIDATION-REPAIR-3-7EB3B2C3 (third arrival) predecessor archive byte guard", () => {
  it("the third-arrival archive keeps its exact post-supersede bytes", () => {
    for (const [rel, digest] of Object.entries(THIRD_ARRIVAL_ARCHIVE_SHA256)) {
      const bytes = readFileSync(path.join(repoRoot, rel));
      expect(createHash("sha256").update(bytes).digest("hex"), `${rel} must keep its post-supersede bytes`).toBe(digest);
    }
  });
});

export const FOURTH_ARRIVAL_ARCHIVE_SHA256: Record<string, string> = {
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-4-0C2D4D6B/spec.xml": "df77b115bb4829201b527baaea814ee77f53ce39eeea62000db861d21c3695e4",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-4-0C2D4D6B/plan.xml": "1ec42d0fd515ec622b0c0b127b8553b4ffe400619023f1e9e06e2cddd82d6a93",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-4-0C2D4D6B/design-context.xml": "0acf649d3d514f41a0bb89818e847dc8ecaefe4423be56f34a89d703a48dfa09",
};

describe("C-LINUX-VALIDATION-REPAIR-4-0C2D4D6B (fourth arrival) predecessor archive byte guard", () => {
  it("the fourth-arrival archive keeps its exact post-supersede bytes", () => {
    for (const [rel, digest] of Object.entries(FOURTH_ARRIVAL_ARCHIVE_SHA256)) {
      const bytes = readFileSync(path.join(repoRoot, rel));
      expect(createHash("sha256").update(bytes).digest("hex"), `${rel} must keep its post-supersede bytes`).toBe(digest);
    }
  });
});

export const FIFTH_ARRIVAL_ARCHIVE_SHA256: Record<string, string> = {
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-5-EE982B6D/spec.xml": "735dc0c1ccdbe388249ddd324a02da9dc11284e3db046f2ecc6a7770be941136",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-5-EE982B6D/plan.xml": "cead3ad5fa15972ee30eb77bc30e0f6bfc707a477d0b5415ae5c9afdbb24255c",
  ".ngrace/changes/archive/C-LINUX-VALIDATION-REPAIR-5-EE982B6D/design-context.xml": "670fa7b1a8954a154d5676f2c2f16faf2cc66d162236850664aecd645fec1e6c",
};

describe("C-LINUX-VALIDATION-REPAIR-5-EE982B6D (fifth arrival) predecessor archive byte guard", () => {
  it("the fifth-arrival archive keeps its exact post-supersede bytes", () => {
    for (const [rel, digest] of Object.entries(FIFTH_ARRIVAL_ARCHIVE_SHA256)) {
      const bytes = readFileSync(path.join(repoRoot, rel));
      expect(createHash("sha256").update(bytes).digest("hex"), `${rel} must keep its post-supersede bytes`).toBe(digest);
    }
  });
});

// ---------------------------------------------------------------------------
// C-LINUX-VALIDATION-REPAIR-6-62765C22: the positive, URL-free Windows evidence
// record. The guard checks a local record's shape and provenance; it does not
// prove the remote result. The clickable link stays in the private report.
// ---------------------------------------------------------------------------

export const WINDOWS_EVIDENCE_BUNDLE_ID = "C-LINUX-VALIDATION-REPAIR-6-62765C22";
export const WINDOWS_EVIDENCE_GUARD_FILE = "scripts/audit-regressions.test.ts";

/** Application commit of the C6 governance. Archived mode uses this unless a test passes another boundary. */
export const WINDOWS_EVIDENCE_BOUNDARY = "0fbd59961d15b7587cc2b153e225fcdcf9066db2";

const WINDOWS_EVIDENCE_ARCHIVE_DIR = `.ngrace/changes/archive/${WINDOWS_EVIDENCE_BUNDLE_ID}`;

export const WINDOWS_EVIDENCE_REQUIRED_JOBS = ["validate", "dart-adapter", "windows-compatibility"] as const;

export const WINDOWS_EVIDENCE_REQUIRED_DIRECTIONS = [
  "AC-PIN-ACQUISITION: an ordinary mint",
  "AC-PIN-ACQUISITION: a forced open failure",
  "AC-PIN-RELEASE: releaseAcquiredCandidate",
  "AC-PIN-RELEASE-NO-LEAK",
  "AC-PIN-RELEASE-API: successful writeSpecNew closes its record",
  "AC-PIN-RELEASE-API: a publish failure closes the pin exactly once",
  "AC-WINDOWS-DIRECTORY-PIN",
  "AC-SUPERSEDE-PIN-RELEASE: a successful implicit mint",
  "AC-SUPERSEDE-PIN-RELEASE: a post-mint failure removal",
  "AC-SUPERSEDE-PIN-RELEASE: a post-mint refusal/residue",
  "AC-SUPERSEDE-PIN-RELEASE: a pre-publication mint failure",
] as const;

/** A GitHub Actions run/job link: the GitHub web host plus the actions/runs endpoint. Scheme and host are case-insensitive. */
const ACTIONS_LINK = /https?:\/\/github\.com\/[^/\s"'<>]+\/[^/\s"'<>]+\/actions\/runs\/[0-9]+/i;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function findActionsLink(text: string): string | undefined {
  return ACTIONS_LINK.exec(decodeXmlEntities(text))?.[0];
}

function collectBundleFiles(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectBundleFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export type GitInventoryResult = { status: number | null; stdout: string; stderr: string; error?: Error };
export type GitRunner = (root: string, args: string[]) => GitInventoryResult;

const defaultGitRunner: GitRunner = (root, args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error ?? undefined };
};

/** Repository-relative paths whose tracked, staged, or untracked bytes changed since `sha`. Fails closed. */
export function changedPathsSince(root: string, sha: string, run: GitRunner = defaultGitRunner): string[] {
  const tracked = run(root, ["diff", "--no-renames", "--name-only", sha]);
  if (tracked.error || tracked.status !== 0) {
    throw new Error(`git diff inventory failed: ${tracked.error?.message ?? tracked.stderr.trim() ?? "unknown"}`);
  }
  const untracked = run(root, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.error || untracked.status !== 0) {
    throw new Error(`git ls-files inventory failed: ${untracked.error?.message ?? untracked.stderr.trim() ?? "unknown"}`);
  }
  return [...new Set([...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")].map((s) => s.trim()).filter(Boolean))];
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, encoding: "utf8" }).status === 0;
}

function commitExists(root: string, sha: string): boolean {
  return spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, encoding: "utf8" }).status === 0;
}

function isAllowedEvidencePath(changed: string): boolean {
  return changed.startsWith(`.ngrace/changes/active/${WINDOWS_EVIDENCE_BUNDLE_ID}/`)
    || changed.startsWith(`${WINDOWS_EVIDENCE_ARCHIVE_DIR}/`)
    || changed === WINDOWS_EVIDENCE_GUARD_FILE;
}

function readInventory(result: GitInventoryResult, label: string): { failure: string | null; paths: string[] } {
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr.trim() || "unknown");
    return { failure: `${label} inventory failed: ${detail}`, paths: [] };
  }
  return {
    failure: null,
    paths: [...new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean))],
  };
}

function archivedProvenanceProblems(root: string, sha: string, boundary: string, run: GitRunner): string[] {
  if (!commitExists(root, boundary)) {
    return [`boundary ${boundary} is absent; archived-mode inventory fails closed`];
  }
  const problems: string[] = [];
  if (!isAncestor(root, sha, "HEAD")) problems.push(`candidateSha ${sha} is not an ancestor of HEAD`);
  if (!isAncestor(root, boundary, "HEAD")) {
    problems.push(`boundary ${boundary} is not an ancestor of HEAD; archived-mode range fails closed`);
  }
  if (!isAncestor(root, sha, boundary)) {
    problems.push(`candidateSha ${sha} is not an ancestor of boundary ${boundary}; archived-mode range fails closed`);
  }
  const historical = readInventory(run(root, ["diff", "--no-renames", "--name-only", sha, boundary]), "historical diff");
  if (historical.failure) problems.push(historical.failure);
  else {
    for (const changed of historical.paths) {
      if (!isAllowedEvidencePath(changed)) problems.push(`path changed since candidateSha is outside the allowed set: ${changed}`);
    }
  }
  const archiveDiff = readInventory(
    run(root, ["diff", "--no-renames", "--name-only", boundary, "--", WINDOWS_EVIDENCE_ARCHIVE_DIR]),
    "archive-byte",
  );
  if (archiveDiff.failure) problems.push(archiveDiff.failure);
  else {
    for (const changed of archiveDiff.paths) problems.push(`archive path differs from the boundary: ${changed}`);
  }
  const untracked = readInventory(
    run(root, ["ls-files", "--others", "--exclude-standard", "--", WINDOWS_EVIDENCE_ARCHIVE_DIR]),
    "archive untracked",
  );
  if (untracked.failure) problems.push(untracked.failure);
  else {
    for (const changed of untracked.paths) problems.push(`untracked archive path: ${changed}`);
  }
  return problems;
}

/**
 * All red states of the local evidence record: bundle resolution, sidecar shape,
 * provenance, job/direction tallies, and a full-Actions-link scan of every bundle
 * artifact in its active or archived location. An empty array is green.
 */
export function windowsEvidenceProblems(
  root: string,
  run: GitRunner = defaultGitRunner,
  boundary: string = WINDOWS_EVIDENCE_BOUNDARY,
): string[] {
  const problems: string[] = [];
  const active = path.join(root, ".ngrace", "changes", "active", WINDOWS_EVIDENCE_BUNDLE_ID);
  const archived = path.join(root, ".ngrace", "changes", "archive", WINDOWS_EVIDENCE_BUNDLE_ID);
  const activeExists = existsSync(active);
  const archiveExists = existsSync(archived);
  if (!activeExists && !archiveExists) return [`${WINDOWS_EVIDENCE_BUNDLE_ID} absent from both active/ and archive/`];
  if (activeExists && archiveExists) return [`${WINDOWS_EVIDENCE_BUNDLE_ID} present in both active/ and archive/`];
  const bundle = activeExists ? active : archived;
  const sidecar = path.join(bundle, "ci-evidence.json");
  if (!existsSync(sidecar)) return ["ci-evidence.json sidecar absent (a zero-record bundle is red)"];

  let record: Record<string, unknown>;
  try {
    record = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
  } catch (error) {
    return [`ci-evidence.json is not valid JSON: ${(error as Error).message}`];
  }

  if (record.schemaVersion !== "1.0.0") problems.push("schemaVersion must be exactly 1.0.0");

  const sha = record.candidateSha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    problems.push("candidateSha must be a 40-character lowercase hex commit");
  } else if (activeExists) {
    if (!isAncestor(root, sha, "HEAD")) problems.push(`candidateSha ${sha} is not an ancestor of HEAD`);
    try {
      for (const changed of changedPathsSince(root, sha, run)) {
        if (!isAllowedEvidencePath(changed)) problems.push(`path changed since candidateSha is outside the allowed set: ${changed}`);
      }
    } catch (error) {
      problems.push(`changed-path inventory failed: ${(error as Error).message}`);
    }
  } else {
    problems.push(...archivedProvenanceProblems(root, sha, boundary, run));
  }

  if (!isPositiveInteger(record.runId)) problems.push("runId must be a positive integer");

  if (!Array.isArray(record.jobs)) {
    problems.push("jobs must be an array");
  } else {
    const names = new Set<string>();
    const ids = new Set<number>();
    for (const raw of record.jobs as Array<Record<string, unknown>>) {
      const name = raw?.name;
      if (typeof name !== "string") {
        problems.push("job name must be a string");
        continue;
      }
      if (names.has(name)) problems.push(`duplicate job name ${name}`);
      names.add(name);
      if (!isPositiveInteger(raw.id)) problems.push(`job ${name} id must be a positive integer`);
      else if (ids.has(raw.id)) problems.push(`duplicate job id ${raw.id}`);
      else ids.add(raw.id);
      if (raw.conclusion !== "success") problems.push(`job ${name} conclusion must be success`);
      for (const tally of ["pass", "skip", "fail"] as const) {
        const value = raw[tally];
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          problems.push(`job ${name} ${tally} must be a nonnegative integer`);
        }
      }
      if (raw.fail !== 0) problems.push(`job ${name} fail must be 0`);
      if (!(typeof raw.pass === "number" && raw.pass > 0)) problems.push(`job ${name} pass must be greater than 0`);
    }
    for (const required of WINDOWS_EVIDENCE_REQUIRED_JOBS) {
      if (!names.has(required)) problems.push(`missing required job ${required}`);
    }
  }

  if (!Array.isArray(record.directions)) {
    problems.push("directions must be an array");
  } else {
    const directions = record.directions as Array<Record<string, unknown>>;
    for (const required of WINDOWS_EVIDENCE_REQUIRED_DIRECTIONS) {
      const matches = directions.filter((d) => typeof d.selector === "string" && d.selector.startsWith(required));
      if (matches.length === 0) {
        problems.push(`missing required direction ${required}`);
        continue;
      }
      for (const match of matches) {
        if (!isPositiveInteger(match.executed)) problems.push(`direction ${required} executed must be at least 1`);
        if (match.skipped !== 0) problems.push(`direction ${required} skipped must be 0`);
      }
    }
  }

  for (const file of collectBundleFiles(bundle)) {
    const link = findActionsLink(readFileSync(file, "utf8"));
    if (link) problems.push(`full GitHub Actions link in ${path.relative(root, file)}`);
  }

  return problems;
}

describe("C-LINUX-VALIDATION-REPAIR-6-62765C22 Windows evidence record guard", () => {
  it("the successor bundle carries a well-formed, URL-free, provenance-checked CI record", () => {
    const problems = windowsEvidenceProblems(repoRoot);
    expect(problems, problems.join("; ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Throwaway-fixture self-tests: each mutation is planted in its own temp git
// repo, asserted red, restored, and re-asserted green. Negative links are
// assembled at runtime so no literal repository URL is stored.
// ---------------------------------------------------------------------------

function gitRun(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout ?? "";
}

function evidenceBundlePath(root: string): string {
  return path.join(root, ".ngrace", "changes", "active", WINDOWS_EVIDENCE_BUNDLE_ID);
}

function evidenceSidecarPath(root: string): string {
  return path.join(evidenceBundlePath(root), "ci-evidence.json");
}

function cleanSidecarRecord(candidateSha: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    candidateSha,
    runId: 36196836553,
    jobs: WINDOWS_EVIDENCE_REQUIRED_JOBS.map((name, index) => ({
      name,
      id: 108274492060 + index,
      conclusion: "success",
      pass: 10 + index,
      skip: 0,
      fail: 0,
    })),
    directions: WINDOWS_EVIDENCE_REQUIRED_DIRECTIONS.map((selector) => ({ selector, executed: 1, skipped: 0 })),
  };
}

/** A throwaway git repo with exactly the C6 active bundle and a clean sidecar. */
function makeEvidenceFixture(): { root: string; sidecarText: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "c6-evidence-fixture-"));
  const bundle = evidenceBundlePath(root);
  mkdirSync(bundle, { recursive: true });
  mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(root, ".github", "workflows", "validate.yml"), "name: Validate\n");
  writeFileSync(path.join(root, "src-keep.ts"), "export const keep = 1;\n");
  gitRun(root, ["init", "-q"]);
  gitRun(root, ["config", "user.email", "fixture"]);
  gitRun(root, ["config", "user.name", "fixture"]);
  gitRun(root, ["add", "-A"]);
  gitRun(root, ["commit", "-q", "-m", "fixture candidate"]);
  const sha = gitRun(root, ["rev-parse", "HEAD"]).trim();
  const sidecarText = `${JSON.stringify(cleanSidecarRecord(sha), null, 2)}\n`;
  writeFileSync(evidenceSidecarPath(root), sidecarText);
  return { root, sidecarText };
}

function mutateSidecar(root: string, mutate: (record: Record<string, unknown>) => void): void {
  const record = JSON.parse(readFileSync(evidenceSidecarPath(root), "utf8")) as Record<string, unknown>;
  mutate(record);
  writeFileSync(evidenceSidecarPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

function makeRuntimeActionsLink(suffix = ""): string {
  return ["https://", "github.com", "/example/example", "/actions/runs/123", suffix].join("");
}

describe("C-LINUX-VALIDATION-REPAIR-6-62765C22 Windows evidence guard self-tests", () => {
  function withFixture(body: (fixture: { root: string; sidecarText: string }) => void): void {
    const fixture = makeEvidenceFixture();
    try {
      expect(windowsEvidenceProblems(fixture.root), "clean evidence greens the guard").toEqual([]);
      body(fixture);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  it("reddens on an absent sidecar and greens when restored", () => {
    withFixture(({ root }) => {
      const sidecar = evidenceSidecarPath(root);
      const saved = readFileSync(sidecar, "utf8");
      rmSync(sidecar);
      expect(windowsEvidenceProblems(root), "absent sidecar reddens").not.toEqual([]);
      writeFileSync(sidecar, saved);
      expect(windowsEvidenceProblems(root), "restored sidecar greens").toEqual([]);
    });
  });

  it("reddens on a wrong schemaVersion and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        record.schemaVersion = "9.9.9";
      });
      expect(windowsEvidenceProblems(root), "wrong schemaVersion reddens").toContain("schemaVersion must be exactly 1.0.0");
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored schemaVersion greens").toEqual([]);
    });
  });

  it("reddens on a removed schemaVersion and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        delete record.schemaVersion;
      });
      expect(windowsEvidenceProblems(root), "removed schemaVersion reddens").toContain("schemaVersion must be exactly 1.0.0");
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored schemaVersion greens").toEqual([]);
    });
  });

  it("reddens on a failed windows-compatibility conclusion and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        const jobs = record.jobs as Array<Record<string, unknown>>;
        const windows = jobs.find((job) => job.name === "windows-compatibility")!;
        windows.conclusion = "failure";
      });
      expect(windowsEvidenceProblems(root), "failed conclusion reddens").toContain(
        "job windows-compatibility conclusion must be success",
      );
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored conclusion greens").toEqual([]);
    });
  });

  it("reddens when a required direction executed zero and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        const directions = record.directions as Array<Record<string, unknown>>;
        directions[0]!.executed = 0;
      });
      expect(windowsEvidenceProblems(root).some((problem) => problem.includes("executed must be at least 1")), "executed=0 reddens").toBe(true);
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored direction greens").toEqual([]);
    });
  });

  it("reddens on a malformed tally and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        const jobs = record.jobs as Array<Record<string, unknown>>;
        jobs[0]!.pass = "lots";
      });
      expect(windowsEvidenceProblems(root).some((problem) => problem.includes("pass must be a nonnegative integer")), "malformed tally reddens").toBe(true);
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored tally greens").toEqual([]);
    });
  });

  it("reddens on an uncommitted workflow mutation with src unchanged and greens when restored", () => {
    withFixture(({ root }) => {
      const workflow = path.join(root, ".github", "workflows", "validate.yml");
      writeFileSync(workflow, `${readFileSync(workflow, "utf8")}# uncommitted probe\n`);
      expect(
        windowsEvidenceProblems(root).some((problem) => problem.includes(".github/workflows/validate.yml")),
        "uncommitted workflow mutation reddens",
      ).toBe(true);
      gitRun(root, ["reset", "-q", "--hard"]);
      expect(windowsEvidenceProblems(root), "restored workflow greens").toEqual([]);
    });
  });

  it("reddens on a forbidden workflow path renamed into the bundle and greens when restored", () => {
    withFixture(({ root }) => {
      gitRun(root, ["mv", ".github/workflows/validate.yml", path.join(".ngrace", "changes", "active", WINDOWS_EVIDENCE_BUNDLE_ID, "moved-validate.yml")]);
      expect(
        windowsEvidenceProblems(root).some((problem) => problem.includes(".github/workflows/validate.yml")),
        "forbidden source endpoint reddens",
      ).toBe(true);
      gitRun(root, ["reset", "-q", "--hard"]);
      expect(windowsEvidenceProblems(root), "restored rename greens").toEqual([]);
    });
  });

  it("reddens on a run-only link in a temporary design-context.xml and greens when removed", () => {
    withFixture(({ root }) => {
      const artifact = path.join(evidenceBundlePath(root), "design-context.xml");
      writeFileSync(artifact, `<x>${makeRuntimeActionsLink()}</x>\n`);
      expect(windowsEvidenceProblems(root).some((problem) => problem.includes("design-context.xml")), "run-only link reddens").toBe(true);
      rmSync(artifact);
      expect(windowsEvidenceProblems(root), "removed design-context greens").toEqual([]);
    });
  });

  it("reddens on a /job/ link in a temporary design-context.xml and greens when removed", () => {
    withFixture(({ root }) => {
      const artifact = path.join(evidenceBundlePath(root), "design-context.xml");
      writeFileSync(artifact, `<x>${makeRuntimeActionsLink("/job/456")}</x>\n`);
      expect(windowsEvidenceProblems(root).some((problem) => problem.includes("design-context.xml")), "job link reddens").toBe(true);
      rmSync(artifact);
      expect(windowsEvidenceProblems(root), "removed design-context greens").toEqual([]);
    });
  });

  it("reddens on a full link in a temporary run-ledger.xml and greens when removed", () => {
    withFixture(({ root }) => {
      const artifact = path.join(evidenceBundlePath(root), "run-ledger.xml");
      writeFileSync(artifact, `<ledger>${makeRuntimeActionsLink("/job/789")}</ledger>\n`);
      expect(windowsEvidenceProblems(root).some((problem) => problem.includes("run-ledger.xml")), "full ledger link reddens").toBe(true);
      rmSync(artifact);
      expect(windowsEvidenceProblems(root), "removed ledger greens").toEqual([]);
    });
  });

  it("reddens on a prefixed forged selector and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        const directions = record.directions as Array<Record<string, unknown>>;
        directions[0]!.selector = `not executed: ${String(directions[0]!.selector)}`;
      });
      expect(
        windowsEvidenceProblems(root).some((problem) => problem.includes("missing required direction")),
        "a selector that merely contains the required text reddens",
      ).toBe(true);
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored selector greens").toEqual([]);
    });
  });

  it("reddens on an ambiguous duplicate required direction and greens when restored", () => {
    withFixture(({ root, sidecarText }) => {
      mutateSidecar(root, (record) => {
        const directions = record.directions as Array<Record<string, unknown>>;
        directions.push({ selector: `${String(directions[0]!.selector)} (shadow, not executed)`, executed: 0, skipped: 0 });
      });
      expect(
        windowsEvidenceProblems(root).some((problem) => problem.includes("executed must be at least 1")),
        "a shadowing duplicate reddens even when a good match exists",
      ).toBe(true);
      writeFileSync(evidenceSidecarPath(root), sidecarText);
      expect(windowsEvidenceProblems(root), "restored directions green").toEqual([]);
    });
  });

  it("reddens on a mixed-case full Actions link and greens when removed", () => {
    withFixture(({ root }) => {
      const artifact = path.join(evidenceBundlePath(root), "design-context.xml");
      const mixedCaseLink = ["HTTPS://", "GitHub.CoM", "/example/example", "/actions/runs/123"].join("");
      writeFileSync(artifact, `<x>${mixedCaseLink}</x>\n`);
      expect(windowsEvidenceProblems(root).some((problem) => problem.includes("design-context.xml")), "mixed-case link reddens").toBe(true);
      rmSync(artifact);
      expect(windowsEvidenceProblems(root), "removed mixed-case link greens").toEqual([]);
    });
  });

  it("reddens when the untracked-path inventory fails with a forbidden path present", () => {
    withFixture(({ root }) => {
      mkdirSync(path.join(root, "src"), { recursive: true });
      writeFileSync(path.join(root, "src", "forbidden.ts"), "export const forbidden = 1;\n");
      const failingLsFiles = ((r: string, args: string[]) => {
        if (args[0] === "ls-files") return { status: 128, stdout: "", stderr: "inventory unavailable" };
        const result = spawnSync("git", args, { cwd: r, encoding: "utf8" });
        return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      }) as GitRunner;
      expect(
        windowsEvidenceProblems(root, failingLsFiles).some((problem) => problem.includes("inventory failed")),
        "a failed inventory reddens rather than greening",
      ).toBe(true);
      expect(
        windowsEvidenceProblems(root).some((problem) => problem.includes("src/forbidden.ts")),
        "the normal inventory still sees the forbidden untracked path",
      ).toBe(true);
    });
  });
});

function archiveEvidencePath(root: string): string {
  return path.join(root, ".ngrace", "changes", "archive", WINDOWS_EVIDENCE_BUNDLE_ID);
}

function makeArchivedEvidenceFixture(): { root: string; candidate: string; boundary: string; sidecarText: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "c6-archived-evidence-"));
  const bundle = archiveEvidencePath(root);
  mkdirSync(bundle, { recursive: true });
  mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(bundle, "keep.txt"), "keep\n");
  writeFileSync(path.join(root, ".github", "workflows", "validate.yml"), "name: Validate\n");
  writeFileSync(path.join(root, "scripts", "audit-regressions.test.ts"), "export const guard = 1;\n");
  writeFileSync(path.join(root, "src-keep.ts"), "export const keep = 1;\n");
  gitRun(root, ["init", "-q"]);
  gitRun(root, ["config", "user.email", "fixture"]);
  gitRun(root, ["config", "user.name", "fixture"]);
  gitRun(root, ["add", "-A"]);
  gitRun(root, ["commit", "-q", "-m", "fixture candidate"]);
  const candidate = gitRun(root, ["rev-parse", "HEAD"]).trim();
  const sidecarText = `${JSON.stringify(cleanSidecarRecord(candidate), null, 2)}\n`;
  writeFileSync(path.join(bundle, "ci-evidence.json"), sidecarText);
  gitRun(root, ["add", "-A"]);
  gitRun(root, ["commit", "-q", "-m", "fixture boundary"]);
  const boundary = gitRun(root, ["rev-parse", "HEAD"]).trim();
  return { root, candidate, boundary, sidecarText };
}

describe("C-LINUX-VALIDATION-REPAIR-6 archived-mode boundary", () => {
  function withArchivedFixture(body: (fixture: { root: string; candidate: string; boundary: string; sidecarText: string }) => void): void {
    const fixture = makeArchivedEvidenceFixture();
    try {
      expect(windowsEvidenceProblems(fixture.root, defaultGitRunner, fixture.boundary), "clean archived evidence greens").toEqual([]);
      body(fixture);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  it("stays green when a later tracked file lands outside the C6 archive", () => {
    withArchivedFixture(({ root, boundary }) => {
      writeFileSync(path.join(root, "later.txt"), "later\n");
      gitRun(root, ["add", "later.txt"]);
      gitRun(root, ["commit", "-q", "-m", "later tracked file"]);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "a later file outside the archive stays green").toEqual([]);
    });
  });

  it("reddens on a tracked C6 archive mutation and greens when restored", () => {
    withArchivedFixture(({ root, boundary }) => {
      const sidecar = path.join(archiveEvidencePath(root), "ci-evidence.json");
      const saved = readFileSync(sidecar, "utf8");
      writeFileSync(sidecar, `${saved}\n`);
      expect(
        windowsEvidenceProblems(root, defaultGitRunner, boundary).some((problem) => problem.includes("ci-evidence.json")),
        "tracked archive mutation reddens",
      ).toBe(true);
      writeFileSync(sidecar, saved);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "restored archive bytes green").toEqual([]);
    });
  });

  it("reddens on an untracked C6 archive file and greens when removed", () => {
    withArchivedFixture(({ root, boundary }) => {
      const extra = path.join(archiveEvidencePath(root), "extra.txt");
      writeFileSync(extra, "extra\n");
      expect(
        windowsEvidenceProblems(root, defaultGitRunner, boundary).some((problem) => problem.includes("extra.txt")),
        "untracked archive file reddens",
      ).toBe(true);
      rmSync(extra);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "removed untracked archive file greens").toEqual([]);
    });
  });

  it("reddens on a forbidden historical path while the later tree is clean and greens when restored", () => {
    withArchivedFixture(({ root, candidate, boundary }) => {
      gitRun(root, ["checkout", "-q", "--detach", candidate]);
      writeFileSync(path.join(root, "forbidden.ts"), "export const forbidden = 1;\n");
      const sidecarText = `${JSON.stringify(cleanSidecarRecord(candidate), null, 2)}\n`;
      writeFileSync(path.join(archiveEvidencePath(root), "ci-evidence.json"), sidecarText);
      gitRun(root, ["add", "-A"]);
      gitRun(root, ["commit", "-q", "-m", "forbidden historical path"]);
      const badBoundary = gitRun(root, ["rev-parse", "HEAD"]).trim();
      rmSync(path.join(root, "forbidden.ts"));
      gitRun(root, ["add", "-A"]);
      gitRun(root, ["commit", "-q", "-m", "later clean tree"]);
      expect(gitRun(root, ["status", "--porcelain"]).trim(), "the later tree is clean").toBe("");
      expect(existsSync(path.join(root, "forbidden.ts")), "the forbidden file is gone after the boundary").toBe(false);
      expect(
        windowsEvidenceProblems(root, defaultGitRunner, badBoundary).some((problem) => problem.includes("forbidden.ts")),
        "the historical range reddens while the later tree is clean",
      ).toBe(true);
      gitRun(root, ["checkout", "-q", "--detach", boundary]);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "restored boundary greens").toEqual([]);
    });
  });

  it("reddens when the candidate is newer than the boundary and greens when restored", () => {
    withArchivedFixture(({ root, boundary, sidecarText }) => {
      writeFileSync(path.join(root, "later.txt"), "later\n");
      gitRun(root, ["add", "later.txt"]);
      gitRun(root, ["commit", "-q", "-m", "candidate after boundary"]);
      const newer = gitRun(root, ["rev-parse", "HEAD"]).trim();
      const sidecar = path.join(archiveEvidencePath(root), "ci-evidence.json");
      const record = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
      record.candidateSha = newer;
      writeFileSync(sidecar, `${JSON.stringify(record, null, 2)}\n`);
      expect(
        windowsEvidenceProblems(root, defaultGitRunner, boundary).some((problem) => problem.includes("not an ancestor of boundary")),
        "a newer candidate reddens",
      ).toBe(true);
      writeFileSync(sidecar, sidecarText);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "restored candidate greens").toEqual([]);
    });
  });

  it("reddens on an unrelated candidate and greens when restored", () => {
    withArchivedFixture(({ root, boundary, sidecarText }) => {
      gitRun(root, ["checkout", "-q", "--orphan", "unrelated"]);
      gitRun(root, ["reset", "-q"]);
      gitRun(root, ["commit", "-q", "--allow-empty", "-m", "unrelated"]);
      const unrelated = gitRun(root, ["rev-parse", "HEAD"]).trim();
      gitRun(root, ["checkout", "-q", "-f", "--detach", boundary]);
      const sidecar = path.join(archiveEvidencePath(root), "ci-evidence.json");
      const record = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
      record.candidateSha = unrelated;
      writeFileSync(sidecar, `${JSON.stringify(record, null, 2)}\n`);
      expect(
        windowsEvidenceProblems(root, defaultGitRunner, boundary).some((problem) => problem.includes("not an ancestor of boundary")),
        "an unrelated candidate reddens",
      ).toBe(true);
      writeFileSync(sidecar, sidecarText);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "restored candidate greens").toEqual([]);
    });
  });

  it("fails closed on the no-override call when the repository lacks the boundary object", () => {
    withArchivedFixture(({ root, boundary }) => {
      const closed = windowsEvidenceProblems(root);
      expect(closed.some((problem) => problem.includes("fails closed")), "the default boundary is absent").toBe(true);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "an explicit boundary greens the same repository").toEqual([]);
    });
  });

  it("reddens on an absent archived sidecar and greens when restored", () => {
    withArchivedFixture(({ root, boundary }) => {
      const sidecar = path.join(archiveEvidencePath(root), "ci-evidence.json");
      const saved = readFileSync(sidecar, "utf8");
      rmSync(sidecar);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "absent archived sidecar reddens").not.toEqual([]);
      writeFileSync(sidecar, saved);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "restored archived sidecar greens").toEqual([]);
    });
  });

  it("reddens on a full Actions link in the archived bundle and greens when removed", () => {
    withArchivedFixture(({ root, boundary }) => {
      const artifact = path.join(archiveEvidencePath(root), "design-context.xml");
      writeFileSync(artifact, `<x>${makeRuntimeActionsLink()}</x>\n`);
      expect(
        windowsEvidenceProblems(root, defaultGitRunner, boundary).some((problem) => problem.includes("design-context.xml")),
        "archived Actions link reddens",
      ).toBe(true);
      rmSync(artifact);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "removed archived link greens").toEqual([]);
    });
  });

  it("reddens when the historical diff inventory fails and greens with the real runner", () => {
    withArchivedFixture(({ root, boundary }) => {
      const failingHistorical = ((r: string, args: string[]) => {
        if (args[0] === "diff" && !args.includes("--")) return { status: 128, stdout: "", stderr: "historical inventory unavailable" };
        return defaultGitRunner(r, args);
      }) as GitRunner;
      const problems = windowsEvidenceProblems(root, failingHistorical, boundary);
      expect(problems.some((problem) => problem.includes("inventory failed")), "a failed historical diff reddens").toBe(true);
      expect(problems, "a failed historical diff is not an empty path set").not.toEqual([]);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "the real historical diff greens").toEqual([]);
    });
  });

  it("reddens when the archive untracked inventory fails and greens with the real runner", () => {
    withArchivedFixture(({ root, boundary }) => {
      const failingUntracked = ((r: string, args: string[]) => {
        if (args[0] === "ls-files") return { status: 128, stdout: "", stderr: "inventory unavailable" };
        return defaultGitRunner(r, args);
      }) as GitRunner;
      const problems = windowsEvidenceProblems(root, failingUntracked, boundary);
      expect(problems.some((problem) => problem.includes("inventory failed")), "a failed archive inventory reddens").toBe(true);
      expect(problems, "a failed archive inventory is not an empty path set").not.toEqual([]);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "the real archive inventory greens").toEqual([]);
    });
  });

  it("reddens when a present boundary is off HEAD ancestry and greens when that head is restored", () => {
    withArchivedFixture(({ root, boundary, sidecarText }) => {
      expect(spawnSync("git", ["cat-file", "-e", `${boundary}^{commit}`], { cwd: root }).status, "the boundary object is present").toBe(0);
      gitRun(root, ["checkout", "-q", "--detach", "HEAD~1"]);
      writeFileSync(path.join(archiveEvidencePath(root), "ci-evidence.json"), sidecarText);
      gitRun(root, ["add", "-A"]);
      gitRun(root, ["commit", "-q", "-m", "alternate head"]);
      const problems = windowsEvidenceProblems(root, defaultGitRunner, boundary);
      expect(problems).toEqual([`boundary ${boundary} is not an ancestor of HEAD; archived-mode range fails closed`]);
      gitRun(root, ["checkout", "-q", "-f", "--detach", boundary]);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "restored boundary head greens").toEqual([]);
    });
  });

  it("reddens when the archive-byte inventory fails and greens with the real runner", () => {
    withArchivedFixture(({ root, boundary }) => {
      const failingArchiveByte = ((r: string, args: string[]) => {
        if (args[0] === "diff" && args.includes("--")) return { status: 128, stdout: "", stderr: "archive-byte inventory unavailable" };
        return defaultGitRunner(r, args);
      }) as GitRunner;
      const problems = windowsEvidenceProblems(root, failingArchiveByte, boundary);
      expect(problems).toEqual(["archive-byte inventory failed: archive-byte inventory unavailable"]);
      expect(windowsEvidenceProblems(root, defaultGitRunner, boundary), "the real archive-byte diff greens").toEqual([]);
    });
  });
});

describe("tracked active-directory marker", () => {
  it("a git archive HEAD checkout with active bundles removed lints clean and module find exits 0, and deleting active/ reddens", () => {
    expect(gitRun(repoRoot, ["ls-files", "--error-unmatch", ".ngrace/changes/active/.gitkeep"]).trim()).toBe(".ngrace/changes/active/.gitkeep");
    expect(spawnSync("git", ["cat-file", "-e", "HEAD:.ngrace/changes/active/.gitkeep"], { cwd: repoRoot }).status).toBe(0);
    const dest = mkdtempSync(path.join(os.tmpdir(), "c7-archive-checkout-"));
    try {
      const extracted = spawnSync("bash", ["-c", 'git archive HEAD | tar -x -C "$1"', "extract-head-archive", dest], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(extracted.status, extracted.stderr).toBe(0);
      const active = path.join(dest, ".ngrace", "changes", "active");
      for (const name of readdirSync(active)) {
        if (name.startsWith("C-")) rmSync(path.join(active, name), { recursive: true, force: true });
      }
      expect(existsSync(path.join(active, ".gitkeep")), "the marker survives removal of active bundles").toBe(true);
      symlinkSync(path.join(repoRoot, "node_modules"), path.join(dest, "node_modules"));
      const lintArgs = ["run", "ngrace", "lint", "--path", dest, "--fail-on", "warnings"];
      const lint = spawnSync(process.execPath, lintArgs, { cwd: dest, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const lintText = `${lint.stdout}\n${lint.stderr}`;
      expect(lint.status, lintText).toBe(0);
      expect(lintText).toMatch(/^Errors: 0$/m);
      expect(lintText).toMatch(/^Warnings: 0$/m);
      expect(lintText).not.toContain("project.missing-change-directory");
      for (const args of [
        ["run", "ngrace", "module", "find", "true", "--path", dest],
        ["run", "ngrace", "module", "find", "false", "--path", dest],
        ["run", "ngrace", "module", "find", "--json=true", "--path", dest],
      ]) {
        const found = spawnSync(process.execPath, args, { cwd: dest, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        expect(found.status, `${args.join(" ")}\n${found.stdout}\n${found.stderr}`).toBe(0);
      }
      rmSync(active, { recursive: true, force: true });
      const red = spawnSync(process.execPath, lintArgs, { cwd: dest, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const redText = `${red.stdout}\n${red.stderr}`;
      expect(red.status, redText).toBe(1);
      expect(redText).toContain("project.missing-change-directory");
      const redFind = spawnSync(process.execPath, ["run", "ngrace", "module", "find", "true", "--path", dest], {
        cwd: dest,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(redFind.status, `${redFind.stdout}\n${redFind.stderr}`).not.toBe(0);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });
});
