// START_MODULE_CONTRACT
//   PURPOSE: Derive calibration context class by join from ledger and bundle
//   SCOPE: taskKind, adapterPresence, wroteVsRead, sequentialVsParallel at fold
//   DEPENDS: none
//   LINKS: M-CALIBRATION
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AUTHORED_CONTEXT_ATTRIBUTE_NAMES
//   CalibrationAdapterPresence
//   CalibrationContextClass
//   CalibrationSequentialVsParallel
//   CalibrationTaskKind
//   CalibrationWroteVsRead
//   ContextDerivationEvent
//   ContextDerivationInput
//   contextClassKey
//   deriveCalibrationContext
//   parseCalibrationContextAttributes
//   serializeCalibrationContextAttributes
// END_MODULE_MAP

/**
 * Context features for calibration pairs (D6 / §9.5.3 / A63 corr 165).
 *
 * Derived by join from the ledger and the change bundle at fold time — never
 * authored beside the claim. Stored on CalibrationAdjudication so a later study
 * can bucket historical rows without re-reading a moved-on tree (same lesson as
 * corr 156 for labels and corr 160 for adjudicatedAt).
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import { ANCHOR_PATTERNS } from "../artifact/types";
import { readGraceXmlArtifact, type GraceXmlNode } from "../artifact/xml";
import { ADAPTER_BACKED_EXTENSIONS } from "../language-registry";

/** Attribute names that must never be authored on a claim/attempt (D6). */
export const AUTHORED_CONTEXT_ATTRIBUTE_NAMES = [
  "taskKind",
  "adapterPresence",
  "wroteVsRead",
  "sequentialVsParallel",
  "contextClass",
] as const;

export type CalibrationTaskKind = "satisfies-ac" | "no-satisfies" | "mixed" | "unknown";
export type CalibrationAdapterPresence = "present" | "absent" | "mixed" | "undetermined";
export type CalibrationWroteVsRead = "wrote" | "read-only" | "undetermined";
export type CalibrationSequentialVsParallel = "sequential" | "parallel" | "undetermined";

/**
 * Four-dimensional context class stored with each fold-adjudicated pair.
 * `key` is the stable bucket id for the calibration report.
 */
export type CalibrationContextClass = {
  taskKind: CalibrationTaskKind;
  adapterPresence: CalibrationAdapterPresence;
  wroteVsRead: CalibrationWroteVsRead;
  sequentialVsParallel: CalibrationSequentialVsParallel;
  /** `taskKind|adapterPresence|wroteVsRead|sequentialVsParallel` */
  key: string;
};

export function contextClassKey(
  taskKind: CalibrationTaskKind,
  adapterPresence: CalibrationAdapterPresence,
  wroteVsRead: CalibrationWroteVsRead,
  sequentialVsParallel: CalibrationSequentialVsParallel,
): string {
  return `${taskKind}|${adapterPresence}|${wroteVsRead}|${sequentialVsParallel}`;
}

/** Minimal event shape for derivation (avoids importing grace-cursor and cycles). */
export type ContextDerivationEvent = {
  id: number;
  task: string;
  kind: string;
  attributes: Record<string, string>;
  children: GraceXmlNode[];
};

export type ContextDerivationInput = {
  projectRoot: string;
  changeId: string;
  /** All events in the epoch being folded (loose run/). */
  events: ContextDerivationEvent[];
  /** Claim attempt events (kind=attempt with claimedConfidence). */
  claimEvents: ContextDerivationEvent[];
  /** Range allocations for the epoch (from opened / Allocation children). */
  allocations: Array<{ worker: string; from: number; to: number }>;
};

/**
 * Derive the four context dimensions by join. Never reads agent-authored context
 * attributes on claim events — those are ignored even if present.
 */
export function deriveCalibrationContext(input: ContextDerivationInput): CalibrationContextClass {
  const taskKind = deriveTaskKind(input.projectRoot, input.changeId, input.claimEvents);
  const adapterPresence = deriveAdapterPresence(input.claimEvents);
  const wroteVsRead = deriveWroteVsRead(input.claimEvents);
  const sequentialVsParallel = deriveSequentialVsParallel(input.allocations, input.events);
  return {
    taskKind,
    adapterPresence,
    wroteVsRead,
    sequentialVsParallel,
    key: contextClassKey(taskKind, adapterPresence, wroteVsRead, sequentialVsParallel),
  };
}

function deriveTaskKind(
  projectRoot: string,
  changeId: string,
  claimEvents: ContextDerivationEvent[],
): CalibrationTaskKind {
  const taskIds = [...new Set(claimEvents.map((e) => e.task).filter((t) => ANCHOR_PATTERNS.task.test(t)))];
  if (taskIds.length === 0) return "unknown";

  const planPath = path.join(projectRoot, ARTIFACT_DIR, "changes", "active", changeId, "plan.xml");
  const archivePlan = path.join(projectRoot, ARTIFACT_DIR, "changes", "archive", changeId, "plan.xml");
  const resolved = existsSync(planPath) ? planPath : existsSync(archivePlan) ? archivePlan : null;
  if (!resolved) return "unknown";

  const artifact = readGraceXmlArtifact(resolved);
  const wrapper = artifact.root?.children.find((c) => c.tag === changeId);
  const implementation = wrapper?.children.find((c) => c.tag === "ImplementationPlan");
  if (!implementation) return "unknown";

  const kinds: CalibrationTaskKind[] = [];
  for (const taskId of taskIds) {
    const taskNode = implementation.children.find((c) => c.tag === taskId);
    if (!taskNode) {
      kinds.push("unknown");
      continue;
    }
    const satisfies = taskNode.children.find((c) => c.tag === "Satisfies");
    const hasAc =
      satisfies !== undefined &&
      satisfies.children.some((c) => ANCHOR_PATTERNS.acceptanceCriterion.test(c.tag));
    kinds.push(hasAc ? "satisfies-ac" : "no-satisfies");
  }

  const unique = [...new Set(kinds)];
  if (unique.length === 1) return unique[0]!;
  if (unique.includes("unknown") && unique.length === 2) {
    const other = unique.find((k) => k !== "unknown");
    return other ?? "unknown";
  }
  return "mixed";
}

function deriveAdapterPresence(claimEvents: ContextDerivationEvent[]): CalibrationAdapterPresence {
  const files: string[] = [];
  let anyEvidence = false;
  let anyUnavailable = false;
  for (const event of claimEvents) {
    const evidence = event.children.find((c) => c.tag === "WriteEvidence");
    if (!evidence) {
      anyUnavailable = true;
      continue;
    }
    anyEvidence = true;
    if ((evidence.attributes.available ?? "").trim() === "false") {
      anyUnavailable = true;
      continue;
    }
    for (const file of evidence.children.filter((c) => c.tag === "File")) {
      const rel = (file.text ?? "").trim();
      if (rel) files.push(rel);
    }
  }
  if (!anyEvidence || (files.length === 0 && anyUnavailable)) return "undetermined";
  if (files.length === 0) return "undetermined";

  let present = 0;
  let absent = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    // Only classify code-like paths; pure artifact XML is not an adapter question.
    if (!ext || file.startsWith(".ngrace/") || file.startsWith(`${ARTIFACT_DIR}/`)) continue;
    if (ADAPTER_BACKED_EXTENSIONS.has(ext)) present += 1;
    else absent += 1;
  }
  // If every written path is under .ngrace / has no code extension, treat as absent
  // (no adapter-backed code was in the write set).
  if (present === 0 && absent === 0) return "absent";
  if (present > 0 && absent === 0) return "present";
  if (present === 0 && absent > 0) return "absent";
  return "mixed";
}

function deriveWroteVsRead(claimEvents: ContextDerivationEvent[]): CalibrationWroteVsRead {
  let sawAvailable = false;
  let fileCount = 0;
  for (const event of claimEvents) {
    const evidence = event.children.find((c) => c.tag === "WriteEvidence");
    if (!evidence) continue;
    if ((evidence.attributes.available ?? "").trim() === "false") continue;
    sawAvailable = true;
    fileCount += evidence.children.filter((c) => c.tag === "File" && (c.text ?? "").trim()).length;
  }
  if (!sawAvailable) return "undetermined";
  return fileCount > 0 ? "wrote" : "read-only";
}

function deriveSequentialVsParallel(
  allocations: Array<{ worker: string }>,
  events: ContextDerivationEvent[],
): CalibrationSequentialVsParallel {
  const workers = new Set<string>();
  for (const allocation of allocations) {
    if (allocation.worker) workers.add(allocation.worker);
  }
  // Also collect from opened Allocation children (same epoch).
  for (const event of events) {
    if (event.kind !== "opened") continue;
    for (const child of event.children) {
      if (child.tag === "Allocation") {
        const worker = (child.attributes.worker ?? "").trim();
        if (worker) workers.add(worker);
      }
    }
  }
  if (workers.size === 0) return "undetermined";
  if (workers.size === 1) return "sequential";
  return "parallel";
}

export function serializeCalibrationContextAttributes(
  context: CalibrationContextClass,
): Record<string, string> {
  return {
    taskKind: context.taskKind,
    adapterPresence: context.adapterPresence,
    wroteVsRead: context.wroteVsRead,
    sequentialVsParallel: context.sequentialVsParallel,
    contextClass: context.key,
  };
}

export function parseCalibrationContextAttributes(
  attributes: Record<string, string>,
): CalibrationContextClass | undefined {
  const taskKind = parseTaskKind(attributes.taskKind);
  const adapterPresence = parseAdapterPresence(attributes.adapterPresence);
  const wroteVsRead = parseWroteVsRead(attributes.wroteVsRead);
  const sequentialVsParallel = parseSequentialVsParallel(attributes.sequentialVsParallel);
  if (!taskKind || !adapterPresence || !wroteVsRead || !sequentialVsParallel) return undefined;
  const key =
    (attributes.contextClass ?? "").trim() ||
    contextClassKey(taskKind, adapterPresence, wroteVsRead, sequentialVsParallel);
  return { taskKind, adapterPresence, wroteVsRead, sequentialVsParallel, key };
}

function parseTaskKind(raw: string | undefined): CalibrationTaskKind | undefined {
  const v = (raw ?? "").trim();
  if (v === "satisfies-ac" || v === "no-satisfies" || v === "mixed" || v === "unknown") return v;
  return undefined;
}

function parseAdapterPresence(raw: string | undefined): CalibrationAdapterPresence | undefined {
  const v = (raw ?? "").trim();
  if (v === "present" || v === "absent" || v === "mixed" || v === "undetermined") return v;
  return undefined;
}

function parseWroteVsRead(raw: string | undefined): CalibrationWroteVsRead | undefined {
  const v = (raw ?? "").trim();
  if (v === "wrote" || v === "read-only" || v === "undetermined") return v;
  return undefined;
}

function parseSequentialVsParallel(raw: string | undefined): CalibrationSequentialVsParallel | undefined {
  const v = (raw ?? "").trim();
  if (v === "sequential" || v === "parallel" || v === "undetermined") return v;
  return undefined;
}
