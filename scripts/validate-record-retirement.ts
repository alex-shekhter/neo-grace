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

export function collectPaidBy(repoRoot: string, chartered: RegistryRow[]): Map<string, string> {
  const paid = new Map<string, string>();
  const archive = listArchiveNames(repoRoot);
  for (const row of chartered) {
    if (!/delivered|superseded/i.test(row.statusText)) {
      continue;
    }
    const tokens = row.pays.match(F_TOKEN_RE) ?? [];
    for (const token of tokens) {
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

  for (const el of extractElements(files.findings!, "Finding")) {
    if (el.attrs.status !== "live") continue;
    const paid = childInner(el.inner, "PaidBy");
    if (!paid) continue;
    const name = xmlDecode(paid).trim();
    if (archive.has(name)) {
      findings.push({
        code: "finding-eligible-still-live",
        message: `live finding id="${el.attrs.id}" token="${el.attrs.token}" has PaidBy ${name}, which is a directory under .ngrace/changes/archive/ (archive event ${name}); move the eligible entry to the retired sibling`,
      });
    }
  }

  for (const el of extractElements(files.registry!, "Row")) {
    if (el.attrs.status !== "live") continue;
    const name = el.attrs.name ?? "";
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

  for (const el of extractElements(files.rulings!, "Decision")) {
    if (el.attrs.status !== "live") continue;
    const coded = childOpenAttrs(el.inner, "CodifiedIn");
    const taught = childOpenAttrs(el.inner, "TaughtIn");
    const codedResolves = coded ? codifiedResolves(coded, options.repoRoot).ok : false;
    const taughtResolves = taught ? taughtResolvesCheck(taught, options.repoRoot).ok : false;
    if (coded) {
      const result = codifiedResolves(coded, options.repoRoot);
      if (!result.ok) {
        findings.push({
          code: "codified-in-unresolved",
          message: `live decision id="${el.attrs.id}": ${result.message}`,
        });
      }
    }
    if (taught) {
      const result = taughtResolvesCheck(taught, options.repoRoot);
      if (!result.ok) {
        findings.push({
          code: "taught-in-unresolved",
          message: `live decision id="${el.attrs.id}": ${result.message}`,
        });
      }
    }
    if (codedResolves || taughtResolves) {
      const tag = codedResolves ? "CodifiedIn" : "TaughtIn";
      findings.push({
        code: "decision-eligible-still-live",
        message: `live decision id="${el.attrs.id}" carries a resolving ${tag}; move the eligible entry to the retired sibling`,
      });
    }
  }

  checkCeiling("findings", paths.findings, files.findings!, "line", findings);
  checkCeiling("rulings", paths.rulings, files.rulings!, "line", findings);
  checkCeiling("index", paths.index, files.index!, "line", findings);
  const liveRowCount = extractElements(files.registry!, "Row").filter((r) => r.attrs.status !== "retired").length;
  checkCeilingValue("registry", paths.registry, files.registry!, liveRowCount, "live-row", findings);

  return findings;
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
      message: `${file}: live ${part} ${unit} count ${liveSize} exceeds persisted ceiling ${ceiling}; move the eligible entry to the retired sibling. Raising the persisted ceiling is not the remedy.`,
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
  if (argv[0] === "--split") {
    splitFrozenRecord(cwd);
    console.log("record-retirement: split ok");
    return 0;
  }
  const recordDir = path.resolve(cwd, argv[0] ?? DEFAULT_RECORD_DIR);
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
