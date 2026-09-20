import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-009: the activated close-time write guard.
const SCOPE_GUARD_CHANGE = "C-SUPERSEDE-MEMBERSHIP-4-20941257";
const SCOPE_GUARD_BASE = "13e60c68b326e437ccfe6bc2f2090ae4e148da1a";
const SCOPE_GUARD_RECORD_DIR = "docs/plans/active/RM-GOVERNED-PATH/";
const SCOPE_GUARD_RECORD_FILES = new Set([
  `${SCOPE_GUARD_RECORD_DIR}decisions.xml`,
  `${SCOPE_GUARD_RECORD_DIR}findings.xml`,
  `${SCOPE_GUARD_RECORD_DIR}findings-retired.xml`,
  `${SCOPE_GUARD_RECORD_DIR}rulings.xml`,
  `${SCOPE_GUARD_RECORD_DIR}rulings-retired.xml`,
  `${SCOPE_GUARD_RECORD_DIR}registry.xml`,
  `${SCOPE_GUARD_RECORD_DIR}registry-retired.xml`,
]);
const SCOPE_GUARD_ALLOWED_FILES = new Set([
  "src/grace-supersede.ts",
  "src/grace-generate.ts",
  "src/gates/ledger.ts",
  "src/grace-cursor.ts",
  "src/review/core.ts",
  "src/grace-supersede.test.ts",
  "src/grace-generate.test.ts",
  "src/grace-cursor.test.ts",
  "src/gates/core.test.ts",
  "src/review/core.test.ts",
  "src/artifact/scope.test.ts",
  "scripts/validate-record-retirement.test.ts",
  ...SCOPE_GUARD_RECORD_FILES,
]);
const SCOPE_GUARD_PREDECESSOR_FILES = new Set([
  ".ngrace/changes/active/C-SUPERSEDE-MEMBERSHIP-3-66400CCC/spec.xml",
  ".ngrace/changes/active/C-SUPERSEDE-MEMBERSHIP-3-66400CCC/plan.xml",
  ".ngrace/changes/active/C-SUPERSEDE-MEMBERSHIP-3-66400CCC/run-ledger.xml",
  ".ngrace/changes/archive/C-SUPERSEDE-MEMBERSHIP-3-66400CCC/spec.xml",
  ".ngrace/changes/archive/C-SUPERSEDE-MEMBERSHIP-3-66400CCC/plan.xml",
  ".ngrace/changes/archive/C-SUPERSEDE-MEMBERSHIP-3-66400CCC/run-ledger.xml",
]);

/**
 * The tracked-diff evidence the guard consumes. Rename detection MUST stay disabled:
 * with it on, git collapses the active predecessor `spec.xml`/`run-ledger.xml` into
 * the archive destinations and the guard never observes the contracted active
 * deletions (correction 1). One definition, shared with the direct evidence test.
 */
const SCOPE_GUARD_TRACKED_DIFF_ARGS = ["diff", "--name-only", "--no-renames", SCOPE_GUARD_BASE];
const SCOPE_GUARD_PREDECESSOR_ID = "C-SUPERSEDE-MEMBERSHIP-3-66400CCC";

const SCOPE_GUARD_ALLOWED_PREFIXES = [
  `.ngrace/changes/active/${SCOPE_GUARD_CHANGE}/`,
  `.ngrace/changes/archive/${SCOPE_GUARD_CHANGE}/`,
];

function gitLines(root: string, args: string[]): string[] {
  const result = Bun.spawnSync({ cmd: ["git", "-C", root, ...args], stdout: "pipe", stderr: "pipe" });
  return Buffer.from(result.stdout)
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitEvidence(root: string, args: string[]): { available: boolean; lines: string[] } {
  const result = Bun.spawnSync({ cmd: ["git", "-C", root, ...args], stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    return { available: false, lines: [] };
  }
  return { available: true, lines: gitLines(root, args) };
}

/** Files changed against the recorded base outside the closed allowed set. Refuses when git evidence is unavailable. */
function scopeGuardOffenders(root: string): string[] {
  const tracked = gitEvidence(root, SCOPE_GUARD_TRACKED_DIFF_ARGS);
  const untracked = gitEvidence(root, ["ls-files", "--others", "--exclude-standard"]);
  if (!tracked.available || !untracked.available) {
    throw new Error("scope guard: git evidence unavailable; refusing rather than reporting clean");
  }
  const changed = [...new Set([...tracked.lines, ...untracked.lines])];
  return changed.filter((file) => {
    if (file.startsWith(SCOPE_GUARD_RECORD_DIR)) {
      return !SCOPE_GUARD_RECORD_FILES.has(file);
    }
    if (SCOPE_GUARD_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      return false;
    }
    return !SCOPE_GUARD_ALLOWED_FILES.has(file) && !SCOPE_GUARD_PREDECESSOR_FILES.has(file);
  });
}

describe("close-time write guard", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..");
  const requested = (process.env.NGRACE_SCOPE_GUARD_CHANGE ?? "").trim();
  const activated = requested === SCOPE_GUARD_CHANGE;

  it("refuses an activation switch that names a different change id", () => {
    expect(requested === "" || requested === SCOPE_GUARD_CHANGE).toBe(true);
  });

  it("activates exactly on the successor switch and is verifiably dormant otherwise", () => {
    expect(activated).toBe(requested === SCOPE_GUARD_CHANGE);
    if (!activated) {
      expect(typeof collectActiveChangeScopes).toBe("function");
      expect(typeof observedWriteScopeContains).toBe("function");
    } else {
      expect(scopeGuardOffenders(repoRoot)).toEqual([]);
    }
  });

  it("confines the tracked-and-untracked change set to the closed allowed set when activated", () => {
    if (!activated) return;
    expect(scopeGuardOffenders(repoRoot)).toEqual([]);
  });

  it("consumes the exact five predecessor paths with rename detection disabled", () => {
    // Uses the same git-evidence helper and the same argument list as the guard, so
    // dropping `--no-renames` reds this test and the guard together.
    const evidence = gitEvidence(repoRoot, SCOPE_GUARD_TRACKED_DIFF_ARGS);
    expect(evidence.available).toBe(true);
    const predecessor = evidence.lines
      .filter((line) => line.includes(SCOPE_GUARD_PREDECESSOR_ID))
      .sort();
    expect(predecessor).toEqual([
      `.ngrace/changes/active/${SCOPE_GUARD_PREDECESSOR_ID}/run-ledger.xml`,
      `.ngrace/changes/active/${SCOPE_GUARD_PREDECESSOR_ID}/spec.xml`,
      `.ngrace/changes/archive/${SCOPE_GUARD_PREDECESSOR_ID}/plan.xml`,
      `.ngrace/changes/archive/${SCOPE_GUARD_PREDECESSOR_ID}/run-ledger.xml`,
      `.ngrace/changes/archive/${SCOPE_GUARD_PREDECESSOR_ID}/spec.xml`,
    ]);
    expect(predecessor).not.toContain(`.ngrace/changes/active/${SCOPE_GUARD_PREDECESSOR_ID}/plan.xml`);
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

  it("refuses rather than reporting clean when git evidence is unavailable", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "scope-guard-"));
    try {
      expect(() => scopeGuardOffenders(tmp)).toThrow(/git evidence unavailable/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
