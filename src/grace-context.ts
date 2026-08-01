// START_MODULE_CONTRACT
//   PURPOSE: Context selection surface
//   SCOPE: Task slices, skill subsetting, and selectedBytes measurement
//   DEPENDS: none
//   LINKS: M-CONTEXT
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ArtifactMeasurement
//   CompositionEntry
//   ExclusionEntry
//   ModuleSliceEntry
//   PLAN_WAVE_HONEST_READING
//   PUBLISHED_SKILLS
//   PlanWaveMeasurement
//   PublishedSkill
//   PurposeAcSlot
//   SCOPE_SHARED_SENTENCE
//   SELECTED_BYTES_DEFINITION
//   SELECTION_STAGE_GROUND
//   SELECTION_STAGE_TOOLKIT
//   SKILLS_MID_EXECUTION
//   SKILLS_PRE_EXECUTION
//   SkillCandidate
//   SkillMeasurement
//   SkillRecommendation
//   SkillStateKind
//   TaskSlice
//   buildSkillRecommendation
//   buildTaskSlice
//   classifySkillState
//   computeSelectionRatio
//   contextCommand
//   formatPlanSharedBody
//   formatSkillsText
//   formatSliceBody
//   formatSliceText
//   formatTaskPrivateBody
//   listFullEnvelopeFiles
//   listSkillComposition
//   listSkillMdFiles
//   measurePlanWave
//   normalizeAuthoredText
//   pairwiseIdenticalFraction
//   selectionRatio
//   sumCompositionBytes
//   sumFileBytes
//   utf8Bytes
// END_MODULE_MAP
/**
 * Task slices and skill subsetting (Phase 8 / D15).
 *
 * Selection, never compression. Compose over existing retrieval primitives.
 * Production-local measurement helpers — do not import src/test-support/ (A47.2 corr 119).
 *
 * A47/A48 are normative over plan §8.3–§8.5.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";

import { ARTIFACT_DIR } from "./artifact/paths";
import { ANCHOR_PATTERNS } from "./artifact/types";
import { readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./artifact/xml";
import { resolveChangeBundle, type AbsenceValue } from "./grace-cursor";
import { GraceCommandError, runQueryCommand } from "./query/errors";
import { loadGraceArtifactIndex } from "./query/core";
import { formatModuleText } from "./query/render";
import type { GraceArtifactIndex } from "./query/types";

// ─── Public constants ────────────────────────────────────────────────────────

/** Marketplace-declared skills (marketplace.json at HEAD). Single source for recommendations. */
export const PUBLISHED_SKILLS = [
  "ngrace-init",
  "ngrace-spec",
  "ngrace-plan",
  "ngrace-execute",
  "ngrace-refactor",
  "ngrace-setup-subagents",
  "ngrace-fix",
  "ngrace-refresh",
  "ngrace-status",
  "ngrace-ask",
  "ngrace-cli",
  "ngrace-explainer",
  "ngrace-verification",
  "ngrace-design",
  "ngrace-reviewer",
  "ngrace-migrate",
] as const;

export type PublishedSkill = (typeof PUBLISHED_SKILLS)[number];

/** Mid-execution cluster (approved plan + cursor present). */
export const SKILLS_MID_EXECUTION: readonly PublishedSkill[] = [
  "ngrace-execute",
  "ngrace-cli",
  "ngrace-verification",
  "ngrace-fix",
  "ngrace-status",
  "ngrace-reviewer",
  "ngrace-ask",
  "ngrace-refresh",
];

/** Pre-execution / draft-plan cluster. */
export const SKILLS_PRE_EXECUTION: readonly PublishedSkill[] = [
  "ngrace-init",
  "ngrace-spec",
  "ngrace-plan",
  "ngrace-cli",
  "ngrace-status",
  "ngrace-explainer",
  "ngrace-design",
  "ngrace-ask",
  "ngrace-setup-subagents",
];

export const SELECTED_BYTES_DEFINITION =
  "utf8-bytes of the agent-facing slice body (Purpose, modules, verification anchors, write-scope, exclusions) — not measurement ground fields, not CLI chrome";

export const SELECTION_STAGE_TOOLKIT = "toolkit" as const;

export const SELECTION_STAGE_GROUND =
  "sole value observed in this repository; no host adapter exercises a harness stage (A48.3 / A46.4). This is a ground declaration, not a check among stages";

export const SCOPE_SHARED_SENTENCE =
  "Write scope is plan-level and shared with sibling tasks of this change. It is not task-private.";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PurposeAcSlot = {
  id: string;
  text?: string;
  absence?: AbsenceValue;
};

export type ModuleSliceEntry = {
  id: string;
  projection?: string;
  absence?: AbsenceValue;
};

export type ExclusionEntry = {
  kind:
    | "design-context"
    | "project-context"
    | "archived-sibling"
    | "other-task-body"
    | "design-context-from-denominator";
  detail: string;
};

/** One file in the full envelope (or skill set), with its utf-8 size (A49.3 corr 137). */
export type CompositionEntry = {
  path: string;
  bytes: number;
};

export type ArtifactMeasurement = {
  unit: "utf8-bytes";
  fullBytes: number;
  selectedBytes: number;
  selectedBytesDefinition: string;
  fullComposition: CompositionEntry[];
  selectionRatio: number | null;
  selectionRatioAbsence?: AbsenceValue;
};

/**
 * Wave-level measurement for all tasks of one plan (A49.1 corr 135).
 * Per-slice ratio alone conceals that N workers receive nearly identical bodies.
 */
export type PlanWaveMeasurement = {
  changeId: string;
  taskIds: string[];
  taskCount: number;
  unit: "utf8-bytes";
  fullBytes: number;
  /** selectedBytes per task id */
  perTaskSelectedBytes: Record<string, number>;
  /** Sum of per-task selectedBytes — total payload if each worker loads a full slice */
  sumSelectedBytes: number;
  /**
   * Union: plan-shared body counted once + each task's Purpose (task-private) block.
   * What unique material a wave actually needs if workers share the plan body.
   */
  unionSelectedBytes: number;
  /** Mean pairwise fraction of body bytes that are identical (line multiset). */
  meanPairwiseOverlapFraction: number;
  /** selectionRatio(fullBytes, unionSelectedBytes) */
  planUnionSelectionRatio: number | null;
  planUnionSelectionRatioAbsence?: AbsenceValue;
  /**
   * Honest reading of the three numbers together (A49.1).
   * Standing rule 11: the sentence a reader hears must be true of the sources.
   */
  honestReading: string;
};

export type TaskSlice = {
  schemaVersion: "1.0.0";
  kind: "task-slice";
  changeId: string;
  taskId: string;
  subjectLocation: "active" | "archive";
  /** When true, this slice is a measurement artifact — not an execution input (A48.1). */
  archivedMeasurementOnly: boolean;
  purpose: {
    title: string;
    acceptanceCriteria: PurposeAcSlot[];
  };
  modules: ModuleSliceEntry[];
  verificationAnchors: string[];
  writeScope: {
    files: string[];
    sharedWithSiblingTasks: true;
    note: string;
  };
  exclusions: ExclusionEntry[];
  measurement: ArtifactMeasurement;
  /** Present when the plan has more than one task (A49.1). */
  planWave?: PlanWaveMeasurement;
};

export type SkillCandidate = {
  skill: string;
  basis: string;
};

export type SkillMeasurement = {
  unit: "utf8-bytes";
  fullBytes: number;
  selectedBytes: number;
  fullComposition: CompositionEntry[];
  selectionRatio: number | null;
  selectionRatioAbsence?: AbsenceValue;
};

export type SkillRecommendation = {
  schemaVersion: "1.0.0";
  kind: "skill-recommendation";
  changeId?: string;
  selectionStage: typeof SELECTION_STAGE_TOOLKIT;
  selectionStageGround: string;
  candidates: SkillCandidate[];
  measurement: SkillMeasurement;
};

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Corr 120 normalizer: wording identity after whitespace layout is stripped.
 * 1) CRLF → LF  2) strip trailing [ \t] per line  3) common-indent strip (spaces)
 * 4) drop leading/trailing empty lines  5) preserve interior empty lines
 */
export function normalizeAuthoredText(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => line.replace(/[ \t]+$/g, ""));
  const nonEmpty = lines.filter((line) => line.length > 0);
  if (nonEmpty.length === 0) {
    return "";
  }
  let minIndent = Infinity;
  for (const line of nonEmpty) {
    const match = /^ */.exec(line);
    const indent = match ? match[0].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;
  const dedented = lines.map((line) => {
    if (line.length === 0) return line;
    const lead = /^ */.exec(line)?.[0].length ?? 0;
    return line.slice(Math.min(minIndent, lead));
  });
  while (dedented.length > 0 && dedented[0] === "") dedented.shift();
  while (dedented.length > 0 && dedented[dedented.length - 1] === "") dedented.pop();
  return dedented.join("\n");
}

/**
 * Local pure ratio (A47.2 corr 119 — not imported from test-support).
 * Callers that may see selected > full must use computeSelectionRatio instead.
 */
export function selectionRatio(full: number, selected: number): number {
  if (!Number.isFinite(full) || !Number.isFinite(selected)) {
    throw new RangeError(`selectionRatio: full (${full}) and selected (${selected}) must be finite`);
  }
  if (full < 0) {
    throw new RangeError(`selectionRatio: full (${full}) must be >= 0`);
  }
  if (selected < 0 || selected > full) {
    throw new RangeError(
      `selectionRatio: selected (${selected}) must be in [0, full (${full})]`,
    );
  }
  if (full === 0) return 0;
  return (full - selected) / full;
}

/**
 * Honest ratio for slice measurement (A48.2): when selected exceeds full, report
 * absence rather than coercing the numerator.
 */
export function computeSelectionRatio(
  full: number,
  selected: number,
): { selectionRatio: number | null; selectionRatioAbsence?: AbsenceValue } {
  if (!Number.isFinite(full) || !Number.isFinite(selected) || full < 0 || selected < 0) {
    return {
      selectionRatio: null,
      selectionRatioAbsence: {
        verdict: "unable-to-determine",
        reason: `non-finite or negative byte counts (full=${full}, selected=${selected})`,
      },
    };
  }
  if (selected > full) {
    return {
      selectionRatio: null,
      selectionRatioAbsence: {
        verdict: "unable-to-determine",
        reason:
          `selectedBytes (${selected}) exceed fullBytes (${full}); the slice is larger than the unselected envelope because it emits derived labels and projections. Reported without coercing the numerator (A48.2).`,
      },
    };
  }
  return { selectionRatio: selectionRatio(full, selected) };
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// ─── Envelope ────────────────────────────────────────────────────────────────

/**
 * A48.2 full envelope: bundle spec.xml + plan.xml, graph/main.xml, every
 * verification/* file, five context/* files. Never design-context.xml.
 * Each entry carries its utf-8 byte size (A49.3 corr 137).
 */
export function listFullEnvelopeFiles(projectRoot: string, bundlePath: string): CompositionEntry[] {
  const root = path.resolve(projectRoot);
  const out: CompositionEntry[] = [];
  const pushIfFile = (absolute: string): void => {
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return;
    // Absolute ban on design-context in the denominator (A48.2)
    if (path.basename(absolute) === "design-context.xml") return;
    const text = readFileSync(absolute, "utf8");
    out.push({ path: toPosixRelative(root, absolute), bytes: utf8Bytes(text) });
  };

  pushIfFile(path.join(bundlePath, "spec.xml"));
  pushIfFile(path.join(bundlePath, "plan.xml"));
  pushIfFile(path.join(root, ARTIFACT_DIR, "graph", "main.xml"));

  const verificationDir = path.join(root, ARTIFACT_DIR, "verification");
  if (existsSync(verificationDir) && statSync(verificationDir).isDirectory()) {
    for (const name of readdirSync(verificationDir).sort()) {
      pushIfFile(path.join(verificationDir, name));
    }
  }

  const contextDir = path.join(root, ARTIFACT_DIR, "context");
  if (existsSync(contextDir) && statSync(contextDir).isDirectory()) {
    for (const name of readdirSync(contextDir).sort()) {
      pushIfFile(path.join(contextDir, name));
    }
  }

  return out;
}

export function sumCompositionBytes(entries: CompositionEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

export function sumFileBytes(projectRoot: string, relativePaths: string[]): number {
  const root = path.resolve(projectRoot);
  let total = 0;
  for (const rel of relativePaths) {
    const absolute = path.join(root, ...rel.split("/"));
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    total += utf8Bytes(readFileSync(absolute, "utf8"));
  }
  return total;
}

/** Composition entries for published skill SKILL.md files (with sizes). */
export function listSkillComposition(projectRoot: string, skillNames: readonly string[]): CompositionEntry[] {
  const root = path.resolve(projectRoot);
  const out: CompositionEntry[] = [];
  for (const skill of skillNames) {
    const absolute = path.join(root, "skills", "ngrace", skill, "SKILL.md");
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    out.push({
      path: toPosixRelative(root, absolute),
      bytes: utf8Bytes(readFileSync(absolute, "utf8")),
    });
  }
  return out;
}

function toPosixRelative(projectRoot: string, absolute: string): string {
  return path.relative(projectRoot, absolute).split(path.sep).join("/");
}

// ─── Plan / spec parsing ─────────────────────────────────────────────────────

type ParsedTask = {
  id: string;
  title: string;
  criterionTexts: string[];
  satisfies: string[];
  verificationText: string;
};

type ParsedPlan = {
  changeId: string;
  status: string | undefined;
  graphAnchors: string[];
  verificationAnchors: string[];
  writeScopeFiles: string[];
  tasks: ParsedTask[];
};

type ParsedSpec = {
  changeId: string;
  status: string | undefined;
  acceptanceCriteria: Map<string, string>;
};

function findChangeWrapper(root: GraceXmlNode): GraceXmlNode | undefined {
  return root.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
}

function extractPlan(planFile: string): ParsedPlan {
  const artifact = readGraceXmlArtifact(planFile);
  if (!artifact.root) {
    throw new GraceCommandError("invalid-project", `Unreadable plan at ${planFile}`);
  }
  const wrapper = findChangeWrapper(artifact.root);
  if (!wrapper) {
    throw new GraceCommandError("invalid-project", `Plan ${planFile} has no C-* wrapper`);
  }

  const graphAnchors: string[] = [];
  const verificationAnchors: string[] = [];
  const writeScopeFiles: string[] = [];
  const tasks: ParsedTask[] = [];

  for (const node of walkNodes(wrapper)) {
    if (node.tag === "GraphAnchors") {
      for (const child of node.children) {
        if (ANCHOR_PATTERNS.module.test(child.tag) || ANCHOR_PATTERNS.dataFlow.test(child.tag)) {
          graphAnchors.push(child.tag);
        }
      }
    }
    if (node.tag === "VerificationAnchors") {
      for (const child of node.children) {
        if (ANCHOR_PATTERNS.verification.test(child.tag)) {
          verificationAnchors.push(child.tag);
        }
      }
    }
    if (node.tag === "ObservedWriteScope") {
      for (const child of node.children) {
        if (child.tag === "File" || child.tag === "Path") {
          const value = child.text.trim();
          if (value) writeScopeFiles.push(value);
        }
      }
    }
  }

  const implementation = wrapper.children.find((child) => child.tag === "ImplementationPlan");
  if (implementation) {
    for (const taskNode of implementation.children) {
      if (!ANCHOR_PATTERNS.task.test(taskNode.tag)) continue;
      const titleNode = taskNode.children.find((child) => child.tag === "Title");
      const title = titleNode ? normalizeAuthoredText(titleNode.text) : "";
      const criterionTexts: string[] = [];
      const acceptance = taskNode.children.find((child) => child.tag === "AcceptanceCriteria");
      if (acceptance) {
        for (const criterion of acceptance.children) {
          if (criterion.tag === "Criterion") {
            criterionTexts.push(normalizeAuthoredText(criterion.text));
          }
        }
      }
      const satisfies: string[] = [];
      const satisfiesNode = taskNode.children.find((child) => child.tag === "Satisfies");
      if (satisfiesNode) {
        for (const child of satisfiesNode.children) {
          if (ANCHOR_PATTERNS.acceptanceCriterion.test(child.tag)) {
            satisfies.push(child.tag);
          }
        }
      }
      const verification = taskNode.children.find((child) => child.tag === "Verification");
      const verificationText = verification ? normalizeAuthoredText(verification.text) : "";
      tasks.push({
        id: taskNode.tag,
        title,
        criterionTexts,
        satisfies,
        verificationText,
      });
    }
  }

  return {
    changeId: wrapper.tag,
    status: artifact.root.attributes.status,
    graphAnchors: [...new Set(graphAnchors)],
    verificationAnchors: [...new Set(verificationAnchors)],
    writeScopeFiles,
    tasks,
  };
}

function extractSpec(specFile: string): ParsedSpec {
  const artifact = readGraceXmlArtifact(specFile);
  if (!artifact.root) {
    throw new GraceCommandError("invalid-project", `Unreadable spec at ${specFile}`);
  }
  const wrapper = findChangeWrapper(artifact.root);
  if (!wrapper) {
    throw new GraceCommandError("invalid-project", `Spec ${specFile} has no C-* wrapper`);
  }
  const acceptanceCriteria = new Map<string, string>();
  const section = wrapper.children.find((child) => child.tag === "AcceptanceCriteria");
  if (section) {
    for (const child of section.children) {
      if (ANCHOR_PATTERNS.acceptanceCriterion.test(child.tag)) {
        acceptanceCriteria.set(child.tag, normalizeAuthoredText(child.text));
      }
    }
  }
  return {
    changeId: wrapper.tag,
    status: artifact.root.attributes.status,
    acceptanceCriteria,
  };
}

function subjectLocationForBundle(bundlePath: string): "active" | "archive" {
  const normalized = bundlePath.replaceAll("\\", "/");
  if (normalized.includes(`/${ARTIFACT_DIR}/changes/archive/`)) return "archive";
  return "active";
}

// ─── Slice composition ───────────────────────────────────────────────────────

function moduleProjectionText(index: GraceArtifactIndex, moduleId: string): ModuleSliceEntry {
  const found = index.modules.find((record) => record.id.toLowerCase() === moduleId.toLowerCase());
  if (!found) {
    return {
      id: moduleId,
      absence: {
        verdict: "unable-to-determine",
        reason: `module ${moduleId} is not present in the project graph projection`,
      },
    };
  }
  return {
    id: moduleId,
    projection: formatModuleText(found, { withVerification: true }),
  };
}

/** Task-private Purpose block (the only authored task-local content in a slice). */
export function formatTaskPrivateBody(slice: TaskSlice): string {
  const lines: string[] = [];
  lines.push("Purpose");
  lines.push("-------");
  lines.push(`Title: ${slice.purpose.title}`);
  for (const ac of slice.purpose.acceptanceCriteria) {
    if (ac.text !== undefined) {
      lines.push(`${ac.id}:`);
      lines.push(ac.text);
    } else if (ac.absence) {
      lines.push(`${ac.id}: [${ac.absence.verdict}] ${ac.absence.reason}`);
    }
  }
  return lines.join("\n");
}

/**
 * Plan-shared body: modules, verification anchors, write scope, exclusions.
 * Identical for every task of the same plan (corr 128/133).
 */
export function formatPlanSharedBody(slice: TaskSlice): string {
  const lines: string[] = [];
  lines.push("Modules (plan DurableScope GraphAnchors)");
  lines.push("----------------------------------------");
  for (const mod of slice.modules) {
    if (mod.projection) {
      lines.push(`### ${mod.id}`);
      lines.push(mod.projection);
    } else if (mod.absence) {
      lines.push(`### ${mod.id}`);
      lines.push(`[${mod.absence.verdict}] ${mod.absence.reason}`);
    }
  }
  lines.push("");
  lines.push("Verification anchors (plan DurableScope)");
  lines.push("----------------------------------------");
  lines.push(slice.verificationAnchors.length > 0 ? slice.verificationAnchors.join(", ") : "(none)");
  lines.push("");
  lines.push("Write scope (plan-level)");
  lines.push("------------------------");
  lines.push(SCOPE_SHARED_SENTENCE);
  lines.push(`sharedWithSiblingTasks: ${slice.writeScope.sharedWithSiblingTasks}`);
  for (const file of slice.writeScope.files) {
    lines.push(`- ${file}`);
  }
  lines.push("");
  lines.push("Exclusions");
  lines.push("----------");
  for (const exclusion of slice.exclusions) {
    lines.push(`- [${exclusion.kind}] ${exclusion.detail}`);
  }
  return lines.join("\n");
}

/**
 * Agent-facing body text used for selectedBytes (like-for-like definition).
 * Excludes measurement ground so headers alone cannot game the ratio.
 */
export function formatSliceBody(slice: TaskSlice): string {
  const lines: string[] = [];
  lines.push("neo-grace Task Slice");
  lines.push("====================");
  lines.push(`Change: ${slice.changeId}`);
  lines.push(`Task: ${slice.taskId}`);
  lines.push(`Subject location: ${slice.subjectLocation}`);
  if (slice.archivedMeasurementOnly) {
    lines.push(
      "ARCHIVED SUBJECT — measurement artifact only. Not an execution input. Do not hand this slice to an executor as live work (A48.1).",
    );
  }
  lines.push("");
  lines.push(formatTaskPrivateBody(slice));
  lines.push("");
  lines.push(formatPlanSharedBody(slice));
  return lines.join("\n");
}

/**
 * Pairwise fraction of body that is identical under a line multiset model (A49.1).
 * sharedLineBytes / max(bytesA, bytesB). Matches the probe shape (~86% on C-GATE-SURFACE).
 */
export function pairwiseIdenticalFraction(a: string, b: string): number {
  const bytesA = utf8Bytes(a);
  const bytesB = utf8Bytes(b);
  const denom = Math.max(bytesA, bytesB);
  if (denom === 0) return 1;
  const bag = new Map<string, number>();
  for (const line of b.split("\n")) {
    bag.set(line, (bag.get(line) ?? 0) + 1);
  }
  let shared = 0;
  for (const line of a.split("\n")) {
    const count = bag.get(line) ?? 0;
    if (count > 0) {
      shared += utf8Bytes(line) + (line.length > 0 ? 0 : 0);
      // count the line text; newlines between shared lines are approximated by +1 per shared line except last
      shared += 1; // account for the line terminator contribution toward identity
      bag.set(line, count - 1);
    }
  }
  // Cap at denom — terminator accounting can slightly overshoot on empty lines
  return Math.min(1, shared / denom);
}

export const PLAN_WAVE_HONEST_READING =
  "A task slice is a plan-level body (DurableScope modules, verification, write scope, exclusions) with a task-shaped Purpose header. Across an N-task plan, workers receive N nearly identical envelopes; the per-slice selectionRatio is not the wave cost.";

/**
 * Measure all tasks of a plan: per-slice sizes, union against the envelope, cross-task overlap (A49.1).
 */
export function measurePlanWave(
  projectRoot: string,
  changeId: string,
): PlanWaveMeasurement {
  const root = path.resolve(projectRoot);
  const bundlePath = resolveChangeBundle(root, changeId);
  const planPath = path.join(bundlePath, "plan.xml");
  if (!existsSync(planPath)) {
    throw new GraceCommandError("not-found", `No plan.xml in ${changeId}`);
  }
  const plan = extractPlan(planPath);
  const taskIds = plan.tasks.map((task) => task.id);
  const slices = taskIds.map((taskId) =>
    buildTaskSlice(root, changeId, taskId, { includePlanWave: false }),
  );
  const bodies = slices.map((slice) => formatSliceBody(slice));
  const perTaskSelectedBytes: Record<string, number> = {};
  let sumSelectedBytes = 0;
  for (const slice of slices) {
    perTaskSelectedBytes[slice.taskId] = slice.measurement.selectedBytes;
    sumSelectedBytes += slice.measurement.selectedBytes;
  }

  const sharedBytes = slices.length > 0 ? utf8Bytes(formatPlanSharedBody(slices[0]!)) : 0;
  let privateSum = 0;
  for (const slice of slices) {
    privateSum += utf8Bytes(formatTaskPrivateBody(slice));
  }
  // Chrome (title banner + change/task lines) is per worker and mostly shared boilerplate;
  // count once for the first slice's non-purpose/non-shared prefix, then +task-id line per task.
  const unionSelectedBytes = sharedBytes + privateSum;

  let meanPairwiseOverlapFraction = 1;
  if (bodies.length >= 2) {
    let pairSum = 0;
    let pairs = 0;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        pairSum += pairwiseIdenticalFraction(bodies[i]!, bodies[j]!);
        pairs += 1;
      }
    }
    meanPairwiseOverlapFraction = pairs > 0 ? pairSum / pairs : 1;
  }

  const fullBytes = slices[0]?.measurement.fullBytes ?? 0;
  const unionRatio = computeSelectionRatio(fullBytes, unionSelectedBytes);
  const overlapPct = (meanPairwiseOverlapFraction * 100).toFixed(1);
  const honestReading =
    `${PLAN_WAVE_HONEST_READING} ` +
    `For ${changeId} (${taskIds.length} tasks): mean pairwise body overlap ${overlapPct}%; ` +
    `sumSelectedBytes=${sumSelectedBytes}; unionSelectedBytes=${unionSelectedBytes}; ` +
    `fullBytes=${fullBytes}; planUnionSelectionRatio=` +
    (unionRatio.selectionRatio !== null ? String(unionRatio.selectionRatio) : "absent") +
    ".";

  return {
    changeId,
    taskIds,
    taskCount: taskIds.length,
    unit: "utf8-bytes",
    fullBytes,
    perTaskSelectedBytes,
    sumSelectedBytes,
    unionSelectedBytes,
    meanPairwiseOverlapFraction,
    planUnionSelectionRatio: unionRatio.selectionRatio,
    ...(unionRatio.selectionRatioAbsence
      ? { planUnionSelectionRatioAbsence: unionRatio.selectionRatioAbsence }
      : {}),
    honestReading,
  };
}

function formatCompositionLines(entries: CompositionEntry[]): string[] {
  return entries.map((entry) => `  - ${entry.path} (${entry.bytes} bytes)`);
}

export function formatSliceText(slice: TaskSlice): string {
  const body = formatSliceBody(slice);
  const m = slice.measurement;
  const ratioLine =
    m.selectionRatio !== null
      ? `selectionRatio: ${m.selectionRatio}`
      : `selectionRatio: [absent] ${m.selectionRatioAbsence?.reason ?? "unavailable"}`;
  const lines = [
    body,
    "",
    "Measurement",
    "-----------",
    `unit: ${m.unit}`,
    `fullBytes: ${m.fullBytes}`,
    `selectedBytes: ${m.selectedBytes}`,
    `selectedBytesDefinition: ${m.selectedBytesDefinition}`,
    ratioLine,
    `fullComposition (${m.fullComposition.length} files, bytes sum to fullBytes):`,
    ...formatCompositionLines(m.fullComposition),
  ];
  if (slice.planWave) {
    const w = slice.planWave;
    const planRatioLine =
      w.planUnionSelectionRatio !== null
        ? `planUnionSelectionRatio: ${w.planUnionSelectionRatio}`
        : `planUnionSelectionRatio: [absent] ${w.planUnionSelectionRatioAbsence?.reason ?? "unavailable"}`;
    lines.push(
      "",
      "Plan wave (A49.1 corr 135)",
      "-------------------------",
      `taskCount: ${w.taskCount}`,
      `sumSelectedBytes: ${w.sumSelectedBytes}`,
      `unionSelectedBytes: ${w.unionSelectedBytes}`,
      `meanPairwiseOverlapFraction: ${w.meanPairwiseOverlapFraction}`,
      planRatioLine,
      `honestReading: ${w.honestReading}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function buildTaskSlice(
  projectRoot: string,
  changeId: string,
  taskId: string,
  options: { includePlanWave?: boolean } = {},
): TaskSlice {
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change id ${JSON.stringify(changeId)} must be a canonical C-* identifier.`,
    );
  }
  if (!ANCHOR_PATTERNS.task.test(taskId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Task id ${JSON.stringify(taskId)} must be a canonical T-* identifier.`,
    );
  }

  const root = path.resolve(projectRoot);
  const bundlePath = resolveChangeBundle(root, changeId);
  const location = subjectLocationForBundle(bundlePath);
  const planPath = path.join(bundlePath, "plan.xml");
  const specPath = path.join(bundlePath, "spec.xml");
  if (!existsSync(planPath)) {
    throw new GraceCommandError("not-found", `No plan.xml in ${changeId}`);
  }
  if (!existsSync(specPath)) {
    throw new GraceCommandError("not-found", `No spec.xml in ${changeId}`);
  }

  const plan = extractPlan(planPath);
  const spec = extractSpec(specPath);
  const task = plan.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new GraceCommandError(
      "not-found",
      `Task ${taskId} not found in ${changeId}. Known: ${plan.tasks.map((entry) => entry.id).join(", ") || "(none)"}`,
    );
  }

  const index = loadGraceArtifactIndex(root);
  const modules = plan.graphAnchors.map((id) => moduleProjectionText(index, id));

  const acceptanceCriteria: PurposeAcSlot[] = task.satisfies.map((acId) => {
    const body = spec.acceptanceCriteria.get(acId);
    if (body === undefined) {
      return {
        id: acId,
        absence: {
          verdict: "unable-to-determine",
          reason: `Satisfies target ${acId} has no body in the subject spec (not a silent skip)`,
        },
      };
    }
    return { id: acId, text: body };
  });

  const exclusions: ExclusionEntry[] = [
    {
      kind: "design-context",
      detail:
        "design-context.xml is never loaded during execution (absolute exclusion). Also excluded from the full envelope denominator (A48.2).",
    },
    {
      kind: "design-context-from-denominator",
      detail: "design-context.xml is not counted in fullBytes even when present in the subject bundle.",
    },
    {
      kind: "project-context",
      detail:
        "Project .ngrace/context/* is omitted from the default slice (corr 122); it remains in the full envelope.",
    },
    {
      kind: "archived-sibling",
      detail:
        "Content from archived bundles other than the named subject never appears in this slice.",
    },
    {
      kind: "other-task-body",
      detail:
        "Other tasks' Title, Criterion, Satisfies, and Verification bodies are not included (corr 129).",
    },
  ];

  const fullComposition = listFullEnvelopeFiles(root, bundlePath);
  const fullBytes = sumCompositionBytes(fullComposition);

  const partial: TaskSlice = {
    schemaVersion: "1.0.0",
    kind: "task-slice",
    changeId,
    taskId,
    subjectLocation: location,
    archivedMeasurementOnly: location === "archive",
    purpose: {
      title: task.title,
      acceptanceCriteria,
    },
    modules,
    verificationAnchors: plan.verificationAnchors,
    writeScope: {
      files: plan.writeScopeFiles,
      sharedWithSiblingTasks: true,
      note: SCOPE_SHARED_SENTENCE,
    },
    exclusions,
    measurement: {
      unit: "utf8-bytes",
      fullBytes: 0,
      selectedBytes: 0,
      selectedBytesDefinition: SELECTED_BYTES_DEFINITION,
      fullComposition: [],
      selectionRatio: null,
    },
  };

  const bodyText = formatSliceBody(partial);
  const selectedBytes = utf8Bytes(bodyText);
  const ratio = computeSelectionRatio(fullBytes, selectedBytes);

  partial.measurement = {
    unit: "utf8-bytes",
    fullBytes,
    selectedBytes,
    selectedBytesDefinition: SELECTED_BYTES_DEFINITION,
    fullComposition,
    selectionRatio: ratio.selectionRatio,
    ...(ratio.selectionRatioAbsence ? { selectionRatioAbsence: ratio.selectionRatioAbsence } : {}),
  };

  // A49.1: attach wave metrics when the plan has sibling tasks (skip when measuring the wave itself)
  if (options.includePlanWave !== false && plan.tasks.length > 1) {
    partial.planWave = measurePlanWave(root, changeId);
  }

  return partial;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export type SkillStateKind = "full-absent-cursor" | "mid-execution" | "pre-execution";

export function classifySkillState(input: {
  changeId?: string;
  planStatus?: string;
  cursorPresent: boolean;
}): SkillStateKind {
  if (!input.changeId || !input.planStatus) {
    return "full-absent-cursor";
  }
  if (!input.cursorPresent) {
    return "full-absent-cursor";
  }
  if (input.planStatus === "draft") {
    return "pre-execution";
  }
  if (input.planStatus === "approved" || input.planStatus === "applied") {
    return "mid-execution";
  }
  return "full-absent-cursor";
}

function skillsForState(state: SkillStateKind): { skills: readonly PublishedSkill[]; basis: string } {
  switch (state) {
    case "mid-execution":
      return {
        skills: SKILLS_MID_EXECUTION,
        basis:
          "plan approved/applied and cursor present — execution cluster (stage 1 errs toward inclusion)",
      };
    case "pre-execution":
      return {
        skills: SKILLS_PRE_EXECUTION,
        basis: "plan is draft — authoring cluster (stage 1 errs toward inclusion)",
      };
    case "full-absent-cursor":
    default:
      return {
        skills: PUBLISHED_SKILLS,
        basis: "cursor absent or no plan state — full published set (D15 false-negative rule)",
      };
  }
}

export function listSkillMdFiles(projectRoot: string): string[] {
  return listSkillComposition(projectRoot, PUBLISHED_SKILLS).map((entry) => entry.path);
}

export function buildSkillRecommendation(
  projectRoot: string,
  options: { changeId?: string } = {},
): SkillRecommendation {
  const root = path.resolve(projectRoot);
  let planStatus: string | undefined;
  let cursorPresent = false;

  if (options.changeId) {
    if (!ANCHOR_PATTERNS.change.test(options.changeId)) {
      throw new GraceCommandError(
        "invalid-arguments",
        `Change id ${JSON.stringify(options.changeId)} must be a canonical C-* identifier.`,
      );
    }
    const bundlePath = resolveChangeBundle(root, options.changeId);
    const planPath = path.join(bundlePath, "plan.xml");
    if (existsSync(planPath)) {
      const plan = extractPlan(planPath);
      planStatus = plan.status;
    }
    // Cursor file present ⇒ position cache exists (D1). Content validity is not required for
    // stage-1 skill inclusion bias — absence of the file is the only "absent cursor" signal.
    cursorPresent = existsSync(path.join(bundlePath, "run.xml"));
  }

  const state = classifySkillState({
    changeId: options.changeId,
    planStatus,
    cursorPresent,
  });
  const { skills, basis } = skillsForState(state);
  const candidates: SkillCandidate[] = skills.map((skill) => ({ skill, basis }));

  const fullComposition = listSkillComposition(root, PUBLISHED_SKILLS);
  const fullBytes = sumCompositionBytes(fullComposition);
  const selectedComposition = listSkillComposition(root, skills);
  const selectedBytes = sumCompositionBytes(selectedComposition);
  const ratio = computeSelectionRatio(fullBytes, selectedBytes);

  return {
    schemaVersion: "1.0.0",
    kind: "skill-recommendation",
    changeId: options.changeId,
    selectionStage: SELECTION_STAGE_TOOLKIT,
    selectionStageGround: SELECTION_STAGE_GROUND,
    candidates,
    measurement: {
      unit: "utf8-bytes",
      fullBytes,
      selectedBytes,
      fullComposition,
      selectionRatio: ratio.selectionRatio,
      ...(ratio.selectionRatioAbsence ? { selectionRatioAbsence: ratio.selectionRatioAbsence } : {}),
    },
  };
}

export function formatSkillsText(rec: SkillRecommendation): string {
  const lines: string[] = [
    "neo-grace Skill Recommendation",
    "==============================",
    "Host-facing skill selection (not a task slice).",
    `selectionStage: ${rec.selectionStage}`,
    `selectionStageGround: ${rec.selectionStageGround}`,
  ];
  if (rec.changeId) lines.push(`Change: ${rec.changeId}`);
  lines.push("", "Candidates");
  lines.push("----------");
  for (const candidate of rec.candidates) {
    lines.push(`- ${candidate.skill}`);
    lines.push(`  basis: ${candidate.basis}`);
  }
  const m = rec.measurement;
  const ratioLine =
    m.selectionRatio !== null
      ? `selectionRatio: ${m.selectionRatio}`
      : `selectionRatio: [absent] ${m.selectionRatioAbsence?.reason ?? "unavailable"}`;
  lines.push(
    "",
    "Measurement (skill ratio — separate from artifact ratio)",
    "-------------------------------------------------------",
    `unit: ${m.unit}`,
    `fullBytes: ${m.fullBytes}`,
    `selectedBytes: ${m.selectedBytes}`,
    ratioLine,
    `fullComposition (${m.fullComposition.length} SKILL.md files, bytes sum to fullBytes):`,
    ...formatCompositionLines(m.fullComposition),
    "",
  );
  return lines.join("\n");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function resolveFormat(format: unknown, json: unknown): "text" | "json" {
  const resolved = Boolean(json) ? "json" : String(format ?? "text");
  if (resolved !== "text" && resolved !== "json") {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported format \`${resolved}\`. Use \`text\` or \`json\`.`,
    );
  }
  return resolved;
}

export const contextCommand = defineCommand({
  meta: {
    name: "context",
    description:
      "Emit a task slice (--task) or a skill recommendation (--skills). Selection, never compression. Not a dump of .ngrace/context/*.",
  },
  args: {
    task: {
      type: "string",
      description: "Task id (T-*) for a task slice. Mutually exclusive with --skills.",
    },
    skills: {
      type: "boolean",
      description: "Emit skill recommendation only. Mutually exclusive with --task.",
      default: false,
    },
    change: {
      type: "string",
      description: "Change bundle id (C-*). Required with --task; optional with --skills.",
    },
    path: {
      type: "string",
      alias: "p",
      description: "Project root to inspect",
      default: ".",
    },
    format: {
      type: "string",
      alias: "f",
      description: "Output format: text or json",
      default: "text",
    },
    json: {
      type: "boolean",
      description: "Shortcut for --format json",
      default: false,
    },
  },
  async run(context) {
    const errorFormat =
      Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
    await runQueryCommand(errorFormat, () => {
      const format = resolveFormat(context.args.format, context.args.json);
      const taskArg = context.args.task != null ? String(context.args.task).trim() : "";
      const skillsFlag = Boolean(context.args.skills);
      const changeArg = context.args.change != null ? String(context.args.change).trim() : "";
      const projectRoot = String(context.args.path ?? ".");

      if (taskArg && skillsFlag) {
        throw new GraceCommandError(
          "invalid-arguments",
          "`--task` and `--skills` are mutually exclusive. Emit a task slice or a skill recommendation, not both.",
        );
      }
      if (!taskArg && !skillsFlag) {
        throw new GraceCommandError(
          "invalid-arguments",
          "Pass `--task T-NNN --change C-ID` for a task slice, or `--skills` for a skill recommendation. This command does not dump .ngrace/context/*.",
        );
      }

      if (skillsFlag) {
        const recommendation = buildSkillRecommendation(projectRoot, {
          changeId: changeArg || undefined,
        });
        process.stdout.write(
          format === "json"
            ? `${JSON.stringify(recommendation, null, 2)}\n`
            : formatSkillsText(recommendation),
        );
        return;
      }

      if (!changeArg) {
        throw new GraceCommandError(
          "invalid-arguments",
          "`--task` requires `--change C-ID` so the subject is chosen, never discovered (A48.1).",
        );
      }

      const slice = buildTaskSlice(projectRoot, changeArg, taskArg);
      process.stdout.write(
        format === "json" ? `${JSON.stringify(slice, null, 2)}\n` : formatSliceText(slice),
      );
    });
  },
});
