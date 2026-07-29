import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveNgracePaths } from "./project";
import { buildGraphProjection, buildVerificationProjection, stateMatchesEvidence } from "./projections";
import { writeMinimalNgraceProject } from "./test-fixtures";
import { ARTIFACT_DIR } from "./paths";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-design-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

describe("stateMatchesEvidence", () => {
  it("matches state body case-insensitively with hyphen as word separator", () => {
    expect(stateMatchesEvidence("ST-ERROR", "error state announced")).toBe(true);
    expect(stateMatchesEvidence("ST-ERROR", "ERROR path")).toBe(true);
    expect(stateMatchesEvidence("ST-FOCUS-VISIBLE", "focus visible outline")).toBe(true);
    expect(stateMatchesEvidence("ST-FOCUS-VISIBLE", "focus-visible ring")).toBe(true);
    expect(stateMatchesEvidence("ST-FOCUS-VISIBLE", "FOCUSVISIBLE")).toBe(true);
    expect(stateMatchesEvidence("ST-ERROR", "default render")).toBe(false);
    expect(stateMatchesEvidence("ST-LOADING", "loaded completely")).toBe(false);
  });

  it("requires whole words so a longer word never counts as evidence", () => {
    // Substring matching reported coverage that did not exist: the state check would
    // pass on text that never mentions the state.
    expect(stateMatchesEvidence("ST-LOADING", "downloading assets from the CDN")).toBe(false);
    expect(stateMatchesEvidence("ST-ERROR", "terror scenario")).toBe(false);
    expect(stateMatchesEvidence("ST-ON", "the comparison is done")).toBe(false);
    expect(stateMatchesEvidence("ST-DEFAULT", "defaults to compact")).toBe(false);

    expect(stateMatchesEvidence("ST-LOADING", "shows a loading spinner")).toBe(true);
    expect(stateMatchesEvidence("ST-ERROR", "renders the error banner")).toBe(true);
    expect(stateMatchesEvidence("ST-FOCUS-VISIBLE", "focusVisible ring is drawn")).toBe(true);
  });
});

describe("module Type and States projection", () => {
  it("warns on unknown module Type without erroring", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example</Summary><Path>src/example.ts</Path><Type>NONSENSE</Type></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
    );
    const graph = buildGraphProjection(resolveNgracePaths(root));
    const warning = graph.issues.find((i) => i.code === "graph.unknown-module-type");
    expect(warning?.severity).toBe("warning");
    expect(graph.modules.get("M-EXAMPLE")?.moduleType).toBe("NONSENSE");
  });

  it("collects ST-* states and AccessibilityCheck / VisualCheck evidence", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>UI</Summary><Path>src/example.ts</Path><Type>UI_COMPONENT</Type><States><ST-DEFAULT /><ST-EMPTY /></States></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test</Command><Scenario>default render</Scenario><AccessibilityCheck><Tool>axe</Tool><Command>bun run a11y</Command></AccessibilityCheck><VisualCheck><Tool>playwright</Tool><Command>bun run visual</Command><Baseline>baselines/ui.png</Baseline><Viewports><BP-MOBILE /></Viewports></VisualCheck></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
    );
    const paths = resolveNgracePaths(root);
    const graph = buildGraphProjection(paths);
    expect(graph.modules.get("M-EXAMPLE")?.states).toEqual(["ST-DEFAULT", "ST-EMPTY"]);
    expect(graph.modules.get("M-EXAMPLE")?.moduleType).toBe("UI_COMPONENT");

    const verification = buildVerificationProjection(paths, graph);
    const entry = verification.entries.get("V-M-EXAMPLE");
    expect(entry?.accessibilityChecks.some((t) => t.includes("axe"))).toBe(true);
    expect(entry?.visualChecks.some((t) => t.includes("playwright"))).toBe(true);
  });
});
