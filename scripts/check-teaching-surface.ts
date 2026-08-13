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

function extractBlock(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1]! : null;
}

/** Return non-zero when spec or plan (either tree) lacks approval_lexicon or a named non-approval. */
export function checkApprovalLexicon(root: string): number {
  for (const relative of LEXICON_SKILLS) {
    const file = path.join(root, relative);
    if (!existsSync(file)) {
      return 1;
    }
    const block = extractBlock(readFileSync(file, "utf8"), "approval_lexicon");
    if (block === null) {
      return 1;
    }
    for (const needle of NAMED_NON_APPROVALS) {
      if (!block.includes(needle)) {
        return 1;
      }
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
        return 1;
      }
      found.push(...matches);
    }
    for (const file of found) {
      const filled = fillPlaceholders(readFileSync(file, "utf8"));
      if (kind === "design-context-template.xml" && lintFilledDesignContext(filled) !== 0) {
        return 1;
      }
      if (kind === "design-system-template.xml" && lintFilledDesignSystem(filled) !== 0) {
        return 1;
      }
      if (kind === "migration-report-template.xml" && checkFilledMigrationReport(filled) !== 0) {
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
        return 1;
      }
      const cites = readFileSync(skillMd, "utf8").match(/references\/[A-Za-z0-9._-]+\.xml/g) ?? [];
      for (const relative of cites) {
        if (!existsSync(path.join(skillDir, relative))) {
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
export function checkDocsAndExamplesDecision(specXml: string): number {
  const decisionText = [
    ...extractTagBodies(specXml, "Goal"),
    ...extractTagBodies(specXml, "Constraint"),
    ...extractTagBodies(specXml, "NonGoal"),
  ].join("\n");
  if (!decisionText.includes("README.md") || !decisionText.includes("examples/")) {
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
    if (checkDocsAndExamplesDecision(readFileSync(spec, "utf8")) !== 0) {
      return 1;
    }
  }
  return 0;
}

export function runTeachingSurfaceCheck(root: string): number {
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
