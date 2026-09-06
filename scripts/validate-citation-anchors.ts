#!/usr/bin/env bun
/**
 * Citation-anchor uniqueness gate for
 * docs/plans/active/RM-GOVERNED-PATH/decisions.md.
 *
 * Exit 0 only when every F/D heading at any ATX level has exactly one
 * immediately preceding empty <a id name> whose id equals the delimiter-
 * preserving slug grammar and equals name, ids are unique, and every
 * in-scope ](#f…) / ](#d…) fragment resolves to exactly one of those ids.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_TARGET = "docs/plans/active/RM-GOVERNED-PATH/decisions.md";

const TOKENIZER_RE = /^#{1,6} [FD]\d/;
const HEADING_RE = /^(#{1,6}) ([FD][0-9]+(?:\.[0-9]+)*)(\S*)(.*)$/;
const ANCHOR_RE = /^<a id="([^"]+)" name="([^"]+)"><\/a>$/;
const FRAG_RE = /\]\(#([fd][0-9][0-9a-z.-]*)\)/g;
const PANDOC_RE = /\{#[^}]+\}/;
const ANCHOR_IN_HEADING_RE = /<a\b/i;

export type CitationAnchorFinding = {
  code: string;
  line: number;
  message: string;
};

type Heading = {
  line: number; // 1-based
  index: number; // 0-based in lines
  token: string;
  after: string;
  rest: string;
  primary: string;
  expectedSlug: string;
  text: string;
};

export function splitMarkdownLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function expectedSlugFor(
  token: string,
  after: string,
  rest: string,
  duplicateCount: number,
): string {
  const primary = token.toLowerCase();
  if (duplicateCount === 1) {
    return primary;
  }
  const headingBody = token + after + rest;
  const firstWs = headingBody.split(/\s+/)[0] ?? "";
  if (firstWs === `${token}'s`) {
    return firstWs.replace(/'/g, "").toLowerCase();
  }
  const remainder = headingBody.slice(firstWs.length).trim();
  const nextWord = remainder.split(/\s+/)[0] ?? "";
  const word = nextWord.replace(/[^A-Za-z0-9]+$/g, "").toLowerCase();
  if (word === "correction" || word === "amendment") {
    return `${primary}-${word}`;
  }
  return primary;
}

function parseHeadings(lines: string[]): Heading[] {
  const parsed: Omit<Heading, "expectedSlug">[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!TOKENIZER_RE.test(text)) {
      continue;
    }
    const m = HEADING_RE.exec(text);
    if (!m) {
      continue;
    }
    const token = m[2];
    parsed.push({
      line: i + 1,
      index: i,
      token,
      after: m[3],
      rest: m[4],
      primary: token.toLowerCase(),
      text,
    });
  }
  const counts = new Map<string, number>();
  for (const h of parsed) {
    counts.set(h.primary, (counts.get(h.primary) ?? 0) + 1);
  }
  return parsed.map((h) => ({
    ...h,
    expectedSlug: expectedSlugFor(h.token, h.after, h.rest, counts.get(h.primary) ?? 1),
  }));
}

export function validateCitationAnchors(
  markdown: string,
  fileLabel = DEFAULT_TARGET,
): CitationAnchorFinding[] {
  const lines = splitMarkdownLines(markdown);
  const headings = parseHeadings(lines);
  const findings: CitationAnchorFinding[] = [];
  const ids = new Map<string, number>();

  for (const h of headings) {
    if (ANCHOR_IN_HEADING_RE.test(h.text)) {
      findings.push({
        code: "html-in-heading",
        line: h.line,
        message: `${fileLabel}:${h.line}: F/D heading contains an HTML <a> tag; anchors belong on the preceding line`,
      });
    }
    if (PANDOC_RE.test(h.text)) {
      findings.push({
        code: "pandoc-heading-id",
        line: h.line,
        message: `${fileLabel}:${h.line}: F/D heading has a {#id} suffix; GitHub does not honour pandoc/kramdown ids`,
      });
    }
    const prev = h.index > 0 ? lines[h.index - 1] : "";
    const am = ANCHOR_RE.exec(prev);
    if (!am) {
      findings.push({
        code: "missing-anchor",
        line: h.line,
        message: `${fileLabel}:${h.line}: F/D heading has no immediately preceding empty <a id name> anchor`,
      });
      continue;
    }
    const id = am[1];
    const name = am[2];
    const anchorLine = h.line - 1;
    if (id !== name) {
      findings.push({
        code: "id-name-disagree",
        line: anchorLine,
        message: `${fileLabel}:${anchorLine}: anchor id "${id}" disagrees with name "${name}"`,
      });
    }
    if (id !== h.expectedSlug) {
      findings.push({
        code: "slug-mismatch",
        line: anchorLine,
        message: `${fileLabel}:${anchorLine}: anchor id "${id}" does not match slug grammar (expected "${h.expectedSlug}")`,
      });
    }
    const seen = ids.get(id);
    if (seen !== undefined) {
      findings.push({
        code: "duplicate-id",
        line: anchorLine,
        message: `${fileLabel}:${anchorLine}: duplicate anchor id "${id}" (first at line ${seen})`,
      });
    } else {
      ids.set(id, anchorLine);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    FRAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FRAG_RE.exec(line)) !== null) {
      const dest = m[1];
      if (!ids.has(dest)) {
        findings.push({
          code: "unresolved-fragment",
          line: i + 1,
          message: `${fileLabel}:${i + 1}: in-scope fragment ](#${dest}) does not resolve to an existing F/D anchor id`,
        });
      }
    }
  }

  return findings;
}

export function validateCitationAnchorsFile(filePath: string): {
  file: string;
  findings: CitationAnchorFinding[];
} {
  if (!existsSync(filePath)) {
    return {
      file: filePath,
      findings: [
        {
          code: "missing-file",
          line: 0,
          message: `citation-anchors: file not found: ${filePath}`,
        },
      ],
    };
  }
  const markdown = readFileSync(filePath, "utf8");
  return {
    file: filePath,
    findings: validateCitationAnchors(markdown, filePath),
  };
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const target = path.resolve(cwd, argv[0] ?? DEFAULT_TARGET);
  const { file, findings } = validateCitationAnchorsFile(target);
  if (findings.length === 0) {
    console.log(`citation-anchors: ok (${file})`);
    return 0;
  }
  for (const f of findings) {
    console.error(`${f.code}: ${f.message}`);
  }
  console.error(`citation-anchors: FAILED (${findings.length} finding(s))`);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
