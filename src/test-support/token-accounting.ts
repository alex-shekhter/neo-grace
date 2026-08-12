// START_MODULE_CONTRACT
//   PURPOSE: Test fixtures and defect corpus
//   SCOPE: Temp projects, corpus seeds, and token-accounting helpers
//   DEPENDS: none
//   LINKS: M-TEST-SUPPORT
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   CommandOutputMeasurement
//   commandOutputBytes
//   packageRoot
//   selectionRatio
//   skillTextLines
// END_MODULE_MAP
/**
 * Token / footprint measurements for the agent-reliability track (D15).
 *
 * `skillTextLines().total` (and `perSkill`) are frozen line-count semantics:
 * completed archived phase reports cite exact totals (636, 723) against them.
 * Those archives are never edited, so redefining `total` would silently
 * falsify them. New footprint fields are additive only — do not rename or
 * repurpose `total` / `perSkill` / `referencesTotal`.
 *
 * Citer survey (when considering further changes): `rg -ln 'skillTextLines'`.
 *
 * Not published: package.json#files does not enumerate src/test-support/.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Absolute path to the neo-grace repository root (this package). */
export function packageRoot(): string {
  // src/test-support → src → repo root
  return path.resolve(import.meta.dir, "../..");
}

function listFilesRecursive(dir: string, base = dir): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const entries = readdirSync(dir).sort();
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(path.relative(base, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

function countLines(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  if (text.length === 0) {
    return 0;
  }
  // Match `wc -l`: count newline terminators; a final non-empty line without
  // trailing newline still counts as one line.
  const parts = text.split("\n");
  const trailingEmpty = parts.length > 0 && parts[parts.length - 1] === "";
  return trailingEmpty ? parts.length - 1 : parts.length;
}

/** UTF-8 byte length of a file's contents — matches `wc -c`, not JS string length. */
function countUtf8Bytes(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  return Buffer.byteLength(text, "utf8");
}

/**
 * Counts lines and UTF-8 bytes across skills/ngrace/*\/SKILL.md and references/**
 * under the canonical skill tree (not the plugins mirror).
 *
 * `total` is the sum of every SKILL.md line count (the D15 baseline number;
 * frozen semantics — archived reports cite exact values against it).
 * `perSkill` is keyed by skill directory name (e.g. `ngrace-init`).
 * `totalBytes` / `perSkillBytes` are UTF-8 byte lengths of the same SKILL.md
 * set (`Buffer.byteLength`, matching `wc -c`). `sum(perSkillBytes) === totalBytes`.
 * `referencesTotal` is lines under all `references/` trees (reported separately
 * so skill-body deltas are not confounded by reference growth).
 */
export function skillTextLines(root: string = packageRoot()): {
  total: number;
  perSkill: Record<string, number>;
  totalBytes: number;
  perSkillBytes: Record<string, number>;
  referencesTotal: number;
} {
  const skillsRoot = path.join(root, "skills", "ngrace");
  const perSkill: Record<string, number> = {};
  const perSkillBytes: Record<string, number> = {};
  let total = 0;
  let totalBytes = 0;
  let referencesTotal = 0;

  const skillDirs = readdirSync(skillsRoot)
    .filter((name) => statSync(path.join(skillsRoot, name)).isDirectory())
    .sort();

  for (const skill of skillDirs) {
    const skillDir = path.join(skillsRoot, skill);
    const skillMd = path.join(skillDir, "SKILL.md");
    if (statSync(skillMd, { throwIfNoEntry: false })?.isFile()) {
      const lines = countLines(skillMd);
      const bytes = countUtf8Bytes(skillMd);
      perSkill[skill] = lines;
      perSkillBytes[skill] = bytes;
      total += lines;
      totalBytes += bytes;
    }

    const referencesDir = path.join(skillDir, "references");
    for (const rel of listFilesRecursive(referencesDir)) {
      referencesTotal += countLines(path.join(referencesDir, rel));
    }
  }

  return { total, perSkill, totalBytes, perSkillBytes, referencesTotal };
}

export type CommandOutputMeasurement = {
  /** stdout byte length on a successful (exit 0) run. */
  bytes: number;
  /** Always 0 on the success path; failures throw before returning. */
  exitCode: number;
};

/**
 * Runs a CLI command against a fixture root and returns stdout byte length.
 * Uses the local package entrypoint so PATH cannot select upstream `grace`.
 *
 * `argv` is the argument vector after the binary (e.g. `["lint", "--path", root]`).
 * When `--path` is omitted, it is appended as `--path <root>`.
 *
 * Fails closed on nonzero exit (invariant 3): error/help text is not a measurement.
 */
export function commandOutputBytes(
  argv: string[],
  root: string,
  options: { packageRoot?: string } = {},
): CommandOutputMeasurement {
  const pkg = options.packageRoot ?? packageRoot();
  const entry = path.join(pkg, "src", "grace.ts");
  const hasPath = argv.some((arg) => arg === "--path");
  const fullArgv = hasPath ? argv : [...argv, "--path", root];

  const result = spawnSync("bun", [entry, ...fullArgv], {
    encoding: "buffer",
    cwd: pkg,
    env: process.env,
  });

  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  const exitCode = result.status ?? 1;
  const bytes = stdout.byteLength;

  if (exitCode !== 0) {
    const errPreview = stderr.toString("utf8").slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `commandOutputBytes: ${fullArgv.join(" ")} exited ${exitCode} ` +
        `(stdout ${bytes} bytes). Measurement refused on failure` +
        (errPreview ? `: ${errPreview}` : ""),
    );
  }

  return { bytes, exitCode };
}

/**
 * Fraction of the full payload that a selection avoided: `(full - selected) / full`.
 * Returns 0 when full is 0 (nothing to save).
 */
export function selectionRatio(full: number, selected: number): number {
  if (!Number.isFinite(full) || !Number.isFinite(selected)) {
    throw new RangeError(
      `selectionRatio: full (${full}) and selected (${selected}) must be finite numbers`,
    );
  }
  if (full < 0) {
    throw new RangeError(`selectionRatio: full (${full}) must be >= 0`);
  }
  if (selected < 0 || selected > full) {
    throw new RangeError(
      `selectionRatio: selected (${selected}) must be in [0, full (${full})]`,
    );
  }
  if (full === 0) {
    return 0;
  }
  return (full - selected) / full;
}
