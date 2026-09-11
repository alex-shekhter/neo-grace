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
  computeElementSpans,
  parseGraceXmlArtifact,
  walkNodes,
  type GraceXmlNode,
  type XmlElementSpan,
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

export const REGISTRY_KINDS = ["chartered", "sweep-remainder", "historical"] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];
const REGISTRY_KIND_SET = new Set<string>(REGISTRY_KINDS);
const PAYER_KINDS = new Set<string>(["chartered", "historical"]);

export type RegistryRow = {
  name: string;
  number: string;
  charter: string;
  pays: string;
  statusText: string;
  kind: RegistryKind;
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

/**
 * Index headroom, denominated in live `Entry` children (not lines) per
 * C-INDEX-METRIC-2. Read by both persist sites: the retire path's index
 * snapshot and the one-time --split conversion's index base. The
 * persistSnapshot clamp is unchanged — ceilings still only hold or fall.
 */
export const INDEX_HEADROOM_ENTRIES = 40;

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

  const findingsHeadroom = Math.floor(7 * median(findingMedians));
  const rulingsHeadroom = Math.floor(2 * median(h2DecisionMedians));
  const registryHeadroom = 15;
  const indexHeadroom = INDEX_HEADROOM_ENTRIES;

  const findingsBaseProbe = newlineCount(wrapRoot("Findings", liveFindingXml, {}));
  const rulingsBaseProbe = newlineCount(wrapRoot("Rulings", liveDecisionXml, {}));
  const indexBaseProbe = liveEntryCount(wrapRoot("RecordIndex", indexBody, {}));
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
CodifiedIn (a resolving TaughtIn does not move it); a registry row's name
equals an archive directory.
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

/** The expected root element per record file, keyed by file basename. */
const RECORD_GENRE_ROOTS: Record<string, string> = {
  "findings.xml": "Findings",
  "findings-retired.xml": "Findings",
  "rulings.xml": "Rulings",
  "rulings-retired.xml": "Rulings",
  "registry.xml": "Registry",
  "registry-retired.xml": "Registry",
  "decisions.xml": "RecordIndex",
};

/** The genre elements whose placement the minimal shape check governs. */
const RECORD_GENRE_TAGS = new Set(["Finding", "Decision", "Row", "Entry"]);

function hasSameTagDescendant(node: GraceXmlNode): boolean {
  for (const child of node.children) {
    for (const descendant of walkNodes(child)) {
      if (descendant.tag === node.tag) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The minimal shape check that makes span pairing well defined (C-RECORD-PARSE
 * T-003): the expected genre root, genre elements only as direct children of
 * the root, and no same-tag nesting among genre elements. This is the
 * load-bearing minimum, not the full record schema.
 */
function checkRecordShape(
  file: string,
  root: GraceXmlNode | null,
  findings: RetirementFinding[],
): void {
  if (!root) {
    return;
  }
  const expectedRoot = RECORD_GENRE_ROOTS[path.basename(file)];
  if (expectedRoot && root.tag !== expectedRoot) {
    findings.push({
      code: "record-shape-wrong-root",
      message: `${file}: root element is <${root.tag}>; expected <${expectedRoot}>`,
    });
  }
  const stack: Array<{ node: GraceXmlNode; parent: GraceXmlNode | null }> = [{ node: root, parent: null }];
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (node !== root && RECORD_GENRE_TAGS.has(node.tag)) {
      if (parent !== root) {
        findings.push({
          code: "record-shape-genre-not-direct-child",
          message: `${file}: <${node.tag}> appears nested inside <${parent?.tag ?? "?"}>; genre elements must be direct children of the root`,
        });
      }
      if (hasSameTagDescendant(node)) {
        findings.push({
          code: "record-shape-same-tag-nested",
          message: `${file}: <${node.tag}> carries a same-tag descendant; genre elements do not nest`,
        });
      }
    }
    for (const child of node.children) {
      stack.push({ node: child, parent: node });
    }
  }
}

function charteredRowsFromRoot(root: GraceXmlNode): Array<{ name: string; pays: string; statusText: string }> {
  return childNodes(root, "Row")
    .filter((row) => PAYER_KINDS.has(row.attributes.kind ?? "chartered"))
    .map((row) => ({
      name: row.attributes.name ?? "",
      pays: childText(row, "Pays") ?? "",
      statusText: childText(row, "StatusText") ?? "",
    }));
}

function checkRegistryKinds(
  file: string,
  root: GraceXmlNode | null,
  findings: RetirementFinding[],
): void {
  if (!root) {
    return;
  }
  for (const row of childNodes(root, "Row")) {
    const kind = row.attributes.kind ?? "chartered";
    if (REGISTRY_KIND_SET.has(kind)) {
      continue;
    }
    findings.push({
      code: "registry-unknown-kind",
      message: `${file}: registry row name="${row.attributes.name ?? ""}" has kind="${kind}"; allowed kinds are ${REGISTRY_KINDS.join(", ")}`,
    });
  }
}

function headingLevelFromTitle(title: string): number {
  const m = title.match(/^(#+)/);
  return m ? m[1]!.length : 0;
}

export function liveH2DecisionLineCounts(rulingsXml: string): number[] {
  const parsed = parseGraceXmlArtifact("rulings.xml", rulingsXml);
  if (!parsed.root) {
    return [];
  }
  const spans = computeElementSpans(rulingsXml, parsed);
  const counts: number[] = [];
  for (const node of childNodes(parsed.root, "Decision")) {
    if (node.attributes.status !== "live") {
      continue;
    }
    if (headingLevelFromTitle(childText(node, "Title") ?? "") !== 2) {
      continue;
    }
    const span = spans.get(node);
    if (!span || span.closeStart === null || span.closeEnd === null) {
      continue;
    }
    counts.push(newlineCount(rulingsXml.slice(span.openStart, span.closeEnd)) + 1);
  }
  return counts;
}

/**
 * Locates one attribute's value bytes inside an open tag, walking the tag
 * char-by-char and tracking quoted attribute values, so a value that merely
 * contains the attribute name can never be mistaken for the attribute itself.
 * Returns the range of the value's inner bytes (between the quotes).
 */
function attributeValueRange(openTag: string, name: string): { valueStart: number; valueEnd: number } | undefined {
  const n = openTag.length - 1; // the final > sits at n
  let i = 1; // past "<"
  while (i < n) {
    while (i < n && /\s/.test(openTag[i]!)) i++;
    if (i >= n) {
      break;
    }
    if (openTag[i] === "/" || openTag[i] === ">") {
      break;
    }
    const nameStart = i;
    while (i < n && !/[\s=/>]/.test(openTag[i]!)) i++;
    const nameText = openTag.slice(nameStart, i);
    while (i < n && /\s/.test(openTag[i]!)) i++;
    if (openTag[i] !== "=") {
      continue;
    }
    i++;
    while (i < n && /\s/.test(openTag[i]!)) i++;
    const quote = openTag[i];
    if (quote !== '"' && quote !== "'") {
      continue;
    }
    i++;
    const valueStart = i;
    while (i < n && openTag[i] !== quote) i++;
    if (i >= n) {
      break;
    }
    const valueEnd = i;
    i++;
    if (nameText === name) {
      return { valueStart, valueEnd };
    }
  }
  return undefined;
}

/**
 * Rewrites the status attribute's value inside the open-tag bytes the span
 * map located. The open tag occupies [0, openEnd) of the element text; every
 * byte outside that range is passed through untouched.
 */
function withStatusRetired(elementText: string, openEnd: number): string {
  const openTag = elementText.slice(0, openEnd);
  const range = attributeValueRange(openTag, "status");
  if (!range) {
    throw new Error(
      `record engine: the open tag carries no readable status attribute; cannot splice the retired status into: ${openTag}`,
    );
  }
  const spliced = `${openTag.slice(0, range.valueStart)}retired${openTag.slice(range.valueEnd)}`;
  return `${spliced}${elementText.slice(openEnd)}`;
}

/**
 * Inserts the PaidBy line immediately after the open tag's closing angle
 * bracket. The caller has already verified the element carries no PaidBy
 * child (a parser read), so no regex guard is needed here.
 */
function withPaidBy(elementText: string, openEnd: number, payer: string): string {
  const insertion = `\n    <PaidBy>${xmlEscape(payer)}</PaidBy>`;
  return `${elementText.slice(0, openEnd)}${insertion}${elementText.slice(openEnd)}`;
}

/**
 * Removes exactly the parser-derived element spans, in reverse document
 * order, eating each span's trailing newline exactly as before.
 */
function removeSpans(xml: string, spans: XmlElementSpan[]): string {
  const ordered = [...spans].sort((a, b) => b.openStart - a.openStart);
  let next = xml;
  for (const span of ordered) {
    let end = span.closeEnd ?? span.openEnd;
    if (next[end] === "\n") {
      end += 1;
    }
    next = `${next.slice(0, span.openStart)}${next.slice(end)}`;
  }
  return next;
}

/**
 * Inserts elements immediately before the retired file's root close-tag
 * offset, located by the span map rather than a lastIndexOf search.
 */
function appendElements(retiredXml: string, rootCloseStart: number, elements: string[]): string {
  if (elements.length === 0) {
    return retiredXml;
  }
  let before = retiredXml.slice(0, rootCloseStart);
  if (!before.endsWith("\n")) {
    before += "\n";
  }
  const chunk = elements.map((el) => (el.endsWith("\n") ? el : `${el}\n`)).join("");
  return `${before}${chunk}${retiredXml.slice(rootCloseStart)}`;
}

/**
 * Rewrites the layer attribute of the Entry element the parser located by id,
 * inside that element's own open-tag range.
 */
function setEntryLayer(
  indexXml: string,
  span: XmlElementSpan,
  layer: "retired",
): string {
  const openTag = indexXml.slice(span.openStart, span.openEnd);
  const range = attributeValueRange(openTag, "layer");
  if (!range) {
    throw new Error(
      `record engine: the Entry open tag carries no readable layer attribute; cannot splice the retired layer into: ${openTag}`,
    );
  }
  const spliced = `${openTag.slice(0, range.valueStart)}${layer}${openTag.slice(range.valueEnd)}`;
  return `${indexXml.slice(0, span.openStart)}${spliced}${indexXml.slice(span.openEnd)}`;
}

function readRootSnapshot(root: GraceXmlNode | null): { base: number; headroom: number; ceiling: number } {
  const attrs = root?.attributes ?? {};
  return {
    base: Number(attrs.base),
    headroom: Number(attrs.headroom),
    ceiling: Number(attrs.ceiling),
  };
}

/**
 * Rewrites the root element's attributes within the root open-tag range the
 * span map located. The root open tag sits at byte 0 and is never disturbed
 * by the interior splices, so its span stays valid after removals.
 */
function withRootSnapshot(
  xml: string,
  root: GraceXmlNode,
  span: XmlElementSpan,
  snap: { base: number; headroom: number; ceiling: number },
): string {
  const nextOpenTag = `<${root.tag} base="${snap.base}" headroom="${snap.headroom}" ceiling="${snap.ceiling}">`;
  return `${nextOpenTag}${xml.slice(span.openEnd)}`;
}

/**
 * The --rewrite-roots mode's root splice: the same prefix splice the move's
 * withRootSnapshot uses, with the persisted ceiling's raw attribute bytes
 * passed through untouched — never recomputed and never re-serialised.
 */
function withRootSnapshotHeld(
  xml: string,
  root: GraceXmlNode,
  span: XmlElementSpan,
  base: number,
  headroom: number,
  ceilingRaw: string,
): string {
  const nextOpenTag = `<${root.tag} base="${base}" headroom="${headroom}" ceiling="${ceilingRaw}">`;
  return `${nextOpenTag}${xml.slice(span.openEnd)}`;
}

/**
 * The move writer's normalising pass (C-ROOT-WINDOW, F190). Rewrites only the
 * inter-element whitespace of one file the move wrote, to the canonical house
 * shape the split renderer produces: <newline><two spaces> before each
 * top-level unit, <newline> before the root close tag, and the tail after
 * the root close preserved verbatim. Every element's own bytes — the
 * parser-derived spans — pass through untouched; the root open tag is
 * preserved verbatim too, so a later withRootSnapshot splice against the
 * pre-pass span stays valid. A top-level comment is neither whitespace nor
 * an element and is not a gap: its bytes pass through in place (the shipped
 * clamp drive pads a rulings fixture with top-level comments whose bytes are
 * load-bearing), while any other non-whitespace content in the inter-element
 * region refuses the pass loudly before any write — it is not a gap and must
 * not be dropped.
 */
function normaliseGaps(xml: string, file: string): string {
  const parsed = parseGraceXmlArtifact(file, xml);
  if (!parsed.root) {
    throw new Error(`record engine: the normalising pass could not parse ${file}`);
  }
  const spans = computeElementSpans(xml, parsed);
  const rootSpan = spans.get(parsed.root)!;
  if (rootSpan.closeStart === null || rootSpan.closeEnd === null) {
    throw new Error(`record engine: the normalising pass requires a close-tag root; ${file} has a self-closing root`);
  }
  const units: Array<{ start: number; end: number }> = [];
  for (const child of parsed.root.children) {
    const span = spans.get(child);
    if (!span) {
      throw new Error(`record engine: the normalising pass could not span a top-level element of ${file}`);
    }
    units.push({ start: span.openStart, end: span.closeEnd ?? span.openEnd });
  }
  const regionStart = rootSpan.openEnd;
  const regionEnd = rootSpan.closeStart;
  for (const match of xml.matchAll(/<!--[\s\S]*?-->/g)) {
    const start = match.index;
    const end = start + match[0]!.length;
    const insideElement = units.some((unit) => start < unit.end && unit.start < end);
    if (insideElement) {
      continue;
    }
    if (start < regionStart || end > regionEnd) {
      continue;
    }
    units.push({ start, end });
  }
  units.sort((a, b) => a.start - b.start);
  let cursor = regionStart;
  for (const unit of units) {
    if (xml.slice(cursor, unit.start).trim() !== "") {
      throw new Error(`record engine: the normalising pass found non-whitespace bytes between top-level units of ${file}; refusing to drop them`);
    }
    cursor = unit.end;
  }
  if (xml.slice(cursor, regionEnd).trim() !== "") {
    throw new Error(`record engine: the normalising pass found non-whitespace content before the root close tag of ${file}; refusing to drop it`);
  }
  const parts: string[] = [xml.slice(0, regionStart)];
  for (const unit of units) {
    parts.push(`\n  ${xml.slice(unit.start, unit.end)}`);
  }
  parts.push(`\n</${parsed.root.tag}>`);
  parts.push(xml.slice(rootSpan.closeEnd));
  return parts.join("");
}

/**
 * The unmoved-genre hold (C-ROOT-WINDOW, INV-ROOT-WINDOW-UNMOVED, maintainer's
 * resolution): a genre the move did not change keeps its persisted ceiling
 * while its base is re-derived from the shipped metric read back and headroom
 * becomes the remainder. One rule, shared by the move and the
 * --rewrite-roots mode; at any tripwire-consistent record the held splice is
 * byte-identical to the persisted bytes.
 */
function holdSnapshot(
  previous: { base: number; headroom: number; ceiling: number },
  base: number,
): { base: number; headroom: number; ceiling: number } {
  return { base, headroom: previous.ceiling - base, ceiling: previous.ceiling };
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
  const parsed = parseGraceXmlArtifact("findings.xml", xml);
  if (!parsed.root) {
    return [];
  }
  const spans = computeElementSpans(xml, parsed);
  const counts: number[] = [];
  for (const node of walkNodes(parsed.root)) {
    if (node.tag !== "Finding") {
      continue;
    }
    const span = spans.get(node)!;
    if (span.closeStart === null || span.closeEnd === null) {
      continue;
    }
    counts.push(newlineCount(xml.slice(span.openStart, span.closeEnd)) + 1);
  }
  return counts;
}

function liveRowCount(xml: string): number {
  const parsed = parseGraceXmlArtifact("registry.xml", xml);
  if (!parsed.root) {
    return 0;
  }
  return childNodes(parsed.root, "Row").filter((row) => row.attributes.status !== "retired").length;
}

function liveEntryCount(xml: string): number {
  const parsed = parseGraceXmlArtifact("decisions.xml", xml);
  if (!parsed.root) {
    return 0;
  }
  return childNodes(parsed.root, "Entry").filter((entry) => entry.attributes.layer !== "retired").length;
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

function resolveCodifiedChildren(
  node: GraceXmlNode,
  repoRoot: string,
): Array<{ ok: boolean; message: string }> {
  return childNodes(node, "CodifiedIn").map((coded) =>
    codifiedResolves({ attrs: coded.attributes, text: coded.text }, repoRoot),
  );
}

function resolveTaughtChildren(
  node: GraceXmlNode,
  repoRoot: string,
): Array<{ ok: boolean; message: string }> {
  return childNodes(node, "TaughtIn").map((taught) =>
    taughtResolvesCheck({ attrs: taught.attributes, text: taught.text }, repoRoot),
  );
}

function allResolveAndSomeOk(results: Array<{ ok: boolean; message: string }>): boolean {
  return results.length > 0 && results.every((r) => r.ok);
}

export function stampPaidBy(options: RetirementOptions): void {
  const paths = recordPaths(options.recordDir);
  const findingsXml = readFileSync(paths.findings, "utf8");
  const registryXml = readFileSync(paths.registry, "utf8");
  const registryRetiredXml = readFileSync(paths.registryRetired, "utf8");
  const payers = payerMapFromRecord(options.repoRoot, registryXml, registryRetiredXml);
  const archive = listArchiveNames(options.repoRoot);
  const findingsParse = parseGraceXmlArtifact(paths.findings, findingsXml);
  if (!findingsParse.root) {
    return;
  }
  const spans = computeElementSpans(findingsXml, findingsParse);
  const nodes = [...walkNodes(findingsParse.root)].filter((node) => node.tag === "Finding");
  let next = findingsXml;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    const span = spans.get(node)!;
    if (node.attributes.status !== "live") {
      continue;
    }
    const token = node.attributes.token ?? "";
    const payer = payers.get(token);
    if (!payer || !archive.has(payer) || childText(node, "PaidBy") !== undefined) {
      continue;
    }
    const elementText = findingsXml.slice(span.openStart, span.closeEnd!);
    const openEnd = span.openEnd - span.openStart;
    const stamped = withPaidBy(elementText, openEnd, payer);
    next = `${next.slice(0, span.openStart)}${stamped}${next.slice(span.closeEnd!)}`;
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

  const findingsParse = parseGraceXmlArtifact(paths.findings, files.findings);
  const rulingsParse = parseGraceXmlArtifact(paths.rulings, files.rulings);
  const registryParse = parseGraceXmlArtifact(paths.registry, files.registry);
  const indexParse = parseGraceXmlArtifact(paths.index, files.index);
  const rulingsAsRead = readRootSnapshot(rulingsParse.root);
  const findingNodes = findingsParse.root ? [...walkNodes(findingsParse.root)].filter((node) => node.tag === "Finding") : [];
  const decisionNodes = rulingsParse.root ? childNodes(rulingsParse.root, "Decision") : [];
  const rowNodes = registryParse.root ? childNodes(registryParse.root, "Row") : [];

  const findingSpans = findingsParse.root ? computeElementSpans(files.findings, findingsParse) : new Map();
  const decisionSpans = rulingsParse.root ? computeElementSpans(files.rulings, rulingsParse) : new Map();
  const rowSpans = registryParse.root ? computeElementSpans(files.registry, registryParse) : new Map();

  const moveFindings: Array<{ span: XmlElementSpan; next: string; id: string }> = [];
  for (const node of findingNodes) {
    const span = findingSpans.get(node)!;
    const elementText = files.findings.slice(span.openStart, span.closeEnd!);
    if (node.attributes.status !== "live") {
      continue;
    }
    const token = node.attributes.token ?? "";
    const derived = payers.get(token);
    const stored = childText(node, "PaidBy")?.trim();
    const payer = derived && archive.has(derived) ? derived : stored && archive.has(stored) ? stored : undefined;
    if (!payer) {
      continue;
    }
    moveFindings.push({
      span,
      next: withStatusRetired(withPaidBy(elementText, span.openEnd - span.openStart, payer), span.openEnd - span.openStart),
      id: node.attributes.id ?? "",
    });
  }

  const moveDecisions: Array<{ span: XmlElementSpan; next: string; id: string }> = [];
  for (const node of decisionNodes) {
    const span = decisionSpans.get(node)!;
    const elementText = files.rulings.slice(span.openStart, span.closeEnd!);
    if (node.attributes.status !== "live") {
      continue;
    }
    const coded = resolveCodifiedChildren(node, options.repoRoot);
    if (!allResolveAndSomeOk(coded)) {
      continue;
    }
    moveDecisions.push({
      span,
      next: withStatusRetired(elementText, span.openEnd - span.openStart),
      id: node.attributes.id ?? "",
    });
  }

  const moveRows: Array<{ span: XmlElementSpan; next: string; id: string }> = [];
  for (const node of rowNodes) {
    const span = rowSpans.get(node)!;
    const elementText = files.registry.slice(span.openStart, span.closeEnd!);
    const name = node.attributes.name ?? "";
    if (node.attributes.status === "retired") {
      continue;
    }
    if (!archive.has(name)) {
      continue;
    }
    moveRows.push({
      span,
      next: withStatusRetired(elementText, span.openEnd - span.openStart),
      id: name,
    });
  }

  const movedCount = moveFindings.length + moveDecisions.length + moveRows.length;
  if (movedCount === 0) {
    return { moved: 0 };
  }

  const retiredSpans = (xmlKey: string, file: string): number => {
    const parsed = parseGraceXmlArtifact(file, xmlKey);
    if (!parsed.root) {
      throw new Error(`record engine: the retired sibling ${file} has no parsed root; cannot locate its root close-tag offset`);
    }
    const spans = computeElementSpans(xmlKey, parsed);
    const rootSpan = spans.get(parsed.root)!;
    if (rootSpan.closeStart === null) {
      throw new Error(`record engine: the retired sibling ${file} has a self-closing root; cannot locate its root close-tag offset`);
    }
    return rootSpan.closeStart;
  };

  let findingsLive = removeSpans(
    files.findings,
    moveFindings.map((m) => m.span),
  );
  let findingsRetired = appendElements(
    files.findingsRetired,
    retiredSpans(files.findingsRetired, paths.findingsRetired),
    moveFindings.map((m) => m.next),
  );
  let rulingsLive = removeSpans(
    files.rulings,
    moveDecisions.map((m) => m.span),
  );
  let rulingsRetired = appendElements(
    files.rulingsRetired,
    retiredSpans(files.rulingsRetired, paths.rulingsRetired),
    moveDecisions.map((m) => m.next),
  );
  let registryLive = removeSpans(
    files.registry,
    moveRows.map((m) => m.span),
  );
  let registryRetired = appendElements(
    files.registryRetired,
    retiredSpans(files.registryRetired, paths.registryRetired),
    moveRows.map((m) => m.next),
  );
  let indexXml = files.index;
  const indexSpans = indexParse.root
    ? computeElementSpans(files.index, indexParse)
    : new Map<GraceXmlNode, XmlElementSpan>();
  let indexLayerFlips = 0;
  if (indexParse.root) {
    const layerEdits: XmlElementSpan[] = [];
    for (const item of [...moveFindings, ...moveDecisions]) {
      const entry = [...walkNodes(indexParse.root)].find(
        (node) => node.tag === "Entry" && node.attributes.id === item.id,
      );
      if (!entry) {
        continue;
      }
      layerEdits.push(indexSpans.get(entry)!);
    }
    // distinct Entries, non-overlapping open tags: splice back-to-front so
    // earlier spans stay valid
    layerEdits.sort((a, b) => b.openStart - a.openStart);
    indexLayerFlips = layerEdits.length;
    for (const span of layerEdits) {
      indexXml = setEntryLayer(indexXml, span, "retired");
    }
  }

  // The normalising pass (C-ROOT-WINDOW, F190): every file the move wrote —
  // a genre with removals, its retired sibling with appends, and the index
  // when its layers flipped — has its inter-element whitespace rewritten to
  // the canonical house shape. Element bytes pass through from the
  // parser-derived spans; a genre with zero moved elements keeps its bytes,
  // so pre-existing drift there stays until its own move normalises it.
  if (moveFindings.length > 0) {
    findingsLive = normaliseGaps(findingsLive, paths.findings);
    findingsRetired = normaliseGaps(findingsRetired, paths.findingsRetired);
  }
  if (moveDecisions.length > 0) {
    rulingsLive = normaliseGaps(rulingsLive, paths.rulings);
    rulingsRetired = normaliseGaps(rulingsRetired, paths.rulingsRetired);
  }
  if (moveRows.length > 0) {
    registryLive = normaliseGaps(registryLive, paths.registry);
    registryRetired = normaliseGaps(registryRetired, paths.registryRetired);
  }
  if (indexLayerFlips > 0) {
    indexXml = normaliseGaps(indexXml, paths.index);
  }

  const findingsPrev = readRootSnapshot(findingsParse.root);
  const findingsBaseRead = newlineCount(files.findings);
  const rulingsPrev = rulingsAsRead;
  const rulingsBaseRead = newlineCount(files.rulings);
  const registryPrev = readRootSnapshot(registryParse.root);
  const indexPrev = readRootSnapshot(indexParse.root);

  const findingsHeadroom = Math.floor(7 * median(findingLineCounts(findingsLive)));
  const rulingsHeadroom = Math.floor(7 * median(liveH2DecisionLineCounts(rulingsLive)));
  findingsLive = withRootSnapshot(
    findingsLive,
    findingsParse.root!,
    findingSpans.get(findingsParse.root!)!,
    moveFindings.length > 0
      ? persistSnapshot(
        findingsPrev,
        newlineCount(findingsLive),
        findingsHeadroom,
        true,
        findingsBaseRead,
      )
      : holdSnapshot(findingsPrev, newlineCount(findingsLive)),
  );
  rulingsLive = withRootSnapshot(
    rulingsLive,
    rulingsParse.root!,
    decisionSpans.get(rulingsParse.root!)!,
    moveDecisions.length > 0
      ? persistSnapshot(
        rulingsPrev,
        newlineCount(rulingsLive),
        rulingsHeadroom,
        true,
        rulingsBaseRead,
      )
      : holdSnapshot(rulingsPrev, newlineCount(rulingsLive)),
  );
  registryLive = withRootSnapshot(
    registryLive,
    registryParse.root!,
    rowSpans.get(registryParse.root!)!,
    moveRows.length > 0
      ? persistSnapshot(registryPrev, liveRowCount(registryLive), 15, true)
      : holdSnapshot(registryPrev, liveRowCount(registryLive)),
  );
  indexXml = withRootSnapshot(
    indexXml,
    indexParse.root!,
    indexSpans.get(indexParse.root!)!,
    indexLayerFlips > 0
      ? persistSnapshot(indexPrev, liveEntryCount(indexXml), INDEX_HEADROOM_ENTRIES, true)
      : holdSnapshot(indexPrev, liveEntryCount(indexXml)),
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

/**
 * The --rewrite-roots mode (C-ROOT-WINDOW, F216, INV-ROOT-WINDOW-MODE-CEILING
 * maintainer's resolution): re-derives, for each of the four live genre
 * roots, base from the shipped metric read back — newlineCount of the whole
 * file for findings and rulings, the live Row count for the registry, the
 * live Entry count for the index — holds the persisted ceiling byte-for-byte
 * (the raw attribute value passes through, never recomputed and never
 * re-serialised), and persists headroom = ceiling − base. It refuses, before
 * any write, when any live genre's count exceeds its persisted ceiling — the
 * one state whose only remedy is the move — and when a ceiling attribute is
 * missing or unreadable. It re-derives all four live roots or none; retired
 * siblings carry no root attributes and are not touched; the stub and the
 * inventory are not touched. A hand-raised ceiling is held, never adopted
 * and never recomputed — the laundering boundary stated in the spec's
 * Known-boundary Constraint.
 */
export function rewriteRecordRoots(options: RetirementOptions): void {
  const paths = recordPaths(options.recordDir);
  const liveGenres: Array<{
    part: string;
    file: string;
    xml: string;
    unit: string;
    remedy: string;
    metric: (xml: string) => number;
  }> = [
    {
      part: "findings",
      file: paths.findings,
      xml: readFileSync(paths.findings, "utf8"),
      unit: "line",
      remedy: "move the eligible entry to the retired sibling",
      metric: (xml) => newlineCount(xml),
    },
    {
      part: "rulings",
      file: paths.rulings,
      xml: readFileSync(paths.rulings, "utf8"),
      unit: "line",
      remedy: "move the eligible entry to the retired sibling",
      metric: (xml) => newlineCount(xml),
    },
    {
      part: "registry",
      file: paths.registry,
      xml: readFileSync(paths.registry, "utf8"),
      unit: "live-row",
      remedy: "move the eligible entry to the retired sibling",
      metric: (xml) => liveRowCount(xml),
    },
    {
      part: "index",
      file: paths.index,
      xml: readFileSync(paths.index, "utf8"),
      unit: "live-entry",
      remedy:
        "the eligible entries flip their index Entry layer to retired in place; the index has no retired sibling and its Entry lines stay",
      metric: (xml) => liveEntryCount(xml),
    },
  ];
  // Every root is derived before any file is written: the mode re-derives
  // all four live roots or none.
  const rewrites: Array<{ file: string; next: string }> = [];
  for (const genre of liveGenres) {
    const parsed = parseGraceXmlArtifact(genre.file, genre.xml);
    if (!parsed.root) {
      throw new Error(
        `missing-ceiling: ${genre.file}: live ${genre.part} has no readable root; --rewrite-roots holds the persisted ceiling and cannot re-derive one`,
      );
    }
    let rootSpan: XmlElementSpan;
    try {
      rootSpan = computeElementSpans(genre.xml, parsed).get(parsed.root)!;
    } catch (error) {
      throw new Error(
        `missing-ceiling: ${genre.file}: live ${genre.part} has no readable root open tag; --rewrite-roots holds the persisted ceiling and cannot re-derive one (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const openTag = genre.xml.slice(rootSpan.openStart, rootSpan.openEnd);
    const range = attributeValueRange(openTag, "ceiling");
    const ceilingRaw = range ? openTag.slice(range.valueStart, range.valueEnd) : undefined;
    if (ceilingRaw === undefined || ceilingRaw === "") {
      throw new Error(
        `missing-ceiling: ${genre.file}: live ${genre.part} has no persisted ceiling; --rewrite-roots holds ceilings and never derives one; --retire / ${genre.remedy} persists ceiling = base + headroom`,
      );
    }
    const ceiling = Number(ceilingRaw);
    if (!Number.isFinite(ceiling)) {
      throw new Error(
        `ceiling-unreadable: ${genre.file}: live ${genre.part} carries ceiling="${ceilingRaw}", which is not a readable number; --rewrite-roots holds the persisted ceiling and cannot re-derive around it`,
      );
    }
    const base = genre.metric(genre.xml);
    if (base > ceiling) {
      throw new Error(
        `ceiling-exceeded: ${genre.file}: live ${genre.part} ${genre.unit} count ${base} exceeds persisted ceiling ${ceiling}; --retire / ${genre.remedy}. Raising the persisted ceiling is not the remedy.`,
      );
    }
    rewrites.push({
      file: genre.file,
      next: withRootSnapshotHeld(genre.xml, parsed.root, rootSpan, base, ceiling - base, ceilingRaw),
    });
  }
  for (const rewrite of rewrites) {
    writeFileSync(rewrite.file, rewrite.next);
  }
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
  }

  const findingsRoot = parseRecordRoot(paths.findings, files.findings!, findings);
  const rulingsRoot = parseRecordRoot(paths.rulings, files.rulings!, findings);
  const registryRoot = parseRecordRoot(paths.registry, files.registry!, findings);
  const registryRetiredRoot = parseRecordRoot(paths.registryRetired, files.registryRetired!, findings);
  const findingsRetiredRoot = parseGraceXmlArtifact(paths.findingsRetired, files.findingsRetired!).root;
  const rulingsRetiredRoot = parseGraceXmlArtifact(paths.rulingsRetired, files.rulingsRetired!).root;
  const indexRoot = parseGraceXmlArtifact(paths.index, files.index!).root;

  // A fenced metadata block is refused anywhere outside a Body element: the
  // parser walk exempts Body subtrees and checks every other text node.
  const parsedRoots: Array<[file: string, root: GraceXmlNode | null]> = [
    [paths.findings, findingsRoot],
    [paths.findingsRetired, findingsRetiredRoot],
    [paths.rulings, rulingsRoot],
    [paths.rulingsRetired, rulingsRetiredRoot],
    [paths.registry, registryRoot],
    [paths.registryRetired, registryRetiredRoot],
    [paths.index, indexRoot],
  ];
  for (const [file, root] of parsedRoots) {
    if (root && fencedOutsideBody(root, false)) {
      findings.push({
        code: "fenced-metadata",
        message: `${file}: fenced metadata block is not allowed; machine-read fields are XML attributes or elements`,
      });
    }
  }

  checkRecordShape(paths.findings, findingsRoot, findings);
  checkRecordShape(paths.findingsRetired, findingsRetiredRoot, findings);
  checkRecordShape(paths.rulings, rulingsRoot, findings);
  checkRecordShape(paths.rulingsRetired, rulingsRetiredRoot, findings);
  checkRecordShape(paths.registry, registryRoot, findings);
  checkRecordShape(paths.registryRetired, registryRetiredRoot, findings);
  checkRecordShape(paths.index, indexRoot, findings);
  checkStatusFile(paths.findings, files.findings!, "Finding", "live", findings);
  checkStatusFile(paths.findingsRetired, files.findingsRetired!, "Finding", "retired", findings);
  checkStatusFile(paths.rulings, files.rulings!, "Decision", "live", findings);
  checkStatusFile(paths.rulingsRetired, files.rulingsRetired!, "Decision", "retired", findings);
  checkStatusFile(paths.registry, files.registry!, "Row", "live", findings);
  checkStatusFile(paths.registryRetired, files.registryRetired!, "Row", "retired", findings);
  checkRegistryKinds(paths.registry, registryRoot, findings);
  checkRegistryKinds(paths.registryRetired, registryRetiredRoot, findings);
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
      const coded = resolveCodifiedChildren(node, options.repoRoot);
      const taught = resolveTaughtChildren(node, options.repoRoot);
      for (const result of coded) {
        if (!result.ok) {
          findings.push({
            code: "codified-in-unresolved",
            message: `live decision id="${node.attributes.id}": ${result.message}`,
          });
        }
      }
      for (const result of taught) {
        if (!result.ok) {
          findings.push({
            code: "taught-in-unresolved",
            message: `live decision id="${node.attributes.id}": ${result.message}`,
          });
        }
      }
      if (allResolveAndSomeOk(coded)) {
        findings.push({
          code: "decision-eligible-still-live",
          message: `live decision id="${node.attributes.id}" carries a resolving CodifiedIn; move the eligible entry to the retired sibling`,
        });
      }
    }
  }

  checkCeiling("findings", paths.findings, files.findings!, findingsRoot, "line", findings);
  checkCeiling("rulings", paths.rulings, files.rulings!, rulingsRoot, "line", findings);
  checkRulingsProvenance(paths.rulings, rulingsRoot, findings);
  checkCeilingValue("index", paths.index, indexRoot, liveEntryCount(files.index!), "live-entry", findings);
  const registryLiveRows = registryRoot
    ? childNodes(registryRoot, "Row").filter((row) => row.attributes.status !== "retired").length
    : 0;
  checkCeilingValue("registry", paths.registry, registryRoot, registryLiveRows, "live-row", findings);

  return findings;
}

function checkRulingsProvenance(
  file: string,
  root: GraceXmlNode | null,
  findings: RetirementFinding[],
): void {
  const ceilingText = root?.attributes.ceiling;
  if (ceilingText === undefined || ceilingText === "") {
    return;
  }
  const ceiling = Number(ceilingText);
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
  const parsed = parseGraceXmlArtifact(file, xml);
  if (!parsed.root) {
    return;
  }
  for (const node of walkNodes(parsed.root)) {
    if (node.tag !== tag) {
      continue;
    }
    if (node.attributes.status !== expected) {
      findings.push({
        code: "status-file-mismatch",
        message: `${file}: ${tag} id="${node.attributes.id ?? node.attributes.name ?? "?"}" has status="${node.attributes.status}" but the file is the ${expected} sibling`,
      });
    }
  }
}

function fencedOutsideBody(node: GraceXmlNode, insideBody: boolean): boolean {
  const inBody = insideBody || node.tag === "Body";
  if (!inBody && FENCE_RE.test(node.text)) {
    return true;
  }
  for (const child of node.children) {
    if (fencedOutsideBody(child, inBody)) {
      return true;
    }
  }
  return false;
}

function checkCeiling(
  part: string,
  file: string,
  xml: string,
  root: GraceXmlNode | null,
  unit: string,
  findings: RetirementFinding[],
): void {
  checkCeilingValue(part, file, root, newlineCount(xml), unit, findings);
}

function checkCeilingValue(
  part: string,
  file: string,
  root: GraceXmlNode | null,
  liveSize: number,
  unit: string,
  findings: RetirementFinding[],
): void {
  if (!root) {
    findings.push({
      code: "missing-root",
      message: `${file}: missing expected root for ${part}`,
    });
    return;
  }
  const attrs = root.attributes;
  if (attrs.ceiling === undefined || attrs.ceiling === "") {
    findings.push({
      code: "missing-ceiling",
      message: `${file}: live ${part} has no persisted ceiling; the retirement pass persists ceiling = base + headroom`,
    });
    return;
  }
  const ceiling = Number(attrs.ceiling);
  if (liveSize > ceiling) {
    const remedy =
      part === "index"
        ? "the eligible entries flip their index Entry layer to retired in place; the index has no retired sibling and its Entry lines stay"
        : "move the eligible entry to the retired sibling";
    findings.push({
      code: "ceiling-exceeded",
      message: `${file}: live ${part} ${unit} count ${liveSize} exceeds persisted ceiling ${ceiling}; --retire / ${remedy}. Raising the persisted ceiling is not the remedy.`,
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
  const mode = argv.find(
    (a) => a === "--split" || a === "--retire" || a === "--stamp-paid-by" || a === "--rewrite-roots",
  );
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
  if (mode === "--rewrite-roots") {
    try {
      rewriteRecordRoots({ repoRoot: cwd, recordDir });
      console.log(`record-retirement: rewrite-roots ok (${recordDir})`);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
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
