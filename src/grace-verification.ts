// START_MODULE_CONTRACT
//   PURPOSE: Failure localization
//   SCOPE: Marker divergence comparison and verification localize CLI
//   DEPENDS: none
//   LINKS: M-LOCALIZE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   verificationCommand
// END_MODULE_MAP
import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";

import { findVerifications, loadGraceArtifactIndex, resolveVerification } from "./query/core";
import { defineGraceCommand } from "./query/command";
import { GraceCommandError, runQueryCommand } from "./query/errors";
import { formatVerificationFindTable, formatVerificationText } from "./query/render";
import type { GraceArtifactIndex } from "./query/types";
import {
  flakePairFromChange,
  formatLocalizationText,
  loadReviewJsonFindings,
  localizeFailure,
  type FlakePair,
  type ProcessContextFinding,
} from "./verification/localize";

/** Loads projection-backed index or throws a user-facing command error. */
function loadNgraceIndexOrThrow(root: string): GraceArtifactIndex {
  return loadGraceArtifactIndex(root);
}

function resolveFormat(format: unknown, json: unknown, allowed: string[], defaultFormat: string) {
  const resolved = Boolean(json) ? "json" : String(format ?? defaultFormat);
  if (!allowed.includes(resolved)) {
    throw new GraceCommandError("invalid-arguments", `Unsupported format \`${resolved}\`. Use ${allowed.map((value) => `\`${value}\``).join(" or ")}.`);
  }

  return resolved;
}

/**
 * Read log for localization (A42.1): --log <file>, or stdin only via explicit --log -.
 * No TTY sniffing — keeps "no log" distinct from "empty log".
 */
function readLocalizeLog(logArg: string | undefined): { text: string } | { absenceReason: string } {
  if (logArg === undefined || logArg === null || String(logArg).trim() === "") {
    return {
      absenceReason:
        "no log supplied; pass --log <file> or --log - (stdin). Localization never invents an observed sequence from source text",
    };
  }
  const value = String(logArg);
  if (value === "-") {
    try {
      const text = readFileSync(0, "utf8");
      return { text };
    } catch (error) {
      return {
        absenceReason: `stdin unreadable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (!existsSync(value)) {
    return { absenceReason: `log file not found: ${value}` };
  }
  try {
    return { text: readFileSync(value, "utf8") };
  } catch (error) {
    return {
      absenceReason: `log file unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const verificationCommand = defineGraceCommand({
  meta: {
    name: "verification",
    description:
      "Query neo-grace verification entries, scenarios, evidence requirements, and failure localization.",
  },
  subCommands: {
    find: defineCommand({
      meta: {
        name: "find",
        description: "Find verification entries by id, module, priority, scenarios, markers, or commands.",
      },
      args: {
        query: {
          type: "positional",
          required: false,
          description: "Search query",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        module: {
          type: "string",
          description: "Filter by module id or module name fragment",
        },
        priority: {
          type: "string",
          description: "Filter by verification priority",
        },
        format: {
          type: "string",
          alias: "f",
          description: "Output format: table or json",
          default: "table",
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
          const format = resolveFormat(context.args.format, context.args.json, ["table", "json"], "table");
          const index = loadNgraceIndexOrThrow(String(context.args.path ?? "."));
          const matches = findVerifications(index, {
            query: context.args.query ? String(context.args.query) : undefined,
            module: context.args.module ? String(context.args.module) : undefined,
            priority: context.args.priority ? String(context.args.priority) : undefined,
          });
          process.stdout.write(format === "json" ? `${JSON.stringify(matches, null, 2)}\n` : `${formatVerificationFindTable(matches)}\n`);
        });
      },
    }),
    show: defineCommand({
      meta: {
        name: "show",
        description: "Show one verification entry by V-M id or module target.",
      },
      args: {
        target: {
          type: "positional",
          required: false,
          description: "Verification id or module target",
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
          const format = resolveFormat(context.args.format, context.args.json, ["text", "json"], "text");
          const index = loadNgraceIndexOrThrow(String(context.args.path ?? "."));
          const match = resolveVerification(index, context.args.target == null ? "" : String(context.args.target));
          process.stdout.write(format === "json" ? `${JSON.stringify(match, null, 2)}\n` : `${formatVerificationText(match)}\n`);
        });
      },
    }),
    localize: defineCommand({
      meta: {
        name: "localize",
        description:
          "Localize a verification failure: first divergent marker block vs a caller-supplied log "
          + "(D8). Read-only; never runs tests (route 1 deferred). Does not write status or verdicts.",
      },
      args: {
        target: {
          type: "positional",
          required: false,
          description: "Verification id (V-M-*) or module target",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        log: {
          type: "string",
          description: "Path to run log, or - for stdin (required for an observed sequence)",
        },
        "review-json": {
          type: "string",
          description:
            "Optional path to ngrace review --format json output; only D8-named process-audit codes "
            + "appear as secondary context",
        },
        "test-file": {
          type: "string",
          description: "Optional failing test path for module join when not implied by the V-M-* entry",
        },
        change: {
          type: "string",
          description:
            "Optional C-* change id: load fail→pass attempt write evidence from the durable ledger "
            + "(ledger∪loose) for flake classification (A43.3). Absent → no flake field.",
        },
        task: {
          type: "string",
          description: "Optional T-* task id to scope flake pair search when --change is set",
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
          const format = resolveFormat(context.args.format, context.args.json, ["text", "json"], "text");
          const projectRoot = String(context.args.path ?? ".");
          const index = loadNgraceIndexOrThrow(projectRoot);
          const match = resolveVerification(
            index,
            context.args.target == null ? "" : String(context.args.target),
          );
          const verification = match.verification;
          const module = match.module ?? undefined;

          const logResult = readLocalizeLog(
            context.args.log === undefined || context.args.log === null
              ? undefined
              : String(context.args.log),
          );

          let reviewFindings: ProcessContextFinding[] | undefined;
          const reviewJsonPath = context.args["review-json"];
          if (reviewJsonPath !== undefined && reviewJsonPath !== null && String(reviewJsonPath).trim() !== "") {
            const loaded = loadReviewJsonFindings(String(reviewJsonPath));
            if ("absence" in loaded) {
              throw new GraceCommandError("invalid-arguments", loaded.absence.reason);
            }
            reviewFindings = loaded;
          }

          let flakePair: FlakePair | undefined;
          let flakeLoadAbsence: string | undefined;
          const changeId =
            context.args.change !== undefined && context.args.change !== null
              ? String(context.args.change).trim()
              : "";
          if (changeId) {
            const taskArg =
              context.args.task !== undefined && context.args.task !== null
                ? String(context.args.task).trim()
                : undefined;
            const loaded = flakePairFromChange(projectRoot, changeId, taskArg || undefined);
            if ("absence" in loaded) {
              flakeLoadAbsence = loaded.absence.reason;
            } else {
              flakePair = loaded;
            }
          }

          const result = localizeFailure({
            index,
            verification,
            module,
            logText: "text" in logResult ? logResult.text : null,
            logAbsenceReason: "absenceReason" in logResult ? logResult.absenceReason : undefined,
            testFile:
              context.args["test-file"] !== undefined && context.args["test-file"] !== null
                ? String(context.args["test-file"])
                : undefined,
            reviewFindings,
            flakePair,
          });

          // When --change was given but no pair found, report flake as unable-to-determine
          // (producer was asked; answer is absence of pair — not silent omission of the ask).
          if (flakeLoadAbsence && !result.flake) {
            result.flake = {
              verdict: "unable-to-determine",
              reason: flakeLoadAbsence,
            };
          }

          if (format === "json") {
            process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
          } else {
            process.stdout.write(formatLocalizationText(result));
          }
        });
      },
    }),
  },
});
