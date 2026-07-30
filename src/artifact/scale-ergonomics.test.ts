import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { collectDoctorReport } from "../grace-doctor";
import { extractAnchorSerialization, planGraphSplit } from "../grace-graph";
import { lintGraceProject } from "../grace-lint";
import { getLintIssueGuide } from "../lint/catalog";
import { validateNgraceProject } from "./grammar";
import { writeMinimalNgraceProject } from "./test-fixtures";
import { parseGraceXmlArtifact } from "./xml";
import { serializeGraceXmlNode } from "./xml-serialize";
import { ARTIFACT_DIR } from "./paths";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-scale-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function codes(issues: Array<{ code: string }>) {
  return issues.map((issue) => issue.code);
}

function writeTwoModuleProject(root: string) {
  writeMinimalNgraceProject(root);
  writeProjectFile(root, "services/api/router.go", "package router\n");
  writeProjectFile(root, "apps/web/App.tsx", "export const App = () => null;\n");
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-API-ROUTER /><M-WEB-APP /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
      + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
      + `<M-API-ROUTER><Summary>API router.</Summary><Path>services/api/router.go</Path></M-API-ROUTER>`
      + `<M-WEB-APP><Summary>Web app.</Summary><Path>apps/web/App.tsx</Path></M-WEB-APP>`
      + `</GD-MAIN></NgraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-API-ROUTER /><V-M-WEB-APP /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/main.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN>`
      + `<V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario></V-M-EXAMPLE>`
      + `<V-M-API-ROUTER><Command>echo ok</Command><Scenario>ok</Scenario></V-M-API-ROUTER>`
      + `<V-M-WEB-APP><Command>echo ok</Command><Scenario>ok</Scenario></V-M-WEB-APP>`
      + `</VD-MAIN></NgraceVerificationDocument>`,
  );
}

function snapshotTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.set(path.relative(root, absolute).replaceAll("\\", "/"), readFileSync(absolute, "utf8"));
      }
    }
  };
  walk(root);
  return files;
}

describe("Phase 8 — document size warnings", () => {
  it("warns only when anchor or byte limit is exceeded; never as error", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, ".ngrace-lint.json", JSON.stringify({ documentAnchorLimit: 1, documentByteLimit: 1_000_000 }));
    // Minimal project has 1 module in GD-MAIN → at limit 1 is NOT over (> limit). Add second module.
    writeProjectFile(root, "src/second.ts", "export const s = 1;\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-SECOND /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
        + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
        + `<M-SECOND><Summary>Second.</Summary><Path>src/second.ts</Path></M-SECOND>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-SECOND /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN>`
        + `<V-M-EXAMPLE><Command>echo</Command><Scenario>ok</Scenario></V-M-EXAMPLE>`
        + `<V-M-SECOND><Command>echo</Command><Scenario>ok</Scenario></V-M-SECOND>`
        + `</VD-MAIN></NgraceVerificationDocument>`,
    );

    const result = lintGraceProject(root);
    const sizeIssues = result.issues.filter((i) => i.code === "graph.document-too-large");
    expect(sizeIssues.length).toBeGreaterThanOrEqual(1);
    expect(sizeIssues.every((i) => i.severity === "warning")).toBe(true);
    expect(sizeIssues[0]?.message).toContain("GD-MAIN");
    expect(sizeIssues[0]?.message).toContain("ngrace graph split");
    // Fail-on errors still green: warnings only.
    expect(result.summary.errors).toBe(0);
  });

  it("respects raised documentAnchorLimit (no warning)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, ".ngrace-lint.json", JSON.stringify({ documentAnchorLimit: 500, documentByteLimit: 5_000_000 }));
    const result = lintGraceProject(root);
    expect(result.issues.filter((i) => i.code.endsWith("document-too-large"))).toHaveLength(0);
  });
});

describe("Phase 8 — multi-stack NgraceTechnology", () => {
  it("keeps flat Language/Runtime technology valid", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    expect(validateNgraceProject(root).issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("accepts Stacks with contained existing roots", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "apps/web"), { recursive: true });
    mkdirSync(path.join(root, "services/api"), { recursive: true });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/technology.xml`,
      `<NgraceTechnology graceVersion="1.0"><Stacks>`
        + `<Stack-WEB><Language>TypeScript</Language><Root>apps/web</Root></Stack-WEB>`
        + `<Stack-API><Language>Go</Language><Root>services/api</Root></Stack-API>`
        + `</Stacks></NgraceTechnology>`,
    );
    const resultCodes = codes(validateNgraceProject(root).issues);
    expect(resultCodes.filter((c) => c.startsWith("context.technology."))).toEqual([]);
  });

  it("rejects non-anchor children of Stacks (zero-or-more shape check)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/technology.xml`,
      `<NgraceTechnology graceVersion="1.0"><Stacks><Module>WEB</Module></Stacks></NgraceTechnology>`,
    );
    expect(codes(validateNgraceProject(root).issues)).toContain("context.technology.invalid-stack");
  });

  it("rejects Stack Root that escapes the project", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/technology.xml`,
      `<NgraceTechnology graceVersion="1.0"><Stacks><Stack-WEB><Root>../../etc</Root></Stack-WEB></Stacks></NgraceTechnology>`,
    );
    expect(codes(validateNgraceProject(root).issues)).toContain("context.technology.invalid-stack-root");
  });

  it("rejects missing Stack Root on disk", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/technology.xml`,
      `<NgraceTechnology graceVersion="1.0"><Stacks><Stack-WEB><Root>apps/missing</Root></Stack-WEB></Stacks></NgraceTechnology>`,
    );
    expect(codes(validateNgraceProject(root).issues)).toContain("context.technology.stack-root-missing");
  });
});

describe("Phase 8 — XML serializer fidelity", () => {
  it("reproduces authored anchor content exactly for the forms GRACE artifacts use", () => {
    for (const source of [
      `<M-A><Summary>Ledger.</Summary><Path>src/a.ts</Path></M-A>`,
      `<M-A><Summary>S.</Summary><States><ST-DEFAULT /></States></M-A>`,
      `<DF-F><Step order="1"><M-B /></Step></DF-F>`,
      `<M-A><Summary>Tom &amp; Jerry</Summary></M-A>`,
      `<M-A><Summary>a &lt; b</Summary></M-A>`,
      `<M-A><Summary>&#169; 2026</Summary></M-A>`,
      `<M-A><Summary>&#xA9; 2026</Summary></M-A>`,
      `<M-A><Summary>say "hi"</Summary></M-A>`,
    ]) {
      const parsed = parseGraceXmlArtifact("t.xml", source);
      expect(parsed.root).toBeTruthy();
      expect(serializeGraceXmlNode(parsed.root!)).toBe(source);
    }
  });
});

describe("Phase 8 — ngrace doctor", () => {
  it("is strictly read-only (directory snapshot unchanged)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    const before = snapshotTree(root);
    const report = collectDoctorReport(root);
    const after = snapshotTree(root);
    expect(after).toEqual(before);
    expect(report.tool).toBe("grace-doctor");
    expect(report.adapters.some((a) => a.id === "js-ts")).toBe(true);
    expect(report.optionalContextArtifacts.map((a) => a.file).sort()).toEqual(
      ["design-system.xml", "invariants.xml"].sort(),
    );
  });
});

describe("Phase 8 — ngrace graph split", () => {
  it("defaults to dry-run and writes nothing", () => {
    const root = createProject();
    writeTwoModuleProject(root);
    const before = snapshotTree(root);
    const plan = planGraphSplit(root, { pathPrefix: "services/api" });
    expect(plan.dryRun).toBe(true);
    expect(plan.applied).toBe(false);
    expect(plan.moves.map((m) => m.anchorId)).toEqual(["M-API-ROUTER"]);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("applies a split and preserves anchor serialization byte-for-byte", () => {
    const root = createProject();
    writeTwoModuleProject(root);

    const mainBefore = path.join(root, `${ARTIFACT_DIR}/graph/main.xml`);
    const serializedBefore = extractAnchorSerialization(mainBefore, "M-API-ROUTER");
    expect(serializedBefore).toBeTruthy();

    const beforeErrorCodes = lintGraceProject(root).issues
      .filter((i) => i.severity === "error")
      .map((i) => i.code)
      .sort();

    const plan = planGraphSplit(root, {
      pathPrefix: "services/api",
      apply: true,
      allowDirty: true,
    });
    expect(plan.applied).toBe(true);
    expect(existsSync(path.join(root, ".ngrace", plan.newDocumentRelativePath))).toBe(true);

    const newFile = path.join(root, `${ARTIFACT_DIR}`, plan.newDocumentRelativePath);
    const serializedAfter = extractAnchorSerialization(newFile, "M-API-ROUTER");
    expect(serializedAfter).toBe(serializedBefore);

    const after = lintGraceProject(root);
    expect(after.summary.errors).toBe(0);
    expect(after.issues.filter((i) => i.severity === "error").map((i) => i.code).sort()).toEqual(beforeErrorCodes);
    // Moved module is no longer in main.xml.
    expect(extractAnchorSerialization(mainBefore, "M-API-ROUTER")).toBeNull();
  });

  it("preserves numeric character references in the written bytes", () => {
    // The existing round-trip test compares one serialization to another, so a serializer
    // bug cancels out on both sides. Compare against the authored source text instead.
    const root = createProject();
    writeTwoModuleProject(root);
    const mainFile = path.join(root, `${ARTIFACT_DIR}/graph/main.xml`);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      readFileSync(mainFile, "utf8").replace("<Summary>API router.</Summary>", "<Summary>Router &#169; 2026 &amp; co, a &lt; b</Summary>"),
    );

    const plan = planGraphSplit(root, { pathPrefix: "services/api", apply: true, allowDirty: true });
    const written = readFileSync(path.join(root, `${ARTIFACT_DIR}`, plan.newDocumentRelativePath), "utf8");

    expect(written).toContain("Router &#169; 2026 &amp; co, a &lt; b");
    expect(written).not.toContain("&amp;#169;");
    expect(lintGraceProject(root).summary.errors).toBe(0);
  });

  it("refuses to overwrite an existing file at the new document path", () => {
    // The GD-id collision check looks at ids, not files. A document indexed under a
    // different id whose Path happens to be the derived slug slips past it, and the
    // split would then overwrite a live graph document.
    const root = createProject();
    writeTwoModuleProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments>`
        + `<GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-API-ROUTER /></Owns></GD-MAIN>`
        + `<GD-OTHER><Path>graph/services-api.xml</Path><Owns><M-WEB-APP /></Owns></GD-OTHER>`
        + `</GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
        + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
        + `<M-API-ROUTER><Summary>API router.</Summary><Path>services/api/router.go</Path></M-API-ROUTER>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/services-api.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-OTHER><M-WEB-APP><Summary>Web app.</Summary><Path>apps/web/App.tsx</Path></M-WEB-APP></GD-OTHER></NgraceGraphDocument>`,
    );
    const collidingBefore = readFileSync(path.join(root, `${ARTIFACT_DIR}/graph/services-api.xml`), "utf8");

    expect(() => planGraphSplit(root, { pathPrefix: "services/api", apply: true, allowDirty: true })).toThrow(/already exists/);
    expect(readFileSync(path.join(root, ".ngrace/graph/services-api.xml"), "utf8")).toBe(collidingBefore);
    // Staged writes mean the refusal left the source document untouched too.
    expect(extractAnchorSerialization(path.join(root, ".ngrace/graph/main.xml"), "M-API-ROUTER")).toBeTruthy();
  });

  it("refuses --apply on a dirty git worktree without --allow-dirty", () => {
    const root = createProject();
    writeTwoModuleProject(root);
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "t@test"], cwd: root, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "t"], cwd: root, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync({ cmd: ["git", "config", "commit.gpgsign", "false"], cwd: root, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "base"], cwd: root, stdout: "pipe", stderr: "pipe" });
    writeProjectFile(root, "dirty.txt", "uncommitted\n");

    expect(() => planGraphSplit(root, { pathPrefix: "services/api", apply: true })).toThrow(/dirty/i);
    // allowDirty succeeds
    const plan = planGraphSplit(root, { pathPrefix: "services/api", apply: true, allowDirty: true });
    expect(plan.applied).toBe(true);
  });
});

describe("Phase 8 — post-split lint parity (integration)", () => {
  it("produces an identical error issue-code multiset after split", () => {
    const root = createProject();
    writeTwoModuleProject(root);
    const before = lintGraceProject(root);
    const beforeErrorCodes = before.issues.filter((i) => i.severity === "error").map((i) => i.code).sort();

    planGraphSplit(root, { pathPrefix: "apps/web", apply: true, allowDirty: true });

    const after = lintGraceProject(root);
    const afterErrorCodes = after.issues.filter((i) => i.severity === "error").map((i) => i.code).sort();
    expect(afterErrorCodes).toEqual(beforeErrorCodes);
    expect(after.summary.errors).toBe(before.summary.errors);
  });
});

describe("Phase 8 — packaging and catalog pins", () => {
  it("registers dedicated catalog guides for document-too-large codes", () => {
    expect(getLintIssueGuide("graph.document-too-large").title).toContain("Graph Document Too Large");
    expect(getLintIssueGuide("verification.document-too-large").title).toContain("Verification Document Too Large");
    expect(getLintIssueGuide("graph.document-too-large").remediation.some((r) => r.includes("graph split"))).toBe(true);
  });

  it("publishes grace-doctor, grace-graph, and grace-cursor in package.json#files", () => {
    const pkg = JSON.parse(readFileSync(path.join(import.meta.dir, "../../package.json"), "utf8")) as {
      files: string[];
    };
    expect(pkg.files).toContain("src/grace-doctor.ts");
    expect(pkg.files).toContain("src/grace-graph.ts");
    expect(pkg.files).toContain("src/grace-cursor.ts");
  });

  it("wires doctor and graph through the grace CLI", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    const repoRoot = path.resolve(import.meta.dir, "../..");
    const doctor = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "doctor", "--path", root, "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(doctor.exitCode).toBe(0);
    const doctorJson = JSON.parse(Buffer.from(doctor.stdout).toString("utf8"));
    expect(doctorJson.tool).toBe("grace-doctor");

    writeTwoModuleProject(root);
    const split = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "graph", "split", "--by", "services/api", "--path", root, "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(split.exitCode).toBe(0);
    const splitJson = JSON.parse(Buffer.from(split.stdout).toString("utf8"));
    expect(splitJson.dryRun).toBe(true);
    expect(splitJson.moves.some((m: { anchorId: string }) => m.anchorId === "M-API-ROUTER")).toBe(true);
  });
});
