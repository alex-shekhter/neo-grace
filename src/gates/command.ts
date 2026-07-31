/**
 * ngrace gate <approve|apply|archive> — evaluate and record; never author status (A29.2).
 */

import { defineCommand } from "citty";

import { evaluateGate, evaluationToDecision, type GateEvaluation } from "./core";
import { recordGateDecision } from "./ledger";
import type { GateId } from "./ledger";
import { GraceCommandError, runGraceCommand } from "../query/errors";

function parseGate(value: unknown): GateId {
  const gate = String(value ?? "");
  if (gate !== "approve" && gate !== "apply" && gate !== "archive") {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported gate \`${gate}\`. Use approve, apply, or archive.`,
    );
  }
  return gate;
}

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
      recordGateDecision(projectRoot, changeId, decision);
    }
  }
  return evaluation;
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
        if (evaluation.decision === "refuse") {
          process.exitCode = 1;
        }
      }, `gate ${gate} failed`);
    },
  });
}

export const gateCommand = defineCommand({
  meta: {
    name: "gate",
    description:
      "Evaluate transition gates (approve / apply / archive). Records Decisions in run-ledger.xml; never authors status or archives bundles.",
  },
  subCommands: {
    approve: gateSubCommand("approve"),
    apply: gateSubCommand("apply"),
    archive: gateSubCommand("archive"),
  },
  async run() {
    console.log(`Usage: ngrace gate <approve|apply|archive> --change C-ID [--path .] [--format text|json] [--record]
Evaluates required evidence, appends a Decision to run-ledger.xml, and exits 1 when refused.
Does not set status=applied and does not move bundles (invariant 8).`);
  },
});

// silence unused in case of tree-shaking tooling
void parseGate;
