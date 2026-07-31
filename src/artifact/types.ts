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
 * Known run-event kinds (Phase 4). Free strings are reported as ledger.unknown-event-kind
 * (warning) rather than silently accepted (A18.4 / A18.9).
 */
export const KNOWN_RUN_EVENT_KINDS = [
  "opened",
  "progress",
  "pause",
  "resume",
  "terminal",
  "attempt",
  "exhausted",
] as const;

export type KnownRunEventKind = (typeof KNOWN_RUN_EVENT_KINDS)[number];

export const KNOWN_RUN_EVENT_KIND_SET: ReadonlySet<string> = new Set(KNOWN_RUN_EVENT_KINDS);

/**
 * Kinds that terminate a used allocation range for fold membership and ledger density
 * (A18.8, A19.3). Widening this set is a detection-boundary change — both directions required.
 */
export const RANGE_TERMINATING_EVENT_KINDS: ReadonlySet<string> = new Set(["terminal", "exhausted"]);

/**
 * Fix attempts per task before escalation to paused-pending-approval.
 * Judgment, not derived (D9). Churn is recorded; calibration may revise later.
 */
export const FIX_BUDGET = 2;

/**
 * Typed field beyond id/task/kind on a run event. Single source for listLooseEvents,
 * buildEpochNode, and validateLedgerEpoch — add a field here only and it must survive a fold
 * (A18.7). write-evidence is content-sensitive digest recorded at attempt time (A19.1).
 */
export type RunEventFieldSpec = {
  /** XML attribute name on Event / NgraceRunEvent. */
  attribute: string;
  /** Event kinds that carry this field. */
  kinds: readonly string[];
  /** Required when the event kind matches (signature fields use contextual checks). */
  required?: boolean;
  /** Return an error message when invalid, or null when ok. */
  validate?: (value: string) => string | null;
};

/**
 * Registry of typed attempt (and future) event fields. Consumers must iterate this constant
 * rather than re-listing attribute names (A18.7, A5.4).
 */
export const RUN_EVENT_FIELD_REGISTRY: readonly RunEventFieldSpec[] = [
  {
    attribute: "outcome",
    kinds: ["attempt"],
    required: true,
    validate: (value) => (value === "pass" || value === "fail" ? null : `outcome must be pass|fail, got ${JSON.stringify(value)}`),
  },
  {
    attribute: "ordinal",
    kinds: ["attempt"],
    required: true,
    validate: (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 ? null : `ordinal must be an integer >= 1, got ${JSON.stringify(value)}`;
    },
  },
  {
    attribute: "signature-kind",
    kinds: ["attempt"],
  },
  {
    attribute: "signature-key",
    kinds: ["attempt"],
  },
  {
    // Content-sensitive digest over (path, content-hash) pairs at record time (A19.1).
    // Absent when unrecordable → flake classification unable-to-determine.
    attribute: "write-evidence",
    kinds: ["attempt"],
  },
];

/** Fields from the registry that apply to a given event kind. */
export function runEventFieldsForKind(kind: string): readonly RunEventFieldSpec[] {
  return RUN_EVENT_FIELD_REGISTRY.filter((field) => field.kinds.includes(kind));
}

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
