// START_MODULE_CONTRACT
//   PURPOSE: Artifact query and navigation CLI
//   SCOPE: Change-bundle find and show
//   DEPENDS: none
//   LINKS: M-QUERY
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   changeCommand
// END_MODULE_MAP
import { defineCommand } from "citty";

import { collectChangeView, findChangeBundles } from "./query/change";
import { defineGraceCommand } from "./query/command";
import { GraceCommandError, runQueryCommand } from "./query/errors";
import { formatChangeFindTable, formatChangeText } from "./query/render";

function resolveFormat(format: unknown, json: unknown): "text" | "json" {
  const resolved = Boolean(json) ? "json" : String(format ?? "text");
  if (resolved !== "text" && resolved !== "json") {
    throw new GraceCommandError("invalid-arguments", `Unsupported format \`${resolved}\`. Use \`text\` or \`json\`.`);
  }
  return resolved;
}

export const changeCommand = defineGraceCommand({
  meta: {
    name: "change",
    description:
      "Query change bundles: close-bound criteria, plan scopes, and the latest verdict's per-criterion tally. Read-only.",
  },
  subCommands: {
    find: defineCommand({
      meta: {
        name: "find",
        description: "List change bundles with location, spec/plan status, and derived states.",
      },
      args: {
        query: {
          type: "positional",
          required: false,
          description: "Filter by change id fragment",
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
          const root = String(context.args.path ?? ".");
          const bundles = findChangeBundles(root, context.args.query == null ? undefined : String(context.args.query));
          process.stdout.write(
            format === "json"
              ? `${JSON.stringify(bundles, null, 2)}\n`
              : `${formatChangeFindTable(bundles)}\n`,
          );
        });
      },
    }),
    show: defineCommand({
      meta: {
        name: "show",
        description:
          "Show one change bundle's close-bound criteria, ObservedWriteScope/DurableScope, and latest verdict tally. Read-only.",
      },
      args: {
        target: {
          type: "positional",
          required: false,
          description: "Change bundle id (C-*)",
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
          const changeId = context.args.target == null ? "" : String(context.args.target).trim();
          if (changeId === "") {
            throw new GraceCommandError("invalid-arguments", "A change bundle id (C-*) is required.");
          }
          const view = collectChangeView(String(context.args.path ?? "."), changeId);
          process.stdout.write(
            format === "json" ? `${JSON.stringify(view, null, 2)}\n` : `${formatChangeText(view)}\n`,
          );
        });
      },
    }),
  },
});
