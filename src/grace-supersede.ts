#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Top-level ngrace supersede command
//   SCOPE: Register the sanctioned superseded close; delegate writes to the gates ledger
//   DEPENDS: none
//   LINKS: M-CLI
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   supersedeCommand
// END_MODULE_MAP

import { existsSync } from "node:fs";
import path from "node:path";

import { type CommandDef, runMain } from "citty";

import { ARTIFACT_DIR } from "./artifact/paths";
import { ANCHOR_PATTERNS } from "./artifact/types";
import { supersedeChangeBundle } from "./gates/ledger";
import { defineGraceCommand } from "./query/command";
import { GraceCommandError, runGraceCommand } from "./query/errors";

function requireChangeId(raw: unknown, label: string): string {
  const changeId = String(raw ?? "").trim();
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `${label} '${changeId}' does not match the accepted pattern C- then uppercase kebab.`,
    );
  }
  return changeId;
}

function changeLocationDir(projectRoot: string, location: "active" | "archive", changeId: string): string {
  return path.join(projectRoot, ARTIFACT_DIR, "changes", location, changeId);
}

function replacementDirectoryExists(projectRoot: string, replacementId: string): boolean {
  return (
    existsSync(changeLocationDir(projectRoot, "active", replacementId))
    || existsSync(changeLocationDir(projectRoot, "archive", replacementId))
  );
}

export const supersedeCommand = defineGraceCommand({
  meta: {
    name: "supersede",
    description:
      "Write superseded onto an active change bundle, name its replacement, and move it into archive.",
  },
  args: {
    change: {
      type: "string",
      description: "Active C-* bundle being abandoned",
      required: true,
    },
    replacement: {
      type: "string",
      description: "Different already-existing C-* replacement",
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
    await runGraceCommand("text", () => {
      const projectRoot = path.resolve(String(context.args.path ?? "."));
      const changeId = requireChangeId(context.args.change, "Change id");
      const replacementId = requireChangeId(context.args.replacement, "Replacement id");
      if (replacementId === changeId) {
        throw new GraceCommandError(
          "invalid-arguments",
          `Replacement ${replacementId} equals the change being superseded.`,
        );
      }
      if (!replacementDirectoryExists(projectRoot, replacementId)) {
        throw new GraceCommandError(
          "invalid-arguments",
          `Replacement ${replacementId} is missing as a directory under active/ or archive/.`,
        );
      }
      supersedeChangeBundle(projectRoot, changeId, replacementId);
      const relative = path
        .join(ARTIFACT_DIR, "changes", "archive", changeId)
        .replaceAll(path.sep, "/");
      process.stdout.write(`${relative}\n`);
    }, "Unable to supersede the change bundle. Check the change and replacement ids and run again.");
  },
});

if (import.meta.main) {
  await runMain(supersedeCommand as CommandDef);
}
