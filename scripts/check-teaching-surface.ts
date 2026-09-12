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
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "explicit generous timeout" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "shipped engine" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "both directions" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "only against an active" },
  { skill: "ngrace-spec", section: "clarifications", token: "declared nowhere else" },
  { skill: "ngrace-spec", section: "workflow", token: "stand in for the interview" },
  { skill: "ngrace-spec", section: "shape_sources", token: "rewritten wholesale" },
  { skill: "ngrace-spec", section: "status_rules", token: "revised in place" },
  { skill: "ngrace-plan", section: "must_do", token: "placeholders" },
  { skill: "ngrace-plan", section: "must_do", token: "re-home" },
  { skill: "ngrace-plan", section: "must_do", token: "on a prototype" },
  { skill: "ngrace-plan", section: "must_do", token: "other than the author" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "uncloseable bundle" },
  { skill: "ngrace-plan", section: "command_phase_rules", token: "stage the task runs" },
  { skill: "ngrace-execute", section: "execution_rules", token: "no declared task is in scope" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only cycle" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "report evidence" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "artifact whole" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "is a claim" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "forced-file set" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "both directions" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "faithful copy" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "life cycle produces next" },
];

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

export function runTeachingSurfaceCheck(root: string): number {
  if (checkRecordTokens(root) !== 0) {
    return 1;
  }
  if (checkTaughtRules(root) !== 0) {
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
