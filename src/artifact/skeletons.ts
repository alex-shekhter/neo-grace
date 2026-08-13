// START_MODULE_CONTRACT
//   PURPOSE: Render spec and plan skeletons from live grammar inventories
//   SCOPE: Skeleton and teaching emissions for change spec and plan
//   DEPENDS: none
//   LINKS: M-GRAMMAR
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SkeletonRenderOptions
//   renderChangePlan
//   renderChangeSpec
// END_MODULE_MAP
import { GRAMMAR_INVENTORIES } from "./grammar";
import { ANCHOR_PATTERNS, NGRACE_ARTIFACT_VERSION } from "./types";
import { parseGraceXmlArtifact, walkNodes } from "./xml";

export type SkeletonRenderOptions = {
  teaching?: boolean;
};

type PlanSeed = {
  moduleAnchors: string[];
  flowAnchors: string[];
  acceptanceCriteria: string[];
};

const SYNTHETIC_MODULE = "M-AFFECTED-MODULE";
const SYNTHETIC_CRITERION = "AC-SKELETON";

function xmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assertCommentBody(body: string): string {
  if (body.includes("--")) {
    throw new Error("skeleton teaching comment body must not contain two adjacent hyphens");
  }
  return body;
}

function seedFromSpecXml(specXml?: string): PlanSeed {
  const fallback: PlanSeed = {
    moduleAnchors: [SYNTHETIC_MODULE],
    flowAnchors: [],
    acceptanceCriteria: [SYNTHETIC_CRITERION],
  };
  if (specXml === undefined) {
    return fallback;
  }
  const parsed = parseGraceXmlArtifact("spec.xml", specXml);
  if (!parsed.root) {
    return fallback;
  }
  const wrapper = parsed.root.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
  if (!wrapper) {
    return fallback;
  }
  const moduleAnchors: string[] = [];
  const flowAnchors: string[] = [];
  for (const section of wrapper.children.filter((child) => child.tag === "AffectedAreas")) {
    for (const child of section.children) {
      if (ANCHOR_PATTERNS.module.test(child.tag)) {
        moduleAnchors.push(child.tag);
      } else if (ANCHOR_PATTERNS.dataFlow.test(child.tag)) {
        flowAnchors.push(child.tag);
      }
    }
  }
  const acceptanceCriteria: string[] = [];
  for (const section of wrapper.children.filter((child) => child.tag === "AcceptanceCriteria")) {
    for (const node of walkNodes(section)) {
      if (node !== section && ANCHOR_PATTERNS.acceptanceCriterion.test(node.tag)) {
        acceptanceCriteria.push(node.tag);
      }
    }
  }
  return {
    moduleAnchors: moduleAnchors.length > 0 ? moduleAnchors : [SYNTHETIC_MODULE],
    flowAnchors,
    acceptanceCriteria,
  };
}

function renderRequiredCore(
  sectionNames: readonly string[],
  renderSection: (name: string) => string,
): string {
  return sectionNames.map(renderSection).join("\n");
}

function renderSpecSection(name: string, changeId: string): string {
  const safeId = xmlEscape(changeId);
  switch (name) {
    case "Summary":
      return `    <Summary>Summary of ${safeId}.</Summary>`;
    case "Goals":
      return `    <Goals>\n      <Goal>Goal for ${safeId}.</Goal>\n    </Goals>`;
    case "Constraints":
      return `    <Constraints>\n      <Constraint>Constraint for ${safeId}.</Constraint>\n    </Constraints>`;
    case "NonGoals":
      return `    <NonGoals>\n      <NonGoal>Non-goal for ${safeId}.</NonGoal>\n    </NonGoals>`;
    case "AcceptanceCriteria":
      return `    <AcceptanceCriteria>\n      <${SYNTHETIC_CRITERION}>Acceptance criterion for ${safeId}.</${SYNTHETIC_CRITERION}>\n    </AcceptanceCriteria>`;
    case "AffectedAreas":
      return `    <AffectedAreas>\n      <${SYNTHETIC_MODULE} />\n    </AffectedAreas>`;
    case "VerificationIntent":
      return `    <VerificationIntent>\n      <ExpectedCommand>bun test</ExpectedCommand>\n      <ExpectedEvidence>Evidence for ${safeId}.</ExpectedEvidence>\n    </VerificationIntent>`;
    default:
      return `    <${name}>Placeholder for ${safeId}.</${name}>`;
  }
}

function renderDesignReferenceChild(tag: string): string {
  if (tag === "Figma") {
    return `      <Figma url="https://www.figma.com/design/EXAMPLE/Frame">Example frame</Figma>`;
  }
  if (tag === "UserResearch") {
    return `      <UserResearch>docs/research/EXAMPLE.md</UserResearch>`;
  }
  return `      <${tag}>Example ${xmlEscape(tag)}</${tag}>`;
}

function renderSpecTeachingAppendix(): string {
  const designChildren = [...GRAMMAR_INVENTORIES.DESIGN_REFERENCE_CHILD_TAGS].map(renderDesignReferenceChild);
  const clarificationBody = assertCommentBody(
    `\n      ${GRAMMAR_INVENTORIES.CLARIFICATION_WORKING_FORM}\n      <Clarifications>\n        <Clarification><${SYNTHETIC_CRITERION} />Placeholder clarification.</Clarification>\n      </Clarifications>\n    `,
  );
  return [
    `    <Problem>Problem for the teaching example.</Problem>`,
    `    <Assumptions>`,
    `      <Assumption>Assumption for the teaching example.</Assumption>`,
    `    </Assumptions>`,
    `    <DesignReferences>`,
    ...designChildren,
    `    </DesignReferences>`,
    `    <!--${clarificationBody}-->`,
  ].join("\n");
}

function firstAssertionModule(seed: PlanSeed): string {
  return seed.moduleAnchors[0] ?? SYNTHETIC_MODULE;
}

function renderTaskSection(name: string, changeId: string): string {
  const safeId = xmlEscape(changeId);
  switch (name) {
    case "Title":
      return `        <Title>Implement ${safeId}</Title>`;
    case "DependsOn":
      return `        <DependsOn></DependsOn>`;
    case "AcceptanceCriteria":
      return `        <AcceptanceCriteria>\n          <Criterion>Implement ${safeId}.</Criterion>\n        </AcceptanceCriteria>`;
    case "Verification":
      return `        <Verification>\n          <Command>bun test</Command>\n        </Verification>`;
    default:
      return `        <${name}>Placeholder for ${safeId}.</${name}>`;
  }
}

function renderImplementationPlan(changeId: string, seed: PlanSeed): string {
  const taskBody = renderRequiredCore(
    GRAMMAR_INVENTORIES.TASK_REQUIRED_SECTIONS,
    (name) => renderTaskSection(name, changeId),
  );
  const satisfies = seed.acceptanceCriteria.length > 0
    ? `\n        <Satisfies>\n${seed.acceptanceCriteria.map((id) => `          <${id} />`).join("\n")}\n        </Satisfies>`
    : "";
  return [
    `    <ImplementationPlan>`,
    `      <T-001>`,
    taskBody + satisfies,
    `      </T-001>`,
    `    </ImplementationPlan>`,
  ].join("\n");
}

function renderPlanSection(name: string, changeId: string, seed: PlanSeed): string {
  const safeId = xmlEscape(changeId);
  const module = firstAssertionModule(seed);
  switch (name) {
    case "IntentSummary":
      return `    <IntentSummary>Plan for ${safeId}.</IntentSummary>`;
    case "BaselineAssertions":
      return `    <BaselineAssertions>\n      <MustExist>\n        <Value>${module}</Value>\n      </MustExist>\n    </BaselineAssertions>`;
    case "TargetAssertions":
      return `    <TargetAssertions>\n      <MustExist>\n        <Value>${module}</Value>\n      </MustExist>\n    </TargetAssertions>`;
    case "DurableScope": {
      const anchors = [...seed.moduleAnchors, ...seed.flowAnchors];
      const children = anchors.map((anchor) => `        <${anchor} />`).join("\n");
      return `    <DurableScope>\n      <GraphAnchors>\n${children}\n      </GraphAnchors>\n    </DurableScope>`;
    }
    case "ObservedWriteScope":
      return `    <ObservedWriteScope>\n      <None />\n    </ObservedWriteScope>`;
    case "ImplementationPlan":
      return renderImplementationPlan(changeId, seed);
    default:
      return `    <${name}>Placeholder for ${safeId}.</${name}>`;
  }
}

function renderPlanTeachingAppendix(): string {
  const outOfPlan = assertCommentBody(
    `\n      <OutOfPlanScope>\n        <M-OUT-OF-PLAN><Reason>Not in the teaching example.</Reason></M-OUT-OF-PLAN>\n      </OutOfPlanScope>\n    `,
  );
  const clarification = assertCommentBody(
    `\n      ${GRAMMAR_INVENTORIES.CLARIFICATION_WORKING_FORM}\n      <Clarifications>\n        <Clarification><${SYNTHETIC_CRITERION} />Placeholder clarification.</Clarification>\n      </Clarifications>\n    `,
  );
  return `    <!--${outOfPlan}-->\n    <!--${clarification}-->`;
}

/** Render a change spec from the live required-section inventory. */
export function renderChangeSpec(
  changeId: string,
  options?: SkeletonRenderOptions,
): string {
  const core = renderRequiredCore(
    GRAMMAR_INVENTORIES.SPEC_REQUIRED_SECTIONS,
    (name) => renderSpecSection(name, changeId),
  );
  const appendix = options?.teaching === true ? `\n${renderSpecTeachingAppendix()}` : "";
  return [
    `<NgraceChangeSpec graceVersion="${NGRACE_ARTIFACT_VERSION}" status="draft">`,
    `  <${changeId}>`,
    core + appendix,
    `  </${changeId}>`,
    `</NgraceChangeSpec>`,
    "",
  ].join("\n");
}

/** Render a change plan from the live required-section inventory, seeded from an optional spec. */
export function renderChangePlan(
  changeId: string,
  specXml?: string,
  options?: SkeletonRenderOptions,
): string {
  const seed = seedFromSpecXml(specXml);
  const core = renderRequiredCore(
    GRAMMAR_INVENTORIES.PLAN_REQUIRED_SECTIONS,
    (name) => renderPlanSection(name, changeId, seed),
  );
  const appendix = options?.teaching === true ? `\n${renderPlanTeachingAppendix()}` : "";
  return [
    `<NgraceChangePlan graceVersion="${NGRACE_ARTIFACT_VERSION}" status="draft">`,
    `  <${changeId}>`,
    core + appendix,
    `  </${changeId}>`,
    `</NgraceChangePlan>`,
    "",
  ].join("\n");
}
