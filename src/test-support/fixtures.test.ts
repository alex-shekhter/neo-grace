import { describe, expect, it } from "bun:test";

import { lintGraceProject } from "../lint/core";
import { loadGraceArtifactIndex, resolveModule } from "../query/core";
import { buildModuleHealth } from "../query/health";
import {
  GraceProjectBuilder,
  createTempProject,
  minimalTsFixture,
  polyglotFixture,
  scaleFixture,
  snapshotProjectTree,
} from "./fixtures";

describe("test-support fixtures", () => {
  it("minimalTsFixture lints clean", () => {
    const root = minimalTsFixture();
    const result = lintGraceProject(root);
    expect(result.summary.errors).toBe(0);
  });

  it("polyglotFixture lints clean at HEAD", () => {
    // Pre-fix baseline: Rust/Go MODULE_MAP parity is silently skipped (G-01),
    // so lint reports zero errors. Phase 1 will add analysis.no-adapter warnings
    // without turning them into errors.
    const root = polyglotFixture();
    const result = lintGraceProject(root);
    expect(result.summary.errors).toBe(0);
  });

  it("polyglotFixture module health credits Rust/Go marker emission (G-02 fixed)", () => {
    // Phase 1 inverted the pre-fix G-02 assertion: idiomatic tracing::warn!
    // and slog.Info now count as marker evidence, so backend modules are ready.
    const root = polyglotFixture();
    const index = loadGraceArtifactIndex(root);

    for (const moduleId of ["M-LEDGER-CORE", "M-GATEWAY-ROUTER"]) {
      const health = buildModuleHealth(index, resolveModule(index, moduleId));
      expect(health.blockers.map((b) => b.code)).not.toContain("health.required-log-marker-not-found");
      expect(health.state).toBe("ready");
    }

    const uiHealth = buildModuleHealth(index, resolveModule(index, "M-WEB-LEDGER-TABLE"));
    expect(uiHealth.blockers).toEqual([]);
    expect(uiHealth.state).toBe("ready");
  });

  it("writes change bundles that pass grammar validation", () => {
    // The change() path is otherwise unexercised, and Phase 5 depends on it for
    // spec->plan traceability. Catch a malformed bundle writer here, not there.
    const root = new GraceProjectBuilder(createTempProject("grace-change-"))
      .module({ id: "M-EXAMPLE", path: "src/example.ts", summary: "Example" })
      .governedFile({
        path: "src/example.ts",
        links: ["M-EXAMPLE"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["run - Run the example."],
        body: "export function run() { return 1; }\n",
      })
      .verification({ moduleId: "M-EXAMPLE", commands: ["echo example"], scenarios: ["Example works."] })
      .change({ changeId: "C-FIXTURE-ACTIVE", specStatus: "approved", planStatus: "approved" })
      .change({ changeId: "C-FIXTURE-DONE", location: "archive", specStatus: "applied", planStatus: "applied" })
      .write();

    expect(lintGraceProject(root).summary.errors).toBe(0);
  });

  it("scaleFixture(50) lints clean", () => {
    const root = scaleFixture(50);
    const result = lintGraceProject(root);
    expect(result.summary.errors).toBe(0);
  });

  it("§0.7.4: markup.near-miss-marker is not an error on clean fixtures (A8)", () => {
    // Warning-only code; errors must stay empty. Report codes per fixture for the phase table.
    const table: Array<{ name: string; nearMiss: string[] }> = [];
    for (const [name, root] of [
      ["polyglotFixture()", polyglotFixture()],
      ["minimalTsFixture()", minimalTsFixture()],
      ["scaleFixture(20)", scaleFixture(20)],
    ] as const) {
      const result = lintGraceProject(root);
      expect(result.summary.errors, name).toBe(0);
      table.push({
        name,
        nearMiss: result.issues.filter((i) => i.code === "markup.near-miss-marker").map((i) => i.code),
      });
    }
    // Clean fixtures must not invent near-miss warnings.
    for (const row of table) {
      expect(row.nearMiss, row.name).toEqual([]);
    }
  });

  it("builder is deterministic", () => {
    const left = new GraceProjectBuilder(createTempProject("grace-det-a-"))
      .module({ id: "M-A", path: "src/a.ts", summary: "A" })
      .governedFile({
        path: "src/a.ts",
        purpose: "A",
        scope: "A",
        depends: ["none"],
        links: ["M-A"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["a - A export."],
        body: "export function a() { return 1; }\n",
      })
      .verification({
        moduleId: "M-A",
        commands: ["echo a"],
        scenarios: ["A works."],
      })
      .write();

    const right = new GraceProjectBuilder(createTempProject("grace-det-b-"))
      .module({ id: "M-A", path: "src/a.ts", summary: "A" })
      .governedFile({
        path: "src/a.ts",
        purpose: "A",
        scope: "A",
        depends: ["none"],
        links: ["M-A"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["a - A export."],
        body: "export function a() { return 1; }\n",
      })
      .verification({
        moduleId: "M-A",
        commands: ["echo a"],
        scenarios: ["A works."],
      })
      .write();

    expect(snapshotProjectTree(left)).toEqual(snapshotProjectTree(right));
  });
});
