#!/usr/bin/env bun
/**
 * Citation-anchor identity gate for the RM-GOVERNED-PATH record.
 *
 * Production invocation with no argv validates the stub at DEFAULT_TARGET
 * and the XML index the stub names. argv naming a fixture path validates
 * that stub and the index it names in that directory and does not read
 * the repository's record files.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { XMLValidator } from "fast-xml-parser";

export const DEFAULT_TARGET = "docs/plans/active/RM-GOVERNED-PATH/decisions.md";
export const INDEX_REL = "./decisions.xml";
export const INVENTORY_NAME = "record-inventory.json";
const FRAG_RE = /\]\(#([fd][0-9][0-9a-z.-]*)\)/g;
const GENRE_FILES = [
  "findings.xml",
  "findings-retired.xml",
  "rulings.xml",
  "rulings-retired.xml",
] as const;

export type CitationAnchorFinding = {
  code: string;
  line: number;
  message: string;
};

type InventoryEntry = {
  token: string;
  id: string;
  bodyHash?: string;
};

type IndexEntry = {
  id: string;
  token: string;
  line: number;
};

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][\w:-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function xmlDecode(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

export function validateStubAndIndex(stubPath: string): CitationAnchorFinding[] {
  const findings: CitationAnchorFinding[] = [];
  const dir = path.dirname(stubPath);
  if (!existsSync(stubPath)) {
    findings.push({
      code: "missing-stub",
      line: 0,
      message: `citation-anchors: stub not found: ${stubPath}`,
    });
    return findings;
  }
  const stub = readFileSync(stubPath, "utf8");
  if (!stub.includes(INDEX_REL)) {
    findings.push({
      code: "missing-index-pointer",
      line: 0,
      message: `${stubPath}: stub does not name ${INDEX_REL} as the parseable index by relative path`,
    });
    return findings;
  }
  const indexPath = path.join(dir, "decisions.xml");
  if (!existsSync(indexPath)) {
    findings.push({
      code: "missing-index",
      line: 0,
      message: `citation-anchors: index not found: ${indexPath}`,
    });
    return findings;
  }
  const indexXml = readFileSync(indexPath, "utf8");
  const valid = XMLValidator.validate(indexXml);
  if (valid !== true) {
    findings.push({
      code: "malformed-index",
      line: 0,
      message: `${indexPath}: index is not well-formed RecordIndex (${valid.err.msg})`,
    });
    return findings;
  }
  if (!/<RecordIndex\b/.test(indexXml)) {
    findings.push({
      code: "malformed-index",
      line: 0,
      message: `${indexPath}: root is not RecordIndex`,
    });
    return findings;
  }

  const entries: IndexEntry[] = [];
  const seen = new Map<string, number>();
  const entryRe = /<Entry\b([^>]*)\/?>/g;
  let em: RegExpExecArray | null;
  while ((em = entryRe.exec(indexXml)) !== null) {
    const attrs = parseAttrs(em[1] ?? "");
    const line = indexXml.slice(0, em.index).split("\n").length;
    const id = attrs.id ?? "";
    const token = attrs.token ?? "";
    if (seen.has(id)) {
      findings.push({
        code: "duplicate-id",
        line,
        message: `${indexPath}:${line}: duplicate index id "${id}" (first at line ${seen.get(id)})`,
      });
    } else {
      seen.set(id, line);
    }
    entries.push({ id, token, line });
  }

  const inventoryPath = path.join(dir, INVENTORY_NAME);
  if (!existsSync(inventoryPath)) {
    findings.push({
      code: "missing-inventory",
      line: 0,
      message: `citation-anchors: inventory not found: ${inventoryPath}`,
    });
    return findings;
  }
  let inventory: InventoryEntry[] = [];
  try {
    inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as InventoryEntry[];
  } catch {
    findings.push({
      code: "malformed-inventory",
      line: 0,
      message: `${inventoryPath}: inventory is not JSON`,
    });
    return findings;
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const item of inventory) {
    const hit = byId.get(item.id);
    if (!hit) {
      findings.push({
        code: "missing-inventory-id",
        line: 0,
        message: `${indexPath}: index is missing inventory id "${item.id}" token "${item.token}"`,
      });
      continue;
    }
    if (hit.token !== item.token) {
      findings.push({
        code: "token-mismatch",
        line: hit.line,
        message: `${indexPath}:${hit.line}: inventory id "${item.id}" has token "${item.token}" but index token is "${hit.token}"`,
      });
    }
  }

  for (const genre of GENRE_FILES) {
    const genrePath = path.join(dir, genre);
    if (!existsSync(genrePath)) {
      continue;
    }
    const xml = readFileSync(genrePath, "utf8");
    const bodyRe = /<Body>([\s\S]*?)<\/Body>/g;
    let bm: RegExpExecArray | null;
    while ((bm = bodyRe.exec(xml)) !== null) {
      const decoded = xmlDecode(bm[1] ?? "");
      const lineBase = xml.slice(0, bm.index).split("\n").length;
      FRAG_RE.lastIndex = 0;
      let fm: RegExpExecArray | null;
      while ((fm = FRAG_RE.exec(decoded)) !== null) {
        const dest = fm[1]!;
        if (!seen.has(dest)) {
          findings.push({
            code: "unresolved-fragment",
            line: lineBase,
            message: `${genrePath}: Body ](#${dest}) does not resolve to an index id`,
          });
        }
      }
    }
  }

  return findings;
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const target = path.resolve(cwd, argv[0] ?? DEFAULT_TARGET);
  const findings = validateStubAndIndex(target);
  if (findings.length === 0) {
    console.log(`citation-anchors: ok (${target})`);
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
