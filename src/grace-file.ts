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
import { defineCommand } from "citty";

import { loadGraceArtifactIndex, resolveGovernedFile } from "./query/core";
import { defineGraceCommand } from "./query/command";
import { GraceCommandError, runQueryCommand } from "./query/errors";
import { formatFileText } from "./query/render";
import type { GraceArtifactIndex } from "./query/types";

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
  },
});
