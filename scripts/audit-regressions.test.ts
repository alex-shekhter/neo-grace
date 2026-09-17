import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
