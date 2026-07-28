import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "./project";
import {
  ACTIVE_CHANGE_STATUSES,
  ANCHOR_PATTERNS,
  ARCHIVED_CHANGE_STATUSES,
  CHANGE_STATUSES,
  GRACE4_CHANGE_COMPANION_TAGS,
  GRACE4_CONTEXT_ARTIFACTS,
  GRACE4_OPTIONAL_CONTEXT_ARTIFACTS,
  GRACE4_ROOT_TAGS,
  GRACE4_VERSION,
  type Grace4Issue,
  type Grace4ProjectPaths,
  type SemanticAnchorClassification,
  type SemanticAnchorFamily,
} from "./types";
import { ProjectPathError, resolveContainedProjectPath } from "./paths";
import { childText, readGraceXmlArtifact, walkNodes, type GraceXmlNode, type ParsedGraceXmlArtifact } from "./xml";

const STANDARD_ROOT_TAGS = new Set<string>(GRACE4_ROOT_TAGS);
const CHANGE_ROOT_TAGS = new Set(["GraceChangeSpec", "GraceChangePlan"]);
const COMPANION_ROOT_TAGS = new Set<string>(GRACE4_CHANGE_COMPANION_TAGS);
const VALID_CHANGE_STATUSES = new Set<string>(CHANGE_STATUSES);
const ROOT_METADATA_ATTRIBUTE = new Set(["graceVersion"]);
const CHANGE_ROOT_METADATA_ATTRIBUTES = new Set(["graceVersion", "status"]);
const SPEC_REQUIRED_SECTIONS = [
  "Summary",
  "Goals",
  "Constraints",
  "NonGoals",
  "AcceptanceCriteria",
  "AffectedAreas",
  "VerificationIntent",
] as const;
const PLAN_REQUIRED_SECTIONS = [
  "IntentSummary",
  "BaselineAssertions",
  "TargetAssertions",
  "DurableScope",
  "ObservedWriteScope",
  "ImplementationPlan",
] as const;
const TASK_REQUIRED_SECTIONS = ["Title", "DependsOn", "AcceptanceCriteria", "Verification"] as const;
const ASSERTION_SECTION_TAGS = new Set([
  "MustExist",
  "MustNotExist",
  "MustOwn",
  "MustLink",
  "MustVerify",
  "MustPassCommand",
  "MustContain",
  "MustNotContain",
  "MustMatchPattern",
  "MustUseToken",
  "MustNotUseLiteral",
  "MustCoverStates",
  "MustConform",
  "MustUphold",
  "MustPassBudget",
]);
const DURABLE_SCOPE_DIRECT_TAGS = new Set([
  "GraphAnchors",
  "VerificationAnchors",
  "GraphDocuments",
  "VerificationDocuments",
  "ContextArtifacts",
  "ContextArtifact",
  "Context",
  "Artifact",
  "None",
]);
const OBSERVED_SCOPE_DIRECT_TAGS = new Set(["File", "Path", "Glob", "None"]);

const ANCHOR_FAMILIES: readonly {
  family: SemanticAnchorFamily;
  prefix: string;
  pattern: RegExp;
}[] = [
  { family: "verification", prefix: "V-M-", pattern: ANCHOR_PATTERNS.verification },
  // Longer / more-specific prefixes before shorter ones that share a letter.
  { family: "invariant", prefix: "INV-", pattern: ANCHOR_PATTERNS.invariant },
  // AC-* after V-M- so prefix classification cannot shadow verification anchors.
  { family: "acceptance-criterion", prefix: "AC-", pattern: ANCHOR_PATTERNS.acceptanceCriterion },
  { family: "design-token", prefix: "DT-", pattern: ANCHOR_PATTERNS.designToken },
  { family: "breakpoint", prefix: "BP-", pattern: ANCHOR_PATTERNS.breakpoint },
  { family: "ui-state", prefix: "ST-", pattern: ANCHOR_PATTERNS.uiState },
  // Stack-* before shorter prefixes; must not be confused with ST-*.
  { family: "technology-stack", prefix: "Stack-", pattern: ANCHOR_PATTERNS.technologyStack },
  { family: "interface-contract", prefix: "IC-", pattern: ANCHOR_PATTERNS.interfaceContract },
  { family: "graph-document", prefix: "GD-", pattern: ANCHOR_PATTERNS.graphDocument },
  { family: "verification-document", prefix: "VD-", pattern: ANCHOR_PATTERNS.verificationDocument },
  { family: "data-flow", prefix: "DF-", pattern: ANCHOR_PATTERNS.dataFlow },
  { family: "change", prefix: "C-", pattern: ANCHOR_PATTERNS.change },
  { family: "module", prefix: "M-", pattern: ANCHOR_PATTERNS.module },
  { family: "task", prefix: "T-", pattern: ANCHOR_PATTERNS.task },
];

const CONTEXT_ARTIFACTS = [
  { file: "requirements.xml", rootTag: "GraceRequirements" },
  { file: "technology.xml", rootTag: "GraceTechnology" },
  { file: "principles.xml", rootTag: "GracePrinciples" },
  { file: "deployment.xml", rootTag: "GraceDeployment" },
  { file: "ux-guidelines.xml", rootTag: "GraceUXGuidelines" },
] as const;

/** Result of validating a single GRACE 4 artifact. */
export type ArtifactValidationResult = {
  file: string;
  rootTag?: string;
  graceVersion?: string;
  issues: Grace4Issue[];
};

/** Result of validating all current .grace documents in one project. */
export type Grace4ValidationResult = {
  root: string;
  issues: Grace4Issue[];
  artifacts: ArtifactValidationResult[];
};

/** Validates the root tag, graceVersion, and allowed root attributes for one artifact. */
export function validateArtifactRoot(artifact: ParsedGraceXmlArtifact): ArtifactValidationResult {
  const result: ArtifactValidationResult = {
    file: artifact.file,
    rootTag: artifact.root?.tag,
    graceVersion: artifact.root?.attributes.graceVersion,
    issues: [...artifact.issues],
  };

  if (!artifact.root) {
    return result;
  }

  const root = artifact.root;
  if (!STANDARD_ROOT_TAGS.has(root.tag)) {
    result.issues.push(issue("error", "artifact.invalid-root-tag", artifact.file, `Unsupported GRACE 4 root tag '${root.tag}'.`));
    return result;
  }

  if (!root.attributes.graceVersion) {
    result.issues.push(
      issue("error", "artifact.missing-grace-version", artifact.file, `${root.tag} must declare graceVersion="${GRACE4_VERSION}".`),
    );
  } else if (root.attributes.graceVersion !== GRACE4_VERSION) {
    result.issues.push(
      issue(
        "error",
        "artifact.unsupported-grace-version",
        artifact.file,
        `${root.tag} declares unsupported graceVersion '${root.attributes.graceVersion}'. Expected '${GRACE4_VERSION}'.`,
      ),
    );
  }

  const allowedAttributes = CHANGE_ROOT_TAGS.has(root.tag) ? CHANGE_ROOT_METADATA_ATTRIBUTES : ROOT_METADATA_ATTRIBUTE;
  for (const attribute of Object.keys(root.attributes)) {
    if (allowedAttributes.has(attribute)) {
      continue;
    }

    result.issues.push(
      issue(
        "error",
        attribute === "status" ? "artifact.forbidden-status-attribute" : "artifact.forbidden-root-attribute",
        artifact.file,
        `${attribute} is not an allowed root attribute on ${root.tag}.`,
      ),
    );
  }

  if (CHANGE_ROOT_TAGS.has(root.tag)) {
    validateChangeStatusAttribute(artifact.file, root, result.issues);
  }

  return result;
}

/** Classifies exact canonical anchors and malformed anchor-like tags. */
export function classifySemanticAnchorTag(tag: string): SemanticAnchorClassification {
  for (const { family, prefix, pattern } of ANCHOR_FAMILIES) {
    if (pattern.test(tag)) {
      return { kind: "canonical", family };
    }
    if (tag.startsWith(prefix)) {
      return { kind: "malformed", family };
    }
  }
  return { kind: "ordinary" };
}

/** Validates that semantic anchors are canonical attribute-free tags and never attributes. */
export function validateSemanticAnchorDiscipline(file: string, root: GraceXmlNode): Grace4Issue[] {
  const issues: Grace4Issue[] = [];

  for (const node of walkNodes(root)) {
    const tagClassification = classifySemanticAnchorTag(node.tag);
    if (tagClassification.kind === "malformed") {
      issues.push(
        issue(
          "error",
          "artifact.malformed-semantic-anchor",
          file,
          `<${node.tag}> resembles a ${tagClassification.family} semantic anchor but is not canonical.`,
        ),
      );
    }
    if (tagClassification.kind === "canonical" && Object.keys(node.attributes).length > 0) {
      issues.push(
        issue(
          "error",
          "artifact.semantic-anchor-has-attributes",
          file,
          `Semantic anchor <${node.tag}> must not declare attributes.`,
        ),
      );
    }

    for (const [attribute, value] of Object.entries(node.attributes)) {
      const attributeClassification = classifySemanticAnchorTag(attribute);
      const anchor = attributeClassification.kind === "ordinary" ? findSemanticAnchorInAttribute(value) : attribute;
      if (!anchor) {
        continue;
      }

      issues.push(
        issue(
          "error",
          "artifact.semantic-anchor-attribute",
          file,
          `Semantic anchor '${anchor}' appears in attribute '${attribute}' on <${node.tag}>; anchors must be XML tags.`,
        ),
      );
    }
  }

  return issues;
}

/** Validates canonical change directories before artifact enumeration. */
export function validateGrace4ProjectLayout(paths: Grace4ProjectPaths): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      issues.push(
        issue(
          "error",
          "project.missing-change-directory",
          directory,
          `Required GRACE 4 change directory is missing: ${directory}`,
        ),
      );
    }
  }
  return issues;
}

/** Validates the five mandatory context artifacts and applicability semantics. */
export function validateContextArtifacts(paths: Grace4ProjectPaths): ArtifactValidationResult[] {
  return CONTEXT_ARTIFACTS.map(({ file, rootTag }) => {
    const artifact = readGraceXmlArtifact(path.join(paths.contextDir, file));
    const result = validateParsedArtifact(artifact);

    if (artifact.root && artifact.root.tag !== rootTag) {
      result.issues.push(issue("error", "context.unexpected-root-tag", artifact.file, `${file} must use root tag ${rootTag}.`));
    }

    if (artifact.root?.tag === rootTag) {
      result.issues.push(...validateContextContent(artifact.file, artifact.root));
      if (artifact.root.tag === "GraceDeployment" || artifact.root.tag === "GraceUXGuidelines") {
        result.issues.push(...validateOptionalContextApplicability(artifact.file, artifact.root));
      }
      if (artifact.root.tag === "GraceTechnology") {
        result.issues.push(...validateTechnologyStacks(artifact.file, artifact.root, paths.root));
      }
    }

    return result;
  });
}

/**
 * Validates optional context artifacts when present.
 * Absence is never an error — design-system.xml / invariants.xml must not become required by accident.
 */
export function validateOptionalContextArtifacts(paths: Grace4ProjectPaths): ArtifactValidationResult[] {
  const results: ArtifactValidationResult[] = [];
  for (const file of GRACE4_OPTIONAL_CONTEXT_ARTIFACTS) {
    const absolute = path.join(paths.contextDir, file);
    if (!existsSync(absolute)) {
      continue;
    }
    if (file === "design-system.xml") {
      results.push(validateDesignSystemArtifact(absolute, paths.root));
    } else if (file === "invariants.xml") {
      results.push(validateInvariantsArtifact(absolute));
    }
  }
  return results;
}

/** Validates an optional GraceDesignSystem context artifact. */
export function validateDesignSystemArtifact(file: string, projectRoot: string): ArtifactValidationResult {
  const artifact = readGraceXmlArtifact(file);
  const result = validateParsedArtifact(artifact);
  if (!artifact.root) {
    return result;
  }

  if (artifact.root.tag !== "GraceDesignSystem") {
    result.issues.push(
      issue("error", "context.unexpected-root-tag", file, `design-system.xml must use root tag GraceDesignSystem.`),
    );
    return result;
  }

  result.issues.push(...validateContextContent(file, artifact.root));
  result.issues.push(...validateOptionalContextApplicability(file, artifact.root));
  result.issues.push(...validateDesignSystemBody(file, artifact.root, projectRoot));
  return result;
}

function validateDesignSystemBody(file: string, root: GraceXmlNode, projectRoot: string): Grace4Issue[] {
  const issues: Grace4Issue[] = [];

  for (const tokenSource of root.children.filter((child) => child.tag === "TokenSource")) {
    const authored = tokenSource.text.trim();
    if (!authored) {
      issues.push(issue("error", "design-system.empty-token-source", file, "TokenSource must not be empty."));
      continue;
    }
    try {
      const resolved = resolveContainedProjectPath(projectRoot, authored, { mode: "existing" });
      if (!existsSync(resolved.absolutePath)) {
        issues.push(
          issue(
            "error",
            "design-system.token-source-missing",
            file,
            `TokenSource ${JSON.stringify(authored)} does not exist inside the project.`,
          ),
        );
      }
    } catch (error) {
      const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
      issues.push(
        issue(
          "error",
          "design-system.invalid-token-source",
          file,
          `TokenSource ${JSON.stringify(authored)} is not a contained project path: ${detail}`,
        ),
      );
    }
  }

  const seenTokens = new Set<string>();
  for (const node of walkNodes(root)) {
    if (!ANCHOR_PATTERNS.designToken.test(node.tag)) continue;
    if (seenTokens.has(node.tag)) {
      issues.push(issue("error", "design-system.duplicate-token", file, `Design token ${node.tag} is declared more than once.`));
    } else {
      seenTokens.add(node.tag);
    }
    const value = childText(node, "Value")?.trim() ?? "";
    if (!value) {
      issues.push(
        issue("error", "design-system.empty-token-value", file, `Design token ${node.tag} requires a non-empty <Value>.`),
      );
    }
  }

  const seenBreakpoints = new Set<string>();
  for (const node of walkNodes(root)) {
    if (!ANCHOR_PATTERNS.breakpoint.test(node.tag)) continue;
    if (seenBreakpoints.has(node.tag)) {
      issues.push(
        issue("error", "design-system.duplicate-breakpoint", file, `Breakpoint ${node.tag} is declared more than once.`),
      );
    } else {
      seenBreakpoints.add(node.tag);
    }
    const minWidth = childText(node, "MinWidth")?.trim() ?? "";
    const maxWidth = childText(node, "MaxWidth")?.trim() ?? "";
    if (!minWidth && !maxWidth) {
      issues.push(
        issue(
          "error",
          "design-system.breakpoint-missing-width",
          file,
          `Breakpoint ${node.tag} requires <MinWidth> and/or <MaxWidth>.`,
        ),
      );
    }
  }

  return issues;
}

/** Validates an optional GraceInvariants context artifact. */
export function validateInvariantsArtifact(file: string): ArtifactValidationResult {
  const artifact = readGraceXmlArtifact(file);
  const result = validateParsedArtifact(artifact);
  if (!artifact.root) {
    return result;
  }

  if (artifact.root.tag !== "GraceInvariants") {
    result.issues.push(
      issue("error", "context.unexpected-root-tag", file, `invariants.xml must use root tag GraceInvariants.`),
    );
    return result;
  }

  result.issues.push(...validateContextContent(file, artifact.root));
  result.issues.push(...validateInvariantsBody(file, artifact.root));
  return result;
}

function validateInvariantsBody(file: string, root: GraceXmlNode): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  const seen = new Set<string>();

  for (const node of root.children) {
    if (!ANCHOR_PATTERNS.invariant.test(node.tag)) {
      // Allow non-anchor prose wrappers; only INV-* carry load-bearing structure.
      continue;
    }
    if (seen.has(node.tag)) {
      issues.push(issue("error", "context.invariants.duplicate", file, `Invariant ${node.tag} is declared more than once.`));
    } else {
      seen.add(node.tag);
    }

    const statement = childText(node, "Statement")?.trim() ?? "";
    if (!statement) {
      issues.push(
        issue("error", "context.invariants.empty-statement", file, `Invariant ${node.tag} requires a non-empty <Statement>.`),
      );
    }

    for (const applies of node.children.filter((child) => child.tag === "AppliesTo")) {
      for (const target of applies.children) {
        if (
          !ANCHOR_PATTERNS.module.test(target.tag)
          && !ANCHOR_PATTERNS.dataFlow.test(target.tag)
        ) {
          issues.push(
            issue(
              "error",
              "context.invariants.invalid-applies-to",
              file,
              `${node.tag} AppliesTo does not allow <${target.tag}>; declare M-* or DF-* anchors.`,
            ),
          );
        }
      }
    }

    for (const verification of node.children.filter((child) => child.tag === "Verification")) {
      for (const target of verification.children) {
        if (!ANCHOR_PATTERNS.verification.test(target.tag)) {
          issues.push(
            issue(
              "error",
              "context.invariants.invalid-verification",
              file,
              `${node.tag} Verification does not allow <${target.tag}>; declare V-M-* anchors.`,
            ),
          );
        }
      }
    }
  }

  return issues;
}

/**
 * Validates GraceChangeSpec and GraceChangePlan root statuses and C-* wrapper shape.
 * @param projectRoot When provided, optional DesignReferences paths are checked for project containment (G-18).
 */
export function validateChangeArtifact(
  artifact: ParsedGraceXmlArtifact,
  location: "active" | "archive",
  projectRoot?: string,
): ArtifactValidationResult {
  const result = validateParsedArtifact(artifact);
  const root = artifact.root;

  if (!root) {
    return result;
  }

  if (!CHANGE_ROOT_TAGS.has(root.tag)) {
    result.issues.push(issue("error", "change.invalid-root-tag", artifact.file, `${root.tag} is not a change artifact root.`));
    return result;
  }

  const status = root.attributes.status;
  if (status && location === "active" && !ACTIVE_CHANGE_STATUSES.has(status as never)) {
    result.issues.push(
      issue("error", "change.invalid-active-status", artifact.file, `Active change artifacts cannot use status '${status}'.`),
    );
  }
  if (status && location === "archive" && !ARCHIVED_CHANGE_STATUSES.has(status as never)) {
    result.issues.push(
      issue("error", "change.invalid-archive-status", artifact.file, `Archived change artifacts cannot use status '${status}'.`),
    );
  }

  const wrappers = root.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  if (wrappers.length !== 1) {
    result.issues.push(
      issue("error", "change.invalid-wrapper", artifact.file, `${root.tag} must contain exactly one direct C-* wrapper tag.`),
    );
  }

  if (wrappers.length === 1) {
    const wrapper = wrappers[0]!;
    if (root.tag === "GraceChangeSpec") {
      validateDirectSectionCardinality(
        artifact.file,
        wrapper,
        SPEC_REQUIRED_SECTIONS,
        "change.spec-missing-section",
        "change.spec-duplicate-section",
        result.issues,
      );
      validateMeaningfulRequiredSections(artifact.file, wrapper, SPEC_REQUIRED_SECTIONS, result.issues);
      validateSpecAcceptanceCriteria(artifact.file, wrapper, result.issues);
      validateSpecDesignReferences(artifact.file, wrapper, projectRoot, result.issues);
    } else {
      validateDirectSectionCardinality(
        artifact.file,
        wrapper,
        PLAN_REQUIRED_SECTIONS,
        "change.plan-missing-section",
        "change.plan-duplicate-section",
        result.issues,
      );
      validateMeaningfulRequiredSections(artifact.file, wrapper, PLAN_REQUIRED_SECTIONS, result.issues);
      validateStructuredPlanSections(artifact.file, wrapper, result.issues);
      validateImplementationTasks(artifact.file, wrapper, result.issues);
    }
  }

  if (status === "superseded" && wrappers.length === 1) {
    const wrapper = wrappers[0];
    const replacements = replacementChangeIds(wrapper);
    if (replacements.length === 0) {
      result.issues.push(
        issue(
          "error",
          "change.superseded-missing-replacement",
          artifact.file,
          "Superseded change must reference a replacement C-* as a child tag or via <Replacement>/<ReplacementChange> text.",
        ),
      );
    }
    if (replacements.includes(wrapper.tag)) {
      result.issues.push(
        issue("error", "change.superseded-self-replacement", artifact.file, `Superseded change ${wrapper.tag} must reference a different replacement C-* bundle.`),
      );
    }
  }

  return result;
}

/** Validates a GraceChangeDesignContext artifact found inside a change bundle. */
export function validateChangeDesignContextArtifact(
  artifact: ParsedGraceXmlArtifact,
): ArtifactValidationResult {
  const root = artifact.root;
  const issues: Grace4Issue[] = [...artifact.issues];

  if (!root) {
    return { file: artifact.file, issues };
  }

  if (!COMPANION_ROOT_TAGS.has(root.tag)) {
    issues.push(issue("error", "design-context.invalid-root-tag", artifact.file, `Unsupported design context root tag '${root.tag}'. Expected GraceChangeDesignContext.`));
    return { file: artifact.file, rootTag: root.tag, issues };
  }

  if (!root.attributes.graceVersion) {
    issues.push(
      issue("error", "design-context.missing-grace-version", artifact.file, `GraceChangeDesignContext must declare graceVersion="${GRACE4_VERSION}".`),
    );
  } else if (root.attributes.graceVersion !== GRACE4_VERSION) {
    issues.push(
      issue("error", "design-context.unsupported-grace-version", artifact.file, `GraceChangeDesignContext declares unsupported graceVersion '${root.attributes.graceVersion}'. Expected '${GRACE4_VERSION}'.`),
    );
  }

  if (root.attributes.status) {
    issues.push(issue("error", "design-context.forbidden-status", artifact.file, "GraceChangeDesignContext must not declare a status attribute."));
  }

  for (const attribute of Object.keys(root.attributes)) {
    if (attribute !== "graceVersion" && attribute !== "status") {
      issues.push(issue("error", "design-context.forbidden-root-attribute", artifact.file, `${attribute} is not an allowed root attribute on GraceChangeDesignContext.`));
    }
  }

  issues.push(...validateSemanticAnchorDiscipline(artifact.file, root));

  const changeTextNodes = root.children.filter((child) => child.tag === "Change");
  const wrapperNodes = root.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  const identityCount = changeTextNodes.length + wrapperNodes.length;
  if (identityCount === 0) {
    issues.push(issue("error", "design-context.missing-change-id", artifact.file, "GraceChangeDesignContext must identify its bundle through one direct <Change>C-*</Change> or C-* wrapper."));
  } else if (identityCount > 1) {
    issues.push(issue("error", "design-context.ambiguous-change-id", artifact.file, "GraceChangeDesignContext must contain exactly one direct change identity declaration."));
  } else if (changeTextNodes.length === 1 && !ANCHOR_PATTERNS.change.test(changeTextNodes[0]!.text.trim())) {
    issues.push(issue("error", "design-context.invalid-change-id", artifact.file, "GraceChangeDesignContext <Change> must contain a canonical C-* identifier."));
  }

  return { file: artifact.file, rootTag: root.tag, graceVersion: root.attributes.graceVersion, issues };
}

/** Validates current-state .grace artifact grammar and lifecycle location invariants. */
export function validateGrace4Project(root: string): Grace4ValidationResult {
  const projectRoot = path.resolve(root);
  const projectKind = detectGraceProjectKind(projectRoot);
  const artifacts: ArtifactValidationResult[] = [];
  const issues: Grace4Issue[] = [];

  if (projectKind === "grace3") {
    issues.push(issue("error", "project.grace3-detected", projectRoot, formatGrace3MigrationGuidance(projectRoot)));
    return { root: projectRoot, issues, artifacts };
  }

  if (projectKind === "none") {
    issues.push(issue("error", "project.missing-grace", projectRoot, "No .grace directory found."));
    return { root: projectRoot, issues, artifacts };
  }

  const paths = resolveGrace4Paths(projectRoot);
  issues.push(...validateGrace4ProjectLayout(paths));
  artifacts.push(...validateContextArtifacts(paths));
  artifacts.push(...validateOptionalContextArtifacts(paths));
  artifacts.push(...validateRequiredArtifact(paths.graphIndex, "GraceGraphIndex"));
  artifacts.push(...validateXmlFilesInDirectory(paths.graphDir, [paths.graphIndex], "GraceGraphDocument"));
  artifacts.push(...validateRequiredArtifact(paths.verificationIndex, "GraceVerificationIndex"));
  artifacts.push(...validateXmlFilesInDirectory(paths.verificationDir, [paths.verificationIndex], "GraceVerificationDocument"));
  const knownChangeIds = collectChangeBundleIds(paths);
  artifacts.push(...validateChangeBundlesInDirectory(paths.changesActiveDir, "active", knownChangeIds, projectRoot));
  artifacts.push(...validateChangeBundlesInDirectory(paths.changesArchiveDir, "archive", knownChangeIds, projectRoot));

  return {
    root: projectRoot,
    artifacts,
    issues: [...issues, ...artifacts.flatMap((artifact) => artifact.issues)],
  };
}

function validateParsedArtifact(artifact: ParsedGraceXmlArtifact): ArtifactValidationResult {
  const result = validateArtifactRoot(artifact);
  if (artifact.root) {
    result.issues.push(...validateSemanticAnchorDiscipline(artifact.file, artifact.root));
  }
  return result;
}

function validateRequiredArtifact(file: string, expectedRootTag: string): ArtifactValidationResult[] {
  const artifact = readGraceXmlArtifact(file);
  const result = validateParsedArtifact(artifact);

  if (artifact.root && artifact.root.tag !== expectedRootTag) {
    result.issues.push(
      issue("error", "artifact.unexpected-root-tag", file, `${path.basename(file)} must use root tag ${expectedRootTag}.`),
    );
  }

  if (artifact.root?.tag === "GraceGraphIndex" && artifact.root.children.filter((child) => child.tag === "GraphDocuments").length !== 1) {
    result.issues.push(issue("error", "graph.index-invalid-documents-section", file, "GraceGraphIndex must contain exactly one direct GraphDocuments section."));
  }
  if (artifact.root?.tag === "GraceVerificationIndex" && artifact.root.children.filter((child) => child.tag === "VerificationDocuments").length !== 1) {
    result.issues.push(issue("error", "verification.index-invalid-documents-section", file, "GraceVerificationIndex must contain exactly one direct VerificationDocuments section."));
  }

  return [result];
}

function validateXmlFilesInDirectory(directory: string, excludedFiles: string[], expectedRootTag: "GraceGraphDocument" | "GraceVerificationDocument"): ArtifactValidationResult[] {
  if (!existsSync(directory)) {
    return [];
  }

  const excluded = new Set(excludedFiles.map((file) => path.resolve(file)));
  return listXmlFiles(directory)
    .filter((file) => !excluded.has(path.resolve(file)))
    .map((file) => {
      const artifact = readGraceXmlArtifact(file);
      const result = validateParsedArtifact(artifact);
      if (artifact.root && artifact.root.tag !== expectedRootTag) {
        result.issues.push(issue("error", "artifact.unexpected-root-tag", file, `${path.basename(file)} must use root tag ${expectedRootTag}.`));
        return result;
      }

      if (artifact.root) {
        const wrapperPattern = expectedRootTag === "GraceGraphDocument" ? ANCHOR_PATTERNS.graphDocument : ANCHOR_PATTERNS.verificationDocument;
        const wrappers = artifact.root.children.filter((child) => wrapperPattern.test(child.tag));
        if (wrappers.length !== 1) {
          result.issues.push(issue(
            "error",
            expectedRootTag === "GraceGraphDocument" ? "graph.invalid-document-wrapper" : "verification.invalid-document-wrapper",
            file,
            `${expectedRootTag} must contain exactly one direct ${expectedRootTag === "GraceGraphDocument" ? "GD-*" : "VD-*"} wrapper.`,
          ));
        }
      }
      return result;
    });
}

function validateChangeBundlesInDirectory(
  directory: string,
  location: "active" | "archive",
  knownChangeIds: ReadonlySet<string>,
  projectRoot?: string,
): ArtifactValidationResult[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: ArtifactValidationResult[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) {
      if (entry.isFile() && entry.name.endsWith(".xml")) {
        results.push({ file: entryPath, issues: [issue("error", "change.unexpected-file", entryPath, "Change XML artifacts must live inside a direct C-* bundle directory.")] });
      }
      continue;
    }

    const bundleId = entry.name;
    const bundleIssues: Grace4Issue[] = [];
    if (!ANCHOR_PATTERNS.change.test(bundleId)) {
      bundleIssues.push(issue("error", "change.invalid-bundle-id", entryPath, `Change bundle directory '${bundleId}' must use a C-* identifier.`));
    }

    const specFile = path.join(entryPath, "spec.xml");
    const planFile = path.join(entryPath, "plan.xml");
    const designFile = path.join(entryPath, "design-context.xml");
    const specArtifact = readGraceXmlArtifact(specFile);
    const specResult = validateChangeArtifact(specArtifact, location, projectRoot);
    validateReplacementTargetExists(specArtifact, knownChangeIds, specResult.issues);
    const specWrapper = directChangeWrapper(specArtifact.root);
    if (specWrapper && specWrapper.tag !== bundleId) {
      specResult.issues.push(issue("error", "change.bundle-id-mismatch", specFile, `spec.xml uses ${specWrapper.tag}, but its bundle directory is ${bundleId}.`));
    }
    results.push(specResult);

    let planArtifact: ParsedGraceXmlArtifact | null = null;
    if (existsSync(planFile)) {
      planArtifact = readGraceXmlArtifact(planFile);
      const planResult = validateChangeArtifact(planArtifact, location, projectRoot);
      validateReplacementTargetExists(planArtifact, knownChangeIds, planResult.issues);
      const planWrapper = directChangeWrapper(planArtifact.root);
      if (planWrapper && planWrapper.tag !== bundleId) {
        planResult.issues.push(issue("error", "change.bundle-id-mismatch", planFile, `plan.xml uses ${planWrapper.tag}, but its bundle directory is ${bundleId}.`));
      }
      if (specWrapper && planWrapper && specWrapper.tag !== planWrapper.tag) {
        planResult.issues.push(issue("error", "change.spec-plan-id-mismatch", planFile, `spec.xml uses ${specWrapper.tag}, but plan.xml uses ${planWrapper.tag}.`));
      }
      // Spec→plan coverage (G-05). Run for active and archive: historical bundles that
      // already match stay quiet; mismatches surface so archives remain truthful.
      // Safeguard 5 decided by fixture audit: well-formed archives stay quiet; no active-only gate.
      for (const coverageIssue of validateSpecPlanCoverage(specArtifact, planArtifact, specFile, planFile)) {
        if (coverageIssue.file === specFile) {
          specResult.issues.push(coverageIssue);
        } else {
          planResult.issues.push(coverageIssue);
        }
      }
      results.push(planResult);
    }

    const specStatus = specArtifact.root?.attributes.status;
    const planStatus = planArtifact?.root?.attributes.status;
    if (location === "active" && planArtifact && specStatus !== "approved") {
      bundleIssues.push(issue("error", "change.plan-requires-approved-spec", entryPath, "An active plan may exist only beside an approved spec."));
    }
    if (location === "archive" && planArtifact && specStatus && planStatus && specStatus !== planStatus) {
      bundleIssues.push(issue("error", "change.archive-status-mismatch", entryPath, `Archived spec status '${specStatus}' must match plan status '${planStatus}'.`));
    }
    if (location === "archive" && specStatus === "applied" && (!planArtifact || planStatus !== "applied")) {
      bundleIssues.push(issue("error", "change.applied-plan-missing", entryPath, "An applied archived bundle requires an applied plan.xml."));
    }

    if (existsSync(designFile)) {
      const designArtifact = readGraceXmlArtifact(designFile);
      const designResult = validateChangeDesignContextArtifact(designArtifact);
      const designChange = designArtifact.root ? designContextChangeId(designArtifact.root) : undefined;
      if (designChange && designChange !== bundleId) {
        designResult.issues.push(issue("error", "design-context.bundle-id-mismatch", designFile, `design-context.xml references ${designChange}, but its bundle directory is ${bundleId}.`));
      }
      results.push(designResult);
    }

    for (const fileEntry of readdirSync(entryPath, { withFileTypes: true })) {
      if (fileEntry.isFile() && fileEntry.name.endsWith(".xml") && !["spec.xml", "plan.xml", "design-context.xml"].includes(fileEntry.name)) {
        const file = path.join(entryPath, fileEntry.name);
        bundleIssues.push(issue("error", "change.unexpected-file", file, `Unsupported XML artifact '${fileEntry.name}' in change bundle ${bundleId}.`));
      }
    }

    if (bundleIssues.length > 0) {
      results.push({ file: entryPath, issues: bundleIssues });
    }
  }
  return results;
}

function directChangeWrapper(root: GraceXmlNode | null): GraceXmlNode | undefined {
  return root?.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
}

function collectChangeBundleIds(paths: Grace4ProjectPaths): Set<string> {
  const ids = new Set<string>();
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ANCHOR_PATTERNS.change.test(entry.name)) ids.add(entry.name);
    }
  }
  return ids;
}

function replacementChangeIds(wrapper: GraceXmlNode): string[] {
  return [...new Set(wrapper.children.flatMap((child) => {
    if (ANCHOR_PATTERNS.change.test(child.tag)) return [child.tag];
    if ((child.tag === "Replacement" || child.tag === "ReplacementChange") && ANCHOR_PATTERNS.change.test(child.text.trim())) {
      return [child.text.trim()];
    }
    return [];
  }))];
}

function validateReplacementTargetExists(
  artifact: ParsedGraceXmlArtifact,
  knownChangeIds: ReadonlySet<string>,
  issues: Grace4Issue[],
): void {
  if (artifact.root?.attributes.status !== "superseded") return;
  const wrapper = directChangeWrapper(artifact.root);
  if (!wrapper) return;
  for (const replacement of replacementChangeIds(wrapper)) {
    if (replacement !== wrapper.tag && !knownChangeIds.has(replacement)) {
      issues.push(issue("error", "change.superseded-replacement-not-found", artifact.file, `Superseded change ${wrapper.tag} references missing replacement bundle ${replacement}.`));
    }
  }
}

function validateDirectSectionCardinality(
  file: string,
  parent: GraceXmlNode,
  sections: readonly string[],
  missingCode: string,
  duplicateCode: string,
  issues: Grace4Issue[],
): void {
  for (const section of sections) {
    const matches = parent.children.filter((child) => child.tag === section);
    if (matches.length === 0) {
      issues.push(issue("error", missingCode, file, `${parent.tag} is missing required direct section <${section}>.`));
    } else if (matches.length > 1) {
      issues.push(issue("error", duplicateCode, file, `${parent.tag} contains duplicate direct <${section}> sections.`));
    }
  }
}

function validateImplementationTasks(file: string, wrapper: GraceXmlNode, issues: Grace4Issue[]): void {
  const implementationPlan = wrapper.children.find((child) => child.tag === "ImplementationPlan");
  if (!implementationPlan) {
    return;
  }

  const tasks = implementationPlan.children.filter((child) => ANCHOR_PATTERNS.task.test(child.tag));
  if (tasks.length === 0) {
    issues.push(issue("error", "change.plan-missing-task", file, "ImplementationPlan must contain at least one direct T-* task."));
    return;
  }

  validateTaskDependencyGraph(file, tasks, issues);
}

function validateMeaningfulRequiredSections(
  file: string,
  parent: GraceXmlNode,
  sections: readonly string[],
  issues: Grace4Issue[],
): void {
  for (const section of sections) {
    for (const node of parent.children.filter((child) => child.tag === section)) {
      validateMeaningfulSection(file, node, issues);
    }
  }
}

function validateStructuredPlanSections(file: string, wrapper: GraceXmlNode, issues: Grace4Issue[]): void {
  for (const sectionName of ["BaselineAssertions", "TargetAssertions"] as const) {
    for (const section of wrapper.children.filter((child) => child.tag === sectionName)) {
      if (section.text.trim() || Object.keys(section.attributes).length > 0) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<${sectionName}> must contain only approved assertion elements.`));
      }
      const approvedChildren = section.children.filter((child) => ASSERTION_SECTION_TAGS.has(child.tag));
      for (const child of section.children) {
        if (!ASSERTION_SECTION_TAGS.has(child.tag)) {
          issues.push(issue("error", "change.plan-invalid-section-shape", file, `<${sectionName}> does not allow child <${child.tag}>.`));
        }
      }
      if (approvedChildren.length === 0) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<${sectionName}> must contain at least one approved assertion element.`));
      }
    }
  }

  for (const section of wrapper.children.filter((child) => child.tag === "DurableScope")) {
    if (section.text.trim() || Object.keys(section.attributes).length > 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<DurableScope> must contain only supported durable scope elements."));
    }
    const supported = section.children.filter((child) => isSupportedDurableScopeChild(child.tag));
    for (const child of section.children) {
      if (!isSupportedDurableScopeChild(child.tag)) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<DurableScope> does not allow child <${child.tag}>.`));
      }
    }
    if (supported.length === 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<DurableScope> must declare supported scope entries or <None />."));
    }
  }

  for (const section of wrapper.children.filter((child) => child.tag === "ObservedWriteScope")) {
    if (section.text.trim() || Object.keys(section.attributes).length > 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<ObservedWriteScope> must contain only File, Path, Glob, or None elements."));
    }
    const supported = section.children.filter((child) => OBSERVED_SCOPE_DIRECT_TAGS.has(child.tag));
    for (const child of section.children) {
      if (!OBSERVED_SCOPE_DIRECT_TAGS.has(child.tag)) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<ObservedWriteScope> does not allow child <${child.tag}>.`));
      }
    }
    if (supported.length === 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<ObservedWriteScope> must declare File/Path/Glob entries or <None />."));
    }
  }

  for (const section of wrapper.children.filter((child) => child.tag === "OutOfPlanScope")) {
    validateOutOfPlanScopeSection(file, section, issues);
  }
}

function validateOutOfPlanScopeSection(file: string, section: GraceXmlNode, issues: Grace4Issue[]): void {
  for (const child of section.children) {
    const isModuleOrFlow = ANCHOR_PATTERNS.module.test(child.tag) || ANCHOR_PATTERNS.dataFlow.test(child.tag);
    if (!isModuleOrFlow) {
      issues.push(
        issue(
          "error",
          "change.plan-invalid-section-shape",
          file,
          `<OutOfPlanScope> does not allow child <${child.tag}>; declare M-* or DF-* anchors with a non-empty <Reason>.`,
        ),
      );
      continue;
    }
    const reason = child.children.find((node) => node.tag === "Reason");
    if (!reason || !reason.text.trim()) {
      issues.push(
        issue(
          "error",
          "change.out-of-plan-scope-missing-reason",
          file,
          `<OutOfPlanScope> entry <${child.tag}> requires a non-empty <Reason>.`,
        ),
      );
    }
  }
}

function validateSpecAcceptanceCriteria(file: string, wrapper: GraceXmlNode, issues: Grace4Issue[]): void {
  for (const section of wrapper.children.filter((child) => child.tag === "AcceptanceCriteria")) {
    const seen = new Set<string>();
    for (const node of walkNodes(section)) {
      if (node === section || !ANCHOR_PATTERNS.acceptanceCriterion.test(node.tag)) {
        continue;
      }
      if (seen.has(node.tag)) {
        issues.push(
          issue(
            "error",
            "change.duplicate-acceptance-criterion",
            file,
            `AcceptanceCriteria declares duplicate acceptance criterion ${node.tag}.`,
          ),
        );
      } else {
        seen.add(node.tag);
      }
      // Descendant text counts, matching validateMeaningfulSection: <AC-X><Detail>…</Detail></AC-X>
      // states a criterion just as well as direct text does.
      const hasText = [...walkNodes(node)].some((descendant) => descendant.text.trim().length > 0);
      if (!hasText) {
        issues.push(
          issue(
            "error",
            "change.empty-acceptance-criterion",
            file,
            `Acceptance criterion ${node.tag} must contain non-empty text.`,
          ),
        );
      }
    }
  }
}

const DESIGN_REFERENCE_CHILD_TAGS = new Set(["Figma", "UserResearch"]);

/**
 * Optional DesignReferences under a GraceChangeSpec (G-18).
 * Zero-or-more children: shape must be explicit (defect 14 / Satisfies lesson).
 * Figma urls must be well-formed http(s); UserResearch paths must stay inside the project.
 */
function validateSpecDesignReferences(
  file: string,
  wrapper: GraceXmlNode,
  projectRoot: string | undefined,
  issues: Grace4Issue[],
): void {
  for (const section of wrapper.children.filter((child) => child.tag === "DesignReferences")) {
    for (const child of section.children) {
      if (!DESIGN_REFERENCE_CHILD_TAGS.has(child.tag)) {
        issues.push(
          issue(
            "error",
            "change.invalid-design-reference-child",
            file,
            `<DesignReferences> does not allow child <${child.tag}>; declare <Figma url="..."> or <UserResearch>path</UserResearch>.`,
          ),
        );
        continue;
      }

      if (child.tag === "Figma") {
        const url = (child.attributes.url ?? "").trim();
        if (!url) {
          issues.push(
            issue(
              "error",
              "change.invalid-figma-url",
              file,
              `<Figma> requires a non-empty url attribute with an http(s) URL.`,
            ),
          );
          continue;
        }
        if (!isHttpOrHttpsUrl(url)) {
          issues.push(
            issue(
              "error",
              "change.invalid-figma-url",
              file,
              `Figma url ${JSON.stringify(url)} must be a well-formed http or https URL.`,
            ),
          );
        }
        continue;
      }

      // UserResearch
      const authored = child.text.trim();
      if (!authored) {
        issues.push(
          issue(
            "error",
            "change.user-research-path-invalid",
            file,
            `<UserResearch> requires a non-empty project-relative path.`,
          ),
        );
        continue;
      }
      if (!projectRoot) {
        // validateChangeArtifact is exported with an optional root, so a caller that omits
        // it must not silently disable the escape check. Fall back to a lexical rejection
        // of the shapes that can leave the project; full resolution needs the real root.
        const normalized = authored.replaceAll("\\", "/");
        if (path.isAbsolute(authored) || normalized.split("/").includes("..")) {
          issues.push(
            issue(
              "error",
              "change.user-research-path-invalid",
              file,
              `UserResearch path ${JSON.stringify(authored)} must be a project-relative path without "..".`,
            ),
          );
        }
        continue;
      }
      try {
        resolveContainedProjectPath(projectRoot, authored, { mode: "output" });
      } catch (error) {
        const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
        issues.push(
          issue(
            "error",
            "change.user-research-path-invalid",
            file,
            `UserResearch path ${JSON.stringify(authored)} is not a contained project path: ${detail}`,
          ),
        );
      }
    }
  }
}

/** True when value is an absolute http: or https: URL (rejects relative, javascript:, data:, ftp:). */
function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates that an approved plan's DurableScope covers the authorizing spec's
 * AffectedAreas, and that AC-* acceptance criteria map to task Satisfies when present.
 * Additive: legacy free-text AcceptanceCriteria without AC-* skips unmapped warnings.
 */
export function validateSpecPlanCoverage(
  specArtifact: ParsedGraceXmlArtifact,
  planArtifact: ParsedGraceXmlArtifact,
  specFile: string,
  planFile: string,
): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  if (!specArtifact.root || !planArtifact.root) {
    return issues;
  }

  // A superseded bundle is history: the plan diverged from the spec, which is why it
  // was abandoned. Re-litigating that divergence now would tighten the past retroactively.
  if (specArtifact.root.attributes.status === "superseded" || planArtifact.root.attributes.status === "superseded") {
    return issues;
  }

  const specWrapper = directChangeWrapper(specArtifact.root);
  const planWrapper = directChangeWrapper(planArtifact.root);
  if (!specWrapper || !planWrapper) {
    return issues;
  }

  const specAnchors = collectModuleAndFlowAnchorsUnder(specWrapper, "AffectedAreas");
  const planDurable = collectDurableScopeAnchors(planWrapper);
  const justified = collectJustifiedOutOfPlanAnchors(planWrapper);

  for (const anchor of specAnchors) {
    const covered =
      planDurable.has(anchor)
      || planDurable.has(`V-${anchor}`)
      || justified.has(anchor);
    if (!covered) {
      issues.push(
        issue(
          "error",
          "change.scope-does-not-cover-spec",
          planFile,
          `Spec AffectedAreas names ${anchor}, but the plan's DurableScope does not include it and it is not justified under OutOfPlanScope.`,
        ),
      );
    }
  }

  // Legacy specs describe AffectedAreas in prose, so there is nothing to exceed. Warning on
  // every plan anchor there would punish well-anchored plans for the spec's authoring style.
  // Same backward-compatibility instinct as the AC-* mapping skip below.
  for (const anchor of specAnchors.size === 0 ? [] : planDurable) {
    if (!isModuleOrFlowOrVerification(anchor)) {
      continue;
    }
    const base = anchor.startsWith("V-") ? anchor.slice(2) : anchor;
    if (!isModuleOrFlowAnchor(base)) {
      continue;
    }
    if (!specAnchors.has(base)) {
      issues.push(
        issue(
          "warning",
          "change.plan-scope-exceeds-spec",
          planFile,
          `Plan DurableScope includes ${anchor}, which the approved spec never mentions.`,
        ),
      );
    }
  }

  const specCriteria = collectAcceptanceCriteriaIds(specWrapper);
  const satisfied = collectSatisfiedAcceptanceCriteria(planWrapper);

  // Unmapped warnings only when the spec authored AC-* (legacy free-text stays quiet).
  if (specCriteria.size > 0) {
    for (const id of specCriteria) {
      if (!satisfied.has(id)) {
        issues.push(
          issue(
            "warning",
            "change.acceptance-criterion-unmapped",
            specFile,
            `${id} is not referenced by any task's Satisfies element.`,
          ),
        );
      }
    }
  }

  // Unknown Satisfies targets always error — referencing a non-existent AC-* is never valid.
  for (const id of satisfied) {
    if (!specCriteria.has(id)) {
      issues.push(
        issue(
          "error",
          "change.unknown-acceptance-criterion",
          planFile,
          `Plan references ${id}, which the approved spec does not define.`,
        ),
      );
    }
  }

  return issues;
}

function collectModuleAndFlowAnchorsUnder(wrapper: GraceXmlNode, sectionTag: string): Set<string> {
  const anchors = new Set<string>();
  for (const section of wrapper.children.filter((child) => child.tag === sectionTag)) {
    for (const node of walkNodes(section)) {
      if (node !== section && isModuleOrFlowAnchor(node.tag)) {
        anchors.add(node.tag);
      }
    }
  }
  return anchors;
}

function collectDurableScopeAnchors(wrapper: GraceXmlNode): Set<string> {
  const anchors = new Set<string>();
  for (const section of wrapper.children.filter((child) => child.tag === "DurableScope")) {
    for (const node of walkNodes(section)) {
      if (node === section) continue;
      if (isModuleOrFlowOrVerification(node.tag)) {
        anchors.add(node.tag);
      }
    }
  }
  return anchors;
}

function collectJustifiedOutOfPlanAnchors(wrapper: GraceXmlNode): Set<string> {
  const anchors = new Set<string>();
  for (const section of wrapper.children.filter((child) => child.tag === "OutOfPlanScope")) {
    for (const child of section.children) {
      if (!isModuleOrFlowAnchor(child.tag)) continue;
      const reason = child.children.find((node) => node.tag === "Reason");
      if (reason && reason.text.trim()) {
        anchors.add(child.tag);
      }
    }
  }
  return anchors;
}

function collectAcceptanceCriteriaIds(wrapper: GraceXmlNode): Set<string> {
  const ids = new Set<string>();
  for (const section of wrapper.children.filter((child) => child.tag === "AcceptanceCriteria")) {
    for (const node of walkNodes(section)) {
      if (node !== section && ANCHOR_PATTERNS.acceptanceCriterion.test(node.tag)) {
        ids.add(node.tag);
      }
    }
  }
  return ids;
}

function collectSatisfiedAcceptanceCriteria(wrapper: GraceXmlNode): Set<string> {
  const ids = new Set<string>();
  const implementationPlan = wrapper.children.find((child) => child.tag === "ImplementationPlan");
  if (!implementationPlan) {
    return ids;
  }
  for (const task of implementationPlan.children.filter((child) => ANCHOR_PATTERNS.task.test(child.tag))) {
    for (const satisfies of task.children.filter((child) => child.tag === "Satisfies")) {
      for (const node of walkNodes(satisfies)) {
        if (node !== satisfies && ANCHOR_PATTERNS.acceptanceCriterion.test(node.tag)) {
          ids.add(node.tag);
        }
      }
    }
  }
  return ids;
}

/**
 * Anchor families a plan's DurableScope is expected to cover. IC-* belongs here: it is a
 * first-class graph anchor that participates in DurableScope, drift routing and dangling-link
 * validation, so leaving it out would exempt the newest cross-service family from G-05.
 */
function isModuleOrFlowAnchor(tag: string): boolean {
  return (
    ANCHOR_PATTERNS.module.test(tag)
    || ANCHOR_PATTERNS.dataFlow.test(tag)
    || ANCHOR_PATTERNS.interfaceContract.test(tag)
  );
}

function isModuleOrFlowOrVerification(tag: string): boolean {
  return isModuleOrFlowAnchor(tag) || ANCHOR_PATTERNS.verification.test(tag);
}

function isSupportedDurableScopeChild(tag: string): boolean {
  return DURABLE_SCOPE_DIRECT_TAGS.has(tag)
    || ANCHOR_PATTERNS.module.test(tag)
    || ANCHOR_PATTERNS.dataFlow.test(tag)
    || ANCHOR_PATTERNS.verification.test(tag)
    || ANCHOR_PATTERNS.graphDocument.test(tag)
    || ANCHOR_PATTERNS.verificationDocument.test(tag);
}

function validateMeaningfulSection(file: string, section: GraceXmlNode, issues: Grace4Issue[]): void {
  const meaningful = [...walkNodes(section)].some((node) => {
    if ((section.tag === "DurableScope" || section.tag === "ObservedWriteScope") && node !== section && node.tag === "None") {
      return true;
    }
    if (node !== section && classifySemanticAnchorTag(node.tag).kind === "canonical") {
      return true;
    }
    return node.text.trim().length > 0;
  });
  if (!meaningful) {
    issues.push(issue("error", "change.empty-section", file, `<${section.tag}> must contain meaningful content.`));
  }
}

function validatePlanTask(file: string, task: GraceXmlNode, issues: Grace4Issue[]): string[] {
  validateDirectSectionCardinality(
    file,
    task,
    TASK_REQUIRED_SECTIONS,
    "change.task-missing-section",
    "change.task-duplicate-section",
    issues,
  );

  const title = task.children.find((child) => child.tag === "Title");
  if (title && !title.text.trim()) {
    issues.push(issue("error", "change.task-empty-title", file, `${task.tag} must contain a non-empty Title.`));
  }

  const acceptance = task.children.find((child) => child.tag === "AcceptanceCriteria");
  if (acceptance) {
    const criteria = acceptance.children.filter((child) => child.tag === "Criterion" && child.text.trim());
    if (criteria.length === 0) {
      issues.push(issue("error", "change.task-empty-acceptance", file, `${task.tag} must contain at least one non-empty acceptance Criterion.`));
    }
  }

  const verification = task.children.find((child) => child.tag === "Verification");
  if (verification) {
    const commands = verification.children.filter((child) => child.tag === "Command" && child.text.trim());
    if (commands.length === 0) {
      issues.push(issue("error", "change.task-empty-verification", file, `${task.tag} must contain at least one non-empty verification Command.`));
    }
  }

  // <Satisfies> is optional, but a child that is not an AC-* anchor is silently dropped by
  // coverage collection — the author believes a criterion is mapped when it is not, and the
  // only symptom is an unmapped warning pointing at the spec instead of the typo in the plan.
  for (const satisfies of task.children.filter((child) => child.tag === "Satisfies")) {
    for (const child of satisfies.children) {
      if (child.tag === "None" || ANCHOR_PATTERNS.acceptanceCriterion.test(child.tag)) {
        continue;
      }
      issues.push(
        issue(
          "error",
          "change.plan-invalid-section-shape",
          file,
          `<Satisfies> does not allow child <${child.tag}>; reference canonical AC-* acceptance criteria.`,
        ),
      );
    }
  }

  const dependsOn = task.children.find((child) => child.tag === "DependsOn");
  if (!dependsOn) {
    return [];
  }

  const dependencyValues = [
    ...(dependsOn.text.trim() ? [dependsOn.text.trim()] : []),
    ...dependsOn.children.map((child) => child.text.trim()).filter(Boolean),
  ];
  const dependencies: string[] = [];
  const seen = new Set<string>();
  for (const dependency of dependencyValues) {
    if (!ANCHOR_PATTERNS.task.test(dependency)) {
      issues.push(issue("error", "change.task-invalid-dependency", file, `${task.tag} dependency '${dependency}' must be a canonical T-NNN identifier.`));
      continue;
    }
    if (seen.has(dependency)) {
      issues.push(issue("error", "change.task-duplicate-dependency", file, `${task.tag} repeats dependency ${dependency}.`));
      continue;
    }
    seen.add(dependency);
    dependencies.push(dependency);
  }
  return dependencies;
}

function validateTaskDependencyGraph(file: string, tasks: GraceXmlNode[], issues: Grace4Issue[]): void {
  const taskIds = new Set<string>();
  const dependencies = new Map<string, string[]>();

  for (const task of tasks) {
    if (taskIds.has(task.tag)) {
      issues.push(issue("error", "change.duplicate-task-id", file, `ImplementationPlan contains duplicate task id ${task.tag}.`));
    } else {
      taskIds.add(task.tag);
    }
    if (!dependencies.has(task.tag)) {
      dependencies.set(task.tag, validatePlanTask(file, task, issues));
    } else {
      validatePlanTask(file, task, issues);
    }
  }

  for (const [taskId, taskDependencies] of dependencies) {
    for (const dependency of taskDependencies) {
      if (dependency === taskId) {
        issues.push(issue("error", "change.task-self-dependency", file, `${taskId} cannot depend on itself.`));
      } else if (!taskIds.has(dependency)) {
        issues.push(issue("error", "change.task-unknown-dependency", file, `${taskId} depends on unknown task ${dependency}.`));
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const cyclicTasks = new Set<string>();
  const visit = (taskId: string, stack: string[]): void => {
    if (state.get(taskId) === "visited") {
      return;
    }
    if (state.get(taskId) === "visiting") {
      for (const cyclicTask of stack.slice(stack.indexOf(taskId))) {
        cyclicTasks.add(cyclicTask);
      }
      return;
    }
    state.set(taskId, "visiting");
    for (const dependency of dependencies.get(taskId) ?? []) {
      if (taskIds.has(dependency) && dependency !== taskId) {
        visit(dependency, [...stack, dependency]);
      }
    }
    state.set(taskId, "visited");
  };

  for (const taskId of taskIds) {
    visit(taskId, [taskId]);
  }
  if (cyclicTasks.size > 0) {
    issues.push(issue("error", "change.task-dependency-cycle", file, `ImplementationPlan contains a dependency cycle involving ${[...cyclicTasks].sort().join(", ")}.`));
  }
}

function listXmlFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listXmlFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".xml")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function validateChangeStatusAttribute(file: string, root: GraceXmlNode, issues: Grace4Issue[]) {
  const status = root.attributes.status;
  if (!status) {
    issues.push(issue("error", "change.missing-status", file, `${root.tag} must declare a lifecycle status.`));
    return;
  }

  if (!VALID_CHANGE_STATUSES.has(status)) {
    issues.push(issue("error", "change.invalid-status", file, `${root.tag} declares unsupported status '${status}'.`));
  }
}

function validateOptionalContextApplicability(file: string, root: GraceXmlNode): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  const applicabilityNodes = root.children.filter((child) => child.tag === "Applicability");
  if (applicabilityNodes.length === 0) {
    return [issue("error", "context.applicability-missing", file, `${root.tag} must declare exactly one direct <Applicability> value.`)];
  }
  if (applicabilityNodes.length > 1) {
    issues.push(issue("error", "context.applicability-duplicate", file, `${root.tag} must not repeat its direct <Applicability> value.`));
  }

  const applicability = applicabilityNodes[0]?.text.trim().toLowerCase() ?? "";
  if (applicability !== "applicable" && applicability !== "not-applicable") {
    issues.push(issue("error", "context.applicability-invalid", file, `${root.tag} Applicability must be 'applicable' or 'not-applicable'.`));
    return issues;
  }
  if (applicability !== "not-applicable") {
    return issues;
  }

  const reason = (childText(root, "Reason") ?? childText(root, "NotApplicableReason") ?? childText(root, "Rationale") ?? "").trim();
  if (reason.length === 0) {
    issues.push(issue("error", "context.not-applicable-reason-missing", file, `${root.tag} marked not-applicable requires a reason.`));
    return issues;
  }

  if (
    root.tag === "GraceUXGuidelines"
    && /^(?:this project is\s+)?(?:not a web app|not web|no web ui|no ui|no frontend)[.!]?$/i.test(reason)
  ) {
    issues.push(issue("error", "context.ux-not-applicable-reason-insufficient", file, "UX applies to CLI, API, documentation, operator, and agent interactions; lack of a web UI alone is not a sufficient reason."));
  }

  return issues;
}

function validateContextContent(file: string, root: GraceXmlNode): Grace4Issue[] {
  const meaningful = [...walkNodes(root)].some((node) => node !== root && node.text.trim().length > 0);
  return meaningful
    ? []
    : [issue("error", "context.empty-artifact", file, `${root.tag} must contain meaningful project context.`)];
}

/**
 * Optional multi-stack form under GraceTechnology.
 * Flat Language/Runtime/Framework/TestingStack remains valid without Stacks.
 * When Stacks is present, each Stack-* requires a contained existing <Root>.
 * Non-anchor children of Stacks are rejected (zero-or-more list — shape check explicit; defect 14).
 */
function validateTechnologyStacks(file: string, root: GraceXmlNode, projectRoot: string): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  const stacksSections = root.children.filter((child) => child.tag === "Stacks");
  if (stacksSections.length === 0) {
    return issues;
  }
  if (stacksSections.length > 1) {
    issues.push(issue("error", "context.technology.duplicate-stacks", file, "GraceTechnology may contain at most one <Stacks> section."));
  }

  const seenStacks = new Set<string>();
  for (const stacks of stacksSections) {
    for (const child of stacks.children) {
      if (!ANCHOR_PATTERNS.technologyStack.test(child.tag)) {
        issues.push(
          issue(
            "error",
            "context.technology.invalid-stack",
            file,
            `<Stacks> does not allow child <${child.tag}>; declare Stack-* anchors (e.g. Stack-WEB).`,
          ),
        );
        continue;
      }
      if (seenStacks.has(child.tag)) {
        issues.push(issue("error", "context.technology.duplicate-stack", file, `${child.tag} is declared more than once.`));
      } else {
        seenStacks.add(child.tag);
      }

      const roots = child.children.filter((node) => node.tag === "Root");
      if (roots.length !== 1) {
        issues.push(
          issue(
            "error",
            "context.technology.stack-missing-root",
            file,
            `${child.tag} requires exactly one <Root> path (found ${roots.length}).`,
          ),
        );
        continue;
      }
      const authored = roots[0]!.text.trim();
      if (!authored) {
        issues.push(issue("error", "context.technology.stack-missing-root", file, `${child.tag} <Root> must not be empty.`));
        continue;
      }
      try {
        const resolved = resolveContainedProjectPath(projectRoot, authored, { mode: "output" });
        if (!existsSync(resolved.absolutePath)) {
          issues.push(
            issue(
              "error",
              "context.technology.stack-root-missing",
              file,
              `${child.tag} Root ${JSON.stringify(authored)} does not exist inside the project.`,
            ),
          );
        }
      } catch (error) {
        const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
        issues.push(
          issue(
            "error",
            "context.technology.invalid-stack-root",
            file,
            `${child.tag} Root ${JSON.stringify(authored)} is not a contained project path: ${detail}`,
          ),
        );
      }
    }
  }

  return issues;
}

function designContextChangeId(root: GraceXmlNode): string | undefined {
  const changeTextNodes = root.children.filter((child) => child.tag === "Change");
  const wrapperNodes = root.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  if (changeTextNodes.length === 1 && wrapperNodes.length === 0) {
    const changeId = changeTextNodes[0]!.text.trim();
    return ANCHOR_PATTERNS.change.test(changeId) ? changeId : undefined;
  }
  if (changeTextNodes.length === 0 && wrapperNodes.length === 1) {
    return wrapperNodes[0]!.tag;
  }
  return undefined;
}

function findSemanticAnchorInAttribute(value: string): string | null {
  const candidates = value.split(/[^A-Za-z0-9-]+/).filter(Boolean);
  for (const candidate of candidates) {
    if (classifySemanticAnchorTag(candidate).kind !== "ordinary") {
      return candidate;
    }
  }
  return null;
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}

export { GRACE4_CONTEXT_ARTIFACTS, GRACE4_OPTIONAL_CONTEXT_ARTIFACTS };
