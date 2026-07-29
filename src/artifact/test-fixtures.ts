import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ARTIFACT_DIR } from "./paths";

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function ensureChangeDirectories(root: string) {
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });
}

function writeContextArtifacts(root: string) {
  writeProjectFile(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements graceVersion="1.0"><Summary>Required behavior.</Summary></NgraceRequirements>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/technology.xml`, `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/principles.xml`, `<NgracePrinciples graceVersion="1.0"><Principle>Prefer evidence.</Principle></NgracePrinciples>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<NgraceDeployment graceVersion="1.0"><Applicability>applicable</Applicability></NgraceDeployment>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<NgraceUXGuidelines graceVersion="1.0"><Applicability>applicable</Applicability></NgraceUXGuidelines>`);
}

/** Writes a minimal valid GRACE 4 project to a temporary directory. */
export function writeMinimalNgraceProject(root: string): void {
  writeContextArtifacts(root);
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
    `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>Example works.</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
  );
  ensureChangeDirectories(root);
}

/** Writes a GRACE 4 project with segmented graph and verification documents. */
export function writeSegmentedNgraceProject(root: string): void {
  writeContextArtifacts(root);
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-CORE><Path>graph/core.xml</Path><Owns><M-EXAMPLE /><M-SECOND /></Owns></GD-CORE><GD-FLOWS><Path>graph/flows.xml</Path><Owns><DF-EXAMPLE-FLOW /></Owns></GD-FLOWS></GraphDocuments></NgraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/core.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-CORE><M-EXAMPLE><Summary>Example module.</Summary><Path>src/example.ts</Path><M-SECOND /></M-EXAMPLE><M-SECOND><Summary>Second module.</Summary><Path>src/second.ts</Path></M-SECOND></GD-CORE></NgraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/flows.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-FLOWS><DF-EXAMPLE-FLOW><Summary>Example flow.</Summary><M-EXAMPLE /><M-SECOND /></DF-EXAMPLE-FLOW></GD-FLOWS></NgraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-CORE><Path>verification/core.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-CORE><VD-SECOND><Path>verification/second.xml</Path><Owns><V-M-SECOND /></Owns></VD-SECOND></VerificationDocuments></NgraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/core.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-CORE><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>Example works.</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-CORE></NgraceVerificationDocument>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/second.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-SECOND><V-M-SECOND><Command>bun test src/second.test.ts</Command><Scenario>Second module works.</Scenario><Marker>[Second][run][BLOCK_RUN]</Marker></V-M-SECOND></VD-SECOND></NgraceVerificationDocument>`,
  );
  ensureChangeDirectories(root);
}

/** Writes one active or archived change bundle fixture. */
export function writeChangeBundleFixture(root: string, options: {
  changeId: string;
  location: "active" | "archive";
  specStatus: string;
  planStatus?: string;
  planBody?: string;
  planBaselineAssertions?: string;
  planTargetAssertions?: string;
  designContext?: string;
}): void {
  const bundleRoot = `${ARTIFACT_DIR}/changes/${options.location}/${options.changeId}`;
  writeProjectFile(
    root,
    `${bundleRoot}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="${options.specStatus}"><${options.changeId}><Summary>Fixture change.</Summary><Problem>Fixture problem.</Problem><Goals><Goal>Exercise the change lifecycle.</Goal></Goals><Constraints><Constraint>Preserve fixture validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand><ExpectedEvidence>Passing tests.</ExpectedEvidence></VerificationIntent><Assumptions><Assumption>The fixture project exists.</Assumption></Assumptions></${options.changeId}></NgraceChangeSpec>`,
  );

  if (options.planStatus) {
    const planBody = `<IntentSummary>Apply the fixture change.</IntentSummary><BaselineAssertions>${options.planBaselineAssertions ?? "<MustExist><Value>M-EXAMPLE</Value></MustExist>"}</BaselineAssertions><TargetAssertions>${options.planTargetAssertions ?? "<MustVerify><Module>M-EXAMPLE</Module></MustVerify>"}</TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>${options.planBody ?? ""}<ImplementationPlan><T-001><Title>Apply fixture change</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan>`;
    writeProjectFile(
      root,
      `${bundleRoot}/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="${options.planStatus}"><${options.changeId}>${planBody}</${options.changeId}></NgraceChangePlan>`,
    );
  }

  if (options.designContext) {
    writeProjectFile(
      root,
      `${bundleRoot}/design-context.xml`,
      options.designContext,
    );
  }
}

/** Writes a legacy GRACE 3 docs fixture used only for migration guidance tests. */
export function writeLegacyGrace3Project(root: string): void {
  writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan VERSION="0.2.0" />`);
  writeProjectFile(root, "docs/knowledge-graph.xml", `<KnowledgeGraph />`);
  writeProjectFile(root, "docs/verification-plan.xml", `<VerificationPlan VERSION="0.2.0" />`);
}
