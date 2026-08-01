// START_MODULE_CONTRACT
//   PURPOSE: Transition gate surface
//   SCOPE: Approve, apply, archive evaluation and ledger decisions
//   DEPENDS: none
//   LINKS: M-GATES
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   formatGateEvaluation
//   gateCommand
// END_MODULE_MAP
/**
 * ngrace gate <approve|apply|archive|verdict> — evaluate/record; never author status (A29.2, A31.1).
 */

import { defineCommand } from "citty";

import { evaluateGate, evaluationToDecision, type GateEvaluation } from "./core";
import {
  recordGateDecision,
  recordReviewVerdict,
  type GateId,
  type ReviewVerdictOutcome,
} from "./ledger";
import { GraceCommandError, runGraceCommand } from "../query/errors";

const GATE_SUBCOMMANDS = new Set(["approve", "apply", "archive", "verdict"]);

export function formatGateEvaluation(evaluation: GateEvaluation): string {
  const lines = [
    `Gate: ${evaluation.gate}`,
    `Change: ${evaluation.changeId}`,
    `Decision: ${evaluation.decision}`,
  ];
  if (evaluation.verdict) {
    lines.push(
      `Verdict: ${evaluation.verdict.outcome}${
        evaluation.verdict.reason ? ` (${evaluation.verdict.reason})` : ""
      }`,
    );
  }
  if (evaluation.requirements.length > 0) {
    lines.push("Requirements:");
    for (const req of evaluation.requirements) {
      lines.push(
        `  - ${req.id}: required=${req.required} present=${req.present} blocking=${req.blocking}`
          + (req.message ? ` — ${req.message}` : ""),
      );
    }
  }
  if (evaluation.issues.length > 0) {
    lines.push("Issues:");
    for (const issue of evaluation.issues) {
      lines.push(`  - [${issue.severity}] ${issue.code} — ${issue.message}`);
    }
  }
  // A31.5: report the evaluation even when recording failed.
  if (evaluation.recordingError) {
    lines.push(`Recording: failed — ${evaluation.recordingError}`);
  }
  return lines.join("\n");
}

function runGate(
  projectRoot: string,
  changeId: string,
  gate: GateId,
  options: { record?: boolean; format?: "text" | "json" },
): GateEvaluation {
  const evaluation = evaluateGate(projectRoot, changeId, gate);
  if (options.record !== false) {
    const decision = evaluationToDecision(evaluation);
    if (decision) {
      try {
        recordGateDecision(projectRoot, changeId, decision);
      } catch (error) {
        // A31.5: a recording failure must not suppress the evaluation the caller asked for.
        const message =
          error instanceof Error ? error.message : "unknown recording failure";
        evaluation.recordingError = message;
      }
    }
  }
  return evaluation;
}

function parseOutcome(value: unknown): ReviewVerdictOutcome {
  const outcome = String(value ?? "");
  if (outcome !== "pass" && outcome !== "fail" && outcome !== "unable-to-determine") {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported verdict outcome \`${outcome}\`. Use pass, fail, or unable-to-determine.`,
    );
  }
  return outcome;
}

function gateSubCommand(gate: GateId) {
  return defineCommand({
    meta: {
      name: gate,
      description: `Evaluate the ${gate} transition gate and record the decision (does not change status).`,
    },
    args: {
      change: {
        type: "string",
        description: "Change bundle id (C-*)",
        required: true,
      },
      path: {
        type: "string",
        description: "Project root",
        default: ".",
      },
      format: {
        type: "string",
        description: "text or json",
        default: "text",
      },
      record: {
        type: "boolean",
        description: "Append the decision to run-ledger.xml Decisions (default true)",
        default: true,
      },
    },
    async run(context) {
      const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
      await runGraceCommand(format, async () => {
        const changeId = String(context.args.change);
        const projectRoot = String(context.args.path ?? ".");
        const record = context.args.record !== false;
        const evaluation = runGate(projectRoot, changeId, gate, { record, format });
        if (format === "json") {
          console.log(JSON.stringify({ schemaVersion: "1.0.0", ok: true, ...evaluation }, null, 2));
        } else {
          console.log(formatGateEvaluation(evaluation));
        }
        if (evaluation.decision === "refuse" || evaluation.recordingError) {
          process.exitCode = 1;
        }
      }, `gate ${gate} failed`);
    },
  });
}

const verdictSubCommand = defineCommand({
  meta: {
    name: "verdict",
    description:
      "Record a review verdict in run-ledger.xml Verdicts (A31.1). Does not form the judgment and does not change status.",
  },
  args: {
    change: {
      type: "string",
      description: "Change bundle id (C-*)",
      required: true,
    },
    outcome: {
      type: "string",
      description: "pass | fail | unable-to-determine",
      required: true,
    },
    reason: {
      type: "string",
      description: "Absence reason when outcome is unable-to-determine (e.g. host-capability-missing)",
    },
    note: {
      type: "string",
      description: "Optional free-text note stored as Verdict body text",
    },
    path: {
      type: "string",
      description: "Project root",
      default: ".",
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
      const changeId = String(context.args.change);
      const projectRoot = String(context.args.path ?? ".");
      const outcome = parseOutcome(context.args.outcome);
      const reason =
        context.args.reason !== undefined && context.args.reason !== null
          ? String(context.args.reason)
          : undefined;
      const note =
        context.args.note !== undefined && context.args.note !== null
          ? String(context.args.note)
          : undefined;
      const verdict = recordReviewVerdict(projectRoot, changeId, {
        outcome,
        reason: reason || undefined,
        note: note || undefined,
      });
      if (format === "json") {
        console.log(
          JSON.stringify(
            {
              schemaVersion: "1.0.0",
              ok: true,
              changeId,
              recorded: "verdict",
              verdict,
            },
            null,
            2,
          ),
        );
      } else {
        const reasonPart = verdict.reason ? ` reason=${verdict.reason}` : "";
        console.log(
          `Recorded verdict for ${changeId}: outcome=${verdict.outcome}${reasonPart}`,
        );
      }
    }, "gate verdict failed");
  },
});

export const gateCommand = defineCommand({
  meta: {
    name: "gate",
    description:
      "Evaluate transition gates (approve / apply / archive) or record a review verdict. Records in run-ledger.xml; never authors status or archives bundles.",
  },
  subCommands: {
    approve: gateSubCommand("approve"),
    apply: gateSubCommand("apply"),
    archive: gateSubCommand("archive"),
    verdict: verdictSubCommand,
  },
  // A31.4: citty runs the parent after every subcommand — only print usage when none ran.
  async run(context) {
    const firstPositional = context.rawArgs.find((arg) => !arg.startsWith("-"));
    if (firstPositional && GATE_SUBCOMMANDS.has(firstPositional)) {
      return;
    }
    console.log(
      `Usage: ngrace gate <approve|apply|archive|verdict> --change C-ID [options]
  approve|apply|archive  Evaluate and record a Decision (exits 1 when refused).
  verdict                Record a review Verdict (--outcome pass|fail|unable-to-determine).
Does not set status=applied and does not move bundles (invariant 8).`,
    );
  },
});
