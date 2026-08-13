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
//   planCommand
//   scaffoldCommand
//   specCommand
// END_MODULE_MAP
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";

import { resolveNgracePaths } from "./artifact/project";
import { buildGraphProjection } from "./artifact/projections";
import { renderChangePlan, renderChangeSpec } from "./artifact/skeletons";
import { ARTIFACT_DIR } from "./artifact/paths";
import { ANCHOR_PATTERNS } from "./artifact/types";
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

function writeSpecNew(root: string, changeId: string): string {
  refuseExistingBundle(root, changeId);
  const specPath = path.join(activeDir(root, changeId), "spec.xml");
  if (existsSync(specPath)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Spec already exists at ${projectRelative(root, specPath)}.`,
    );
  }
  mkdirSync(path.dirname(specPath), { recursive: true });
  writeFileSync(specPath, renderChangeSpec(changeId));
  return projectRelative(root, specPath);
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
  const archive = archiveDir(root, changeId);
  if (existsSync(archive) && !existsSync(activeDir(root, changeId))) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Change ${changeId} already exists at ${projectRelative(root, archive)}.`,
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
}

const newChangeArgs = {
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

export const specCommand = defineGraceCommand({
  meta: {
    name: "spec",
    description: "Write a draft change spec skeleton from the live grammar inventory.",
  },
  subCommands: {
    new: defineCommand({
      meta: {
        name: "new",
        description: "Write .ngrace/changes/active/C-ID/spec.xml from the skeleton emission.",
      },
      args: newChangeArgs,
      async run(context) {
        const relative = writeSpecNew(resolveRoot(context.args.path), requireChangeId(context.args.change));
        process.stdout.write(`${relative}\n`);
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
      args: newChangeArgs,
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
