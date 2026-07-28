import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, test } from "bun:test";

import { analyzeGovernedFile, hasRuntimeMarkerEvidence, parseGovernedFile } from "./project-utils";

function contract(mapMode: "EXPORTS" | "LOCALS" | "SUMMARY" | "NONE", moduleMap = ""): string {
  return `// START_MODULE_CONTRACT
// PURPOSE: Exercise semantic markup.
// SCOPE: Test-only fixture.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: ${mapMode === "LOCALS" ? "SCRIPT" : mapMode === "SUMMARY" ? "BARREL" : mapMode === "NONE" ? "CONFIG" : "RUNTIME"}
// MAP_MODE: ${mapMode}
// END_MODULE_CONTRACT
${moduleMap ? `// START_MODULE_MAP\n${moduleMap}\n// END_MODULE_MAP\n` : ""}`;
}

describe("governed file analysis", () => {
  it("parses the shared markup record and enforces exact TypeScript value/type export parity", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-markup-"));
    const file = path.join(root, "src", "example.ts");
    const text = `${contract("EXPORTS", "// value - Runtime value.\n// ExampleType - Public type.")}export const value = 1;\nexport type ExampleType = string;\n`;

    const record = parseGovernedFile(root, file, text);
    const analysis = analyzeGovernedFile(root, file, text);

    expect(record.path).toBe("src/example.ts");
    expect(record.linkedModuleIds).toEqual(["M-EXAMPLE"]);
    expect(record.moduleMap.map((item) => item.symbolName)).toEqual(["value", "ExampleType"]);
    expect(analysis.language?.exportConfidence).toBe("exact");
    expect(analysis.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("accepts bracketed and unbracketed LINKS lists while filtering non-module anchors", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-links-"));
    const file = path.join(root, "src", "example.ts");
    const links = (value: string) => parseGovernedFile(root, file, contract("NONE").replace("LINKS: M-EXAMPLE", `LINKS: ${value}`)).linkedModuleIds;

    expect(links("[M-ONE]")).toEqual(["M-ONE"]);
    expect(links("[M-ONE, M-TWO, V-M-ONE]")).toEqual(["M-ONE", "M-TWO"]);
    expect(links("M-ONE, M-TWO, V-M-ONE")).toEqual(["M-ONE", "M-TWO"]);
    expect(links("[none]")).toEqual([]);
    expect(links("none")).toEqual([]);
  });

  it("parses DEPENDS M-* and LINKS M-*/DF-*/V-M-* into separate fields", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-depends-links-"));
    const file = path.join(root, "src", "example.ts");
    const dependsBody = contract("NONE")
      .replace("DEPENDS: none", "DEPENDS: M-DB, postgres, M-CACHE")
      .replace("LINKS: M-EXAMPLE", "LINKS: M-AUTH, V-M-AUTH, DF-LOGIN");
    const record = parseGovernedFile(root, file, dependsBody);
    expect(record.dependsModuleIds).toEqual(["M-DB", "M-CACHE"]);
    expect(record.linkedModuleIds).toEqual(["M-AUTH", "DF-LOGIN"]);
    expect(record.linkedVerificationIds).toEqual(["V-M-AUTH"]);

    const verifOnly = parseGovernedFile(
      root,
      file,
      contract("NONE").replace("LINKS: M-EXAMPLE", "LINKS: V-M-AUTH"),
    );
    expect(verifOnly.linkedModuleIds).toEqual([]);
    expect(verifOnly.linkedVerificationIds).toEqual(["V-M-AUTH"]);

    const noneDepends = parseGovernedFile(root, file, contract("NONE"));
    expect(noneDepends.dependsModuleIds).toEqual([]);
  });

  it("reports line-addressed missing, reversed, duplicate, mismatched, and overlapping markers", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-markers-"));
    const file = path.join(root, "broken.ts");
    const text = `// END_BLOCK_REVERSED
// START_MODULE_CONTRACT
// START_MODULE_MAP
// END_MODULE_CONTRACT
// START_BLOCK_DUP
// END_BLOCK_DUP
// START_BLOCK_DUP
// END_BLOCK_OTHER
// START_CHANGE_SUMMARY
`;
    const issues = analyzeGovernedFile(root, file, text).issues;
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain("markup.reversed-marker");
    expect(codes).toContain("markup.overlapping-markers");
    expect(codes).toContain("markup.mismatched-marker");
    expect(codes).toContain("markup.duplicate-marker");
    expect(codes).toContain("markup.missing-end-marker");
    expect(issues.filter((issue) => issue.code.startsWith("markup.")).every((issue) => typeof issue.line === "number")).toBe(true);
  });

  it("parses properly nested semantic blocks without reporting overlap", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-nested-blocks-"));
    const file = path.join(root, "nested.ts");
    const text = `// START_BLOCK_OUTER
// START_BLOCK_INNER
export const value = true;
// END_BLOCK_INNER
// END_BLOCK_OUTER
`;

    expect(parseGovernedFile(root, file, text).blocks).toEqual([
      { name: "OUTER", startLine: 1, endLine: 5 },
      { name: "INNER", startLine: 2, endLine: 4 },
    ]);
    expect(analyzeGovernedFile(root, file, text).issues.map((issue) => issue.code)).not.toContain("markup.overlapping-markers");
  });

  it("does not manufacture an outer block from crossed nesting", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-crossed-blocks-"));
    const file = path.join(root, "crossed.ts");
    const text = `// START_BLOCK_OUTER
// START_BLOCK_INNER
// END_BLOCK_OUTER
// END_BLOCK_INNER
`;

    expect(parseGovernedFile(root, file, text).blocks.map((block) => block.name)).toEqual(["INNER"]);
    const codes = analyzeGovernedFile(root, file, text).issues.map((issue) => issue.code);
    expect(codes).toContain("markup.mismatched-marker");
    expect(codes).toContain("markup.missing-end-marker");
  });

  it("credits exact marker constants with identifier-aware boundaries", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    expect(hasRuntimeMarkerEvidence(`console.info("${marker} ok");`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`const marker$ = "${marker}";\nconsole.info(marker$ + " ok");`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`static let marker = "${marker}"\nlog.info("\\(marker) ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`const marker$ = "${marker}";\nconsole.info(marker$Other + " ok");`, marker)).toBe(false);
    expect(hasRuntimeMarkerEvidence(`const marker$ = "${marker}";\nreturn marker$;`, marker)).toBe(false);
    expect(hasRuntimeMarkerEvidence(`// const marker$ = "${marker}";\nconsole.info(marker$ + " ok");`, marker)).toBe(false);
  });

  it("credits Go const and Rust const marker assignments as indirect emission", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    expect(hasRuntimeMarkerEvidence(
      `const MARKER: &str = "${marker}";\ntracing::info!("{}", MARKER);`,
      marker,
      { filePath: "lib.rs" },
    )).toBe(true);
    expect(hasRuntimeMarkerEvidence(
      `const marker = "${marker}"\nslog.Info(marker)`,
      marker,
      { filePath: "router.go" },
    )).toBe(true);
  });

  it("emits analysis.no-adapter for EXPORTS/LOCALS on non-adapter code extensions", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-no-adapter-"));
    const rustBody = `// START_MODULE_CONTRACT
// PURPOSE: Rust fixture.
// SCOPE: Export post.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// post - Post an entry.
// END_MODULE_MAP
pub fn post() {}
`;
    // Phase 3: .rs and .go are adapter-backed — no analysis.no-adapter.
    const rustFile = path.join(root, "lib.rs");
    const rustIssues = analyzeGovernedFile(root, rustFile, rustBody).issues;
    expect(rustIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");

    const goBody = `// START_MODULE_CONTRACT
// PURPOSE: Go fixture.
// SCOPE: Export Route.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// Route - Dispatch.
// END_MODULE_MAP
package p
func Route() {}
`;
    const goIssues = analyzeGovernedFile(root, path.join(root, "router.go"), goBody).issues;
    expect(goIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");

    // Still no adapter for other CODE_EXTENSIONS (e.g. .java).
    const javaBody = rustBody.replace("pub fn post() {}", "public void post() {}");
    const javaIssues = analyzeGovernedFile(root, path.join(root, "Main.java"), javaBody).issues;
    expect(javaIssues.some((issue) => issue.code === "analysis.no-adapter" && issue.severity === "warning")).toBe(true);

    const summaryBody = javaBody.replace("MAP_MODE: EXPORTS", "MAP_MODE: SUMMARY").replace("ROLE: RUNTIME", "ROLE: BARREL");
    const summaryIssues = analyzeGovernedFile(root, path.join(root, "summary.java"), summaryBody).issues;
    expect(summaryIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");

    const noneBody = javaBody.replace("MAP_MODE: EXPORTS", "MAP_MODE: NONE").replace("ROLE: RUNTIME", "ROLE: CONFIG")
      .replace(/\/\/ START_MODULE_MAP[\s\S]*?\/\/ END_MODULE_MAP\n/, "");
    const noneIssues = analyzeGovernedFile(root, path.join(root, "config.java"), noneBody).issues;
    expect(noneIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");

    const acknowledged = analyzeGovernedFile(root, path.join(root, "Main.java"), javaBody, { unverifiedLanguages: [".java"] }).issues;
    expect(acknowledged.map((issue) => issue.code)).not.toContain("analysis.no-adapter");

    const tsBody = `${contract("EXPORTS", "// run - Run.\n")}export function run() {}\n`;
    const tsIssues = analyzeGovernedFile(root, path.join(root, "run.ts"), tsBody).issues;
    expect(tsIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");

    // 3-arg call (no options) still works and still warns for .java EXPORTS
    const threeArg = analyzeGovernedFile(root, path.join(root, "Main.java"), javaBody);
    expect(threeArg.issues.map((issue) => issue.code)).toContain("analysis.no-adapter");
  });

  it("emits bounded-confidence diagnostics for heuristic Python analysis", () => {
    const hasPython = ["python3", "python"].some((binary) => {
      const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
      return !result.error && result.status === 0;
    });
    if (!hasPython) {
      return;
    }
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-python-markup-"));
    const file = path.join(root, "example.py");
    const text = `# START_MODULE_CONTRACT
# PURPOSE: Python fixture.
# SCOPE: Export one function.
# DEPENDS: none
# LINKS: M-EXAMPLE
# ROLE: RUNTIME
# MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
# greet - Public greeting.
# END_MODULE_MAP
def greet():
    return "hello"
`;
    const analysis = analyzeGovernedFile(root, file, text);
    expect(analysis.language?.exportConfidence).toBe("heuristic");
    expect(analysis.issues.map((issue) => issue.code)).toContain("analysis.heuristic-confidence");
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("markup.module-map-mismatch");
  });

  it("preserves Unicode identifiers in exact Python MODULE_MAP parity", () => {
    const hasPython = ["python3", "python"].some((binary) => {
      const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
      return !result.error && result.status === 0;
    });
    if (!hasPython) return;

    const root = mkdtempSync(path.join(os.tmpdir(), "grace-python-unicode-map-"));
    const file = path.join(root, "example.py");
    const text = `# START_MODULE_CONTRACT
# PURPOSE: Unicode Python fixture.
# SCOPE: Export one Unicode function.
# DEPENDS: none
# LINKS: M-EXAMPLE
# ROLE: RUNTIME
# MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
# привет - Public greeting.
# END_MODULE_MAP
__all__ = ["привет"]
def привет():
    return "hello"
`;
    const analysis = analyzeGovernedFile(root, file, text);
    expect(analysis.record.moduleMap[0]?.symbolName).toBe("привет");
    expect(analysis.language?.exportConfidence).toBe("exact");
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("markup.module-map-mismatch");
  });

  test("missing required language runtimes surface an actionable dedicated diagnostic without crashing", () => {
    const script = `import { analyzeGovernedFile } from "./src/project-utils.ts";
const text = ${JSON.stringify(`${contract("EXPORTS", "# greet - Greeting.").replaceAll("//", "#")}def greet():\n    return "hi"\n`)};
const result = analyzeGovernedFile(process.cwd(), process.cwd() + "/example.py", text);
console.log(JSON.stringify(result.issues));`;
    const run = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: path.resolve(import.meta.dir, ".."),
      env: { ...process.env, PATH: mkdtempSync(path.join(os.tmpdir(), "grace-empty-path-")) },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    const issues = JSON.parse(Buffer.from(run.stdout).toString("utf8")) as Array<{ code: string; message: string }>;
    expect(issues.map((issue) => issue.code)).toContain("analysis.runtime-missing");
    expect(issues.find((issue) => issue.code === "analysis.runtime-missing")?.message).toContain("Install Python");
  });

  test("present but failing language runtimes surface analysis.adapter-failed without fallback", () => {
    const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "grace-broken-python-"));
    const python = path.join(runtimeDir, "python3");
    writeFileSync(python, "#!/bin/sh\nexit 17\n");
    chmodSync(python, 0o755);
    const script = `import { analyzeGovernedFile } from "./src/project-utils.ts";
const text = ${JSON.stringify(`${contract("EXPORTS", "# greet - Greeting.").replaceAll("//", "#")}def greet():\n    return "hi"\n`)};
const result = analyzeGovernedFile(process.cwd(), process.cwd() + "/example.py", text);
console.log(JSON.stringify(result.issues));`;
    const run = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: path.resolve(import.meta.dir, ".."),
      env: { ...process.env, PATH: runtimeDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    const issues = JSON.parse(Buffer.from(run.stdout).toString("utf8")) as Array<{ code: string }>;
    expect(issues.map((issue) => issue.code)).toContain("analysis.adapter-failed");
    expect(issues.map((issue) => issue.code)).not.toContain("analysis.runtime-missing");
  });
});
