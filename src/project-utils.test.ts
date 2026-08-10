import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, test } from "bun:test";

import {
  analyzeGovernedFile,
  collectNearMissMarkerIssues,
  hasGraceMarkers,
  hasRuntimeMarkerEvidence,
  parseGovernedFile,
  stripQuotedStrings,
} from "./project-utils";

function contract(mapMode: "EXPORTS" | "LOCALS" | "SUMMARY" | "NONE", moduleMap = ""): string {
  // Nested templates are safe again after stripQuotedStrings handles `${...}`
  // (A3.3 / corpus-re-03). Phase 1's concatenation workaround is no longer required.
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

describe("stripQuotedStrings / hasGraceMarkers (nested templates)", () => {
  it("does not treat nested-template fixture markers as real markup (corpus-re-03 shape)", () => {
    // Pre-Phase-1 contract() shape that defeated the stripper before ${} handling.
    const source = `function contract(mapMode: string, moduleMap = "") {
  return \`// START_MODULE_CONTRACT
// PURPOSE: Exercise semantic markup.
// SCOPE: Test-only fixture.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: \${mapMode}
// END_MODULE_CONTRACT
\${moduleMap ? \`// START_MODULE_MAP
\${moduleMap}
// END_MODULE_MAP\` : ""}\`;
}
`;
    expect(hasGraceMarkers(source)).toBe(false);
    const stripped = stripQuotedStrings(source);
    expect(stripped).not.toMatch(/START_MODULE_CONTRACT/);
    expect(stripped).not.toMatch(/START_MODULE_MAP/);
  });

  it("still detects real comment markers outside strings", () => {
    expect(hasGraceMarkers("// START_MODULE_CONTRACT\n// END_MODULE_CONTRACT\n")).toBe(true);
  });

  it("does not treat near-miss marker names as real markup", () => {
    expect(hasGraceMarkers("// START_MODULE_CONTRACTX\n")).toBe(false);
    expect(hasGraceMarkers("// START_MODULE_MAPPER\n")).toBe(false);
    expect(hasGraceMarkers("// START_BLOCK_RUN\n// END_BLOCK_RUN\n")).toBe(true);
    expect(hasGraceMarkers("// START_BLOCK_foo\n")).toBe(false);
  });

  it("reports markup.near-miss-marker without governing the file (A8)", () => {
    // Controls that must warn (marker-shaped: token, or token + one name).
    for (const src of [
      "// START_MODULE_CONTRACTX\n",
      "// START_CONTRACTX\n",
      "// START_CONTRACT IC-X\n",
      "// START_BLOCK_foo\n",
    ]) {
      expect(hasGraceMarkers(src), src).toBe(false);
      const issues = collectNearMissMarkerIssues("src/control.ts", src);
      expect(issues, src).toHaveLength(1);
      expect(issues[0]!.code).toBe("markup.near-miss-marker");
      expect(issues[0]!.severity).toBe("warning");
    }

    // Exact markers are not near-misses.
    expect(collectNearMissMarkerIssues("src/c.ts", "// START_MODULE_CONTRACT\n// END_MODULE_CONTRACT\n")).toEqual([]);
    expect(collectNearMissMarkerIssues("src/d.ts", "// START_BLOCK_RUN\n// END_BLOCK_RUN\n")).toEqual([]);

    // Contract-block family: exact colon form quiet.
    const validScoped = "// START_CONTRACT: IC-X\n// END_CONTRACT: IC-X\n";
    expect(hasGraceMarkers(validScoped)).toBe(true);
    expect(collectNearMissMarkerIssues("src/e.ts", validScoped)).toEqual([]);

    // String contents are not comments after stripQuotedStrings — no false positive.
    const inString = 'const doc = "// START_CONTRACTX";\nconst other = `// END_CONTRACTX`;\n';
    expect(hasGraceMarkers(inString)).toBe(false);
    expect(collectNearMissMarkerIssues("src/h.ts", inString)).toEqual([]);

    // §0.7.3 syntax-inside-prose: multi-token comments that mention each marker family stay quiet.
    const prose = [
      "// Authors who mistype START_MODULE_CONTRACT often glue a suffix like X.",
      "// The MAP is closed by START_MODULE_MAP when exports are listed.",
      "// START_BLOCK names must be uppercase; START_BLOCK_foo is wrong in prose too.",
      "// START_CONTRACT / END_CONTRACT stay out of EXACT_MARKER_PREFIXES: that list",
      "* START_CONTRACT / END_CONTRACT stay out of EXACT_MARKER_PREFIXES: that list's",
      "// See also START_CHANGE_SUMMARY when documenting a change.",
    ];
    for (const line of prose) {
      expect(collectNearMissMarkerIssues("src/prose.ts", `${line}\n`), line).toEqual([]);
    }
  });

  it("corr 145: apostrophe in // comment does not open a string span", () => {
    // Axis 1: ' inside a // comment must not swallow following markers.
    const withApostrophe = `// START_MODULE_CONTRACT
//   PURPOSE: Parse the user's governed file
//   SCOPE: Fixture
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   foo
// END_MODULE_MAP
export function foo() { return 1; }
`;
    const stripped = stripQuotedStrings(withApostrophe);
    expect(stripped).toContain("END_MODULE_CONTRACT");
    expect(stripped).toContain("START_MODULE_MAP");
    expect(stripped).toContain("foo");
    expect(hasGraceMarkers(withApostrophe)).toBe(true);
    const analysis = analyzeGovernedFile("/tmp", "src/apostrophe.ts", withApostrophe);
    expect(analysis.issues.filter((i) => i.code === "markup.missing-end-marker")).toEqual([]);
    expect(analysis.issues.filter((i) => i.code === "markup.module-map-missing")).toEqual([]);
    expect(analysis.issues.filter((i) => i.code === "markup.module-map-mismatch")).toEqual([]);
  });

  it("corr 145: // inside a string is not a comment; markers there stay stripped", () => {
    // Axis 2: // inside string literals must still not start a comment.
    const urlAndTemplate = [
      'const url = "http://example.com/path";',
      "const s = 'http://also.example';",
      "const t = `// START_MODULE_CONTRACT`;",
      'const u = "// END_MODULE_CONTRACT";',
      "",
    ].join("\n");
    const stripped = stripQuotedStrings(urlAndTemplate);
    expect(stripped).not.toMatch(/START_MODULE_CONTRACT/);
    expect(stripped).not.toMatch(/END_MODULE_CONTRACT/);
    expect(stripped).toContain("const url");
    // http:// blanked inside the string, but // must not eat the rest of the file.
    expect(stripped.split("\n").length).toBe(urlAndTemplate.split("\n").length);
    expect(hasGraceMarkers(urlAndTemplate)).toBe(false);
  });

  it("corr 145: apostrophe inside a string literal remains a delimiter", () => {
    // Axis 3: ' inside strings still opens/closes as before.
    const source = [
      "const msg = 'it\\'s fine';",
      'const other = "still here";',
      "// START_MODULE_CONTRACT",
      "// END_MODULE_CONTRACT",
      "",
    ].join("\n");
    expect(hasGraceMarkers(source)).toBe(true);
    const stripped = stripQuotedStrings(source);
    expect(stripped).toContain("START_MODULE_CONTRACT");
    expect(stripped).toContain("END_MODULE_CONTRACT");
  });

  it("corr 145: quotes inside block comments do not open a string span", () => {
    // Axis 4: block comments — quotes do not start strings; body is kept.
    const source = [
      "/* PURPOSE: the user's file",
      "   still in block",
      "*/",
      "// START_MODULE_CONTRACT",
      "// END_MODULE_CONTRACT",
      "",
    ].join("\n");
    const stripped = stripQuotedStrings(source);
    expect(stripped).toContain("the user's file");
    expect(stripped).toContain("START_MODULE_CONTRACT");
    expect(hasGraceMarkers(source)).toBe(true);
  });

  it("corr 145 / A8: near-miss after a comment apostrophe still fires (silent-regression pin)", () => {
    // A8 only inspects first-token near-misses (1–2 tokens). Place the miss on its
    // own comment line after a prose line that contains an apostrophe. Before the
    // fix, the apostrophe opened a span and blanked the following lines, so A8
    // never saw START_MODULE_CONTRACTX — a silent regression in a green suite.
    const hiddenNearMiss = [
      "// PURPOSE: the user's governed surface",
      "// START_MODULE_CONTRACTX",
      "",
    ].join("\n");
    expect(hasGraceMarkers(hiddenNearMiss)).toBe(false);
    const issues = collectNearMissMarkerIssues("src/a8-apostrophe.ts", hiddenNearMiss);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("markup.near-miss-marker");
    expect(issues[0]!.message).toContain("START_MODULE_CONTRACTX");
  });
});

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

  // C-TOKEN-INTEGRITY T-001 / RM-GOVERNED-PATH P0.2 — reject, don't filter.
  describe("LINKS/DEPENDS separators and unparsed-token errors (T-001)", () => {
    function analyzeLinks(value: string) {
      const root = mkdtempSync(path.join(os.tmpdir(), "grace-token-integrity-"));
      const file = path.join(root, "src", "example.ts");
      const text = contract("NONE").replace("LINKS: M-EXAMPLE", `LINKS: ${value}`);
      return { record: parseGovernedFile(root, file, text), analysis: analyzeGovernedFile(root, file, text) };
    }

    function analyzeDepends(value: string) {
      const root = mkdtempSync(path.join(os.tmpdir(), "grace-token-integrity-"));
      const file = path.join(root, "src", "example.ts");
      const text = contract("NONE").replace("DEPENDS: none", `DEPENDS: ${value}`);
      return { record: parseGovernedFile(root, file, text), analysis: analyzeGovernedFile(root, file, text) };
    }

    function unparsed(analysis: ReturnType<typeof analyzeGovernedFile>) {
      return analysis.issues.filter((issue) => issue.code === "markup.unparsed-link-token");
    }

    it("splits LINKS on whitespace so M-A M-B yields two linked modules", () => {
      const { record, analysis } = analyzeLinks("M-A M-B");
      expect(record.linkedModuleIds).toEqual(["M-A", "M-B"]);
      expect(unparsed(analysis)).toHaveLength(0);
    });

    it("splits LINKS on semicolon so M-A; M-B yields two linked modules", () => {
      const { record, analysis } = analyzeLinks("M-A; M-B");
      expect(record.linkedModuleIds).toEqual(["M-A", "M-B"]);
      expect(unparsed(analysis)).toHaveLength(0);
    });

    it("raises markup.unparsed-link-token naming TYPO-BAD in a mixed LINKS list", () => {
      const { record, analysis } = analyzeLinks("M-A, TYPO-BAD, M-B");
      expect(record.linkedModuleIds).toEqual(["M-A", "M-B"]);
      const issues = unparsed(analysis);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("TYPO-BAD");
      expect(issues[0]!.message).toContain("comma, semicolon, or whitespace");
      expect(issues[0]!.message).toMatch(/colon is not a separator/i);
      expect(issues[0]!.message).toMatch(/M-\*|DF-\*|V-M-\*/);
    });

    it("raises on colon-glued token M-A: (D5.1 — colon is not a separator)", () => {
      const { record, analysis } = analyzeLinks("M-A: M-B");
      expect(record.linkedModuleIds).toEqual(["M-B"]);
      const issues = unparsed(analysis);
      expect(issues.some((issue) => issue.message.includes("M-A:"))).toBe(true);
      expect(issues.some((issue) => issue.message.includes("M-B"))).toBe(false);
    });

    it("raises naming postgres when DEPENDS mixes free-text with modules", () => {
      const { record, analysis } = analyzeDepends("M-DB, postgres");
      expect(record.dependsModuleIds).toEqual(["M-DB"]);
      const issues = unparsed(analysis);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("postgres");
      expect(issues[0]!.message).toMatch(/DEPENDS/);
      expect(issues[0]!.message).toMatch(/M-\*/);
    });

    it("raises when DEPENDS carries V-M-* (wrong family for that field)", () => {
      const { record, analysis } = analyzeDepends("V-M-X");
      expect(record.dependsModuleIds).toEqual([]);
      const issues = unparsed(analysis);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("V-M-X");
      expect(issues[0]!.message).toMatch(/DEPENDS/);
    });

    it("preserves none and bracketed lists (F3)", () => {
      expect(analyzeLinks("none").record.linkedModuleIds).toEqual([]);
      expect(unparsed(analyzeLinks("none").analysis)).toHaveLength(0);
      expect(analyzeLinks("[M-A, M-B]").record.linkedModuleIds).toEqual(["M-A", "M-B"]);
      expect(unparsed(analyzeLinks("[M-A, M-B]").analysis)).toHaveLength(0);
      expect(analyzeLinks("[none]").record.linkedModuleIds).toEqual([]);
    });
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
