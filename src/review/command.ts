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
      const result = runReview(projectRoot, { changeId });
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
