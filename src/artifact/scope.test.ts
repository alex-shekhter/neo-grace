import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { validateNgraceProject } from "./grammar";
import { ARTIFACT_DIR } from "./paths";
import { resolveNgracePaths } from "./project";
import {
  collectActiveChangeScopes,
  collectAppliedChangeScopes,
  detectScopeOverlaps,
  detectUnsafeConcurrentExecution,
  durableOverlaps,
  observedWriteScopeContains,
  parseScopeGlob,
  scopeGlobsOverlap,
  type DurableOwnershipIndex,
  type DurableScope,
} from "./scope";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "./test-fixtures";
import { NGRACE_CONTEXT_ARTIFACTS, NGRACE_OPTIONAL_CONTEXT_ARTIFACTS } from "./types";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-scope-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeChange(root: string, changeId: string, options: { graphAnchor: string; file: string; glob?: string; status?: string; contextArtifact?: string }) {
  const status = options.status ?? "approved";
  const bundle = `${ARTIFACT_DIR}/changes/active/${changeId}`;
  writeProjectFile(root, `${bundle}/spec.xml`, `<NgraceChangeSpec graceVersion="1.0" status="${status}"><${changeId} /></NgraceChangeSpec>`);
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="${status}"><${changeId}><DurableScope><GraphAnchors><${options.graphAnchor} /></GraphAnchors>${options.contextArtifact ? `<ContextArtifact>${options.contextArtifact}</ContextArtifact>` : ""}</DurableScope><ObservedWriteScope><File>${options.file}</File>${options.glob ? `<Glob>${options.glob}</Glob>` : ""}</ObservedWriteScope></${changeId}></NgraceChangePlan>`,
  );
}

function writeArchivedChange(root: string, changeId: string, options: { specStatus: string; planStatus: string; file: string; graphAnchor?: string }) {
  const bundle = `${ARTIFACT_DIR}/changes/archive/${changeId}`;
  writeProjectFile(root, `${bundle}/spec.xml`, `<NgraceChangeSpec graceVersion="1.0" status="${options.specStatus}"><${changeId} /></NgraceChangeSpec>`);
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="${options.planStatus}"><${changeId}><DurableScope><GraphAnchors><${options.graphAnchor ?? "M-EXAMPLE"} /></GraphAnchors></DurableScope><ObservedWriteScope><File>${options.file}</File></ObservedWriteScope></${changeId}></NgraceChangePlan>`,
  );
}

describe("neo-grace scope detector", () => {
  it("collects active change scopes from approved and draft plans", () => {
    const root = createProject();
    writeChange(root, "C-ONE", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts", contextArtifact: "requirements.xml" });
    writeChange(root, "C-TWO", { graphAnchor: "M-PROFILE", file: "src/profile.ts", status: "draft" });

    const scopes = collectActiveChangeScopes(resolveNgracePaths(root));
    const one = scopes.find((scope) => scope.changeId === "C-ONE");

    expect(scopes.map((scope) => scope.changeId).sort()).toEqual(["C-ONE", "C-TWO"]);
    expect(one?.durable.contextArtifacts).toContain("requirements.xml");
    expect(one?.observedWrites.files).toContain("src/auth.ts");
  });

  it("collects only applied+applied archive scopes and carries their declared durable anchors", () => {
    const root = createProject();
    writeChange(root, "C-ACTIVE-APPROVED", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts" });
    writeChange(root, "C-APPLIED-IN-ACTIVE", { graphAnchor: "M-AUTH-SESSION", file: "src/active.ts", status: "applied" });
    writeArchivedChange(root, "C-APPLIED", { specStatus: "applied", planStatus: "applied", file: "src/applied.ts" });
    writeArchivedChange(root, "C-REJ", { specStatus: "rejected", planStatus: "rejected", file: "src/rej.ts" });
    writeArchivedChange(root, "C-CAN", { specStatus: "cancelled", planStatus: "cancelled", file: "src/can.ts" });
    writeArchivedChange(root, "C-SUP", { specStatus: "superseded", planStatus: "superseded", file: "src/sup.ts" });

    const paths = resolveNgracePaths(root);
    const applied = collectAppliedChangeScopes(paths);
    const active = collectActiveChangeScopes(paths);

    expect(applied.map((scope) => scope.changeId)).toEqual(["C-APPLIED"]);
    expect(applied[0]?.observedWrites.files).toContain("src/applied.ts");
    expect(applied[0]?.durable?.graphAnchors).toEqual(["M-EXAMPLE"]);
    expect(active.map((scope) => scope.changeId).sort()).toEqual(["C-ACTIVE-APPROVED"]);
    expect(active.every((scope) => scope.changeId !== "C-APPLIED")).toBe(true);
  });

  it("reports durable overlap as warnings and observed write overlap as blockers", () => {
    const root = createProject();
    writeChange(root, "C-ONE", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts", glob: "src/**/*.ts" });
    writeChange(root, "C-TWO", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts", glob: "src/**/*.ts" });

    const scopes = collectActiveChangeScopes(resolveNgracePaths(root));
    const durableIssues = detectScopeOverlaps(scopes);
    const concurrentIssues = detectUnsafeConcurrentExecution(scopes);

    expect(durableIssues[0]?.severity).toBe("warning");
    expect(durableIssues[0]?.code).toBe("scope.durable-overlap");
    expect(concurrentIssues.every((issue) => issue.severity === "error")).toBe(true);
    expect(concurrentIssues.map((issue) => issue.code)).toContain("scope.parallel-durable-overlap");
    expect(concurrentIssues.map((issue) => issue.code)).toContain("scope.observed-write-overlap");
  });

  it("expands durable document ownership to anchor conflicts", () => {
    const emptyScope = (): DurableScope => ({
      graphAnchors: [],
      verificationAnchors: [],
      contextArtifacts: [],
      optionalContextArtifacts: [],
      graphDocuments: [],
      verificationDocuments: [],
    });
    const left = emptyScope();
    left.graphDocuments.push("GD-MAIN");
    const right = emptyScope();
    right.graphAnchors.push("M-AUTH-SESSION");
    const ownership: DurableOwnershipIndex = {
      graphDocuments: new Map([["GD-MAIN", new Set(["M-AUTH-SESSION"])]]),
      verificationDocuments: new Map(),
    };

    expect(durableOverlaps(left, right, ownership)).toEqual(["graph:GD-MAIN↔M-AUTH-SESSION"]);
  });

  it("does not overlap known documents with anchors owned by another known document", () => {
    const emptyScope = (): DurableScope => ({
      graphAnchors: [],
      verificationAnchors: [],
      contextArtifacts: [],
      optionalContextArtifacts: [],
      graphDocuments: [],
      verificationDocuments: [],
    });
    const left = emptyScope();
    left.graphDocuments.push("GD-A");
    left.verificationDocuments.push("VD-A");
    const right = emptyScope();
    right.graphAnchors.push("M-B");
    right.verificationAnchors.push("V-M-B");
    const ownership: DurableOwnershipIndex = {
      graphDocuments: new Map([
        ["GD-A", new Set(["M-A"])],
        ["GD-B", new Set(["M-B"])],
      ]),
      verificationDocuments: new Map([
        ["VD-A", new Set(["V-M-A"])],
        ["VD-B", new Set(["V-M-B"])],
      ]),
    };

    expect(durableOverlaps(left, right, ownership)).toEqual([]);
  });

  it("conservatively blocks whole-document scope against new or rehomed anchors", () => {
    const emptyScope = (): DurableScope => ({
      graphAnchors: [],
      verificationAnchors: [],
      contextArtifacts: [],
      optionalContextArtifacts: [],
      graphDocuments: [],
      verificationDocuments: [],
    });
    const left = emptyScope();
    left.graphDocuments.push("GD-NEW");
    const right = emptyScope();
    right.graphAnchors.push("M-NEW");

    expect(durableOverlaps(left, right)).toEqual(["graph:GD-NEW↔M-NEW"]);
  });

  it("rejects text-only scopes and accepts explicit None markers", () => {
    const root = createProject();
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-TEXT/spec.xml`, `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-TEXT /></NgraceChangeSpec>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-TEXT/plan.xml`, `<NgraceChangePlan graceVersion="1.0" status="approved"><C-TEXT><DurableScope>graph changes</DurableScope><ObservedWriteScope>source changes</ObservedWriteScope></C-TEXT></NgraceChangePlan>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-NONE/spec.xml`, `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-NONE /></NgraceChangeSpec>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-NONE/plan.xml`, `<NgraceChangePlan graceVersion="1.0" status="approved"><C-NONE><DurableScope><None /></DurableScope><ObservedWriteScope><None /></ObservedWriteScope></C-NONE></NgraceChangePlan>`);

    const scopes = collectActiveChangeScopes(resolveNgracePaths(root));
    const textScope = scopes.find((scope) => scope.changeId === "C-TEXT")!;
    const noneScope = scopes.find((scope) => scope.changeId === "C-NONE")!;
    expect(textScope.issues.map((entry) => entry.code)).toContain("scope.empty-durable-scope");
    expect(textScope.issues.map((entry) => entry.code)).toContain("scope.empty-observed-write-scope");
    expect(noneScope.issues).toHaveLength(0);
  });

  it("proves differing extension globs disjoint and auth-prefixed globs overlapping", () => {
    expect(scopeGlobsOverlap(parseScopeGlob("src/**/*.ts"), parseScopeGlob("src/**/*.md"), true)).toBe(false);
    expect(scopeGlobsOverlap(parseScopeGlob("src/**/*.ts"), parseScopeGlob("src/**/auth*.ts"), true)).toBe(true);
    expect(scopeGlobsOverlap(parseScopeGlob("src/**/nested/*.ts"), parseScopeGlob("src/*/nested/a?.ts"), true)).toBe(true);
  });

  it("rejects unsupported, absolute, traversal, and malformed glob syntax as plan errors", () => {
    const root = createProject();
    writeChange(root, "C-BAD-GLOB", { graphAnchor: "M-BAD", file: "src/example.ts", glob: "src/{one,two}/**" });
    const scopes = collectActiveChangeScopes(resolveNgracePaths(root));
    expect(scopes[0]?.issues.map((issue) => issue.code)).toContain("scope.unsupported-glob");

    for (const invalid of ["/tmp/**", "../src/**", "C:\\src\\**", "src/**x/file.ts", "src/[ab].ts", "!src/**"]) {
      expect(() => parseScopeGlob(invalid), invalid).toThrow();
    }
  });

  it("characterizes observedWriteScopeContains as the file matcher", () => {
    const emptyFiles = (globs: string[]) => ({ files: [] as string[], globs });
    expect(observedWriteScopeContains(emptyFiles(["web/js/**/*.js"]), "web/js/app.js")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["web/js/**/*.js"]), "web/js/sub/app.js")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["web/js/**/*.js"]), "web/js/app.ts")).toBe(false);
    expect(observedWriteScopeContains(emptyFiles(["src/**/foo.ts"]), "src/foo.ts")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["**/*.ts"]), "foo.ts")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["src/**"]), "src")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["src/foo.ts"]), "./src/foo.ts")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["./src/foo.ts"]), "src/foo.ts")).toBe(true);
    expect(observedWriteScopeContains({ files: ["src/foo.ts"], globs: [] }, "src\\foo.ts")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["src\\foo.ts"]), "src/foo.ts")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["src/?.ts"]), "src/a.ts")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["src/?.ts"]), "src/.ts")).toBe(false);
    expect(observedWriteScopeContains(emptyFiles(["src/foo?"]), "src/foo")).toBe(false);
    expect(observedWriteScopeContains(emptyFiles(["src/foo?"]), "src/foox")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["run/**"]), "run/1-T-001-attempt.xml")).toBe(true);
    expect(observedWriteScopeContains(emptyFiles(["a**b"]), "ab")).toBe(false);
    const caseFold = process.platform === "darwin" || process.platform === "win32";
    expect(observedWriteScopeContains(emptyFiles(["SRC/**/*.TS"]), "src/a.ts")).toBe(caseFold);
  });

  it("normalizes backslashes and follows explicit case semantics", () => {
    const windowsStyle = parseScopeGlob("SRC\\**\\Auth*.TS");
    expect(windowsStyle.normalizedPattern).toBe("SRC/**/Auth*.TS");
    expect(scopeGlobsOverlap(windowsStyle, parseScopeGlob("src/**/auth-file.ts"), false)).toBe(true);
    expect(scopeGlobsOverlap(windowsStyle, parseScopeGlob("src/**/auth-file.ts"), true)).toBe(false);
  });

  (process.platform === "win32" ? it : it.skip)("uses Windows case-insensitive collision semantics on Windows", () => {
    expect(scopeGlobsOverlap(parseScopeGlob("SRC/**/Auth*.TS"), parseScopeGlob("src/**/auth-file.ts"), false)).toBe(true);
  });

  it("blocks file-to-glob and nested glob overlaps while allowing disjoint areas", () => {
    const root = createProject();
    writeChange(root, "C-FILE", { graphAnchor: "M-FILE", file: "src/auth/session.ts" });
    writeChange(root, "C-GLOB", { graphAnchor: "M-GLOB", file: "other.txt", glob: "src/**" });
    writeChange(root, "C-NESTED", { graphAnchor: "M-NESTED", file: "nested.txt", glob: "src/auth/**" });
    writeChange(root, "C-DISJOINT", { graphAnchor: "M-DISJOINT", file: "docs/readme.md", glob: "tests/**" });

    const scopes = collectActiveChangeScopes(resolveNgracePaths(root));
    const issues = detectUnsafeConcurrentExecution(scopes);
    const messages = issues.map((entry) => entry.message);

    expect(messages.some((message) => message.includes("C-FILE") && message.includes("C-GLOB"))).toBe(true);
    expect(messages.some((message) => message.includes("C-GLOB") && message.includes("C-NESTED"))).toBe(true);
    expect(messages.some((message) => message.includes("C-DISJOINT"))).toBe(false);
  });
});

function contextEntryXml(names: readonly string[]): string {
  return names.map((name) => `<ContextArtifact>${name}</ContextArtifact>`).join("");
}

function plantOptionalContext(root: string, changeId: string, names: readonly string[]): void {
  const planPath = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml");
  writeFileSync(
    planPath,
    readFileSync(planPath, "utf8").replace(
      "</DurableScope>",
      `<OptionalContext>${contextEntryXml(names)}</OptionalContext></DurableScope>`,
    ),
  );
}

function optionalContextShapeIssues(root: string) {
  return validateNgraceProject(root).issues.filter(
    (issue) => issue.code === "change.plan-invalid-section-shape" && issue.message.includes("OptionalContext"),
  );
}

describe("C-GRAMMAR-SEAM T-003 OptionalContext bucket", () => {
  it("admits live optional members: grammar-clean, extracted, and overlapping", () => {
    const changeId = "C-OPT-ADMIT";
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    plantOptionalContext(root, changeId, NGRACE_OPTIONAL_CONTEXT_ARTIFACTS);

    expect(optionalContextShapeIssues(root)).toEqual([]);

    const scopes = collectActiveChangeScopes(resolveNgracePaths(root));
    const admitted = scopes.find((scope) => scope.changeId === changeId);
    expect(admitted?.issues.some((issue) => issue.code === "scope.invalid-durable-shape")).toBe(false);
    expect([...admitted?.durable.optionalContextArtifacts ?? []].sort()).toEqual(
      [...NGRACE_OPTIONAL_CONTEXT_ARTIFACTS].sort(),
    );

    const leftRoot = createProject();
    writeChange(leftRoot, "C-OPT-LEFT", { graphAnchor: "M-LEFT", file: "src/left.ts" });
    writeChange(leftRoot, "C-OPT-RIGHT", { graphAnchor: "M-RIGHT", file: "src/right.ts" });
    const shared = NGRACE_OPTIONAL_CONTEXT_ARTIFACTS[0]!;
    plantOptionalContext(leftRoot, "C-OPT-LEFT", [shared]);
    plantOptionalContext(leftRoot, "C-OPT-RIGHT", [shared]);
    const overlap = detectScopeOverlaps(collectActiveChangeScopes(resolveNgracePaths(leftRoot)));
    expect(overlap.some((issue) => issue.message.includes(shared))).toBe(true);
  });

  it("OptionalContext rejects a required context filename and an unknown filename", () => {
    const required = NGRACE_CONTEXT_ARTIFACTS[0]!;
    const unknown = "not-a-context-artifact.xml";
    const cases: Array<{ changeId: string; names: string[] }> = [
      { changeId: "C-OPT-REQ", names: [required] },
      { changeId: "C-OPT-UNK", names: [unknown] },
    ];
    for (const { changeId, names } of cases) {
      const root = createProject();
      writeChange(root, changeId, { graphAnchor: "M-OPT", file: "src/opt.ts" });
      plantOptionalContext(root, changeId, names);
      const scope = collectActiveChangeScopes(resolveNgracePaths(root)).find((entry) => entry.changeId === changeId);
      expect(scope?.issues.some((issue) => issue.code === "scope.invalid-context-artifact")).toBe(true);
      expect(scope?.durable.optionalContextArtifacts ?? []).not.toEqual(expect.arrayContaining(names));
      expect(scope?.durable.contextArtifacts ?? []).not.toEqual(expect.arrayContaining(names));
    }
  });

  it("direct ContextArtifact of an optional name still errors", () => {
    const root = createProject();
    writeChange(root, "C-OPT-DIRECT", {
      graphAnchor: "M-OPT",
      file: "src/opt.ts",
      contextArtifact: NGRACE_OPTIONAL_CONTEXT_ARTIFACTS[0],
    });
    const scope = collectActiveChangeScopes(resolveNgracePaths(root)).find((entry) => entry.changeId === "C-OPT-DIRECT");
    expect(scope?.issues.some((issue) => issue.code === "scope.invalid-context-artifact")).toBe(true);
  });
});

// C-DISCARD-PREFLIGHT-1-5087B21A T-002: the activated close-time write guard.
const SCOPE_GUARD_CHANGE = "C-DISCARD-PREFLIGHT-1-5087B21A";
const SCOPE_GUARD_BASE = "406049618506877cb4c3aebba0d707733563f334";
const SCOPE_GUARD_RECORD_DIR = "docs/plans/active/RM-GOVERNED-PATH/";
// Paid close: the allowed non-lifecycle set is exactly the eleven observable literal
// paths — the one forced source, the three forced tests/ratchet, and the seven
// RM-GOVERNED-PATH record XML files this bundle pays through. The ignored scratch
// buffer is outside the git-derived allowlist (audited separately by the close
// rehearsal's before/after bytes), and `decisions.md` is excluded, so a planted
// non-record write under the record directory still reddens.
const SCOPE_GUARD_ALLOWED_FILES = new Set([
  "src/grace-cursor.ts",
  "src/grace-cursor.test.ts",
  "src/artifact/scope.test.ts",
  "scripts/validate-record-retirement.test.ts",
  `${SCOPE_GUARD_RECORD_DIR}decisions.xml`,
  `${SCOPE_GUARD_RECORD_DIR}findings.xml`,
  `${SCOPE_GUARD_RECORD_DIR}findings-retired.xml`,
  `${SCOPE_GUARD_RECORD_DIR}rulings.xml`,
  `${SCOPE_GUARD_RECORD_DIR}rulings-retired.xml`,
  `${SCOPE_GUARD_RECORD_DIR}registry.xml`,
  `${SCOPE_GUARD_RECORD_DIR}registry-retired.xml`,
]);

/**
 * The tracked-diff evidence the guard consumes. Rename detection stays disabled.
 */
const SCOPE_GUARD_TRACKED_DIFF_ARGS = scopeGuardTrackedDiffArgs(SCOPE_GUARD_BASE);

/** The bundle's own lifecycle identities, recognized by exact id — never a blanket prefix. */
const SCOPE_GUARD_LIFECYCLE_FILES = new Set([
  `.ngrace/changes/active/${SCOPE_GUARD_CHANGE}/spec.xml`,
  `.ngrace/changes/active/${SCOPE_GUARD_CHANGE}/plan.xml`,
  `.ngrace/changes/active/${SCOPE_GUARD_CHANGE}/run-ledger.xml`,
  `.ngrace/changes/active/${SCOPE_GUARD_CHANGE}/run.xml`,
  `.ngrace/changes/archive/${SCOPE_GUARD_CHANGE}/spec.xml`,
  `.ngrace/changes/archive/${SCOPE_GUARD_CHANGE}/plan.xml`,
  `.ngrace/changes/archive/${SCOPE_GUARD_CHANGE}/run-ledger.xml`,
  `.ngrace/changes/archive/${SCOPE_GUARD_CHANGE}/run.xml`,
]);
const SCOPE_GUARD_RUN_PREFIXES = [
  `.ngrace/changes/active/${SCOPE_GUARD_CHANGE}/run/`,
  `.ngrace/changes/archive/${SCOPE_GUARD_CHANGE}/run/`,
];

/** The tracked-diff argument list for a given base; rename detection stays disabled. */
function scopeGuardTrackedDiffArgs(base: string): string[] {
  return ["diff", "--name-only", "--no-renames", base];
}

/**
 * One checked Git invocation supplies both availability and the parsed path lines.
 * The two must never come from separate spawns: a first success followed by a second
 * failure would report `{available: true, lines: []}` — a false clean.
 */
function gitEvidence(root: string, args: string[]): { available: boolean; lines: string[] } {
  const result = Bun.spawnSync({ cmd: ["git", "-C", root, ...args], stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    return { available: false, lines: [] };
  }
  return {
    available: true,
    lines: Buffer.from(result.stdout)
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

/** Files changed against the recorded base outside the closed allowed set. Refuses when git evidence is unavailable. */
function scopeGuardOffenders(root: string, base = SCOPE_GUARD_BASE): string[] {
  const tracked = gitEvidence(root, scopeGuardTrackedDiffArgs(base));
  const untracked = gitEvidence(root, ["ls-files", "--others", "--exclude-standard"]);
  if (!tracked.available || !untracked.available) {
    throw new Error("scope guard: git evidence unavailable; refusing rather than reporting clean");
  }
  const changed = [...new Set([...tracked.lines, ...untracked.lines])];
  return changed.filter((file) => {
    if (SCOPE_GUARD_LIFECYCLE_FILES.has(file)) {
      return false;
    }
    if (SCOPE_GUARD_RUN_PREFIXES.some((prefix) => file.startsWith(prefix) && file.endsWith(".xml"))) {
      return false;
    }
    return !SCOPE_GUARD_ALLOWED_FILES.has(file);
  });
}

/**
 * The guard's conditional entry. It is dormant — no evidence collected and no
 * offenders — unless the requested switch is exactly the successor id. The live
 * activated test and the dormant fixture both run this same path.
 */
function evaluateCloseTimeGuard(
  root: string,
  requestedSwitch: string,
  base = SCOPE_GUARD_BASE,
): { activated: boolean; offenders: string[] } {
  if (requestedSwitch !== SCOPE_GUARD_CHANGE) {
    return { activated: false, offenders: [] };
  }
  return { activated: true, offenders: scopeGuardOffenders(root, base) };
}

describe("close-time write guard", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..");
  const requested = (process.env.NGRACE_SCOPE_GUARD_CHANGE ?? "").trim();
  const activated = requested === SCOPE_GUARD_CHANGE;

  it("remains dormant when the switch names another change", () => {
    expect(evaluateCloseTimeGuard(repoRoot, "C-UNRELATED")).toEqual({ activated: false, offenders: [] });
  });

  it("activates exactly on the successor switch and is verifiably dormant otherwise", () => {
    const decision = evaluateCloseTimeGuard(repoRoot, requested);
    expect(decision.activated).toBe(requested === SCOPE_GUARD_CHANGE);
    if (decision.activated) {
      expect(decision.offenders).toEqual([]);
    } else {
      expect(decision.offenders, "dormant contributes no offenders").toEqual([]);
      expect(typeof collectActiveChangeScopes).toBe("function");
      expect(typeof observedWriteScopeContains).toBe("function");
    }
  });

  it("stays dormant on a later unrelated write without the exact switch, and the same fixture reddens when activated", () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "scope-guard-dormant-"));
    try {
      const git = (args: string[]) =>
        Bun.spawnSync({ cmd: ["git", "-C", fixture, ...args], stdout: "pipe", stderr: "pipe" });
      mkdirSync(path.join(fixture, "docs"), { recursive: true });
      writeFileSync(path.join(fixture, "seed.txt"), "seed\n");
      expect(git(["init"]).exitCode).toBe(0);
      expect(git(["config", "user.email", "guard@example.test"]).exitCode).toBe(0);
      expect(git(["config", "user.name", "Guard Test"]).exitCode).toBe(0);
      expect(git(["add", "."]).exitCode).toBe(0);
      expect(git(["commit", "-m", "baseline"]).exitCode).toBe(0);
      const base = Buffer.from(git(["rev-parse", "HEAD"]).stdout).toString("utf8").trim();
      // A later unrelated write of the same kind as a forbidden ordinary path.
      writeFileSync(path.join(fixture, "docs", "guard-probe.md"), "probe\n");
      // The raw offender collector sees it against this fixture's own base.
      expect(scopeGuardOffenders(fixture, base)).toContain("docs/guard-probe.md");
      // Without the exact switch the shared conditional path is dormant and does not fail.
      const dormant = evaluateCloseTimeGuard(fixture, "", base);
      expect(dormant.activated).toBe(false);
      expect(dormant.offenders).toEqual([]);
      // The exact successor switch against the same fixture fails on that planted path.
      const active = evaluateCloseTimeGuard(fixture, SCOPE_GUARD_CHANGE, base);
      expect(active.activated).toBe(true);
      expect(active.offenders).toContain("docs/guard-probe.md");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("confines the tracked-and-untracked change set to the closed allowed set when activated", () => {
    if (!activated) return;
    expect(scopeGuardOffenders(repoRoot)).toEqual([]);
  });

  it("has no predecessor supersede transition and recognizes only this bundle's lifecycle identities", () => {
    // Fresh slug: the git-derived population carries no other C-* bundle path, and
    // the bundle's own spec/plan/run identities are allowed by exact identity while
    // a planted non-lifecycle file under the same directory still reddens below.
    const tracked = gitEvidence(repoRoot, SCOPE_GUARD_TRACKED_DIFF_ARGS);
    expect(tracked.available).toBe(true);
    const untracked = gitEvidence(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
    expect(untracked.available).toBe(true);
    const changed = [...new Set([...tracked.lines, ...untracked.lines])];
    const foreignBundles = changed.filter(
      (file) => /^\.ngrace\/changes\/(active|archive)\/C-/.test(file) && !file.includes(SCOPE_GUARD_CHANGE),
    );
    expect(foreignBundles).toEqual([]);
    expect(scopeGuardOffenders(repoRoot)).toEqual([]);
  });

  it("reddens on a planted forbidden write when activated", () => {
    if (!activated) return;
    const probe = path.join(repoRoot, "docs", "guard-probe.md");
    writeFileSync(probe, "probe\n");
    try {
      expect(scopeGuardOffenders(repoRoot)).toContain("docs/guard-probe.md");
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("reddens on a planted non-record file inside the governed directory when activated", () => {
    if (!activated) return;
    const probe = path.join(repoRoot, "docs", "plans", "active", "RM-GOVERNED-PATH", "guard-probe.md");
    writeFileSync(probe, "probe\n");
    try {
      expect(scopeGuardOffenders(repoRoot)).toContain("docs/plans/active/RM-GOVERNED-PATH/guard-probe.md");
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("reddens on a planted non-lifecycle file inside the successor's own directory when activated", () => {
    if (!activated) return;
    const activeDir = path.join(repoRoot, ".ngrace", "changes", "active", SCOPE_GUARD_CHANGE);
    const archiveDir = path.join(repoRoot, ".ngrace", "changes", "archive", SCOPE_GUARD_CHANGE);
    const bundleDir = existsSync(activeDir) ? activeDir : archiveDir;
    const bundleLayer = existsSync(activeDir) ? "active" : "archive";
    const probe = path.join(bundleDir, "planted.md");
    writeFileSync(probe, "probe\n");
    try {
      expect(scopeGuardOffenders(repoRoot)).toContain(`.ngrace/changes/${bundleLayer}/${SCOPE_GUARD_CHANGE}/planted.md`);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("refuses rather than reporting clean when git evidence is unavailable", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "scope-guard-"));
    try {
      expect(() => scopeGuardOffenders(tmp)).toThrow(/git evidence unavailable/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("derives availability and paths from one checked git read, and refuses a false clean", () => {
    const originalSpawnSync = Bun.spawnSync;
    let invocations = 0;
    // Odd invocations succeed and name a forbidden path; even invocations fail with
    // exit 129 and empty stdout. The old helper spawned git twice per read, so its
    // availability check consumed the odd success while its parse silently consumed
    // the even failure — a false clean. A correct helper reads git exactly once, so
    // availability and the parsed lines come from the same checked invocation.
    const fakeSpawn = (() => {
      invocations += 1;
      const ok = invocations % 2 === 1;
      return {
        exitCode: ok ? 0 : 129,
        stdout: Buffer.from(ok ? "docs/forbidden.md\n" : ""),
        stderr: Buffer.from(""),
      };
    }) as unknown as typeof Bun.spawnSync;
    const fixture = mkdtempSync(path.join(os.tmpdir(), "scope-guard-one-read-"));
    (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = fakeSpawn;
    try {
      invocations = 0;
      const evidence = gitEvidence(fixture, SCOPE_GUARD_TRACKED_DIFF_ARGS);
      expect(evidence.available, "the checked read succeeded").toBe(true);
      expect(evidence.lines, "lines must come from the checked read, not a second one").toContain("docs/forbidden.md");
      expect(invocations, "gitEvidence must spawn git exactly once").toBe(1);

      invocations = 0;
      let outcome = "";
      try {
        const offenders = scopeGuardOffenders(fixture, SCOPE_GUARD_BASE);
        outcome = offenders.length === 0 ? "reported-clean" : `offenders:${offenders.join(",")}`;
      } catch (error) {
        outcome = `refused:${(error as Error).message}`;
      }
      expect(outcome, "a failing read must refuse, never report clean").toMatch(/refused:.*git evidence unavailable/);
    } finally {
      (Bun as unknown as { spawnSync: typeof Bun.spawnSync }).spawnSync = originalSpawnSync;
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
