import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import {
  validateArtifactRoot,
  validateChangeArtifact,
  validateChangeDesignContextArtifact,
  validateContextArtifacts,
  validateGrace4Project,
  validateSemanticAnchorDiscipline,
} from "./grammar";
import { writeChangeBundleFixture, writeLegacyGrace3Project, writeMinimalGrace4Project, writeSegmentedGrace4Project } from "./test-fixtures";
import { parseGraceXmlArtifact } from "./xml";

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
  return `<GraceChangeSpec graceVersion="4.0" status="approved"><${changeId}><Summary>Summary.</Summary><Goals><Goal>Goal.</Goal></Goals><Constraints><Constraint>Constraint.</Constraint></Constraints><NonGoals><NonGoal>Non-goal.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent>${overrides}</${changeId}></GraceChangeSpec>`;
}

function validPlan(tasks: string, overrides = "", changeId = "C-EXAMPLE"): string {
  return `<GraceChangePlan graceVersion="4.0" status="approved"><${changeId}><IntentSummary>Intent.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>${overrides}<ImplementationPlan>${tasks}</ImplementationPlan></${changeId}></GraceChangePlan>`;
}

function task(id: string, dependencies = ""): string {
  return `<${id}><Title>${id} title</Title><DependsOn>${dependencies}</DependsOn><AcceptanceCriteria><Criterion>${id} accepted.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></${id}>`;
}

describe("GRACE 4 Artifact Grammar", () => {
  it("fixture builders create required GRACE 4 and legacy project shapes", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, { changeId: "C-FIXTURE", location: "active", specStatus: "approved", planStatus: "approved" });

    for (const relativePath of [
      ".grace/context/requirements.xml",
      ".grace/context/technology.xml",
      ".grace/context/principles.xml",
      ".grace/context/deployment.xml",
      ".grace/context/ux-guidelines.xml",
      ".grace/graph/index.xml",
      ".grace/graph/main.xml",
      ".grace/verification/index.xml",
      ".grace/verification/main.xml",
      ".grace/changes/active/C-FIXTURE/spec.xml",
      ".grace/changes/active/C-FIXTURE/plan.xml",
    ]) {
      expect(existsSync(path.join(root, relativePath))).toBe(true);
    }
    expect(validateGrace4Project(root).issues).toHaveLength(0);

    const segmentedRoot = createProject();
    writeSegmentedGrace4Project(segmentedRoot);
    expect(validateGrace4Project(segmentedRoot).issues).toHaveLength(0);
    expect(existsSync(path.join(segmentedRoot, ".grace/graph/core.xml"))).toBe(true);
    expect(existsSync(path.join(segmentedRoot, ".grace/verification/second.xml"))).toBe(true);

    const legacyRoot = createProject();
    writeLegacyGrace3Project(legacyRoot);
    expect(codes(validateGrace4Project(legacyRoot))).toContain("project.grace3-detected");
  });

  it("validates a minimal current .grace project", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    const result = validateGrace4Project(root);

    expect(result.issues).toHaveLength(0);
    expect(result.artifacts.map((artifact) => artifact.rootTag).sort()).toEqual([
      "GraceDeployment",
      "GraceGraphDocument",
      "GraceGraphIndex",
      "GracePrinciples",
      "GraceRequirements",
      "GraceTechnology",
      "GraceUXGuidelines",
      "GraceVerificationDocument",
      "GraceVerificationIndex",
    ]);
  });

  it("rejects graph and verification documents with the wrong artifact root", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceRequirements graceVersion="4.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></GraceRequirements>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      `<GracePrinciples graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE /></VD-MAIN></GracePrinciples>`,
    );

    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes.filter((code) => code === "artifact.unexpected-root-tag")).toHaveLength(2);
  });

  it("rejects mismatched bundle ids and approved plans without the required executable contract", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-FOLDER/spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-SPEC /></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/active/C-FOLDER/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-PLAN /></GraceChangePlan>`,
    );

    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes).toContain("change.bundle-id-mismatch");
    expect(resultCodes).toContain("change.spec-plan-id-mismatch");
    expect(resultCodes).toContain("change.spec-missing-section");
    expect(resultCodes).toContain("change.plan-missing-section");
  });

  it("rejects active plans created beside non-approved specs", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, { changeId: "C-DRAFT", location: "active", specStatus: "draft", planStatus: "draft" });

    expect(codes(validateGrace4Project(root))).toContain("change.plan-requires-approved-spec");
  });

  it("reports missing graceVersion, unsupported versions, invalid roots, and malformed XML", () => {
    const missing = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<GraceRequirements />`));
    const unsupported = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<GraceRequirements graceVersion="3.11" />`));
    const invalidRoot = validateArtifactRoot(parseGraceXmlArtifact("unknown.xml", `<NotGrace graceVersion="4.0" />`));
    const malformed = validateArtifactRoot(parseGraceXmlArtifact("broken.xml", `<GraceRequirements graceVersion="4.0"><Open></GraceRequirements>`));

    expect(codes(missing)).toContain("artifact.missing-grace-version");
    expect(codes(unsupported)).toContain("artifact.unsupported-grace-version");
    expect(codes(invalidRoot)).toContain("artifact.invalid-root-tag");
    expect(codes(malformed)).toContain("xml.parse");
  });

  it("allows status only on change artifact roots", () => {
    const context = validateArtifactRoot(
      parseGraceXmlArtifact("requirements.xml", `<GraceRequirements graceVersion="4.0" status="approved" />`),
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
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><Module ref="M-EXAMPLE" /></GD-MAIN></GraceGraphDocument>`,
    );

    expect(codes({ issues: validateSemanticAnchorDiscipline("graph.xml", artifact.root!) })).toContain(
      "artifact.semantic-anchor-attribute",
    );
  });

  it("rejects malformed semantic-anchor tags across every anchor family", () => {
    const artifact = parseGraceXmlArtifact(
      "anchors.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-bad /><GD-bad /><VD-bad /><C-bad /><V-M-bad /><DF-bad /><IC-bad /><INV-bad /><T-bad /><AC-bad /><DT-bad /><BP-bad /><ST-bad /><Stack-bad /></GD-MAIN></GraceGraphDocument>`,
    );

    const resultCodes = codes({ issues: validateSemanticAnchorDiscipline("anchors.xml", artifact.root!) });
    expect(resultCodes.filter((code) => code === "artifact.malformed-semantic-anchor")).toHaveLength(14);
  });

  it("rejects attributes on canonical anchors and anchor-like attribute names or values", () => {
    const artifact = parseGraceXmlArtifact(
      "anchors.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN role="owner"><Node M-bad="yes" ref="VD-bad" /></GD-MAIN></GraceGraphDocument>`,
    );

    const resultCodes = codes({ issues: validateSemanticAnchorDiscipline("anchors.xml", artifact.root!) });
    expect(resultCodes).toContain("artifact.semantic-anchor-has-attributes");
    expect(resultCodes.filter((code) => code === "artifact.semantic-anchor-attribute")).toHaveLength(2);
  });

  it("requires canonical active and archive change directories", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    rmSync(path.join(root, ".grace", "changes", "active"), { recursive: true });
    rmSync(path.join(root, ".grace", "changes", "archive"), { recursive: true });

    expect(codes(validateGrace4Project(root)).filter((code) => code === "project.missing-change-directory")).toHaveLength(2);
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
      parseGraceXmlArtifact("active/plan.xml", `<GraceChangePlan graceVersion="4.0" status="applied"><C-EXAMPLE /></GraceChangePlan>`),
      "active",
    );
    const archive = validateChangeArtifact(
      parseGraceXmlArtifact("archive/spec.xml", `<GraceChangeSpec graceVersion="4.0" status="draft"><C-EXAMPLE /></GraceChangeSpec>`),
      "archive",
    );

    expect(codes(active)).toContain("change.invalid-active-status");
    expect(codes(archive)).toContain("change.invalid-archive-status");
  });

  it("requires not-applicable deployment and UX context artifacts to include a reason", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/context/deployment.xml",
      `<GraceDeployment graceVersion="4.0"><Applicability>not-applicable</Applicability></GraceDeployment>`,
    );
    writeProjectFile(
      root,
      ".grace/context/ux-guidelines.xml",
      `<GraceUXGuidelines graceVersion="4.0"><Applicability>not-applicable</Applicability></GraceUXGuidelines>`,
    );

    const results = validateContextArtifacts(resolveGrace4Paths(root));
    const allCodes = results.flatMap(codes);

    expect(allCodes.filter((code) => code === "context.not-applicable-reason-missing")).toHaveLength(2);
  });

  it("rejects empty context artifacts and invalid optional applicability declarations", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements graceVersion="4.0" />`);
    writeProjectFile(root, ".grace/context/deployment.xml", `<GraceDeployment graceVersion="4.0"><Summary>Deployment applies.</Summary></GraceDeployment>`);
    writeProjectFile(root, ".grace/context/ux-guidelines.xml", `<GraceUXGuidelines graceVersion="4.0"><Applicability>sometimes</Applicability></GraceUXGuidelines>`);

    const resultCodes = validateContextArtifacts(resolveGrace4Paths(root)).flatMap(codes);
    expect(resultCodes).toContain("context.empty-artifact");
    expect(resultCodes).toContain("context.applicability-missing");
    expect(resultCodes).toContain("context.applicability-invalid");
  });

  it("rejects lack of a web UI as the sole UX not-applicable reason", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/context/ux-guidelines.xml",
      `<GraceUXGuidelines graceVersion="4.0"><Applicability>not-applicable</Applicability><Reason>Not a web app</Reason></GraceUXGuidelines>`,
    );

    const allCodes = validateContextArtifacts(resolveGrace4Paths(root)).flatMap(codes);
    expect(allCodes).toContain("context.ux-not-applicable-reason-insufficient");
  });

  it("errors when superseded change does not reference a replacement C-*", () => {
    const noReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(noReplacement)).toContain("change.superseded-missing-replacement");
    expect(noReplacement.issues.find(i => i.code === "change.superseded-missing-replacement")?.severity).toBe("error");

    const withChildTag = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><C-REPLACEMENT /><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(withChildTag)).not.toContain("change.superseded-missing-replacement");

    const withReplacementTag = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Replacement>C-REPLACEMENT</Replacement><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(withReplacementTag)).not.toContain("change.superseded-missing-replacement");
  });

  it("rejects empty or arbitrary Replacement text and accepts ReplacementChange", () => {
    const emptyReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Replacement></Replacement><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(emptyReplacement)).toContain("change.superseded-missing-replacement");

    const arbitraryReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Replacement>not-a-change</Replacement><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(arbitraryReplacement)).toContain("change.superseded-missing-replacement");

    const replacementChange = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><ReplacementChange>C-REPLACEMENT</ReplacementChange><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
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
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/archive/C-OLD/spec.xml",
      validSpec("C-OLD", "<Replacement>C-MISSING</Replacement>").replace('status="approved"', 'status="superseded"'),
    );
    expect(codes(validateGrace4Project(root))).toContain("change.superseded-replacement-not-found");
  });

  it("validates GraceChangeDesignContext inside change bundles", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, { changeId: "C-DESIGN", location: "active", specStatus: "approved", planStatus: "approved", designContext: "<GraceChangeDesignContext graceVersion=\"4.0\"><Change>C-DESIGN</Change><Rationale>Test.</Rationale></GraceChangeDesignContext>" });
    expect(validateGrace4Project(root).issues).toHaveLength(0);
  });

  it("rejects invalid GraceChangeDesignContext root, missing graceVersion, status attribute", () => {
    const valid = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0"><Change>C-DESIGN</Change></GraceChangeDesignContext>`),
    );
    expect(valid.issues).toHaveLength(0);

    const wrongRoot = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<DesignContext graceVersion="4.0" />`),
    );
    expect(codes(wrongRoot)).toContain("design-context.invalid-root-tag");

    const noVersion = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext />`),
    );
    expect(codes(noVersion)).toContain("design-context.missing-grace-version");

    const withStatus = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0" status="approved" />`),
    );
    expect(codes(withStatus)).toContain("design-context.forbidden-status");
  });

  it("accepts GraceChangeDesignContext with semantic anchor in child tag", () => {
    const result = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0"><C-DESIGN><Rationale>Test.</Rationale></C-DESIGN></GraceChangeDesignContext>`),
    );
    expect(result.issues).toHaveLength(0);
  });

  it("requires exactly one canonical design-context identity and matches it to the bundle", () => {
    const missing = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0"><Rationale>Missing identity.</Rationale></GraceChangeDesignContext>`),
    );
    expect(codes(missing)).toContain("design-context.missing-change-id");

    const invalid = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0"><Change>not-a-change</Change></GraceChangeDesignContext>`),
    );
    expect(codes(invalid)).toContain("design-context.invalid-change-id");

    const ambiguous = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0"><Change>C-DESIGN</Change><C-DESIGN /></GraceChangeDesignContext>`),
    );
    expect(codes(ambiguous)).toContain("design-context.ambiguous-change-id");

    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, {
      changeId: "C-DESIGN",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      designContext: `<GraceChangeDesignContext graceVersion="4.0"><C-WRONG><Rationale>Wrong bundle.</Rationale></C-WRONG></GraceChangeDesignContext>`,
    });
    expect(codes(validateGrace4Project(root))).toContain("design-context.bundle-id-mismatch");
  });
});

describe("spec→plan coverage (G-05 / AC-*)", () => {
  function projectWithBundle(specXml: string, planXml: string | null, changeId = "C-EXAMPLE") {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, `.grace/changes/active/${changeId}/spec.xml`, specXml);
    if (planXml) {
      writeProjectFile(root, `.grace/changes/active/${changeId}/plan.xml`, planXml);
    }
    return root;
  }

  function issueCodes(root: string) {
    return codes(validateGrace4Project(root));
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
    expect(validateGrace4Project(projectWithBundle(spec, plan)).issues.find((i) => i.code === "change.scope-does-not-cover-spec")?.severity).toBe("error");
    expect(validateGrace4Project(projectWithBundle(spec, plan)).issues.find((i) => i.code === "change.plan-scope-exceeds-spec")?.severity).toBe("warning");
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
    const result = validateGrace4Project(projectWithBundle(spec, plan));
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
      `<GraceChangeSpec graceVersion="4.0"><C-X><AcceptanceCriteria><AC-lowercase>bad</AC-lowercase></AcceptanceCriteria></C-X></GraceChangeSpec>`,
    ).root!;
    const issues = validateSemanticAnchorDiscipline("spec.xml", root);
    const malformed = issues.filter((i) => i.code === "artifact.malformed-semantic-anchor");
    expect(malformed.some((i) => i.message.includes("acceptance-criterion"))).toBe(true);
  });
});

describe("optional design-system.xml (Phase 6)", () => {
  it("projects without design-system.xml still lint clean (compatibility)", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    expect(validateGrace4Project(root).issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(existsSync(path.join(root, ".grace/context/design-system.xml"))).toBe(false);
  });

  it("rejects duplicate DT-* tokens", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "src/tokens.css", ":root { --accent: #f00; }\n");
    writeProjectFile(
      root,
      ".grace/context/design-system.xml",
      `<GraceDesignSystem graceVersion="4.0"><Applicability>applicable</Applicability><TokenSource>src/tokens.css</TokenSource><Tokens><DT-COLOR-ACCENT><Value>var(--accent)</Value></DT-COLOR-ACCENT><DT-COLOR-ACCENT><Value>var(--accent2)</Value></DT-COLOR-ACCENT></Tokens></GraceDesignSystem>`,
    );
    expect(codes(validateGrace4Project(root))).toContain("design-system.duplicate-token");
  });

  it("rejects TokenSource that escapes the project root", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/context/design-system.xml",
      `<GraceDesignSystem graceVersion="4.0"><Applicability>applicable</Applicability><TokenSource>../etc/passwd</TokenSource></GraceDesignSystem>`,
    );
    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes).toContain("design-system.invalid-token-source");
    expect(resultCodes).not.toContain("xml.parse");
  });

  it("rejects empty DT-* Value and BP-* without widths", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "src/tokens.css", ":root {}\n");
    writeProjectFile(
      root,
      ".grace/context/design-system.xml",
      `<GraceDesignSystem graceVersion="4.0"><Applicability>applicable</Applicability><TokenSource>src/tokens.css</TokenSource><Tokens><DT-EMPTY><Value></Value></DT-EMPTY></Tokens><Breakpoints><BP-BAD><Intent>broken</Intent></BP-BAD></Breakpoints></GraceDesignSystem>`,
    );
    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes).toContain("design-system.empty-token-value");
    expect(resultCodes).toContain("design-system.breakpoint-missing-width");
  });

  it("accepts a well-formed design-system.xml", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "src/tokens.css", ":root { --accent: #0af; }\n");
    writeProjectFile(
      root,
      ".grace/context/design-system.xml",
      `<GraceDesignSystem graceVersion="4.0"><Applicability>applicable</Applicability><TokenSource>src/tokens.css</TokenSource><Tokens><DT-COLOR-ACCENT><Value>var(--accent)</Value><Usage>Accent</Usage></DT-COLOR-ACCENT></Tokens><Breakpoints><BP-MOBILE><MinWidth>0</MinWidth><MaxWidth>767px</MaxWidth><Intent>phone</Intent></BP-MOBILE></Breakpoints><Accessibility><Standard>WCAG 2.2 AA</Standard><ContrastMinimum>4.5</ContrastMinimum></Accessibility></GraceDesignSystem>`,
    );
    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes.filter((c) => c.startsWith("design-system."))).toEqual([]);
  });
});
