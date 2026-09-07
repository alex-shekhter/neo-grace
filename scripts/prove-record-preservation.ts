#!/usr/bin/env bun
/**
 * Preservation proof for the RM-GOVERNED-PATH record split.
 *
 * Exits 0 iff every inventory heading token is present on the index with
 * its assigned id and every whitespace-normalized decoded Body hash is
 * present in the union of the four genre body files.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { childNodes, childText, parseGraceXmlArtifact, walkNodes } from "../src/artifact/xml.ts";
import {
  DEFAULT_RECORD_DIR,
  hashBody,
  xmlDecode,
} from "./validate-record-retirement.ts";

export type PreservationFinding = {
  code: string;
  message: string;
};

type InventoryEntry = {
  token: string;
  id: string;
  bodyHash: string;
};

const GENRE_FILES = [
  "findings.xml",
  "findings-retired.xml",
  "rulings.xml",
  "rulings-retired.xml",
] as const;

export function proveRecordPreservation(recordDir: string): PreservationFinding[] {
  const findings: PreservationFinding[] = [];
  const inventoryPath = path.join(recordDir, "record-inventory.json");
  const indexPath = path.join(recordDir, "decisions.xml");
  if (!existsSync(inventoryPath)) {
    findings.push({
      code: "missing-inventory",
      message: `preservation: missing ${inventoryPath}`,
    });
    return findings;
  }
  if (!existsSync(indexPath)) {
    findings.push({
      code: "missing-index",
      message: `preservation: missing ${indexPath}`,
    });
    return findings;
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as InventoryEntry[];
  const indexXml = readFileSync(indexPath, "utf8");
  const parsedIndex = parseGraceXmlArtifact(indexPath, indexXml);
  if (!parsedIndex.root) {
    findings.push({
      code: "malformed-index",
      message: `preservation: ${indexPath} is not well-formed (${parsedIndex.issues[0]?.message ?? "parse failed"})`,
    });
    return findings;
  }
  const indexEntries: Array<{ id: string; token: string }> = [];
  for (const node of walkNodes(parsedIndex.root)) {
    if (node.tag !== "Entry") {
      continue;
    }
    indexEntries.push({ id: node.attributes.id ?? "", token: node.attributes.token ?? "" });
  }
  const indexById = new Map(indexEntries.map((e) => [e.id, e]));

  for (const item of inventory) {
    const hit = indexById.get(item.id);
    if (!hit) {
      findings.push({
        code: "missing-heading-token",
        message: `preservation: inventory token "${item.token}" id "${item.id}" is not present on the index`,
      });
      continue;
    }
    if (hit.token !== item.token) {
      findings.push({
        code: "token-mismatch",
        message: `preservation: inventory id "${item.id}" token "${item.token}" does not match index token "${hit.token}"`,
      });
    }
  }

  const bodyHashes = new Set<string>();
  for (const genre of GENRE_FILES) {
    const genrePath = path.join(recordDir, genre);
    if (!existsSync(genrePath)) {
      continue;
    }
    const xml = readFileSync(genrePath, "utf8");
    const parsed = parseGraceXmlArtifact(genrePath, xml);
    if (!parsed.root) {
      continue;
    }
    const parents = [
      ...childNodes(parsed.root, "Finding"),
      ...childNodes(parsed.root, "Decision"),
    ];
    const spans: string[] = [];
    const spanRe = /<(?:Finding|Decision)\b[\s\S]*?<\/(?:Finding|Decision)>/g;
    let span: RegExpExecArray | null;
    while ((span = spanRe.exec(xml)) !== null) {
      spans.push(span[0]!);
    }
    for (let i = 0; i < parents.length; i++) {
      const raw = spans[i] ?? "";
      const body = raw.match(/<Body>([\s\S]*?)<\/Body>/)?.[1] ?? childText(parents[i]!, "Body") ?? "";
      bodyHashes.add(hashBody(xmlDecode(body)));
    }
  }

  for (const item of inventory) {
    if (!bodyHashes.has(item.bodyHash)) {
      findings.push({
        code: "missing-body-hash",
        message: `preservation: inventory id "${item.id}" token "${item.token}" body hash is not present in the union of the four genre body files`,
      });
    }
  }

  return findings;
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const recordDir = path.resolve(cwd, argv[0] ?? DEFAULT_RECORD_DIR);
  const findings = proveRecordPreservation(recordDir);
  if (findings.length === 0) {
    console.log(`record-preservation: ok (${recordDir})`);
    return 0;
  }
  for (const f of findings) {
    console.error(`${f.code}: ${f.message}`);
  }
  console.error(`record-preservation: FAILED (${findings.length} finding(s))`);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
