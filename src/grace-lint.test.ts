import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

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

function writeMinimalGrace4Project(root: string) {
  writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements graceVersion="4.0"><Summary>Required.</Summary></GraceRequirements>`);
  writeProjectFile(root, ".grace/context/technology.xml", `<GraceTechnology graceVersion="4.0"><Runtime>Bun</Runtime></GraceTechnology>`);
  writeProjectFile(root, ".grace/context/principles.xml", `<GracePrinciples graceVersion="4.0"><Principle>Safe.</Principle></GracePrinciples>`);
  writeProjectFile(root, ".grace/context/deployment.xml", `<GraceDeployment graceVersion="4.0"><Applicability>applicable</Applicability></GraceDeployment>`);
  writeProjectFile(root, ".grace/context/ux-guidelines.xml", `<GraceUXGuidelines graceVersion="4.0"><Applicability>applicable</Applicability></GraceUXGuidelines>`);
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/main.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary><Path>src/example.ts</Path></M-EXAMPLE></GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/main.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>example works</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-MAIN></GraceVerificationDocument>`,
  );
  mkdirSync(path.join(root, ".grace", "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ".grace", "changes", "archive"), { recursive: true });
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
  const bundle = `.grace/changes/active/${changeId}`;
  writeProjectFile(
    root,
    `${bundle}/spec.xml`,
    `<GraceChangeSpec graceVersion="4.0" status="approved"><${changeId}><Summary>Selected change.</Summary><Goals><Goal>Exercise assertions.</Goal></Goals><Constraints><Constraint>Preserve fixture validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>Assertions are evaluated.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></${changeId}></GraceChangeSpec>`,
  );
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<GraceChangePlan graceVersion="4.0" status="${status}"><${changeId}><IntentSummary>Evaluate selected assertions.</IntentSummary><BaselineAssertions>${baselineAssertions}</BaselineAssertions><TargetAssertions>${targetAssertions}</TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Verify assertions</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Assertions pass.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></${changeId}></GraceChangePlan>`,
  );
}

describe("lintGraceProject", () => {
  it("passes a valid GRACE 4 .grace project", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

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
    expect(result.issues[0]?.message).toContain("grace-migrate");
    expect(result.issues.map((issue) => issue.code)).toEqual(["project.grace3-detected"]);
  });

  it("fails with missing .grace guidance when no GRACE artifacts exist", () => {
    const result = lintGraceProject(createProject());

    expect(result.issues[0]?.code).toBe("project.missing-grace");
    expect(result.issues[0]?.message).toContain("No .grace directory");
  });

  it("returns JSON-compatible output shape with issue counts", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements><Summary>Missing version.</Summary></GraceRequirements>`);

    const result = lintGraceProject(root);

    expect(JSON.parse(JSON.stringify(result)).tool).toBe("grace-lint");
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.code)).toContain("artifact.missing-grace-version");
  });

  it("rejects wrong document roots, unindexed documents, and mismatched executable bundles", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceRequirements graceVersion="4.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></GraceRequirements>`);
    writeProjectFile(root, ".grace/graph/unindexed.xml", `<GraceGraphDocument graceVersion="4.0"><GD-EXTRA><M-EXTRA /></GD-EXTRA></GraceGraphDocument>`);
    writeProjectFile(root, ".grace/changes/active/C-FOLDER/spec.xml", `<GraceChangeSpec graceVersion="4.0" status="approved"><C-SPEC /></GraceChangeSpec>`);
    writeProjectFile(root, ".grace/changes/active/C-FOLDER/plan.xml", `<GraceChangePlan graceVersion="4.0" status="approved"><C-PLAN /></GraceChangePlan>`);

    const issueCodes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(issueCodes).toContain("artifact.unexpected-root-tag");
    expect(issueCodes).toContain("projection.graph.unindexed-document");
    expect(issueCodes).toContain("change.bundle-id-mismatch");
    expect(issueCodes).toContain("change.spec-plan-id-mismatch");
    expect(issueCodes).toContain("change.plan-missing-section");
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
    writeMinimalGrace4Project(root);
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
    writeMinimalGrace4Project(root);
    // Only create archived plan with BaselineAssertions
    writeProjectFile(
      root,
      ".grace/changes/archive/C-DONE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions></C-DONE></GraceChangePlan>`,
    );
    expect(lintGraceProject(root).issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);

    // Remove M-EXAMPLE from graph so the archived baseline would fail if evaluated
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns /></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN /></GraceGraphDocument>`,
    );

    const after = lintGraceProject(root);
    expect(after.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });
  it("emits assertion.MustExist for active plans with stale BaselineAssertions but not for archived plans", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    // Create an active plan with a MustExist reference to a module that does not exist
    writeProjectFile(
      root,
      ".grace/changes/active/C-REFACTOR/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-REFACTOR><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-REFACTOR></GraceChangePlan>`,
    );

    // Active plan should emit assertion.MustExist for nonexistent module
    const activeResult = lintGraceProject(root);
    expect(activeResult.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);

    // Now also add an archived plan with the same stale baseline
    writeProjectFile(
      root,
      ".grace/changes/archive/C-DONE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DONE></GraceChangePlan>`,
    );

    // Archived plan should NOT emit additional assertion.MustExist
    const bothResult = lintGraceProject(root);
    const assertionIssues = bothResult.issues.filter((issue) => issue.code === "assertion.MustExist");
    // Only the active plan's assertion should fire
    expect(assertionIssues).toHaveLength(1);
  });

  it("does not evaluate TargetAssertions for active approved plans in general lint", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-TARGET/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-TARGET><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-MISSING</Module></MustVerify></TargetAssertions></C-TARGET></GraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    // TargetAssertion MustVerify for M-MISSING should NOT fire
    expect(result.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
  });

  it("requires one approved identity-matched active change for selected assertion modes", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

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
    writeMinimalGrace4Project(root);
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
    writeMinimalGrace4Project(root);
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
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-PHASE-CONFLICT",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustPassCommand><Command>grace lint --path . --assertions current</Command></MustPassCommand>`,
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
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/archive/C-HISTORICAL/spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="applied"><C-HISTORICAL><Summary>Historical change.</Summary><Goals><Goal>Preserve history.</Goal></Goals><Constraints><Constraint>Do not rewrite archives.</Constraint></Constraints><NonGoals><NonGoal>New behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>History remains readable.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></C-HISTORICAL></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/archive/C-HISTORICAL/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-HISTORICAL><IntentSummary>Historical plan.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustPassCommand><Command>grace lint --path . --assertions current</Command></MustPassCommand></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Historical task</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></C-HISTORICAL></GraceChangePlan>`,
    );

    expect(lintGraceProject(root).issues.map((item) => item.code)).not.toContain("assertion.phase-incompatible-command");
  });

  it("reserves blocking overlap diagnostics for explicit parallel preflight", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
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
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-DRAFT/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="draft"><C-DRAFT><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DRAFT></GraceChangePlan>`,
    );
    // Draft active plan should NOT fire assertion.MustExist
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });

  it("fails active approved plans with failing BaselineAssertions", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-STALE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-STALE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-STALE></GraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);
  });

  it("parses approved plan status through XML regardless of attribute quote style", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-SINGLE-QUOTE",
      `<MustExist><Value>M-MISSING</Value></MustExist>`,
      `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`,
    );
    const planFile = path.join(root, ".grace/changes/active/C-SINGLE-QUOTE/plan.xml");
    writeFileSync(planFile, readFileSync(planFile, "utf8").replace('status="approved"', "status='approved'"));

    expect(lintGraceProject(root).issues.map((issue) => issue.code)).toContain("assertion.MustExist");
  });

  it("uses final assertion mode for full end-state validation without re-evaluating the selected baseline", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-CREATE",
      `<MustNotExist><Value>M-NEW</Value></MustNotExist>`,
      `<MustVerify><Module>M-NEW</Module></MustVerify>`,
    );
    expect(lintGraceProject(root).summary.errors).toBe(0);

    writeProjectFile(root, ".grace/graph/index.xml", `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-NEW /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`);
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary></M-EXAMPLE><M-NEW><Summary>New module.</Summary></M-NEW></GD-MAIN></GraceGraphDocument>`);
    writeProjectFile(root, ".grace/verification/index.xml", `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-NEW /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`);
    writeProjectFile(root, ".grace/verification/main.xml", `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Scenario>Example works.</Scenario></V-M-EXAMPLE><V-M-NEW><Scenario>New module works.</Scenario></V-M-NEW></VD-MAIN></GraceVerificationDocument>`);

    const current = lintGraceProject(root);
    expect(current.issues.map((issue) => issue.code)).toContain("assertion.MustNotExist");

    const final = lintGraceProject(root, { assertionMode: "final", changeId: "C-CREATE" });
    expect(final.summary.errors).toBe(0);
    expect(final.assertionMode).toBe("final");
  });

  it("keeps unrelated approved baselines active during selected final validation", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(root, "C-SELECTED-FINAL", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);
    writeApprovedChange(root, "C-UNRELATED-STALE", `<MustExist><Value>M-MISSING</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);

    const final = lintGraceProject(root, { assertionMode: "final", changeId: "C-SELECTED-FINAL" });
    expect(final.issues.map((issue) => issue.code)).toContain("assertion.MustExist");
  });

  it("accepts a bundle with design-context.xml", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-DESIGN/design-context.xml",
      `<GraceChangeDesignContext graceVersion="4.0"><Change>C-DESIGN</Change><Rationale>Test.</Rationale></GraceChangeDesignContext>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/active/C-DESIGN/spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-DESIGN><Summary>Change with design context.</Summary></C-DESIGN></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/active/C-DESIGN/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-DESIGN><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope></C-DESIGN></GraceChangePlan>`,
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
});
