// START_MODULE_CONTRACT
//   PURPOSE: Lint issue catalog and emission patterns
//   SCOPE: Titles, remediations, absence guides, and emission pattern sets
//   DEPENDS: none
//   LINKS: M-LINT-CATALOG
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DefectPatternId
//   IssueCodeClassification
//   LintIssueGuideResolution
//   classifyIssueCode
//   formatLintExplanation
//   getExactLintIssueGuide
//   getLintIssueGuide
//   getLintIssueGuideResolution
//   isEmittableIssueCode
//   listAbsenceCatalogCodes
//   listExactGuideCodes
//   withLintIssueGuide
// END_MODULE_MAP
import { ARTIFACT_DIR } from "../artifact/paths";
import { ARTIFACT_TAG_PREFIX, skillRef } from "../artifact/types";
import { GATE_CATALOG, isGateIssueCode } from "../gates/catalog";
import { guideFor, isReviewIssueCode } from "../review/catalog";
import { CONFIG_FILE_NAME } from "./config";
import type { IssueClass, LintIssue } from "./types";

/**
 * D4 defect-pattern ids (duplicated from test-support/defect-corpus so the
 * published lint surface never imports src/test-support — invariant 7 / A3.2 §4).
 */
export type DefectPatternId =
  | "confidently-wrong"
  | "self-referential-comparison"
  | "regex-over-structure"
  | "zero-or-more-swallow"
  | "unthreaded-construct";

type LintIssueGuideFields = {
  title: string;
  explanation: string;
  remediation: string[];
  /** Exact entries only; never on prefix guides (A6.1 §2). */
  issueClass?: IssueClass;
  /** Defect that motivated this code; required for absence entries (A3.2 / §12.1). */
  derivedFrom?: string;
  /** D4 pattern this code defends against. */
  proposedBy?: DefectPatternId;
};

type LintIssueGuide = LintIssueGuideFields & { code: string };

const EXACT_GUIDES: Record<string, LintIssueGuideFields> = {
  "config.invalid-json": {
    title: "Invalid Lint Config JSON",
    explanation: `The repository-level ${CONFIG_FILE_NAME} file could not be parsed as JSON.`,
    remediation: [`Fix the JSON syntax in ${CONFIG_FILE_NAME}.`, "If the file is accidental, remove it."],
  },
  "config.invalid-shape": {
    title: "Invalid Lint Config Shape",
    explanation: `${CONFIG_FILE_NAME} must be a JSON object.`,
    remediation: ["Replace the file contents with a JSON object.", "Keep only supported keys like ignoredDirs."],
  },
  "config.unknown-key": {
    title: "Unknown Lint Config Key",
    explanation: `${CONFIG_FILE_NAME} contains a key the CLI does not understand.`,
    remediation: [`Remove unsupported keys from ${CONFIG_FILE_NAME}.`, "Use only documented keys such as ignoredDirs and unverifiedLanguages."],
  },
  "config.invalid-unverified-languages": {
    title: "Invalid unverifiedLanguages Config",
    explanation: `\`unverifiedLanguages\` in ${CONFIG_FILE_NAME} must be an array of dot-prefixed file extensions.`,
    remediation: ["Use the form [\".rs\", \".go\"].", "Remove the key to restore default reporting."],
  },
  "config.invalid-code-extensions": {
    title: "Invalid codeExtensions Config",
    explanation: `\`codeExtensions\` in ${CONFIG_FILE_NAME} must be an array of lowercase file extensions beginning with a dot.`,
    remediation: ["Use the form [\".ex\", \".exs\"].", "Remove the key to restore default extension coverage."],
  },
  "config.invalid-ignored-dirs": {
    title: "Invalid ignoredDirs Config",
    explanation: `\`ignoredDirs\` in ${CONFIG_FILE_NAME} must be an array of directory names.`,
    remediation: ["Use the form [\"vendor\", \"third_party\"].", "Remove the key to lint every directory."],
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
      `Acknowledge the limitation deliberately with ${CONFIG_FILE_NAME} { \"unverifiedLanguages\": [\".ext\"] } `
        + "so the silence is a recorded decision rather than an accident.",
    ],
    issueClass: "absence",
    derivedFrom: "Governed file claims EXPORTS/LOCALS parity with no language adapter; previously silent or misread as a defect.",
    proposedBy: "confidently-wrong",
  },
  "markup.near-miss-marker": {
    title: "Near-Miss Semantic Marker",
    explanation:
      "A comment line looks like a GRACE semantic marker but is not an exact marker name "
      + "(for example START_MODULE_CONTRACTX, or START_BLOCK_foo with a lowercase name). "
      + "The file is not governed by that line; reporting the near-miss keeps a typo loud "
      + "instead of silent after the hasGraceMarkers boundary was tightened.",
    remediation: [
      "Use an exact marker: START_MODULE_CONTRACT, START_MODULE_MAP, START_CHANGE_SUMMARY, or START_BLOCK_NAME with NAME matching [A-Z0-9_]+.",
      "If the line is ordinary prose or an identifier, reword it so it does not prefix a marker name.",
    ],
    derivedFrom:
      "Tightening hasGraceMarkers to reject identifier continuations (START_MODULE_CONTRACTX) "
      + "and lowercase START_BLOCK_ names made those files ungoverned with no issues; authors who "
      + "mistyped a marker got silence instead of feedback (A7.1 / A8).",
    proposedBy: "regex-over-structure",
  },
  "markup.unparsed-link-token": {
    title: "Unparsed MODULE_CONTRACT List Token",
    explanation:
      "A LINKS or DEPENDS token matches no accepted id family for that field after splitting on "
      + "[,;\\s]+ (comma, semicolon, or whitespace; colon is not a separator). "
      + "LINKS accepts M-*, DF-*, and V-M-*; DEPENDS accepts M-* only. "
      + "Unrecognized tokens used to be dropped silently, leaving IMPL=0 and green lint.",
    remediation: [
      "Use only accepted id families for the field (LINKS: M-*, DF-*, V-M-*; DEPENDS: M-*).",
      "Separate multiple ids with comma, semicolon, or whitespace — not a colon.",
      "Remove free-text names (e.g. postgres); declare external deps outside DEPENDS anchors.",
      "For DEPENDS: none or LINKS: none, keep the case-insensitive none sentinel (or [none]).",
    ],
    derivedFrom:
      "parseGovernedFile filtered LINKS/DEPENDS with .filter() and dropped residual tokens "
      + "while lint stayed green (RM-GOVERNED-PATH P0.2 / C-TOKEN-INTEGRITY T-001).",
    proposedBy: "confidently-wrong",
  },
  "markup.unknown-dependency": {
    title: "Unknown MODULE_CONTRACT DEPENDS Anchor",
    explanation:
      "DEPENDS lists an M-* module anchor that does not exist in the knowledge graph. "
      + "Only M-* tokens are valid in DEPENDS; free-text or wrong-family tokens raise "
      + "markup.unparsed-link-token instead of being ignored.",
    remediation: [
      `Add the missing module to ${ARTIFACT_DIR}/graph or correct the DEPENDS list.`,
      "DEPENDS accepts M-* anchors only — not free-text library names or V-M-*/DF-* ids.",
    ],
  },
  "markup.unknown-link": {
    title: "Unknown MODULE_CONTRACT LINKS Anchor",
    explanation:
      "LINKS references an M-*, DF-*, or V-M-* anchor that does not exist in the graph or verification projection.",
    remediation: [
      `Link only anchors that exist under ${ARTIFACT_DIR}/graph and ${ARTIFACT_DIR}/verification.`,
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
    issueClass: "absence",
    derivedFrom: "Adapter requires a runtime that is not on PATH; parity cannot be evaluated rather than failed.",
    proposedBy: "confidently-wrong",
  },
  "assertion.command-not-evaluated": {
    title: "Command Assertion Not Evaluated",
    explanation:
      "A MustPassCommand or MustPassBudget assertion was not run because command execution was not "
      + "opted in. This is an absence of evidence, not a command failure.",
    remediation: [
      "Pass --run-commands when the selected assertion mode should execute declared commands.",
      "Do not treat a skipped command as a pass; the absence reason is this code.",
    ],
    issueClass: "absence",
    derivedFrom: "MustPassCommand/MustPassBudget without --run-commands produced no evaluation; silence would look like success.",
    proposedBy: "confidently-wrong",
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
    explanation: "A NgraceChangeSpec or NgraceChangePlan with status='superseded' should name the replacement C-* anchor via a <Replacement> or <ReplacementChange> child tag.",
    remediation: ["Add a <Replacement>C-REPLACEMENT-ID</Replacement> child to the superseded wrapper.", "Or add a direct <C-REPLACEMENT-ID /> child tag as the replacement reference."],
  },
  "change.graph-anchors-miss-write-scope": {
    title: "GraphAnchors Do Not Own ObservedWriteScope Path",
    explanation:
      "An active plan lists a non-test src/ path in ObservedWriteScope whose MODULE_CONTRACT LINKS "
      + "does not include any module from DurableScope/GraphAnchors. Ownership is the reverse edge "
      + "(LINKS), not directory prefix. Non-src paths and test files are not subject to this check.",
    remediation: [
      "Add a GraphAnchors module that the file already LINKS, or change the file's LINKS to a module the plan anchors.",
      "Or remove the path from ObservedWriteScope if it is not part of this change's source write set.",
    ],
    derivedFrom:
      "C-GRAPH-COVERAGE / A53: GraphAnchors must be able to name the code the plan claims to write; LINKS is the partition.",
    proposedBy: "confidently-wrong",
  },
  "change.scope-does-not-cover-spec": {
    title: "Plan Scope Does Not Cover Spec AffectedAreas",
    explanation: "The plan's DurableScope omits a module or data-flow anchor that the authorizing NgraceChangeSpec lists under AffectedAreas, and the omission is not justified under OutOfPlanScope.",
    remediation: [
      "Add the missing M-* or DF-* under DurableScope/GraphAnchors (or the matching V-M-* under DurableScope/VerificationAnchors).",
      "Or justify the exclusion with <OutOfPlanScope><M-ID><Reason>why this plan deliberately omits it</Reason></M-ID></OutOfPlanScope>.",
    ],
  },
  "change.plan-scope-exceeds-spec": {
    title: "Plan Scope Exceeds Spec AffectedAreas",
    explanation: "The plan's DurableScope includes a module or data-flow the approved NgraceChangeSpec never named in AffectedAreas.",
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
    explanation: "A task Satisfies element references an AC-* id that the approved NgraceChangeSpec does not define.",
    remediation: [
      "Define the criterion under the spec as <AcceptanceCriteria><AC-ID>text</AC-ID></AcceptanceCriteria>.",
      "Or remove the unknown AC-* from the task's <Satisfies> list.",
    ],
  },
  "change.duplicate-acceptance-criterion": {
    title: "Duplicate Acceptance Criterion Id",
    explanation: "The same AC-* tag appears more than once under AcceptanceCriteria in a single NgraceChangeSpec.",
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
  "change.invalid-design-reference-child": {
    title: "Invalid DesignReferences Child",
    explanation: "Optional DesignReferences under a NgraceChangeSpec only accepts <Figma url=\"...\"> and <UserResearch>path</UserResearch>. Other children are dropped silently by free-form XML unless rejected here.",
    remediation: [
      "Use <Figma url=\"https://...\">optional label</Figma> for design-file links.",
      "Use <UserResearch>docs/research/...</UserResearch> for project-relative research paths.",
    ],
  },
  "change.invalid-figma-url": {
    title: "Invalid Figma URL",
    explanation: "A <Figma> design reference requires a non-empty url attribute that is a well-formed http or https URL. Relative paths, javascript:, data:, and other schemes are rejected.",
    remediation: [
      "Use an absolute https URL such as https://www.figma.com/file/... or https://www.figma.com/design/....",
      "Put local design docs under <UserResearch>path</UserResearch> instead of Figma.",
    ],
  },
  "change.user-research-path-invalid": {
    title: "Invalid UserResearch Path",
    explanation: "A <UserResearch> design reference must be a non-empty path contained inside the project root. Escaping paths (../) and empty values are rejected.",
    remediation: [
      "Use a project-relative path such as docs/research/auth-interviews.md.",
      "Do not use absolute paths outside the project or URL schemes in UserResearch.",
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
  "health.missing-verification": {
    title: "Module Has No Verification Entry",
    explanation: "A graph module has no V-M-* verification entry, so there is no command, scenario, or marker evidence for that module.",
    remediation: [
      `Add V-<module-id> under ${ARTIFACT_DIR}/verification.`,
      "Link the entry from the module and give it at least one Command and one Scenario.",
    ],
  },
  "health.missing-implementation-files": {
    title: "Module Has No Implementation Files",
    explanation: "A graph module has no linked non-test governed files, so it is planned but not implemented.",
    remediation: [
      "Implement the module and list runtime files in START_MODULE_CONTRACT LINKS.",
      "Or remove the unused module from the graph if it is no longer planned.",
    ],
  },
  "health.verification-missing-commands": {
    title: "Verification Entry Has No Commands",
    explanation: "A V-M-* entry has no Command evidence, so module health cannot prove the suite ran.",
    remediation: [
      `Add Command entries to the V-M-* record in ${ARTIFACT_DIR}/verification.`,
      "Point at least one command at a test file that exists on disk.",
    ],
  },
  "health.verification-missing-scenarios": {
    title: "Verification Entry Has No Scenarios",
    explanation: "A V-M-* entry has no Scenario evidence, so the module has no named behavioural coverage.",
    remediation: [
      "Add Scenario entries to the V-M-* record.",
      "For UI_COMPONENT modules, name each declared ST-* state in a Scenario, AccessibilityCheck, or VisualCheck.",
    ],
  },
  "health.verification-missing-evidence": {
    title: "Verification Entry Has No Markers Or Traces",
    explanation: "A V-M-* entry has neither required log markers nor trace assertions, so runtime evidence is untracked.",
    remediation: [
      "Add Marker or TraceAssertion entries to the V-M-* record.",
      "Emit those markers from linked runtime files, or drop the unused requirement.",
    ],
  },
  "health.verification-test-file-missing-on-disk": {
    title: "Verification Test File Missing On Disk",
    explanation: "A V-M-* entry names a test file that does not exist at the recorded path.",
    remediation: [
      "Create the named test file, or update the V-M-* TestFile path to a file that exists.",
      "Keep Command text pointing at the same path.",
    ],
  },
  "health.verification-command-does-not-reference-test-file": {
    title: "Verification Command Misses Its Test File",
    explanation: "A V-M-* entry names a test file, but no Command clearly targets that file or its directory.",
    remediation: [
      "Make at least one Command reference the test file path or its directory.",
      "Or remove the unused TestFile if the command is the source of truth.",
    ],
  },
  "health.required-log-marker-not-found": {
    title: "Required Log Marker Not Found",
    explanation: "A V-M-* entry requires a log marker that is not present in any linked runtime file.",
    remediation: [
      "Emit the marker from the module's runtime code, or update the verification entry.",
      "Do not treat a missing marker as a pass.",
    ],
  },
  "health.required-log-marker-block-not-found": {
    title: "Required Marker Block Not Found",
    explanation: "A required marker names a BLOCK_* region, but no linked runtime file exposes that block.",
    remediation: [
      "Add the BLOCK_* region to a linked runtime file, or update the marker.",
      "Keep the block name and the marker spelling synchronized.",
    ],
  },
  "design-context.invalid-root-tag": {
    title: "Invalid Design Context Root Tag",
    explanation: "design-context.xml must use root tag NgraceChangeDesignContext.",
    remediation: [
      "Replace the root tag with NgraceChangeDesignContext and graceVersion=\"1.0\".",
      "Do not reuse NgraceChangeSpec, DesignContext, or another artifact root.",
    ],
  },
  "design-context.missing-grace-version": {
    title: "Design Context Missing graceVersion",
    explanation: "NgraceChangeDesignContext must declare graceVersion=\"1.0\".",
    remediation: ["Add graceVersion=\"1.0\" on the root tag."],
  },
  "design-context.unsupported-grace-version": {
    title: "Design Context Unsupported graceVersion",
    explanation: "NgraceChangeDesignContext declares a graceVersion other than \"1.0\".",
    remediation: ["Set graceVersion=\"1.0\".", "Do not invent a forward version on this artifact."],
  },
  "design-context.forbidden-status": {
    title: "Design Context Must Not Declare Status",
    explanation: "NgraceChangeDesignContext must not declare a status attribute; it is not a lifecycle artifact.",
    remediation: ["Remove the status attribute.", "Keep identity on <Change>C-*</Change> or a C-* wrapper."],
  },
  "design-context.forbidden-root-attribute": {
    title: "Design Context Forbidden Root Attribute",
    explanation: "NgraceChangeDesignContext only allows the documented root attributes; extra attributes are rejected.",
    remediation: ["Keep only graceVersion on the root.", "Move other metadata into child elements."],
  },
  "design-context.missing-change-id": {
    title: "Design Context Missing Change Identity",
    explanation: "NgraceChangeDesignContext must identify its bundle through one direct <Change>C-*</Change> or C-* wrapper.",
    remediation: [
      "Add <Change>C-EXAMPLE</Change> or a <C-EXAMPLE> wrapper matching the bundle id.",
      "Do not leave the artifact anonymous.",
    ],
  },
  "design-context.ambiguous-change-id": {
    title: "Design Context Ambiguous Change Identity",
    explanation: "NgraceChangeDesignContext must contain exactly one direct change identity declaration.",
    remediation: ["Keep a single <Change> or C-* wrapper.", "Remove the extra identity child."],
  },
  "design-context.invalid-change-id": {
    title: "Design Context Invalid Change Identity",
    explanation: "NgraceChangeDesignContext <Change> must contain a canonical C-* identifier.",
    remediation: ["Use a C-* id such as C-EXAMPLE.", "Do not put free text in <Change>."],
  },
  "design-context.bundle-id-mismatch": {
    title: "Design Context Bundle Id Mismatch",
    explanation: "design-context.xml identifies a C-* id that does not match its enclosing change bundle directory.",
    remediation: [
      "Set <Change> (or the C-* wrapper) to the bundle directory id.",
      "Do not copy a design-context.xml from another bundle without rewriting the identity.",
    ],
  },
  "xml.parse": {
    title: "XML Artifact Failed To Parse",
    explanation: "An XML artifact could not be parsed: the document is not well-formed, or it has no root element.",
    remediation: [
      "Fix the XML syntax (unclosed tags, bad entities, or a missing root).",
      "Re-run the command that loaded the file after the document parses.",
    ],
  },
  "xml.missing-file": {
    title: "XML Artifact File Missing",
    explanation: "A required XML artifact path does not exist on disk.",
    remediation: [
      "Create the missing file, or correct the path that pointed at it.",
      "Do not treat a missing artifact as an empty parse.",
    ],
  },
  "verification.index-invalid-documents-section": {
    title: "Verification Index Documents Section Invalid",
    explanation: `${ARTIFACT_TAG_PREFIX}VerificationIndex must contain exactly one direct VerificationDocuments section.`,
    remediation: [
      "Keep a single <VerificationDocuments> child on the verification index.",
      "Move notes or extra lists outside that section.",
    ],
  },
  "verification.invalid-document-wrapper": {
    title: "Verification Document Wrapper Invalid",
    explanation: `${ARTIFACT_TAG_PREFIX}VerificationDocument must contain exactly one direct VD-* wrapper.`,
    remediation: [
      "Keep exactly one VD-* child as the document wrapper.",
      "Do not use a GD-* wrapper or more than one VD-* sibling.",
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
      "Split by service or package path with `ngrace graph split --by <path-prefix> --apply`.",
      `Raise limits only deliberately via ${CONFIG_FILE_NAME} documentAnchorLimit / documentByteLimit.`,
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
    explanation: `${ARTIFACT_TAG_PREFIX}Technology may contain at most one <Stacks> element.`,
    remediation: ["Merge stack declarations under a single <Stacks>."],
  },
  // --- Run ledger / cursor (Phase 3, A11.3). All defects; never issueClass "absence". ---
  "ledger.invalid-allocation": {
    title: "Invalid Run Ledger Allocation",
    explanation:
      "An <Allocation> under a run-ledger Epoch could not be parsed as a worker range "
      + "(worker plus integer from/to with from <= to). Null parse results used to be dropped "
      + "silently, leaving a corrupt CLI audit trail with only secondary symptoms.",
    remediation: [
      "Ensure each Allocation has worker and integer from/to attributes (from <= to).",
      "Do not hand-author ledgers; regenerate via the cursor/fold surface when possible.",
      "Treat a bad Allocation as ledger corruption, not an authoring typo.",
    ],
    derivedFrom:
      "parseAllocation null filtered away in validateLedgerEpoch (RM-GOVERNED-PATH P0 / C-TOKEN-INTEGRITY T-004 site 7).",
    proposedBy: "confidently-wrong",
  },
  "ledger.invalid-event": {
    title: "Invalid Run Ledger Event",
    explanation:
      "An <Event> under a run-ledger Epoch could not be parsed (positive integer id, non-empty task and kind). "
      + "Null parse results used to be dropped silently.",
    remediation: [
      "Ensure each Event has a positive integer id, a task id, and a kind.",
      "Do not hand-edit event rows; recover through the cursor surface when available.",
    ],
    derivedFrom:
      "parseLedgerEvent null filtered away in validateLedgerEpoch (RM-GOVERNED-PATH P0 / C-TOKEN-INTEGRITY T-004 site 8).",
    proposedBy: "confidently-wrong",
  },
  "ledger.invalid-root-tag": {
    title: "Invalid Run Ledger Root Tag",
    explanation: `run-ledger.xml must use root tag ${ARTIFACT_TAG_PREFIX}RunLedger with graceVersion="1.0".`,
    remediation: ["Rewrite the ledger with the canonical root tag, or regenerate via ngrace cursor fold."],
    derivedFrom: "Malformed companion artifact admitted by the bundle filename allowlist without a root-tag check.",
    proposedBy: "unthreaded-construct",
  },
  "ledger.invalid-change-id": {
    title: "Invalid Run Ledger Change Identity",
    explanation: "run-ledger.xml must declare exactly one canonical C-* wrapper matching its bundle.",
    remediation: ["Use a single C-* wrapper under the root.", "Do not hand-author ledgers; use ngrace cursor fold."],
    derivedFrom: "Machine-written companion missing required bundle identity.",
    proposedBy: "unthreaded-construct",
  },
  "ledger.bundle-id-mismatch": {
    title: "Run Ledger Bundle Identity Mismatch",
    explanation: "run-ledger.xml identity disagrees with its bundle directory. Cross-bundle attribution of non-recoverable records is the worst corruption this surface can produce.",
    remediation: ["Move or rewrite the ledger so its C-* wrapper matches the directory name.", "Never copy run-ledger.xml between bundles."],
    derivedFrom: "Task IDs collide across bundles; only bundle identity catches a copied ledger (A11.4).",
    proposedBy: "unthreaded-construct",
  },
  "ledger.non-monotonic-epoch": {
    title: "Non-Monotonic Ledger Epoch",
    explanation: "Epoch-N section numbers must be strictly increasing and never repeated.",
    remediation: ["Append only at epoch close.", "Do not renumber or duplicate Epoch-N sections."],
    derivedFrom: "Append-only ledger contract; renumbering would hide concurrent-allocation history (D3).",
    proposedBy: "zero-or-more-swallow",
  },
  "ledger.reordered-epoch": {
    title: "Reordered Or Malformed Ledger Epoch",
    explanation: "An epoch was renumbered, moved relative to its predecessor, or uses a malformed Epoch-* tag.",
    remediation: ["Keep epoch order append-only.", "Use Epoch-N with N >= 1 only."],
    derivedFrom: "Reorder or renumber would manufacture a total order that did not happen (D3).",
    proposedBy: "zero-or-more-swallow",
  },
  "ledger.event-outside-allocation": {
    title: "Ledger Event Outside Allocation",
    explanation: "An event id falls in no worker RangeAllocation — D2's rogue-writer detection.",
    remediation: ["Allocate a range before concurrent work.", "Drop or re-id rogue events before fold."],
    derivedFrom: "Pre-allocated disjoint ranges make collision and rogue writers detectable without clocks (D2).",
    proposedBy: "zero-or-more-swallow",
  },
  "ledger.range-hole": {
    title: "Ledger Range Hole",
    explanation: "A used allocation range is not dense from its start up to the highest used id.",
    remediation: ["Recover missing event files before fold.", "Do not skip ids inside a used range."],
    derivedFrom: "Density is how D2 detects lost events that timestamps cannot.",
    proposedBy: "zero-or-more-swallow",
  },
  "ledger.range-unterminated": {
    title: "Ledger Range Unterminated",
    explanation: "A used allocation range has no terminal event, so the worker may have died mid-flight.",
    remediation: ["Emit a terminal event for each used range before fold.", "Mark the epoch incomplete if the worker is gone."],
    derivedFrom: "A used range with no terminal event is a mid-flight death; silent success would be confidently wrong (D2).",
    proposedBy: "confidently-wrong",
  },
  "ledger.duplicate-verdicts-section": {
    title: "Duplicate Verdicts Section",
    explanation: "run-ledger.xml may contain at most one <Verdicts> section under the change wrapper (A30.2).",
    remediation: ["Merge Verdict children under a single <Verdicts>.", "Do not hand-author parallel sections."],
    derivedFrom: "Bundle-scoped review verdicts are one durable section; duplicates would split authority (A30.3).",
    proposedBy: "zero-or-more-swallow",
  },
  "ledger.invalid-verdict": {
    title: "Invalid Review Verdict Entry",
    explanation: "A <Verdict> must declare outcome pass|fail|unable-to-determine; other children under Verdicts are illegal.",
    remediation: ["Use <Verdict outcome=\"…\"> only.", "Record via the gate/review surface rather than free-form XML."],
    derivedFrom: "Invariant 4: Verdicts grammar arrives with the validator (A30.2).",
    proposedBy: "unthreaded-construct",
  },
  "ledger.duplicate-decisions-section": {
    title: "Duplicate Decisions Section",
    explanation: "run-ledger.xml may contain at most one <Decisions> section under the change wrapper (A30.2).",
    remediation: ["Merge Decision children under a single <Decisions>."],
    derivedFrom: "Bundle-scoped gate decisions are one durable section (A30.2).",
    proposedBy: "zero-or-more-swallow",
  },
  "ledger.invalid-decision": {
    title: "Invalid Gate Decision Entry",
    explanation: "A <Decision> must declare gate approve|apply|archive and decision permit|refuse; Requirements need id.",
    remediation: ["Use ngrace gate to record decisions.", "Do not invent Decision shapes by hand."],
    derivedFrom: "Invariant 4: Decisions grammar arrives with the validator (A30.2).",
    proposedBy: "unthreaded-construct",
  },
  "change.implementation-plan-invalid-child": {
    title: "Invalid ImplementationPlan Child",
    explanation:
      "ImplementationPlan admits only direct T-* task elements. Non-task siblings (e.g. <Note>) "
      + "were filtered silently, so authored structure vanished while lint stayed green.",
    remediation: [
      "Move non-task content out of ImplementationPlan.",
      "Declare work only as <T-NNN>…</T-NNN> task elements.",
    ],
    derivedFrom:
      "ImplementationPlan children filtered to T-* only (RM-GOVERNED-PATH P0 / C-TOKEN-INTEGRITY T-004 site 10).",
    proposedBy: "confidently-wrong",
  },
  "change.task-invalid-dependency": {
    title: "Task DependsOn Token Is Not A Valid T-NNN Reference",
    explanation:
      "A DependsOn entry is not a valid task reference. The emitted message names the three "
      + "accepted authoring shapes; the token is not yet a T-NNN id.",
    remediation: [
      "Use a multi-value text list of T-NNN ids (comma, semicolon, or whitespace).",
      "Or write <Task>T-NNN</Task> children, or self-closing <T-NNN /> anchor children.",
      "Do not leave free-text tokens such as not-a-task in DependsOn.",
    ],
  },
  "change.task-unknown-dependency": {
    title: "Task Depends On An Unknown Task",
    explanation:
      "A DependsOn token is a valid T-NNN id, but the plan contains no such task. "
      + "This is a missing target, not an authoring-shape error.",
    remediation: [
      "Add the missing task, or change the DependsOn token so it no longer depends on unknown task.",
      "The token is already a valid T-NNN — do not rewrite it as a list or anchor form.",
    ],
  },
  "change.task-self-dependency": {
    title: "Task Cannot Depend On Itself",
    explanation:
      "A task lists its own id in DependsOn. The token is already a valid T-NNN; the graph edge is the defect.",
    remediation: [
      "Remove the self-edge so the task cannot depend on itself.",
      "The token is already a valid T-NNN — do not rewrite it as a list or anchor form.",
    ],
  },
  "change.task-dependency-cycle": {
    title: "Task Dependency Cycle",
    explanation:
      "The ImplementationPlan task graph contains a cycle. Each token is already a valid T-NNN; "
      + "the cycle is the defect.",
    remediation: [
      "Break the dependency cycle involving the named tasks.",
      "Keep each token as a valid T-NNN and change only the edges.",
    ],
  },
  "change.task-duplicate-dependency": {
    title: "Task Repeats A Dependency",
    explanation:
      "A DependsOn list names the same valid T-NNN id more than once. The token is already canonical; "
      + "the repeat is the defect.",
    remediation: [
      "Remove the extra listing so DependsOn no longer repeats dependency.",
      "The token is already a valid T-NNN — do not rewrite it as a list or anchor form.",
    ],
  },
  "change.duplicate-clarifications-section": {
    title: "Duplicate Clarifications Section",
    explanation: "A change spec or plan may contain at most one <Clarifications> section.",
    remediation: ["Merge Clarification children under a single <Clarifications>."],
    derivedFrom: "Typed holes (D12) need a single discoverable section for gates to read.",
    proposedBy: "zero-or-more-swallow",
  },
  "change.invalid-clarification": {
    title: "Invalid Clarification Element",
    explanation: "Clarifications admits only <Clarification target=\"…\"> children with a non-empty target.",
    remediation: ["Use the schema element, never a prose [NEEDS CLARIFICATION] marker (anti-pattern 3)."],
    derivedFrom: "Phase 5 typed hole (A29.4); prose markers are not a detection path.",
    proposedBy: "regex-over-structure",
  },
  "change.invalid-clarification-target": {
    title: "Invalid Clarification Target Anchor",
    explanation: "Clarification target must be a canonical IC-*, INV-*, or AC-* anchor (D12).",
    remediation: ["Point target at a real contract, invariant, or acceptance criterion id."],
    derivedFrom: "Gate tables key on IC/INV/AC families; free-text targets cannot be evaluated.",
    proposedBy: "unthreaded-construct",
  },
  "config.invalid-gate-fail-on": {
    title: "Invalid gateFailOn Config",
    explanation: "`gateFailOn` must be one of errors, warnings, or never (D11 project policy).",
    remediation: ["Use \"errors\", \"warnings\", or \"never\".", "Omit the key to default to errors."],
    derivedFrom: "Project declaration for missing/host-capability review verdict severity (A29.5).",
    proposedBy: "unthreaded-construct",
  },
  "cursor.empty-escalated-task": {
    title: "Empty EscalatedTask Element",
    explanation:
      "run.xml contains an <EscalatedTask> with no task id text. Empty elements were filtered "
      + "silently, so a paused-pending-approval cursor could claim escalation without naming a task.",
    remediation: [
      "Name the escalated T-* task inside <EscalatedTask>…</EscalatedTask>.",
      "Remove the element entirely if no task is escalated.",
    ],
    derivedFrom:
      "cursorEscalatedTasks filtered empty text (RM-GOVERNED-PATH P0 / C-TOKEN-INTEGRITY T-004 site 9).",
    proposedBy: "confidently-wrong",
  },
  "cursor.invalid-root-tag": {
    title: "Invalid Run Cursor Root Tag",
    explanation: `run.xml must use root tag ${ARTIFACT_TAG_PREFIX}RunCursor with graceVersion="1.0".`,
    remediation: ["Regenerate the cursor with ngrace cursor regenerate --apply.", "Do not hand-author run.xml."],
    derivedFrom: "Malformed companion cache admitted by the bundle filename allowlist.",
    proposedBy: "unthreaded-construct",
  },
  "cursor.invalid-change-id": {
    title: "Invalid Run Cursor Change Identity",
    explanation: "run.xml must declare exactly one canonical C-* wrapper.",
    remediation: ["Regenerate the cursor.", "Ensure the wrapper matches the bundle directory."],
    derivedFrom: "Required identity on machine-written companions (A11.4).",
    proposedBy: "unthreaded-construct",
  },
  "cursor.bundle-id-mismatch": {
    title: "Run Cursor Bundle Identity Mismatch",
    explanation: "run.xml identity disagrees with its bundle directory. Task ids collide across bundles, so unknown-task alone cannot catch a copied cursor.",
    remediation: ["Delete or regenerate the cursor for this bundle.", "Never copy run.xml between bundles."],
    derivedFrom: "Cross-bundle cursor copy validates clean under task-id collision (A11.4).",
    proposedBy: "unthreaded-construct",
  },
  "cursor.unknown-task": {
    title: "Run Cursor Names Unknown Task",
    explanation: "run.xml names a T-* task absent from this bundle's plan.xml (D1 referential integrity).",
    remediation: ["Regenerate the cursor from the ledger and plan.", "Do not advance past tasks not in the plan."],
    derivedFrom: "Present-but-inconsistent cursor is an error; absent cursor is silent (D1).",
    proposedBy: "unthreaded-construct",
  },
  "projection.index.owns-text": {
    title: "Owns Section Contains Bare Text",
    explanation:
      "A GD-* or VD-* index route lists owned anchors as text inside <Owns> instead of self-closing "
      + "child tags. Text never enters the owns list, so the author later sees only "
      + "projection.graph.unlisted-anchor with a remediation about synchronizing index ownership — "
      + "technically true and useless for this typo.",
    remediation: [
      "Rewrite bare text as self-closing anchor children, e.g. <Owns><M-EXAMPLE /></Owns>.",
      "Do not put free text or comma lists inside <Owns>.",
    ],
    derivedFrom:
      "routeFromOwnerNode collected only Owns children (RM-GOVERNED-PATH P0.5 / C-TOKEN-INTEGRITY T-003).",
    proposedBy: "confidently-wrong",
  },
  "projection.index.invalid-owns-child": {
    title: "Invalid Owns Child Tag",
    explanation:
      "An <Owns> section under a graph or verification index route contains a child tag that is not "
      + "in the ownership family for that document. Invalid children were filtered silently.",
    remediation: [
      "Use only anchors this document may own (graph: M-*/DF-*/IC-*; verification: V-M-*).",
      "Remove or relocate unsupported child tags.",
    ],
    derivedFrom:
      "Owns children filtered by ownsPredicate with no residual error (RM-GOVERNED-PATH P0 / C-TOKEN-INTEGRITY T-003 site 4).",
    proposedBy: "confidently-wrong",
  },
  "projection.index.invalid-document-child": {
    title: "Invalid Index Document List Child",
    explanation:
      "GraphDocuments admits only GD-* children and VerificationDocuments admits only VD-* children. "
      + "Other siblings were filtered silently.",
    remediation: [
      "Place only GD-* owners under GraphDocuments and only VD-* owners under VerificationDocuments.",
      "Move notes or other content outside those lists.",
    ],
    derivedFrom:
      "Index document lists filtered by GD-*/VD-* patterns (RM-GOVERNED-PATH P0 / C-TOKEN-INTEGRITY T-003 sites 5–6).",
    proposedBy: "confidently-wrong",
  },
};

const PREFIX_GUIDES: Array<{ prefix: string; title: string; explanation: string; remediation: string[] }> = [
  {
    prefix: "project.",
    title: "neo-grace Project Detection Issue",
    explanation: `The CLI could not identify a valid neo-grace ${ARTIFACT_DIR} project state, or it detected legacy GRACE 3 artifacts instead.`,
    remediation: [`Run ${skillRef("init")} for a new neo-grace project or ${skillRef("migrate")} for legacy GRACE 3 projects.`, "Do not rely on dual-mode docs/*.xml validation."],
  },
  {
    prefix: "artifact.",
    title: "neo-grace Artifact Grammar Issue",
    explanation: `A ${ARTIFACT_DIR} XML artifact violates the neo-grace root, metadata, version, or semantic-anchor grammar.`,
    remediation: ["Use approved neo-grace root tags with graceVersion=\"1.0\".", "Keep semantic anchors as XML tags, never attributes."],
  },
  {
    prefix: "change.",
    title: "neo-grace Change Lifecycle Issue",
    explanation: "A change spec or plan has an invalid status, wrapper shape, or active/archive location for the neo-grace lifecycle.",
    remediation: [`Keep draft and approved bundles under ${ARTIFACT_DIR}/changes/active.`, "Move applied, rejected, cancelled, or superseded bundles to archive with matching statuses."],
  },
  {
    prefix: "context.",
    title: "neo-grace Context Artifact Issue",
    explanation: `A required ${ARTIFACT_DIR}/context artifact is missing, has the wrong root, or has invalid applicability metadata.`,
    remediation: ["Create all five context artifacts from the neo-grace init template.", "If deployment or UX is not applicable, include a concrete reason."],
  },
  {
    prefix: "projection.",
    title: "neo-grace Projection Integrity Issue",
    explanation: `Graph or verification index routes do not match the logical projection built from ${ARTIFACT_DIR} documents.`,
    remediation: ["Synchronize GD-* and VD-* index ownership with document wrappers.", "Ensure every M-* has deterministic V-M-* coverage."],
  },
  {
    prefix: "assertion.",
    title: "neo-grace Assertion Failure",
    explanation: "A BaselineAssertions or TargetAssertions entry failed against current graph, verification, or filesystem state.",
    remediation: ["Reconcile the current state with the approved plan assertions.", "If the approved plan is stale, supersede and replan rather than editing it silently."],
  },
  {
    prefix: "scope.",
    title: "neo-grace Scope Conflict",
    explanation: "Active change scopes overlap in durable or observed write surfaces.",
    remediation: ["Treat durable overlap as a planning warning.", "Do not run overlapping observed writes in parallel-safe mode."],
  },
  {
    prefix: "xml.generic-",
    title: "Generic XML Tag Used Instead Of Unique GRACE Tag",
    explanation: "neo-grace shared artifacts rely on unique ID-based XML tags such as M-*, Phase-*, and step-* so agents can reference them deterministically.",
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
    explanation: `The ${ARTIFACT_DIR}/graph index references modules or entries that do not align with the current verification or filesystem state.`,
    remediation: [`Synchronize GD-* index entries with the actual ${ARTIFACT_DIR}/graph documents.`, `Run ${skillRef("refresh")} if the drift came from real code changes.`],
  },
  {
    prefix: "plan.",
    title: "Change Plan Drift",
    explanation: "A NgraceChangePlan is missing assertions, scopes, or verification refs needed for governed execution.",
    remediation: [`Update the NgraceChangeSpec and NgraceChangePlan so modules, assertions, and verification refs match the current ${ARTIFACT_DIR} state.`, `Use ${skillRef("spec")} or ${skillRef("plan")} when the architecture changed.`],
  },
  {
    prefix: "analysis.",
    title: "Export Surface Analysis Warning",
    explanation: "The language adapter could not prove the exact export surface or detected a shape that weakens precise linting.",
    remediation: ["Prefer clearer export declarations or explicit ROLE/MAP_MODE overrides when necessary.", "Treat heuristic or wildcard-export warnings as cues to simplify or document the file surface."],
  },
  {
    prefix: "ledger.",
    title: "Run Ledger Issue",
    explanation: "A run-ledger.xml companion violates epoch ordering, range allocation, or identity rules.",
    remediation: ["Fold only after ranges are dense and terminated.", "Do not renumber epochs or hand-edit the ledger."],
  },
  {
    prefix: "cursor.",
    title: "Run Cursor Issue",
    explanation: "A run.xml cursor cache is malformed, identity-mismatched, or names a task absent from the plan.",
    remediation: ["Regenerate with ngrace cursor regenerate --apply.", "Treat the cursor as a cache, never as authority."],
  },
];

function toTitleFromCode(code: string) {
  return code
    .split(/[.-]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Three-state classification for `ngrace lint --explain` (Phase 11 / A76 corr 189, 202).
 * Derived from existing registries only — no fifth catalogue.
 */
export type IssueCodeClassification = "exact" | "emittable-uncatalogued" | "unknown";

/**
 * Which `getLintIssueGuide` branch produced the guide. Observed separately from
 * the guide object so `withLintIssueGuide` and `--explain --format json` cannot
 * grow a resolution field (they spread / serialize `LintIssueGuide` fields).
 */
export type LintIssueGuideResolution =
  | "exact"
  | "prefix"
  | "review-catalog"
  | "gate-catalog"
  | "review-unregistered"
  | "gate-unregistered"
  | "emittable-fallback"
  | "unknown";

/**
 * Whether this binary can emit the code.
 *
 * Union rule (A76):
 * 1. keys of EXACT_GUIDES
 * 2. any PREFIX_GUIDES family match
 * 3. isReviewIssueCode (review.* surface)
 * 4. isGateIssueCode (gate.* surface)
 * 5. health.* namespace — peer of isGateIssueCode; health has only two exact guides
 * 6. xml.* and design-context.* — emitted by the grammar/XML layer, no dedicated catalog object
 *
 * Do not invent a parallel list of codes. Tests pin catalogs into this union.
 */
export function isEmittableIssueCode(code: string): boolean {
  if (Object.prototype.hasOwnProperty.call(EXACT_GUIDES, code)) {
    return true;
  }
  if (PREFIX_GUIDES.some((guide) => code.startsWith(guide.prefix))) {
    return true;
  }
  if (isReviewIssueCode(code) || isGateIssueCode(code)) {
    return true;
  }
  if (code.startsWith("health.") || code.startsWith("xml.") || code.startsWith("design-context.")) {
    return true;
  }
  return false;
}

export function classifyIssueCode(code: string): IssueCodeClassification {
  if (Object.prototype.hasOwnProperty.call(EXACT_GUIDES, code)) {
    return "exact";
  }
  if (isEmittableIssueCode(code)) {
    return "emittable-uncatalogued";
  }
  return "unknown";
}

/** Exact catalogue keys — for tests that pin catalog→union coverage. */
export function listExactGuideCodes(): string[] {
  return Object.keys(EXACT_GUIDES).sort();
}

function resolveLintIssueGuide(code: string): { guide: LintIssueGuide; resolution: LintIssueGuideResolution } {
  const exact = EXACT_GUIDES[code];
  if (exact) {
    return { guide: { code, ...exact }, resolution: "exact" };
  }

  const prefixGuide = PREFIX_GUIDES.find((guide) => code.startsWith(guide.prefix));
  if (prefixGuide) {
    return { guide: { code, ...prefixGuide }, resolution: "prefix" };
  }

  if (isReviewIssueCode(code)) {
    const reviewGuide = guideFor(code);
    if (reviewGuide) {
      return {
        guide: {
          code,
          title: reviewGuide.title,
          explanation: reviewGuide.explanation,
          remediation: reviewGuide.remediation,
        },
        resolution: "review-catalog",
      };
    }
    return {
      guide: {
        code,
        title: toTitleFromCode(code),
        explanation:
          `\`${code}\` is not a registered review finding code. `
          + "The review surface does not emit this string.",
        remediation: [
          "Check the spelling of the code you were given.",
          "Run `ngrace review` to see codes this binary actually produces.",
        ],
      },
      resolution: "review-unregistered",
    };
  }

  if (isGateIssueCode(code)) {
    const gateGuide = GATE_CATALOG[code];
    if (gateGuide) {
      return {
        guide: {
          code,
          title: gateGuide.title,
          explanation: gateGuide.explanation,
          remediation: gateGuide.remediation,
        },
        resolution: "gate-catalog",
      };
    }
    return {
      guide: {
        code,
        title: toTitleFromCode(code),
        explanation:
          `\`${code}\` is not a registered gate finding code. `
          + "The gate surface does not emit this string.",
        remediation: [
          "Check the spelling of the code you were given.",
          "Run `ngrace gate` to see codes this binary actually produces.",
        ],
      },
      resolution: "gate-unregistered",
    };
  }

  if (isEmittableIssueCode(code)) {
    return {
      guide: {
        code,
        title: toTitleFromCode(code),
        explanation:
          `This string matches an emittable prefix but is not a constructed code this binary documents. `
          + `\`${code}\` is not evidence that a dedicated explanation is missing, and it is not evidence of project drift.`,
        remediation: [
          "Check the spelling of the code you were given.",
          "Run `ngrace lint`, `ngrace review`, or `ngrace gate` to see codes this binary actually produces.",
        ],
      },
      resolution: "emittable-fallback",
    };
  }

  return {
    guide: {
      code,
      title: toTitleFromCode(code),
      explanation:
        `Unknown issue code: this binary does not emit \`${code}\`. `
        + "Nothing was checked for this string — it is not evidence of drift or missing governance.",
      remediation: [
        "Check the spelling of the code you were given.",
        "Run `ngrace lint`, `ngrace review`, or `ngrace gate` to see codes this binary actually produces.",
      ],
    },
    resolution: "unknown",
  };
}

export function getLintIssueGuide(code: string): LintIssueGuide {
  return resolveLintIssueGuide(code).guide;
}

/** Branch that produced the guide. Not a field on the guide object. */
export function getLintIssueGuideResolution(code: string): LintIssueGuideResolution {
  return resolveLintIssueGuide(code).resolution;
}

/**
 * Attaches guide fields. issueClass comes only from exact catalog entries
 * (A5.1 route 2, A6.1) — never from prefix guides or the synthesized fallback.
 */
export function withLintIssueGuide(issue: LintIssue): LintIssue {
  const exact = EXACT_GUIDES[issue.code];
  const guide = getLintIssueGuide(issue.code);
  const next: LintIssue = {
    ...issue,
    title: guide.title,
    explanation: guide.explanation,
    remediation: guide.remediation,
  };
  if (exact?.issueClass !== undefined) {
    next.issueClass = exact.issueClass;
  } else {
    // Uncatalogued / prefix-only codes: defect by default (A6.1 §3). Do not
    // preserve a spurious class if a caller attached one.
    delete next.issueClass;
  }
  return next;
}

/** Exact catalog fields for a code, or undefined when only prefix/fallback apply. */
export function getExactLintIssueGuide(code: string): LintIssueGuideFields | undefined {
  return EXACT_GUIDES[code];
}

/** Codes whose exact catalog entry carries issueClass "absence". */
export function listAbsenceCatalogCodes(): string[] {
  return Object.entries(EXACT_GUIDES)
    .filter(([, guide]) => guide.issueClass === "absence")
    .map(([code]) => code)
    .sort();
}

export function formatLintExplanation(code: string) {
  const guide = getLintIssueGuide(code);
  const classification = classifyIssueCode(code);
  const lines = [
    "neo-grace Lint Issue Guide",
    "=".repeat(26),
    `Code: ${guide.code}`,
    `Title: ${guide.title}`,
    `Classification: ${classification}`,
    "",
    "Explanation",
    guide.explanation,
    "",
    "Remediation",
    ...guide.remediation.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}
