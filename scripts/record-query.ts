#!/usr/bin/env bun
/**
 * Read-only record query for the RM-GOVERNED-PATH record (F291).
 *
 * One house shape — `find`, `show`, `check` — over the record the engine in
 * `validate-record-retirement.ts` writes. Every read goes through the shared
 * `parseGraceXmlArtifact` and the engine's already-exported readers
 * (`structuralCheck`, `derivePayerMap`, `resolveRecordDirWithinBoundary`), so a
 * query can never disagree with the validator. It creates no state: no file, no
 * lock, no cache.
 *
 * Usage: bun ./scripts/record-query.ts <find|show|check> [options]
 *   --record-dir <dir>  default docs/plans/active/RM-GOVERNED-PATH
 *   --token <T>         filter/list by token (F*, D*)
 *   --id <id>           filter/list by lower-case id
 *   --genre <g>         finding | decision | row | entry
 *   --layer <l>         live | retired | index
 *   --pays <T>          rows whose Pays cell names T
 *   --bundle <C-ID>     the registry row named for that bundle
 *   --format <f>        text | json
 *   --json              shortcut for --format json
 * Exit: 0 success (an empty find is success); 1 not-found, unreadable record,
 * or a `check` that produced findings.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { childText, parseGraceXmlArtifact, walkNodes, type GraceXmlNode } from "../src/artifact/xml.ts";
import {
  DEFAULT_RECORD_DIR,
  derivePayerMap,
  resolveRecordDirWithinBoundary,
  structuralCheck,
} from "./validate-record-retirement.ts";

const FILE_LIVE_FINDINGS = "findings.xml";
const FILE_RETIRED_FINDINGS = "findings-retired.xml";
const FILE_LIVE_RULINGS = "rulings.xml";
const FILE_RETIRED_RULINGS = "rulings-retired.xml";
const FILE_LIVE_REGISTRY = "registry.xml";
const FILE_RETIRED_REGISTRY = "registry-retired.xml";
const FILE_INDEX = "decisions.xml";

type Genre = "finding" | "decision" | "row" | "entry";
type Layer = "live" | "retired" | "index";

type QueryEntry = {
  token: string;
  id: string;
  genre: Genre;
  layer: Layer;
  file: string;
  status: string | null;
  paidBy: string | null;
  codifiedIn: string | null;
  taughtIn: string | null;
  name: string | null;
  pays: string | null;
};

type ErrorCode = "not-found" | "invalid-arguments" | "unreadable-record";

class QueryError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const VALUE_OPTIONS = new Set(["--record-dir", "--token", "--id", "--genre", "--layer", "--pays", "--bundle", "--format"]);
const FLAG_OPTIONS = new Set(["--json", "--help"]);

function parseArgs(argv: readonly string[]): {
  positionals: string[];
  values: Record<string, string>;
  flags: Set<string>;
} {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    if (FLAG_OPTIONS.has(name)) {
      flags.add(name);
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) {
      throw new QueryError("invalid-arguments", `Unrecognized argument \`${token}\`.`);
    }
    if (inline !== undefined) {
      values[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new QueryError("invalid-arguments", `Option \`${name}\` requires a value.`);
    }
    values[name] = next;
    i++;
  }
  return { positionals, values, flags };
}

function readDocument(recordDir: string, file: string): GraceXmlNode | null {
  const full = path.join(recordDir, file);
  if (!existsSync(full)) return null;
  const parsed = parseGraceXmlArtifact(file, readFileSync(full, "utf8"));
  if (!parsed.root) {
    throw new QueryError("unreadable-record", `${file} could not be parsed.`);
  }
  return parsed.root;
}

function layerOf(file: string): "live" | "retired" {
  return file.endsWith("-retired.xml") ? "retired" : "live";
}

function childTextOrNull(node: GraceXmlNode, tag: string): string | null {
  const text = childText(node, tag);
  return text === undefined || text.trim() === "" ? null : text;
}

/** Every entry across both layers of all four genres and the index. */
function collectEntries(recordDir: string): QueryEntry[] {
  const out: QueryEntry[] = [];

  const genreDocs: Array<[string, Genre, string]> = [
    [FILE_LIVE_FINDINGS, "finding", "Finding"],
    [FILE_RETIRED_FINDINGS, "finding", "Finding"],
    [FILE_LIVE_RULINGS, "decision", "Decision"],
    [FILE_RETIRED_RULINGS, "decision", "Decision"],
    [FILE_LIVE_REGISTRY, "row", "Row"],
    [FILE_RETIRED_REGISTRY, "row", "Row"],
  ];
  for (const [file, genre, tag] of genreDocs) {
    const root = readDocument(recordDir, file);
    if (!root) continue;
    for (const node of walkNodes(root)) {
      if (node === root || node.tag !== tag) continue;
      out.push({
        token: node.attributes.token ?? "",
        id: node.attributes.id ?? node.attributes.name ?? "",
        genre,
        layer: layerOf(file),
        file,
        status: node.attributes.status ?? null,
        paidBy: childTextOrNull(node, "PaidBy"),
        codifiedIn: childTextOrNull(node, "CodifiedIn"),
        taughtIn: childTextOrNull(node, "TaughtIn"),
        name: node.attributes.name ?? null,
        pays: childTextOrNull(node, "Pays"),
      });
    }
  }

  const index = readDocument(recordDir, FILE_INDEX);
  if (index) {
    for (const node of walkNodes(index)) {
      if (node.tag !== "Entry") continue;
      const layer = (node.attributes.layer ?? "") as Layer;
      if (layer !== "live" && layer !== "retired" && layer !== "index") continue;
      out.push({
        token: node.attributes.token ?? "",
        id: node.attributes.id ?? "",
        genre: (node.attributes.genre ?? "entry") as Genre,
        layer,
        file: FILE_INDEX,
        status: null,
        paidBy: null,
        codifiedIn: null,
        taughtIn: null,
        name: null,
        pays: null,
      });
    }
  }

  return out;
}

function indexEntryFor(entries: QueryEntry[], id: string): { genre: string; layer: string } | null {
  const entry = entries.find((candidate) => candidate.file === FILE_INDEX && candidate.id === id);
  return entry ? { genre: entry.genre, layer: entry.layer } : null;
}

function applyFindFilters(entries: QueryEntry[], values: Record<string, string>): QueryEntry[] {
  const token = values["--token"]?.trim();
  const id = values["--id"]?.trim();
  const genre = values["--genre"]?.trim();
  const layer = values["--layer"]?.trim();
  const pays = values["--pays"]?.trim();
  const bundle = values["--bundle"]?.trim();
  return entries.filter((entry) => {
    if (token && entry.token !== token) return false;
    if (id && entry.id !== id) return false;
    if (genre && entry.genre !== genre) return false;
    if (layer && entry.layer !== layer) return false;
    if (bundle && !(entry.genre === "row" && entry.name === bundle)) return false;
    if (pays && !(entry.genre === "row" && (entry.pays ?? "").split(/[\s,]+/).includes(pays))) return false;
    return true;
  });
}

function formatTextLines(entries: QueryEntry[]): string {
  return entries
    .map((entry) => {
      const parts = [entry.genre, entry.token || entry.id || entry.name || "?", entry.layer];
      if (entry.status) parts.push(`status=${entry.status}`);
      if (entry.paidBy) parts.push(`paidBy=${entry.paidBy}`);
      if (entry.pays) parts.push(`pays=${entry.pays}`);
      return parts.join(" ");
    })
    .join("\n");
}

function emit(format: string, ok: boolean, payload: Record<string, unknown>, textLines: string): void {
  if (format === "json") {
    console.log(JSON.stringify({ schemaVersion: "1.0.0", ok, ...payload }, null, 2));
  } else {
    console.log(textLines);
  }
}

function resolveFormat(values: Record<string, string>, flags: Set<string>): "text" | "json" {
  const raw = flags.has("--json") ? "json" : (values["--format"] ?? "text");
  if (raw !== "text" && raw !== "json") {
    throw new QueryError("invalid-arguments", `Unsupported format \`${raw}\`. Use \`text\` or \`json\`.`);
  }
  return raw;
}

function runFind(recordDir: string, values: Record<string, string>, format: string, cwd: string): number {
  const entries = collectEntries(recordDir);
  const matching = applyFindFilters(entries, values);
  const payload: Record<string, unknown> = { command: "find", count: matching.length, entries: matching };
  if (values["--bundle"]) {
    payload.minted = Object.fromEntries(derivePayerMap(cwd, registryRows(entries)));
  }
  const text = matching.length === 0 ? "no record entries found" : formatTextLines(matching);
  emit(format, true, payload, text);
  return 0;
}

function registryRows(entries: QueryEntry[]): Array<{ name: string; pays: string; statusText: string }> {
  return entries
    .filter((entry) => entry.genre === "row")
    .map((entry) => ({ name: entry.name ?? "", pays: entry.pays ?? "", statusText: "" }));
}

function runShow(recordDir: string, values: Record<string, string>, format: string, cwd: string): number {
  const token = values["--token"]?.trim();
  const id = values["--id"]?.trim();
  const bundle = values["--bundle"]?.trim();
  const selected = [token, id, bundle].filter((value): value is string => Boolean(value));
  if (selected.length !== 1) {
    throw new QueryError("invalid-arguments", "Pass exactly one of --token, --id or --bundle.");
  }

  const entries = collectEntries(recordDir);

  if (bundle) {
    const row = entries.find((entry) => entry.genre === "row" && entry.name === bundle);
    if (!row) {
      throw new QueryError("not-found", `No registry row named \`${bundle}\` in the record.`);
    }
    const minted = Object.fromEntries(derivePayerMap(cwd, registryRows(entries)));
    const payload = {
      command: "show",
      bundle,
      row: { name: row.name, status: row.status, pays: row.pays, file: row.file, layer: row.layer },
      minted,
    };
    emit(format, true, payload, `row ${row.name} status=${row.status ?? "?"} pays=${row.pays ?? ""}`);
    return 0;
  }

  const key = token ?? id!;
  const matches = entries.filter((entry) => (token ? entry.token === token : entry.id === id));
  if (matches.length === 0) {
    throw new QueryError("not-found", `No record entry found for \`${key}\`.`);
  }
  const anchor = matches.find((entry) => entry.file !== FILE_INDEX) ?? matches[0]!;
  const payload = {
    command: "show",
    token: anchor.token || null,
    id: anchor.id || null,
    entries: matches
      .filter((entry) => entry.file !== FILE_INDEX)
      .map((entry) => ({
        layer: entry.layer,
        file: entry.file,
        status: entry.status,
        paidBy: entry.paidBy,
        codifiedIn: entry.codifiedIn,
        taughtIn: entry.taughtIn,
      })),
    index: indexEntryFor(entries, anchor.id),
  };
  emit(format, true, payload, formatTextLines(matches));
  return 0;
}

function runCheck(recordDir: string, format: string): number {
  // Parse every record document first: structuralCheck is intentionally lenient about a
  // null root, so a malformed file would otherwise read as a clean record (exit 0).
  for (const file of [
    FILE_LIVE_FINDINGS,
    FILE_RETIRED_FINDINGS,
    FILE_LIVE_RULINGS,
    FILE_RETIRED_RULINGS,
    FILE_LIVE_REGISTRY,
    FILE_RETIRED_REGISTRY,
    FILE_INDEX,
  ]) {
    readDocument(recordDir, file);
  }
  let findings: Array<{ code: string; message: string }>;
  try {
    findings = structuralCheck(recordDir);
  } catch (error) {
    throw new QueryError("unreadable-record", error instanceof Error ? error.message : String(error));
  }
  emit(
    format,
    findings.length === 0,
    { command: "check", findings },
    findings.length === 0 ? "record check: clean" : findings.map((finding) => `${finding.code}: ${finding.message}`).join("\n"),
  );
  return findings.length === 0 ? 0 : 1;
}

const USAGE = [
  "Usage: bun ./scripts/record-query.ts <find|show|check> [options]",
  "  --record-dir <dir>  default docs/plans/active/RM-GOVERNED-PATH",
  "  --token <T>         filter/list by token (F*, D*)",
  "  --id <id>           filter/list by lower-case id",
  "  --genre <g>         finding | decision | row | entry",
  "  --layer <l>         live | retired | index",
  "  --pays <T>          rows whose Pays cell names T",
  "  --bundle <C-ID>     the registry row named for that bundle",
  "  --format <f>        text | json",
  "  --json              shortcut for --format json",
].join("\n");

/** Query entry point; returns the process exit code and never writes. */
export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  const formatFromArgs = argv.includes("--json")
    || argv.includes("--format=json")
    || (argv.includes("--format") && argv[argv.indexOf("--format") + 1] === "json")
    ? "json"
    : "text";

  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log(USAGE);
      return 0;
    }
    const { positionals, values, flags } = parseArgs(argv);
    const command = positionals[0] ?? "";
    if (command !== "find" && command !== "show" && command !== "check") {
      throw new QueryError("invalid-arguments", `Unknown subcommand \`${command || "(none)"}\`. Use find, show or check.`);
    }
    const format = resolveFormat(values, flags);
    const recordDir = resolveRecordDirWithinBoundary(cwd, values["--record-dir"] ?? DEFAULT_RECORD_DIR);

    if (command === "find") return runFind(recordDir, values, format, cwd);
    if (command === "show") return runShow(recordDir, values, format, cwd);
    return runCheck(recordDir, format);
  } catch (error) {
    const queryError = error instanceof QueryError
      ? error
      : new QueryError("unreadable-record", error instanceof Error ? error.message : String(error));
    if (formatFromArgs === "json") {
      console.log(JSON.stringify({ schemaVersion: "1.0.0", ok: false, error: { code: queryError.code, message: queryError.message } }, null, 2));
    } else {
      console.error(`${queryError.code}: ${queryError.message}`);
    }
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main());
}
