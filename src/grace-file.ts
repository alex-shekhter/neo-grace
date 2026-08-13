// START_MODULE_CONTRACT
//   PURPOSE: Artifact query and navigation CLI
//   SCOPE: Module, file, graph, and verification resolution
//   DEPENDS: none
//   LINKS: M-QUERY
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   fileCommand
// END_MODULE_MAP
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineCommand } from "citty";

import { LANGUAGE_ADAPTERS } from "./language-registry";
import { defineGraceCommand } from "./query/command";
import { loadGraceArtifactIndex, resolveGovernedFile, resolveModule } from "./query/core";
import { GraceCommandError, runQueryCommand } from "./query/errors";
import { formatFileExportsText, formatFileText } from "./query/render";
import type { GraceArtifactIndex } from "./query/types";

type FileExportsView = {
  path: string;
  moduleId: string | null;
  adapterId: string | null;
  exportConfidence: "exact" | "heuristic" | null;
  exports: string[];
};

function toPosixPath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

function normalizeFileInputPath(root: string, input: string) {
  const absolutePath = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return toPosixPath(relativePath);
  }
  return toPosixPath(input);
}

function requireExistingFile(root: string, relativePath: string) {
  const absolutePath = path.resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new GraceCommandError("not-found", `File \`${relativePath}\` was not found on disk.`);
  }
  // A directory is a third absence cause, not the second one wearing its message (F40 / F55).
  if (!statSync(absolutePath).isFile()) {
    throw new GraceCommandError("not-found", `Path \`${relativePath}\` is a directory, not a file.`);
  }
  return absolutePath;
}

function resolveExportsSelectors(args: { target?: unknown; module?: unknown }) {
  const positional = args.target == null ? "" : String(args.target).trim();
  const moduleId = args.module == null ? "" : String(args.module).trim();
  if ((positional === "") === (moduleId === "")) {
    throw new GraceCommandError(
      "invalid-arguments",
      "Pass exactly one of a positional file path or `--module <id>`.",
    );
  }
  return { positional: positional || null, moduleId: moduleId || null };
}

function analyseExportsFile(root: string, relativePath: string, moduleId: string | null): FileExportsView {
  const absolutePath = requireExistingFile(root, relativePath);
  const adapter = LANGUAGE_ADAPTERS.find((candidate) => candidate.supports(absolutePath));
  if (!adapter) {
    return {
      path: relativePath,
      moduleId,
      adapterId: null,
      exportConfidence: null,
      exports: [],
    };
  }
  const analysis = adapter.analyze(absolutePath, readFileSync(absolutePath, "utf8"));
  return {
    path: relativePath,
    moduleId,
    adapterId: analysis.adapterId,
    exportConfidence: analysis.exportConfidence,
    exports: [...analysis.exports].sort(),
  };
}

function linkedModuleId(index: GraceArtifactIndex, relativePath: string) {
  const fileRecord = index.files.find((record) => record.path === relativePath);
  return fileRecord?.linkedModuleIds[0] ?? null;
}

/** Loads projection-backed index or throws a user-facing command error. */
function loadNgraceIndexOrThrow(root: string): GraceArtifactIndex {
  return loadGraceArtifactIndex(root);
}

function resolveFormat(format: unknown, json: unknown) {
  const resolved = Boolean(json) ? "json" : String(format ?? "text");
  if (resolved !== "text" && resolved !== "json") {
    throw new GraceCommandError("invalid-arguments", `Unsupported format \`${resolved}\`. Use \`text\` or \`json\`.`);
  }

  return resolved;
}

export const fileCommand = defineGraceCommand({
  meta: {
    name: "file",
    description: "Query file-local neo-grace markup and private implementation context.",
  },
  subCommands: {
    show: defineCommand({
      meta: {
        name: "show",
        description: "Show file-local MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY, contracts, and blocks.",
      },
      args: {
        target: {
          type: "positional",
          required: false,
          description: "Governed file path",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        contracts: {
          type: "boolean",
          description: "Include function/type/file-local contract details",
          default: false,
        },
        blocks: {
          type: "boolean",
          description: "Include semantic block list",
          default: false,
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
        const errorFormat = Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
        await runQueryCommand(errorFormat, () => {
          const format = resolveFormat(context.args.format, context.args.json);
          const index = loadNgraceIndexOrThrow(String(context.args.path ?? "."));
          const fileRecord = resolveGovernedFile(index, context.args.target == null ? "" : String(context.args.target));
          process.stdout.write(format === "json"
            ? `${JSON.stringify(fileRecord, null, 2)}\n`
            : `${formatFileText(fileRecord, {
              includeContracts: Boolean(context.args.contracts),
              includeBlocks: Boolean(context.args.blocks),
            })}\n`);
        });
      },
    }),
    exports: defineCommand({
      meta: {
        name: "exports",
        description: "Show the first matching language adapter's exports and exportConfidence for a module Path or named file.",
      },
      args: {
        target: {
          type: "positional",
          required: false,
          description: "File path to analyse",
        },
        module: {
          type: "string",
          description: "Module id whose authored graph Path is analysed",
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
        const errorFormat = Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
        await runQueryCommand(errorFormat, () => {
          const format = resolveFormat(context.args.format, context.args.json);
          const index = loadNgraceIndexOrThrow(String(context.args.path ?? "."));
          const selectors = resolveExportsSelectors(context.args);
          let relativePath: string;
          let moduleId: string | null;
          if (selectors.moduleId) {
            const moduleRecord = resolveModule(index, selectors.moduleId);
            const authoredPath = moduleRecord.graph.path?.trim() ?? "";
            if (!authoredPath) {
              throw new GraceCommandError("not-found", `Module \`${moduleRecord.id}\` has no Path.`);
            }
            relativePath = authoredPath;
            moduleId = moduleRecord.id;
          } else {
            relativePath = normalizeFileInputPath(index.root, selectors.positional ?? "");
            moduleId = linkedModuleId(index, relativePath);
          }
          const view = analyseExportsFile(index.root, relativePath, moduleId);
          process.stdout.write(format === "json"
            ? `${JSON.stringify(view, null, 2)}\n`
            : `${formatFileExportsText(view)}\n`);
        });
      },
    }),
  },
});
