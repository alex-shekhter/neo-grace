import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { cleanupCandidate, mintResolvedBundle, resolveSpecMint, type AcquiredCandidate, type CandidateIo, type ResolvedSpecMint } from "./grace-generate";

import { GRAMMAR_INVENTORIES } from "./artifact/grammar";
import { ARTIFACT_DIR } from "./artifact/paths";
import { NGRACE_ARTIFACT_VERSION } from "./artifact/types";
import { parseGraceXmlArtifact } from "./artifact/xml";
import { analyzeGovernedFile } from "./project-utils";
import { createTempProject, GraceProjectBuilder, minimalTsFixture } from "./test-support/fixtures";
import { writeChangeBundleFixture } from "./artifact/test-fixtures";

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

function runGit(cwd: string, args: string[]) {
  return Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
}

function runGenerateIn(root: string, argv: string[], env: NodeJS.ProcessEnv, cwd = repoRoot) {
  return Bun.spawnSync({
    cmd: [process.execPath, graceBin, ...argv, "--path", root],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
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

const TIMESTAMP_A = "2026-09-14T03:00:00Z";
const TIMESTAMP_B = "2026-09-14T03:00:01Z";
const BRANCH = "c-hashed-bundle-ids";

function mintArgs(slug: string, extra: string[] = [], timestamp = TIMESTAMP_A): string[] {
  return ["spec", "new", slug, "--timestamp", timestamp, "--branch", BRANCH, ...extra];
}

function firstLine(result: ReturnType<typeof runGenerate>): string {
  return stdoutText(result).split("\n")[0]!;
}

function mintedIdFromRelative(relative: string): string {
  return path.basename(path.dirname(relative));
}

function expectNoActiveFor(root: string, pattern: RegExp): void {
  const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active");
  const entries = existsSync(activeDir) ? readdirSync(activeDir) : [];
  expect(entries.filter((name) => pattern.test(name)), `active/ must carry no bundle for ${pattern}`).toEqual([]);
}

describe("spec new", () => {
  it("mints C-SLUG-1-HASH from a bare slug, a timestamp and a branch", () => {
    const root = createTempProject("grace-spec-mint-");
    const result = runGenerate(root, mintArgs("GEN-SPEC"));
    expect(result.exitCode).toBe(0);
    const relative = firstLine(result);
    const minted = mintedIdFromRelative(relative);
    expect(relative).toBe(`${ARTIFACT_DIR}/changes/active/${minted}/spec.xml`);
    expect(minted).toMatch(/^C-GEN-SPEC-1-[0-9A-F]{8}$/);
    const file = path.join(root, relative);
    expect(existsSync(file)).toBe(true);
    const xml = readFileSync(file, "utf8");
    expect(xml).toContain(`<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="draft">`);
    expect(xml).toContain(`<${minted}>`);
    const tags = directChildTags(xml);
    expect(tags).toEqual([...GRAMMAR_INVENTORIES.SPEC_REQUIRED_SECTIONS]);
    expect(xml).toContain("<M-AFFECTED-MODULE");
    expect(xml).toContain("<AC-SKELETON>");
    expect(xml).not.toContain("<Problem>");
    expect(xml).not.toContain("<DesignReferences>");
    expect(xml).not.toContain("<!--");
    const lines = stdoutText(result).trimEnd().split("\n");
    expect(lines[1]).toContain(`mint: ${minted}`);
    expect(lines[1]).toContain("slug=GEN-SPEC");
    expect(lines[1]).toContain("lineage=1");
    expect(lines[1]).toContain(`branch=${BRANCH}`);
    expect(lines[2]).toContain("mint-search: 0 active, 0 archive");
  });

  it("is deterministic given its inputs", () => {
    const idA = mintedIdFromRelative(firstLine(runGenerate(createTempProject("grace-spec-det-a-"), mintArgs("DET"))));
    const idB = mintedIdFromRelative(firstLine(runGenerate(createTempProject("grace-spec-det-b-"), mintArgs("DET"))));
    expect(idA).toBe(idB);
    const idC = mintedIdFromRelative(
      firstLine(runGenerate(createTempProject("grace-spec-det-c-"), mintArgs("DET", [], TIMESTAMP_B))),
    );
    expect(idC).not.toBe(idA);
  });

  it("seeds a docs-and-examples placeholder a bare mint no longer fails for", () => {
    const root = createTempProject("grace-spec-seed-");
    const result = runGenerate(root, mintArgs("SEED"));
    expect(result.exitCode).toBe(0);
    const xml = readFileSync(path.join(root, firstLine(result)), "utf8");
    expect(xml).toContain("replace this placeholder by deciding README.md and examples/");
    const nonGoal = xml.match(/<NonGoal>([\s\S]*?)<\/NonGoal>/)?.[1] ?? "";
    expect(nonGoal).toContain("README.md");
    expect(nonGoal).toContain("examples/");
  });

  it("refuses every pinned refusal and writes nothing", () => {
    const root = createTempProject("grace-spec-refuse-");

    const handTyped = runGenerate(root, mintArgs("C-GEN-TYPED"));
    expect(handTyped.exitCode).not.toBe(0);
    expect(stderrText(handTyped)).toContain("hand-typed");
    expectNoActiveFor(root, /GEN-TYPED/);

    const alreadyMinted = runGenerate(root, mintArgs("C-GEN-TYPED-1-ABCDEF12"));
    expect(alreadyMinted.exitCode).not.toBe(0);
    expect(stderrText(alreadyMinted)).toContain("hand-typed");
    expectNoActiveFor(root, /GEN-TYPED/);

    const numeric = runGenerate(root, mintArgs("GEN-2"));
    expect(numeric.exitCode).not.toBe(0);
    expect(stderrText(numeric)).toContain("numeric segment");
    expectNoActiveFor(root, /GEN-2/);

    const noTimestamp = runGenerate(root, ["spec", "new", "GEN-NOTS"]);
    expect(noTimestamp.exitCode).not.toBe(0);
    expect(stderrText(noTimestamp)).toMatch(/timestamp/i);
    expectNoActiveFor(root, /GEN-NOTS/);

    const badPredecessor = runGenerate(root, ["spec", "new", "--supersedes", "not-a-change", "--timestamp", TIMESTAMP_A, "--branch", BRANCH]);
    expect(badPredecessor.exitCode).not.toBe(0);
    expect(stderrText(badPredecessor)).toContain("canonical C-*");
    expectNoActiveFor(root, /NOT-A-CHANGE/);

    const env = { ...process.env };
    delete env.NGRACE_SPEC_BRANCH;
    const noBranch = Bun.spawnSync({
      cmd: [process.execPath, graceBin, "spec", "new", "GEN-NOBR", "--timestamp", TIMESTAMP_A, "--path", root],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    expect(noBranch.exitCode).not.toBe(0);
    expect(Buffer.from(noBranch.stderr).toString("utf8")).toContain("requires --branch");
    expectNoActiveFor(root, /GEN-NOBR/);
  });

  it("refuses when the minted id already exists under active or archive", () => {
    const root = createTempProject("grace-spec-dup-");
    const first = runGenerate(root, mintArgs("DUP"));
    expect(first.exitCode).toBe(0);
    const relative = firstLine(first);
    const minted = mintedIdFromRelative(relative);
    const file = path.join(root, relative);
    const before = readFileSync(file, "utf8");
    const second = runGenerate(root, mintArgs("DUP"));
    expect(second.exitCode).not.toBe(0);
    expect(stderrText(second)).toMatch(/already exists/i);
    expect(readFileSync(file, "utf8")).toBe(before);
    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", minted);
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(path.join(archiveDir, "spec.xml"), "<n />");
    rmSync(path.join(root, ARTIFACT_DIR, "changes", "active", minted), { recursive: true });
    const third = runGenerate(root, mintArgs("DUP"));
    expect(third.exitCode).not.toBe(0);
    expect(stderrText(third)).toMatch(/archive/);
  });

  it("hashes the --path repository's branch, not the process cwd's, and refuses a gitless --path", () => {
    const env = { ...process.env };
    delete env.NGRACE_SPEC_BRANCH;

    // Direction A: a foreign git cwd against a --path on another branch hashes the --path branch.
    const foreign = createTempProject("grace-spec-cwd-a-");
    runGit(foreign, ["init"]);
    runGit(foreign, ["config", "user.email", "t@example.invalid"]);
    runGit(foreign, ["config", "user.name", "t"]);
    runGit(foreign, ["config", "commit.gpgsign", "false"]);
    writeFileSync(path.join(foreign, "x.txt"), "x\n");
    runGit(foreign, ["add", "."]);
    runGit(foreign, ["commit", "-m", "base"]);
    runGit(foreign, ["checkout", "-b", "probe-other-branch"]);
    const directionA = runGenerateIn(foreign, ["spec", "new", "CWD-A", "--timestamp", TIMESTAMP_A], env);
    expect(directionA.exitCode).toBe(0);
    expect(stdoutText(directionA)).toContain("branch=probe-other-branch");

    // Direction B: a git cwd against a gitless --path refuses.
    const gitless = createTempProject("grace-spec-cwd-b-");
    const directionB = runGenerateIn(gitless, ["spec", "new", "CWD-B", "--timestamp", TIMESTAMP_A], env);
    expect(directionB.exitCode).not.toBe(0);
    expect(stderrText(directionB)).toContain("requires --branch");
    expectNoActiveFor(gitless, /CWD-B/);
  });

  it("mints the successor with --supersedes from a minted or legacy predecessor", () => {
    const root = createTempProject("grace-spec-succ-");
    const predecessorId = mintedIdFromRelative(firstLine(runGenerate(root, mintArgs("PRED"))));
    const successor = runGenerate(root, ["spec", "new", "--supersedes", predecessorId, "--timestamp", TIMESTAMP_B, "--branch", BRANCH]);
    expect(successor.exitCode).toBe(0);
    expect(mintedIdFromRelative(firstLine(successor))).toMatch(/^C-PRED-2-[0-9A-F]{8}$/);
    const legacy = runGenerate(root, ["spec", "new", "--supersedes", "C-LEGACY", "--timestamp", TIMESTAMP_A, "--branch", BRANCH]);
    expect(legacy.exitCode).toBe(0);
    expect(mintedIdFromRelative(firstLine(legacy))).toMatch(/^C-LEGACY-2-[0-9A-F]{8}$/);
    const legacyTwo = runGenerate(root, ["spec", "new", "--supersedes", "C-LEGACY-2", "--timestamp", TIMESTAMP_B, "--branch", BRANCH]);
    expect(legacyTwo.exitCode).toBe(0);
    expect(mintedIdFromRelative(firstLine(legacyTwo))).toMatch(/^C-LEGACY-3-[0-9A-F]{8}$/);
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
    const spec = runGenerate(root, mintArgs("GEN-PLAN"));
    expect(spec.exitCode).toBe(0);
    const changeId = mintedIdFromRelative(firstLine(spec));
    const specFile = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "spec.xml");
    const approved = readFileSync(specFile, "utf8").replace('status="draft"', 'status="approved"');
    writeFileSync(specFile, approved);
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

  it("skeleton-excludes-close-evidence: plan new Satisfies-links only ordinary AC-*", () => {
    const root = createTempProject("grace-plan-close-");
    const changeId = "C-GEN-CLOSE";
    writeApprovedSpec(
      root,
      changeId,
      `<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="approved"><${changeId}><Summary>s</Summary><Goals>g</Goals><Constraints>c</Constraints><NonGoals>n</NonGoals><AcceptanceCriteria><AC-CLOSE>Close bound.<CloseEvidence><Command>true</Command></CloseEvidence></AC-CLOSE><AC-ORDINARY>Ordinary criterion.</AC-ORDINARY></AcceptanceCriteria><AffectedAreas><M-AFFECTED-MODULE /></AffectedAreas><VerificationIntent>v</VerificationIntent></${changeId}></NgraceChangeSpec>\n`,
    );
    const result = runGenerate(root, ["plan", "new", changeId]);
    expect(result.exitCode).toBe(0);
    const xml = readFileSync(path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml"), "utf8");
    const satisfies = xml.match(/<Satisfies>[\s\S]*?<\/Satisfies>/)?.[0] ?? "";
    expect(satisfies).toContain("<AC-ORDINARY");
    expect(satisfies).not.toContain("<AC-CLOSE");
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
    const generated = runGenerate(root, mintArgs("GEN-LINT-SPEC"));
    expect(generated.exitCode).toBe(0);
    const lint = lintProject(root);
    expect(lint.exitCode).toBe(0);
    const specSummary = lintSummary(lint);
    expect(specSummary.errors).toBe(0);
    expect(specSummary.warnings).toBe(0);
  });

  it("plan new beside an approved spec then lint is 0/0", () => {
    const root = minimalTsFixture();
    const spec = runGenerate(root, mintArgs("GEN-LINT-PLAN"));
    expect(spec.exitCode).toBe(0);
    const changeId = mintedIdFromRelative(firstLine(spec));
    const specFile = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "spec.xml");
    writeFileSync(specFile, readFileSync(specFile, "utf8").replace('status="draft"', 'status="approved"'));
    expect(runGenerate(root, ["plan", "new", changeId]).exitCode).toBe(0);
    const lint = lintProject(root);
    expect(lint.exitCode).toBe(0);
    const planSummary = lintSummary(lint);
    expect(planSummary.errors).toBe(0);
    expect(planSummary.warnings).toBe(0);
  });

  it("plan new beside a draft spec writes nothing", () => {
    const root = minimalTsFixture();
    const spec = runGenerate(root, mintArgs("GEN-LINT-DRAFT"));
    expect(spec.exitCode).toBe(0);
    const changeId = mintedIdFromRelative(firstLine(spec));
    const refused = runGenerate(root, ["plan", "new", changeId]);
    expect(refused.exitCode).not.toBe(0);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml"))).toBe(false);
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

// C-SUPERSEDE-MEMBERSHIP-1-7D8B2BE8 T-001: exclusive acquisition and bounded cleanup.
describe("candidate exclusive acquisition and bounded cleanup", () => {
  const activeDirFor = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const candidateDir = (root: string, id: string) => path.join(activeDirFor(root), id);
  const markerPath = (root: string, id: string) => path.join(candidateDir(root, id), ".ngrace-mint-owner");
  const specPath = (root: string, id: string) => path.join(candidateDir(root, id), "spec.xml");

  function resolvedFor(id: string): ResolvedSpecMint {
    return { id, slug: "T001", lineage: 1, hash: "ABCDEF12", branch: "probe", timestamp: "2026-09-14T03:00:00.000Z" };
  }

  function mkCandidate(root: string, id: string, opts: { marker?: boolean; spec?: string } = {}): AcquiredCandidate {
    const dir = candidateDir(root, id);
    mkdirSync(dir, { recursive: true });
    const st = statSync(dir);
    const token = "test-token";
    if (opts.marker !== false) writeFileSync(markerPath(root, id), `${token}\n`);
    if (opts.spec !== undefined) writeFileSync(specPath(root, id), opts.spec);
    return {
      path: dir,
      markerPath: markerPath(root, id),
      specPath: specPath(root, id),
      token,
      expectedSpecBytes: opts.spec ?? "",
      stage: opts.spec !== undefined ? "spec-written" : "marker-written",
      dev: st.dev,
      ino: st.ino,
    };
  }

  it("(a) losing the leaf mkdir race refuses and writes nothing", () => {
    const root = createTempProject("cand-race-");
    const id = "C-CAND-RACE-1-ABCDEF12";
    mkdirSync(candidateDir(root, id), { recursive: true });
    expect(() => mintResolvedBundle(root, resolvedFor(id))).toThrow(/already exists/i);
    expect(readdirSync(candidateDir(root, id))).toEqual([]);
  });

  it("(b) a competitor spec.xml in the resolved directory is preserved byte-for-byte", () => {
    const root = createTempProject("cand-competitor-");
    const id = "C-CAND-COMP-1-ABCDEF12";
    mkdirSync(candidateDir(root, id), { recursive: true });
    writeFileSync(specPath(root, id), "<competitor />");
    expect(() => mintResolvedBundle(root, resolvedFor(id))).toThrow();
    expect(readFileSync(specPath(root, id), "utf8")).toBe("<competitor />");
  });

  it("(c) a same-path replacement is detected by inode and preserved", () => {
    const root = createTempProject("cand-replace-");
    const id = "C-CAND-REPL-1-ABCDEF12";
    const candidate = mkCandidate(root, id, { spec: "<ours />" });
    rmSync(candidateDir(root, id), { recursive: true });
    mkdirSync(candidateDir(root, id), { recursive: true });
    writeFileSync(specPath(root, id), "<ours />");
    const result = cleanupCandidate(candidate);
    expect(result.removed).toBe(false);
    expect(result.diagnostic).toMatch(/identity changed/);
    expect(existsSync(candidateDir(root, id))).toBe(true);
  });

  it("(d) a same-path modification of our spec.xml is detected by bytes and preserved", () => {
    const root = createTempProject("cand-modify-");
    const id = "C-CAND-MOD-1-ABCDEF12";
    const candidate = mkCandidate(root, id, { spec: "<ours />" });
    writeFileSync(specPath(root, id), "<tampered />");
    const result = cleanupCandidate(candidate);
    expect(result.removed).toBe(false);
    expect(result.diagnostic).toMatch(/spec bytes changed/);
    expect(readFileSync(specPath(root, id), "utf8")).toBe("<tampered />");
    expect(existsSync(markerPath(root, id))).toBe(true);
  });

  it("(e) a foreign sentinel forces preserve-and-refuse", () => {
    const root = createTempProject("cand-foreign-");
    const id = "C-CAND-FOREIGN-1-ABCDEF12";
    const candidate = mkCandidate(root, id, { spec: "<ours />" });
    writeFileSync(path.join(candidateDir(root, id), "sentinel.txt"), "foreign");
    const result = cleanupCandidate(candidate);
    expect(result.removed).toBe(false);
    expect(result.diagnostic).toMatch(/foreign entry sentinel.txt/);
    expect(readFileSync(path.join(candidateDir(root, id), "sentinel.txt"), "utf8")).toBe("foreign");
  });

  it("(f) an identity-capture failure preserves the empty leaf and names it", () => {
    const root = createTempProject("cand-identity-");
    const id = "C-CAND-IDENT-1-ABCDEF12";
    const io: CandidateIo = {
      statSync: (() => {
        throw new Error("stat exploded");
      }) as unknown as typeof statSync,
    };
    expect(() => mintResolvedBundle(root, resolvedFor(id), io)).toThrow(/identity capture failed/);
    expect(existsSync(candidateDir(root, id))).toBe(true);
    expect(readdirSync(candidateDir(root, id))).toEqual([]);
  });

  it("(g) a first-unlink failure keeps the marker while the spec survives", () => {
    const root = createTempProject("cand-first-unlink-");
    const id = "C-CAND-FIRST-1-ABCDEF12";
    const candidate = mkCandidate(root, id, { spec: "<ours />" });
    let calls = 0;
    const io: CandidateIo = {
      unlinkSync: ((file: string) => {
        calls += 1;
        if (calls === 1) throw new Error("injected first unlink failure");
        rmSync(file);
      }) as unknown as typeof import("node:fs").unlinkSync,
    };
    const result = cleanupCandidate(candidate, io);
    expect(result.removed).toBe(false);
    expect(result.diagnostic).toMatch(/cleanup failed/);
    expect(existsSync(specPath(root, id))).toBe(true);
    expect(existsSync(markerPath(root, id))).toBe(true);
  });

  it("(g2) a second-unlink failure leaves named marker-only residue", () => {
    const root = createTempProject("cand-second-unlink-");
    const id = "C-CAND-SECOND-1-ABCDEF12";
    const candidate = mkCandidate(root, id, { spec: "<ours />" });
    let calls = 0;
    const io: CandidateIo = {
      unlinkSync: ((file: string) => {
        calls += 1;
        if (calls === 2) throw new Error("injected second unlink failure");
        rmSync(file);
      }) as unknown as typeof import("node:fs").unlinkSync,
    };
    const result = cleanupCandidate(candidate, io);
    expect(result.removed).toBe(false);
    expect(existsSync(specPath(root, id))).toBe(false);
    expect(existsSync(markerPath(root, id))).toBe(true);
    expect(existsSync(candidateDir(root, id))).toBe(true);
  });

  it("(h) a clean owned leaf is removed on a handled refusal", () => {
    const root = createTempProject("cand-clean-");
    const id = "C-CAND-CLEAN-1-ABCDEF12";
    let writes = 0;
    const io: CandidateIo = {
      writeFileSync: ((file: string, data: string, opts?: unknown) => {
        writes += 1;
        if (writes === 2) throw new Error("injected spec write failure");
        writeFileSync(file, data, opts as never);
      }) as unknown as typeof writeFileSync,
    };
    expect(() => mintResolvedBundle(root, resolvedFor(id), io)).toThrow(/injected spec write failure/);
    expect(existsSync(candidateDir(root, id))).toBe(false);
  });

  it("(i) a retained-residue refusal leaves one named directory and a same-id repeat adds none", () => {
    const root = createTempProject("cand-residue-");
    const id = "C-CAND-RESIDUE-1-ABCDEF12";
    mkdirSync(candidateDir(root, id), { recursive: true });
    writeFileSync(path.join(candidateDir(root, id), "sentinel.txt"), "foreign");
    expect(() => mintResolvedBundle(root, resolvedFor(id))).toThrow();
    expect(readdirSync(activeDirFor(root)).filter((name) => name === id)).toHaveLength(1);
    expect(() => mintResolvedBundle(root, resolvedFor(id))).toThrow();
    expect(readdirSync(activeDirFor(root)).filter((name) => name === id)).toHaveLength(1);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-001: the public cleanup acquires the lock itself.
describe("candidate cleanup lock API", () => {
  const activeDirFor = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");

  function ownedCandidate(root: string, id: string): AcquiredCandidate {
    const dir = path.join(activeDirFor(root), id);
    mkdirSync(dir, { recursive: true });
    const stat = statSync(dir);
    writeFileSync(path.join(dir, "spec.xml"), "<ours />");
    writeFileSync(path.join(dir, ".ngrace-mint-owner"), "tok\n");
    return {
      path: dir,
      markerPath: path.join(dir, ".ngrace-mint-owner"),
      specPath: path.join(dir, "spec.xml"),
      token: "tok",
      expectedSpecBytes: "<ours />",
      stage: "spec-written",
      dev: stat.dev,
      ino: stat.ino,
    };
  }

  it("AC-CLEANUP-LOCK-API: exported cleanupCandidate holds the reentrant candidate lock while it deletes", () => {
    const root = createTempProject("cand-lock-api-");
    const id = "C-CAND-LOCKAPI-1-ABCDEF12";
    const candidate = ownedCandidate(root, id);
    const lock = path.join(activeDirFor(root), `.candidate-${id}.lock`);
    let heldDuringUnlink = false;
    const io: CandidateIo = {
      unlinkSync: ((file: string) => {
        if (file === candidate.specPath) heldDuringUnlink = existsSync(lock);
        rmSync(file);
      }) as unknown as typeof import("node:fs").unlinkSync,
    };
    const result = cleanupCandidate(candidate, io);
    expect(result.removed).toBe(true);
    expect(heldDuringUnlink).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it("AC-COOPERATING-WRITER-COVERAGE cleanupCandidate waits on a real returned published candidate, then revalidates and removes only owned bytes", async () => {
    const root = createTempProject("cand-live-clean-");
    const resolved: ResolvedSpecMint = {
      id: "C-CAND-LIVECLEAN-1-ABCDEF12",
      slug: "CAND-LIVECLEAN",
      lineage: 1,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    // A real returned, published AcquiredCandidate through the production mint path.
    const { acquired } = mintResolvedBundle(root, resolved);
    expect(acquired.stage).toBe("published");
    const dir = acquired.path;
    expect(readFileSync(acquired.specPath, "utf8")).toBe(acquired.expectedSpecBytes);
    expect(existsSync(acquired.markerPath)).toBe(false);

    const lockPath = path.join(activeDirFor(root), `.candidate-${resolved.id}.lock`);
    const cursorModule = path.join(repoRoot, "src", "grace-cursor.ts");
    const holder = Bun.spawn({
      cmd: [process.execPath, "-e", `const mod = await import(${JSON.stringify(cursorModule)}); mod.withCandidateLock(${JSON.stringify(root)}, ${JSON.stringify(resolved.id)}, () => { Bun.sleepSync(600); });`],
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let i = 0; i < 400 && !existsSync(lockPath); i += 1) await Bun.sleep(5);
    expect(existsSync(lockPath)).toBe(true);

    const acquiredFile = path.join(root, "acquired.json");
    const resultFile = path.join(root, "cleanup-result.json");
    writeFileSync(acquiredFile, JSON.stringify(acquired));
    const generateModule = path.join(repoRoot, "src", "grace-generate.ts");
    const cleaner = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `import { readFileSync, writeFileSync } from "node:fs";
         const gen = await import(${JSON.stringify(generateModule)});
         const acquired = JSON.parse(readFileSync(${JSON.stringify(acquiredFile)}, "utf8"));
         let observed = 0;
         gen.setCandidateCleanupObserverForTests(() => { observed += 1; });
         const result = gen.cleanupCandidate(acquired);
         writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ result, observed }));`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    // While another process holds the candidate lock, cleanup is pending and writes nothing.
    await Bun.sleep(200);
    expect(existsSync(dir), "cleanup stays pending while the lock is held").toBe(true);
    expect(existsSync(resultFile), "no outcome is reported while pending").toBe(false);
    await holder.exited;
    const cleanerCode = await cleaner.exited;
    expect(cleanerCode).toBe(0);
    const reported = JSON.parse(readFileSync(resultFile, "utf8")) as {
      result: { removed: boolean; diagnostic?: string };
      observed: number;
    };
    expect(reported.result.removed, "cleanup reacquired, revalidated, and removed").toBe(true);
    expect(reported.observed, "exactly one outcome is reported").toBe(1);
    expect(existsSync(dir), "only the owned bytes were removed").toBe(false);
    expect(existsSync(lockPath), "the lock is released after cleanup").toBe(false);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-002: plan new marker refusal.
describe("plan new marker refusal", () => {
  const activeDirFor = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");

  function approvedSpec(id: string): string {
    return `<NgraceChangeSpec graceVersion="1.0" status="approved"><${id} /></NgraceChangeSpec>`;
  }

  it("AC-PLAN-NEW-MARKER-REFUSAL (b): an approved spec beside a stale marker refuses for the marker", () => {
    const root = createTempProject("plan-marker-");
    const id = "C-PLAN-MARKER-1-ABCDEF12";
    const dir = path.join(activeDirFor(root), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "spec.xml"), approvedSpec(id));
    writeFileSync(path.join(dir, ".ngrace-mint-owner"), "stale-token\n");
    const result = runGenerate(root, ["plan", "new", id]);
    expect(result.exitCode).not.toBe(0);
    expect(Buffer.from(result.stderr).toString("utf8")).toMatch(/unpublished candidate|ownership marker/i);
    expect(existsSync(path.join(dir, "plan.xml"))).toBe(false);
  });

  it("AC-PLAN-NEW-MARKER-REFUSAL (a): waits for a live publisher, then refuses on the draft-spec prerequisite", async () => {
    const root = createTempProject("plan-live-");
    const pauseFile = path.join(root, "release-candidate");
    const env = { ...process.env, NGRACE_PAUSE_CANDIDATE_FILE: pauseFile };
    const publisher = Bun.spawn({
      cmd: [
        process.execPath,
        graceBin,
        "spec",
        "new",
        "PLANLIVE",
        "--timestamp",
        "2026-09-19T00:00:00Z",
        "--branch",
        "probe",
        "--path",
        root,
      ],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const activeDir = activeDirFor(root);
    let id: string | undefined;
    for (let i = 0; i < 400 && !id; i += 1) {
      const found = existsSync(activeDir)
        ? readdirSync(activeDir).find((name) => name.startsWith("C-PLANLIVE-1-"))
        : undefined;
      if (found && existsSync(path.join(activeDir, found, "spec.xml"))) id = found;
      if (!id) await Bun.sleep(5);
    }
    expect(id).toBeDefined();
    const contender = Bun.spawn({
      cmd: [process.execPath, graceBin, "plan", "new", id!, "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    await Bun.sleep(300);
    // While the publisher holds the candidate lock, the contender is pending and writes nothing.
    expect(existsSync(path.join(activeDir, id!, "plan.xml"))).toBe(false);
    writeFileSync(pauseFile, "go\n");
    await publisher.exited;
    const code = await contender.exited;
    expect(code).not.toBe(0);
    expect(existsSync(path.join(activeDir, id!, "plan.xml"))).toBe(false);
    await contender.exited;
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-003: the exported creation wrappers map onto the same transaction.
describe("creation wrapper mapping", () => {
  it("AC-WRAPPER-ROUTES: mintBundle and mintResolvedBundle converge on publishSpecNew via writeSpecNew", () => {
    const src = readFileSync(path.join(import.meta.dir, "grace-generate.ts"), "utf8");
    expect(src).toMatch(/export function mintResolvedBundle\([\s\S]*?const published = publishSpecNew\(root, resolved\.id, io\);/);
    expect(src).toMatch(/export function mintBundle\([\s\S]*?return mintResolvedBundle\(root, mint\);/);
    expect(src).toMatch(/function writeSpecNew\(root: string, changeId: string\): string \{\n  return publishSpecNew\(root, changeId\)\.relative;/);
    expect(src).toMatch(/const relative = writeSpecNew\(root, mint\.id\);/);
  });

  it("AC-WRAPPER-ROUTES: a competitor spec.xml is preserved by the resolved and bundle routes", () => {
    const root = createTempProject("wrapper-preserve-");
    const id = "C-WRAP-RESOLVED-1-ABCDEF12";
    const dir = path.join(root, ARTIFACT_DIR, "changes", "active", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "spec.xml"), "<competitor />");
    const resolved: ResolvedSpecMint = {
      id,
      slug: "WRAP-RESOLVED",
      lineage: 1,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    expect(() => mintResolvedBundle(root, resolved)).toThrow(/already exists/i);
    expect(readFileSync(path.join(dir, "spec.xml"), "utf8")).toBe("<competitor />");
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-001: the isolated-process acquisition interceptor.
describe("candidate mint exclusivity interceptor", () => {
  const BASE_COMMIT = "6dd1d95";

  function preloadSource(prefix: string): string {
    return [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { mock } from "bun:test";',
      "let fired = false;",
      "const original = fs.mkdirSync;",
      "const patched = function (p, ...args) {",
      `  if (!fired && String(p).includes("/.ngrace/changes/active/${prefix}")) {`,
      "    fired = true;",
      "    original(p, { recursive: true });",
      '    fs.writeFileSync(path.join(String(p), "spec.xml"), "PREEXISTING-CONCURRENT-CANDIDATE\\n");',
      '    fs.writeFileSync(path.join(String(p), "other-writer.txt"), "OTHER-WRITER-EVIDENCE\\n");',
      '    process.stderr.write("PROBE: candidate created by another actor after existence checks, before mkdir\\n");',
      "  }",
      "  return original.call(fs, p, ...args);",
      "};",
      'mock.module("node:fs", () => ({ ...fs, mkdirSync: patched }));',
      'process.on("exit", () => { if (!fired) { process.stderr.write("INJECTION DID NOT FIRE\\n"); process.exitCode = 98; } });',
      "",
    ].join("\n");
  }

  function writePreload(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "mint-preload-"));
    const file = path.join(dir, "preload.js");
    writeFileSync(file, preloadSource(prefix));
    return file;
  }

  function driveMint(repo: string, preload: string) {
    const root = createTempProject("mint-excl-");
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "--preload",
        preload,
        path.join(repo, "src", "grace.ts"),
        "spec",
        "new",
        "MINTEX",
        "--timestamp",
        "2026-09-19T00:00:00Z",
        "--branch",
        "b",
        "--path",
        root,
      ],
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    });
    const active = path.join(root, ARTIFACT_DIR, "changes", "active");
    const dirs = existsSync(active) ? readdirSync(active).filter((name) => name.startsWith("C-MINTEX-1-")) : [];
    const bundle = dirs.length === 1 ? path.join(active, dirs[0]!) : undefined;
    const readIf = (name: string): string | undefined => {
      if (!bundle || !existsSync(path.join(bundle, name))) return undefined;
      return readFileSync(path.join(bundle, name), "utf8");
    };
    return {
      exit: result.exitCode,
      stderr: Buffer.from(result.stderr).toString("utf8"),
      dirs,
      preserved: readIf("spec.xml") === "PREEXISTING-CONCURRENT-CANDIDATE\n",
      other: readIf("other-writer.txt") === "OTHER-WRITER-EVIDENCE\n",
    };
  }

  it("AC-MINT-EXCLUSIVE: the repaired tree refuses the interspersed competitor and preserves every byte", () => {
    const result = driveMint(repoRoot, writePreload("C-MINTEX-1-"));
    expect(result.stderr, "the interceptor reports it fired").toContain("PROBE: candidate created by another actor");
    expect(result.exit, "the repaired leaf mkdir refuses").not.toBe(0);
    expect(result.dirs, "only the competitor directory remains").toHaveLength(1);
    expect(result.preserved, "the competitor spec.xml is byte-identical").toBe(true);
    expect(result.other, "the competitor's unrelated file is preserved").toBe(true);
  });

  it("AC-MINT-EXCLUSIVE: the isolated unmodified baseline overwrites the competitor (candidateSpecPreserved false)", () => {
    const worktree = mkdtempSync(path.join(tmpdir(), "ngrace-baseline-"));
    const add = Bun.spawnSync({ cmd: ["git", "worktree", "add", "--detach", worktree, BASE_COMMIT], cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    expect(add.exitCode, Buffer.from(add.stderr).toString("utf8")).toBe(0);
    try {
      symlinkSync(path.join(repoRoot, "node_modules"), path.join(worktree, "node_modules"));
      const result = driveMint(worktree, writePreload("C-MINTEX-1-"));
      expect(result.stderr, "the interceptor reports it fired").toContain("PROBE: candidate created by another actor");
      expect(result.exit, "the baseline mint succeeds").toBe(0);
      expect(result.preserved, "the unmodified baseline overwrote the competitor").toBe(false);
      expect(result.other, "the competitor's unrelated file is preserved even on the baseline").toBe(true);
    } finally {
      Bun.spawnSync({ cmd: ["git", "worktree", "remove", "--force", worktree], cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  function driveRoute(preload: string, runnerBody: string, changeId: string) {
    const root = createTempProject("mint-route-");
    const runner = path.join(root, "runner.js");
    writeFileSync(runner, runnerBody);
    const result = Bun.spawnSync({ cmd: [process.execPath, "--preload", preload, runner, root], cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
    const readIf = (name: string): string | undefined => (existsSync(path.join(bundle, name)) ? readFileSync(path.join(bundle, name), "utf8") : undefined);
    return {
      exit: result.exitCode,
      stderr: Buffer.from(result.stderr).toString("utf8"),
      preserved: readIf("spec.xml") === "PREEXISTING-CONCURRENT-CANDIDATE\n",
      other: readIf("other-writer.txt") === "OTHER-WRITER-EVIDENCE\n",
    };
  }

  it("AC-MINT-EXCLUSIVE: the exported mintResolvedBundle route refuses the interspersed competitor", () => {
    const modulePath = JSON.stringify(path.join(repoRoot, "src", "grace-generate.ts"));
    const runner = `import { mintResolvedBundle } from ${modulePath};\nconst root = process.argv[2];\ntry { mintResolvedBundle(root, { id: "C-MINTR-1-ABCDEF12", slug: "MINTR", lineage: 1, hash: "ABCDEF12", branch: "b", timestamp: "2026-09-19T00:00:00Z" }); process.exit(0); } catch (e) { process.stderr.write(String(e.message)); process.exit(3); }`;
    const result = driveRoute(writePreload("C-MINTR-1-"), runner, "C-MINTR-1-ABCDEF12");
    expect(result.stderr).toContain("PROBE: candidate created by another actor");
    expect(result.exit).not.toBe(0);
    expect(result.preserved).toBe(true);
    expect(result.other).toBe(true);
  });

  it("AC-MINT-EXCLUSIVE: the exported mintBundle route refuses the interspersed competitor", () => {
    const modulePath = JSON.stringify(path.join(repoRoot, "src", "grace-generate.ts"));
    const runner = `import { mintBundle } from ${modulePath};\nconst root = process.argv[2];\ntry { const m = mintBundle(root, { slug: "MINTB", timestamp: "2026-09-19T00:00:00Z", branch: "b" }); process.stderr.write(m.id); process.exit(0); } catch (e) { process.stderr.write(String(e.message)); process.exit(3); }`;
    const root = createTempProject("mint-route-resolve-");
    // Resolve the id the same way the CLI does so the fixture knows the directory.
    const resolved = resolveSpecMint({ slug: "MINTB", timestamp: "2026-09-19T00:00:00Z", branch: "b" }, root);
    const preload = writePreload(`C-MINTB-1-`);
    const runnerFile = path.join(root, "runner.js");
    writeFileSync(runnerFile, runner);
    const spawned = Bun.spawnSync({ cmd: [process.execPath, "--preload", preload, runnerFile, root], cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "active", resolved.id);
    expect(Buffer.from(spawned.stderr).toString("utf8"), "the interceptor reports it fired").toContain("PROBE: candidate created by another actor");
    expect(spawned.exitCode, "the exported mintBundle route refuses").not.toBe(0);
    expect(readFileSync(path.join(bundle, "spec.xml"), "utf8")).toBe("PREEXISTING-CONCURRENT-CANDIDATE\n");
    expect(readFileSync(path.join(bundle, "other-writer.txt"), "utf8")).toBe("OTHER-WRITER-EVIDENCE\n");
  });

  it("AC-MINT-EXCLUSIVE: the implicit supersede mint refuses the interspersed competitor", () => {
    const root = createTempProject("mint-supersede-");
    const predecessorId = "C-SUPMEX-1-ABCDEF12";
    writeChangeBundleFixture(root, { changeId: predecessorId, location: "active", specStatus: "draft", planStatus: "draft" });
    const resolved = resolveSpecMint({ supersedes: predecessorId, timestamp: "2026-09-19T00:00:00Z", branch: "b" }, root);
    const preload = writePreload(`C-SUPMEX-2-`);
    const spawned = Bun.spawnSync({
      cmd: [process.execPath, "--preload", preload, path.join(repoRoot, "src", "grace.ts"), "supersede", "--change", predecessorId, "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = Buffer.from(spawned.stderr).toString("utf8");
    expect(stderr, "the interceptor reports it fired").toContain("PROBE: candidate created by another actor");
    expect(spawned.exitCode, "the implicit mint refuses").not.toBe(0);
    const competitor = path.join(root, ARTIFACT_DIR, "changes", "active", resolved.id);
    expect(readFileSync(path.join(competitor, "spec.xml"), "utf8")).toBe("PREEXISTING-CONCURRENT-CANDIDATE\n");
    expect(readFileSync(path.join(competitor, "other-writer.txt"), "utf8")).toBe("OTHER-WRITER-EVIDENCE\n");
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", predecessorId)), "the predecessor stays active").toBe(true);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", predecessorId)), "the predecessor was not archived").toBe(false);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-001: cleanup validates before the first delete.
describe("cleanup validate first", () => {
  it("AC-CLEANUP-VALIDATE-FIRST: a foreign marker token leaves every byte and calls zero unlinks", () => {
    const root = createTempProject("cand-vf-");
    const id = "C-VF-1-ABCDEF12";
    const dir = path.join(root, ARTIFACT_DIR, "changes", "active", id);
    mkdirSync(dir, { recursive: true });
    const stat = statSync(dir);
    writeFileSync(path.join(dir, "spec.xml"), "<ours />");
    writeFileSync(path.join(dir, ".ngrace-mint-owner"), "foreign-token\n");
    const candidate: AcquiredCandidate = {
      path: dir,
      markerPath: path.join(dir, ".ngrace-mint-owner"),
      specPath: path.join(dir, "spec.xml"),
      token: "ours-token",
      expectedSpecBytes: "<ours />",
      stage: "spec-written",
      dev: stat.dev,
      ino: stat.ino,
    };
    const before = readdirSync(dir).sort().map((name) => `${name}:${readFileSync(path.join(dir, name), "utf8")}`);
    let unlinks = 0;
    const io: CandidateIo = {
      unlinkSync: ((file: string) => {
        unlinks += 1;
        rmSync(file);
      }) as unknown as typeof import("node:fs").unlinkSync,
    };
    const result = cleanupCandidate(candidate, io);
    expect(result.removed).toBe(false);
    expect(result.diagnostic).toMatch(/marker token changed/);
    expect(unlinks, "no unlink is issued before ownership validation passes").toBe(0);
    const after = readdirSync(dir).sort().map((name) => `${name}:${readFileSync(path.join(dir, name), "utf8")}`);
    expect(after).toEqual(before);
    expect(statSync(dir).ino).toBe(stat.ino);
  });
});
