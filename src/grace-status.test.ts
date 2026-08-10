import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "./artifact/paths";
import { collectProjectStatus, formatStatusText } from "./grace-status";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const LIVE_NAN_ORPHAN = path.join(
  REPO_ROOT,
  ARTIFACT_DIR,
  "changes/archive/C-TOKEN-INTEGRITY/run/NaN-T-001-opened.xml",
);
const LIVE_NAN_SHA1 = "c0cc8899c264381766a18918e2109b5e05693893";

function createProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-status-"));
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

function writeChange(root: string, changeId: string, options: { location?: "active" | "archive"; specStatus: string; planStatus: string; file?: string; baselineAssertion?: string }) {
  const location = options.location ?? "active";
  const bundle = `${ARTIFACT_DIR}/changes/${location}/${changeId}`;
  writeProjectFile(root, `${bundle}/spec.xml`, `<NgraceChangeSpec graceVersion="1.0" status="${options.specStatus}"><${changeId}><Summary>Change.</Summary><Goals><Goal>Apply the change.</Goal></Goals><Constraints><Constraint>Preserve project validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated work.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>The change is verified.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand><ExpectedEvidence>Passing tests.</ExpectedEvidence></VerificationIntent></${changeId}></NgraceChangeSpec>`);
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="${options.planStatus}"><${changeId}><IntentSummary>Apply the change.</IntentSummary><BaselineAssertions>${options.baselineAssertion ?? "<MustExist><Value>M-EXAMPLE</Value></MustExist>"}</BaselineAssertions><TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>${options.file ?? "src/example.ts"}</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Apply change</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>The change is complete.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></${changeId}></NgraceChangePlan>`,
  );
}

function writeSpecOnly(root: string, changeId: string, status: "draft" | "approved") {
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/changes/active/${changeId}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="${status}"><${changeId}><Summary>Spec only.</Summary><Goals><Goal>Plan later.</Goal></Goals><Constraints><Constraint>Preserve validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated work.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>The spec is tracked.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></${changeId}></NgraceChangeSpec>`,
  );
}

function runGit(root: string, args: string[]) {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8"));
  }
}

describe("ngrace status", () => {
  it("summarizes durable neo-grace health and next action", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);

    const summaryOnly = collectProjectStatus(root);
    const result = collectProjectStatus(root, { includeModules: true });

    expect(summaryOnly.summary.readyModules).toBe(1);
    expect(summaryOnly.summary.attentionModules).toBe(0);
    expect(summaryOnly.summary.blockedModules).toBe(0);
    expect(summaryOnly.modules).toBeUndefined();
    expect(result.projectKind).toBe("grace4");
    expect(result.summary.contextArtifacts).toBe(5);
    expect(result.summary.graphModules).toBe(1);
    expect(result.summary.verificationEntries).toBe(1);
    expect(result.summary.readyModules).toBe(1);
    expect(result.modules).toHaveLength(1);
    expect(result.nextAction).toContain("$ngrace-spec");
    expect(result.observedDrift.available).toBe(false);
  });

  it("lists active and archived change bundles with statuses in JSON shape", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-ACTIVE", { specStatus: "approved", planStatus: "approved" });
    writeChange(root, "C-ARCHIVED", { location: "archive", specStatus: "applied", planStatus: "applied" });

    const result = collectProjectStatus(root);

    expect(result.summary.activeChanges).toBe(1);
    expect(result.summary.archivedChanges).toBe(1);
    expect(result.changes.find((change) => change.changeId === "C-ACTIVE")?.planStatus).toBe("approved");
    expect(result.changes.find((change) => change.changeId === "C-ARCHIVED")?.specStatus).toBe("applied");
    expect(result.nextAction).toContain("ngrace-execute");
  });

  it("surfaces overlapping approved changes as derived state, not XML status", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-ONE", { specStatus: "approved", planStatus: "approved", file: "src/example.ts" });
    writeChange(root, "C-TWO", { specStatus: "approved", planStatus: "approved", file: "src/example.ts" });

    const result = collectProjectStatus(root);
    const text = formatStatusText(result);

    expect(result.derivedStates).toContain("scope-overlap");
    expect(result.changes.every((change) => change.specStatus === "approved" && change.planStatus === "approved")).toBe(true);
    expect(text).toContain("scope-overlap");
  });

  it("reports invalid active/archive statuses from lint diagnostics", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-BAD-ACTIVE", { specStatus: "applied", planStatus: "applied" });

    const result = collectProjectStatus(root);

    expect(result.changes.find((change) => change.changeId === "C-BAD-ACTIVE")?.derivedStates).toContain("invalid-active-status");
    expect(result.integrity.topIssues.some((issue) => issue.includes("change.invalid-active-status"))).toBe(true);
    expect(result.nextAction).toContain("ngrace lint");
  });

  it("recommends review or replan when the spec is approved but the plan is still draft", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-NEEDS-PLAN", { specStatus: "approved", planStatus: "draft" });

    const result = collectProjectStatus(root);

    expect(result.changes.find((change) => change.changeId === "C-NEEDS-PLAN")?.derivedStates).toContain("needs-plan-approval");
    expect(result.nextAction).toContain("NgraceChangePlan");
  });

  it("marks approved changes with failed baseline assertions as stale plans", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-STALE", {
      specStatus: "approved",
      planStatus: "approved",
      baselineAssertion: "<MustExist><Value>M-MISSING</Value></MustExist>",
    });

    const result = collectProjectStatus(root);
    expect(result.changes.find((change) => change.changeId === "C-STALE")?.derivedStates).toContain("stale-plan");
    expect(result.changes.find((change) => change.changeId === "C-STALE")?.derivedStates).not.toContain("ready-to-execute");
    expect(result.derivedStates).toContain("stale-plan");
    expect(result.nextAction).toContain("Supersede and replan");
  });

  it("never marks an integrity-invalid approved plan ready to execute", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-INVALID", { specStatus: "approved", planStatus: "approved" });
    const planFile = `${ARTIFACT_DIR}/changes/active/C-INVALID/plan.xml`;
    writeProjectFile(
      root,
      planFile,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-INVALID><IntentSummary>Invalid.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Invalid task</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Never ready.</Criterion></AcceptanceCriteria><Verification /></T-001></ImplementationPlan></C-INVALID></NgraceChangePlan>`,
    );

    const change = collectProjectStatus(root).changes.find((entry) => entry.changeId === "C-INVALID")!;
    expect(change.derivedStates).toContain("integrity-issues");
    expect(change.derivedStates).not.toContain("ready-to-execute");
  });

  it("never marks text-only assertion and scope contracts ready to execute", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-TEXT", { specStatus: "approved", planStatus: "approved" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-TEXT/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-TEXT><IntentSummary>Invalid text contracts.</IntentSummary><BaselineAssertions>assume state</BaselineAssertions><TargetAssertions>expect state</TargetAssertions><DurableScope>graph changes</DurableScope><ObservedWriteScope>source changes</ObservedWriteScope><ImplementationPlan><T-001><Title>Invalid task</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Never ready.</Criterion></AcceptanceCriteria><Verification><Command>true</Command></Verification></T-001></ImplementationPlan></C-TEXT></NgraceChangePlan>`,
    );

    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-TEXT")!;
    expect(result.integrity.errors).toBeGreaterThan(0);
    expect(change.derivedStates).toContain("integrity-issues");
    expect(change.derivedStates).not.toContain("ready-to-execute");
  });

  it("treats approved spec-only bundles as needing planning and draft spec-only bundles as normal drafts", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeSpecOnly(root, "C-APPROVED-SPEC", "approved");
    writeSpecOnly(root, "C-DRAFT-SPEC", "draft");

    const result = collectProjectStatus(root);
    const approved = result.changes.find((change) => change.changeId === "C-APPROVED-SPEC")!;
    const draft = result.changes.find((change) => change.changeId === "C-DRAFT-SPEC")!;
    expect(approved.derivedStates).toContain("needs-plan");
    expect(approved.derivedStates).not.toContain("integrity-issues");
    expect(draft.derivedStates).toContain("draft-spec");
    expect(draft.derivedStates).not.toContain("integrity-issues");
  });

  it("distinguishes observed writes explained by approved scopes from unexplained git drift", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-DRIFT", { specStatus: "approved", planStatus: "approved", file: "src/example.ts" });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    writeProjectFile(root, "src/example.ts", "// planned change\n");
    writeProjectFile(root, "unplanned.txt", "unexpected\n");

    const result = collectProjectStatus(root);
    expect(result.observedDrift.available).toBe(true);
    expect(result.observedDrift.explainedFiles).toContain("src/example.ts");
    expect(result.observedDrift.unexplainedFiles).toContain("unplanned.txt");
    expect(result.derivedStates).toContain("explained-observed-drift");
    expect(result.derivedStates).toContain("unexplained-observed-drift");
  });

  it("keeps both source and destination paths for git rename drift", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "src/old.ts", "old\n");
    writeChange(root, "C-RENAME", { specStatus: "approved", planStatus: "approved", file: "src/new.ts" });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    runGit(root, ["mv", "src/old.ts", "src/new.ts"]);

    const drift = collectProjectStatus(root).observedDrift;
    expect(drift.changedFiles).toContain("src/old.ts");
    expect(drift.changedFiles).toContain("src/new.ts");
    expect(drift.explainedFiles).toContain("src/new.ts");
    expect(drift.unexplainedFiles).toContain("src/old.ts");
  });

  it("attributes graph drift only to the exact declared document or owning anchor route", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/index.xml`, `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN><GD-OTHER><Path>graph/other.xml</Path><Owns><M-OTHER /></Owns></GD-OTHER></GraphDocuments></NgraceGraphIndex>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/other.xml`, `<NgraceGraphDocument graceVersion="1.0"><GD-OTHER><M-OTHER><Summary>Other.</Summary></M-OTHER></GD-OTHER></NgraceGraphDocument>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/verification/index.xml`, `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN><VD-OTHER><Path>verification/other.xml</Path><Owns><V-M-OTHER /></Owns></VD-OTHER></VerificationDocuments></NgraceVerificationIndex>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/verification/other.xml`, `<NgraceVerificationDocument graceVersion="1.0"><VD-OTHER><V-M-OTHER><Scenario>Other works.</Scenario></V-M-OTHER></VD-OTHER></NgraceVerificationDocument>`);
    writeChange(root, "C-ROUTED-DRIFT", { specStatus: "approved", planStatus: "approved" });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/main.xml`, `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Changed main.</Summary></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/other.xml`, `<NgraceGraphDocument graceVersion="1.0"><GD-OTHER><M-OTHER><Summary>Changed other.</Summary></M-OTHER></GD-OTHER></NgraceGraphDocument>`);

    const drift = collectProjectStatus(root).observedDrift;
    expect(drift.explainedFiles).toContain(".ngrace/graph/main.xml");
    expect(drift.unexplainedFiles).toContain(".ngrace/graph/other.xml");
  });

  it("attributes graph index drift to declared graph documents or anchors", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-INDEX-DRIFT", { specStatus: "approved", planStatus: "approved" });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    const indexFile = path.join(root, `${ARTIFACT_DIR}/graph/index.xml`);
    writeFileSync(indexFile, readFileSync(indexFile, "utf8").replace("<GraphDocuments>", "<GraphDocuments>\n"));

    const drift = collectProjectStatus(root).observedDrift;
    expect(drift.explainedFiles).toContain(".ngrace/graph/index.xml");
    expect(drift.unexplainedFiles).not.toContain(".ngrace/graph/index.xml");
  });

  it("Phase 7: attributes graph drift to IC-* anchors in DurableScope (pins grace-status route index)", () => {
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
        + `<BreakingChangePolicy>additive-only</BreakingChangePolicy></IC-X>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );
    // Scope the change ONLY to the IC-* (not M-EXAMPLE), so explanation must come from IC in the route index.
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-IC-DRIFT/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-IC-DRIFT><Summary>Contract change.</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints><NonGoals><NonGoal>n</NonGoal></NonGoals><AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria><AffectedAreas><IC-X /></AffectedAreas><VerificationIntent><ExpectedCommand>echo ok</ExpectedCommand></VerificationIntent></C-IC-DRIFT></NgraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-IC-DRIFT/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-IC-DRIFT>`
        + `<IntentSummary>Contract only.</IntentSummary>`
        + `<BaselineAssertions><MustExist><Value>IC-X</Value></MustExist></BaselineAssertions>`
        + `<TargetAssertions><MustExist><Value>IC-X</Value></MustExist></TargetAssertions>`
        + `<DurableScope><GraphAnchors><IC-X /></GraphAnchors></DurableScope>`
        + `<ObservedWriteScope><File>proto/x.proto</File></ObservedWriteScope>`
        + `<ImplementationPlan><T-001><Title>t</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria><Verification><Command>echo ok</Command></Verification></T-001></ImplementationPlan>`
        + `</C-IC-DRIFT></NgraceChangePlan>`,
    );
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>`
        + `<M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE>`
        + `<IC-X><Summary>Contract updated.</Summary><Schema>proto/x.proto</Schema><Version>1.1.0</Version>`
        + `<Provider><M-EXAMPLE /></Provider><Consumer><M-EXAMPLE /></Consumer>`
        + `<BreakingChangePolicy>additive-only</BreakingChangePolicy></IC-X>`
        + `</GD-MAIN></NgraceGraphDocument>`,
    );

    const drift = collectProjectStatus(root).observedDrift;
    expect(drift.explainedFiles).toContain(".ngrace/graph/main.xml");
    expect(drift.unexplainedFiles).not.toContain(".ngrace/graph/main.xml");
  });

  it("hard-stops approved contract drift instead of reporting the bundle ready", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-IMMUTABLE", { specStatus: "approved", planStatus: "approved" });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    const planFile = path.join(root, `${ARTIFACT_DIR}/changes/active/C-IMMUTABLE/plan.xml`);
    writeFileSync(planFile, readFileSync(planFile, "utf8").replace("Apply the change.", "Apply the edited change."));

    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-IMMUTABLE")!;
    expect(result.observedDrift.unexplainedFiles).toContain(".ngrace/changes/active/C-IMMUTABLE/plan.xml");
    expect(change.derivedStates).toContain("approved-contract-drift");
    expect(change.derivedStates).not.toContain("ready-to-execute");
    expect(result.nextAction).toContain("Hard stop");
  });

  it("does not confuse a newly created untracked approved bundle with post-approval contract drift", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "disabled-hooks"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    writeChange(root, "C-NEW", { specStatus: "approved", planStatus: "approved" });

    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-NEW")!;
    expect(result.observedDrift.explainedFiles).toContain(".ngrace/changes/active/C-NEW/plan.xml");
    expect(change.derivedStates).toContain("ready-to-execute");
    expect(change.derivedStates).not.toContain("approved-contract-drift");
  });

  it("reports invalid projections through integrity without crashing or producing healthy module counts", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/graph/main.xml`, `<NgraceRequirements graceVersion="1.0"><GD-MAIN /></NgraceRequirements>`);

    const result = collectProjectStatus(root, { includeModules: true });
    expect(result.integrity.errors).toBeGreaterThan(0);
    expect(result.integrity.topIssues.some((entry) => entry.includes("artifact.unexpected-root-tag"))).toBe(true);
    expect(result.summary.readyModules).toBe(0);
    expect(result.moduleHealthLoadError).toContain("neo-grace artifacts are invalid");
  });

  it("reports GRACE 3 projects as migration candidates without loading docs as healthy", () => {
    const root = createProject();
    writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan />`);

    const result = collectProjectStatus(root);

    expect(result.projectKind).toBe("grace3");
    expect(result.derivedStates).toContain("migration-candidate");
    expect(result.summary.graphModules).toBe(0);
    expect(result.nextAction).toContain("ngrace-migrate");
  });

  it("wires the status command through the CLI", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    const repoRoot = path.resolve(import.meta.dir, "..");

    const statusResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "status", "--path", root, "--json", "--fail-on", "never"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(statusResult.exitCode).toBe(0);
    const parsed = JSON.parse(Buffer.from(statusResult.stdout).toString("utf8"));
    expect(parsed.tool).toBe("grace-status");
    expect(parsed.summary.graphModules).toBe(1);
  });

  it("returns structured JSON for invalid options and missing paths without stack traces", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    const invalid = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "status", "--json", "--fail-on", "unsupported"],
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

    const missingRoot = path.join(os.tmpdir(), `grace-status-missing-${crypto.randomUUID()}`);
    const missing = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "status", "--path", missingRoot, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(missing.exitCode).toBe(0);
    expect(Buffer.from(missing.stderr).toString("utf8")).toBe("");
    expect(JSON.parse(Buffer.from(missing.stdout).toString("utf8")).projectKind).toBe("none");
  });

  it("AC-STATUS-SURFACE: prints epoch and task counts; nextAction ignores cursor", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-EPOCH", { specStatus: "approved", planStatus: "approved" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-EPOCH/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-EPOCH><Epoch-1><Allocation worker="w" from="1" to="10"/><Event id="1" task="T-001" kind="opened"/><Event id="2" task="T-001" kind="terminal"/></Epoch-1></C-EPOCH></NgraceRunLedger>`,
    );
    // Cursor claims a contradictory pause — nextAction must stay plan-derived
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-EPOCH/run.xml`,
      `<NgraceRunCursor graceVersion="1.0"><C-EPOCH><Task>T-001</Task><Epoch>99</Epoch><State>paused</State></C-EPOCH></NgraceRunCursor>`,
    );
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-EPOCH");
    expect(change?.epochCount).toBe(1);
    expect(change?.openEpochCount).toBe(0);
    expect(change?.taskCount).toBe(1);
    const text = formatStatusText(result);
    expect(text).toContain("epochs=1");
    expect(text).not.toMatch(/C-EPOCH[^\n]*open=/);
    expect(text).toContain("tasks=1");
    expect(result.nextAction).toContain("ngrace-execute");
  });

  it("AC-STATUS-SURFACE: prints normally when no cursor exists", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-NOCUR", { specStatus: "approved", planStatus: "approved" });
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-NOCUR");
    expect(change?.epochCount).toBeUndefined();
    expect(change?.openEpochCount).toBeUndefined();
    expect(change?.taskCount).toBe(1);
    expect(formatStatusText(result)).toContain("C-NOCUR");
  });

  it("AC-STATUS-EPOCHS-OPEN-VS-FOLDED: healthy open epoch is not reported as epochs=0 / no activity (D8.8)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-OPEN", { specStatus: "approved", planStatus: "approved" });
    // Healthy open epoch: from=1 to=10 + progress, no folded Epoch-N.
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-OPEN/run/1-T-001-opened.xml`,
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="opened"><Allocation worker="w0" from="1" to="10"/></NgraceRunEvent>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-OPEN/run/2-T-001-progress.xml`,
      `<NgraceRunEvent graceVersion="1.0" id="2" task="T-001" kind="progress"/>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-OPEN/run.xml`,
      `<NgraceRunCursor graceVersion="1.0"><C-OPEN><Task>T-001</Task><Epoch>1</Epoch><State>in-progress</State></C-OPEN></NgraceRunCursor>`,
    );

    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-OPEN");
    // Discriminating negative: must not look like a change with no cursor activity.
    expect(change?.openEpochCount).toBe(1);
    expect(change?.epochCount).toBe(0);
    const text = formatStatusText(result);
    const line = text.split("\n").find((l) => l.includes("C-OPEN")) ?? "";
    expect(line).toMatch(/open=1/);
    expect(line).toMatch(/epochs=0/);
    // Not the pre-fix misreport that omitted open activity entirely.
    expect(line).not.toMatch(/C-OPEN \[active\] spec=approved plan=approved tasks=1/);
  });

  it("AC-STATUS-EPOCHS-OPEN-VS-FOLDED: after fold, folded count reflects Epoch-N wrappers", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-FOLD", { specStatus: "approved", planStatus: "approved" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-FOLD/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-FOLD><Epoch-1><Allocation worker="w0" from="1" to="10"/><Event id="1" task="T-001" kind="opened"/><Event id="2" task="T-001" kind="terminal"/></Epoch-1></C-FOLD></NgraceRunLedger>`,
    );
    // No loose run/ — fold emptied it.
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-FOLD");
    expect(change?.epochCount).toBe(1);
    expect(change?.openEpochCount).toBe(0);
    const line = formatStatusText(result).split("\n").find((l) => l.includes("C-FOLD")) ?? "";
    expect(line).toContain("epochs=1");
    expect(line).not.toMatch(/open=/);
  });

  it("correction 69: pre-gate archive without Decisions is apply-gate-record-absent, not violation", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    // Three older-style applied archives: no run-ledger / no Decisions section.
    writeChange(root, "C-OLD-A", { location: "archive", specStatus: "applied", planStatus: "applied" });
    writeChange(root, "C-OLD-B", { location: "archive", specStatus: "applied", planStatus: "applied" });
    writeChange(root, "C-OLD-C", { location: "archive", specStatus: "applied", planStatus: "applied" });
    const result = collectProjectStatus(root);
    for (const id of ["C-OLD-A", "C-OLD-B", "C-OLD-C"]) {
      const change = result.changes.find((entry) => entry.changeId === id);
      expect(change?.derivedStates).toContain("apply-gate-record-absent");
      expect(change?.derivedStates).not.toContain("applied-without-gate-record");
      expect(change?.applyGateRecord?.status).toBe("absent");
      expect(change?.applyGateRecord?.detail).toMatch(/predate/i);
    }
    expect(result.derivedStates).toContain("apply-gate-record-absent");
    expect(result.derivedStates).not.toContain("applied-without-gate-record");
  });

  it("correction 69: Decisions section without apply permit is applied-without-gate-record", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-SKIP", { location: "archive", specStatus: "applied", planStatus: "applied" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-SKIP/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-SKIP>`
        + `<Decisions><Decision gate="approve" decision="permit" /></Decisions>`
        + `</C-SKIP></NgraceRunLedger>`,
    );
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-SKIP");
    expect(change?.derivedStates).toContain("applied-without-gate-record");
    expect(change?.derivedStates).not.toContain("apply-gate-record-absent");
    expect(change?.applyGateRecord?.status).toBe("no-permit");
  });

  it("correction 69: invalid Decisions section is gate-record-invalid, not conflated with absent", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-BAD", { location: "archive", specStatus: "applied", planStatus: "applied" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-BAD/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-BAD>`
        + `<Decisions><Decision gate="apply" decision="permit" /></Decisions>`
        + `<Decisions><Decision gate="apply" decision="refuse" /></Decisions>`
        + `</C-BAD></NgraceRunLedger>`,
    );
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-BAD");
    expect(change?.derivedStates.some((s) => s.startsWith("gate-record-invalid:"))).toBe(true);
    expect(change?.derivedStates).not.toContain("apply-gate-record-absent");
    expect(change?.applyGateRecord?.status).toBe("invalid");
    expect(change?.applyGateRecord?.code).toBe("ledger.invalid-decision");
  });

  it("correction 69: clean gated archive has states=none for gate-record findings", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-GATED", { location: "archive", specStatus: "applied", planStatus: "applied" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-GATED/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-GATED>`
        + `<Verdicts><Verdict outcome="pass" /></Verdicts>`
        + `<Decisions><Decision gate="apply" decision="permit" /></Decisions>`
        + `</C-GATED></NgraceRunLedger>`,
    );
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-GATED");
    expect(change?.derivedStates).not.toContain("applied-without-gate-record");
    expect(change?.derivedStates).not.toContain("apply-gate-record-absent");
    expect(change?.derivedStates.every((s) => !s.startsWith("gate-record-invalid:"))).toBe(true);
    expect(change?.applyGateRecord?.status).toBe("permit");
    const text = formatStatusText(result);
    expect(text).toMatch(/C-GATED \[archive\].*states=none/);
  });

  it("renders analysis coverage for polyglot and omits Unverified for TS-only projects", async () => {
    const { polyglotFixture, minimalTsFixture } = await import("./test-support/fixtures");

    const polyglot = collectProjectStatus(polyglotFixture());
    const polyglotText = formatStatusText(polyglot);
    expect(polyglotText).toContain("Analysis Coverage");
    // Phase 3: .go and .rs are both adapter-backed — no Unverified line.
    expect(polyglotText).not.toContain("Unverified");
    expect(polyglot.analysisCoverage?.unverified).toEqual([]);
    expect(polyglot.analysisCoverage?.adapterBacked.some((entry) => entry.extension === ".go")).toBe(true);
    expect(polyglot.analysisCoverage?.adapterBacked.some((entry) => entry.extension === ".rs")).toBe(true);

    const tsOnly = collectProjectStatus(minimalTsFixture());
    const tsText = formatStatusText(tsOnly);
    expect(tsText).toContain("Analysis Coverage");
    expect(tsText).not.toContain("Unverified");
    expect(tsOnly.analysisCoverage?.unverified).toEqual([]);
  });
});

/**
 * C-REPORT-HONESTY T-002: status consumes shared run membership (F15 / D4 / D5).
 * Construction proof, not "status and gate happen to agree on fixtures alone".
 */
describe("C-REPORT-HONESTY T-002 status membership", () => {
  it("AC-TOKEN-ORPHAN-TRIPLE (1): live NaN orphan SHA-1 is preserved evidence (read-only)", () => {
    const body = readFileSync(LIVE_NAN_ORPHAN);
    const sha1 = createHash("sha1").update(body).digest("hex");
    expect(sha1).toBe(LIVE_NAN_SHA1);
  });

  it("AC-TOKEN-ORPHAN-TRIPLE (3) / AC-STATUS-OPEN-FOLDS-WITH-GATE: orphan-only run/ → open=0 + orphans=N", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-TOKEN-ORPHAN", {
      location: "archive",
      specStatus: "applied",
      planStatus: "applied",
    });
    // Folded epoch in ledger (mirrors C-TOKEN-INTEGRITY shape).
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-TOKEN-ORPHAN/run-ledger.xml`,
      `<NgraceRunLedger graceVersion="1.0"><C-TOKEN-ORPHAN><Epoch-1><Allocation worker="w0" from="1" to="5"/><Event id="1" task="T-001" kind="opened"/><Event id="2" task="T-001" kind="terminal"/></Epoch-1></C-TOKEN-ORPHAN></NgraceRunLedger>`,
    );
    // Orphan only — not foldable (EVENT_FILENAME miss). Content matches live SHA subject.
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-TOKEN-ORPHAN/run/NaN-T-001-opened.xml`,
      readFileSync(LIVE_NAN_ORPHAN, "utf8"),
    );

    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-TOKEN-ORPHAN");
    expect(change?.openEpochCount ?? 0).toBe(0);
    expect(change?.orphanCount).toBe(1);
    const line = formatStatusText(result).split("\n").find((l) => l.includes("C-TOKEN-ORPHAN")) ?? "";
    expect(line).toMatch(/orphans=1/);
    expect(line).not.toMatch(/open=[1-9]/);
    // open= omitted or open=0 is fine; open=1 is the F15 defect.
    expect(line).not.toMatch(/open=1/);
  });

  it("no-ledger orphan-only run/ still surfaces orphans=1 (not open=1)", () => {
    // Covers the hasLedger===false branch of epochCount derivation: orphan is not foldable,
    // so openEpochCount=0 and epochCount stays undefined — orphan signal must still print.
    // Shape mirrors pre-fold C-TOKEN-INTEGRITY (NaN orphan, no ledger yet).
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-NOLEDGER", { specStatus: "approved", planStatus: "approved" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-NOLEDGER/run/NaN-T-001-opened.xml`,
      readFileSync(LIVE_NAN_ORPHAN, "utf8"),
    );
    // Explicit: no run-ledger.xml (do not write one).

    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-NOLEDGER");
    expect(change?.openEpochCount ?? 0).toBe(0);
    expect(change?.orphanCount).toBe(1);
    const line = formatStatusText(result).split("\n").find((l) => l.includes("C-NOLEDGER")) ?? "";
    expect(line).toMatch(/orphans=1/);
    expect(line).not.toMatch(/open=1/);
  });

  it("AC-STATUS-OPEN-FOLDS-WITH-GATE: real foldable loose event → open≥1", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChange(root, "C-LOOSE", { specStatus: "approved", planStatus: "approved" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-LOOSE/run/1-T-001-opened.xml`,
      `<NgraceRunEvent graceVersion="1.0" id="1" task="T-001" kind="opened"><Allocation worker="w0" from="1" to="10"/></NgraceRunEvent>`,
    );
    const result = collectProjectStatus(root);
    const change = result.changes.find((entry) => entry.changeId === "C-LOOSE");
    expect(change?.openEpochCount).toBeGreaterThanOrEqual(1);
    const line = formatStatusText(result).split("\n").find((l) => l.includes("C-LOOSE")) ?? "";
    expect(line).toMatch(/open=[1-9]/);
  });

  it("AC-MEMBERSHIP-ONE-DEFINITION: grace-status has no endsWith(.xml) open-epoch filter and no grace-cursor import", () => {
    const statusSrc = readFileSync(path.join(REPO_ROOT, "src/grace-status.ts"), "utf8");
    // Deleted predicate shape (T-002): readdirSync(...).filter(name => name.endsWith(".xml")).
    expect(statusSrc).not.toMatch(
      /readdirSync\s*\([^)]*\)\s*\.filter\s*\(\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*[a-zA-Z_$][\w$]*\.endsWith\s*\(\s*["']\.xml["']\s*\)/,
    );
    expect(statusSrc).not.toMatch(/from\s+["']\.\/grace-cursor["']/);
    expect(statusSrc).not.toMatch(/from\s+["']\.\.\/grace-cursor["']/);
    // Consumers call the shared module (construction, not output agreement alone).
    expect(statusSrc).toMatch(/from\s+["']\.\/artifact\/run-membership["']/);
    expect(statusSrc).toMatch(/listLooseEvents/);
    expect(statusSrc).toMatch(/listRunOrphans/);
  });
});
