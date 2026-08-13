import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { validateNgraceProject } from "./grammar";
import { ARTIFACT_DIR } from "./paths";
import { resolveNgracePaths } from "./project";
import {
  collectActiveChangeScopes,
  detectScopeOverlaps,
  detectUnsafeConcurrentExecution,
  durableOverlaps,
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
