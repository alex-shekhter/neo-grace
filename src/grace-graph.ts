#!/usr/bin/env bun

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defineCommand, type CommandDef, runMain } from "citty";

import { detectGraceProjectKind, resolveGrace4Paths } from "./grace4/project";
import { buildGraphProjection } from "./grace4/projections";
import { ANCHOR_PATTERNS } from "./grace4/types";
import { childNodes, readGraceXmlArtifact, type GraceXmlNode } from "./grace4/xml";
import { serializeGraceXmlDocument, serializeGraceXmlNode } from "./grace4/xml-serialize";
import { GraceCommandError, runGraceCommand } from "./query/errors";

export type GraphSplitMove = {
  anchorId: string;
  path: string;
  fromDocument: string;
  fromFile: string;
};

export type GraphSplitPlan = {
  root: string;
  pathPrefix: string;
  newDocumentId: string;
  newDocumentRelativePath: string;
  moves: GraphSplitMove[];
  dryRun: boolean;
  applied: boolean;
};

/** Normalize a path-prefix for matching module Path fields (POSIX, no trailing slash). */
export function normalizeSplitPrefix(prefix: string): string {
  const trimmed = prefix.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("..")) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Invalid --by path prefix ${JSON.stringify(prefix)}. Use a project-relative prefix without ".." (e.g. services/api).`,
    );
  }
  return trimmed;
}

/** Derive GD-* id from a path prefix: services/api → GD-SERVICES-API. */
export function documentIdFromPrefix(prefix: string): string {
  const body = prefix
    .replaceAll(/[^A-Za-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toUpperCase();
  const candidate = `GD-${body || "SPLIT"}`;
  if (!ANCHOR_PATTERNS.graphDocument.test(candidate)) {
    throw new GraceCommandError("invalid-arguments", `Could not derive a valid GD-* id from prefix ${JSON.stringify(prefix)}.`);
  }
  return candidate;
}

function slugFromDocumentId(documentId: string): string {
  return documentId.replace(/^GD-/, "").toLowerCase().replaceAll("_", "-");
}

/** True when git reports a dirty worktree (porcelain non-empty). Non-git roots are clean. */
export function isGitWorktreeDirty(projectRoot: string): boolean {
  const probe = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--is-inside-work-tree"],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (probe.exitCode !== 0) {
    return false;
  }
  const status = Bun.spawnSync({
    cmd: ["git", "status", "--porcelain"],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (status.exitCode !== 0) {
    return false;
  }
  return new TextDecoder().decode(status.stdout).trim().length > 0;
}

function pathMatchesPrefix(modulePath: string, prefix: string): boolean {
  const normalized = modulePath.replaceAll("\\", "/");
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

/**
 * Plans (and optionally applies) moving M-* anchors whose Path matches pathPrefix
 * into a new GD-* document. Never deletes anchors — only re-routes ownership.
 */
export function planGraphSplit(
  projectRoot: string,
  options: {
    pathPrefix: string;
    apply?: boolean;
    allowDirty?: boolean;
    documentId?: string;
  },
): GraphSplitPlan {
  const root = path.resolve(projectRoot);
  const kind = detectGraceProjectKind(root);
  if (kind !== "grace4") {
    throw new GraceCommandError("invalid-project", "grace graph split requires a GRACE 4 .grace project.");
  }

  const pathPrefix = normalizeSplitPrefix(options.pathPrefix);
  if (options.apply && !options.allowDirty && isGitWorktreeDirty(root)) {
    throw new GraceCommandError(
      "invalid-arguments",
      "Refusing to write: git worktree is dirty. Commit/stash changes or pass --allow-dirty.",
    );
  }

  const paths = resolveGrace4Paths(root);
  const graph = buildGraphProjection(paths);
  if (graph.issues.some((issue) => issue.severity === "error")) {
    throw new GraceCommandError(
      "invalid-project",
      "Graph projection has errors; fix `grace lint` projection issues before splitting.",
      { issues: graph.issues.filter((i) => i.severity === "error").map((i) => i.code) },
    );
  }

  let newDocumentId = options.documentId?.trim() || documentIdFromPrefix(pathPrefix);
  if (!ANCHOR_PATTERNS.graphDocument.test(newDocumentId)) {
    throw new GraceCommandError("invalid-arguments", `Document id ${JSON.stringify(newDocumentId)} must be a canonical GD-* tag.`);
  }
  if (graph.documents.has(newDocumentId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `${newDocumentId} already exists. Choose another id with --document-id or a different --by prefix.`,
    );
  }

  const moves: GraphSplitMove[] = [];
  for (const record of graph.modules.values()) {
    if (!record.path || !pathMatchesPrefix(record.path, pathPrefix)) {
      continue;
    }
    moves.push({
      anchorId: record.id,
      path: record.path,
      fromDocument: record.owner,
      fromFile: record.file,
    });
  }

  if (moves.length === 0) {
    throw new GraceCommandError(
      "not-found",
      `No modules with Path under prefix ${JSON.stringify(pathPrefix)}.`,
    );
  }

  const newDocumentRelativePath = `graph/${slugFromDocumentId(newDocumentId)}.xml`;
  const plan: GraphSplitPlan = {
    root,
    pathPrefix,
    newDocumentId,
    newDocumentRelativePath,
    moves,
    dryRun: !options.apply,
    applied: false,
  };

  if (!options.apply) {
    return plan;
  }

  applyGraphSplit(paths.graceDir, paths.graphIndex, plan, graph.documents);
  plan.applied = true;
  return plan;
}

function applyGraphSplit(
  graceDir: string,
  graphIndexPath: string,
  plan: GraphSplitPlan,
  documentFiles: Map<string, string>,
): void {
  const moveIds = new Set(plan.moves.map((move) => move.anchorId));
  const movedNodes = new Map<string, GraceXmlNode>();

  // Every write is staged here and flushed only after all validation succeeds. This command
  // is the only one that writes to .grace/; writing source documents as they are processed
  // meant a later failure — including the checks below — left anchors removed from disk with
  // no new document to hold them.
  const pendingWrites: Array<{ file: string; contents: string }> = [];

  // Collect and remove anchors from source documents.
  const sourceOwners = [...new Set(plan.moves.map((move) => move.fromDocument))];
  for (const owner of sourceOwners) {
    const file = documentFiles.get(owner);
    if (!file) {
      throw new GraceCommandError("invalid-project", `Missing file for ${owner}.`);
    }
    const artifact = readGraceXmlArtifact(file);
    if (!artifact.root) {
      throw new GraceCommandError("invalid-project", `Unable to parse ${file}.`);
    }
    const wrapper = artifact.root.children.find((child) => child.tag === owner);
    if (!wrapper) {
      throw new GraceCommandError("invalid-project", `${file} is missing wrapper ${owner}.`);
    }
    const remaining: GraceXmlNode[] = [];
    for (const child of wrapper.children) {
      if (moveIds.has(child.tag)) {
        movedNodes.set(child.tag, child);
      } else {
        remaining.push(child);
      }
    }
    wrapper.children = remaining;
    pendingWrites.push({ file, contents: serializeGraceXmlDocument(artifact.root) });
  }

  // Ensure every planned move was found as a direct child of its owner.
  for (const move of plan.moves) {
    if (!movedNodes.has(move.anchorId)) {
      throw new GraceCommandError(
        "invalid-project",
        `Could not extract ${move.anchorId} from ${move.fromDocument}; anchors must be direct children of the GD-* wrapper.`,
      );
    }
  }

  // Stage new document with moved anchors in stable order.
  const newAbsolute = path.join(graceDir, plan.newDocumentRelativePath);
  if (existsSync(newAbsolute)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `${plan.newDocumentRelativePath} already exists. Choose another id with --document-id or a different --by prefix.`,
    );
  }
  const orderedAnchors = plan.moves.map((move) => movedNodes.get(move.anchorId)!);
  const newRoot: GraceXmlNode = {
    tag: "GraceGraphDocument",
    attributes: { graceVersion: "4.0" },
    children: [
      {
        tag: plan.newDocumentId,
        attributes: {},
        children: orderedAnchors,
        text: "",
      },
    ],
    text: "",
  };
  pendingWrites.push({ file: newAbsolute, contents: serializeGraceXmlDocument(newRoot) });

  // Rewrite index: drop moved owns from old routes, add new route.
  const indexArtifact = readGraceXmlArtifact(graphIndexPath);
  if (!indexArtifact.root) {
    throw new GraceCommandError("invalid-project", "Unable to parse graph index.");
  }
  const graphDocuments = indexArtifact.root.children.find((child) => child.tag === "GraphDocuments");
  if (!graphDocuments) {
    throw new GraceCommandError("invalid-project", "Graph index is missing GraphDocuments.");
  }

  for (const route of graphDocuments.children) {
    if (!ANCHOR_PATTERNS.graphDocument.test(route.tag)) continue;
    for (const owns of childNodes(route, "Owns")) {
      owns.children = owns.children.filter((child) => !moveIds.has(child.tag));
    }
  }

  const ownsChildren: GraceXmlNode[] = plan.moves.map((move) => ({
    tag: move.anchorId,
    attributes: {},
    children: [],
    text: "",
  }));
  graphDocuments.children.push({
    tag: plan.newDocumentId,
    attributes: {},
    children: [
      { tag: "Path", attributes: {}, children: [], text: plan.newDocumentRelativePath },
      { tag: "Owns", attributes: {}, children: ownsChildren, text: "" },
    ],
    text: "",
  });

  pendingWrites.push({ file: graphIndexPath, contents: serializeGraceXmlDocument(indexArtifact.root) });

  mkdirSync(path.dirname(newAbsolute), { recursive: true });
  for (const write of pendingWrites) {
    writeFileSync(write.file, write.contents);
  }
}

export function formatGraphSplitPlan(plan: GraphSplitPlan): string {
  const lines = [
    plan.applied ? "Graph split applied" : "Graph split plan (dry-run; pass --apply to write)",
    `Prefix: ${plan.pathPrefix}`,
    `New document: ${plan.newDocumentId} → ${plan.newDocumentRelativePath}`,
    "Moving:",
    ...plan.moves.map((move) => `  ${move.anchorId} (${move.path}) from ${move.fromDocument}`),
    "",
    "Note: rewritten documents are re-serialized from the parsed tree.",
    "XML comments are not preserved. Anchor content, attributes and text are.",
  ];
  return `${lines.join("\n")}\n`;
}

/** Extract raw serialized form of an anchor from a document file for round-trip tests. */
export function extractAnchorSerialization(file: string, anchorId: string): string | null {
  const artifact = readGraceXmlArtifact(file);
  if (!artifact.root) return null;
  for (const wrapper of artifact.root.children) {
    for (const child of wrapper.children) {
      if (child.tag === anchorId) {
        return serializeGraceXmlNode(child);
      }
    }
  }
  return null;
}

export const graphCommand = defineCommand({
  meta: {
    name: "graph",
    description: "Graph maintenance helpers (split oversized GD-* documents).",
  },
  subCommands: {
    split: defineCommand({
      meta: {
        name: "split",
        description: "Move modules whose Path matches a prefix into a new GD-* document. Dry-run by default.",
      },
      args: {
        by: {
          type: "string",
          description: "Path prefix of modules to move (e.g. services/api)",
          required: true,
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root",
          default: ".",
        },
        apply: {
          type: "boolean",
          description: "Write the split (default is dry-run)",
          default: false,
        },
        allowDirty: {
          type: "boolean",
          description: "Allow writing when git worktree is dirty",
          default: false,
        },
        documentId: {
          type: "string",
          description: "Override new GD-* document id",
        },
        format: {
          type: "string",
          alias: "f",
          description: "Output format: text or json",
          default: "text",
        },
      },
      async run(context) {
        const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
        await runGraceCommand(format, () => {
          const plan = planGraphSplit(String(context.args.path ?? "."), {
            pathPrefix: String(context.args.by),
            apply: Boolean(context.args.apply),
            allowDirty: Boolean(context.args.allowDirty),
            documentId: context.args.documentId ? String(context.args.documentId) : undefined,
          });
          if (format === "json") {
            process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
          } else {
            process.stdout.write(formatGraphSplitPlan(plan));
          }
        }, "Unable to complete grace graph split.");
      },
    }),
  },
});

if (import.meta.main) {
  await runMain(graphCommand as CommandDef);
}
