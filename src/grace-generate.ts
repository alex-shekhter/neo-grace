// START_MODULE_CONTRACT
//   PURPOSE: Generate spec, plan, and scaffold artifacts
//   SCOPE: spec new, plan new, and later scaffold command defs
//   DEPENDS: none
//   LINKS: M-CLI
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AcquiredCandidate
//   CandidateIo
//   CandidateStage
//   ResolvedSpecMint
//   cleanupCandidate
//   setCandidateCleanupObserverForTests
//   mintBundle
//   mintResolvedBundle
//   pauseCandidatePublicationForTests
//   planCommand
//   resolveSpecMint
//   scaffoldCommand
//   specCommand
// END_MODULE_MAP
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";

import { resolveNgracePaths } from "./artifact/project";
import { withCandidateLock } from "./grace-cursor";
import { buildGraphProjection } from "./artifact/projections";
import { renderChangePlan, renderChangeSpec } from "./artifact/skeletons";
import { ARTIFACT_DIR } from "./artifact/paths";
import { ANCHOR_PATTERNS, nextBundleLineage, parseBundleId } from "./artifact/types";
import { parseGraceXmlArtifact } from "./artifact/xml";
import { ADAPTER_BACKED_EXTENSIONS, LANGUAGE_ADAPTERS } from "./language-registry";
import {
  commentPrefixForExtension,
  defaultMapMode,
  inferRole,
  renderModuleContract,
  renderModuleMap,
} from "./project-utils";
import { defineGraceCommand } from "./query/command";
import { GraceCommandError } from "./query/errors";

/** Length of the minted id's uppercase-hex hash suffix (D38's "short"). */
const MINTED_HASH_LENGTH = 8;
const SLUG_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function projectRelative(root: string, absPath: string): string {
  return path.relative(root, absPath).replaceAll(path.sep, "/");
}

function resolveRoot(raw: unknown): string {
  return path.resolve(String(raw ?? "."));
}

function requireChangeId(raw: unknown): string {
  const changeId = String(raw ?? "").trim();
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change id '${changeId}' does not match the accepted pattern C- then uppercase kebab.`,
    );
  }
  return changeId;
}

function activeDir(root: string, changeId: string): string {
  return path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
}

function archiveDir(root: string, changeId: string): string {
  return path.join(root, ARTIFACT_DIR, "changes", "archive", changeId);
}

function changesLocation(root: string, location: "active" | "archive"): string {
  return path.join(root, ARTIFACT_DIR, "changes", location);
}

function refuseExistingBundle(root: string, changeId: string): void {
  const archive = archiveDir(root, changeId);
  if (existsSync(archive)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change ${changeId} already exists at ${projectRelative(root, archive)}.`,
    );
  }
  const active = activeDir(root, changeId);
  if (existsSync(active)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change ${changeId} already exists at ${projectRelative(root, active)}.`,
    );
  }
}

export type CandidateStage =
  | "identity-pending"
  | "acquired"
  | "marker-written"
  | "spec-written"
  | "published";

/** Identity-complete acquisition record for an exclusively acquired candidate leaf. */
export type AcquiredCandidate = {
  path: string;
  markerPath: string;
  specPath: string;
  token: string;
  expectedSpecBytes: string;
  stage: CandidateStage;
  dev?: number;
  ino?: number;
};

/** Bounded I/O seam: injected at the real stat/write/unlink/rmdir boundaries. */
export type CandidateIo = {
  statSync?: typeof statSync;
  writeFileSync?: typeof writeFileSync;
  unlinkSync?: typeof unlinkSync;
  rmdirSync?: typeof rmdirSync;
};

const CANDIDATE_MARKER = ".ngrace-mint-owner";

let candidatePublicationHook: (() => void) | null = null;

/** Test-only: run a hook after the exclusive spec.xml write, before marker unlink. */
export function pauseCandidatePublicationForTests(hook: (() => void) | null): void {
  candidatePublicationHook = hook;
}

function candidateRefusal(root: string, changeId: string): never {
  throw new GraceCommandError(
    "invalid-arguments",
    `Change ${changeId} already exists at ${projectRelative(root, activeDir(root, changeId))}.`,
  );
}

/**
 * Acquire the leaf exclusively: parents recursively, the leaf with a
 * non-recursive mkdir (EEXIST refuses), then an identity-pending record.
 * Identity is captured at the real statSync boundary; a failed or
 * non-directory identity preserves the leaf and names it without deleting.
 */
function acquireCandidate(root: string, changeId: string, io: CandidateIo): AcquiredCandidate {
  const bundlePath = activeDir(root, changeId);
  const markerPath = path.join(bundlePath, CANDIDATE_MARKER);
  const specPath = path.join(bundlePath, "spec.xml");
  const token = randomBytes(16).toString("hex");
  const expectedSpecBytes = renderChangeSpec(changeId);
  mkdirSync(path.dirname(bundlePath), { recursive: true });
  try {
    mkdirSync(bundlePath);
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") candidateRefusal(root, changeId);
    throw error;
  }
  const candidate: AcquiredCandidate = {
    path: bundlePath,
    markerPath,
    specPath,
    token,
    expectedSpecBytes,
    stage: "identity-pending",
  };
  let identity: ReturnType<typeof statSync>;
  try {
    identity = (io.statSync ?? statSync)(bundlePath);
  } catch (error) {
    throw new GraceCommandError(
      "invalid-project",
      `Candidate ${projectRelative(root, bundlePath)} identity capture failed (${(error as Error).message}); preserved.`,
    );
  }
  if (!identity.isDirectory()) {
    throw new GraceCommandError(
      "invalid-project",
      `Candidate ${projectRelative(root, bundlePath)} identity capture returned a non-directory; preserved.`,
    );
  }
  candidate.dev = identity.dev;
  candidate.ino = identity.ino;
  candidate.stage = "acquired";
  return candidate;
}

/**
 * Lock coordinates for an acquired candidate leaf: `<root>/.ngrace/changes/active/<C-ID>`.
 * The lock is the sibling `active/.candidate-<C-ID>.lock`, so the four parent
 * hops recover exactly the root the caller locked.
 */
function candidateLockCoordinates(acquired: AcquiredCandidate): { root: string; changeId: string } {
  const changeId = path.basename(acquired.path);
  const root = path.dirname(path.dirname(path.dirname(path.dirname(acquired.path))));
  return { root, changeId };
}

/**
 * Bounded cleanup: only identity-complete records; deletes own files in a frozen
 * order that never leaves bytes mistakable for publication, then rmdir.
 * Callers must already hold the candidate lock (see the exported wrapper).
 */
function cleanupCandidateLocked(
  acquired: AcquiredCandidate,
  io: CandidateIo = {},
): { removed: boolean; diagnostic?: string } {
  const rel = acquired.path;
  if (acquired.dev === undefined || acquired.ino === undefined) {
    return { removed: false, diagnostic: `candidate ${rel}: identity-pending record is not safely removable; preserved` };
  }
  let identity: ReturnType<typeof statSync>;
  try {
    identity = (io.statSync ?? statSync)(acquired.path);
  } catch (error) {
    return { removed: false, diagnostic: `candidate ${rel}: identity check failed (${(error as Error).message}); preserved` };
  }
  if (identity.dev !== acquired.dev || identity.ino !== acquired.ino) {
    return { removed: false, diagnostic: `candidate ${rel}: identity changed; preserved` };
  }
  const markerName = path.basename(acquired.markerPath);
  const specName = path.basename(acquired.specPath);
  let entries: string[];
  try {
    entries = readdirSync(acquired.path);
  } catch (error) {
    return { removed: false, diagnostic: `candidate ${rel}: enumeration failed (${(error as Error).message}); preserved` };
  }
  for (const name of entries) {
    if (name !== markerName && name !== specName) {
      return { removed: false, diagnostic: `candidate ${rel}: foreign entry ${name}; preserved` };
    }
  }
  const hasSpec = entries.includes(specName);
  const hasMarker = entries.includes(markerName);
  // Validate-first: every ownership/content check runs before the first unlink, so a
  // foreign marker token leaves the spec, marker, and directory byte-identical
  // (AC-CLEANUP-VALIDATE-FIRST).
  if (hasSpec) {
    let bytes: string;
    try {
      bytes = readFileSync(acquired.specPath, "utf8");
    } catch (error) {
      return { removed: false, diagnostic: `candidate ${rel}: spec read failed (${(error as Error).message}); preserved` };
    }
    if (bytes !== acquired.expectedSpecBytes) {
      return { removed: false, diagnostic: `candidate ${rel}: spec bytes changed; preserved` };
    }
  }
  if (hasMarker) {
    let markerBytes: string;
    try {
      markerBytes = readFileSync(acquired.markerPath, "utf8");
    } catch (error) {
      return { removed: false, diagnostic: `candidate ${rel}: marker read failed (${(error as Error).message}); preserved` };
    }
    if (markerBytes.trim() !== acquired.token) {
      return { removed: false, diagnostic: `candidate ${rel}: marker token changed; preserved` };
    }
  }
  // All validation passed: the destructive phase begins here.
  const unlink = io.unlinkSync ?? unlinkSync;
  const rmdir = io.rmdirSync ?? rmdirSync;
  try {
    if (hasSpec) {
      unlink(acquired.specPath);
    }
    if (hasMarker) {
      unlink(acquired.markerPath);
    }
    rmdir(acquired.path);
  } catch (error) {
    return { removed: false, diagnostic: `candidate ${rel}: cleanup failed (${(error as Error).message}); preserved` };
  }
  return { removed: true };
}

let candidateCleanupObserverForTests:
  | ((outcome: { removed: boolean; diagnostic?: string }) => void)
  | undefined;

/** Test-only: observes every production candidate cleanup invocation and outcome. */
export function setCandidateCleanupObserverForTests(
  observer: ((outcome: { removed: boolean; diagnostic?: string }) => void) | undefined,
): void {
  candidateCleanupObserverForTests = observer;
}

/**
 * Public bounded cleanup. Acquires the documented reentrant candidate lock itself
 * (AC-CLEANUP-LOCK-API), so no caller can delete a candidate without holding it;
 * a nested call reuses the reentrancy depth.
 */
export function cleanupCandidate(
  acquired: AcquiredCandidate,
  io: CandidateIo = {},
): { removed: boolean; diagnostic?: string } {
  const { root, changeId } = candidateLockCoordinates(acquired);
  const result = withCandidateLock(root, changeId, () => cleanupCandidateLocked(acquired, io));
  candidateCleanupObserverForTests?.(result);
  return result;
}

function pauseForTestsIfRequested(): void {
  candidatePublicationHook?.();
  const pauseFile = process.env.NGRACE_PAUSE_CANDIDATE_FILE;
  if (!pauseFile) return;
  for (let i = 0; i < 5000 && !existsSync(pauseFile); i += 1) Bun.sleepSync(5);
}

/**
 * Standalone `spec new` lifecycle: acquire, marker, exclusive spec.xml, publish,
 * bounded cleanup on failure.
 */
function publishSpecNew(
  root: string,
  changeId: string,
  io: CandidateIo = {},
): { relative: string; acquired: AcquiredCandidate } {
  return withCandidateLock(root, changeId, () => {
    refuseExistingBundle(root, changeId);
    const candidate = acquireCandidate(root, changeId, io);
    try {
      (io.writeFileSync ?? writeFileSync)(candidate.markerPath, `${candidate.token}\n`, { flag: "wx" });
      candidate.stage = "marker-written";
      (io.writeFileSync ?? writeFileSync)(candidate.specPath, candidate.expectedSpecBytes, { flag: "wx" });
      candidate.stage = "spec-written";
      pauseForTestsIfRequested();
      (io.unlinkSync ?? unlinkSync)(candidate.markerPath);
      candidate.stage = "published";
      return { relative: projectRelative(root, candidate.specPath), acquired: candidate };
    } catch (error) {
      const result = cleanupCandidate(candidate, io);
      if (!result.removed && result.diagnostic) {
        throw new GraceCommandError(
          "invalid-project",
          `${(error as Error).message} Residual state preserved: ${result.diagnostic}`,
        );
      }
      throw error;
    }
  });
}

function writeSpecNew(root: string, changeId: string): string {
  return publishSpecNew(root, changeId).relative;
}

/** A bare human slug for a first mint; a `C-` prefixed argument is a hand-typed id. */
function requireSlug(raw: unknown): string {
  const slug = String(raw ?? "").trim();
  if (slug.startsWith("C-")) {
    throw new GraceCommandError(
      "invalid-arguments",
      `'${slug}' is a hand-typed change id; pass the bare slug and let the tool mint the suffix.`,
    );
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Slug '${slug}' must be uppercase kebab (A-Z, 0-9, hyphen).`,
    );
  }
  if (/-[0-9]+$/.test(slug)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Slug '${slug}' ends in a numeric segment; lineage is the tool's to append.`,
    );
  }
  return slug;
}

/** The timestamp is a handed-in input; the wall clock is never read silently. */
function resolveTimestamp(raw: unknown): string {
  const input = String(raw ?? process.env.NGRACE_SPEC_TIMESTAMP ?? "").trim();
  if (input === "") {
    throw new GraceCommandError(
      "invalid-arguments",
      "spec new requires --timestamp or NGRACE_SPEC_TIMESTAMP (the hash is never read from the clock).",
    );
  }
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Timestamp '${input}' is not a parseable ISO 8601 timestamp.`,
    );
  }
  return new Date(parsed).toISOString();
}

function resolveBranch(raw: unknown, root: string): string {
  const branch = String(raw ?? process.env.NGRACE_SPEC_BRANCH ?? "").trim();
  if (branch !== "") {
    return branch;
  }
  try {
    const detected = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: root,
    }).trim();
    if (detected !== "") {
      return detected;
    }
  } catch {
    // fall through to the refusal
  }
  throw new GraceCommandError(
    "invalid-arguments",
    "spec new requires --branch, NGRACE_SPEC_BRANCH, or a git working tree.",
  );
}

function mintHash(branch: string, timestamp: string): string {
  return createHash("sha256")
    .update(`${branch}\n${timestamp}`)
    .digest("hex")
    .toUpperCase()
    .slice(0, MINTED_HASH_LENGTH);
}

/** Prior bundle directories under one location whose parsed slug equals `C-<slug>`. */
function countPriorSlug(root: string, location: "active" | "archive", slug: string): number {
  const dir = changesLocation(root, location);
  if (!existsSync(dir)) {
    return 0;
  }
  const canonical = `C-${slug}`;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && parseBundleId(entry.name).slug === canonical,
  ).length;
}

export type ResolvedSpecMint = {
  id: string;
  slug: string;
  lineage: number;
  hash: string;
  branch: string;
  timestamp: string;
};

/** Resolve the minted id from exactly one of the bare slug or a predecessor; never guesses. */
export function resolveSpecMint(args: { slug?: unknown; supersedes?: unknown; timestamp?: unknown; branch?: unknown }, root: string): ResolvedSpecMint {
  const rawSlug = String(args.slug ?? "").trim();
  const rawSupersedes = String(args.supersedes ?? "").trim();
  if ((rawSlug === "") === (rawSupersedes === "")) {
    throw new GraceCommandError(
      "invalid-arguments",
      "spec new requires exactly one of a bare <SLUG> or --supersedes <C-PRED>.",
    );
  }
  let slug: string;
  let lineage: number;
  if (rawSupersedes !== "") {
    if (!ANCHOR_PATTERNS.change.test(rawSupersedes)) {
      throw new GraceCommandError(
        "invalid-arguments",
        `Predecessor '${rawSupersedes}' is not a canonical C-* id.`,
      );
    }
    const parts = parseBundleId(rawSupersedes);
    slug = parts.slug.replace(/^C-/, "");
    lineage = nextBundleLineage(rawSupersedes);
  } else {
    slug = requireSlug(rawSlug);
    lineage = 1;
  }
  const timestamp = resolveTimestamp(args.timestamp);
  const branch = resolveBranch(args.branch, root);
  return {
    id: `C-${slug}-${lineage}-${mintHash(branch, timestamp)}`,
    slug,
    lineage,
    hash: mintHash(branch, timestamp),
    branch,
    timestamp,
  };
}

/**
 * Write a pre-resolved mint without re-resolving it: the id written to the leaf
 * is exactly the id the caller locked. Exported so `supersede` holds one id.
 */
export function mintResolvedBundle(
  root: string,
  resolved: ResolvedSpecMint,
  io: CandidateIo = {},
): ResolvedSpecMint & { relative: string; acquired: AcquiredCandidate } {
  const published = publishSpecNew(root, resolved.id, io);
  return { ...resolved, relative: published.relative, acquired: published.acquired };
}

/**
 * Mint a bundle skeleton and return the resolved id. Exported so `supersede` mints its
 * successor through the same routine rather than a second implementation.
 */
export function mintBundle(
  root: string,
  input: { slug?: unknown; supersedes?: unknown; timestamp?: unknown; branch?: unknown },
): ResolvedSpecMint & { relative: string; acquired: AcquiredCandidate } {
  const mint = resolveSpecMint(input, root);
  return mintResolvedBundle(root, mint);
}

function approvedSpecXml(root: string, changeId: string): string {
  const specPath = path.join(activeDir(root, changeId), "spec.xml");
  const relative = `${ARTIFACT_DIR}/changes/active/${changeId}/spec.xml`;
  if (!existsSync(specPath)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Missing spec at ${relative}. An active plan may exist only beside an approved spec.`,
    );
  }
  const specXml = readFileSync(specPath, "utf8");
  const parsed = parseGraceXmlArtifact(specPath, specXml);
  if (parsed.root?.attributes.status !== "approved") {
    throw new GraceCommandError(
      "invalid-arguments",
      `Spec at ${relative} is not approved. An active plan may exist only beside an approved spec.`,
    );
  }
  return specXml;
}

function writePlanNew(root: string, changeId: string): string {
  return withCandidateLock(root, changeId, () => {
  const archive = archiveDir(root, changeId);
  if (existsSync(archive) && !existsSync(activeDir(root, changeId))) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change ${changeId} already exists at ${projectRelative(root, archive)}.`,
    );
  }
  // AC-PLAN-NEW-MARKER-REFUSAL (b): a stale ownership marker is crash residue.
  // Approved status does not prove marker absence, so this check precedes the
  // approved-spec prerequisite and the first write.
  const markerPath = path.join(activeDir(root, changeId), CANDIDATE_MARKER);
  if (existsSync(markerPath)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change ${changeId} is an unpublished candidate (ownership marker ${projectRelative(root, markerPath)} present); refusing to write a plan.`,
    );
  }
  const specXml = approvedSpecXml(root, changeId);
  const planPath = path.join(activeDir(root, changeId), "plan.xml");
  if (existsSync(planPath)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Plan already exists at ${projectRelative(root, planPath)}.`,
    );
  }
  writeFileSync(planPath, renderChangePlan(changeId, specXml));
  return projectRelative(root, planPath);
  });
}

const planNewArgs = {
  change: {
    type: "positional" as const,
    required: true,
    description: "C-* change id; must already match the accepted pattern",
  },
  path: {
    type: "string" as const,
    alias: "p",
    description: "Project root",
    default: ".",
  },
};

const specNewArgs = {
  slug: {
    type: "positional" as const,
    required: false,
    description: "Bare uppercase-kebab slug; the tool appends -<N>-<HASH>",
  },
  supersedes: {
    type: "string" as const,
    description: "Predecessor C-* id whose slug and lineage the successor inherits",
  },
  timestamp: {
    type: "string" as const,
    description: "ISO 8601 timestamp folded into the hash (or NGRACE_SPEC_TIMESTAMP)",
  },
  branch: {
    type: "string" as const,
    description: "Branch name folded into the hash (default: git HEAD, or NGRACE_SPEC_BRANCH)",
  },
  path: {
    type: "string" as const,
    alias: "p",
    description: "Project root",
    default: ".",
  },
};

export const specCommand = defineGraceCommand({
  meta: {
    name: "spec",
    description: "Write a draft change spec skeleton from the live grammar inventory.",
  },
  subCommands: {
    new: defineCommand({
      meta: {
        name: "new",
        description: "Mint C-<SLUG>-<N>-<HASH> and write .ngrace/changes/active/<ID>/spec.xml.",
      },
      args: specNewArgs,
      async run(context) {
        const root = resolveRoot(context.args.path);
        const mint = resolveSpecMint(context.args, root);
        const priorActive = countPriorSlug(root, "active", mint.slug);
        const priorArchive = countPriorSlug(root, "archive", mint.slug);
        const relative = writeSpecNew(root, mint.id);
        process.stdout.write(`${relative}\n`);
        process.stdout.write(
          `mint: ${mint.id} slug=${mint.slug} lineage=${mint.lineage} hash=${mint.hash} branch=${mint.branch} timestamp=${mint.timestamp}\n`,
        );
        process.stdout.write(
          `mint-search: ${priorActive} active, ${priorArchive} archive prior bundle(s) share slug ${mint.slug}\n`,
        );
      },
    }),
  },
});

function requireModuleId(raw: unknown): string {
  const moduleId = String(raw ?? "").trim();
  if (!ANCHOR_PATTERNS.module.test(moduleId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Module id '${moduleId}' does not match the accepted pattern M- then uppercase kebab.`,
    );
  }
  return moduleId;
}

function emitScaffold(root: string, moduleId: string): string {
  const graph = buildGraphProjection(resolveNgracePaths(root));
  const record = graph.modules.get(moduleId);
  if (!record) {
    throw new GraceCommandError("not-found", `Unknown module ${moduleId}.`);
  }
  if (!record.path) {
    throw new GraceCommandError("invalid-arguments", `Module ${moduleId} has no Path.`);
  }
  const absPath = path.join(root, record.path);
  if (!existsSync(absPath)) {
    throw new GraceCommandError("not-found", `Path file ${record.path} for ${moduleId} is missing.`);
  }
  const extension = path.extname(record.path);
  const adapter = LANGUAGE_ADAPTERS.find((candidate) => candidate.supports(record.path!));
  if (!ADAPTER_BACKED_EXTENSIONS.has(extension) || !adapter) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Extension ${extension} is not adapter-backed.`,
    );
  }
  const body = readFileSync(absPath, "utf8");
  const analysis = adapter.analyze(absPath, body);
  const role = inferRole(record.path);
  const mapMode = defaultMapMode(role);
  const symbols = mapMode === "EXPORTS" ? analysis.exports : mapMode === "LOCALS" ? analysis.localSymbols : new Set<string>();
  if (symbols.size === 0) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Required symbol set for MAP_MODE ${mapMode} is empty.`,
    );
  }
  const prefix = commentPrefixForExtension(extension);
  const contract = renderModuleContract(prefix, {
    purpose: `Purpose for ${moduleId}.`,
    scope: `Scope for ${moduleId}.`,
    depends: ["none"],
    links: [moduleId],
    role,
    mapMode,
  });
  const map = renderModuleMap(prefix, [...symbols].sort());
  return `${contract}\n${map}\n`;
}

export const planCommand = defineGraceCommand({
  meta: {
    name: "plan",
    description: "Write a draft change plan skeleton beside an approved spec.",
  },
  subCommands: {
    new: defineCommand({
      meta: {
        name: "new",
        description: "Write .ngrace/changes/active/C-ID/plan.xml from the skeleton emission.",
      },
      args: planNewArgs,
      async run(context) {
        const relative = writePlanNew(resolveRoot(context.args.path), requireChangeId(context.args.change));
        process.stdout.write(`${relative}\n`);
      },
    }),
  },
});

export const scaffoldCommand = defineGraceCommand({
  meta: {
    name: "scaffold",
    description: "Print a MODULE_CONTRACT and MODULE_MAP for a module Path without writing the file.",
  },
  args: {
    module: {
      type: "string",
      description: "M-* module id",
      required: true,
    },
    path: {
      type: "string",
      alias: "p",
      description: "Project root",
      default: ".",
    },
  },
  async run(context) {
    const rendered = emitScaffold(resolveRoot(context.args.path), requireModuleId(context.args.module));
    process.stdout.write(rendered);
  },
});
