#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Top-level ngrace apply command
//   SCOPE: Register the sanctioned applied close; delegate reads and writes to the gates ledger
//   DEPENDS: M-GATES
//   LINKS: M-CLI
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   applyCommand
// END_MODULE_MAP

import path from "node:path";

import { type CommandDef, runMain } from "citty";

import { ARTIFACT_DIR } from "./artifact/paths";
import { ANCHOR_PATTERNS } from "./artifact/types";
import { applyChangeBundle, validateApplyChangeBundle } from "./gates/ledger";
import { defineGraceCommand } from "./query/command";
import { GraceCommandError, runGraceCommand } from "./query/errors";

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

export const applyCommand = defineGraceCommand({
  meta: {
    name: "apply",
    description:
      "Sanctioned approved-to-applied close: write applied onto the active spec and plan, record per-artifact fingerprints, and move the bundle into archive after both gates permit. Not a gate subcommand.",
  },
  args: {
    change: {
      type: "string",
      description: "Active C-* bundle being closed",
      required: true,
    },
    path: {
      type: "string",
      alias: "p",
      description: "Project root",
      default: ".",
    },
    record: {
      type: "boolean",
      description: "Record the applied write (default true); false validates and prints without writing",
      default: true,
    },
    force: {
      type: "boolean",
      description: "Bypass only the missing apply/archive permit refusals; requires a non-empty reason",
      default: false,
    },
    reason: {
      type: "string",
      description: "Operator-supplied reason stored with the write Decisions when force is used",
      default: "",
    },
  },
  async run(context) {
    await runGraceCommand("text", () => {
      const projectRoot = path.resolve(String(context.args.path ?? "."));
      const changeId = requireChangeId(context.args.change);

      const force = context.args.force === true;
      const reason = String(context.args.reason ?? "").trim();
      if (force && reason.length === 0) {
        throw new GraceCommandError(
          "invalid-arguments",
          `Force requires a non-empty reason: pass \`--reason=<why>\` with \`--force=true\` for ${changeId}.`,
        );
      }
      const applyOptions = force ? { force: true as const, reason } : {};
      if (context.args.record === false) {
        validateApplyChangeBundle(projectRoot, changeId, applyOptions);
        process.stdout.write(
          `ngrace apply --change ${changeId}: validation passed; record=false, so no writes: no status write, no fingerprint, no ledger Decision, and no move.\n`,
        );
        return;
      }

      applyChangeBundle(projectRoot, changeId, applyOptions);
      const relative = path
        .join(ARTIFACT_DIR, "changes", "archive", changeId)
        .replaceAll(path.sep, "/");
      process.stdout.write(`${relative}\n`);
    }, "Unable to apply the change bundle. Check the change id and run again.");
  },
});

if (import.meta.main) {
  await runMain(applyCommand as CommandDef);
}
