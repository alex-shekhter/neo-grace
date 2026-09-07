#!/usr/bin/env bun
/**
 * Record retirement gate for docs/plans/active/RM-GOVERNED-PATH/.
 *
 * Eligibility, ceilings, CodifiedIn / TaughtIn resolution, registry
 * machine-readability, and status/file agreement. Validation of this
 * record is this script's job; the files are not CONTEXT_ARTIFACTS.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { XMLValidator } from "fast-xml-parser";
import {
  childNodes,
  childText,
  parseGraceXmlArtifact,
  walkNodes,
  type GraceXmlNode,
} from "../src/artifact/xml.ts";
import { isEmittableIssueCode } from "../src/lint/catalog.ts";

export const DEFAULT_RECORD_DIR = "docs/plans/active/RM-GOVERNED-PATH";
export const DEFAULT_STUB = `${DEFAULT_RECORD_DIR}/decisions.md`;

const TOKENIZER_RE = /^#{1,6} [FD]\d/;
const HEADING_RE = /^(#{1,6}) ([FD][0-9]+(?:\.[0-9]+)*)(\S*)(.*)$/;
const ANCHOR_RE = /^<a id="([^"]+)" name="([^"]+)"><\/a>$/;
const REGISTRY_HEADING_RE = /^## Named-bundle registry\s*$/;
const FENCE_RE = /```/;
const C_NAME_RE = /`(C-[A-Z0-9-]+)`/;
const C_NAME_GLOBAL_RE = /`(C-[A-Z0-9-]+)`/g;
const F_TOKEN_RE = /\bF[0-9]+(?:\.[0-9]+)*\b/g;
const PAID_FINDING_RE = /\bthe paid findings?\b/i;

export type RetirementFinding = {
  code: string;
  message: string;
};

export type FrozenEntry = {
  token: string;
  id: string;
  headingLevel: number;
  headingLine: string;
  genre: "finding" | "decision";
  bodyRaw: string;
  bodyHash: string;
};

export type InventoryEntry = {
  token: string;
  id: string;
  bodyHash: string;
};

export type RegistryRow = {
  name: string;
  number: string;
  charter: string;
  pays: string;
  statusText: string;
  kind: "chartered" | "sweep-remainder";
  successor: string;
};

export type RetirementOptions = {
  repoRoot: string;
  recordDir: string;
};

export function xmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function xmlDecode(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

export function whitespaceNormalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashBody(raw: string): string {
  return sha256Hex(whitespaceNormalize(raw));
}

export function splitMarkdownLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function newlineCount(text: string): number {
  return text.match(/\n/g)?.length ?? 0;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function listArchiveNames(repoRoot: string): Set<string> {
  const dir = path.join(repoRoot, ".ngrace", "changes", "archive");
  const names = new Set<string>();
  if (!existsSync(dir)) {
    return names;
  }
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && /^C-[A-Z0-9-]+$/.test(ent.name)) {
      names.add(ent.name);
    }
  }
  return names;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][\w:-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function extractElements(
  xml: string,
  tag: string,
): Array<{ attrs: Record<string, string>; inner: string; selfClosing: boolean }> {
  const out: Array<{ attrs: Record<string, string>; inner: string; selfClosing: boolean }> = [];
  const self = new RegExp(`<${tag}\\b([^>]*)/>`, "g");
  let m: RegExpExecArray | null;
  while ((m = self.exec(xml)) !== null) {
    out.push({ attrs: parseAttrs(m[1] ?? ""), inner: "", selfClosing: true });
  }
  const open = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
  while ((m = open.exec(xml)) !== null) {
    out.push({ attrs: parseAttrs(m[1] ?? ""), inner: m[2] ?? "", selfClosing: false });
  }
  return out;
}

function childInner(inner: string, tag: string): string | undefined {
  const m = inner.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : undefined;
}

function childOpenAttrs(
  inner: string,
  tag: string,
): { attrs: Record<string, string>; text: string } | undefined {
  const m = inner.match(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`));
  if (!m) {
    return undefined;
  }
  return { attrs: parseAttrs(m[1] ?? ""), text: m[2] ?? "" };
}

export function parseFrozenMarkdown(markdown: string): {
  entries: FrozenEntry[];
  registryHeadingIndex: number;
  chartered: RegistryRow[];
  sweep: RegistryRow[];
} {
  const lines = splitMarkdownLines(markdown);
  const headingIdx: number[] = [];
  const headingMeta: Array<{
    index: number;
    token: string;
    headingLevel: number;
    headingLine: string;
    id: string;
    genre: "finding" | "decision";
  }> = [];
  let registryHeadingIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (REGISTRY_HEADING_RE.test(line) && registryHeadingIndex < 0) {
      registryHeadingIndex = i;
    }
    if (!TOKENIZER_RE.test(line)) {
      continue;
    }
    const hm = HEADING_RE.exec(line);
    if (!hm) {
      continue;
    }
    const token = hm[2]!;
    const prev = i > 0 ? lines[i - 1]! : "";
    const am = ANCHOR_RE.exec(prev);
    if (!am) {
      throw new Error(`split: missing anchor for heading at line ${i + 1}`);
    }
    headingIdx.push(i);
    headingMeta.push({
      index: i,
      token,
      headingLevel: hm[1]!.length,
      headingLine: line,
      id: am[1]!,
      genre: token.startsWith("F") ? "finding" : "decision",
    });
  }

  const entries: FrozenEntry[] = [];
  for (let n = 0; n < headingMeta.length; n++) {
    const h = headingMeta[n]!;
    const start = h.index + 1;
    let end = lines.length;
    if (n + 1 < headingMeta.length) {
      const next = headingMeta[n + 1]!;
      const nextPrev = next.index > 0 ? lines[next.index - 1]! : "";
      end = ANCHOR_RE.test(nextPrev) ? next.index - 1 : next.index;
    }
    if (registryHeadingIndex >= 0 && h.index < registryHeadingIndex && registryHeadingIndex < end) {
      end = registryHeadingIndex;
    }
    const bodyRaw = lines.slice(start, end).join("\n");
    entries.push({
      token: h.token,
      id: h.id,
      headingLevel: h.headingLevel,
      headingLine: h.headingLine,
      genre: h.genre,
      bodyRaw,
      bodyHash: hashBody(bodyRaw),
    });
  }

  const { chartered, sweep } = parseRegistryTables(lines, registryHeadingIndex, headingIdx);
  return { entries, registryHeadingIndex, chartered, sweep };
}

function parseRegistryTables(
  lines: string[],
  registryHeadingIndex: number,
  headingIdx: number[],
): { chartered: RegistryRow[]; sweep: RegistryRow[] } {
  const chartered: RegistryRow[] = [];
  const sweep: RegistryRow[] = [];
  if (registryHeadingIndex < 0) {
    return { chartered, sweep };
  }
  let end = lines.length;
  for (const idx of headingIdx) {
    if (idx > registryHeadingIndex) {
      end = idx;
      const prev = idx > 0 ? lines[idx - 1]! : "";
      if (ANCHOR_RE.test(prev)) {
        end = idx - 1;
      }
      break;
    }
  }
  let mode: "numbered" | "named" | "sweep" | null = null;
  for (let i = registryHeadingIndex + 1; i < end; i++) {
    const line = lines[i]!;
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = splitTableRow(line);
    const joined = cells.join(" ").toLowerCase();
    if (cells.some((c) => /^-+$/.test(c))) {
      continue;
    }
    if (joined.includes("name") && joined.includes("charter") && joined.includes("pays") && joined.includes("status")) {
      mode = "numbered";
      continue;
    }
    if (joined.includes("name") && joined.includes("charter") && joined.includes("pays") && joined.includes("position")) {
      mode = "named";
      continue;
    }
    if (joined.includes("name") && joined.includes("what it is")) {
      mode = "sweep";
      continue;
    }
    if (mode === "numbered" && cells.length >= 5) {
      const name = extractCName(cells[1] ?? "");
      if (!name) continue;
      chartered.push({
        name,
        number: cells[0] ?? "",
        charter: cells[2] ?? "",
        pays: cells[3] ?? "",
        statusText: cells[4] ?? "",
        kind: "chartered",
        successor: extractSuccessor(cells[4] ?? "", name),
      });
    } else if (mode === "named" && cells.length >= 4) {
      const name = extractCName(cells[0] ?? "");
      if (!name) continue;
      chartered.push({
        name,
        number: "",
        charter: cells[1] ?? "",
        pays: cells[2] ?? "",
        statusText: cells[3] ?? "",
        kind: "chartered",
        successor: extractSuccessor(cells[3] ?? "", name),
      });
    } else if (mode === "sweep" && cells.length >= 2) {
      const name = extractCName(cells[0] ?? "");
      if (!name) continue;
      sweep.push({
        name,
        number: "",
        charter: "",
        pays: "",
        statusText: cells[1] ?? "",
        kind: "sweep-remainder",
        successor: "",
      });
    }
  }
  return { chartered, sweep };
}

function splitTableRow(line: string): string[] {
  const raw = line.trim();
  const inner = raw.startsWith("|") ? raw.slice(1) : raw;
  const ended = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return ended.split("|").map((c) => c.trim());
}

function extractCName(cell: string): string | undefined {
  const m = C_NAME_RE.exec(cell);
  return m?.[1];
}

function extractSuccessor(statusText: string, self: string): string {
  const names = [...statusText.matchAll(C_NAME_GLOBAL_RE)].map((m) => m[1]!).filter((n) => n !== self);
  const asTwo = names.find((n) => n === `${self}-2` || n.endsWith("-2"));
  if (asTwo) {
    return asTwo;
  }
  if (/replaced by/i.test(statusText) && names[0]) {
    return names[0];
  }
  if (/delivered as/i.test(statusText) && names[0]) {
    return names[0];
  }
  return "";
}

function sentenceSplit(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

export function closedWithTokens(statusText: string): string[] {
  const flat = whitespaceNormalize(xmlDecode(statusText));
  const reduced = flat.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const tokens: string[] = [];
  const seen = new Set<string>();
  const startRe = /\bClosed with\b/gi;
  let start: RegExpExecArray | null;
  while ((start = startRe.exec(reduced)) !== null) {
    const rest = reduced.slice(start.index);
    const period = rest.search(/\./);
    const clause = period === -1 ? rest : rest.slice(0, period + 1);
    for (const token of expandFTokens(clause)) {
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function expandFTokens(text: string): string[] {
  const out: string[] = [];
  const rangeEnds = new Set<string>();
  const rangeRe = /\b(F[0-9]+(?:\.[0-9]+)*)\s*[\u2013\u2014-]\s*(F[0-9]+(?:\.[0-9]+)*)\b/g;
  let range: RegExpExecArray | null;
  while ((range = rangeRe.exec(text)) !== null) {
    const expanded = expandFRange(range[1]!, range[2]!);
    if (!expanded) {
      continue;
    }
    rangeEnds.add(range[1]!);
    rangeEnds.add(range[2]!);
    for (const token of expanded) {
      out.push(token);
    }
  }
  const singles = text.match(F_TOKEN_RE) ?? [];
  for (const token of singles) {
    if (!rangeEnds.has(token) && !out.includes(token)) {
      out.push(token);
    }
  }
  return out;
}

function expandFRange(left: string, right: string): string[] | undefined {
  const parse = (token: string): { prefix: string; n: number } | undefined => {
    const m = /^(F(?:[0-9]+\.)*)([0-9]+)$/.exec(token);
    return m ? { prefix: m[1]!, n: Number(m[2]) } : undefined;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b || a.prefix !== b.prefix) {
    return undefined;
  }
  const start = Math.min(a.n, b.n);
  const end = Math.max(a.n, b.n);
  const tokens: string[] = [];
  for (let i = start; i <= end; i++) {
    tokens.push(`${a.prefix}${i}`);
  }
  return tokens;
}

export function derivePayerMap(
  repoRoot: string,
  chartered: Array<{ name: string; pays: string; statusText: string }>,
): Map<string, string> {
  const paid = new Map<string, string>();
  const archive = listArchiveNames(repoRoot);
  for (const row of chartered) {
    if (!archive.has(row.name)) {
      continue;
    }
    const tokens = row.pays.match(F_TOKEN_RE) ?? [];
    for (const token of tokens) {
      if (!paid.has(token)) {
        paid.set(token, row.name);
      }
    }
  }
  for (const row of chartered) {
    if (!archive.has(row.name)) {
      continue;
    }
    for (const token of closedWithTokens(row.statusText)) {
      if (!paid.has(token)) {
        paid.set(token, row.name);
      }
    }
  }
  const archiveDir = path.join(repoRoot, ".ngrace", "changes", "archive");
  if (!existsSync(archiveDir)) {
    return paid;
  }
  for (const name of archive) {
    const specPath = path.join(archiveDir, name, "spec.xml");
    if (!existsSync(specPath)) {
      continue;
    }
    const spec = readFileSync(specPath, "utf8");
    const flat = spec.replace(/\s+/g, " ");
    for (const sentence of sentenceSplit(flat)) {
      if (!PAID_FINDING_RE.test(sentence)) {
        continue;
      }
      const tokens = sentence.match(F_TOKEN_RE) ?? [];
      for (const token of tokens) {
        if (!paid.has(token)) {
          paid.set(token, name);
        }
      }
    }
  }
  return paid;
}

export function collectPaidBy(repoRoot: string, chartered: RegistryRow[]): Map<string, string> {
  return derivePayerMap(
    repoRoot,
    chartered.map((row) => ({ name: row.name, pays: row.pays, statusText: row.statusText })),
  );
}

/**
 * The rulings live ceiling C-RETIRE-AND-CODIFY persisted at its move, commit
 * 1896592 ("feat(record): retire on evidence and let the rulings ceiling
 * correct once (#75)"). No shipped operation raises the rulings ceiling, so a
 * persisted value above this is constructively a hand edit.
 */
export const RULINGS_PROVENANCE_CEILING = 1883;

function recordPaths(recordDir: string) {
  return {
    stub: path.join(recordDir, "decisions.md"),
    index: path.join(recordDir, "decisions.xml"),
    findings: path.join(recordDir, "findings.xml"),
    findingsRetired: path.join(recordDir, "findings-retired.xml"),
    rulings: path.join(recordDir, "rulings.xml"),
    rulingsRetired: path.join(recordDir, "rulings-retired.xml"),
    registry: path.join(recordDir, "registry.xml"),
    registryRetired: path.join(recordDir, "registry-retired.xml"),
    inventory: path.join(recordDir, "record-inventory.json"),
  };
}

function renderFinding(entry: FrozenEntry, status: "live" | "retired", paidBy?: string): string {
  const paid = paidBy ? `    <PaidBy>${xmlEscape(paidBy)}</PaidBy>\n` : "";
  return [
    `  <Finding id="${xmlEscape(entry.id)}" token="${xmlEscape(entry.token)}" status="${status}">`,
    paid + `    <Title>${xmlEscape(entry.headingLine)}</Title>`,
    `    <Body>${xmlEscape(entry.bodyRaw)}</Body>`,
    `  </Finding>`,
  ].join("\n");
}

function renderDecision(entry: FrozenEntry, status: "live" | "retired"): string {
  return [
    `  <Decision id="${xmlEscape(entry.id)}" token="${xmlEscape(entry.token)}" status="${status}">`,
    `    <Title>${xmlEscape(entry.headingLine)}</Title>`,
    `    <Body>${xmlEscape(entry.bodyRaw)}</Body>`,
    `  </Decision>`,
  ].join("\n");
}

function renderRow(row: RegistryRow, status: "live" | "retired"): string {
  const successor = row.successor
    ? `    <Successor>${xmlEscape(row.successor)}</Successor>\n`
    : "";
  return [
    `  <Row name="${xmlEscape(row.name)}" status="${status}" kind="${row.kind}">`,
    `    <Number>${xmlEscape(row.number)}</Number>`,
    `    <Charter>${xmlEscape(row.charter)}</Charter>`,
    `    <Pays>${xmlEscape(row.pays)}</Pays>`,
    `    <StatusText>${xmlEscape(row.statusText)}</StatusText>`,
    successor + `  </Row>`,
  ].join("\n");
}

function wrapRoot(
  root: string,
  body: string,
  extras: { ceiling?: number; base?: number; headroom?: number },
): string {
  const attrs = [
    extras.base !== undefined ? ` base="${extras.base}"` : "",
    extras.headroom !== undefined ? ` headroom="${extras.headroom}"` : "",
    extras.ceiling !== undefined ? ` ceiling="${extras.ceiling}"` : "",
  ].join("");
  const inner = body.trim().length > 0 ? `\n${body}\n` : "\n";
  return `<${root}${attrs}>${inner}</${root}>\n`;
}

export function splitFrozenRecord(repoRoot: string, recordDir = path.join(repoRoot, DEFAULT_RECORD_DIR)): void {
  const paths = recordPaths(recordDir);
  const markdown = readFileSync(paths.stub, "utf8");
  const sourceLines = splitMarkdownLines(markdown);
  if (!sourceLines.some((line) => TOKENIZER_RE.test(line))) {
    throw new Error("split: decisions.md is not the pre-split dump (refusing to split a stub)");
  }
  const parsed = parseFrozenMarkdown(markdown);
  const inventory: InventoryEntry[] = parsed.entries.map((e) => ({
    token: e.token,
    id: e.id,
    bodyHash: e.bodyHash,
  }));
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(paths.inventory, `${JSON.stringify(inventory, null, 2)}\n`);

  const paidBy = collectPaidBy(repoRoot, parsed.chartered);
  const archive = listArchiveNames(repoRoot);

  const liveFindings: FrozenEntry[] = [];
  const retiredFindings: FrozenEntry[] = [];
  const liveDecisions: FrozenEntry[] = [];
  const retiredDecisions: FrozenEntry[] = [];
  const findingPaid = new Map<string, string>();

  for (const entry of parsed.entries) {
    if (entry.genre === "finding") {
      const payer = paidBy.get(entry.token);
      if (payer) {
        findingPaid.set(entry.id, payer);
      }
      if (payer && archive.has(payer)) {
        retiredFindings.push(entry);
      } else {
        liveFindings.push(entry);
      }
    } else {
      liveDecisions.push(entry);
    }
  }

  const liveRows: RegistryRow[] = [];
  const retiredRows: RegistryRow[] = [];
  for (const row of parsed.chartered) {
    if (archive.has(row.name)) {
      retiredRows.push(row);
    } else {
      liveRows.push(row);
    }
  }
  for (const row of parsed.sweep) {
    retiredRows.push(row);
  }

  const layerOf = new Map<string, "live" | "retired">();
  for (const e of liveFindings) layerOf.set(e.id, "live");
  for (const e of retiredFindings) layerOf.set(e.id, "retired");
  for (const e of liveDecisions) layerOf.set(e.id, "live");
  for (const e of retiredDecisions) layerOf.set(e.id, "retired");

  const indexBody = parsed.entries
    .map((e) => {
      const layer = layerOf.get(e.id) ?? "live";
      return `  <Entry id="${xmlEscape(e.id)}" token="${xmlEscape(e.token)}" genre="${e.genre}" layer="${layer}" />`;
    })
    .join("\n");

  const liveFindingXml = liveFindings.map((e) => renderFinding(e, "live", findingPaid.get(e.id))).join("\n");
  const retiredFindingXml = retiredFindings.map((e) => renderFinding(e, "retired", findingPaid.get(e.id))).join("\n");
  const liveDecisionXml = liveDecisions.map((e) => renderDecision(e, "live")).join("\n");
  const retiredDecisionXml = retiredDecisions.map((e) => renderDecision(e, "retired")).join("\n");
  const liveRowXml = liveRows.map((r) => renderRow(r, "live")).join("\n");
  const retiredRowXml = retiredRows.map((r) => renderRow(r, "retired")).join("\n");

  const findingMedians = liveFindings.map((e) => newlineCount(renderFinding(e, "live", findingPaid.get(e.id))) + 1);
  const h2DecisionMedians = liveDecisions
    .filter((e) => e.headingLevel === 2)
    .map((e) => newlineCount(renderDecision(e, "live")) + 1);

  const findingsHeadroom = 7 * median(findingMedians);
  const rulingsHeadroom = 2 * median(h2DecisionMedians);
  const registryHeadroom = 15;
  const indexHeadroom = 40;

  const findingsBaseProbe = newlineCount(wrapRoot("Findings", liveFindingXml, {}));
  const rulingsBaseProbe = newlineCount(wrapRoot("Rulings", liveDecisionXml, {}));
  const indexBaseProbe = newlineCount(wrapRoot("RecordIndex", indexBody, {}));
  const registryBase = liveRows.length;

  const findingsCeiling = findingsBaseProbe + findingsHeadroom;
  const rulingsCeiling = rulingsBaseProbe + rulingsHeadroom;
  const indexCeiling = indexBaseProbe + indexHeadroom;
  const registryCeiling = registryBase + registryHeadroom;

  const findingsXml = wrapRoot("Findings", liveFindingXml, {
    base: findingsBaseProbe,
    headroom: findingsHeadroom,
    ceiling: findingsCeiling,
  });
  const rulingsXml = wrapRoot("Rulings", liveDecisionXml, {
    base: rulingsBaseProbe,
    headroom: rulingsHeadroom,
    ceiling: rulingsCeiling,
  });
  const indexXml = wrapRoot("RecordIndex", indexBody, {
    base: indexBaseProbe,
    headroom: indexHeadroom,
    ceiling: indexCeiling,
  });
  const registryXml = wrapRoot("Registry", liveRowXml, {
    base: registryBase,
    headroom: registryHeadroom,
    ceiling: registryCeiling,
  });

  writeFileSync(paths.findings, findingsXml);
  writeFileSync(paths.findingsRetired, wrapRoot("Findings", retiredFindingXml, {}));
  writeFileSync(paths.rulings, rulingsXml);
  writeFileSync(paths.rulingsRetired, wrapRoot("Rulings", retiredDecisionXml, {}));
  writeFileSync(paths.index, indexXml);
  writeFileSync(paths.registry, registryXml);
  writeFileSync(paths.registryRetired, wrapRoot("Registry", retiredRowXml, {}));

  const stub = `# RM-GOVERNED-PATH record stub

The parseable citation index is [./decisions.xml](./decisions.xml).

Live genre files (D28): [./findings.xml](./findings.xml) (findings),
[./rulings.xml](./rulings.xml) (decisions), [./registry.xml](./registry.xml)
(registry). Retired siblings sit beside them. Layers (D31): citation index,
live, retired.

Machine-read fields are XML attributes or elements. An entry moves when:
a finding's PaidBy names an archived bundle; a decision carries a resolving
CodifiedIn or TaughtIn; a registry row's name equals an archive directory.
`;
  writeFileSync(paths.stub, stub);
}

function parseRecordRoot(
  file: string,
  xml: string,
  findings: RetirementFinding[],
): GraceXmlNode | null {
  const parsed = parseGraceXmlArtifact(file, xml);
  if (!parsed.root) {
    const msg = parsed.issues[0]?.message ?? "XML artifact does not contain a root element.";
    findings.push({
      code: "malformed-xml",
      message: `${file}: XML is not well-formed (${msg})`,
    });
    return null;
  }
  return parsed.root;
}

function charteredRowsFromRoot(root: GraceXmlNode): Array<{ name: string; pays: string; statusText: string }> {
  return childNodes(root, "Row")
    .filter((row) => (row.attributes.kind ?? "chartered") === "chartered")
    .map((row) => ({
      name: row.attributes.name ?? "",
      pays: childText(row, "Pays") ?? "",
      statusText: childText(row, "StatusText") ?? "",
    }));
}

function headingLevelFromTitle(title: string): number {
  const m = title.match(/^(#+)/);
  return m ? m[1]!.length : 0;
}

export function liveH2DecisionLineCounts(rulingsXml: string): number[] {
  const blocks = elementSpans(rulingsXml, "Decision");
  const parsed = parseGraceXmlArtifact("rulings.xml", rulingsXml);
  if (!parsed.root) {
    return [];
  }
  const nodes = childNodes(parsed.root, "Decision");
  const counts: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.attributes.status !== "live") {
      continue;
    }
    if (headingLevelFromTitle(childText(node, "Title") ?? "") !== 2) {
      continue;
    }
    const block = blocks[i];
    if (!block) {
      continue;
    }
    counts.push(newlineCount(block.text) + 1);
  }
  return counts;
}

function elementSpans(xml: string, tag: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

function attrOf(elementXml: string, name: string): string {
  const m = elementXml.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m?.[1] ?? "";
}

function withStatusRetired(elementXml: string): string {
  return elementXml.replace(/\bstatus="live"/, 'status="retired"');
}

function withPaidBy(findingXml: string, payer: string): string {
  if (/<PaidBy>/.test(findingXml)) {
    return findingXml;
  }
  return findingXml.replace(
    /(<Finding\b[^>]*>)/,
    `$1\n    <PaidBy>${xmlEscape(payer)}</PaidBy>`,
  );
}

function removeSpans(xml: string, spans: Array<{ start: number; end: number }>): string {
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let next = xml;
  for (const span of ordered) {
    let end = span.end;
    if (next[end] === "\n") {
      end += 1;
    }
    next = `${next.slice(0, span.start)}${next.slice(end)}`;
  }
  return next;
}

function appendElements(retiredXml: string, closeTag: string, elements: string[]): string {
  if (elements.length === 0) {
    return retiredXml;
  }
  const idx = retiredXml.lastIndexOf(closeTag);
  if (idx < 0) {
    return retiredXml;
  }
  let before = retiredXml.slice(0, idx);
  if (!before.endsWith("\n")) {
    before += "\n";
  }
  const chunk = elements.map((el) => (el.endsWith("\n") ? el : `${el}\n`)).join("");
  return `${before}${chunk}${retiredXml.slice(idx)}`;
}

function setEntryLayer(indexXml: string, id: string, layer: "retired"): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<Entry\\b[^>]*\\bid="${escaped}"[^>]*/>`);
  return indexXml.replace(re, (tag) => tag.replace(/layer="[^"]*"/, `layer="${layer}"`));
}

function readRootSnapshot(xml: string): { base: number; headroom: number; ceiling: number } {
  const m = xml.match(/<(Findings|Rulings|Registry|RecordIndex)\b([^>]*)>/);
  const attrs = parseAttrs(m?.[2] ?? "");
  return {
    base: Number(attrs.base),
    headroom: Number(attrs.headroom),
    ceiling: Number(attrs.ceiling),
  };
}

function withRootSnapshot(
  xml: string,
  snap: { base: number; headroom: number; ceiling: number },
): string {
  return xml.replace(
    /^<(Findings|Rulings|Registry|RecordIndex)\b[^>]*>/,
    `<$1 base="${snap.base}" headroom="${snap.headroom}" ceiling="${snap.ceiling}">`,
  );
}

function persistSnapshot(
  previous: { base: number; headroom: number; ceiling: number },
  base: number,
  computedHeadroom: number,
  clamp: boolean,
  ceilingBase = base,
): { base: number; headroom: number; ceiling: number } {
  const formulaCeiling = ceilingBase + computedHeadroom;
  const ceiling = clamp ? Math.min(previous.ceiling, formulaCeiling) : formulaCeiling;
  const headroom = ceiling - base;
  return { base, headroom, ceiling };
}

function findingLineCounts(xml: string): number[] {
  return elementSpans(xml, "Finding").map((el) => newlineCount(el.text) + 1);
}

function liveRowCount(xml: string): number {
  const parsed = parseGraceXmlArtifact("registry.xml", xml);
  if (!parsed.root) {
    return 0;
  }
  return childNodes(parsed.root, "Row").filter((row) => row.attributes.status !== "retired").length;
}

function payerMapFromRecord(repoRoot: string, registryXml: string, registryRetiredXml: string): Map<string, string> {
  const findings: RetirementFinding[] = [];
  const liveRoot = parseRecordRoot("registry.xml", registryXml, findings);
  const retiredRoot = parseRecordRoot("registry-retired.xml", registryRetiredXml, findings);
  const rows = [
    ...(liveRoot ? charteredRowsFromRoot(liveRoot) : []),
    ...(retiredRoot ? charteredRowsFromRoot(retiredRoot) : []),
  ];
  return derivePayerMap(repoRoot, rows);
}

function nodeResolvesCodified(node: GraceXmlNode, repoRoot: string): { ok: boolean; message: string } | undefined {
  const coded = childNodes(node, "CodifiedIn")[0];
  if (!coded) {
    return undefined;
  }
  return codifiedResolves({ attrs: coded.attributes, text: coded.text }, repoRoot);
}

function nodeResolvesTaught(node: GraceXmlNode, repoRoot: string): { ok: boolean; message: string } | undefined {
  const taught = childNodes(node, "TaughtIn")[0];
  if (!taught) {
    return undefined;
  }
  return taughtResolvesCheck({ attrs: taught.attributes, text: taught.text }, repoRoot);
}

export function stampPaidBy(options: RetirementOptions): void {
  const paths = recordPaths(options.recordDir);
  const findingsXml = readFileSync(paths.findings, "utf8");
  const registryXml = readFileSync(paths.registry, "utf8");
  const registryRetiredXml = readFileSync(paths.registryRetired, "utf8");
  const payers = payerMapFromRecord(options.repoRoot, registryXml, registryRetiredXml);
  const archive = listArchiveNames(options.repoRoot);
  const spans = elementSpans(findingsXml, "Finding");
  let next = findingsXml;
  for (const span of [...spans].reverse()) {
    if (attrOf(span.text, "status") !== "live") {
      continue;
    }
    const token = attrOf(span.text, "token");
    const payer = payers.get(token);
    if (!payer || !archive.has(payer) || /<PaidBy>/.test(span.text)) {
      continue;
    }
    const stamped = withPaidBy(span.text, payer);
    next = `${next.slice(0, span.start)}${stamped}${next.slice(span.end)}`;
  }
  writeFileSync(paths.findings, next);
}

export function retireRecord(options: RetirementOptions): { moved: number } {
  const paths = recordPaths(options.recordDir);
  const files = {
    findings: readFileSync(paths.findings, "utf8"),
    findingsRetired: readFileSync(paths.findingsRetired, "utf8"),
    rulings: readFileSync(paths.rulings, "utf8"),
    rulingsRetired: readFileSync(paths.rulingsRetired, "utf8"),
    registry: readFileSync(paths.registry, "utf8"),
    registryRetired: readFileSync(paths.registryRetired, "utf8"),
    index: readFileSync(paths.index, "utf8"),
  };
  const archive = listArchiveNames(options.repoRoot);
  const payers = payerMapFromRecord(options.repoRoot, files.registry, files.registryRetired);
  const rulingsAsRead = readRootSnapshot(files.rulings);

  const findingsParse = parseGraceXmlArtifact(paths.findings, files.findings);
  const rulingsParse = parseGraceXmlArtifact(paths.rulings, files.rulings);
  const registryParse = parseGraceXmlArtifact(paths.registry, files.registry);
  const findingNodes = findingsParse.root ? childNodes(findingsParse.root, "Finding") : [];
  const decisionNodes = rulingsParse.root ? childNodes(rulingsParse.root, "Decision") : [];
  const rowNodes = registryParse.root ? childNodes(registryParse.root, "Row") : [];

  const findingSpans = elementSpans(files.findings, "Finding");
  const decisionSpans = elementSpans(files.rulings, "Decision");
  const rowSpans = elementSpans(files.registry, "Row");

  const moveFindings: Array<{ span: (typeof findingSpans)[0]; next: string; id: string }> = [];
  for (let i = 0; i < findingSpans.length; i++) {
    const span = findingSpans[i]!;
    const node = findingNodes[i];
    if (attrOf(span.text, "status") !== "live") {
      continue;
    }
    const token = attrOf(span.text, "token");
    const derived = payers.get(token);
    const stored = node ? childText(node, "PaidBy")?.trim() : undefined;
    const payer = derived && archive.has(derived) ? derived : stored && archive.has(stored) ? stored : undefined;
    if (!payer) {
      continue;
    }
    moveFindings.push({
      span,
      next: withStatusRetired(withPaidBy(span.text, payer)),
      id: attrOf(span.text, "id"),
    });
  }

  const moveDecisions: Array<{ span: (typeof decisionSpans)[0]; next: string; id: string }> = [];
  for (let i = 0; i < decisionSpans.length; i++) {
    const span = decisionSpans[i]!;
    const node = decisionNodes[i];
    if (!node || node.attributes.status !== "live") {
      continue;
    }
    const coded = nodeResolvesCodified(node, options.repoRoot);
    const taught = nodeResolvesTaught(node, options.repoRoot);
    if (!(coded?.ok || taught?.ok)) {
      continue;
    }
    moveDecisions.push({
      span,
      next: withStatusRetired(span.text),
      id: node.attributes.id ?? attrOf(span.text, "id"),
    });
  }

  const moveRows: Array<{ span: (typeof rowSpans)[0]; next: string; id: string }> = [];
  for (let i = 0; i < rowSpans.length; i++) {
    const span = rowSpans[i]!;
    const node = rowNodes[i];
    const name = node?.attributes.name ?? attrOf(span.text, "name");
    if ((node?.attributes.status ?? attrOf(span.text, "status")) === "retired") {
      continue;
    }
    if (!archive.has(name)) {
      continue;
    }
    moveRows.push({
      span,
      next: withStatusRetired(span.text),
      id: name,
    });
  }

  const movedCount = moveFindings.length + moveDecisions.length + moveRows.length;
  if (movedCount === 0) {
    return { moved: 0 };
  }

  let findingsLive = removeSpans(
    files.findings,
    moveFindings.map((m) => m.span),
  );
  let findingsRetired = appendElements(
    files.findingsRetired,
    "</Findings>",
    moveFindings.map((m) => m.next),
  );
  let rulingsLive = removeSpans(
    files.rulings,
    moveDecisions.map((m) => m.span),
  );
  let rulingsRetired = appendElements(
    files.rulingsRetired,
    "</Rulings>",
    moveDecisions.map((m) => m.next),
  );
  let registryLive = removeSpans(
    files.registry,
    moveRows.map((m) => m.span),
  );
  let registryRetired = appendElements(
    files.registryRetired,
    "</Registry>",
    moveRows.map((m) => m.next),
  );
  let indexXml = files.index;
  for (const item of [...moveFindings, ...moveDecisions]) {
    indexXml = setEntryLayer(indexXml, item.id, "retired");
  }

  const findingsPrev = readRootSnapshot(files.findings);
  const findingsBaseRead = newlineCount(files.findings);
  const rulingsPrev = rulingsAsRead;
  const registryPrev = readRootSnapshot(files.registry);
  const indexPrev = readRootSnapshot(files.index);

  const findingsHeadroom = 7 * median(findingLineCounts(findingsLive));
  const rulingsHeadroom = 7 * median(liveH2DecisionLineCounts(rulingsLive));
  findingsLive = withRootSnapshot(
    findingsLive,
    persistSnapshot(
      findingsPrev,
      newlineCount(findingsLive),
      findingsHeadroom,
      true,
      findingsBaseRead,
    ),
  );
  rulingsLive = withRootSnapshot(
    rulingsLive,
    persistSnapshot(rulingsPrev, newlineCount(rulingsLive), rulingsHeadroom, true),
  );
  registryLive = withRootSnapshot(
    registryLive,
    persistSnapshot(registryPrev, liveRowCount(registryLive), 15, true),
  );
  indexXml = withRootSnapshot(
    indexXml,
    persistSnapshot(indexPrev, newlineCount(indexXml), 40, true),
  );

  writeFileSync(paths.findings, findingsLive);
  writeFileSync(paths.findingsRetired, findingsRetired);
  writeFileSync(paths.rulings, rulingsLive);
  writeFileSync(paths.rulingsRetired, rulingsRetired);
  writeFileSync(paths.registry, registryLive);
  writeFileSync(paths.registryRetired, registryRetired);
  writeFileSync(paths.index, indexXml);
  return { moved: movedCount };
}

function wellFormed(xml: string, file: string, findings: RetirementFinding[]): boolean {
  const result = XMLValidator.validate(xml);
  if (result !== true) {
    findings.push({
      code: "malformed-xml",
      message: `${file}: XML is not well-formed (${result.err.msg})`,
    });
    return false;
  }
  return true;
}

function requiredFile(file: string, findings: RetirementFinding[]): string | undefined {
  if (!existsSync(file)) {
    findings.push({
      code: "missing-file",
      message: `record-retirement: missing ${file}`,
    });
    return undefined;
  }
  return readFileSync(file, "utf8");
}

export function validateRecordRetirement(options: RetirementOptions): RetirementFinding[] {
  const findings: RetirementFinding[] = [];
  const paths = recordPaths(options.recordDir);
  const archive = listArchiveNames(options.repoRoot);
  const files = {
    findings: requiredFile(paths.findings, findings),
    findingsRetired: requiredFile(paths.findingsRetired, findings),
    rulings: requiredFile(paths.rulings, findings),
    rulingsRetired: requiredFile(paths.rulingsRetired, findings),
    registry: requiredFile(paths.registry, findings),
    registryRetired: requiredFile(paths.registryRetired, findings),
    index: requiredFile(paths.index, findings),
  };
  if (Object.values(files).some((v) => v === undefined)) {
    return findings;
  }

  for (const [label, xml] of Object.entries(files) as Array<[string, string]>) {
    const file = (paths as Record<string, string>)[label] ?? label;
    wellFormed(xml, file, findings);
    const outsideBody = xml.replace(/<Body>[\s\S]*?<\/Body>/g, "<Body/>");
    if (FENCE_RE.test(outsideBody)) {
      findings.push({
        code: "fenced-metadata",
        message: `${file}: fenced metadata block is not allowed; machine-read fields are XML attributes or elements`,
      });
    }
  }

  checkStatusFile(paths.findings, files.findings!, "Finding", "live", findings);
  checkStatusFile(paths.findingsRetired, files.findingsRetired!, "Finding", "retired", findings);
  checkStatusFile(paths.rulings, files.rulings!, "Decision", "live", findings);
  checkStatusFile(paths.rulingsRetired, files.rulingsRetired!, "Decision", "retired", findings);
  checkStatusFile(paths.registry, files.registry!, "Row", "live", findings);
  checkStatusFile(paths.registryRetired, files.registryRetired!, "Row", "retired", findings);

  const findingsRoot = parseRecordRoot(paths.findings, files.findings!, findings);
  const rulingsRoot = parseRecordRoot(paths.rulings, files.rulings!, findings);
  const registryRoot = parseRecordRoot(paths.registry, files.registry!, findings);
  const registryRetiredRoot = parseRecordRoot(paths.registryRetired, files.registryRetired!, findings);
  const payers = derivePayerMap(options.repoRoot, [
    ...(registryRoot ? charteredRowsFromRoot(registryRoot) : []),
    ...(registryRetiredRoot ? charteredRowsFromRoot(registryRetiredRoot) : []),
  ]);

  if (findingsRoot) {
    for (const node of walkNodes(findingsRoot)) {
      if (node.tag !== "Finding" || node.attributes.status !== "live") {
        continue;
      }
      const token = node.attributes.token ?? "";
      const derived = payers.get(token);
      const stored = childText(node, "PaidBy")?.trim();
      const event =
        derived && archive.has(derived) ? derived : stored && archive.has(stored) ? stored : undefined;
      if (!event) {
        continue;
      }
      findings.push({
        code: "finding-eligible-still-live",
        message: `live finding id="${node.attributes.id}" token="${token}" is eligible (archive event ${event}); --retire / move the eligible entry to the retired sibling`,
      });
    }
  }

  if (registryRoot) {
    for (const node of childNodes(registryRoot, "Row")) {
      if (node.attributes.status !== "live") continue;
      const name = node.attributes.name ?? "";
      if (!name) {
        findings.push({
          code: "registry-unreadable",
          message: `live registry row is missing a name attribute; registry.xml is the machine-readable source of truth`,
        });
        continue;
      }
      if (archive.has(name)) {
        findings.push({
          code: "registry-eligible-still-live",
          message: `live registry row name="${name}" equals a directory under .ngrace/changes/archive/ (archive event ${name}); move the eligible entry to the retired sibling`,
        });
      }
    }
  }

  if (rulingsRoot) {
    for (const node of childNodes(rulingsRoot, "Decision")) {
      if (node.attributes.status !== "live") continue;
      const coded = nodeResolvesCodified(node, options.repoRoot);
      const taught = nodeResolvesTaught(node, options.repoRoot);
      if (coded && !coded.ok) {
        findings.push({
          code: "codified-in-unresolved",
          message: `live decision id="${node.attributes.id}": ${coded.message}`,
        });
      }
      if (taught && !taught.ok) {
        findings.push({
          code: "taught-in-unresolved",
          message: `live decision id="${node.attributes.id}": ${taught.message}`,
        });
      }
      if (coded?.ok || taught?.ok) {
        const tag = coded?.ok ? "CodifiedIn" : "TaughtIn";
        findings.push({
          code: "decision-eligible-still-live",
          message: `live decision id="${node.attributes.id}" carries a resolving ${tag}; move the eligible entry to the retired sibling`,
        });
      }
    }
  }

  checkCeiling("findings", paths.findings, files.findings!, "line", findings);
  checkCeiling("rulings", paths.rulings, files.rulings!, "line", findings);
  checkRulingsProvenance(paths.rulings, files.rulings!, findings);
  checkCeiling("index", paths.index, files.index!, "line", findings);
  const registryLiveRows = registryRoot
    ? childNodes(registryRoot, "Row").filter((row) => row.attributes.status !== "retired").length
    : 0;
  checkCeilingValue("registry", paths.registry, files.registry!, registryLiveRows, "live-row", findings);

  return findings;
}

function checkRulingsProvenance(
  file: string,
  xml: string,
  findings: RetirementFinding[],
): void {
  const rootMatch = xml.match(/<Rulings\b([^>]*)>/);
  if (!rootMatch) {
    return;
  }
  const attrs = parseAttrs(rootMatch[1] ?? "");
  if (attrs.ceiling === undefined || attrs.ceiling === "") {
    return;
  }
  const ceiling = Number(attrs.ceiling);
  if (ceiling > RULINGS_PROVENANCE_CEILING) {
    findings.push({
      code: "rulings-ceiling-above-provenance",
      message: `${file}: the persisted rulings ceiling ${ceiling} exceeds the provenance ceiling ${RULINGS_PROVENANCE_CEILING} that C-RETIRE-AND-CODIFY's one-time correction persisted; no shipped operation raises it; restore from git; raising the persisted ceiling is not the remedy`,
    });
  }
}

function checkStatusFile(
  file: string,
  xml: string,
  tag: string,
  expected: "live" | "retired",
  findings: RetirementFinding[],
): void {
  for (const el of extractElements(xml, tag)) {
    if (el.attrs.status !== expected) {
      findings.push({
        code: "status-file-mismatch",
        message: `${file}: ${tag} id="${el.attrs.id ?? el.attrs.name ?? "?"}" has status="${el.attrs.status}" but the file is the ${expected} sibling`,
      });
    }
  }
}

function checkCeiling(
  part: string,
  file: string,
  xml: string,
  unit: string,
  findings: RetirementFinding[],
): void {
  checkCeilingValue(part, file, xml, newlineCount(xml), unit, findings);
}

function checkCeilingValue(
  part: string,
  file: string,
  xml: string,
  liveSize: number,
  unit: string,
  findings: RetirementFinding[],
): void {
  const rootMatch = xml.match(/<(Findings|Rulings|Registry|RecordIndex)\b([^>]*)>/);
  if (!rootMatch) {
    findings.push({
      code: "missing-root",
      message: `${file}: missing expected root for ${part}`,
    });
    return;
  }
  const attrs = parseAttrs(rootMatch[2] ?? "");
  if (attrs.ceiling === undefined || attrs.ceiling === "") {
    findings.push({
      code: "missing-ceiling",
      message: `${file}: live ${part} has no persisted ceiling; the retirement pass persists ceiling = base + headroom`,
    });
    return;
  }
  const ceiling = Number(attrs.ceiling);
  if (liveSize > ceiling) {
    findings.push({
      code: "ceiling-exceeded",
      message: `${file}: live ${part} ${unit} count ${liveSize} exceeds persisted ceiling ${ceiling}; --retire / move the eligible entry to the retired sibling. Raising the persisted ceiling is not the remedy.`,
    });
  }
}

function codifiedResolves(
  node: { attrs: Record<string, string>; text: string },
  repoRoot: string,
): { ok: boolean; message: string } {
  const kind = node.attrs.kind ?? "";
  const value = xmlDecode(node.text).trim();
  if (kind === "lint-rule") {
    if (!isEmittableIssueCode(value)) {
      return {
        ok: false,
        message: `CodifiedIn lint-rule "${value}" is absent from src/lint/catalog.ts`,
      };
    }
    return { ok: true, message: "" };
  }
  if (kind === "test-suite") {
    const abs = path.join(repoRoot, value);
    if (!existsSync(abs)) {
      return {
        ok: false,
        message: `CodifiedIn test-suite path "${value}" does not exist (removed or renamed while a live tag points at it)`,
      };
    }
    return { ok: true, message: "" };
  }
  return { ok: false, message: `CodifiedIn has unknown kind "${kind}"` };
}

function taughtResolvesCheck(
  node: { attrs: Record<string, string>; text: string },
  repoRoot: string,
): { ok: boolean; message: string } {
  const skillPath = node.attrs.path ?? "";
  const section = node.attrs.section ?? "";
  if (!skillPath) {
    return { ok: false, message: "TaughtIn is missing path" };
  }
  const abs = path.join(repoRoot, skillPath);
  if (!existsSync(abs)) {
    return {
      ok: false,
      message: `TaughtIn path "${skillPath}" does not exist (removed or renamed while a live tag points at it)`,
    };
  }
  const body = readFileSync(abs, "utf8");
  if (!section || !body.includes(section)) {
    return {
      ok: false,
      message: `TaughtIn section "${section}" is not present in ${skillPath} (removed or renamed while a live tag points at it)`,
    };
  }
  return { ok: true, message: "" };
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const mode = argv.find((a) => a === "--split" || a === "--retire" || a === "--stamp-paid-by");
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (mode === "--split") {
    try {
      splitFrozenRecord(cwd);
      console.log("record-retirement: split ok");
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  const recordDir = path.resolve(cwd, positional[0] ?? DEFAULT_RECORD_DIR);
  if (mode === "--retire") {
    const result = retireRecord({ repoRoot: cwd, recordDir });
    console.log(`record-retirement: retire ok (${recordDir}, moved ${result.moved})`);
    return 0;
  }
  if (mode === "--stamp-paid-by") {
    stampPaidBy({ repoRoot: cwd, recordDir });
    console.log(`record-retirement: stamp-paid-by ok (${recordDir})`);
    return 0;
  }
  const findings = validateRecordRetirement({ repoRoot: cwd, recordDir });
  if (findings.length === 0) {
    console.log(`record-retirement: ok (${recordDir})`);
    return 0;
  }
  for (const f of findings) {
    console.error(`${f.code}: ${f.message}`);
  }
  console.error(`record-retirement: FAILED (${findings.length} finding(s))`);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
