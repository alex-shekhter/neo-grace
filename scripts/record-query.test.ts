import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { main } from "./record-query";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

type RecordOverrides = {
  /** Extra or replacement index `Entry` children for decisions.xml. */
  indexEntries?: string;
  /** Live findings doc body (the default is one live finding f1). */
  findingsLive?: string;
  /** Make decisions.xml unparsable. */
  malformedIndex?: boolean;
};

const DEFAULT_INDEX =
  `<Entry id="f1" token="F1" genre="finding" layer="live"/>`
  + `<Entry id="f2" token="F2" genre="finding" layer="retired"/>`
  + `<Entry id="d1" token="D1" genre="decision" layer="live"/>`
  + `<Entry id="d2" token="D2" genre="decision" layer="retired"/>`;

/**
 * A minimal well-formed record: findings/rulings pairs and an index whose
 * entries all have their holding genre element with the matching genre and
 * layer. Every test drives a throwaway copy, never the production record.
 */
function writeRecord(root: string, overrides: RecordOverrides = {}): string {
  const dir = path.join(root, "record");
  mkdirSync(dir, { recursive: true });
  // The engine's resolveRecordDirWithinBoundary requires a .ngrace/-rooted tree.
  mkdirSync(path.join(root, ".ngrace"), { recursive: true });
  const findingsLive = overrides.findingsLive
    ?? `<Finding id="f1" token="F1" status="live"><Title>t</Title><Body>b</Body></Finding>`;
  writeFileSync(path.join(dir, "findings.xml"), `<Findings base="1" headroom="1" ceiling="2">${findingsLive}</Findings>`);
  writeFileSync(
    path.join(dir, "findings-retired.xml"),
    `<Findings><Finding id="f2" token="F2" status="retired"><PaidBy>C-OLD</PaidBy><Title>t</Title><Body>b</Body></Finding></Findings>`,
  );
  writeFileSync(
    path.join(dir, "rulings.xml"),
    `<Rulings base="1" headroom="1" ceiling="2"><Decision id="d1" token="D1" status="live"><Title>t</Title><Body>b</Body></Decision></Rulings>`,
  );
  writeFileSync(
    path.join(dir, "rulings-retired.xml"),
    `<Rulings><Decision id="d2" token="D2" status="retired"><Title>t</Title><Body>b</Body></Decision></Rulings>`,
  );
  writeFileSync(
    path.join(dir, "registry.xml"),
    `<Registry base="1" headroom="1" ceiling="2"><Row name="C-A" status="live" kind="chartered"><Number>1</Number><Charter>c</Charter><Pays>F1</Pays><StatusText>s</StatusText></Row></Registry>`,
  );
  writeFileSync(path.join(dir, "registry-retired.xml"), `<Registry></Registry>`);
  const entries = overrides.indexEntries ?? DEFAULT_INDEX;
  writeFileSync(
    path.join(dir, "decisions.xml"),
    overrides.malformedIndex
      ? `<RecordIndex base="4" headroom="1" ceiling="5">${entries}<Entry id="broken"`
      : `<RecordIndex base="4" headroom="1" ceiling="5">${entries}</RecordIndex>`,
  );
  return dir;
}

/** Run the query in-process, capturing console output (same shape as the engine's own tests). */
function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const captured: string[] = [];
  const errored: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => captured.push(parts.map(String).join(" "));
  console.error = (...parts: unknown[]) => errored.push(parts.map(String).join(" "));
  let status: number;
  try {
    status = main(args, cwd);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return {
    status,
    stdout: captured.length > 0 ? `${captured.join("\n")}\n` : "",
    stderr: errored.length > 0 ? `${errored.join("\n")}\n` : "",
  };
}

function runJson(cwd: string, args: string[]): { status: number; json: any } {
  const result = run(cwd, [...args, "--json"]);
  const text = result.stdout.trim();
  expect(text, `expected JSON on stdout\nstderr: ${result.stderr}`).not.toBe("");
  return { status: result.status, json: JSON.parse(text) };
}

/** Content hash of every file under a directory, keyed by relative path. */
function hashTree(dir: string): string {
  const entries: string[] = [];
  const walk = (rel: string) => {
    const full = path.join(dir, rel);
    for (const entry of readdirSync(full)) {
      const next = path.join(rel, entry);
      const abs = path.join(dir, next);
      if (statSync(abs).isDirectory()) walk(next);
      else entries.push(`${next}:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
    }
  };
  walk(".");
  return entries.sort().join("\n");
}

describe("C-INSPECTION-SURFACE-1-2628AA2B T-003 record:query", () => {
  it("check reports the engine's structuralCheck findings and is clean on a well-formed record", () => {
    const clean = tempDir("record-query-clean-");
    const cleanDir = writeRecord(clean);
    const cleanResult = runJson(clean, ["check", "--record-dir", cleanDir]);
    expect(cleanResult.status, "a clean record exits 0").toBe(0);
    expect(cleanResult.json.findings).toEqual([]);

    const orphan = tempDir("record-query-orphan-");
    const orphanDir = writeRecord(orphan, { indexEntries: `${DEFAULT_INDEX}<Entry id="f9" token="F9" genre="finding" layer="live"/>` });
    const orphanResult = runJson(orphan, ["check", "--record-dir", orphanDir]);
    expect(orphanResult.status, "a planted index orphan exits non-zero").toBe(1);
    expect(orphanResult.json.findings.some((f: any) => f.code === "record-index-orphan")).toBe(true);

    const mismatch = tempDir("record-query-mismatch-");
    const mismatchDir = writeRecord(mismatch, {
      indexEntries: DEFAULT_INDEX.replace(`<Entry id="f1" token="F1" genre="finding" layer="live"/>`, `<Entry id="f1" token="F1" genre="finding" layer="retired"/>`),
    });
    const mismatchResult = runJson(mismatch, ["check", "--record-dir", mismatchDir]);
    expect(mismatchResult.status, "a planted layer mismatch exits non-zero").toBe(1);
    expect(mismatchResult.json.findings.some((f: any) => f.code === "record-index-layer-mismatch")).toBe(true);
  });

  it("show --token reports an entry's layer, status and payer; live has no payer; absent exits non-zero", () => {
    const root = tempDir("record-query-show-");
    const dir = writeRecord(root);

    const retired = runJson(root, ["show", "--token", "F2", "--record-dir", dir]);
    expect(retired.status).toBe(0);
    const retiredEntry = retired.json.entries.find((e: any) => e.layer === "retired");
    expect(retiredEntry?.status).toBe("retired");
    expect(retiredEntry?.paidBy).toBe("C-OLD");
    expect(retired.json.index).toEqual({ genre: "finding", layer: "retired" });

    const live = runJson(root, ["show", "--token", "F1", "--record-dir", dir]);
    expect(live.status).toBe(0);
    const liveEntry = live.json.entries.find((e: any) => e.layer === "live");
    expect(liveEntry?.status).toBe("live");
    expect(liveEntry?.paidBy ?? null).toBeNull();

    const absent = runJson(root, ["show", "--token", "F-NOPE", "--record-dir", dir]);
    expect(absent.status, "an absent token exits non-zero").toBe(1);
    expect(absent.json.ok).toBe(false);
    expect(absent.json.error.code).toBe("not-found");
  });

  it("show --bundle reports the registry row's Pays and mints only when the name is an archive directory", () => {
    const root = tempDir("record-query-bundle-");
    const dir = writeRecord(root);
    mkdirSync(path.join(root, ".ngrace", "changes", "archive", "C-A"), { recursive: true });

    const hit = runJson(root, ["show", "--bundle", "C-A", "--record-dir", dir]);
    expect(hit.status).toBe(0);
    expect(hit.json.row?.name).toBe("C-A");
    expect(hit.json.row?.pays).toContain("F1");
    expect(hit.json.minted?.F1).toBe("C-A");

    const absent = runJson(root, ["show", "--bundle", "C-NOPE", "--record-dir", dir]);
    expect(absent.status).toBe(1);
    expect(absent.json.error.code).toBe("not-found");
  });

  it("find lists matching entries across layers and exits 0 on an empty result", () => {
    const root = tempDir("record-query-find-");
    const dir = writeRecord(root);

    const all = runJson(root, ["find", "--record-dir", dir]);
    expect(all.status).toBe(0);
    expect(all.json.entries.length).toBeGreaterThan(0);

    const one = runJson(root, ["find", "--token", "F1", "--record-dir", dir]);
    expect(one.status).toBe(0);
    expect(one.json.entries.every((e: any) => e.token === "F1")).toBe(true);

    const none = runJson(root, ["find", "--token", "F-NOPE", "--record-dir", dir]);
    expect(none.status, "an empty find exits 0").toBe(0);
    expect(none.json.entries).toEqual([]);
  });

  it("a malformed record exits non-zero with a named reason", () => {
    const root = tempDir("record-query-bad-");
    const dir = writeRecord(root, { malformedIndex: true });
    const result = runJson(root, ["check", "--record-dir", dir]);
    expect(result.status).toBe(1);
    expect(result.json.ok).toBe(false);
    expect(result.json.error.code).toBe("unreadable-record");
  });

  it("mutates nothing: every file's hash is identical before and after find, show and check", () => {
    const root = tempDir("record-query-ro-");
    const dir = writeRecord(root);
    const before = hashTree(dir);

    run(root, ["find", "--record-dir", dir]);
    run(root, ["show", "--token", "F1", "--record-dir", dir]);
    run(root, ["check", "--record-dir", dir]);

    expect(hashTree(dir)).toBe(before);
  });
});
