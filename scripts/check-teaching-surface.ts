import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeChangeBundleFixture, writeMinimalNgraceProject } from "../src/artifact/test-fixtures";
import { parseGraceXmlArtifact } from "../src/artifact/xml";
import { lintGraceProject } from "../src/lint/core";

const LEXICON_SKILLS = [
  "skills/ngrace/ngrace-spec/SKILL.md",
  "skills/ngrace/ngrace-plan/SKILL.md",
  "plugins/ngrace/skills/ngrace/ngrace-spec/SKILL.md",
  "plugins/ngrace/skills/ngrace/ngrace-plan/SKILL.md",
] as const;

const NAMED_NON_APPROVALS = ["looks good", "continue", "any question"] as const;

function refuseDiagnostic(file: string, rule: string, missingTokens: string): void {
  console.error(`refusal: ${file} — ${rule}: ${missingTokens}`);
}

function extractBlock(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1]! : null;
}

/** Return non-zero when spec or plan (either tree) lacks approval_lexicon, a named non-approval, or the F152 needle. */
export function checkApprovalLexicon(root: string): number {
  for (const relative of LEXICON_SKILLS) {
    const file = path.join(root, relative);
    if (!existsSync(file)) {
      refuseDiagnostic(relative, "approval lexicon (the approval_lexicon teaching exists)", "missing SKILL.md");
      return 1;
    }
    const block = extractBlock(readFileSync(file, "utf8"), "approval_lexicon");
    if (block === null) {
      refuseDiagnostic(relative, "approval lexicon (the approval_lexicon block is present)", "missing <approval_lexicon>");
      return 1;
    }
    for (const needle of NAMED_NON_APPROVALS) {
      if (!block.includes(needle)) {
        refuseDiagnostic(relative, "approval lexicon (every named non-approval is present)", `missing "${needle}"`);
        return 1;
      }
    }
    if (!block.includes("one approval request per message")) {
      refuseDiagnostic(relative, "approval lexicon (the one-approval-request needle is present)", 'missing "one approval request per message"');
      return 1;
    }
  }
  return 0;
}

function collectXmlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectXmlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".xml")) {
      files.push(entryPath);
    }
  }
  return files;
}

/** Return non-zero when polyglot V-M-* TraceAssertion count is not strictly greater than Marker, or Marker is zero. */
export function checkPolyglotDefault(root: string): number {
  const dir = path.join(root, "examples", "polyglot", ".ngrace", "verification");
  let marker = 0;
  let trace = 0;
  for (const file of collectXmlFiles(dir)) {
    const text = readFileSync(file, "utf8");
    const entryRe = /<(V-M-[A-Z0-9-]+)>([\s\S]*?)<\/\1>/g;
    for (const match of text.matchAll(entryRe)) {
      const body = match[2]!;
      if (/<Marker[\s>]/.test(body)) {
        marker += 1;
      }
      if (/<TraceAssertion[\s>]/.test(body)) {
        trace += 1;
      }
    }
  }
  if (marker < 1 || !(trace > marker)) {
    refuseDiagnostic(
      path.join(root, "examples", "polyglot", ".ngrace", "verification"),
      "polyglot default (TraceAssertion count strictly greater than Marker count with at least one Marker)",
      `markers ${marker}, TraceAssertions ${trace}`,
    );
    return 1;
  }
  return 0;
}

const TREES = ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const;
const TEMPLATE_KINDS = [
  "design-context-template.xml",
  "design-system-template.xml",
  "migration-report-template.xml",
] as const;
const PINNED_MIGRATION_CHILDREN = [
  "Backup",
  "Validation",
  "GitPreflight",
  "CleanupProposal",
  "DirtyOrNonGitRiskAcknowledgement",
  "CleanupResults",
] as const;
const CLAIMED_SKILLS = [
  "ngrace-spec",
  "ngrace-plan",
  "ngrace-design",
  "ngrace-verification",
  "ngrace-cli",
] as const;
const FILL_CHANGE_ID = "C-FILL";

function collectNamedFiles(dir: string, filename: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectNamedFiles(entryPath, filename));
    } else if (entry.isFile() && entry.name === filename) {
      files.push(entryPath);
    }
  }
  return files;
}

function fillPlaceholders(xml: string): string {
  return xml.replaceAll("C-CHANGE-ID", FILL_CHANGE_ID).replace(/\$[A-Z0-9_]+/g, "filled");
}

function writeTempFile(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function artifactIssues(tempRoot: string, filename: string): Array<{ severity: string }> {
  return lintGraceProject(tempRoot).issues.filter(
    (issue) => path.basename(issue.file) === filename && (issue.severity === "error" || issue.severity === "warning"),
  );
}

function lintFilledDesignContext(filled: string): number {
  const temp = mkdtempSync(path.join(os.tmpdir(), "ngrace-fill-design-context-"));
  try {
    writeMinimalNgraceProject(temp);
    writeChangeBundleFixture(temp, {
      changeId: FILL_CHANGE_ID,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      designContext: filled,
    });
    return artifactIssues(temp, "design-context.xml").length === 0 ? 0 : 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function lintFilledDesignSystem(filled: string): number {
  const temp = mkdtempSync(path.join(os.tmpdir(), "ngrace-fill-design-system-"));
  try {
    writeMinimalNgraceProject(temp);
    writeTempFile(temp, path.join(".ngrace", "context", "design-system.xml"), filled);
    for (const match of filled.matchAll(/<TokenSource>([\s\S]*?)<\/TokenSource>/g)) {
      const authored = match[1]!.trim();
      if (authored && !authored.includes("..") && !path.isAbsolute(authored)) {
        writeTempFile(temp, authored, "/* token source planted for fill-and-lint */\n");
      }
    }
    return artifactIssues(temp, "design-system.xml").length === 0 ? 0 : 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function checkFilledMigrationReport(filled: string): number {
  const parsed = parseGraceXmlArtifact("migration-report-template.xml", filled);
  if (parsed.root === null || parsed.issues.length > 0) {
    return 1;
  }
  for (const child of PINNED_MIGRATION_CHILDREN) {
    if (!filled.includes(`<${child}`)) {
      return 1;
    }
  }
  return 0;
}

/** Return non-zero when a filled design-context/design-system plant is missing or dirty, or migration-report is not well-formed or loses a pinned child. */
export function checkTemplateFill(root: string): number {
  for (const kind of TEMPLATE_KINDS) {
    const found: string[] = [];
    for (const tree of TREES) {
      const matches = collectNamedFiles(path.join(root, tree), kind);
      if (matches.length === 0) {
        refuseDiagnostic(`${tree}/${kind}`, "template fill (a filled plant exists in both trees)", `missing ${kind} under ${tree}`);
        return 1;
      }
      found.push(...matches);
    }
    for (const file of found) {
      const filled = fillPlaceholders(readFileSync(file, "utf8"));
      if (kind === "design-context-template.xml" && lintFilledDesignContext(filled) !== 0) {
        refuseDiagnostic(file, `template fill (the filled ${kind} lints clean)`, "the filled plant produced lint issues");
        return 1;
      }
      if (kind === "design-system-template.xml" && lintFilledDesignSystem(filled) !== 0) {
        refuseDiagnostic(file, `template fill (the filled ${kind} lints clean)`, "the filled plant produced lint issues");
        return 1;
      }
      if (kind === "migration-report-template.xml" && checkFilledMigrationReport(filled) !== 0) {
        refuseDiagnostic(file, `template fill (the filled ${kind} is well-formed and keeps its pinned children)`, "not well-formed or a pinned child is missing");
        return 1;
      }
    }
  }
  return 0;
}

/** Return non-zero when a cited references/*.xml path is missing from either tree of an edited skill. */
export function checkClaimedShapes(root: string): number {
  for (const tree of TREES) {
    for (const skill of CLAIMED_SKILLS) {
      const skillDir = path.join(root, tree, skill);
      const skillMd = path.join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) {
        refuseDiagnostic(`${tree}/${skill}/SKILL.md`, "claimed shapes (the skill file exists)", "missing SKILL.md");
        return 1;
      }
      const cites = readFileSync(skillMd, "utf8").match(/references\/[A-Za-z0-9._-]+\.xml/g) ?? [];
      for (const relative of cites) {
        if (!existsSync(path.join(skillDir, relative))) {
          refuseDiagnostic(`${tree}/${skill}/SKILL.md`, "claimed shapes (every cited references/*.xml path exists)", `missing ${relative}`);
          return 1;
        }
      }
    }
  }
  return 0;
}

function extractTagBodies(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]!);
}

/** Return non-zero when specXml names neither README.md nor examples/ in Goal, Constraint, or NonGoal. */
export function checkDocsAndExamplesDecision(specXml: string, file = "spec.xml"): number {
  const decisionText = [
    ...extractTagBodies(specXml, "Goal"),
    ...extractTagBodies(specXml, "Constraint"),
    ...extractTagBodies(specXml, "NonGoal"),
  ].join("\n");
  if (!decisionText.includes("README.md") || !decisionText.includes("examples/")) {
    const missing = [
      !decisionText.includes("README.md") ? "README.md" : null,
      !decisionText.includes("examples/") ? "examples/" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    refuseDiagnostic(file, "docs-and-examples decision (a Goal, Constraint or NonGoal decides README.md and examples/)", `missing ${missing}`);
    return 1;
  }
  return 0;
}

function checkActiveSpecs(root: string): number {
  const activeDir = path.join(root, ".ngrace", "changes", "active");
  if (!existsSync(activeDir)) {
    return 0;
  }
  for (const entry of readdirSync(activeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const spec = path.join(activeDir, entry.name, "spec.xml");
    if (!existsSync(spec)) {
      continue;
    }
    if (checkDocsAndExamplesDecision(readFileSync(spec, "utf8"), spec) !== 0) {
      return 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// C-TAUGHT-RULES T-001/T-002: the governed record's token universality scan
// over the four governed skills in both trees. Composed into
// runTeachingSurfaceCheck in T-002, ahead of the shipped checks, after the
// shipped attempt-kind's record citation was dropped (T-002 item 21).
// ---------------------------------------------------------------------------

const GOVERNED_SKILLS = ["ngrace-spec", "ngrace-plan", "ngrace-execute", "ngrace-reviewer"] as const;
const GOVERNED_TREES = ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const;
const RECORD_FILE_NAMES = [
  "decisions.xml",
  "findings.xml",
  "findings-retired.xml",
  "rulings.xml",
  "rulings-retired.xml",
  "registry.xml",
  "registry-retired.xml",
] as const;
const F_TOKEN_RE = /\bF\d+(?:\.\d+)*\b/g;
const D_TOKEN_RE = /\bD\d+(?:\.\d+)*\b/g;

function refuseRecordToken(file: string, rule: string, token: string): void {
  console.error(
    `checkRecordTokens refusal: ${file} — record-token universality (${rule}): ${token}`,
  );
}

/** Return non-zero when a governed skill (either tree) carries RM-GOVERNED-PATH, a governed record file name, any F-token, or a D-token not immediately preceded by an RM- plan id; decisions.md is the named exception. */
export function checkRecordTokens(root: string): number {
  for (const tree of GOVERNED_TREES) {
    for (const skill of GOVERNED_SKILLS) {
      const relative = `${tree}/${skill}/SKILL.md`;
      const file = path.join(root, relative);
      if (!existsSync(file)) {
        refuseRecordToken(relative, "the governed skill file exists", "missing SKILL.md");
        return 1;
      }
      const text = readFileSync(file, "utf8");
      if (text.includes("RM-GOVERNED-PATH")) {
        refuseRecordToken(relative, "no RM- plan id citation", "RM-GOVERNED-PATH");
        return 1;
      }
      for (const name of RECORD_FILE_NAMES) {
        if (text.includes(name)) {
          refuseRecordToken(relative, "no governed record file name", name);
          return 1;
        }
      }
      for (const match of text.matchAll(F_TOKEN_RE)) {
        refuseRecordToken(relative, "no F-token citation", match[0]);
        return 1;
      }
      for (const match of text.matchAll(D_TOKEN_RE)) {
        if (!/RM-[A-Z0-9-]+ $/.test(text.slice(0, match.index ?? 0))) {
          refuseRecordToken(relative, "no bare D-token (plan-id-pinned form only)", match[0]);
          return 1;
        }
      }
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// C-TAUGHT-RULES T-004: the taught-rules surface check. Per rule, per tree,
// one load-bearing token inside the rule's named section; the refusal names
// the file, the section and the missing token.
// ---------------------------------------------------------------------------

const TAUGHT_RULES: Array<{
  skill: string;
  section: string;
  kind?: string;
  token: string;
}> = [
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "named baseline commit" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "archive arrival" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "applied-archive state" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "every module list" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "shipped parser" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "through a pipe" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "only ceiling" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "shipped engine" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "both directions" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "only against an active" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "what must the close write" },
  { skill: "ngrace-spec", section: "clarifications", token: "declared nowhere else" },
  { skill: "ngrace-spec", section: "workflow", token: "stand in for the interview" },
  { skill: "ngrace-spec", section: "shape_sources", token: "rewritten wholesale" },
  { skill: "ngrace-spec", section: "status_rules", token: "revised in place" },
  { skill: "ngrace-plan", section: "must_do", token: "placeholders" },
  { skill: "ngrace-plan", section: "must_do", token: "re-home" },
  { skill: "ngrace-plan", section: "must_do", token: "on a prototype" },
  { skill: "ngrace-plan", section: "must_do", token: "other than the author" },
  { skill: "ngrace-plan", section: "must_do", token: "assert only what the bundle leaves unchanged" },
  { skill: "ngrace-plan", section: "must_do", token: "structurally redundant" },
  { skill: "ngrace-plan", section: "must_do", token: "faithful post-close copy" },
  { skill: "ngrace-plan", section: "must_do", token: "red-direction fixture" },
  { skill: "ngrace-plan", section: "must_do", token: "change.graph-anchors-miss-write-scope" },
  { skill: "ngrace-plan", section: "must_do", token: "change.graph-anchors-pending-file" },
  { skill: "ngrace-plan", section: "must_do", token: "the close writes" },
  { skill: "ngrace-spec", section: "shape_sources", token: "relative to this skill's directory" },
  { skill: "ngrace-spec", section: "shape_sources", token: "codes are namespaced" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "uncloseable bundle" },
  { skill: "ngrace-plan", section: "command_phase_rules", token: "stage the task runs" },
  { skill: "ngrace-execute", section: "execution_rules", token: "no declared task is in scope" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only cycle" },
  { skill: "ngrace-execute", section: "execution_rules", token: "Atomic Mechanism Exception" },
  { skill: "ngrace-execute", section: "execution_rules", token: "reverting a landed mechanism" },
  { skill: "ngrace-execute", section: "execution_rules", token: "engine-written" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "report evidence" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "interleaves them" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "simultaneous red" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "after the edit that greens it" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "artifact whole" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "is a claim" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "forced-file set" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "both directions" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "faithful copy" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "any later lawful move of the record" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "red-direction fixture" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "read the shape first" },
  { skill: "ngrace-plan", section: "must_do", token: "tree state its task leaves" },
  { skill: "ngrace-plan", section: "must_do", token: "excludes every earlier task's files" },
  { skill: "ngrace-plan", section: "must_do", token: "evaluated by nothing before the plan is approved" },
  { skill: "ngrace-plan", section: "must_do", token: "to a test slice, never a whole file" },
  { skill: "ngrace-plan", section: "must_do", token: "skips the bundle's own" },
  { skill: "ngrace-plan", section: "must_do", token: "by identity" },
  { skill: "ngrace-plan", section: "must_do", token: "design-context.xml" },
  { skill: "ngrace-plan", section: "must_do", token: "gate approve --artifact plan" },
  { skill: "ngrace-plan", section: "validation", token: "does not require an open epoch" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "status reset to draft" },
  { skill: "ngrace-plan", section: "must_do", token: ".git/info/exclude" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "exits non-zero" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "does not require an open epoch" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "selected-baseline lint" },
  { skill: "ngrace-execute", section: "execution_rules", token: "gate.apply.no-verdict" },
  { skill: "ngrace-execute", section: "execution_rules", token: "does not open a fresh epoch" },
  { skill: "ngrace-execute", section: "execution_rules", token: "hidden by the default severity" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "review.attempt-pair-unpaired-pass" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "namespace import" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "opens a new epoch" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "terminal", token: "stays on the last task" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "silently under-counts" },
  { skill: "ngrace-execute", section: "recovery_decision_table", token: "approved plan's own baseline assertion is false at HEAD" },
  { skill: "ngrace-spec", section: "status_rules", token: "skips the bundle's own" },
  { skill: "ngrace-spec", section: "status_rules", token: "by identity" },
  { skill: "ngrace-spec", section: "status_rules", token: "design-context.xml" },
  { skill: "ngrace-spec", section: "workflow", token: "skips the bundle's own" },
  { skill: "ngrace-spec", section: "workflow", token: "by identity" },
  { skill: "ngrace-spec", section: "docs_and_examples", token: "replace this placeholder" },
  { skill: "ngrace-spec", section: "workflow", token: "never hand-type an id or its suffix" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "--supersedes" },
  { skill: "ngrace-reviewer", section: "mechanized_first", token: "skips the bundle's own" },
  { skill: "ngrace-reviewer", section: "mechanized_first", token: "by identity" },
  { skill: "ngrace-reviewer", section: "mechanized_first", token: "design-context.xml" },
  { skill: "ngrace-plan", section: "must_do", token: "assertion.command-not-evaluated" },
  { skill: "ngrace-plan", section: "validation", token: "assertion.change-required" },
  { skill: "ngrace-plan", section: "must_do", token: "review.confidently-wrong" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "maps only criteria without" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "task that owns the surface" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only correction" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "attributes to it" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "the intended task" },

  { skill: "ngrace-plan", section: "must_do", token: "commit the approved plan" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "the event carries no" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "archived predecessor's draft" },
  { skill: "ngrace-spec", section: "shape_sources", token: "exactly one of a bare slug" },
  { skill: "ngrace-plan", section: "must_do", token: "never from a hand-rolled reader" },
  { skill: "ngrace-execute", section: "execution_rules", token: "fold again before" },
  { skill: "ngrace-execute", section: "execution_rules", token: "a faithful throwaway copy may invoke" },
  { skill: "ngrace-execute", section: "execution_rules", token: "one guard per pair" },
  { skill: "ngrace-spec", section: "shape_sources", token: "bounded diff" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "states the relation" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "list what the deliverable moves" },
  { skill: "ngrace-spec", section: "ceremony_tiers", token: "never which files are in scope" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "the pinned number becomes the relation" },
  { skill: "ngrace-plan", section: "must_do", token: "narrowest instrument" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "close-time only" },
  { skill: "ngrace-execute", section: "execution_rules", token: "close-time only" },
  { skill: "ngrace-spec", section: "shape_sources", token: "overwriting the minted skeleton" },
  { skill: "ngrace-spec", section: "shape_sources", token: "carried verbatim" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "predecessor's archive arrival" },
];

// ---------------------------------------------------------------------------
// C-FLUSH-AND-TEACH T-003: the F239 cli-token form check. The rule sentence
// lives in ngrace-cli shape_sources in both trees; no SKILL.md under either
// tree may carry the bare `argv token `explain`` form the finding measured.
// ---------------------------------------------------------------------------

const BARE_CLI_TOKEN = "argv token `explain`";

function refuseCliToken(file: string, rule: string, token: string): void {
  console.error(`checkCliTokenForms refusal: ${file} — cli token forms (${rule}): ${token}`);
}

/** Every skill's SKILL.md under a tree directory, found on disk and sorted — not a fixed list of skills. */
function skillFilesUnder(root: string, tree: string): string[] {
  const treeDir = path.join(root, tree);
  return readdirSync(treeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(treeDir, entry.name, "SKILL.md")))
    .map((entry) => `${tree}/${entry.name}/SKILL.md`)
    .sort();
}

/** Return non-zero when ngrace-cli shape_sources lacks the F239 rule token in either tree, or any named SKILL.md carries the bare argv-token form. */
export function checkCliTokenForms(root: string): number {
  for (const tree of GOVERNED_TREES) {
    const treeDir = path.join(root, tree);
    if (!existsSync(treeDir)) {
      refuseCliToken(tree, "the skill tree exists", "missing directory");
      return 1;
    }
    const skills = skillFilesUnder(root, tree);
    if (skills.length === 0) {
      refuseCliToken(tree, "at least one skill exists under the tree", "no SKILL.md found");
      return 1;
    }
    for (const relative of skills) {
      if (readFileSync(path.join(root, relative), "utf8").includes(BARE_CLI_TOKEN)) {
        refuseCliToken(relative, "no bare argv-token explain form", BARE_CLI_TOKEN);
        return 1;
      }
    }
    const cliRelative = `${tree}/ngrace-cli/SKILL.md`;
    const cliFile = path.join(root, cliRelative);
    if (!existsSync(cliFile)) {
      refuseCliToken(cliRelative, "ngrace-cli exists", "missing SKILL.md");
      return 1;
    }
    const section = extractBlock(readFileSync(cliFile, "utf8"), "shape_sources");
    if (section === null || !section.includes("names the command that takes it")) {
      refuseCliToken(
        cliRelative,
        "the F239 rule is taught in <shape_sources>",
        'missing token "names the command that takes it"',
      );
      return 1;
    }
  }
  return 0;
}

/** Return non-zero when a taught rule's load-bearing token is missing from its named section home in either tree. */
export function checkTaughtRules(root: string): number {
  for (const tree of GOVERNED_TREES) {
    for (const skill of GOVERNED_SKILLS) {
      const relative = `${tree}/${skill}/SKILL.md`;
      const file = path.join(root, relative);
      if (!existsSync(file)) {
        refuseDiagnostic(relative, "taught rules (the governed skill file exists)", "missing SKILL.md");
        return 1;
      }
      const text = readFileSync(file, "utf8");
      for (const rule of TAUGHT_RULES) {
        if (rule.skill !== skill) {
          continue;
        }
        const section = extractBlock(text, rule.section);
        if (section === null) {
          refuseDiagnostic(
            relative,
            `taught rules (the rule is taught in <${rule.section}>)`,
            `missing section <${rule.section}> and token "${rule.token}"`,
          );
          return 1;
        }
        const body = rule.kind
          ? (section.match(new RegExp(`<kind id="${rule.kind}">([\\s\\S]*?)</kind>`))?.[1] ?? "")
          : section;
        if (!body.includes(rule.token)) {
          refuseDiagnostic(
            relative,
            `taught rules (the rule is taught in <${rule.section}>${rule.kind ? ` kind ${rule.kind}` : ""})`,
            `missing token "${rule.token}"`,
          );
          return 1;
        }
      }
    }
  }
  return 0;
}

const STALE_REVIEW_CLAIM = "and (when that file changed) decisions.md is expected";

function refuseStaleReviewClaim(file: string, rule: string, token: string): void {
  console.error(`checkStaleReviewClaims refusal: ${file} — stale review-scope claim (${rule}): ${token}`);
}

/** Return non-zero when any SKILL.md under either tree still carries the stale review-scope claim. The walk is every SKILL.md on disk, not the four governed skills, so a stale copy planted in a skill the spec did not name reddens it. */
export function checkStaleReviewClaims(root: string): number {
  for (const tree of GOVERNED_TREES) {
    const treeDir = path.join(root, tree);
    if (!existsSync(treeDir)) {
      refuseStaleReviewClaim(tree, "the skill tree exists", "missing directory");
      return 1;
    }
    for (const relative of skillFilesUnder(root, tree)) {
      if (readFileSync(path.join(root, relative), "utf8").includes(STALE_REVIEW_CLAIM)) {
        refuseStaleReviewClaim(relative, "no stale review-scope claim", STALE_REVIEW_CLAIM);
        return 1;
      }
    }
  }
  return 0;
}

export function runTeachingSurfaceCheck(root: string): number {
  if (checkRecordTokens(root) !== 0) {
    return 1;
  }
  if (checkStaleReviewClaims(root) !== 0) {
    return 1;
  }
  if (checkTaughtRules(root) !== 0) {
    return 1;
  }
  if (checkCliTokenForms(root) !== 0) {
    return 1;
  }
  if (checkApprovalLexicon(root) !== 0) {
    return 1;
  }
  if (checkPolyglotDefault(root) !== 0) {
    return 1;
  }
  if (checkTemplateFill(root) !== 0) {
    return 1;
  }
  if (checkClaimedShapes(root) !== 0) {
    return 1;
  }
  return checkActiveSpecs(root);
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  if (process.argv.includes("check")) {
    process.exitCode = runTeachingSurfaceCheck(root);
  } else {
    console.error("usage: check-teaching-surface.ts check");
    process.exitCode = 2;
  }
}
