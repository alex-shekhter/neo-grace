#!/usr/bin/env bun
/**
 * Deterministic fixture builder for the C-RECORD-PARSE baseline.
 *
 * Materializes a throwaway fixture root from the committed input snapshot
 * beside this builder — never from the live working tree, so the fixture is
 * identical at baseline, mid-bundle and post-archive, and never from git, so
 * it builds in a shallow clone, a tarball export, or a worktree with no
 * objects. The snapshot was taken from the spec's base commit
 * 49b4ebb7c6627601ca77ca384f7b6e205d1f65ed and is regenerated deliberately,
 * the way the golden outputs beside it are. Materialized: input/ becomes
 * docs/plans/active/RM-GOVERNED-PATH/, and archive-names.json becomes the
 * .ngrace/changes/archive/ directory set — names only, because nothing in the
 * converted engine reads an archived spec's contents.
 *
 * Flags:
 *   --c-selection-row            insert one deterministic live chartered row
 *                                named C-SELECTION whose Pays element names F21
 *                                (an archive directory with no row in either
 *                                layer at the base commit).
 *   --f21-tag=<variant>          rewrite f21's open tag as single-quoted,
 *                                spaced, or reordered — each valid XML that
 *                                parses identically to the unmodified tag.
 *   --parked-spec                copy the parked bundle's approved spec (the
 *                                committed capture at parked-spec.xml, read
 *                                once from the parked branch at baseline) into
 *                                the fixture as archive event C-PAYMENT-RECORD-3.
 *                                The parked branch itself is never checked out,
 *                                merged or modified.
 *
 * The builder writes only under the fixture root given as its positional
 * argument; it never writes inside this repository.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Provenance of the committed input snapshot; nothing reads git at build time. */
const INPUT_SNAPSHOT_COMMIT = "49b4ebb7c6627601ca77ca384f7b6e205d1f65ed";
const INPUT_DIR = path.join(import.meta.dir, "input");
const ARCHIVE_NAMES_FILE = path.join(import.meta.dir, "archive-names.json");
const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const RECORD_REL = "docs/plans/active/RM-GOVERNED-PATH";
const ARCHIVE_REL = ".ngrace/changes/archive";
const PARKED_SPEC_SRC = path.join(import.meta.dir, "parked-spec.xml");
const PARKED_ARCHIVE_NAME = "C-PAYMENT-RECORD-3";

const F21_OPEN_TAG = `<Finding id="f21" token="F21" status="live">`;
const F21_TAG_VARIANTS: Record<string, string> = {
  "single-quoted": `<Finding id='f21' token='F21' status='live'>`,
  "spaced": `<Finding id = "f21" token = "F21" status = "live">`,
  "reordered": `<Finding token="F21" status="live" id="f21">`,
};

const SELECTION_ROW = `  <Row name="C-SELECTION" status="live" kind="chartered">
    <Number></Number>
    <Charter>Baseline fixture row for the C-RECORD-PARSE golden capture.</Charter>
    <Pays>F21.</Pays>
    <StatusText>Named; not in the order.</StatusText>
  </Row>
`;

function fail(message: string): never {
  console.error(`build-fixture: ${message}`);
  process.exit(1);
}

function parseFlags(argv: string[]): {
  fixtureRoot: string;
  cSelectionRow: boolean;
  f21Tag: string | undefined;
  parkedSpec: boolean;
} {
  const fixtureRoot = argv.find((a) => !a.startsWith("--"));
  if (!fixtureRoot) {
    fail("usage: bun build-fixture.ts <fixture-root> [--c-selection-row] [--f21-tag=single-quoted|spaced|reordered] [--parked-spec]");
  }
  const cSelectionRow = argv.includes("--c-selection-row");
  const parkedSpec = argv.includes("--parked-spec");
  let f21Tag: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--f21-tag=")) {
      f21Tag = arg.slice("--f21-tag=".length);
    }
  }
  if (f21Tag !== undefined && !F21_TAG_VARIANTS[f21Tag]) {
    fail(`unknown --f21-tag variant "${f21Tag}"; expected one of ${Object.keys(F21_TAG_VARIANTS).join(", ")}`);
  }
  return { fixtureRoot, cSelectionRow, f21Tag, parkedSpec };
}

/**
 * Materializes the record directory and the archive tree from the committed input
 * snapshot. Deliberately reads no git history: the fixture must build in a shallow
 * clone, a tarball export, or a worktree with no objects at all.
 */
function materializeFromInput(fixtureRoot: string): void {
  if (!existsSync(INPUT_DIR)) {
    fail(`input snapshot missing at ${INPUT_DIR}; it is committed beside this builder`);
  }
  const recordDir = path.join(fixtureRoot, RECORD_REL);
  mkdirSync(recordDir, { recursive: true });
  for (const entry of readdirSync(INPUT_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    copyFileSync(path.join(INPUT_DIR, entry.name), path.join(recordDir, entry.name));
  }
  const names = JSON.parse(readFileSync(ARCHIVE_NAMES_FILE, "utf8")) as string[];
  for (const name of names) {
    mkdirSync(path.join(fixtureRoot, ARCHIVE_REL, name), { recursive: true });
  }
}

/** Inserts the deterministic C-SELECTION row as the last live row of registry.xml. */
function insertSelectionRow(fixtureRoot: string): void {
  const registryPath = path.join(fixtureRoot, RECORD_REL, "registry.xml");
  const registry = readFileSync(registryPath, "utf8");
  const closeTag = "</Registry>";
  const idx = registry.lastIndexOf(closeTag);
  if (idx < 0) {
    fail("registry.xml from the base commit has no </Registry> close tag");
  }
  const next = `${registry.slice(0, idx)}${SELECTION_ROW}${registry.slice(idx)}`;
  writeFileSync(registryPath, next);
}

/** Rewrites f21's open tag to the requested legal variant. */
function rewriteF21Tag(fixtureRoot: string, variant: string): void {
  const findingsPath = path.join(fixtureRoot, RECORD_REL, "findings.xml");
  const findings = readFileSync(findingsPath, "utf8");
  const occurrences = findings.split(F21_OPEN_TAG).length - 1;
  if (occurrences !== 1) {
    fail(`f21 open tag appears ${occurrences} times in the base-commit findings.xml; expected exactly 1`);
  }
  writeFileSync(findingsPath, findings.replace(F21_OPEN_TAG, F21_TAG_VARIANTS[variant]!));
}

/** Plants the committed parked-spec capture as archive event C-PAYMENT-RECORD-3. */
function plantParkedSpec(fixtureRoot: string): void {
  if (!existsSync(PARKED_SPEC_SRC)) {
    fail(`parked spec capture missing at ${PARKED_SPEC_SRC}; capture it once via git show before building this fixture`);
  }
  const target = path.join(fixtureRoot, ARCHIVE_REL, PARKED_ARCHIVE_NAME);
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "spec.xml"), readFileSync(PARKED_SPEC_SRC));
}

function main(): number {
  const { fixtureRoot, cSelectionRow, f21Tag, parkedSpec } = parseFlags(process.argv.slice(2));
  const absoluteRoot = path.resolve(fixtureRoot);
  mkdirSync(absoluteRoot, { recursive: true });
  materializeFromInput(absoluteRoot);
  const recordPath = path.join(absoluteRoot, RECORD_REL, "findings.xml");
  if (!existsSync(recordPath)) {
    fail(`materialization incomplete: ${recordPath} does not exist`);
  }
  if (cSelectionRow) {
    insertSelectionRow(absoluteRoot);
  }
  if (f21Tag !== undefined) {
    rewriteF21Tag(absoluteRoot, f21Tag);
  }
  if (parkedSpec) {
    plantParkedSpec(absoluteRoot);
  }
  console.log(`build-fixture: ok (${absoluteRoot})`);
  return 0;
}

process.exit(main());