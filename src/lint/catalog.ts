import type { LintIssue } from "./types";

type LintIssueGuide = {
  code: string;
  title: string;
  explanation: string;
  remediation: string[];
};

const EXACT_GUIDES: Record<string, Omit<LintIssueGuide, "code">> = {
  "config.invalid-json": {
    title: "Invalid Lint Config JSON",
    explanation: "The repository-level .grace-lint.json file could not be parsed as JSON.",
    remediation: ["Fix the JSON syntax in .grace-lint.json.", "If the file is accidental, remove it."],
  },
  "config.invalid-shape": {
    title: "Invalid Lint Config Shape",
    explanation: ".grace-lint.json must be a JSON object.",
    remediation: ["Replace the file contents with a JSON object.", "Keep only supported keys like ignoredDirs."],
  },
  "config.unknown-key": {
    title: "Unknown Lint Config Key",
    explanation: ".grace-lint.json contains a key the CLI does not understand.",
    remediation: ["Remove unsupported keys from .grace-lint.json.", "Use only documented keys such as ignoredDirs and unverifiedLanguages."],
  },
  "config.invalid-unverified-languages": {
    title: "Invalid unverifiedLanguages Config",
    explanation: "`unverifiedLanguages` in .grace-lint.json must be an array of dot-prefixed file extensions.",
    remediation: ["Use the form [\".rs\", \".go\"].", "Remove the key to restore default reporting."],
  },
  "analysis.no-adapter": {
    title: "No Language Adapter For Governed File",
    explanation:
      "This governed file declares a MODULE_MAP that claims export or local parity, but GRACE has "
      + "no language adapter for its extension. The map is therefore unverified documentation, not an "
      + "enforced contract. GRACE reports this instead of passing silently.",
    remediation: [
      "Prefer MAP_MODE: SUMMARY for files whose exports GRACE cannot verify.",
      "Back the module with MustPassCommand evidence such as the language's own test and lint commands.",
      "Acknowledge the limitation deliberately with .grace-lint.json { \"unverifiedLanguages\": [\".ext\"] } "
        + "so the silence is a recorded decision rather than an accident.",
    ],
  },
  "markup.unknown-dependency": {
    title: "Unknown MODULE_CONTRACT DEPENDS Anchor",
    explanation:
      "DEPENDS lists an M-* module anchor that does not exist in the knowledge graph. "
      + "Non-anchor free-text dependency names are ignored; only M-* tokens are validated.",
    remediation: [
      "Add the missing module to .grace/graph or correct the DEPENDS list.",
      "Use free-text names (e.g. postgres) for external libraries — only M-* anchors are checked.",
    ],
  },
  "markup.unknown-link": {
    title: "Unknown MODULE_CONTRACT LINKS Anchor",
    explanation:
      "LINKS references an M-*, DF-*, or V-M-* anchor that does not exist in the graph or verification projection.",
    remediation: [
      "Link only anchors that exist under .grace/graph and .grace/verification.",
      "Add the missing module, data flow, or verification entry, or remove the stale link.",
    ],
  },
  "graph.module-without-linked-files": {
    title: "Graph Module Has No Linking Governed File",
    explanation:
      "A graph module declares a Path, but no governed source file lists that module in LINKS. "
      + "This is common while a module is planned but not yet implemented.",
    remediation: [
      "Add START_MODULE_CONTRACT with LINKS: M-* on the implementation file.",
      "Or remove the Path until the module is implemented, if the graph entry is only a placeholder.",
    ],
  },
  "analysis.adapter-failed": {
    title: "Language Adapter Failed",
    explanation: "The file-level export analysis adapter failed, so exact export/local parity could not be validated for this governed file.",
    remediation: ["Inspect the file for unusual syntax or unsupported language features.", "Simplify the export surface or improve the adapter if this language pattern should be supported."],
  },
  "analysis.runtime-missing": {
    title: "Language Runtime Missing",
    explanation: "The governed file uses a language adapter that requires its language runtime on PATH. GRACE fails closed instead of silently dropping export/local parity checks.",
    remediation: ["Install the runtime named in the issue message and ensure it is available on PATH.", "If the file should not be governed in this environment, exclude it explicitly rather than relying on incomplete analysis."],
  },
  "scope.durable-overlap": {
    title: "Durable Scope Overlap",
    explanation: "Two or more active change scopes claim overlapping durable regions, which creates a data-contention risk if executed in parallel.",
    remediation: ["Review the overlapping durable scopes and decide whether they must be sequential or whether the overlap is acceptable.", "Treat durable overlap as a planning warning, not a blocker."],
  },
  "scope.observed-write-overlap": {
    title: "Observed Write Overlap",
    explanation: "Two or more active change scopes write to overlapping regions, which can cause unsafe concurrent execution.",
    remediation: ["Do not run overlapping observed writes in parallel-safe mode.", "Sequence the changes or split scopes to eliminate the overlap."],
  },
  "change.superseded-missing-replacement": {
    title: "Superseded Change Missing Replacement Reference",
    explanation: "A GraceChangeSpec or GraceChangePlan with status='superseded' should name the replacement C-* anchor via a <Replacement> or <ReplacementChange> child tag.",
    remediation: ["Add a <Replacement>C-REPLACEMENT-ID</Replacement> child to the superseded wrapper.", "Or add a direct <C-REPLACEMENT-ID /> child tag as the replacement reference."],
  },
  "change.scope-does-not-cover-spec": {
    title: "Plan Scope Does Not Cover Spec AffectedAreas",
    explanation: "The plan's DurableScope omits a module or data-flow anchor that the authorizing GraceChangeSpec lists under AffectedAreas, and the omission is not justified under OutOfPlanScope.",
    remediation: [
      "Add the missing M-* or DF-* under DurableScope/GraphAnchors (or the matching V-M-* under DurableScope/VerificationAnchors).",
      "Or justify the exclusion with <OutOfPlanScope><M-ID><Reason>why this plan deliberately omits it</Reason></M-ID></OutOfPlanScope>.",
    ],
  },
  "change.plan-scope-exceeds-spec": {
    title: "Plan Scope Exceeds Spec AffectedAreas",
    explanation: "The plan's DurableScope includes a module or data-flow the approved GraceChangeSpec never named in AffectedAreas.",
    remediation: [
      "Add the anchor to the spec's AffectedAreas if the plan is correct, then re-approve.",
      "Or remove the extra anchor from DurableScope so the plan stays within the authorized surface.",
    ],
  },
  "change.acceptance-criterion-unmapped": {
    title: "Acceptance Criterion Not Mapped To A Task",
    explanation: "The spec declares an AC-* acceptance criterion that no task Satisfies element references.",
    remediation: [
      "Add <Satisfies><AC-ID /></Satisfies> under the task that implements the criterion.",
      "Or remove the unused AC-* from the spec's AcceptanceCriteria if it is no longer required.",
    ],
  },
  "change.unknown-acceptance-criterion": {
    title: "Plan References Unknown Acceptance Criterion",
    explanation: "A task Satisfies element references an AC-* id that the approved GraceChangeSpec does not define.",
    remediation: [
      "Define the criterion under the spec as <AcceptanceCriteria><AC-ID>text</AC-ID></AcceptanceCriteria>.",
      "Or remove the unknown AC-* from the task's <Satisfies> list.",
    ],
  },
  "change.duplicate-acceptance-criterion": {
    title: "Duplicate Acceptance Criterion Id",
    explanation: "The same AC-* tag appears more than once under AcceptanceCriteria in a single GraceChangeSpec.",
    remediation: ["Keep each AC-* id unique within the spec.", "Merge or rename the duplicate criterion."],
  },
  "change.empty-acceptance-criterion": {
    title: "Empty Acceptance Criterion",
    explanation: "An AC-* element under AcceptanceCriteria has no text content, so it cannot be evaluated.",
    remediation: ["Write a concrete, testable statement inside the AC-* element.", "Example: <AC-KEYBOARD-NAV>Arrow keys move focus between rows.</AC-KEYBOARD-NAV>."],
  },
  "change.out-of-plan-scope-missing-reason": {
    title: "OutOfPlanScope Entry Missing Reason",
    explanation: "An OutOfPlanScope escape hatch must record why the plan deliberately omits a spec AffectedAreas anchor; empty reasons are rejected so the hatch cannot become a silent opt-out.",
    remediation: [
      "Add a non-empty <Reason> under the justified anchor, e.g. <M-LEGACY><Reason>Deprecated; tracked in C-DROP-LEGACY.</Reason></M-LEGACY>.",
      "Or remove the OutOfPlanScope entry and cover the anchor in DurableScope instead.",
    ],
  },
  "assertion.phase-incompatible-command": {
    title: "Phase-Incompatible Assertion Command",
    explanation: "A target command assertion invokes current-mode lifecycle lint. Current mode evaluates active approved baselines, so it is a pre-implementation check and cannot serve as target or final evidence after writes begin.",
    remediation: ["Keep MustPassCommand entries as leaf project evidence such as tests, typecheck, build, format, or package checks.", "Run selected target or final GRACE lint as the outer execution gate instead of nesting it inside the plan."],
  },
  "assertion.invalid-pattern": {
    title: "Unsafe Or Invalid Assertion Pattern",
    explanation: "A MustMatchPattern or MustNotUseLiteral pattern was rejected: it was empty, too long, used nested unbounded quantifiers (catastrophic backtracking risk), or failed to compile. Artifact-authored patterns never accept flags.",
    remediation: [
      "Keep patterns under 200 characters and avoid nested forms such as (a+)+ or (a*)*.",
      "Use a simple literal or character-class pattern; do not embed /flags/ in the Pattern text.",
    ],
  },
  "graph.unknown-module-type": {
    title: "Unknown Module Type",
    explanation: "A graph module declares a <Type> value outside the documented set. GRACE warns rather than errors so free-text legacy types remain loadable.",
    remediation: [
      "Use ENTRY_POINT, UI_COMPONENT, CORE_LOGIC, DATA_LAYER, INTEGRATION, or UTILITY.",
      "Or keep a project-specific type deliberately and treat the warning as documentation drift.",
    ],
  },
  "health.ui-state-unverified": {
    title: "UI State Lacks Verification Evidence",
    explanation: "A UI_COMPONENT module declares an ST-* state that is not named by any Scenario, AccessibilityCheck, or VisualCheck under its V-M-* entry.",
    remediation: [
      "Add a Scenario/AccessibilityCheck/VisualCheck whose text mentions the state body (e.g. ERROR for ST-ERROR), case-insensitive with - as a word separator.",
      "Or remove the unused ST-* declaration from the module's <States>.",
    ],
  },
  "health.ui-states-undeclared": {
    title: "UI Component States Undeclared",
    explanation: "A UI_COMPONENT module has no <States> while UX guidelines are applicable, so UI interaction surfaces are untracked.",
    remediation: [
      "Declare ST-* states under the module (ST-DEFAULT, ST-EMPTY, ST-LOADING, ST-ERROR, …).",
      "Cover each declared state in V-M-* Scenario, AccessibilityCheck, or VisualCheck evidence.",
    ],
  },
  "design-system.duplicate-token": {
    title: "Duplicate Design Token",
    explanation: "The same DT-* id appears more than once in design-system.xml.",
    remediation: ["Keep each DT-* unique.", "Merge or rename the duplicate token."],
  },
  "design-system.duplicate-breakpoint": {
    title: "Duplicate Breakpoint",
    explanation: "The same BP-* id appears more than once in design-system.xml.",
    remediation: ["Keep each BP-* unique.", "Merge or rename the duplicate breakpoint."],
  },
  "design-system.empty-token-value": {
    title: "Empty Design Token Value",
    explanation: "A DT-* token is missing a non-empty <Value>.",
    remediation: ["Add <Value>var(--token)</Value> or the concrete token string the codebase must use."],
  },
  "design-system.breakpoint-missing-width": {
    title: "Breakpoint Missing Width Bounds",
    explanation: "A BP-* breakpoint declares neither MinWidth nor MaxWidth.",
    remediation: ["Add <MinWidth> and/or <MaxWidth> so the breakpoint is machine-checkable."],
  },
  "design-system.invalid-token-source": {
    title: "Invalid TokenSource Path",
    explanation: "TokenSource escaped the project root or is otherwise not a contained project path.",
    remediation: ["Use a project-relative path (no .., no absolute paths).", "Point TokenSource at a file inside the repository."],
  },
  "design-system.token-source-missing": {
    title: "TokenSource File Missing",
    explanation: "TokenSource names a project-relative path that does not exist on disk.",
    remediation: ["Create the token source file or correct the path."],
  },
  "design-system.empty-token-source": {
    title: "Empty TokenSource",
    explanation: "TokenSource is present but empty.",
    remediation: ["Provide a project-relative path to the design-token source file."],
  },
  "projection.graph.invalid-interface-contract": {
    title: "Invalid Interface Contract",
    explanation:
      "An IC-* interface contract is missing required fields, names a Schema outside the project, "
      + "uses a non-semver Version, an unknown BreakingChangePolicy, or references a missing Provider/Consumer module.",
    remediation: [
      "Provide Schema (project-relative path that exists), Version (semver), Provider (one M-*), Consumer M-*s, and BreakingChangePolicy (additive-only|versioned|breaking-allowed).",
      "List the IC-* under the owning GD-* in graph/index.xml Owns.",
    ],
  },
  "projection.graph.invalid-data-flow-step": {
    title: "Invalid Ordered Data-Flow Step",
    explanation:
      "A DF-* with <Step> children has a gap or duplicate order, names a missing M-*/IC-*, uses an unknown Property, or mixes ordered Steps with bare participant anchors.",
    remediation: [
      "Use contiguous order attributes starting at 1, exactly one M-* per Step, optional Contract IC-*, and Property in {idempotent, transactional, retryable, authenticated}.",
      "Keep the legacy flat participant form (bare M-* children, no Step) for unordered flows.",
    ],
  },
  "context.invariants.duplicate": {
    title: "Duplicate Invariant",
    explanation: "The same INV-* id appears more than once in invariants.xml.",
    remediation: ["Keep each INV-* unique.", "Merge or rename the duplicate invariant."],
  },
  "context.invariants.empty-statement": {
    title: "Empty Invariant Statement",
    explanation: "An INV-* is missing a non-empty <Statement>.",
    remediation: ["Write a concrete, testable invariant statement inside <Statement>."],
  },
  "context.invariants.invalid-applies-to": {
    title: "Invalid Invariant AppliesTo",
    explanation: "AppliesTo may only list M-* or DF-* anchors.",
    remediation: ["Replace the invalid child with an M-* or DF-* tag."],
  },
  "context.invariants.invalid-verification": {
    title: "Invalid Invariant Verification Ref",
    explanation: "Verification under an INV-* may only list V-M-* anchors.",
    remediation: ["Reference the matching V-M-* verification entry."],
  },
  "assertion.budget-no-match": {
    title: "Budget Metric Not Found In Command Output",
    explanation: "MustPassBudget ran the command successfully but Extract did not capture the Metric value from stdout.",
    remediation: [
      "Ensure the command prints the metric (e.g. p99=42) or supply a custom Extract regex with one capture group.",
      "Do not treat a missing metric as a pass — fix the command output or the Extract pattern.",
    ],
  },
  "assertion.budget-not-a-number": {
    title: "Budget Capture Is Not A Number",
    explanation: "MustPassBudget captured a value that could not be parsed as a finite number.",
    remediation: ["Print a numeric measurement for the metric.", "Adjust Extract so group 1 is the number only."],
  },
  "assertion.budget-command-failed": {
    title: "Budget Command Failed",
    explanation: "MustPassBudget could not measure a budget because the command exited non-zero.",
    remediation: ["Fix the command so it exits 0 and prints the metric.", "Run with --run-commands only when the harness is ready."],
  },
  "graph.document-too-large": {
    title: "Graph Document Too Large",
    explanation:
      "A GD-* graph document exceeds the configured anchor or byte limit. Large documents burn context when agents open them for one module question.",
    remediation: [
      "Split by service or package path with `grace graph split --by <path-prefix> --apply`.",
      "Raise limits only deliberately via .grace-lint.json documentAnchorLimit / documentByteLimit.",
    ],
  },
  "verification.document-too-large": {
    title: "Verification Document Too Large",
    explanation: "A VD-* verification document exceeds the configured anchor or byte limit.",
    remediation: [
      "Segment verification by service or module cluster into additional VD-* documents.",
      "Keep index Owns routes in sync after the split.",
    ],
  },
  "config.invalid-document-limit": {
    title: "Invalid Document Size Limit",
    explanation: "documentAnchorLimit and documentByteLimit must be positive integers.",
    remediation: ["Use whole numbers, e.g. { \"documentAnchorLimit\": 50, \"documentByteLimit\": 30720 }."],
  },
  "context.technology.invalid-stack": {
    title: "Invalid Technology Stack Child",
    explanation: "<Stacks> only allows Stack-* anchors; other children are rejected so typos cannot vanish silently.",
    remediation: ["Use <Stack-WEB>, <Stack-API>, … with a <Root> path each."],
  },
  "context.technology.stack-missing-root": {
    title: "Technology Stack Missing Root",
    explanation: "Each Stack-* requires exactly one non-empty <Root>.",
    remediation: ["Add <Root>apps/web</Root> (or the stack's package root)."],
  },
  "context.technology.stack-root-missing": {
    title: "Technology Stack Root Missing On Disk",
    explanation: "Stack Root must exist inside the project.",
    remediation: ["Create the directory or correct the path."],
  },
  "context.technology.invalid-stack-root": {
    title: "Technology Stack Root Escapes Project",
    explanation: "Stack Root must be a contained project-relative path.",
    remediation: ["Remove .. and absolute paths; point Root inside the repository."],
  },
  "context.technology.duplicate-stack": {
    title: "Duplicate Technology Stack",
    explanation: "The same Stack-* id appears more than once under Stacks.",
    remediation: ["Keep each Stack-* unique."],
  },
  "context.technology.duplicate-stacks": {
    title: "Duplicate Stacks Section",
    explanation: "GraceTechnology may contain at most one <Stacks> element.",
    remediation: ["Merge stack declarations under a single <Stacks>."],
  },
};

const PREFIX_GUIDES: Array<{ prefix: string; title: string; explanation: string; remediation: string[] }> = [
  {
    prefix: "project.",
    title: "GRACE 4 Project Detection Issue",
    explanation: "The CLI could not identify a valid GRACE 4 .grace project state, or it detected legacy GRACE 3 artifacts instead.",
    remediation: ["Run $grace-init for a new GRACE 4 project or $grace-migrate for legacy GRACE 3 projects.", "Do not rely on dual-mode docs/*.xml validation."],
  },
  {
    prefix: "artifact.",
    title: "GRACE 4 Artifact Grammar Issue",
    explanation: "A .grace XML artifact violates the GRACE 4 root, metadata, version, or semantic-anchor grammar.",
    remediation: ["Use approved GRACE 4 root tags with graceVersion=\"4.0\".", "Keep semantic anchors as XML tags, never attributes."],
  },
  {
    prefix: "change.",
    title: "GRACE 4 Change Lifecycle Issue",
    explanation: "A change spec or plan has an invalid status, wrapper shape, or active/archive location for the GRACE 4 lifecycle.",
    remediation: ["Keep draft and approved bundles under .grace/changes/active.", "Move applied, rejected, cancelled, or superseded bundles to archive with matching statuses."],
  },
  {
    prefix: "context.",
    title: "GRACE 4 Context Artifact Issue",
    explanation: "A required .grace/context artifact is missing, has the wrong root, or has invalid applicability metadata.",
    remediation: ["Create all five context artifacts from the GRACE 4 init template.", "If deployment or UX is not applicable, include a concrete reason."],
  },
  {
    prefix: "projection.",
    title: "GRACE 4 Projection Integrity Issue",
    explanation: "Graph or verification index routes do not match the logical projection built from .grace documents.",
    remediation: ["Synchronize GD-* and VD-* index ownership with document wrappers.", "Ensure every M-* has deterministic V-M-* coverage."],
  },
  {
    prefix: "assertion.",
    title: "GRACE 4 Assertion Failure",
    explanation: "A BaselineAssertions or TargetAssertions entry failed against current graph, verification, or filesystem state.",
    remediation: ["Reconcile the current state with the approved plan assertions.", "If the approved plan is stale, supersede and replan rather than editing it silently."],
  },
  {
    prefix: "scope.",
    title: "GRACE 4 Scope Conflict",
    explanation: "Active change scopes overlap in durable or observed write surfaces.",
    remediation: ["Treat durable overlap as a planning warning.", "Do not run overlapping observed writes in parallel-safe mode."],
  },
  {
    prefix: "xml.generic-",
    title: "Generic XML Tag Used Instead Of Unique GRACE Tag",
    explanation: "GRACE shared artifacts rely on unique ID-based XML tags such as M-*, Phase-*, and step-* so agents can reference them deterministically.",
    remediation: ["Replace the generic XML tag with the corresponding unique GRACE tag.", "Keep the unique tag and any verification-ref/module references synchronized across shared artifacts."],
  },
  {
    prefix: "markup.",
    title: "Semantic Markup Integrity Issue",
    explanation: "The governed file markup is incomplete, mismatched, or out of sync with the intended export or local symbol surface.",
    remediation: ["Repair the MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY, or semantic block markers in the file.", "Keep file-local markup aligned with the actual code surface and semantic block boundaries."],
  },
  {
    prefix: "graph.",
    title: "Knowledge Graph Drift",
    explanation: "The .grace/graph index references modules or entries that do not align with the current verification or filesystem state.",
    remediation: ["Synchronize GD-* index entries with the actual .grace/graph documents.", "Run $grace-refresh if the drift came from real code changes."],
  },
  {
    prefix: "plan.",
    title: "Change Plan Drift",
    explanation: "A GraceChangePlan is missing assertions, scopes, or verification refs needed for governed execution.",
    remediation: ["Update the GraceChangeSpec and GraceChangePlan so modules, assertions, and verification refs match the current .grace state.", "Use $grace-spec or $grace-plan when the architecture changed."],
  },
  {
    prefix: "analysis.",
    title: "Export Surface Analysis Warning",
    explanation: "The language adapter could not prove the exact export surface or detected a shape that weakens precise linting.",
    remediation: ["Prefer clearer export declarations or explicit ROLE/MAP_MODE overrides when necessary.", "Treat heuristic or wildcard-export warnings as cues to simplify or document the file surface."],
  },
];

function toTitleFromCode(code: string) {
  return code
    .split(/[.-]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getLintIssueGuide(code: string): LintIssueGuide {
  const exact = EXACT_GUIDES[code];
  if (exact) {
    return { code, ...exact };
  }

  const prefixGuide = PREFIX_GUIDES.find((guide) => code.startsWith(guide.prefix));
  if (prefixGuide) {
    return { code, ...prefixGuide };
  }

  return {
    code,
    title: toTitleFromCode(code),
    explanation: "This issue code does not yet have a dedicated explanation entry, but it still signals drift or missing governance metadata.",
    remediation: ["Inspect the issue message and the referenced file.", "Repair the smallest relevant GRACE artifact or governed file section before rerunning lint."],
  };
}

export function withLintIssueGuide(issue: LintIssue): LintIssue {
  const guide = getLintIssueGuide(issue.code);
  return {
    ...issue,
    title: guide.title,
    explanation: guide.explanation,
    remediation: guide.remediation,
  };
}

export function formatLintExplanation(code: string) {
  const guide = getLintIssueGuide(code);
  return [
    "GRACE Lint Issue Guide",
    "======================",
    `Code: ${guide.code}`,
    `Title: ${guide.title}`,
    "",
    "Explanation",
    guide.explanation,
    "",
    "Remediation",
    ...guide.remediation.map((item) => `- ${item}`),
  ].join("\n");
}
