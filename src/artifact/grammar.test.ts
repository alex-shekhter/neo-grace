import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  validateArtifactRoot,
  validateChangeArtifact,
  validateChangeDesignContextArtifact,
  validateContextArtifacts,
  validateNgraceProject,
  validateRunCursorArtifact,
  validateRunLedgerArtifact,
  validateSemanticAnchorDiscipline,
} from "./grammar";
import { ARTIFACT_DIR } from "./paths";
import { resolveNgracePaths } from "./project";
import { writeChangeBundleFixture, writeLegacyGrace3Project, writeMinimalNgraceProject, writeSegmentedNgraceProject } from "./test-fixtures";
import { parseGraceXmlArtifact } from "./xml";
import {
  buildRunCursorXml,
  buildRunLedgerXml,
  writeLedgerFixtures,
} from "../test-support/fixtures";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-grammar-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function codes(result: { issues: { code: string }[] }) {
  return result.issues.map((issue) => issue.code);
}

function validSpec(changeId = "C-EXAMPLE", overrides = ""): string {
  return `<NgraceChangeSpec graceVersion="1.0" status="approved"><${changeId}><Summary>Summary.</Summary><Goals><Goal>Goal.</Goal></Goals><Constraints><Constraint>Constraint.</Constraint></Constraints><NonGoals><NonGoal>Non-goal.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent>${overrides}</${changeId}></NgraceChangeSpec>`;
}

function validPlan(tasks: string, overrides = "", changeId = "C-EXAMPLE"): string {
  return `<NgraceChangePlan graceVersion="1.0" status="approved"><${changeId}><IntentSummary>Intent.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>${overrides}<ImplementationPlan>${tasks}</ImplementationPlan></${changeId}></NgraceChangePlan>`;
}

function task(id: string, dependencies = ""): string {
  return `<${id}><Title>${id} title</Title><DependsOn>${dependencies}</DependsOn><AcceptanceCriteria><Criterion>${id} accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></${id}>`;
}

describe("neo-grace Artifact Grammar", () => {
  it("fixture builders create required neo-grace and legacy project shapes", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-FIXTURE", location: "active", specStatus: "approved", planStatus: "approved" });

    for (const relativePath of [
      `${ARTIFACT_DIR}/context/requirements.xml`,
      `${ARTIFACT_DIR}/context/technology.xml`,
      `${ARTIFACT_DIR}/context/principles.xml`,
      `${ARTIFACT_DIR}/context/deployment.xml`,
      `${ARTIFACT_DIR}/context/ux-guidelines.xml`,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `${ARTIFACT_DIR}/changes/active/C-FIXTURE/spec.xml`,
      `${ARTIFACT_DIR}/changes/active/C-FIXTURE/plan.xml`,
    ]) {
      expect(existsSync(path.join(root, relativePath))).toBe(true);
    }
    expect(validateNgraceProject(root).issues).toHaveLength(0);

    const segmentedRoot = createProject();
    writeSegmentedNgraceProject(segmentedRoot);
    expect(validateNgraceProject(segmentedRoot).issues).toHaveLength(0);
    expect(existsSync(path.join(segmentedRoot, ".ngrace/graph/core.xml"))).toBe(true);
    expect(existsSync(path.join(segmentedRoot, ".ngrace/verification/second.xml"))).toBe(true);

    const legacyRoot = createProject();
    writeLegacyGrace3Project(legacyRoot);
    expect(codes(validateNgraceProject(legacyRoot))).toContain("project.grace3-detected");
  });

  it("validates a minimal current .ngrace project", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);

    const result = validateNgraceProject(root);

    expect(result.issues).toHaveLength(0);
    expect(result.artifacts.map((artifact) => artifact.rootTag).sort()).toEqual([
      "NgraceDeployment",
      "NgraceGraphDocument",
      "NgraceGraphIndex",
      "NgracePrinciples",
      "NgraceRequirements",
      "NgraceTechnology",
      "NgraceUXGuidelines",
      "NgraceVerificationDocument",
      "NgraceVerificationIndex",
    ]);
  });

  it("rejects graph and verification documents with the wrong artifact root", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceRequirements graceVersion="1.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></NgraceRequirements>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgracePrinciples graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE /></VD-MAIN></NgracePrinciples>`,
    );

    const resultCodes = codes(validateNgraceProject(root));
    expect(resultCodes.filter((code) => code === "artifact.unexpected-root-tag")).toHaveLength(2);
  });

  it("rejects mismatched bundle ids and approved plans without the required executable contract", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-FOLDER/spec.xml`,
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-SPEC /></NgraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-FOLDER/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-PLAN /></NgraceChangePlan>`,
    );

    const resultCodes = codes(validateNgraceProject(root));
    expect(resultCodes).toContain("change.bundle-id-mismatch");
    expect(resultCodes).toContain("change.spec-plan-id-mismatch");
    expect(resultCodes).toContain("change.spec-missing-section");
    expect(resultCodes).toContain("change.plan-missing-section");
  });

  it("rejects active plans created beside non-approved specs", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-DRAFT", location: "active", specStatus: "draft", planStatus: "draft" });

    expect(codes(validateNgraceProject(root))).toContain("change.plan-requires-approved-spec");
  });

  it("reports missing graceVersion, unsupported versions, invalid roots, and malformed XML", () => {
    const missing = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<NgraceRequirements />`));
    const unsupported = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<NgraceRequirements graceVersion="3.11" />`));
    const invalidRoot = validateArtifactRoot(parseGraceXmlArtifact("unknown.xml", `<NotGrace graceVersion="1.0" />`));
    const malformed = validateArtifactRoot(parseGraceXmlArtifact("broken.xml", `<NgraceRequirements graceVersion="1.0"><Open></NgraceRequirements>`));

    expect(codes(missing)).toContain("artifact.missing-grace-version");
    expect(codes(unsupported)).toContain("artifact.unsupported-grace-version");
    expect(codes(invalidRoot)).toContain("artifact.invalid-root-tag");
    expect(codes(malformed)).toContain("xml.parse");
  });

  it("allows status only on change artifact roots", () => {
    const context = validateArtifactRoot(
      parseGraceXmlArtifact("requirements.xml", `<NgraceRequirements graceVersion="1.0" status="approved" />`),
    );
    const change = validateArtifactRoot(
      parseGraceXmlArtifact("spec.xml", validSpec()),
    );

    expect(codes(context)).toContain("artifact.forbidden-status-attribute");
    expect(change.issues).toHaveLength(0);
  });

  it("rejects semantic anchors used as attribute values", () => {
    const artifact = parseGraceXmlArtifact(
      "graph.xml",
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><Module ref="M-EXAMPLE" /></GD-MAIN></NgraceGraphDocument>`,
    );

    expect(codes({ issues: validateSemanticAnchorDiscipline("graph.xml", artifact.root!) })).toContain(
      "artifact.semantic-anchor-attribute",
    );
  });

  it("rejects malformed semantic-anchor tags across every anchor family", () => {
    const artifact = parseGraceXmlArtifact(
      "anchors.xml",
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-bad /><GD-bad /><VD-bad /><C-bad /><V-M-bad /><DF-bad /><IC-bad /><INV-bad /><T-bad /><AC-bad /><DT-bad /><BP-bad /><ST-bad /><Stack-bad /></GD-MAIN></NgraceGraphDocument>`,
    );

    const resultCodes = codes({ issues: validateSemanticAnchorDiscipline("anchors.xml", artifact.root!) });
    expect(resultCodes.filter((code) => code === "artifact.malformed-semantic-anchor")).toHaveLength(14);
  });

  it("rejects attributes on canonical anchors and anchor-like attribute names or values", () => {
    const artifact = parseGraceXmlArtifact(
      "anchors.xml",
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN role="owner"><Node M-bad="yes" ref="VD-bad" /></GD-MAIN></NgraceGraphDocument>`,
    );

    const resultCodes = codes({ issues: validateSemanticAnchorDiscipline("anchors.xml", artifact.root!) });
    expect(resultCodes).toContain("artifact.semantic-anchor-has-attributes");
    expect(resultCodes.filter((code) => code === "artifact.semantic-anchor-attribute")).toHaveLength(2);
  });

  it("requires canonical active and archive change directories", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    rmSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
    rmSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });

    expect(codes(validateNgraceProject(root)).filter((code) => code === "project.missing-change-directory")).toHaveLength(2);
  });

  it("rejects missing, duplicate, and empty required change sections", () => {
    const missingConstraints = validateChangeArtifact(
      parseGraceXmlArtifact("spec.xml", validSpec().replace(/<Constraints>.*?<\/Constraints>/, "")),
      "active",
    );
    expect(codes(missingConstraints)).toContain("change.spec-missing-section");

    const duplicateSummary = validateChangeArtifact(
      parseGraceXmlArtifact("spec.xml", validSpec("C-EXAMPLE", "<Summary>Duplicate.</Summary>")),
      "active",
    );
    expect(codes(duplicateSummary)).toContain("change.spec-duplicate-section");

    const emptyConstraints = validateChangeArtifact(
      parseGraceXmlArtifact("spec.xml", validSpec().replace("<Constraints><Constraint>Constraint.</Constraint></Constraints>", "<Constraints />")),
      "active",
    );
    expect(codes(emptyConstraints)).toContain("change.empty-section");
  });

  it("requires meaningful approved-plan assertions, scopes, acceptance, and verification", () => {
    const emptyPlan = validateChangeArtifact(
      parseGraceXmlArtifact(
        "plan.xml",
        validPlan(task("T-001"))
          .replace("<BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions>", "<BaselineAssertions />")
          .replace("<TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>", "<TargetAssertions />")
          .replace("<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>", "<DurableScope />")
          .replace("<ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>", "<ObservedWriteScope />")
          .replace("<AcceptanceCriteria><Criterion>T-001 accepted.</Criterion></AcceptanceCriteria>", "<AcceptanceCriteria />")
          .replace("<Verification><Command>bun test</Command></Verification>", "<Verification />"),
      ),
      "active",
    );
    const resultCodes = codes(emptyPlan);
    expect(resultCodes.filter((code) => code === "change.empty-section")).toHaveLength(4);
    expect(resultCodes).toContain("change.task-empty-acceptance");
    expect(resultCodes).toContain("change.task-empty-verification");
  });

  it("rejects text-only assertion and scope sections that are not machine-checkable", () => {
    const plan = validPlan(task("T-001"))
      .replace("<BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions>", "<BaselineAssertions>assume current state</BaselineAssertions>")
      .replace("<TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>", "<TargetAssertions>expect target state</TargetAssertions>")
      .replace("<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>", "<DurableScope>change the graph</DurableScope>")
      .replace("<ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>", "<ObservedWriteScope>write source files</ObservedWriteScope>");

    const resultCodes = codes(validateChangeArtifact(parseGraceXmlArtifact("plan.xml", plan), "active"));
    expect(resultCodes.filter((code) => code === "change.plan-invalid-section-shape").length).toBeGreaterThanOrEqual(4);
  });

  it("rejects duplicate tasks, invalid dependencies, self-dependencies, unknown dependencies, and cycles", () => {
    const plan = validPlan([
      task("T-001", "<Task>T-002</Task>"),
      task("T-002", "<Task>T-001</Task>"),
      task("T-002"),
      task("T-003", "<Task>T-003</Task><Task>T-999</Task><Task>bad</Task>"),
    ].join(""));
    const resultCodes = codes(validateChangeArtifact(parseGraceXmlArtifact("plan.xml", plan), "active"));

    expect(resultCodes).toContain("change.duplicate-task-id");
    expect(resultCodes).toContain("change.task-self-dependency");
    expect(resultCodes).toContain("change.task-unknown-dependency");
    expect(resultCodes).toContain("change.task-invalid-dependency");
    expect(resultCodes).toContain("change.task-dependency-cycle");
  });

  it("accepts a unique acyclic task dependency graph", () => {
    const plan = validPlan(task("T-001") + task("T-002", "<Task>T-001</Task>"));
    expect(validateChangeArtifact(parseGraceXmlArtifact("plan.xml", plan), "active").issues).toHaveLength(0);
  });

  it("rejects invalid active and archive change statuses", () => {
    const active = validateChangeArtifact(
      parseGraceXmlArtifact("active/plan.xml", `<NgraceChangePlan graceVersion="1.0" status="applied"><C-EXAMPLE /></NgraceChangePlan>`),
      "active",
    );
    const archive = validateChangeArtifact(
      parseGraceXmlArtifact("archive/spec.xml", `<NgraceChangeSpec graceVersion="1.0" status="draft"><C-EXAMPLE /></NgraceChangeSpec>`),
      "archive",
    );

    expect(codes(active)).toContain("change.invalid-active-status");
    expect(codes(archive)).toContain("change.invalid-archive-status");
  });

  it("requires not-applicable deployment and UX context artifacts to include a reason", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/deployment.xml`,
      `<NgraceDeployment graceVersion="1.0"><Applicability>not-applicable</Applicability></NgraceDeployment>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/ux-guidelines.xml`,
      `<NgraceUXGuidelines graceVersion="1.0"><Applicability>not-applicable</Applicability></NgraceUXGuidelines>`,
    );

    const results = validateContextArtifacts(resolveNgracePaths(root));
    const allCodes = results.flatMap(codes);

    expect(allCodes.filter((code) => code === "context.not-applicable-reason-missing")).toHaveLength(2);
  });

  it("rejects empty context artifacts and invalid optional applicability declarations", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements graceVersion="1.0" />`);
    writeProjectFile(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<NgraceDeployment graceVersion="1.0"><Summary>Deployment applies.</Summary></NgraceDeployment>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<NgraceUXGuidelines graceVersion="1.0"><Applicability>sometimes</Applicability></NgraceUXGuidelines>`);

    const resultCodes = validateContextArtifacts(resolveNgracePaths(root)).flatMap(codes);
    expect(resultCodes).toContain("context.empty-artifact");
    expect(resultCodes).toContain("context.applicability-missing");
    expect(resultCodes).toContain("context.applicability-invalid");
  });

  it("rejects lack of a web UI as the sole UX not-applicable reason", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/ux-guidelines.xml`,
      `<NgraceUXGuidelines graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>Not a web app</Reason></NgraceUXGuidelines>`,
    );

    const allCodes = validateContextArtifacts(resolveNgracePaths(root)).flatMap(codes);
    expect(allCodes).toContain("context.ux-not-applicable-reason-insufficient");
  });

  it("errors when superseded change does not reference a replacement C-*", () => {
    const noReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-SUPERSEDED><Summary>Old change.</Summary></C-SUPERSEDED></NgraceChangeSpec>`),
      "archive",
    );
    expect(codes(noReplacement)).toContain("change.superseded-missing-replacement");
    expect(noReplacement.issues.find(i => i.code === "change.superseded-missing-replacement")?.severity).toBe("error");

    const withChildTag = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-SUPERSEDED><C-REPLACEMENT /><Summary>Old change.</Summary></C-SUPERSEDED></NgraceChangeSpec>`),
      "archive",
    );
    expect(codes(withChildTag)).not.toContain("change.superseded-missing-replacement");

    const withReplacementTag = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-SUPERSEDED><Replacement>C-REPLACEMENT</Replacement><Summary>Old change.</Summary></C-SUPERSEDED></NgraceChangeSpec>`),
      "archive",
    );
    expect(codes(withReplacementTag)).not.toContain("change.superseded-missing-replacement");
  });

  it("rejects empty or arbitrary Replacement text and accepts ReplacementChange", () => {
    const emptyReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-SUPERSEDED><Replacement></Replacement><Summary>Old change.</Summary></C-SUPERSEDED></NgraceChangeSpec>`),
      "archive",
    );
    expect(codes(emptyReplacement)).toContain("change.superseded-missing-replacement");

    const arbitraryReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-SUPERSEDED><Replacement>not-a-change</Replacement><Summary>Old change.</Summary></C-SUPERSEDED></NgraceChangeSpec>`),
      "archive",
    );
    expect(codes(arbitraryReplacement)).toContain("change.superseded-missing-replacement");

    const replacementChange = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<NgraceChangeSpec graceVersion="1.0" status="superseded"><C-SUPERSEDED><ReplacementChange>C-REPLACEMENT</ReplacementChange><Summary>Old change.</Summary></C-SUPERSEDED></NgraceChangeSpec>`),
      "archive",
    );
    expect(codes(replacementChange)).not.toContain("change.superseded-missing-replacement");
  });

  it("rejects self-referential and missing superseded replacement bundles", () => {
    const selfReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        validSpec("C-SELF", "<Replacement>C-SELF</Replacement>").replace('status="approved"', 'status="superseded"'),
      ),
      "archive",
    );
    expect(codes(selfReplacement)).toContain("change.superseded-self-replacement");

    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/archive/C-OLD/spec.xml`,
      validSpec("C-OLD", "<Replacement>C-MISSING</Replacement>").replace('status="approved"', 'status="superseded"'),
    );
    expect(codes(validateNgraceProject(root))).toContain("change.superseded-replacement-not-found");
  });

  it("validates NgraceChangeDesignContext inside change bundles", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-DESIGN", location: "active", specStatus: "approved", planStatus: "approved", designContext: "<NgraceChangeDesignContext graceVersion=\"1.0\"><Change>C-DESIGN</Change><Rationale>Test.</Rationale></NgraceChangeDesignContext>" });
    expect(validateNgraceProject(root).issues).toHaveLength(0);
  });

  it("rejects invalid NgraceChangeDesignContext root, missing graceVersion, status attribute", () => {
    const valid = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext graceVersion="1.0"><Change>C-DESIGN</Change></NgraceChangeDesignContext>`),
    );
    expect(valid.issues).toHaveLength(0);

    const wrongRoot = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<DesignContext graceVersion="1.0" />`),
    );
    expect(codes(wrongRoot)).toContain("design-context.invalid-root-tag");

    const noVersion = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext />`),
    );
    expect(codes(noVersion)).toContain("design-context.missing-grace-version");

    const withStatus = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext graceVersion="1.0" status="approved" />`),
    );
    expect(codes(withStatus)).toContain("design-context.forbidden-status");
  });

  it("accepts NgraceChangeDesignContext with semantic anchor in child tag", () => {
    const result = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext graceVersion="1.0"><C-DESIGN><Rationale>Test.</Rationale></C-DESIGN></NgraceChangeDesignContext>`),
    );
    expect(result.issues).toHaveLength(0);
  });

  it("requires exactly one canonical design-context identity and matches it to the bundle", () => {
    const missing = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext graceVersion="1.0"><Rationale>Missing identity.</Rationale></NgraceChangeDesignContext>`),
    );
    expect(codes(missing)).toContain("design-context.missing-change-id");

    const invalid = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext graceVersion="1.0"><Change>not-a-change</Change></NgraceChangeDesignContext>`),
    );
    expect(codes(invalid)).toContain("design-context.invalid-change-id");

    const ambiguous = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<NgraceChangeDesignContext graceVersion="1.0"><Change>C-DESIGN</Change><C-DESIGN /></NgraceChangeDesignContext>`),
    );
    expect(codes(ambiguous)).toContain("design-context.ambiguous-change-id");

    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-DESIGN",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      designContext: `<NgraceChangeDesignContext graceVersion="1.0"><C-WRONG><Rationale>Wrong bundle.</Rationale></C-WRONG></NgraceChangeDesignContext>`,
    });
    expect(codes(validateNgraceProject(root))).toContain("design-context.bundle-id-mismatch");
  });
});

describe("run ledger and cursor grammar (Phase 3 / A11)", () => {
  const denseEpoch = {
    epoch: 1,
    wave: "1",
    allocations: [{ worker: "w0", from: 1, to: 99 }],
    events: [
      { id: 1, task: "T-001", kind: "opened" },
      { id: 2, task: "T-001", kind: "terminal" },
    ],
  };

  it("rejects unknown ledger root tag", () => {
    const result = validateRunLedgerArtifact(
      parseGraceXmlArtifact("run-ledger.xml", `<NotALedger graceVersion="1.0"><C-X/></NotALedger>`),
    );
    expect(codes(result)).toContain("ledger.invalid-root-tag");
  });

  it("rejects ledger identity absent or not one canonical C-*", () => {
    const missing = validateRunLedgerArtifact(
      parseGraceXmlArtifact("run-ledger.xml", `<NgraceRunLedger graceVersion="1.0"></NgraceRunLedger>`),
    );
    expect(codes(missing)).toContain("ledger.invalid-change-id");
    const bad = validateRunLedgerArtifact(
      parseGraceXmlArtifact("run-ledger.xml", `<NgraceRunLedger graceVersion="1.0"><Change>nope</Change></NgraceRunLedger>`),
    );
    expect(codes(bad)).toContain("ledger.invalid-change-id");
  });

  it("rejects ledger identity disagreeing with the bundle directory", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-LEDGER", location: "active", specStatus: "approved", planStatus: "approved" });
    writeLedgerFixtures(root, "C-LEDGER", {
      ledger: [{ ...denseEpoch }],
    });
    // Overwrite with wrong identity
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-LEDGER/run-ledger.xml`,
      buildRunLedgerXml("C-OTHER", [denseEpoch]),
    );
    expect(codes(validateNgraceProject(root))).toContain("ledger.bundle-id-mismatch");
  });

  it("rejects non-monotonic and reordered epochs", () => {
    const nonMono = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [
          { ...denseEpoch, epoch: 1 },
          { ...denseEpoch, epoch: 1, events: [{ id: 1, task: "T-001", kind: "opened" }, { id: 2, task: "T-001", kind: "terminal" }] },
        ]),
      ),
    );
    expect(codes(nonMono)).toContain("ledger.non-monotonic-epoch");

    const reordered = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [
          { ...denseEpoch, epoch: 2 },
          { ...denseEpoch, epoch: 1 },
        ]),
      ),
    );
    expect(codes(reordered)).toContain("ledger.reordered-epoch");
  });

  it("rejects event outside allocation, range hole, and unterminated range", () => {
    const outside = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 50, task: "T-001", kind: "terminal" },
          ],
        }]),
      ),
    );
    expect(codes(outside)).toContain("ledger.event-outside-allocation");

    const hole = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 3, task: "T-001", kind: "terminal" },
          ],
        }]),
      ),
    );
    expect(codes(hole)).toContain("ledger.range-hole");

    const unterminated = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 2, task: "T-001", kind: "progress" },
          ],
        }]),
      ),
    );
    expect(codes(unterminated)).toContain("ledger.range-unterminated");
  });

  it("accepts a dense terminated ledger", () => {
    const result = validateRunLedgerArtifact(
      parseGraceXmlArtifact("run-ledger.xml", buildRunLedgerXml("C-X", [denseEpoch])),
    );
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("Phase 4: complete=false skips hole/unterminated; unknown-kind warns; exhausted terminates; duplicate ordinal errors", () => {
    // complete=false: hole does not fire range-hole (A18.8 both-directions)
    const incompleteHole = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          complete: false,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 3, task: "T-001", kind: "progress" },
          ],
        }]),
      ),
    );
    expect(codes(incompleteHole)).not.toContain("ledger.range-hole");
    expect(codes(incompleteHole)).not.toContain("ledger.range-unterminated");

    // complete absent: hole still fires
    const completeHole = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 3, task: "T-001", kind: "terminal" },
          ],
        }]),
      ),
    );
    expect(codes(completeHole)).toContain("ledger.range-hole");

    // exhausted is range-terminating (A19.3)
    const exhausted = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 2, task: "T-001", kind: "exhausted" },
          ],
        }]),
      ),
    );
    expect(codes(exhausted)).not.toContain("ledger.range-unterminated");
    expect(exhausted.issues.filter((i) => i.severity === "error")).toHaveLength(0);

    // unknown kind warns
    const unknown = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            { id: 2, task: "T-001", kind: "atempt" },
            { id: 3, task: "T-001", kind: "terminal" },
          ],
        }]),
      ),
    );
    const warning = unknown.issues.find((i) => i.code === "ledger.unknown-event-kind");
    expect(warning?.severity).toBe("warning");

    // duplicate attempt ordinal (A19.2)
    const dup = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        buildRunLedgerXml("C-X", [{
          epoch: 1,
          allocations: [{ worker: "w0", from: 1, to: 10 }],
          events: [
            { id: 1, task: "T-001", kind: "opened" },
            {
              id: 2,
              task: "T-001",
              kind: "attempt",
              fields: { outcome: "fail", ordinal: "1", "signature-kind": "t", "signature-key": "a" },
            },
            {
              id: 3,
              task: "T-001",
              kind: "attempt",
              fields: { outcome: "fail", ordinal: "1", "signature-kind": "t", "signature-key": "b" },
            },
            { id: 4, task: "T-001", kind: "exhausted" },
          ],
        }]),
      ),
    );
    expect(codes(dup)).toContain("ledger.duplicate-attempt-ordinal");
  });

  it("rejects unknown cursor root and invalid change id", () => {
    expect(codes(validateRunCursorArtifact(parseGraceXmlArtifact("run.xml", `<Nope/>`)))).toContain(
      "cursor.invalid-root-tag",
    );
    expect(
      codes(validateRunCursorArtifact(parseGraceXmlArtifact("run.xml", `<NgraceRunCursor graceVersion="1.0"></NgraceRunCursor>`))),
    ).toContain("cursor.invalid-change-id");
  });

  it("cursor conditional: absent silent, unknown-task error, clean consistent (AC-CURSOR-CONDITIONAL)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-CUR", location: "active", specStatus: "approved", planStatus: "approved" });
    // absent — write this first (D1 / house fail-closed instinct)
    const absentCodes = codes(validateNgraceProject(root));
    expect(absentCodes.some((c) => c.startsWith("cursor."))).toBe(false);

    writeLedgerFixtures(root, "C-CUR", { cursor: { task: "T-999", state: "idle" } });
    expect(codes(validateNgraceProject(root))).toContain("cursor.unknown-task");

    writeLedgerFixtures(root, "C-CUR", { cursor: { task: "T-001", state: "idle" } });
    const clean = codes(validateNgraceProject(root)).filter((c) => c.startsWith("cursor."));
    expect(clean).toEqual([]);
  });

  it("cursor copied between bundles is caught by bundle-id-mismatch, not unknown-task (A11.4)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-A", location: "active", specStatus: "approved", planStatus: "approved" });
    writeChangeBundleFixture(root, { changeId: "C-B", location: "active", specStatus: "approved", planStatus: "approved" });
    // Copy cursor from C-A identity into C-B directory — task T-001 exists in both plans
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-B/run.xml`,
      buildRunCursorXml("C-A", { task: "T-001", state: "idle" }),
    );
    const issueList = validateNgraceProject(root).issues.filter((i) => i.file.includes("C-B"));
    const issueCodes = issueList.map((i) => i.code);
    expect(issueCodes).toContain("cursor.bundle-id-mismatch");
    expect(issueCodes).not.toContain("cursor.unknown-task");
  });

  it("admits run-ledger.xml, run.xml, and run/ without change.unexpected-file; near neighbours still error (AC-BUNDLE-FILE-ALLOWLIST)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-ALLOW", location: "active", specStatus: "approved", planStatus: "approved" });
    writeLedgerFixtures(root, "C-ALLOW", {
      ledger: [denseEpoch],
      cursor: { task: "T-001", epoch: 1, state: "idle" },
      runEvents: [{ id: 1, task: "T-001", kind: "garbage" }],
    });
    const admitted = codes(validateNgraceProject(root));
    expect(admitted.filter((c) => c === "change.unexpected-file")).toEqual([]);

    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-ALLOW/notes.xml`, `<Notes/>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-ALLOW/spec.old.xml`, `<NgraceChangeSpec graceVersion="1.0"/>`);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/stray.xml`, `<NgraceChangeSpec graceVersion="1.0"/>`);
    const after = validateNgraceProject(root).issues.filter((i) => i.code === "change.unexpected-file");
    const names = after.map((i) => path.basename(i.file)).sort();
    expect(names).toContain("notes.xml");
    expect(names).toContain("spec.old.xml");
    expect(names).toContain("stray.xml");
  });

  it("malformed file under run/ produces no lint issue (AC-RUN-DIR-UNWALKED)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, { changeId: "C-RUNDIR", location: "active", specStatus: "approved", planStatus: "approved" });
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-RUNDIR/run/not-even-xml.xml`,
      `{{{this is not xml`,
    );
    const issues = validateNgraceProject(root).issues.filter((i) => i.file.includes(`${path.sep}run${path.sep}`) || i.file.includes("/run/"));
    expect(issues).toHaveLength(0);
  });
});

describe("spec→plan coverage (G-05 / AC-*)", () => {
  function projectWithBundle(specXml: string, planXml: string | null, changeId = "C-EXAMPLE") {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/${changeId}/spec.xml`, specXml);
    if (planXml) {
      writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/${changeId}/plan.xml`, planXml);
    }
    return root;
  }

  function issueCodes(root: string) {
    return codes(validateNgraceProject(root));
  }

  it("accepts matching AffectedAreas and DurableScope GraphAnchors", () => {
    const root = projectWithBundle(validSpec(), validPlan(task("T-001")));
    expect(issueCodes(root)).not.toContain("change.scope-does-not-cover-spec");
    expect(issueCodes(root)).not.toContain("change.plan-scope-exceeds-spec");
  });

  it("errors when plan DurableScope omits a spec AffectedAreas module and warns on extras", () => {
    const spec = validSpec().replace("<AffectedAreas><M-EXAMPLE /></AffectedAreas>", "<AffectedAreas><M-A /></AffectedAreas>");
    const plan = validPlan(task("T-001")).replace(
      "<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>",
      "<DurableScope><GraphAnchors><M-B /></GraphAnchors></DurableScope>",
    );
    const resultCodes = issueCodes(projectWithBundle(spec, plan));
    expect(resultCodes).toContain("change.scope-does-not-cover-spec");
    expect(resultCodes).toContain("change.plan-scope-exceeds-spec");
    expect(validateNgraceProject(projectWithBundle(spec, plan)).issues.find((i) => i.code === "change.scope-does-not-cover-spec")?.severity).toBe("error");
    expect(validateNgraceProject(projectWithBundle(spec, plan)).issues.find((i) => i.code === "change.plan-scope-exceeds-spec")?.severity).toBe("warning");
  });

  it("treats V-M-X in DurableScope as covering M-X in the spec", () => {
    const plan = validPlan(task("T-001")).replace(
      "<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>",
      "<DurableScope><VerificationAnchors><V-M-EXAMPLE /></VerificationAnchors></DurableScope>",
    );
    const resultCodes = issueCodes(projectWithBundle(validSpec(), plan));
    expect(resultCodes).not.toContain("change.scope-does-not-cover-spec");
    expect(resultCodes).not.toContain("change.plan-scope-exceeds-spec");
  });

  it("accepts OutOfPlanScope with a non-empty Reason as covering the spec anchor", () => {
    const plan = validPlan(
      task("T-001"),
      "<OutOfPlanScope><M-EXAMPLE><Reason>Deprecated; tracked in C-DROP-LEGACY.</Reason></M-EXAMPLE></OutOfPlanScope>",
    ).replace("<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>", "<DurableScope><None /></DurableScope>");
    expect(issueCodes(projectWithBundle(validSpec(), plan))).not.toContain("change.scope-does-not-cover-spec");
  });

  it("errors when OutOfPlanScope Reason is empty", () => {
    const plan = validPlan(
      task("T-001"),
      "<OutOfPlanScope><M-EXAMPLE><Reason></Reason></M-EXAMPLE></OutOfPlanScope>",
    );
    expect(issueCodes(projectWithBundle(validSpec(), plan))).toContain("change.out-of-plan-scope-missing-reason");
  });

  it("ignores free-text AffectedAreas prose and does not fire scope coverage", () => {
    const spec = validSpec().replace("<AffectedAreas><M-EXAMPLE /></AffectedAreas>", "<AffectedAreas>services/ledger and the web UI</AffectedAreas>");
    const plan = validPlan(task("T-001")).replace(
      "<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>",
      "<DurableScope><None /></DurableScope>",
    );
    const resultCodes = issueCodes(projectWithBundle(spec, plan));
    expect(resultCodes).not.toContain("change.scope-does-not-cover-spec");
  });

  it("does not warn on plan anchors when a legacy spec describes AffectedAreas in prose", () => {
    // The plan keeps real anchors: a legacy spec must not make a well-anchored plan noisy.
    const spec = validSpec().replace("<AffectedAreas><M-EXAMPLE /></AffectedAreas>", "<AffectedAreas>services/ledger and the web UI</AffectedAreas>");
    const plan = validPlan(task("T-001")).replace(
      "<GraphAnchors><M-EXAMPLE /></GraphAnchors>",
      "<GraphAnchors><M-EXAMPLE /><M-OTHER /><DF-LEDGER-FLOW /></GraphAnchors>",
    );
    const resultCodes = issueCodes(projectWithBundle(spec, plan));
    expect(resultCodes).not.toContain("change.plan-scope-exceeds-spec");
    expect(resultCodes).not.toContain("change.scope-does-not-cover-spec");
  });

  it("does not re-litigate scope for superseded bundles", () => {
    const spec = validSpec("C-EXAMPLE", "<Replacement>C-NEXT</Replacement>").replace('status="approved"', 'status="superseded"');
    const plan = validPlan(task("T-001"), "<Replacement>C-NEXT</Replacement>")
      .replace('status="approved"', 'status="superseded"')
      .replace("<GraphAnchors><M-EXAMPLE /></GraphAnchors>", "<GraphAnchors><M-DIVERGED /></GraphAnchors>");
    const resultCodes = issueCodes(projectWithBundle(spec, plan));
    expect(resultCodes).not.toContain("change.scope-does-not-cover-spec");
    expect(resultCodes).not.toContain("change.plan-scope-exceeds-spec");
  });

  it("rejects a Satisfies child that is not a canonical AC-* anchor", () => {
    const spec = validSpec().replace(
      "<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>",
      "<AcceptanceCriteria><AC-KEYBOARD-NAV>Arrow keys move focus.</AC-KEYBOARD-NAV></AcceptanceCriteria>",
    );
    const plan = validPlan(
      `<T-001><Title>T-001 title</Title><DependsOn></DependsOn><Satisfies><ac-keyboard-nav /></Satisfies><AcceptanceCriteria><Criterion>T-001 accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001>`,
    );
    expect(issueCodes(projectWithBundle(spec, plan))).toContain("change.plan-invalid-section-shape");
  });

  it("accepts an AC-* whose text lives in a child element", () => {
    const spec = validSpec().replace(
      "<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>",
      "<AcceptanceCriteria><AC-KEYBOARD-NAV><Detail>Arrow keys move focus.</Detail></AC-KEYBOARD-NAV></AcceptanceCriteria>",
    );
    const plan = validPlan(
      `<T-001><Title>T-001 title</Title><DependsOn></DependsOn><Satisfies><AC-KEYBOARD-NAV /></Satisfies><AcceptanceCriteria><Criterion>T-001 accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001>`,
    );
    expect(issueCodes(projectWithBundle(spec, plan))).not.toContain("change.empty-acceptance-criterion");
  });

  it("accepts plans that satisfy every AC-* criterion", () => {
    const spec = validSpec().replace(
      "<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>",
      "<AcceptanceCriteria><AC-KEYBOARD-NAV>Arrow keys move focus.</AC-KEYBOARD-NAV><AC-AXE-CLEAN>axe is clean.</AC-AXE-CLEAN></AcceptanceCriteria>",
    );
    const plan = validPlan(
      `<T-001><Title>T-001 title</Title><DependsOn></DependsOn><Satisfies><AC-KEYBOARD-NAV /><AC-AXE-CLEAN /></Satisfies><AcceptanceCriteria><Criterion>T-001 accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001>`,
    );
    const resultCodes = issueCodes(projectWithBundle(spec, plan));
    expect(resultCodes).not.toContain("change.acceptance-criterion-unmapped");
    expect(resultCodes).not.toContain("change.unknown-acceptance-criterion");
  });

  it("warns when one of two AC-* criteria is unmapped", () => {
    const spec = validSpec().replace(
      "<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>",
      "<AcceptanceCriteria><AC-KEYBOARD-NAV>Arrow keys.</AC-KEYBOARD-NAV><AC-AXE-CLEAN>axe clean.</AC-AXE-CLEAN></AcceptanceCriteria>",
    );
    const plan = validPlan(
      `<T-001><Title>T-001 title</Title><DependsOn></DependsOn><Satisfies><AC-KEYBOARD-NAV /></Satisfies><AcceptanceCriteria><Criterion>T-001 accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001>`,
    );
    const result = validateNgraceProject(projectWithBundle(spec, plan));
    const unmapped = result.issues.filter((i) => i.code === "change.acceptance-criterion-unmapped");
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]?.message).toContain("AC-AXE-CLEAN");
    expect(unmapped[0]?.severity).toBe("warning");
  });

  it("errors when plan Satisfies references AC-* absent from the spec", () => {
    const plan = validPlan(
      `<T-001><Title>T-001 title</Title><DependsOn></DependsOn><Satisfies><AC-MISSING /></Satisfies><AcceptanceCriteria><Criterion>T-001 accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001>`,
    );
    expect(issueCodes(projectWithBundle(validSpec(), plan))).toContain("change.unknown-acceptance-criterion");
  });

  it("skips criteria mapping for legacy free-text AcceptanceCriteria", () => {
    const root = projectWithBundle(validSpec(), validPlan(task("T-001")));
    const resultCodes = issueCodes(root);
    expect(resultCodes).not.toContain("change.acceptance-criterion-unmapped");
    expect(resultCodes).not.toContain("change.unknown-acceptance-criterion");
  });

  it("rejects duplicate AC-* ids in one spec", () => {
    const spec = validSpec().replace(
      "<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>",
      "<AcceptanceCriteria><AC-DUP>one</AC-DUP><AC-DUP>two</AC-DUP></AcceptanceCriteria>",
    );
    expect(issueCodes(projectWithBundle(spec, validPlan(task("T-001"))))).toContain("change.duplicate-acceptance-criterion");
  });

  it("rejects empty AC-* elements", () => {
    const spec = validSpec().replace(
      "<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>",
      "<AcceptanceCriteria><AC-EMPTY></AC-EMPTY></AcceptanceCriteria>",
    );
    expect(issueCodes(projectWithBundle(spec, validPlan(task("T-001"))))).toContain("change.empty-acceptance-criterion");
  });

  it("emits no coverage issues when the plan is absent", () => {
    const root = projectWithBundle(validSpec(), null);
    const resultCodes = issueCodes(root);
    expect(resultCodes).not.toContain("change.scope-does-not-cover-spec");
    expect(resultCodes).not.toContain("change.plan-scope-exceeds-spec");
    expect(resultCodes).not.toContain("change.acceptance-criterion-unmapped");
  });

  it("classifies AC-lowercase as a malformed acceptance-criterion anchor", () => {
    const root = parseGraceXmlArtifact(
      "spec.xml",
      `<NgraceChangeSpec graceVersion="1.0"><C-X><AcceptanceCriteria><AC-lowercase>bad</AC-lowercase></AcceptanceCriteria></C-X></NgraceChangeSpec>`,
    ).root!;
    const issues = validateSemanticAnchorDiscipline("spec.xml", root);
    const malformed = issues.filter((i) => i.code === "artifact.malformed-semantic-anchor");
    expect(malformed.some((i) => i.message.includes("acceptance-criterion"))).toBe(true);
  });
});

describe("optional design-system.xml (Phase 6)", () => {
  it("projects without design-system.xml still lint clean (compatibility)", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    expect(validateNgraceProject(root).issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(existsSync(path.join(root, ".ngrace/context/design-system.xml"))).toBe(false);
  });

  it("rejects duplicate DT-* tokens", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "src/tokens.css", ":root { --accent: #f00; }\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/design-system.xml`,
      `<NgraceDesignSystem graceVersion="1.0"><Applicability>applicable</Applicability><TokenSource>src/tokens.css</TokenSource><Tokens><DT-COLOR-ACCENT><Value>var(--accent)</Value></DT-COLOR-ACCENT><DT-COLOR-ACCENT><Value>var(--accent2)</Value></DT-COLOR-ACCENT></Tokens></NgraceDesignSystem>`,
    );
    expect(codes(validateNgraceProject(root))).toContain("design-system.duplicate-token");
  });

  it("rejects TokenSource that escapes the project root", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/design-system.xml`,
      `<NgraceDesignSystem graceVersion="1.0"><Applicability>applicable</Applicability><TokenSource>../etc/passwd</TokenSource></NgraceDesignSystem>`,
    );
    const resultCodes = codes(validateNgraceProject(root));
    expect(resultCodes).toContain("design-system.invalid-token-source");
    expect(resultCodes).not.toContain("xml.parse");
  });

  it("rejects empty DT-* Value and BP-* without widths", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "src/tokens.css", ":root {}\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/design-system.xml`,
      `<NgraceDesignSystem graceVersion="1.0"><Applicability>applicable</Applicability><TokenSource>src/tokens.css</TokenSource><Tokens><DT-EMPTY><Value></Value></DT-EMPTY></Tokens><Breakpoints><BP-BAD><Intent>broken</Intent></BP-BAD></Breakpoints></NgraceDesignSystem>`,
    );
    const resultCodes = codes(validateNgraceProject(root));
    expect(resultCodes).toContain("design-system.empty-token-value");
    expect(resultCodes).toContain("design-system.breakpoint-missing-width");
  });

  it("accepts a well-formed design-system.xml", () => {
    const root = createProject();
    writeMinimalNgraceProject(root);
    writeProjectFile(root, "src/tokens.css", ":root { --accent: #0af; }\n");
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/design-system.xml`,
      `<NgraceDesignSystem graceVersion="1.0"><Applicability>applicable</Applicability><TokenSource>src/tokens.css</TokenSource><Tokens><DT-COLOR-ACCENT><Value>var(--accent)</Value><Usage>Accent</Usage></DT-COLOR-ACCENT></Tokens><Breakpoints><BP-MOBILE><MinWidth>0</MinWidth><MaxWidth>767px</MaxWidth><Intent>phone</Intent></BP-MOBILE></Breakpoints><Accessibility><Standard>WCAG 2.2 AA</Standard><ContrastMinimum>4.5</ContrastMinimum></Accessibility></NgraceDesignSystem>`,
    );
    const resultCodes = codes(validateNgraceProject(root));
    expect(resultCodes.filter((c) => c.startsWith("design-system."))).toEqual([]);
  });
});
