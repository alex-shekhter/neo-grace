// START_MODULE_CONTRACT
//   PURPOSE: Review surface
//   SCOPE: Process audits, pattern detectors, and review.* findings
//   DEPENDS: none
//   LINKS: M-REVIEW
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ATTEMPT_PAIR_FINDING_CODE
//   REVIEW_CATALOG
//   ReviewIssueGuide
//   ReviewIssueSeverity
//   allReviewCodes
//   guideFor
//   isReviewIssueCode
//   patternReviewCodes
// END_MODULE_MAP
/**
 * Review issue codes (D14). Must never be emitted by runLint — boundary test in
 * src/lint/core.test.ts. Codes are namespaced review.* only.
 *
 * Family A — five pattern codes named by the defect corpus (D4 trend).
 * Family B — process audits (§6.4) and process-shaped join findings (A36.2).
 * Family B never moves the five-pattern trend rate.
 */

export type ReviewIssueSeverity = "error" | "warning";

export type ReviewIssueGuide = {
  code: string;
  title: string;
  explanation: string;
  remediation: string[];
  severity: ReviewIssueSeverity;
  /** D4 pattern when this is a family-A code. */
  proposedBy?:
    | "confidently-wrong"
    | "self-referential-comparison"
    | "regex-over-structure"
    | "zero-or-more-swallow"
    | "unthreaded-construct";
  /** Defect or amendment that motivated this code. */
  derivedFrom?: string;
  /** "pattern" | "process-audit" | "join-process" */
  family: "pattern" | "process-audit" | "join-process";
};

/**
 * Live fail→pass attempt-pair finding code (C-SUBSTANTIATION-HONESTY).
 * Single spelling for catalog key, emitter, and skill-agreement tests — do not
 * re-type the string at call sites.
 */
export const ATTEMPT_PAIR_FINDING_CODE = "review.attempt-pair-identical-tree" as const;

export const REVIEW_CATALOG: Record<string, ReviewIssueGuide> = {
  // --- Family A: corpus pattern codes ---
  "review.confidently-wrong": {
    code: "review.confidently-wrong",
    title: "Claim Asserted Without Check",
    explanation:
      "A required marker, existence claim, or other fact is asserted without production evidence "
      + "that would make the claim load-bearing (pattern 1 / confidently-wrong).",
    remediation: [
      "Emit the claimed marker from runtime code, or remove the claim.",
      "Create the claimed path, or drop the MustExist assertion.",
    ],
    severity: "error",
    proposedBy: "confidently-wrong",
    derivedFrom: "corpus-cw-01 / corpus-cw-02",
    family: "pattern",
  },
  "review.self-referential-comparison": {
    code: "review.self-referential-comparison",
    title: "Self-Referential Comparison",
    explanation:
      "Both sides of a comparison share one origin — a test that asserts a value equals itself, "
      + "or a baseline that matches the plan's own body (pattern 2).",
    remediation: [
      "Compare against an independent oracle (expected fixture, public API output).",
      "Do not use the plan or the source under test as its own expected value.",
    ],
    severity: "error",
    proposedBy: "self-referential-comparison",
    derivedFrom: "corpus-sr-01 / corpus-sr-02",
    family: "pattern",
  },
  "review.regex-over-structure": {
    code: "review.regex-over-structure",
    title: "Regex Used As Structural Guard",
    explanation:
      "A guard is written as a regular expression over structured text (XML, source with strings) "
      + "where structure should be scanned (pattern 3).",
    remediation: [
      "Parse the structure (XML tree, language scanner) instead of grepping flattened text.",
      "If a heuristic is unavoidable, emit absence with a reason rather than a confident pass.",
    ],
    severity: "error",
    proposedBy: "regex-over-structure",
    derivedFrom: "corpus-re-01 / re-02 / re-03",
    family: "pattern",
  },
  "review.zero-or-more-swallow": {
    code: "review.zero-or-more-swallow",
    title: "Zero-Or-More List Swallows Malformed Intent",
    explanation:
      "An empty zero-or-more list (e.g. DependsOn) stays silent while titles or intent imply required "
      + "children (pattern 4 silent half).",
    remediation: [
      "Add the missing dependency edges, or rewrite titles that claim sequencing.",
      "Prefer cardinality checks where empty is never valid for the authoring intent.",
    ],
    severity: "error",
    proposedBy: "zero-or-more-swallow",
    derivedFrom: "corpus-zo-02",
    family: "pattern",
  },
  "review.unthreaded-construct": {
    code: "review.unthreaded-construct",
    title: "New Construct Not Threaded Through Guarantees",
    explanation:
      "A new element or field is stored without any reader making it load-bearing (pattern 5). "
      + "Corpus instance: experimental verification child with no health/assertion path.",
    remediation: [
      "Thread the construct through validators and consumers, or remove it.",
      "Do not leave authored fields that no surface consults.",
    ],
    severity: "error",
    proposedBy: "unthreaded-construct",
    derivedFrom: "corpus-ut-02",
    family: "pattern",
  },

  // --- Family B: process audits (§6.4) ---
  "review.scope-outside-write-scope": {
    code: "review.scope-outside-write-scope",
    title: "Changed File Outside ObservedWriteScope",
    explanation:
      "A changed path is not covered by the plan's ObservedWriteScope (mechanized §0.7.1 scope audit).",
    remediation: [
      "Add the path to ObservedWriteScope, or revert the out-of-scope write.",
      "Do not widen scope silently without plan approval.",
    ],
    severity: "error",
    derivedFrom: "§6.4 scope audit",
    family: "process-audit",
  },
  "review.test-assertion-weakened": {
    code: "review.test-assertion-weakened",
    title: "Test Assertion Weakened Or Removed",
    explanation:
      "A test file lost an assertion or replaced a strict check with a weaker one (mechanized §0.7.1).",
    remediation: [
      "Restore the assertion, or justify the change with a stronger replacement.",
      "Deleting tests that held a production change is presumed wrong until argued.",
    ],
    severity: "error",
    derivedFrom: "§6.4 test-weakening audit",
    family: "process-audit",
  },
  "review.compat-new-error": {
    code: "review.compat-new-error",
    title: "New Error Code On Previously Clean Fixture",
    explanation:
      "Lint issue-code set gained an error after the change on a fixture that was clean (mechanized §0.7.4).",
    remediation: [
      "Fix the check severity or the fixture expectation before merge.",
      "A new error on a previously-green project is release-breaking unless intentional.",
    ],
    severity: "error",
    derivedFrom: "§6.4 backward-compat audit",
    family: "process-audit",
  },
  "review.hunk-uncovered": {
    code: "review.hunk-uncovered",
    title: "Changed Hunk Has No Covering Test",
    explanation:
      "A changed hunk is not attributed to any defending test (hunk coverage attribution; full mutate out of scope).",
    remediation: [
      "Add a test that exercises the hunk, or document why coverage is not required.",
    ],
    severity: "warning",
    derivedFrom: "§6.4 hunk coverage",
    family: "process-audit",
  },
  [ATTEMPT_PAIR_FINDING_CODE]: {
    code: ATTEMPT_PAIR_FINDING_CODE,
    title: "Fail→Pass Attempt Pair Has Identical Non-.ngrace WriteEvidence Trees",
    explanation:
      "A fail→pass cursor attempt pair on the same task has no differing content digest among "
      + "non-`.ngrace/` paths in WriteEvidence on both events. The trees are identical outside "
      + "ledger artifacts the cursor writes on every command — so the red is not corroborated by "
      + "any authored content change (F9.10 / C-SUBSTANTIATION-HONESTY). Paths under `.ngrace/` are "
      + "excluded because they almost always differ and prove nothing. Severity is warning: "
      + "detection requiring adjudication, not automatic bundle failure. "
      + "cursor attempt stays quiet at write time.",
    remediation: [
      "If the fail was fabricated or nothing outside `.ngrace/` actually changed: record a free-text "
        + "reason on `ngrace gate verdict --change C-ID --outcome … --note \"findingId=<id>: <reason>\"` "
        + "keyed by this finding's stable findingId (D8.6). A bare \"reviewed\" flag is not enough.",
      "If the pair should have shown real work: re-run red-first honestly — do not stage a "
        + "retrospective red (F9.1). Record a real fail before the authored fix lands.",
      "Do not invent a finding-clearance ledger schema here; gate verdict --note carries the reason.",
    ],
    severity: "warning",
    derivedFrom: "F9.10 / F31 / F32 / C-SUBSTANTIATION-HONESTY",
    family: "process-audit",
  },

  // --- Family B: process-shaped join findings (A34.1 / A36.2) ---
  "review.counterpart-scope-mismatch": {
    code: "review.counterpart-scope-mismatch",
    title: "Record Scope Does Not Match Home Constraints",
    explanation:
      "A persisted element is scoped differently from the discovery/identity/lifecycle rules of its home "
      + "(A34.1 pair 1 / corr 61). Not a corpus pattern instance — process-shaped join (A36.2).",
    remediation: [
      "State the record's scope before choosing a home (standing rule 10 / A30.6).",
      "Use a home whose discovery path admits that scope.",
    ],
    severity: "error",
    derivedFrom: "A34.1 / correction 61",
    family: "join-process",
  },
  "review.counterpart-writer-missing": {
    code: "review.counterpart-writer-missing",
    title: "Exported Surface Has No Invocable Writer",
    explanation:
      "A record/export is readable or instructed in skill text but no invocable command writes it "
      + "(A34.1 pair 2 / corr 62). Not unthreaded-construct as corpus seeds it (ut-02) — A36.2.",
    remediation: [
      "Add an invocable write path, or remove the instruction that names a missing surface.",
    ],
    severity: "error",
    derivedFrom: "A34.1 / correction 62",
    family: "join-process",
  },
  "review.counterpart-reader-tolerates": {
    code: "review.counterpart-reader-tolerates",
    title: "Blocking Reader Treats Lint Error As Benign",
    explanation:
      "The lint catalog rejects a condition that a gate or reader still treats as usable data "
      + "(A34.1 pair 3 / corr 68).",
    remediation: [
      "Make the blocking reader refuse the same condition lint rejects.",
      "Unknown or invalid newest entries are absence with reason, never fallthrough.",
    ],
    severity: "error",
    derivedFrom: "A34.1 / correction 68",
    family: "join-process",
  },
  "review.counterpart-grandfather-gap": {
    code: "review.counterpart-grandfather-gap",
    title: "New Diagnostic Fires Permanently On Pre-Existing Artifacts",
    explanation:
      "A new diagnostic lights every pre-existing artifact that can never clear it "
      + "(A34.1 pair 4 / corr 69). Absence with reason is preferred over a permanent violation.",
    remediation: [
      "Distinguish absent-from-era from present-but-violating (D5).",
      "Do not require historical bundles to invent records that could not have existed.",
    ],
    severity: "error",
    derivedFrom: "A34.1 / correction 69",
    family: "join-process",
  },
};

/** True when a code is a review.* code (for D14 boundary assertions). */
export function isReviewIssueCode(code: string): boolean {
  return code.startsWith("review.");
}

/** Family-A pattern codes only — the D4 trend denominator. */
export function patternReviewCodes(): string[] {
  return Object.values(REVIEW_CATALOG)
    .filter((g) => g.family === "pattern")
    .map((g) => g.code)
    .sort();
}

export function allReviewCodes(): string[] {
  return Object.keys(REVIEW_CATALOG).sort();
}

export function guideFor(code: string): ReviewIssueGuide | undefined {
  return REVIEW_CATALOG[code];
}
