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
import { ANCHOR_PATTERNS, nextBundleLineage, parseBundleId } from "./artifact/types";
import { mintBundle } from "./grace-generate";
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

/** The replacement must be the predecessor's lineage successor: same slug, next lineage (D38). */
function requireLineageSuccessor(changeId: string, replacementId: string): void {
  const predecessor = parseBundleId(changeId);
  const successor = parseBundleId(replacementId);
  if (successor.slug !== predecessor.slug || successor.lineage !== nextBundleLineage(changeId)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Replacement ${replacementId} is not the lineage successor of ${changeId} (same slug, lineage ${nextBundleLineage(changeId)}).`,
    );
  }
}

export const supersedeCommand = defineGraceCommand({
  meta: {
    name: "supersede",
    description:
      "Write superseded onto an active change bundle, name its replacement, and move it into archive. The verb folds any open epoch (no-op when none exists). Discards governance, never code.",
  },
  args: {
    change: {
      type: "string",
      description: "Active C-* bundle being abandoned",
      required: true,
    },
    replacement: {
      type: "string",
      description: "Lineage successor C-*; omitted, the verb mints it",
    },
    timestamp: {
      type: "string",
      description: "ISO 8601 timestamp for the minted successor (or NGRACE_SPEC_TIMESTAMP)",
    },
    branch: {
      type: "string",
      description: "Branch name for the minted successor (or NGRACE_SPEC_BRANCH / git HEAD)",
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
      const rawReplacement = String(context.args.replacement ?? "").trim();
      let replacementId: string;
      if (rawReplacement !== "") {
        replacementId = requireChangeId(rawReplacement, "Replacement id");
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
        requireLineageSuccessor(changeId, replacementId);
      } else {
        const minted = mintBundle(projectRoot, {
          supersedes: changeId,
          timestamp: context.args.timestamp,
          branch: context.args.branch,
        });
        replacementId = minted.id;
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
