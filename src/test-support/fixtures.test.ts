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

  it("polyglotFixture module health encodes G-02 marker false-block", () => {
    // Gap G-02: hasRuntimeMarkerEvidence only matches JS/TS emission shapes.
    // Idiomatic tracing::warn! / slog.Info marker lines are not credited, so
    // both backend modules are blocked. Phase 1 inverts this.
    //
    // The whole fixture shape is pinned, not just the one module: the two
    // backend modules must be blocked by that single code and nothing else,
    // and the UI module must be healthy. An unintended blocker anywhere would
    // make Phase 1's inversion ambiguous.
    const root = polyglotFixture();
    const index = loadGraceArtifactIndex(root);

    for (const moduleId of ["M-LEDGER-CORE", "M-GATEWAY-ROUTER"]) {
      const health = buildModuleHealth(index, resolveModule(index, moduleId));
      expect(health.state).toBe("blocked");
      expect(health.blockers.map((b) => b.code)).toEqual(["health.required-log-marker-not-found"]);
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
