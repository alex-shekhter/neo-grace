// START_MODULE_CONTRACT
//   PURPOSE: Foldable loose run/ event membership and parallel orphan inventory
//   SCOPE: listLooseEvents, listRunOrphans, and supporting types over change-bundle run/
//   DEPENDS: none
//   LINKS: M-ARTIFACT-TYPES
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   LooseEvent
//   OrphanSkipClass
//   RangeAllocation
//   RunOrphan
//   listLooseEvents
//   listRunOrphans
// END_MODULE_MAP

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { childText, readGraceXmlArtifact, type GraceXmlNode } from "./xml";

export type RangeAllocation = { worker: string; from: number; to: number };

/**
 * Loose run/ event. Payload (attributes beyond id/task/kind, and children) must
 * survive fold (A18.2 / correction 31). listLooseEvents is the A5.4 inventory site.
 */
export type LooseEvent = {
  id: number;
  task: string;
  kind: string;
  file: string;
  allocations?: RangeAllocation[];
  /** Root attributes from the loose file (includes id/task/kind; may include outcome, …). */
  attributes: Record<string, string>;
  /** Root children (Allocation, FailureSignature, WriteEvidence, Wave, …). */
  children: GraceXmlNode[];
};

/**
 * Loose event filenames: `{id}-{task}-{kind}.xml`.
 * Task is always T-NNN (no internal hyphens after the T-digits form); kind may contain
 * hyphens (`verification-unavailable`). Do not use a fully free-form middle group — it
 * steals the kind's hyphens (A19.1).
 */
const EVENT_FILENAME = /^(\d+)-(T-[0-9]{3})-(.+)\.xml$/;

function cloneXmlNode(node: GraceXmlNode): GraceXmlNode {
  return {
    tag: node.tag,
    attributes: { ...node.attributes },
    children: node.children.map(cloneXmlNode),
    text: node.text,
  };
}

function parseAllocationNode(node: GraceXmlNode): RangeAllocation | null {
  const worker = node.attributes.worker?.trim() || childText(node, "Worker")?.trim();
  const from = Number(node.attributes.from ?? childText(node, "From"));
  const to = Number(node.attributes.to ?? childText(node, "To"));
  if (!worker || !Number.isInteger(from) || !Number.isInteger(to) || from > to) return null;
  return { worker, from, to };
}

/** List loose run/ events ordered by allocated id (never by mtime). */
export function listLooseEvents(bundlePath: string): LooseEvent[] {
  const runDir = path.join(bundlePath, "run");
  if (!existsSync(runDir)) return [];
  const events: LooseEvent[] = [];
  for (const name of readdirSync(runDir)) {
    const match = EVENT_FILENAME.exec(name);
    if (!match) continue;
    const file = path.join(runDir, name);
    const idFromName = Number(match[1]);
    const taskFromName = match[2]!;
    const kindFromName = match[3]!;
    const parsed = readGraceXmlArtifact(file);
    // Prefer XML attributes when present (authoritative payload); filename is discovery.
    const id = parsed.root?.attributes.id ? Number(parsed.root.attributes.id) : idFromName;
    const task = (parsed.root?.attributes.task ?? taskFromName).trim() || taskFromName;
    const kind = (parsed.root?.attributes.kind ?? kindFromName).trim() || kindFromName;
    if (!Number.isInteger(id) || id <= 0) continue;
    const attributes: Record<string, string> = parsed.root
      ? { ...parsed.root.attributes }
      : { id: String(id), task, kind };
    attributes.id = String(id);
    attributes.task = task;
    attributes.kind = kind;
    const children = parsed.root ? parsed.root.children.map(cloneXmlNode) : [];
    const allocations =
      kind === "opened"
        ? children
            .filter((child) => child.tag === "Allocation")
            .map(parseAllocationNode)
            .filter((entry): entry is RangeAllocation => entry !== null)
        : undefined;
    events.push({ id, task, kind, file, allocations, attributes, children });
  }
  return events.sort((a, b) => a.id - b.id);
}

/**
 * Silent-skip classes that listLooseEvents drops (F8.2 / D8.7).
 * - event-filename: name fails EVENT_FILENAME (e.g. NaN-T-001-opened.xml)
 * - invalid-id: name matches but XML id is non-integer or non-positive
 */
export type OrphanSkipClass = "event-filename" | "invalid-id";

/**
 * A run/ file that listLooseEvents necessarily drops. Parallel inventory only —
 * never mixed into the ordered positive-integer primary list (D8.7).
 */
export type RunOrphan = {
  /** Absolute path on disk. */
  file: string;
  /** Basename (e.g. NaN-T-001-opened.xml). */
  name: string;
  class: OrphanSkipClass;
  /** Human-readable diagnosis; always unrecoverable as an event id. */
  reason: string;
  /** Raw id attribute when readable (invalid-id class). */
  rawId?: string;
  /** Always false today — no recoverable positive integer event id (D8.3). */
  recoverable: false;
};

/**
 * Parallel orphan inventory over run/ (D8.7 / F8.2).
 * Reports both silent-skip classes without changing listLooseEvents' contract.
 */
export function listRunOrphans(bundlePath: string): RunOrphan[] {
  const runDir = path.join(bundlePath, "run");
  if (!existsSync(runDir)) return [];
  const orphans: RunOrphan[] = [];
  for (const name of readdirSync(runDir)) {
    if (!name.endsWith(".xml")) continue;
    const file = path.join(runDir, name);
    const match = EVENT_FILENAME.exec(name);
    if (!match) {
      // Class 1 — EVENT_FILENAME miss (F8 live fixture: NaN-T-001-opened.xml).
      orphans.push({
        file,
        name,
        class: "event-filename",
        reason:
          `unrecoverable orphan: filename ${JSON.stringify(name)} does not match `
          + `{id}-{T-NNN}-{kind}.xml with a positive integer event id; no recoverable event id`,
        recoverable: false,
      });
      continue;
    }
    const idFromName = Number(match[1]);
    const parsed = readGraceXmlArtifact(file);
    const rawId = parsed.root?.attributes.id;
    const id = rawId !== undefined && rawId !== "" ? Number(rawId) : idFromName;
    if (Number.isInteger(id) && id > 0) continue;
    // Class 2 — well-named file whose XML id fails the positive-integer guard.
    orphans.push({
      file,
      name,
      class: "invalid-id",
      reason:
        `unrecoverable orphan: file ${JSON.stringify(name)} matches EVENT_FILENAME but `
        + `id=${JSON.stringify(rawId ?? String(id))} is not a positive integer event id; no recoverable event id`,
      rawId: rawId ?? String(id),
      recoverable: false,
    });
  }
  return orphans.sort((a, b) => a.name.localeCompare(b.name));
}
