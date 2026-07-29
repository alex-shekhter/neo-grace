/** Supported GRACE artifact grammar version for this release. */
export const GRACE4_VERSION = "4.0" as const;

/**
 * Prefix for XML root tags on project artifacts.
 * Phase 1 centralizes the literal; Phase 3 renames the value.
 */
export const ARTIFACT_TAG_PREFIX = "Grace" as const;

/** Standard GRACE 4 root tags accepted by Artifact Grammar. */
export const GRACE4_ROOT_TAGS = [
  `${ARTIFACT_TAG_PREFIX}Requirements`,
  `${ARTIFACT_TAG_PREFIX}Technology`,
  `${ARTIFACT_TAG_PREFIX}Principles`,
  `${ARTIFACT_TAG_PREFIX}Deployment`,
  `${ARTIFACT_TAG_PREFIX}UXGuidelines`,
  `${ARTIFACT_TAG_PREFIX}DesignSystem`,
  `${ARTIFACT_TAG_PREFIX}Invariants`,
  `${ARTIFACT_TAG_PREFIX}GraphIndex`,
  `${ARTIFACT_TAG_PREFIX}GraphDocument`,
  `${ARTIFACT_TAG_PREFIX}VerificationIndex`,
  `${ARTIFACT_TAG_PREFIX}VerificationDocument`,
  `${ARTIFACT_TAG_PREFIX}ChangeSpec`,
  `${ARTIFACT_TAG_PREFIX}ChangePlan`,
] as const;

/** Change-bundle companion root tags (valid only inside change bundles). */
export const GRACE4_CHANGE_COMPANION_TAGS = [
  `${ARTIFACT_TAG_PREFIX}ChangeDesignContext`,
] as const;

export type Grace4RootTag = (typeof GRACE4_ROOT_TAGS)[number];
export type Grace4ChangeCompanionTag = (typeof GRACE4_CHANGE_COMPANION_TAGS)[number];

/**
 * Prefix for marketplace skill identifiers printed as next-action guidance.
 * Phase 1 centralizes the literal; Phase 2 renames the value.
 */
export const SKILL_PREFIX = "ngrace" as const;

/** Marketplace skill id without the `$` display convention (`ngrace-init`). */
export const skillName = (suffix: string): string => `${SKILL_PREFIX}-${suffix}`;

/** Formats a skill reference as `$<prefix>-<suffix>` for CLI guidance strings. */
export const skillRef = (suffix: string): string => `$${skillName(suffix)}`;

/** Lifecycle statuses allowed on GraceChangeSpec and GraceChangePlan roots. */
export const CHANGE_STATUSES = ["draft", "approved", "applied", "rejected", "cancelled", "superseded"] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Statuses valid for bundles under .grace/changes/active. */
export const ACTIVE_CHANGE_STATUSES = new Set<ChangeStatus>(["draft", "approved"]);

/** Statuses valid for bundles under .grace/changes/archive. */
export const ARCHIVED_CHANGE_STATUSES = new Set<ChangeStatus>(["applied", "rejected", "cancelled", "superseded"]);

/** Mandatory GRACE 4 context artifact filenames. */
export const GRACE4_CONTEXT_ARTIFACTS = [
  "requirements.xml",
  "technology.xml",
  "principles.xml",
  "deployment.xml",
  "ux-guidelines.xml",
] as const;

/**
 * Optional context artifacts validated only when present.
 * Must never be merged into GRACE4_CONTEXT_ARTIFACTS — that would break every existing project.
 */
export const GRACE4_OPTIONAL_CONTEXT_ARTIFACTS = ["design-system.xml", "invariants.xml"] as const;

export type Grace4ContextArtifact = (typeof GRACE4_CONTEXT_ARTIFACTS)[number];
export type Grace4OptionalContextArtifact = (typeof GRACE4_OPTIONAL_CONTEXT_ARTIFACTS)[number];

/** Documented module <Type> values (knowledge-graph.md). Unknown values warn, never error. */
export const MODULE_TYPES = [
  "ENTRY_POINT",
  "UI_COMPONENT",
  "CORE_LOGIC",
  "DATA_LAYER",
  "INTEGRATION",
  "UTILITY",
] as const;

export type ModuleType = (typeof MODULE_TYPES)[number];

/** Semantic anchor regexes. Semantic anchors are tags and never attributes. */
export const ANCHOR_PATTERNS = {
  graphDocument: /^GD-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  verificationDocument: /^VD-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  change: /^C-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  module: /^M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  verification: /^V-M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  dataFlow: /^DF-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  interfaceContract: /^IC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  invariant: /^INV-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  task: /^T-[0-9]{3}$/,
  acceptanceCriterion: /^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  designToken: /^DT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  breakpoint: /^BP-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  uiState: /^ST-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  /** Technology stack ids under GraceTechnology/Stacks (e.g. Stack-WEB). */
  technologyStack: /^Stack-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
} as const;

/** Breaking-change policies allowed on IC-* interface contracts. */
export const INTERFACE_BREAKING_CHANGE_POLICIES = [
  "additive-only",
  "versioned",
  "breaking-allowed",
] as const;

export type InterfaceBreakingChangePolicy = (typeof INTERFACE_BREAKING_CHANGE_POLICIES)[number];

/** Approved hop properties on ordered DF-* steps. */
export const DATA_FLOW_STEP_PROPERTIES = [
  "idempotent",
  "transactional",
  "retryable",
  "authenticated",
] as const;

export type DataFlowStepProperty = (typeof DATA_FLOW_STEP_PROPERTIES)[number];

/** Canonical semantic-anchor family recognized by Artifact Grammar. */
export type SemanticAnchorFamily =
  | "graph-document"
  | "verification-document"
  | "change"
  | "module"
  | "verification"
  | "data-flow"
  | "interface-contract"
  | "invariant"
  | "task"
  | "acceptance-criterion"
  | "design-token"
  | "breakpoint"
  | "ui-state"
  | "technology-stack";

/** Result of classifying any XML tag that resembles a semantic anchor. */
export type SemanticAnchorClassification =
  | { kind: "canonical"; family: SemanticAnchorFamily }
  | { kind: "malformed"; family: SemanticAnchorFamily }
  | { kind: "ordinary" };

/** Current-state validation issue emitted by GRACE 4 validators. */
export type Grace4Issue = {
  severity: "error" | "warning";
  code: string;
  file: string;
  line?: number;
  message: string;
};

/** Resolved canonical .grace path set for one project root. */
export type Grace4ProjectPaths = {
  root: string;
  graceDir: string;
  contextDir: string;
  graphIndex: string;
  graphDir: string;
  verificationIndex: string;
  verificationDir: string;
  changesActiveDir: string;
  changesArchiveDir: string;
};

/** Kind of GRACE project detected at a filesystem root. */
export type GraceProjectKind = "grace4" | "grace3" | "none";
