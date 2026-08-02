// START_MODULE_CONTRACT
//   PURPOSE: Shared artifact constants and path helpers
//   SCOPE: Root tags, companions, anchor patterns, ARTIFACT_DIR
//   DEPENDS: none
//   LINKS: M-ARTIFACT-TYPES
//   ROLE: TYPES
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ACTIVE_CHANGE_STATUSES
//   ANCHOR_PATTERNS
//   ARCHIVED_CHANGE_STATUSES
//   ARTIFACT_TAG_PREFIX
//   CHANGE_STATUSES
//   CLAIMED_CONFIDENCE_LEVELS
//   ChangeStatus
//   ClaimedConfidence
//   DATA_FLOW_STEP_PROPERTIES
//   DataFlowStepProperty
//   EPOCH_SECTION_PATTERN
//   FailureSignature
//   GraceProjectKind
//   INTERFACE_BREAKING_CHANGE_POLICIES
//   InterfaceBreakingChangePolicy
//   MODULE_TYPES
//   ModuleType
//   NGRACE_ARTIFACT_VERSION
//   NGRACE_CHANGE_BUNDLE_COMPANIONS
//   NGRACE_CHANGE_BUNDLE_XML_FILES
//   NGRACE_CHANGE_COMPANION_TAGS
//   NGRACE_CONTEXT_ARTIFACTS
//   NGRACE_OPTIONAL_CONTEXT_ARTIFACTS
//   NGRACE_ROOT_TAGS
//   NgraceChangeBundleCompanion
//   NgraceChangeCompanionTag
//   NgraceContextArtifact
//   NgraceIssue
//   NgraceOptionalContextArtifact
//   NgraceProjectPaths
//   NgraceRootTag
//   SKILL_PREFIX
//   SemanticAnchorClassification
//   SemanticAnchorFamily
//   VERIFICATION_ENTRY_EVIDENCE_TAGS
//   VERIFICATION_ENTRY_STRUCTURE_TAGS
//   VERIFICATION_THREADED_CHILD_TAGS
//   isRegisteredSemanticAnchor
//   parseClaimedConfidence
//   skillName
//   skillRef
// END_MODULE_MAP
/** Supported GRACE artifact grammar version for this release. */
export const NGRACE_ARTIFACT_VERSION = "1.0" as const;

/**
 * Prefix for XML root tags on project artifacts.
 * Phase 1 centralizes the literal; Phase 3 renames the value.
 */
export const ARTIFACT_TAG_PREFIX = "Ngrace" as const;

/** Standard neo-grace root tags accepted by Artifact Grammar. */
export const NGRACE_ROOT_TAGS = [
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

/**
 * Change-bundle companion files: one entry admits the file, its root tag, and
 * (via grammar.ts) the validator that makes the grammar load-bearing (A11.1).
 * Filename allowlist sites in grammar.ts all read this constant — half-registration
 * is structurally impossible.
 */
export const NGRACE_CHANGE_BUNDLE_COMPANIONS = [
  {
    filename: "design-context.xml",
    rootTag: `${ARTIFACT_TAG_PREFIX}ChangeDesignContext`,
  },
  {
    filename: "run-ledger.xml",
    rootTag: `${ARTIFACT_TAG_PREFIX}RunLedger`,
  },
  {
    filename: "run.xml",
    rootTag: `${ARTIFACT_TAG_PREFIX}RunCursor`,
  },
] as const;

/** Change-bundle companion root tags (valid only inside change bundles). */
export const NGRACE_CHANGE_COMPANION_TAGS = [
  `${ARTIFACT_TAG_PREFIX}ChangeDesignContext`,
  `${ARTIFACT_TAG_PREFIX}RunLedger`,
  `${ARTIFACT_TAG_PREFIX}RunCursor`,
] as const;

/** XML filenames admitted inside a C-* change bundle directory. */
export const NGRACE_CHANGE_BUNDLE_XML_FILES = new Set<string>([
  "spec.xml",
  "plan.xml",
  ...NGRACE_CHANGE_BUNDLE_COMPANIONS.map((companion) => companion.filename),
]);

export type NgraceRootTag = (typeof NGRACE_ROOT_TAGS)[number];
export type NgraceChangeCompanionTag = (typeof NGRACE_CHANGE_COMPANION_TAGS)[number];
export type NgraceChangeBundleCompanion = (typeof NGRACE_CHANGE_BUNDLE_COMPANIONS)[number];

/** Epoch section tags are structural sequencing, not a semantic anchor family (§3.4). */
export const EPOCH_SECTION_PATTERN = /^Epoch-([1-9][0-9]*)$/;

/**
 * Prefix for marketplace skill identifiers printed as next-action guidance.
 * Phase 1 centralizes the literal; Phase 2 renames the value.
 */
export const SKILL_PREFIX = "ngrace" as const;

/** Marketplace skill id without the `$` display convention (`ngrace-init`). */
export const skillName = (suffix: string): string => `${SKILL_PREFIX}-${suffix}`;

/** Formats a skill reference as `$<prefix>-<suffix>` for CLI guidance strings. */
export const skillRef = (suffix: string): string => `$${skillName(suffix)}`;

/** Lifecycle statuses allowed on NgraceChangeSpec and NgraceChangePlan roots. */
export const CHANGE_STATUSES = ["draft", "approved", "applied", "rejected", "cancelled", "superseded"] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Statuses valid for bundles under .ngrace/changes/active. */
export const ACTIVE_CHANGE_STATUSES = new Set<ChangeStatus>(["draft", "approved"]);

/** Statuses valid for bundles under .ngrace/changes/archive. */
export const ARCHIVED_CHANGE_STATUSES = new Set<ChangeStatus>(["applied", "rejected", "cancelled", "superseded"]);

/** Mandatory neo-grace context artifact filenames. */
export const NGRACE_CONTEXT_ARTIFACTS = [
  "requirements.xml",
  "technology.xml",
  "principles.xml",
  "deployment.xml",
  "ux-guidelines.xml",
] as const;

/**
 * Optional context artifacts validated only when present.
 * Must never be merged into NGRACE_CONTEXT_ARTIFACTS — that would break every existing project.
 */
export const NGRACE_OPTIONAL_CONTEXT_ARTIFACTS = ["design-system.xml", "invariants.xml"] as const;

export type NgraceContextArtifact = (typeof NGRACE_CONTEXT_ARTIFACTS)[number];
export type NgraceOptionalContextArtifact = (typeof NGRACE_OPTIONAL_CONTEXT_ARTIFACTS)[number];

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

/**
 * Agent-authored claimed confidence ordinal (D6 / Phase 9).
 * Three levels only — not free text, not a percentage. Write-only from the agent;
 * no gate may consume it. Distinct from language-analysis `exportConfidence` (precision).
 */
export const CLAIMED_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export type ClaimedConfidence = (typeof CLAIMED_CONFIDENCE_LEVELS)[number];

const CLAIMED_CONFIDENCE_SET = new Set<string>(CLAIMED_CONFIDENCE_LEVELS);

/** Parse a claimedConfidence token; rejects free text, percentages, and fourth levels. */
export function parseClaimedConfidence(
  raw: string | undefined | null,
): { ok: true; value: ClaimedConfidence } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return { ok: false, reason: "claimedConfidence is empty" };
  }
  const value = raw.trim();
  if (CLAIMED_CONFIDENCE_SET.has(value)) {
    return { ok: true, value: value as ClaimedConfidence };
  }
  return {
    ok: false,
    reason: `claimedConfidence must be one of ${CLAIMED_CONFIDENCE_LEVELS.join(" | ")}; got ${JSON.stringify(value)}`,
  };
}

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
  /** Technology stack ids under NgraceTechnology/Stacks (e.g. Stack-WEB). */
  technologyStack: /^Stack-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
} as const;

/** True when `value` matches any registered semantic-anchor family (not a disk path). */
export function isRegisteredSemanticAnchor(value: string): boolean {
  for (const pattern of Object.values(ANCHOR_PATTERNS)) {
    if (pattern.test(value)) return true;
  }
  return false;
}

/**
 * Evidence tags under V-M-* that projections collect and health/assertions consume
 * (`collectExactEvidence` in projections.ts). Single source for review.unthreaded-construct.
 */
export const VERIFICATION_ENTRY_EVIDENCE_TAGS = [
  "Command",
  "Scenario",
  "Marker",
  "TraceAssertion",
  "AccessibilityCheck",
  "VisualCheck",
] as const;

/** Structural / metadata children of V-M-* that are not free-form unthreaded constructs. */
export const VERIFICATION_ENTRY_STRUCTURE_TAGS = [
  "TestFile",
  "File",
  "Cwd",
  "Notes",
  "Description",
  "Expected",
  "Id",
  "Module",
] as const;

/** Union: children of V-M-* that review must not flag as unthreaded (corr 205-C). */
export const VERIFICATION_THREADED_CHILD_TAGS: ReadonlySet<string> = new Set([
  ...VERIFICATION_ENTRY_EVIDENCE_TAGS,
  ...VERIFICATION_ENTRY_STRUCTURE_TAGS,
]);

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

/** Current-state validation issue emitted by neo-grace validators. */
export type NgraceIssue = {
  severity: "error" | "warning";
  code: string;
  file: string;
  line?: number;
  message: string;
};

/** Resolved canonical .ngrace path set for one project root. */
export type NgraceProjectPaths = {
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

/**
 * Failure signature recorded on a failed attempt event (D6 / D9).
 * kind = category (test-failure, typecheck, lint); key = stable identity of what failed.
 */
export type FailureSignature = {
  kind: string;
  key: string;
};
