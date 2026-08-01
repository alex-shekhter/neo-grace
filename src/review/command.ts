// START_MODULE_CONTRACT
//   PURPOSE: Review surface
//   SCOPE: Process audits, pattern detectors, and review.* findings
//   DEPENDS: none
//   LINKS: M-REVIEW
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   reviewCommand
// END_MODULE_MAP
/**
 * ngrace review — run mechanized audits and pattern detectors; never write verdicts (A35.2 corr 81).
 */

import { defineCommand } from "citty";

import { GraceCommandError, runGraceCommand } from "../query/errors";
import { formatReviewResult, runReview } from "./core";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description:
      "Run mechanized review detectors and process audits. Emits deterministic finding IDs. "
      + "Does not record verdicts or change status — use ngrace gate verdict to record.",
  },
  args: {
    path: {
      type: "string",
      description: "Project root",
      default: ".",
    },
    change: {
      type: "string",
      description: "Optional change id (C-*) for ObservedWriteScope-aware process audits",
    },
    base: {
      type: "string",
      description:
        "Git base ref for a three-dot (merge-base) name-only diff of changed files "
        + "(what this branch wrote). Used when --change is set and --changed-files is not.",
    },
    "changed-files": {
      type: "string",
      description:
        "Comma-separated relative paths for the scope audit (caller-owned). "
        + "Present and empty means an explicit empty set. Overrides --base and porcelain.",
    },
    format: {
      type: "string",
      description: "text or json",
      default: "text",
    },
  },
  async run(context) {
    const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
    await runGraceCommand(format, async () => {
      const projectRoot = String(context.args.path ?? ".");
      const changeId =
        context.args.change !== undefined && context.args.change !== null
          ? String(context.args.change)
          : undefined;
      if (changeId && !/^C-[A-Z0-9-]+$/.test(changeId)) {
        throw new GraceCommandError(
          "invalid-arguments",
          `Invalid change id \`${changeId}\`. Expected C-* form.`,
        );
      }

      const rawChanged = context.args["changed-files"];
      const hasChangedFilesFlag = rawChanged !== undefined && rawChanged !== null;
      const baseRaw = context.args.base;
      const hasBase =
        baseRaw !== undefined && baseRaw !== null && String(baseRaw).trim() !== "";

      if (hasChangedFilesFlag && hasBase) {
        throw new GraceCommandError(
          "invalid-arguments",
          "Pass only one of --changed-files or --base (explicit set overrides base when both would apply; CLI refuses both).",
        );
      }

      let changedFiles: string[] | undefined;
      if (hasChangedFilesFlag) {
        // Empty string → caller-supplied empty set (A66 Q5 / state 5).
        const text = String(rawChanged);
        changedFiles = text.trim() === ""
          ? []
          : text.split(",").map((p) => p.trim()).filter((p) => p !== "");
      }

      const baseRef = hasBase ? String(baseRaw).trim() : undefined;

      const result = runReview(projectRoot, {
        changeId,
        changedFiles,
        baseRef,
      });
      if (format === "json") {
        console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      } else {
        console.log(formatReviewResult(result));
      }
      if (result.summary.errors > 0) {
        process.exitCode = 1;
      }
    }, "review failed");
  },
});
