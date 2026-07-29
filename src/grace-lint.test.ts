import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "./artifact/paths";
import { lintGraceProject } from "./grace-lint";
import { getLintIssueGuide } from "./lint/catalog";

function createProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-lint-"));
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeMinimalNgraceProject(root: string) {
  writeProjectFile(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements graceVersion="1.0"><Summary>Required.</Summary></NgraceRequirements>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/technology.xml`, `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/principles.xml`, `<NgracePrinciples graceVersion="1.0"><Principle>Safe.</Principle></NgracePrinciples>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<NgraceDeployment graceVersion="1.0"><Applicability>applicable</Applicability></NgraceDeployment>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<NgraceUXGuidelines graceVersion="1.0"><Applicability>applicable</Applicability></NgraceUXGuidelines>`);
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary><Path>src/example.ts</Path></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/main.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>example works</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
  );
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });
  writeProjectFile(
    root,
    "src/example.ts",
    `// START_MODULE_CONTRACT
//   PURPOSE: Example runtime.
//   SCOPE: Small fixture.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   run - Execute the example runtime.
// END_MODULE_MAP
export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`,
  );
  writeProjectFile(root, "src/example.test.ts", `import { expect, test } from "bun:test";\ntest("example", () => expect(1).toBe(1));\n`);
}

function writeApprovedChange(
  root: string,
  changeId: string,
  baselineAssertions: string,
  targetAssertions: string,
  status: "draft" | "approved" = "approved",
) {
  const bundle = `${ARTIFACT_DIR}/changes/active/${changeId}`;
  writeProjectFile(
    root,
    `${bundle}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="approved"><${changeId}><Summary>Selected change.</Summary><Goals><Goal>Exercise assertions.</Goal></Goals><Constraints><Constraint>Preserve fixture validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>Assertions are evaluated.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></${changeId}></NgraceChangeSpec>`,
  );
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="${status}"><${changeId}><IntentSummary>Evaluate selected assertions.</IntentSummary><BaselineAssertions>${baselineAssertions}</BaselineAssertions><TargetAssertions>${targetAssertions}</TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Verify assertions</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Assertions pass.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></${changeId}></NgraceChangePlan>`,
  );
}

describe("lintGraceProject", () => {
  it("passes a valid GRACE 4 .ngrace project", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);

    const result = lintGraceProject(root);

    expect(result.summary.errors).toBe(0);
    expect(result.tool).toBe("grace-lint");
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.generatedAt).toBeTruthy();
    expect(result.root).toBe(path.resolve(root));
    expect(result.xmlFilesChecked).toBeGreaterThan(0);
  });

  it("fails with migration guidance when only GRACE 3 docs are present", () => {
    const root = createProject();
    writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan />`);

    const result = lintGraceProject(root);

    expect(result.issues[0]?.code).toBe("project.grace3-detected");
    expect(result.issues[0]?.message).toContain("ngrace-migrate");
    expect(result.issues.map((issue) => issue.code)).toEqual(["project.grace3-detected"]);
  });

  it("fails with missing .ngrace guidance when no GRACE artifacts exist", () => {
    const result = lintGraceProject(createProject());

    expect(result.issues[0]?.code).toBe("project.missing-grace");
    expect(result.issues[0]?.message).toContain("No .ngrace directory");
  });

  it("returns JSON-compatible output shape with issue counts", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements><Summary>Missing version.</Summary></NgraceRequirements>`);

    const result = lintGraceProject(root);

    expect(JSON.parse(JSON.stringify(result)).tool).toBe("grace-lint");
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.code)).toContain("artifact.missing-grace-version");
  });

  it("rejects wrong document roots, unindexed documents, and mismatched executable bundles", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/main.xml`, `<NgraceRequirements graceVersion="1.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></NgraceRequirements>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/unindexed.xml`, `<NgraceGraphDocument graceVersion="1.0"><GD-EXTRA><M-EXTRA /></GD-EXTRA></NgraceGraphDocument>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-FOLDER/spec.xml`, `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-SPEC /></NgraceChangeSpec>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-FOLDER/plan.xml`, `<NgraceChangePlan graceVersion="1.0" status="approved"><C-PLAN /></NgraceChangePlan>`);

    const issueCodes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(issueCodes).toContain("artifact.unexpected-root-tag");
    expect(issueCodes).toContain("projection.graph.unindexed-document");
    expect(issueCodes).toContain("change.bundle-id-mismatch");
    expect(issueCodes).toContain("change.spec-plan-id-mismatch");
    expect(issueCodes).toContain("change.plan-missing-section");
  });

  it("G-05: errors when an approved plan DurableScope covers a different module than the spec AffectedAreas", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-MISMATCH/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-MISMATCH><Summary>Spec A.</Summary><Goals><Goal>Govern M-EXAMPLE.</Goal></Goals><Constraints><Constraint>Keep fixtures valid.</Constraint></Constraints><NonGoals><NonGoal>Unrelated work.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>Scope matches.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></C-MISMATCH></NgraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-MISMATCH/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-MISMATCH><IntentSummary>Plan B for a different module.</IntentSummary><BaselineAssertions><MustExist><Value>M-OTHER</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-OTHER</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-OTHER /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/other.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Wrong scope</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></C-MISMATCH></NgraceChangePlan>`,
    );

    const codes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(codes).toContain("change.scope-does-not-cover-spec");
    expect(codes).toContain("change.plan-scope-exceeds-spec");
  });

  it("accepts a well-formed AC-* / Satisfies change bundle", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-AC/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-AC><Summary>AC coverage.</Summary><Goals><Goal>Map criteria.</Goal></Goals><Constraints><Constraint>Keep fixtures valid.</Constraint></Constraints><NonGoals><NonGoal>Unrelated work.</NonGoal></NonGoals><AcceptanceCriteria><AC-KEYBOARD-NAV>Arrow keys move focus.</AC-KEYBOARD-NAV><AC-AXE-CLEAN>axe is clean.</AC-AXE-CLEAN></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></C-AC></NgraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-AC/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-AC><IntentSummary>Implement criteria.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Wire both criteria</Title><DependsOn></DependsOn><Satisfies><AC-KEYBOARD-NAV /><AC-AXE-CLEAN /></Satisfies><AcceptanceCriteria><Criterion>Both pass.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></C-AC></NgraceChangePlan>`,
    );

    const result = lintGraceProject(root);
    expect(result.summary.errors).toBe(0);
    expect(result.issues.map((issue) => issue.code)).not.toContain("change.acceptance-criterion-unmapped");
    expect(result.issues.map((issue) => issue.code)).not.toContain("change.unknown-acceptance-criterion");
    expect(result.issues.map((issue) => issue.code)).not.toContain("change.scope-does-not-cover-spec");
  });

  it("projects without design-system.xml remain compatible after Phase 6", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    const result = lintGraceProject(root);
    expect(result.summary.errors).toBe(0);
    expect(result.issues.map((i) => i.code).filter((c) => c.startsWith("design-system."))).toEqual([]);
  });

  it("reports unknown module Type as a warning, not an error", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example</Summary><Path>src/example.ts</Path><Type>NONSENSE</Type></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
    );
    const result = lintGraceProject(root);
    const issue = result.issues.find((i) => i.code === "graph.unknown-module-type");
    expect(issue?.severity).toBe("warning");
    expect(result.summary.errors).toBe(0);
  });

  it("keeps the shipped spec and plan templates mutually consistent under spec→plan coverage", () => {
    // String assertions in skill-contracts cannot catch the templates naming different
    // placeholder modules. Linting them as a real bundle can.
    const skills = path.resolve(import.meta.dir, "../skills/ngrace");
    const fill = (relativePath: string) =>
      readFileSync(path.join(skills, relativePath), "utf8")
        .replace(/C-CHANGE-ID/g, "C-TEMPLATE")
        .replace(/\$[A-Z_]+/g, "Placeholder prose.")
        .replace(/status="draft"/, `status="approved"`);

    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-TEMPLATE/spec.xml`, fill("ngrace-spec/references/change-spec-template.xml"));
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-TEMPLATE/plan.xml`, fill("ngrace-plan/references/change-plan-template.xml"));

    const codes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(codes).not.toContain("change.scope-does-not-cover-spec");
    expect(codes).not.toContain("change.plan-scope-exceeds-spec");
    expect(codes).not.toContain("change.unknown-acceptance-criterion");
    expect(codes).not.toContain("change.acceptance-criterion-unmapped");
  });

  it("documents GRACE 4 diagnostic prefixes and removes allow-missing-docs CLI exposure", () => {
    expect(getLintIssueGuide("projection.graph.wrapper-mismatch").title).toContain("Projection");
    expect(getLintIssueGuide("assertion.MustExist").title).toContain("Assertion");
    expect(getLintIssueGuide("scope.durable-overlap").title).toContain("Scope");

    const lintSource = readFileSync(path.resolve(import.meta.dir, "grace-lint.ts"), "utf8");
    expect(lintSource).not.toContain("allowMissingDocs");
    expect(lintSource).not.toContain("allow-missing-docs");
  });

  it("wires the lint command through the CLI", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    const repoRoot = path.resolve(import.meta.dir, "..");

    const result = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", root, "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(Buffer.from(result.stdout).toString("utf8"));
    expect(parsed.tool).toBe("grace-lint");
    expect(parsed.summary.errors).toBe(0);
  });

  it("returns structured JSON for invalid options and missing project paths without stack traces", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    const invalid = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--profile", "unsupported", "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(invalid.exitCode).not.toBe(0);
    expect(Buffer.from(invalid.stderr).toString("utf8")).toBe("");
    expect(JSON.parse(Buffer.from(invalid.stdout).toString("utf8"))).toEqual(expect.objectContaining({
      schemaVersion: "1.0.0",
      ok: false,
      error: expect.objectContaining({ code: "invalid-arguments" }),
    }));

    const missingRoot = path.join(os.tmpdir(), `grace-missing-${crypto.randomUUID()}`);
    const missing = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", missingRoot, "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(missing.exitCode).not.toBe(0);
    expect(Buffer.from(missing.stderr).toString("utf8")).toBe("");
    const missingResult = JSON.parse(Buffer.from(missing.stdout).toString("utf8"));
    expect(missingResult.tool).toBe("grace-lint");
    expect(missingResult.issues.map((issue: { code: string }) => issue.code)).toContain("project.missing-grace");
  });
  it("does not evaluate BaselineAssertions for archived plans", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    // Only create archived plan with BaselineAssertions
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-DONE/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions></C-DONE></NgraceChangePlan>`,
    );
    expect(lintGraceProject(root).issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);

    // Remove M-EXAMPLE from graph so the archived baseline would fail if evaluated
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns /></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN /></NgraceGraphDocument>`,
    );

    const after = lintGraceProject(root);
    expect(after.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });
  it("emits assertion.MustExist for active plans with stale BaselineAssertions but not for archived plans", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);

    // Create an active plan with a MustExist reference to a module that does not exist
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-REFACTOR/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-REFACTOR><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-REFACTOR></NgraceChangePlan>`,
    );

    // Active plan should emit assertion.MustExist for nonexistent module
    const activeResult = lintGraceProject(root);
    expect(activeResult.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);

    // Now also add an archived plan with the same stale baseline
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-DONE/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DONE></NgraceChangePlan>`,
    );

    // Archived plan should NOT emit additional assertion.MustExist
    const bothResult = lintGraceProject(root);
    const assertionIssues = bothResult.issues.filter((issue) => issue.code === "assertion.MustExist");
    // Only the active plan's assertion should fire
    expect(assertionIssues).toHaveLength(1);
  });

  it("does not evaluate TargetAssertions for active approved plans in general lint", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-TARGET/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-TARGET><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-MISSING</Module></MustVerify></TargetAssertions></C-TARGET></NgraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    // TargetAssertion MustVerify for M-MISSING should NOT fire
    expect(result.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
  });

  it("requires one approved identity-matched active change for selected assertion modes", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);

    expect(lintGraceProject(root, { assertionMode: "target" }).issues.map((issue) => issue.code)).toContain("assertion.change-required");
    expect(lintGraceProject(root, { assertionMode: "baseline", changeId: "not-a-change" }).issues.map((issue) => issue.code)).toContain("assertion.invalid-change-id");

    writeApprovedChange(
      root,
      "C-DRAFT",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`,
      "draft",
    );
    expect(lintGraceProject(root, { assertionMode: "target", changeId: "C-DRAFT" }).issues.map((issue) => issue.code)).toContain("assertion.change-not-approved");
  });

  it("evaluates only the selected baseline or target section", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(
      root,
      "C-SELECTED",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustVerify><Module>M-MISSING</Module></MustVerify>`,
    );

    const baseline = lintGraceProject(root, { assertionMode: "baseline", changeId: "C-SELECTED" });
    expect(baseline.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
    expect(baseline.assertionMode).toBe("baseline");
    expect(baseline.changeId).toBe("C-SELECTED");

    const target = lintGraceProject(root, { assertionMode: "target", changeId: "C-SELECTED" });
    expect(target.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(1);
  });

  it("requires explicit command opt-in and exposes selected assertion CLI flags", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(
      root,
      "C-COMMAND",
      `<MustPassCommand><Command>exit 99</Command></MustPassCommand>`,
      `<MustPassCommand><Command>${process.platform === "win32" ? "exit /b 0" : "exit 0"}</Command></MustPassCommand>`,
    );

    const current = lintGraceProject(root);
    expect(current.issues.map((issue) => issue.code)).not.toContain("assertion.command-not-evaluated");
    expect(current.issues.some((issue) => issue.message.includes("exit 99"))).toBe(false);

    const skipped = lintGraceProject(root, { assertionMode: "target", changeId: "C-COMMAND" });
    expect(skipped.issues.map((issue) => issue.code)).toContain("assertion.command-not-evaluated");

    const executed = lintGraceProject(root, { assertionMode: "target", changeId: "C-COMMAND", runCommands: true });
    expect(executed.issues.map((issue) => issue.code)).not.toContain("assertion.command-not-evaluated");
    expect(executed.commandsEnabled).toBe(true);

    const repoRoot = path.resolve(import.meta.dir, "..");
    const cli = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", root, "--change", "C-COMMAND", "--assertions", "target", "--run-commands", "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(Buffer.from(cli.stdout).toString("utf8")).assertionMode).toBe("target");
  });

  it("rejects target command evidence that recursively invokes current baseline lint", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(
      root,
      "C-PHASE-CONFLICT",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustPassCommand><Command>ngrace lint --path . --assertions current</Command></MustPassCommand>`,
    );

    const current = lintGraceProject(root);
    const issue = current.issues.find((item) => item.code === "assertion.phase-incompatible-command");
    expect(issue?.message).toContain("leaf project evidence");
    expect(issue?.title).toContain("Phase-Incompatible");

    const final = lintGraceProject(root, { assertionMode: "final", changeId: "C-PHASE-CONFLICT", runCommands: true });
    expect(final.issues.map((item) => item.code)).toContain("assertion.phase-incompatible-command");
    expect(final.issues.map((item) => item.code)).not.toContain("assertion.MustPassCommand");
  });

  it("does not apply new phase policy retroactively to archived plans", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-HISTORICAL/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="applied"><C-HISTORICAL><Summary>Historical change.</Summary><Goals><Goal>Preserve history.</Goal></Goals><Constraints><Constraint>Do not rewrite archives.</Constraint></Constraints><NonGoals><NonGoal>New behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>History remains readable.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></C-HISTORICAL></NgraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-HISTORICAL/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="applied"><C-HISTORICAL><IntentSummary>Historical plan.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustPassCommand><Command>ngrace lint --path . --assertions current</Command></MustPassCommand></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Historical task</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></C-HISTORICAL></NgraceChangePlan>`,
    );

    expect(lintGraceProject(root).issues.map((item) => item.code)).not.toContain("assertion.phase-incompatible-command");
  });

  it("reserves blocking overlap diagnostics for explicit parallel preflight", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(root, "C-ONE", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);
    writeApprovedChange(root, "C-TWO", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);

    const ordinaryCodes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(ordinaryCodes).toContain("scope.durable-overlap");
    expect(ordinaryCodes).not.toContain("scope.parallel-durable-overlap");
    expect(ordinaryCodes).not.toContain("scope.observed-write-overlap");

    const preflightCodes = lintGraceProject(root, { parallelPreflight: true }).issues.map((issue) => issue.code);
    expect(preflightCodes).toContain("scope.parallel-durable-overlap");
    expect(preflightCodes).toContain("scope.observed-write-overlap");
  });

  it("does not evaluate BaselineAssertions for active draft plans", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-DRAFT/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="draft"><C-DRAFT><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DRAFT></NgraceChangePlan>`,
    );
    // Draft active plan should NOT fire assertion.MustExist
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });

  it("fails active approved plans with failing BaselineAssertions", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-STALE/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-STALE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-STALE></NgraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);
  });

  it("parses approved plan status through XML regardless of attribute quote style", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(
      root,
      "C-SINGLE-QUOTE",
      `<MustExist><Value>M-MISSING</Value></MustExist>`,
      `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`,
    );
    const planFile = path.join(root, `${ARTIFACT_DIR}/changes/active/C-SINGLE-QUOTE/plan.xml`);
    writeFileSync(planFile, readFileSync(planFile, "utf8").replace('status="approved"', "status='approved'"));

    expect(lintGraceProject(root).issues.map((issue) => issue.code)).toContain("assertion.MustExist");
  });

  it("uses final assertion mode for full end-state validation without re-evaluating the selected baseline", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(
      root,
      "C-CREATE",
      `<MustNotExist><Value>M-NEW</Value></MustNotExist>`,
      `<MustVerify><Module>M-NEW</Module></MustVerify>`,
    );
    expect(lintGraceProject(root).summary.errors).toBe(0);

    writeProjectFile(root, `${ARTIFACT_DIR}/graph/index.xml`, `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-NEW /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/main.xml`, `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary></M-EXAMPLE><M-NEW><Summary>New module.</Summary></M-NEW></GD-MAIN></NgraceGraphDocument>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/verification/index.xml`, `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-NEW /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/verification/main.xml`, `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Scenario>Example works.</Scenario></V-M-EXAMPLE><V-M-NEW><Scenario>New module works.</Scenario></V-M-NEW></VD-MAIN></NgraceVerificationDocument>`);

    const current = lintGraceProject(root);
    expect(current.issues.map((issue) => issue.code)).toContain("assertion.MustNotExist");

    const final = lintGraceProject(root, { assertionMode: "final", changeId: "C-CREATE" });
    expect(final.summary.errors).toBe(0);
    expect(final.assertionMode).toBe("final");
  });

  it("keeps unrelated approved baselines active during selected final validation", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeApprovedChange(root, "C-SELECTED-FINAL", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);
    writeApprovedChange(root, "C-UNRELATED-STALE", `<MustExist><Value>M-MISSING</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);

    const final = lintGraceProject(root, { assertionMode: "final", changeId: "C-SELECTED-FINAL" });
    expect(final.issues.map((issue) => issue.code)).toContain("assertion.MustExist");
  });

  it("accepts a bundle with design-context.xml", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-DESIGN/design-context.xml`,
      `<NgraceChangeDesignContext graceVersion="1.0"><Change>C-DESIGN</Change><Rationale>Test.</Rationale></NgraceChangeDesignContext>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-DESIGN/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-DESIGN><Summary>Change with design context.</Summary></C-DESIGN></NgraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-DESIGN/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-DESIGN><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope></C-DESIGN></NgraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code.startsWith("design-context.") || issue.code === "artifact.invalid-root-tag" || issue.code === "change.invalid-root-tag")).toHaveLength(0);
  });

  it("reports analysis coverage for polyglot fixtures with Go and Rust adapter-backed", async () => {
    const { polyglotFixture, minimalTsFixture } = await import("./test-support/fixtures");
    const root = polyglotFixture();
    const result = lintGraceProject(root);
    // Phase 3: both .go and .rs are adapter-backed; no analysis.no-adapter on polyglot.
    expect(result.issues.filter((issue) => issue.code === "analysis.no-adapter")).toHaveLength(0);
    expect(result.summary.errors).toBe(0);
    expect(result.analysisCoverage.unverified).toEqual([]);
    expect(result.analysisCoverage.adapterBacked.some((entry) => entry.extension === ".tsx")).toBe(true);
    expect(result.analysisCoverage.adapterBacked.some((entry) => entry.extension === ".go" && entry.adapterId === "go")).toBe(true);
    expect(result.analysisCoverage.adapterBacked.some((entry) => entry.extension === ".rs" && entry.adapterId === "rust")).toBe(true);

    const tsOnly = lintGraceProject(minimalTsFixture());
    expect(tsOnly.issues.filter((issue) => issue.code === "analysis.no-adapter")).toHaveLength(0);
    expect(tsOnly.analysisCoverage.unverified).toEqual([]);
  });

  it("enforces Go MODULE_MAP parity and no longer emits analysis.no-adapter for .go", async () => {
    const { polyglotFixture } = await import("./test-support/fixtures");
    const root = polyglotFixture();

    // Matching map: no mismatch, no no-adapter for Go.
    const clean = lintGraceProject(root);
    const goIssues = clean.issues.filter((issue) => issue.file.endsWith(".go") || issue.file.includes("router.go"));
    expect(goIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");
    expect(goIssues.map((issue) => issue.code)).not.toContain("markup.module-map-mismatch");

    // G-01 regression: fabricated symbol must error (was silence at 4.0.4 / Phase 1).
    writeProjectFile(
      root,
      "services/gateway/internal/router/router.go",
      `// START_MODULE_CONTRACT
// PURPOSE: Route gateway requests to ledger services.
// SCOPE: Dispatch inbound HTTP/gRPC traffic.
// DEPENDS: none
// LINKS: M-GATEWAY-ROUTER
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// TotallyFakeSymbol - Fabricated for G-01 regression.
// END_MODULE_MAP
func Route(path string) error {
	// START_BLOCK_DISPATCH
	slog.Info("[GatewayRouter][Route][BLOCK_DISPATCH] dispatch")
	// END_BLOCK_DISPATCH
	return nil
}
`,
    );
    const broken = lintGraceProject(root);
    const mismatch = broken.issues.filter(
      (issue) => issue.code === "markup.module-map-mismatch" && issue.file.includes("router.go"),
    );
    expect(mismatch.length).toBeGreaterThanOrEqual(1);
    expect(mismatch[0]?.severity).toBe("error");

    // Build-tag file reports heuristic confidence.
    writeProjectFile(
      root,
      "services/gateway/internal/router/linux_only.go",
      `//go:build linux

// START_MODULE_CONTRACT
// PURPOSE: Linux-only helper.
// SCOPE: Platform file.
// DEPENDS: none
// LINKS: M-GATEWAY-ROUTER
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// LinuxHelper - Platform helper.
// END_MODULE_MAP
package router

func LinuxHelper() {}
`,
    );
    const tagged = lintGraceProject(root);
    expect(
      tagged.issues.some(
        (issue) => issue.code === "analysis.heuristic-confidence" && issue.file.includes("linux_only.go"),
      ),
    ).toBe(true);
  });

  it("enforces Rust MODULE_MAP parity and no longer emits analysis.no-adapter for .rs", async () => {
    const { polyglotFixture } = await import("./test-support/fixtures");
    const root = polyglotFixture();

    const clean = lintGraceProject(root);
    const rustIssues = clean.issues.filter((issue) => issue.file.endsWith(".rs") || issue.file.includes("lib.rs"));
    expect(rustIssues.map((issue) => issue.code)).not.toContain("analysis.no-adapter");
    expect(rustIssues.map((issue) => issue.code)).not.toContain("markup.module-map-mismatch");

    // G-01 regression: fabricated Rust symbol must error.
    writeProjectFile(
      root,
      "services/ledger/src/lib.rs",
      `// START_MODULE_CONTRACT
// PURPOSE: Ledger core posting and balance validation.
// SCOPE: Post journal entries with balance checks.
// DEPENDS: none
// LINKS: M-LEDGER-CORE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// TotallyFakeSymbol - Fabricated for G-01 regression.
// END_MODULE_MAP
pub fn post(amount: i64) -> Result<(), String> {
    // START_BLOCK_VALIDATE_BALANCE
    tracing::warn!("[LedgerCore][post][BLOCK_VALIDATE_BALANCE] unbalanced");
    // END_BLOCK_VALIDATE_BALANCE
    Ok(())
}
`,
    );
    const broken = lintGraceProject(root);
    const mismatch = broken.issues.filter(
      (issue) => issue.code === "markup.module-map-mismatch" && issue.file.includes("lib.rs"),
    );
    expect(mismatch.length).toBeGreaterThanOrEqual(1);
    expect(mismatch[0]?.severity).toBe("error");

    // pub(crate) listed as EXPORTS is a mismatch (not a crate-external export).
    writeProjectFile(
      root,
      "services/ledger/src/lib.rs",
      `// START_MODULE_CONTRACT
// PURPOSE: Ledger core.
// SCOPE: Internal.
// DEPENDS: none
// LINKS: M-LEDGER-CORE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// internal - Not actually public.
// END_MODULE_MAP
pub(crate) fn internal() {}
`,
    );
    const restricted = lintGraceProject(root);
    expect(
      restricted.issues.some(
        (issue) => issue.code === "markup.module-map-mismatch" && issue.file.includes("lib.rs"),
      ),
    ).toBe(true);

    // include! reports heuristic confidence.
    writeProjectFile(
      root,
      "services/ledger/src/generated_wrap.rs",
      `// START_MODULE_CONTRACT
// PURPOSE: Generated wrapper.
// SCOPE: Include generated code.
// DEPENDS: none
// LINKS: M-LEDGER-CORE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// wrap - Wrapper.
// END_MODULE_MAP
include!("generated.rs");
pub fn wrap() {}
`,
    );
    const included = lintGraceProject(root);
    expect(
      included.issues.some(
        (issue) => issue.code === "analysis.heuristic-confidence" && issue.file.includes("generated_wrap.rs"),
      ),
    ).toBe(true);
  });

  it("validates DEPENDS and LINKS anchors against the graph (G-10, G-11)", async () => {
    const { polyglotFixture } = await import("./test-support/fixtures");

    // Unmodified polyglot must stay clean of new reference issues.
    const polyglot = lintGraceProject(polyglotFixture());
    expect(polyglot.issues.filter((issue) => issue.code === "markup.unknown-dependency")).toHaveLength(0);
    expect(polyglot.issues.filter((issue) => issue.code === "markup.unknown-link")).toHaveLength(0);
    expect(polyglot.summary.errors).toBe(0);

    // Free-text DEPENDS (no M-*) are ignored.
    const freeRoot = createProject();
    writeMinimalNgraceProject(freeRoot);
    writeProjectFile(
      freeRoot,
      "src/example.ts",
      `// START_MODULE_CONTRACT
// PURPOSE: Example.
// SCOPE: Example.
// DEPENDS: postgres, redis
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// run - Run.
// END_MODULE_MAP
export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`,
    );
    expect(lintGraceProject(freeRoot).issues.filter((i) => i.code.startsWith("markup.unknown-"))).toHaveLength(0);

    // G-10: phantom DEPENDS
    writeProjectFile(
      freeRoot,
      "src/example.ts",
      `// START_MODULE_CONTRACT
// PURPOSE: Example.
// SCOPE: Example.
// DEPENDS: M-DOES-NOT-EXIST, M-ALSO-FAKE
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// run - Run.
// END_MODULE_MAP
export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`,
    );
    const dependsBroken = lintGraceProject(freeRoot);
    const depIssues = dependsBroken.issues.filter((i) => i.code === "markup.unknown-dependency");
    expect(depIssues.length).toBe(2);

    // G-11: phantom module link
    writeProjectFile(
      freeRoot,
      "src/example.ts",
      `// START_MODULE_CONTRACT
// PURPOSE: Example.
// SCOPE: Example.
// DEPENDS: none
// LINKS: M-NONEXISTENT
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// run - Run.
// END_MODULE_MAP
export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`,
    );
    const linkBroken = lintGraceProject(freeRoot);
    expect(linkBroken.issues.some((i) => i.code === "markup.unknown-link" && i.message.includes("M-NONEXISTENT"))).toBe(true);

    // Phantom verification link
    writeProjectFile(
      freeRoot,
      "src/example.ts",
      `// START_MODULE_CONTRACT
// PURPOSE: Example.
// SCOPE: Example.
// DEPENDS: none
// LINKS: M-EXAMPLE, V-M-NONEXISTENT
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// run - Run.
// END_MODULE_MAP
export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`,
    );
    const verifBroken = lintGraceProject(freeRoot);
    expect(verifBroken.issues.some((i) => i.code === "markup.unknown-link" && i.message.includes("V-M-NONEXISTENT"))).toBe(true);

    // Module with Path but no linking governed file → warning
    const orphanRoot = createProject();
    writeMinimalNgraceProject(orphanRoot);
    writeProjectFile(
      orphanRoot,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-ORPHAN /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      orphanRoot,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE><M-ORPHAN><Summary>Orphan.</Summary><Path>src/orphan.ts</Path></M-ORPHAN></GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      orphanRoot,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-ORPHAN /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
    );
    writeProjectFile(
      orphanRoot,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario></V-M-EXAMPLE><V-M-ORPHAN><Command>echo ok</Command><Scenario>ok</Scenario></V-M-ORPHAN></VD-MAIN></NgraceVerificationDocument>`,
    );
    const orphan = lintGraceProject(orphanRoot);
    const orphanWarn = orphan.issues.filter((i) => i.code === "graph.module-without-linked-files");
    expect(orphanWarn.length).toBeGreaterThanOrEqual(1);
    expect(orphanWarn.every((i) => i.severity === "warning")).toBe(true);
    expect(orphanWarn.some((i) => i.message.includes("M-ORPHAN"))).toBe(true);
  });

  it("does not treat a Summary mentioning Path or File as a declared module Path", () => {
    // The Path check reads the structured GraphAnchorRecord.path, not the
    // flattened projection text, where `<Summary>Path resolution helper.</Summary>`
    // is indistinguishable from a real `<Path>` element.
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-PROSE /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE><M-PROSE><Summary>Path resolution and File loading helpers.</Summary></M-PROSE></GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-PROSE /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario></V-M-EXAMPLE><V-M-PROSE><Command>echo ok</Command><Scenario>ok</Scenario></V-M-PROSE></VD-MAIN></NgraceVerificationDocument>`,
    );

    const result = lintGraceProject(root);
    const warnings = result.issues.filter((i) => i.code === "graph.module-without-linked-files");
    expect(warnings.some((i) => i.message.includes("M-PROSE"))).toBe(false);
  });

  it("Phase 7: IC-* Schema escape and missing Provider fire through ngrace lint", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "src/gateway.ts", "export const g = 1;\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-GATEWAY /><IC-BAD /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
        + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
        + `<M-GATEWAY><Summary>Gateway.</Summary><Path>src/gateway.ts</Path></M-GATEWAY>`
        + `<IC-BAD><Summary>Bad contract.</Summary><Schema>../../etc/passwd</Schema><Version>1.0.0</Version>`
        + `<Provider><M-DOES-NOT-EXIST /></Provider><Consumer><M-GATEWAY /></Consumer>`
        + `<BreakingChangePolicy>additive-only</BreakingChangePolicy></IC-BAD>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-GATEWAY /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN>`
        + `<V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario></V-M-EXAMPLE>`
        + `<V-M-GATEWAY><Command>echo ok</Command><Scenario>ok</Scenario></V-M-GATEWAY>`
        + `</VD-MAIN></NgraceVerificationDocument>`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.map((i) => i.code)).toContain("projection.graph.invalid-interface-contract");
    expect(result.issues.some((i) => i.message.includes("contained project path") || i.message.includes("Provider"))).toBe(true);
    expect(getLintIssueGuide("projection.graph.invalid-interface-contract").title).toContain("Interface Contract");
  });

  it("Phase 7: ordered DF gap and flat DF compatibility through ngrace lint", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "src/gateway.ts", "export const g = 1;\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-GATEWAY /><DF-FLAT /><DF-GAP /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
        + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
        + `<M-GATEWAY><Summary>Gateway.</Summary><Path>src/gateway.ts</Path></M-GATEWAY>`
        + `<DF-FLAT><Summary>Legacy flat.</Summary><M-EXAMPLE /><M-GATEWAY /></DF-FLAT>`
        + `<DF-GAP><Summary>Gapped.</Summary><Step order="1"><M-EXAMPLE /></Step><Step order="3"><M-GATEWAY /></Step></DF-GAP>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-GATEWAY /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN>`
        + `<V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario></V-M-EXAMPLE>`
        + `<V-M-GATEWAY><Command>echo ok</Command><Scenario>ok</Scenario></V-M-GATEWAY>`
        + `</VD-MAIN></NgraceVerificationDocument>`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.map((i) => i.code)).toContain("projection.graph.invalid-data-flow-step");
    expect(result.issues.some((i) => i.message.includes("DF-GAP") && i.message.includes("missing 2"))).toBe(true);
    // Flat form must not invent step errors for DF-FLAT.
    expect(result.issues.filter((i) => i.message.includes("DF-FLAT") && i.code === "projection.graph.invalid-data-flow-step")).toHaveLength(0);
  });

  it("Phase 7: project without invariants.xml gains no context.invariants codes", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    const result = lintGraceProject(root);
    expect(result.issues.filter((i) => i.code.startsWith("context.invariants."))).toHaveLength(0);
    expect(result.summary.errors).toBe(0);
  });

  it("Phase 7: MustConform and MustPassBudget respect --run-commands opt-in", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "proto/x.proto", "syntax = \"proto3\";\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><IC-X /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
        + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
        + `<IC-X><Summary>Contract.</Summary><Schema>proto/x.proto</Schema><Version>1.0.0</Version>`
        + `<Provider><M-EXAMPLE /></Provider><Consumer><M-EXAMPLE /></Consumer>`
        + `<BreakingChangePolicy>versioned</BreakingChangePolicy></IC-X>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );
    writeApprovedChange(
      root,
      "C-SYSTEMS",
      `<MustConform><Contract>IC-X</Contract><Module>M-EXAMPLE</Module><Command>exit 0</Command></MustConform>`,
      `<MustPassBudget><Command>${process.platform === "win32" ? "echo p99=42" : "printf 'p99=42\\n'"}</Command><Metric>p99</Metric><Operator>lt</Operator><Threshold>50</Threshold><Unit>ms</Unit></MustPassBudget>`,
    );

    const without = lintGraceProject(root, { assertionMode: "target", changeId: "C-SYSTEMS" });
    // MustPassBudget is command-gated; MustConform ref-only passes without execution.
    expect(without.issues.map((i) => i.code)).not.toContain("assertion.MustConform");
    // Target mode evaluates MustPassBudget → command-not-evaluated without --run-commands.
    expect(without.issues.map((i) => i.code)).toContain("assertion.command-not-evaluated");

    const withCmds = lintGraceProject(root, {
      assertionMode: "target",
      changeId: "C-SYSTEMS",
      runCommands: true,
    });
    expect(withCmds.issues.map((i) => i.code)).not.toContain("assertion.MustConform");
    expect(withCmds.issues.map((i) => i.code)).not.toContain("assertion.MustPassBudget");
    expect(withCmds.issues.map((i) => i.code)).not.toContain("assertion.budget-no-match");
    expect(withCmds.issues.map((i) => i.code)).not.toContain("assertion.command-not-evaluated");
  });

  it("Phase 7: current lint skips unevaluated MustPassBudget on active baselines (pins lint/core.ts)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    // Put MustPassBudget in BaselineAssertions of an active approved plan.
    writeApprovedChange(
      root,
      "C-BUDGET-BASELINE",
      `<MustPassBudget><Command>exit 99</Command><Metric>p99</Metric><Operator>lt</Operator><Threshold>50</Threshold><Unit>ms</Unit></MustPassBudget>`,
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
    );

    const current = lintGraceProject(root);
    // Without the skipUnevaluatedCommands extension to MustPassBudget, current mode would
    // emit assertion.command-not-evaluated for every active plan that uses a budget gate.
    expect(current.issues.map((i) => i.code)).not.toContain("assertion.command-not-evaluated");
    expect(current.issues.map((i) => i.code)).not.toContain("assertion.budget-command-failed");
  });
});
