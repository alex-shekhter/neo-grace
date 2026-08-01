// START_MODULE_CONTRACT
//   PURPOSE: Test fixtures and defect corpus
//   SCOPE: Temp projects, corpus seeds, and token-accounting helpers
//   DEPENDS: none
//   LINKS: M-TEST-SUPPORT
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ExpectedFinding
//   FindingSurface
//   LintAssertionMode
//   PATTERNS
//   PatternId
//   SeededDefect
//   byPattern
//   corpus
// END_MODULE_MAP
/**
 * Seeded-defect corpus for the agent-reliability track (D4).
 *
 * Not a test suite: (project, defective change, expected finding) triples that
 * later scorers measure against. Corpus IDs are stable — never renumber (D4 ratchet).
 *
 * Not published: package.json#files does not enumerate src/test-support/.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  GraceProjectBuilder,
  createTempProject,
} from "./fixtures";

export const PATTERNS = [
  "confidently-wrong",
  "self-referential-comparison",
  "regex-over-structure",
  "zero-or-more-swallow",
  "unthreaded-construct",
] as const;

export type PatternId = (typeof PATTERNS)[number];

/** Which check surface is expected to emit (or stay silent for) this finding. */
export type FindingSurface = "lint" | "health" | "gate" | "review";

export type LintAssertionMode = "current" | "target" | "final";

export type ExpectedFinding = {
  /** Stable finding / issue code a scorer looks for. */
  code: string;
  /** Relative path (posix) the finding should address, or "*" for project-level. */
  file: string;
  /**
   * true  — a correct detector must fire on this entry after apply().
   * false — a correct detector must stay silent (over-fire is a defect).
   */
  mustFire: boolean;
  /**
   * Which surface owns this finding. `review` means the detector is not built
   * yet; a scorer must not treat absence as a false negative for lint/health.
   */
  surface: FindingSurface;
  /** Required when surface === "lint". */
  lintMode?: LintAssertionMode;
  /** Required when lintMode is "target" or "final". */
  changeId?: string;
  /**
   * Required when surface === "health": the module whose health record carries
   * the code (`ngrace module show <moduleId> --with health --json`).
   */
  moduleId?: string;
};

export type SeededDefect = {
  /** Stable; never renumbered. D4's ratchet keys on this. */
  id: string;
  pattern: PatternId;
  /** Writes a temp project that lints clean; returns its root. */
  build: () => string;
  /** Applies the defective change in place. */
  apply: (root: string) => void;
  expected: ExpectedFinding[];
  /** Why this is a defect, in one sentence. */
  rationale: string;
};

function writeRelative(root: string, rel: string, contents: string): void {
  writeFileSync(path.join(root, rel), contents);
}

function readRelative(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

/** Minimal clean TS project shared by most entries. */
function baseCleanProject(prefix: string): string {
  return new GraceProjectBuilder(createTempProject(prefix))
    .module({
      id: "M-EXAMPLE",
      summary: "Example module.",
      path: "src/example.ts",
    })
    .governedFile({
      path: "src/example.ts",
      purpose: "Example runtime.",
      scope: "Corpus baseline.",
      depends: ["none"],
      links: ["M-EXAMPLE"],
      role: "RUNTIME",
      mapMode: "EXPORTS",
      mapEntries: ["run - Execute the example runtime."],
      body: `export function run() {
  // START_BLOCK_RUN
  console.info("[Example][run][BLOCK_RUN] run");
  return "ok";
  // END_BLOCK_RUN
}
`,
    })
    .file(
      "src/example.test.ts",
      `import { expect, test } from "bun:test";\ntest("example", () => expect(runResult()).toBe("ok"));\nfunction runResult() { return "ok"; }\n`,
    )
    .verification({
      moduleId: "M-EXAMPLE",
      commands: ["bun test src/example.test.ts"],
      scenarios: ["Example works."],
      markers: ["[Example][run][BLOCK_RUN]"],
    })
    .write();
}

// ---------------------------------------------------------------------------
// Pattern: confidently-wrong — asserting a fact never checked
// ---------------------------------------------------------------------------

const cw01: SeededDefect = {
  id: "corpus-cw-01-marker-claim",
  pattern: "confidently-wrong",
  rationale:
    "Verification requires a log marker that the source never emits, so a green test suite can still leave the claim unchecked.",
  build: () => baseCleanProject("corpus-cw-01-"),
  apply: (root) => {
    const verificationPath = path.join(root, ".ngrace/verification/main.xml");
    const xml = readFileSync(verificationPath, "utf8");
    writeFileSync(
      verificationPath,
      xml.replace(
        "[Example][run][BLOCK_RUN]",
        "[Example][run][BLOCK_NEVER_EMITTED]",
      ),
    );
  },
  expected: [
    {
      code: "health.required-log-marker-not-found",
      file: "src/example.ts",
      mustFire: true,
      surface: "health",
      moduleId: "M-EXAMPLE",
    },
    {
      // Same defective marker also fails the block-shape check; both codes are
      // part of this entry's ratchet (apply produces both at HEAD).
      code: "health.required-log-marker-block-not-found",
      file: "src/example.ts",
      mustFire: true,
      surface: "health",
      moduleId: "M-EXAMPLE",
    },
    {
      code: "review.confidently-wrong",
      file: ".ngrace/verification/main.xml",
      mustFire: true,
      surface: "review",
    },
  ],
};

const cw02: SeededDefect = {
  id: "corpus-cw-02-phantom-file-assertion",
  pattern: "confidently-wrong",
  rationale:
    "An approved plan TargetAssertions MustExist claims a path the change never creates, so success is asserted without production.",
  build: () =>
    new GraceProjectBuilder(createTempProject("corpus-cw-02-"))
      .module({ id: "M-EXAMPLE", path: "src/example.ts", summary: "Example" })
      .governedFile({
        path: "src/example.ts",
        links: ["M-EXAMPLE"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["run - Run."],
        body: "export function run() { return 1; }\n",
      })
      .verification({
        moduleId: "M-EXAMPLE",
        commands: ["echo ok"],
        scenarios: ["Example works."],
      })
      .change({
        changeId: "C-CORPUS-CW",
        specStatus: "approved",
        planStatus: "approved",
        planTargetAssertions: "<MustExist><Value>src/example.ts</Value></MustExist>",
      })
      .write(),
  apply: (root) => {
    const planPath = ".ngrace/changes/active/C-CORPUS-CW/plan.xml";
    const plan = readRelative(root, planPath);
    writeRelative(
      root,
      planPath,
      plan.replace(
        "<MustExist><Value>src/example.ts</Value></MustExist>",
        "<MustExist><Value>src/never-created.ts</Value></MustExist>",
      ),
    );
  },
  expected: [
    {
      code: "assertion.MustExist",
      file: "src/never-created.ts",
      mustFire: true,
      surface: "lint",
      lintMode: "target",
      changeId: "C-CORPUS-CW",
    },
    {
      code: "review.confidently-wrong",
      file: ".ngrace/changes/active/C-CORPUS-CW/plan.xml",
      mustFire: true,
      surface: "review",
    },
  ],
};

// ---------------------------------------------------------------------------
// Pattern: self-referential-comparison — one side derives from the thing under test
// ---------------------------------------------------------------------------

const sr01: SeededDefect = {
  id: "corpus-sr-01-test-reads-own-source",
  pattern: "self-referential-comparison",
  rationale:
    "The test reads the implementation file and asserts that text equals itself, so both sides of the comparison share one origin.",
  build: () => baseCleanProject("corpus-sr-01-"),
  apply: (root) => {
    writeRelative(
      root,
      "src/example.test.ts",
      `import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("source equals source", () => {
  const src = readFileSync(new URL("./example.ts", import.meta.url), "utf8");
  expect(src).toBe(src);
});
`,
    );
  },
  expected: [
    {
      code: "review.self-referential-comparison",
      file: "src/example.test.ts",
      mustFire: true,
      surface: "review",
    },
    // A pure existence lint of the project should still pass after apply —
    // this is a review defect, not a grammar defect.
    {
      code: "project.missing-grace",
      file: "*",
      mustFire: false,
      surface: "lint",
      lintMode: "current",
    },
  ],
};

const sr02: SeededDefect = {
  id: "corpus-sr-02-baseline-from-plan-body",
  pattern: "self-referential-comparison",
  rationale:
    "Baseline evidence is a MustMatchPattern against a string copied from the plan's own IntentSummary, so the plan is the oracle for itself.",
  build: () =>
    new GraceProjectBuilder(createTempProject("corpus-sr-02-"))
      .module({ id: "M-EXAMPLE", path: "src/example.ts", summary: "Example" })
      .governedFile({
        path: "src/example.ts",
        links: ["M-EXAMPLE"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["run - Run."],
        body: "export function run() { return 1; }\n",
      })
      .verification({
        moduleId: "M-EXAMPLE",
        commands: ["echo ok"],
        scenarios: ["Example works."],
      })
      .change({
        changeId: "C-CORPUS-SR",
        specStatus: "approved",
        planStatus: "approved",
      })
      .write(),
  apply: (root) => {
    const planPath = ".ngrace/changes/active/C-CORPUS-SR/plan.xml";
    const plan = readRelative(root, planPath);
    // Valid assertion kind: pattern matches text already present in this plan
    // (IntentSummary). Lint passes; the defect is that the oracle is the plan.
    writeRelative(
      root,
      planPath,
      plan.replace(
        /<BaselineAssertions>[\s\S]*?<\/BaselineAssertions>/,
        `<BaselineAssertions><MustMatchPattern><File>.ngrace/changes/active/C-CORPUS-SR/plan.xml</File><Pattern>Apply the fixture change</Pattern></MustMatchPattern></BaselineAssertions>`,
      ),
    );
  },
  expected: [
    {
      code: "review.self-referential-comparison",
      file: ".ngrace/changes/active/C-CORPUS-SR/plan.xml",
      mustFire: true,
      surface: "review",
    },
  ],
};

// ---------------------------------------------------------------------------
// Pattern: regex-over-structure — guard written as regex over structured text
// ---------------------------------------------------------------------------

const re01: SeededDefect = {
  id: "corpus-re-01-status-regex-on-xml",
  pattern: "regex-over-structure",
  rationale:
    "A helper greps for status= with a regex over flattened plan XML, which cannot distinguish attributes from prose or nested structure.",
  build: () => baseCleanProject("corpus-re-01-"),
  apply: (root) => {
    writeRelative(
      root,
      "src/check-status.ts",
      `/** Defective structural guard: regex over XML text. */
export function planIsApproved(xml: string): boolean {
  return /status\\s*=\\s*["']approved["']/i.test(xml);
}
`,
    );
  },
  expected: [
    {
      code: "review.regex-over-structure",
      file: "src/check-status.ts",
      mustFire: true,
      surface: "review",
    },
    {
      // Extra ungoverned source should not invent a missing-module error by itself
      code: "graph.module-without-linked-files",
      file: "src/check-status.ts",
      mustFire: false,
      surface: "lint",
      lintMode: "current",
    },
  ],
};

const re03: SeededDefect = {
  id: "corpus-re-03-nested-template-markers",
  pattern: "regex-over-structure",
  rationale:
    "hasGraceMarkers used a line-oriented marker regex after a stripper that mishandled nested template backticks inside ${}, so fixture markers in nested templates were treated as real markup.",
  build: () => baseCleanProject("corpus-re-03-"),
  apply: (root) => {
    // The defective shape: a helper whose nested templates leave START_* visible
    // when stripQuotedStrings does not handle ${...}. Detector for review surface;
    // the fixed stripper is proven in project-utils.test.ts. This entry records the
    // historical defect shape for D4 scoring.
    writeRelative(
      root,
      "src/scan-markers.ts",
      `/** Defective: line-oriented marker scan without template-interpolation awareness. */
export function fileLooksGoverned(source: string): boolean {
  return source.split("\\n").some((line) =>
    /^(\\s*)(\\/\\/|#)\\s*START_MODULE_CONTRACT/.test(line),
  );
}
`,
    );
    writeRelative(
      root,
      "src/fixture-helper.ts",
      `export function contract(mapMode: string, moduleMap = "") {
  return \`// START_MODULE_CONTRACT
// PURPOSE: Fixture.
// MAP_MODE: \${mapMode}
// END_MODULE_CONTRACT
\${moduleMap ? \`// START_MODULE_MAP
\${moduleMap}
// END_MODULE_MAP\` : ""}\`;
}
`,
    );
  },
  expected: [
    {
      code: "review.regex-over-structure",
      file: "src/scan-markers.ts",
      mustFire: true,
      surface: "review",
    },
    // After apply the helper's nested templates must not make the project emit
    // markup errors under current lint (fixed stripper / hasGraceMarkers).
    {
      code: "markup.missing-module-contract",
      file: "src/fixture-helper.ts",
      mustFire: false,
      surface: "lint",
      lintMode: "current",
    },
  ],
};

const re02: SeededDefect = {
  id: "corpus-re-02-export-regex-in-string",
  pattern: "regex-over-structure",
  rationale:
    "Export detection uses /export function (\\w+)/ on raw source, so a string or comment containing that text is treated as a real export.",
  build: () => baseCleanProject("corpus-re-02-"),
  apply: (root) => {
    writeRelative(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Example runtime.
//   SCOPE: Corpus baseline.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   run - Execute the example runtime.
// END_MODULE_MAP
const doc = "export function phantom() { return 0; }";
export function run() {
  // START_BLOCK_RUN
  console.info("[Example][run][BLOCK_RUN] run");
  return doc;
  // END_BLOCK_RUN
}
`,
    );
    writeRelative(
      root,
      "src/scan-exports.ts",
      `export function listExports(source: string): string[] {
  const names: string[] = [];
  const re = /export function (\\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]!);
  }
  return names;
}
`,
    );
  },
  expected: [
    {
      code: "review.regex-over-structure",
      file: "src/scan-exports.ts",
      mustFire: true,
      surface: "review",
    },
  ],
};

// ---------------------------------------------------------------------------
// Pattern: zero-or-more-swallow — empty list allows malformed children through
// ---------------------------------------------------------------------------

// Pattern 4 note: zo-01 is a positive control (existing cardinality check fires).
// zo-02 is the only genuine silent swallow at HEAD.
// corpus-zo-03 (A3.3 attempt): shapes tried and refused — see comment on the
// omitted entry below. Do not invent a third swallow without a shape that still
// lints clean after apply.

const zo01: SeededDefect = {
  id: "corpus-zo-01-empty-acceptance",
  pattern: "zero-or-more-swallow",
  rationale:
    "Empty AcceptanceCriteria is already rejected at HEAD by change.task-empty-acceptance — a load-bearing cardinality check for pattern 4 on tasks, not a silent swallow.",
  build: () =>
    new GraceProjectBuilder(createTempProject("corpus-zo-01-"))
      .module({ id: "M-EXAMPLE", path: "src/example.ts", summary: "Example" })
      .governedFile({
        path: "src/example.ts",
        links: ["M-EXAMPLE"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["run - Run."],
        body: "export function run() { return 1; }\n",
      })
      .verification({
        moduleId: "M-EXAMPLE",
        commands: ["echo ok"],
        scenarios: ["Example works."],
      })
      .change({
        changeId: "C-CORPUS-ZO",
        specStatus: "approved",
        planStatus: "approved",
      })
      .write(),
  apply: (root) => {
    const planPath = ".ngrace/changes/active/C-CORPUS-ZO/plan.xml";
    const plan = readRelative(root, planPath);
    writeRelative(
      root,
      planPath,
      plan.replace(
        /<AcceptanceCriteria>[\s\S]*?<\/AcceptanceCriteria>/,
        "<AcceptanceCriteria></AcceptanceCriteria>",
      ),
    );
  },
  expected: [
    {
      code: "change.task-empty-acceptance",
      file: ".ngrace/changes/active/C-CORPUS-ZO/plan.xml",
      mustFire: true,
      surface: "lint",
      lintMode: "current",
    },
  ],
};

const zo02: SeededDefect = {
  id: "corpus-zo-02-empty-depends-malformed-task",
  pattern: "zero-or-more-swallow",
  rationale:
    "T-002 has empty DependsOn while its title claims sequencing after T-001; zero-or-more DependsOn does not require a real dependency edge, and lint stays quiet.",
  build: () =>
    new GraceProjectBuilder(createTempProject("corpus-zo-02-"))
      .module({ id: "M-EXAMPLE", path: "src/example.ts", summary: "Example" })
      .governedFile({
        path: "src/example.ts",
        links: ["M-EXAMPLE"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["run - Run."],
        body: "export function run() { return 1; }\n",
      })
      .verification({
        moduleId: "M-EXAMPLE",
        commands: ["echo ok"],
        scenarios: ["Example works."],
      })
      .change({
        changeId: "C-CORPUS-ZO2",
        specStatus: "approved",
        planStatus: "approved",
      })
      .write(),
  apply: (root) => {
    const planPath = ".ngrace/changes/active/C-CORPUS-ZO2/plan.xml";
    const plan = readRelative(root, planPath);
    writeRelative(
      root,
      planPath,
      plan.replace(
        /<ImplementationPlan>[\s\S]*?<\/ImplementationPlan>/,
        `<ImplementationPlan><T-001><Title>First</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>First done.</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001><T-002><Title>Second after first</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Second done.</Criterion></AcceptanceCriteria><Verification><Command>echo 2</Command></Verification></T-002></ImplementationPlan>`,
      ),
    );
  },
  expected: [
    {
      code: "review.zero-or-more-swallow",
      file: ".ngrace/changes/active/C-CORPUS-ZO2/plan.xml",
      mustFire: true,
      surface: "review",
    },
  ],
};

// ---------------------------------------------------------------------------
// Pattern: unthreaded-construct — new construct not threaded through guarantees
// ---------------------------------------------------------------------------

const ut01: SeededDefect = {
  id: "corpus-ut-01-unknown-module-type",
  pattern: "unthreaded-construct",
  rationale:
    "Module Type is set to a novel value that older health and lint paths never specialized, so guarantees for known types do not apply.",
  build: () =>
    new GraceProjectBuilder(createTempProject("corpus-ut-01-"))
      .module({
        id: "M-EXAMPLE",
        path: "src/example.ts",
        summary: "Example",
        type: "CORE_LOGIC",
      })
      .governedFile({
        path: "src/example.ts",
        links: ["M-EXAMPLE"],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: ["run - Run."],
        body: "export function run() { return 1; }\n",
      })
      .verification({
        moduleId: "M-EXAMPLE",
        commands: ["echo ok"],
        scenarios: ["Example works."],
      })
      .write(),
  apply: (root) => {
    const graph = readRelative(root, ".ngrace/graph/main.xml");
    writeRelative(
      root,
      ".ngrace/graph/main.xml",
      graph.replace(
        "<Type>CORE_LOGIC</Type>",
        "<Type>QUANTUM_ORCHESTRATOR</Type>",
      ),
    );
  },
  expected: [
    {
      code: "graph.unknown-module-type",
      file: ".ngrace/graph/main.xml",
      mustFire: true,
      surface: "lint",
      lintMode: "current",
    },
  ],
};

const ut02: SeededDefect = {
  id: "corpus-ut-02-new-verification-field",
  pattern: "unthreaded-construct",
  rationale:
    "A new child element is added under V-M-* without threading it through health, query, or assertion evaluation, so it is stored but never load-bearing.",
  build: () => baseCleanProject("corpus-ut-02-"),
  apply: (root) => {
    const verificationPath = ".ngrace/verification/main.xml";
    const xml = readRelative(root, verificationPath);
    writeRelative(
      root,
      verificationPath,
      xml.replace(
        "</V-M-EXAMPLE>",
        "<ExperimentalBudget unit=\"ms\">50</ExperimentalBudget></V-M-EXAMPLE>",
      ),
    );
  },
  expected: [
    {
      code: "review.unthreaded-construct",
      file: ".ngrace/verification/main.xml",
      mustFire: true,
      surface: "review",
    },
    // Grammar today may allow unknown children as text noise; must not claim
    // the experimental budget was evaluated.
    {
      code: "assertion.command-not-evaluated",
      file: ".ngrace/verification/main.xml",
      mustFire: false,
      surface: "lint",
      lintMode: "current",
    },
  ],
};

/*
 * corpus-zo-03 attempt (A3.3) — refused, not landed.
 *
 * Shapes tried (each failed the "still lints clean after apply" bar, or was not a
 * true silent swallow of malformed children):
 * 1. Empty <Satisfies></Satisfies> on a task — grammar already requires at least
 *    one AC reference or rejects empty sections in several paths; not silent.
 * 2. Empty <GraphAnchors></GraphAnchors> under DurableScope — scope extraction
 *    and change.scope / coverage checks surface missing anchors; not silent.
 * 3. Empty <OutOfPlanScope></OutOfPlanScope> — optional section; empty is valid
 *    silence without a malformed child to swallow, so not pattern 4.
 * 4. Bare text child inside <DependsOn>garbage</DependsOn> — either rejected as
 *    invalid anchor shape or ignored without a stable defect code at HEAD.
 * 5. Duplicate empty <AcceptanceCriteria> siblings — first empty already fires
 *    change.task-empty-acceptance (zo-01 territory).
 *
 * No shape found that (a) lints clean after apply and (b) silently swallows a
 * malformed child. Gap remains recorded; do not invent a false positive entry.
 */

const ALL: SeededDefect[] = [
  cw01,
  cw02,
  sr01,
  sr02,
  re01,
  re02,
  re03,
  zo01,
  zo02,
  ut01,
  ut02,
];

/** Full corpus; order is stable by id sort for deterministic iteration. */
export function corpus(): SeededDefect[] {
  return [...ALL].sort((a, b) => a.id.localeCompare(b.id));
}

export function byPattern(pattern: PatternId): SeededDefect[] {
  return corpus().filter((entry) => entry.pattern === pattern);
}
