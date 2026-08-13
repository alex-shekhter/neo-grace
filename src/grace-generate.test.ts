import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { GRAMMAR_INVENTORIES } from "./artifact/grammar";
import { ARTIFACT_DIR } from "./artifact/paths";
import { NGRACE_ARTIFACT_VERSION } from "./artifact/types";
import { parseGraceXmlArtifact } from "./artifact/xml";
import { analyzeGovernedFile } from "./project-utils";
import { createTempProject, GraceProjectBuilder, minimalTsFixture } from "./test-support/fixtures";

const repoRoot = path.resolve(import.meta.dir, "..");
const graceBin = path.join(repoRoot, "src", "grace.ts");

function runGenerate(root: string, argv: string[]) {
  return Bun.spawnSync({
    cmd: [process.execPath, graceBin, ...argv, "--path", root],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdoutText(result: ReturnType<typeof runGenerate>): string {
  return Buffer.from(result.stdout).toString("utf8");
}

function stderrText(result: ReturnType<typeof runGenerate>): string {
  return Buffer.from(result.stderr).toString("utf8");
}

function directChildTags(xml: string): string[] {
  const parsed = parseGraceXmlArtifact("generated.xml", xml);
  const wrapper = parsed.root?.children[0];
  return wrapper?.children.map((child) => child.tag) ?? [];
}

describe("spec new", () => {
  it("writes a draft spec and prints the project-relative path", () => {
    const root = createTempProject("grace-spec-new-");
    const changeId = "C-GEN-SPEC";
    const result = runGenerate(root, ["spec", "new", changeId]);
    expect(result.exitCode).toBe(0);
    const relative = `${ARTIFACT_DIR}/changes/active/${changeId}/spec.xml`;
    expect(stdoutText(result).split("\n")[0]).toBe(relative);
    const file = path.join(root, relative);
    expect(existsSync(file)).toBe(true);
    const xml = readFileSync(file, "utf8");
    expect(xml).toContain(`<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="draft">`);
    expect(xml).toContain(`<${changeId}>`);
    const tags = directChildTags(xml);
    expect(tags).toEqual([...GRAMMAR_INVENTORIES.SPEC_REQUIRED_SECTIONS]);
    expect(xml).toContain("<M-AFFECTED-MODULE");
    expect(xml).toContain("<AC-SKELETON>");
    expect(xml).not.toContain("<Problem>");
    expect(xml).not.toContain("<DesignReferences>");
    expect(xml).not.toContain("<!--");
  });

  it("refuses a second invocation without changing the file", () => {
    const root = createTempProject("grace-spec-dup-");
    const changeId = "C-GEN-SPEC-DUP";
    const first = runGenerate(root, ["spec", "new", changeId]);
    expect(first.exitCode).toBe(0);
    const file = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "spec.xml");
    const before = readFileSync(file, "utf8");
    const second = runGenerate(root, ["spec", "new", changeId]);
    expect(second.exitCode).not.toBe(0);
    expect(stderrText(second)).toMatch(/invalid-arguments|already exists|exists/i);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a slug that would be valid only after prepending C-", () => {
    const root = createTempProject("grace-spec-slug-");
    const result = runGenerate(root, ["spec", "new", "SKELETON-PROBE"]);
    expect(result.exitCode).not.toBe(0);
    expect(stderrText(result)).toMatch(/invalid-arguments|C-/);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-SKELETON-PROBE"))).toBe(false);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "SKELETON-PROBE"))).toBe(false);
  });

  it("refuses when the id already exists under archive", () => {
    const root = createTempProject("grace-spec-archive-");
    const changeId = "C-GEN-ARCHIVED";
    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", changeId);
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(path.join(archiveDir, "spec.xml"), "<n />");
    const result = runGenerate(root, ["spec", "new", changeId]);
    expect(result.exitCode).not.toBe(0);
    expect(stderrText(result)).toMatch(/archive/);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", changeId))).toBe(false);
  });
});

function writeApprovedSpec(root: string, changeId: string, specXml: string): string {
  const file = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "spec.xml");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, specXml);
  return file;
}

describe("plan new", () => {
  it("writes a draft plan beside an approved spec and prints the path", () => {
    const root = createTempProject("grace-plan-new-");
    const changeId = "C-GEN-PLAN";
    const spec = runGenerate(root, ["spec", "new", changeId]);
    const specFile = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "spec.xml");
    if (spec.exitCode === 0 && existsSync(specFile)) {
      const approved = readFileSync(specFile, "utf8").replace('status="draft"', 'status="approved"');
      writeFileSync(specFile, approved);
    } else {
      writeApprovedSpec(
        root,
        changeId,
        `<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="approved"><${changeId}><Summary>s</Summary><Goals>g</Goals><Constraints>c</Constraints><NonGoals>n</NonGoals><AcceptanceCriteria><AC-SKELETON>a</AC-SKELETON></AcceptanceCriteria><AffectedAreas><M-AFFECTED-MODULE /></AffectedAreas><VerificationIntent>v</VerificationIntent></${changeId}></NgraceChangeSpec>\n`,
      );
    }
    const result = runGenerate(root, ["plan", "new", changeId]);
    expect(result.exitCode).toBe(0);
    const relative = `${ARTIFACT_DIR}/changes/active/${changeId}/plan.xml`;
    expect(stdoutText(result).split("\n")[0]).toBe(relative);
    const xml = readFileSync(path.join(root, relative), "utf8");
    expect(xml).toContain(`<NgraceChangePlan graceVersion="${NGRACE_ARTIFACT_VERSION}" status="draft">`);
    const tags = directChildTags(xml);
    expect(tags).toEqual([...GRAMMAR_INVENTORIES.PLAN_REQUIRED_SECTIONS]);
    expect(xml).toContain("<None />");
    expect(xml).not.toContain("<File>");
    expect(xml).toContain("<M-AFFECTED-MODULE");
    expect(xml).toContain("<AC-SKELETON");
    expect(xml).not.toContain("<OutOfPlanScope>");
    expect(xml).not.toContain("<!--");
  });

  it("refuses a draft spec without writing plan.xml", () => {
    const root = createTempProject("grace-plan-draft-");
    const changeId = "C-GEN-PLAN-DRAFT";
    const specFile = writeApprovedSpec(
      root,
      changeId,
      `<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="draft"><${changeId}><Summary>s</Summary></${changeId}></NgraceChangeSpec>\n`,
    );
    const result = runGenerate(root, ["plan", "new", changeId]);
    expect(result.exitCode).not.toBe(0);
    const err = stderrText(result);
    expect(err).toMatch(/invalid-arguments|approved/i);
    expect(err).toContain(`${ARTIFACT_DIR}/changes/active/${changeId}/spec.xml`);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml"))).toBe(false);
    expect(existsSync(specFile)).toBe(true);
  });

  it("refuses when the spec is missing", () => {
    const root = createTempProject("grace-plan-missing-");
    const changeId = "C-GEN-PLAN-MISS";
    mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
    const result = runGenerate(root, ["plan", "new", changeId]);
    expect(result.exitCode).not.toBe(0);
    expect(stderrText(result)).toMatch(/invalid-arguments|approved|spec/i);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml"))).toBe(false);
  });

  it("refuses when plan.xml already exists", () => {
    const root = createTempProject("grace-plan-exists-");
    const changeId = "C-GEN-PLAN-EXISTS";
    writeApprovedSpec(
      root,
      changeId,
      `<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="approved"><${changeId}><Summary>s</Summary><Goals>g</Goals><Constraints>c</Constraints><NonGoals>n</NonGoals><AcceptanceCriteria><AC-SKELETON>a</AC-SKELETON></AcceptanceCriteria><AffectedAreas><M-AFFECTED-MODULE /></AffectedAreas><VerificationIntent>v</VerificationIntent></${changeId}></NgraceChangeSpec>\n`,
    );
    const planFile = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml");
    writeFileSync(planFile, "<existing />");
    const result = runGenerate(root, ["plan", "new", changeId]);
    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(planFile, "utf8")).toBe("<existing />");
  });
});

function scaffoldFixture(): string {
  return new GraceProjectBuilder(createTempProject("grace-scaffold-"))
    .module({
      id: "M-EXAMPLE",
      summary: "Runtime example.",
      path: "src/example.ts",
    })
    .module({
      id: "M-SKILLS",
      summary: "Utility without a Path.",
    })
    .module({
      id: "M-MISSING-FILE",
      summary: "Path points at a missing file.",
      path: "src/missing.ts",
    })
    .module({
      id: "M-JAVA-NOTE",
      summary: "Governed extension with no adapter.",
      path: "src/note.java",
    })
    .module({
      id: "M-EMPTY-EXPORTS",
      summary: "Adapter-backed file with an empty export set.",
      path: "src/empty.ts",
    })
    .governedFile({
      path: "src/example.ts",
      purpose: "Example runtime.",
      scope: "Happy-path scaffold target.",
      depends: ["none"],
      links: ["M-EXAMPLE"],
      role: "RUNTIME",
      mapMode: "EXPORTS",
      mapEntries: ["greet"],
      body: "export function greet() {\n  return 1;\n}\n",
    })
    .file("src/note.java", "class Note {}\n")
    .file("src/empty.ts", "const unused = 1;\n")
    .write();
}

describe("scaffold", () => {
  it("prints a production MODULE_CONTRACT then MODULE_MAP and does not write the Path file", () => {
    const root = scaffoldFixture();
    const before = readFileSync(path.join(root, "src/example.ts"), "utf8");
    const result = runGenerate(root, ["scaffold", "--module", "M-EXAMPLE"]);
    expect(result.exitCode).toBe(0);
    const out = stdoutText(result);
    expect(out).toContain("START_MODULE_CONTRACT");
    expect(out).toContain("END_MODULE_CONTRACT");
    expect(out).toContain("START_MODULE_MAP");
    expect(out).toContain("greet");
    expect(out).toContain("ROLE: RUNTIME");
    expect(out).toContain("MAP_MODE: EXPORTS");
    expect(out).toContain("LINKS: M-EXAMPLE");
    expect(out).toContain("DEPENDS: none");
    expect(readFileSync(path.join(root, "src/example.ts"), "utf8")).toBe(before);
  });

  it("unknown module is not-found", () => {
    const root = scaffoldFixture();
    const result = runGenerate(root, ["scaffold", "--module", "M-DOES-NOT-EXIST"]);
    expect(result.exitCode).not.toBe(0);
    expect(stderrText(result)).toMatch(/not-found|Unknown module|M-DOES-NOT-EXIST/);
  });

  it("module with no Path is invalid-arguments and names the absence", () => {
    const root = scaffoldFixture();
    const result = runGenerate(root, ["scaffold", "--module", "M-SKILLS"]);
    expect(result.exitCode).not.toBe(0);
    expect(stderrText(result)).toMatch(/invalid-arguments|no Path|Path/);
  });

  it("missing Path file is not-found", () => {
    const root = scaffoldFixture();
    const result = runGenerate(root, ["scaffold", "--module", "M-MISSING-FILE"]);
    expect(result.exitCode).not.toBe(0);
    expect(stderrText(result)).toMatch(/not-found|missing/i);
  });

  it("extension without an adapter is invalid-arguments and names the extension", () => {
    const root = scaffoldFixture();
    const result = runGenerate(root, ["scaffold", "--module", "M-JAVA-NOTE"]);
    expect(result.exitCode).not.toBe(0);
    const err = stderrText(result);
    expect(err).toMatch(/invalid-arguments|\.java/);
    expect(err).toContain(".java");
  });

  it("empty required symbol set is invalid-arguments and names the mode", () => {
    const root = scaffoldFixture();
    const result = runGenerate(root, ["scaffold", "--module", "M-EMPTY-EXPORTS"]);
    expect(result.exitCode).not.toBe(0);
    const err = stderrText(result);
    expect(err).toMatch(/invalid-arguments|empty|EXPORTS/);
    expect(err).toContain("EXPORTS");
  });
});

function lintProject(root: string) {
  return Bun.spawnSync({
    cmd: [process.execPath, graceBin, "lint", "--path", root, "--format", "json"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function lintSummary(result: ReturnType<typeof lintProject>): { errors: number; warnings: number } {
  const parsed = JSON.parse(stdoutText(result)) as { summary: { errors: number; warnings: number } };
  return parsed.summary;
}

describe("generate-then-lint", () => {
  it("spec new then lint of a temp project is 0/0", () => {
    const root = minimalTsFixture();
    const generated = runGenerate(root, ["spec", "new", "C-GEN-LINT-SPEC"]);
    expect(generated.exitCode).toBe(0);
    const lint = lintProject(root);
    expect(lint.exitCode).toBe(0);
    const specSummary = lintSummary(lint);
    expect(specSummary.errors).toBe(0);
    expect(specSummary.warnings).toBe(0);
  });

  it("plan new beside an approved spec then lint is 0/0", () => {
    const root = minimalTsFixture();
    expect(runGenerate(root, ["spec", "new", "C-GEN-LINT-PLAN"]).exitCode).toBe(0);
    const specFile = path.join(root, ARTIFACT_DIR, "changes", "active", "C-GEN-LINT-PLAN", "spec.xml");
    writeFileSync(specFile, readFileSync(specFile, "utf8").replace('status="draft"', 'status="approved"'));
    expect(runGenerate(root, ["plan", "new", "C-GEN-LINT-PLAN"]).exitCode).toBe(0);
    const lint = lintProject(root);
    expect(lint.exitCode).toBe(0);
    const planSummary = lintSummary(lint);
    expect(planSummary.errors).toBe(0);
    expect(planSummary.warnings).toBe(0);
  });

  it("plan new beside a draft spec writes nothing", () => {
    const root = minimalTsFixture();
    expect(runGenerate(root, ["spec", "new", "C-GEN-LINT-DRAFT"]).exitCode).toBe(0);
    const refused = runGenerate(root, ["plan", "new", "C-GEN-LINT-DRAFT"]);
    expect(refused.exitCode).not.toBe(0);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-GEN-LINT-DRAFT", "plan.xml"))).toBe(false);
  });

  it("scaffold stdout prepended to a fixture body has 0 markup errors", () => {
    const root = scaffoldFixture();
    const body = "export function greet() {\n  return 1;\n}\n";
    const generated = runGenerate(root, ["scaffold", "--module", "M-EXAMPLE"]);
    expect(generated.exitCode).toBe(0);
    const combined = `${stdoutText(generated).trimEnd()}\n${body}`;
    const analysis = analyzeGovernedFile(root, path.join(root, "src/example.ts"), combined);
    const markupErrors = analysis.issues.filter((issue) => issue.code.startsWith("markup.") && issue.severity === "error");
    expect(markupErrors, JSON.stringify(markupErrors)).toEqual([]);
  });
});
