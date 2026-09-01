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
 * ngrace gate <approve|apply|archive|verdict> — evaluate and record.
 * Approve writes draft to approved and fingerprints those bytes; apply, archive, and verdict do not write status (A29.2, A31.1).
 */

import { defineCommand } from "citty";

import { evaluateGate, evaluationToDecision, type GateEvaluation } from "./core";
import {
  computeVerdictSnapshotDigest,
  parseResolutionClassification,
  parseReviewVerdictScope,
  recordGateDecision,
  recordReviewVerdict,
  stampApproveArtifact,
  type GateId,
  type ReviewVerdictOutcome,
  type ReviewVerdictRecord,
  type VerdictFindingRecord,
} from "./ledger";
import { defineGraceCommand } from "../query/command";
import { GraceCommandError, runGraceCommand } from "../query/errors";
import { runReview } from "../review/core";
import { computeConstituentTasksPassed } from "../review/outcomes";

const GATE_SUBCOMMANDS = new Set(["approve", "apply", "archive", "verdict"]);

function collectAckFindingArgs(rawArgs: string[], parsed: unknown): string[] {
  const fromRaw: string[] = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i]!;
    if (token === "--ack-finding") {
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        fromRaw.push(next);
        i += 1;
      }
      continue;
    }
    if (token.startsWith("--ack-finding=")) {
      fromRaw.push(token.slice("--ack-finding=".length));
    }
  }
  if (fromRaw.length > 0) return fromRaw;
  if (Array.isArray(parsed)) {
    return parsed.map((value) => String(value).trim()).filter((value) => value !== "");
  }
  if (parsed === undefined || parsed === null) return [];
  const text = String(parsed).trim();
  return text ? [text] : [];
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
  // A31.5: report the evaluation even when recording failed.
  if (evaluation.recordingError) {
    lines.push(`Recording: failed — ${evaluation.recordingError}`);
  }
  return lines.join("\n");
}

function observeHeadObjectName(projectRoot: string): string | undefined {
  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  const name = new TextDecoder().decode(result.stdout).trim();
  return name || undefined;
}

function runGate(
  projectRoot: string,
  changeId: string,
  gate: GateId,
  options: {
    record?: boolean;
    format?: "text" | "json";
    force?: boolean;
    reason?: string;
    artifact?: "spec" | "plan";
  },
): GateEvaluation {
  const evaluation = evaluateGate(projectRoot, changeId, gate);
  if (gate === "approve" && options.force) {
    if (evaluation.decision === "refuse") {
      evaluation.decision = "permit";
    }
  }
  if (options.record !== false) {
    const decision = evaluationToDecision(evaluation);
    if (decision) {
      try {
        if (gate === "approve" && decision.decision === "permit") {
          const observed = observeHeadObjectName(projectRoot);
          if (observed) decision.baseCommit = observed;
          if (options.force) {
            decision.forced = true;
            decision.reason = (options.reason ?? "").trim();
          }
          const stamped = stampApproveArtifact(projectRoot, changeId, options.artifact);
          decision.artifact = stamped.artifact;
          decision.fingerprint = stamped.fingerprint;
        }
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

const GATE_SHARED_ARGS = {
  change: {
    type: "string" as const,
    description: "Change bundle id (C-*)",
    required: true,
  },
  path: {
    type: "string" as const,
    description: "Project root",
    default: ".",
  },
  format: {
    type: "string" as const,
    description: "text or json",
    default: "text",
  },
  record: {
    type: "boolean" as const,
    description: "Append the decision to run-ledger.xml Decisions (default true)",
    default: true,
  },
};

function parseArtifactArg(value: unknown): "spec" | "plan" | undefined {
  if (value === undefined || value === "") return undefined;
  const token = String(value);
  if (token === "spec" || token === "plan") return token;
  throw new GraceCommandError(
    "invalid-arguments",
    `Unsupported artifact \`${token}\`. Use spec or plan.`,
  );
}

function printGateEvaluation(evaluation: GateEvaluation, format: "text" | "json"): void {
  if (format === "json") {
    console.log(JSON.stringify({ schemaVersion: "1.0.0", ok: true, ...evaluation }, null, 2));
  } else {
    console.log(formatGateEvaluation(evaluation));
  }
  if (evaluation.decision === "refuse" || evaluation.recordingError) {
    process.exitCode = 1;
  }
}

function gateSubCommand(gate: GateId, description?: string) {
  // defineGraceCommand: refuse --record true|false space form before any ledger write (F18).
  return defineGraceCommand({
    meta: {
      name: gate,
      description:
        description
        ?? `Evaluate the ${gate} transition gate and record the decision (does not change status).`,
    },
    args: GATE_SHARED_ARGS,
    async run(context) {
      const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
      await runGraceCommand(format, async () => {
        const changeId = String(context.args.change);
        const projectRoot = String(context.args.path ?? ".");
        const record = context.args.record !== false;
        const evaluation = runGate(projectRoot, changeId, gate, { record, format });
        printGateEvaluation(evaluation, format);
      }, `gate ${gate} failed`);
    },
  });
}

function approveSubCommand() {
  return defineGraceCommand({
    meta: {
      name: "approve",
      description:
        "Evaluate the approve gate, write draft to approved on the targeted spec or plan, and record a fingerprint of those bytes.",
    },
    args: {
      ...GATE_SHARED_ARGS,
      force: {
        type: "boolean" as const,
        description: "Record a clarification refuse as a forced permit when reason is non-empty",
        default: false,
      },
      reason: {
        type: "string" as const,
        description: "Required with force; stored on that forced permit",
      },
      artifact: {
        type: "string" as const,
        description: "spec or plan; overrides default target order",
      },
    },
    async run(context) {
      const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
      await runGraceCommand(format, async () => {
        const force = context.args.force === true;
        const reason = String(context.args.reason ?? "").trim();
        if (force && !reason) {
          throw new GraceCommandError(
            "invalid-arguments",
            "argv token force requires a non-empty argv token reason",
          );
        }
        const artifact = parseArtifactArg(context.args.artifact);
        const changeId = String(context.args.change);
        const projectRoot = String(context.args.path ?? ".");
        const record = context.args.record !== false;
        const evaluation = runGate(projectRoot, changeId, "approve", {
          record,
          format,
          force,
          reason: force ? reason : undefined,
          artifact,
        });
        printGateEvaluation(evaluation, format);
      }, "gate approve failed");
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
    scope: {
      type: "string",
      description:
        "Optional D10 review scope: task | wave | bundle. Omitted verdicts read as scope-not-recorded (never defaulted).",
    },
    task: {
      type: "string",
      description: "Optional task id when --scope task",
    },
    wave: {
      type: "string",
      description: "Optional wave id when --scope wave (also used for constituentTasksPassed)",
    },
    classification: {
      type: "string",
      description:
        "Optional resolution classification stored at write: implementation | plan (rule 13). Code-only must be explicit — never a silent residual.",
    },
    "constituent-tasks-passed": {
      type: "string",
      description:
        "Optional true|false for wave-scoped fail. When omitted on wave+fail, computed from ledger and stored (or absence reason).",
    },
    "ack-finding": {
      type: "string",
      description:
        "Repeatable findingId to Ack for outcome pass. Required once per displayed finding. Omit when the displayed set is empty.",
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
      const scopeRaw =
        context.args.scope !== undefined && context.args.scope !== null
          ? String(context.args.scope).trim()
          : "";
      const scope = scopeRaw ? parseReviewVerdictScope(scopeRaw) : undefined;
      const task =
        context.args.task !== undefined && context.args.task !== null
          ? String(context.args.task).trim() || undefined
          : undefined;
      const wave =
        context.args.wave !== undefined && context.args.wave !== null
          ? String(context.args.wave).trim() || undefined
          : undefined;
      const classRaw =
        context.args.classification !== undefined && context.args.classification !== null
          ? String(context.args.classification).trim()
          : "";
      const classification = classRaw ? parseResolutionClassification(classRaw) : undefined;

      const displayed = runReview(projectRoot, { changeId }).findings;
      const findings: VerdictFindingRecord[] = displayed.map((finding) => ({
        code: finding.code,
        file: finding.file,
        findingId: finding.findingId,
        severity: finding.severity,
        ruleId: finding.ruleId,
        anchorOrHunkKey: finding.anchorOrHunkKey,
        message: finding.message,
      }));
      const payload: ReviewVerdictRecord = {
        outcome,
        reason: reason || undefined,
        note: note || undefined,
        scope,
        task,
        wave,
        classification,
        findings,
        snapshotDigest: computeVerdictSnapshotDigest(changeId, findings),
      };
      if (outcome === "pass") {
        payload.acks = collectAckFindingArgs(context.rawArgs, context.args["ack-finding"]).map((findingId) => ({
          findingId,
          snapshotDigest: payload.snapshotDigest!,
        }));
      }

      const ctpArgPresent =
        context.args["constituent-tasks-passed"] !== undefined &&
        context.args["constituent-tasks-passed"] !== null &&
        String(context.args["constituent-tasks-passed"]).trim() !== "";
      const ctpRaw = ctpArgPresent
        ? String(context.args["constituent-tasks-passed"]).trim()
        : "";

      // Corr 184: never silently ignore --constituent-tasks-passed outside wave+fail.
      if (ctpArgPresent && !(scope === "wave" && outcome === "fail")) {
        throw new GraceCommandError(
          "invalid-arguments",
          "constituentTasksPassed applies only to wave-scoped fail verdicts",
        );
      }

      if (scope === "wave" && outcome === "fail") {
        if (ctpRaw === "true" || ctpRaw === "false") {
          payload.constituentTasksPassed = ctpRaw === "true";
        } else if (wave) {
          const computed = computeConstituentTasksPassed(projectRoot, changeId, wave);
          if (computed.value === true || computed.value === false) {
            payload.constituentTasksPassed = computed.value;
          } else {
            payload.constituentTasksPassedReason = computed.reason;
          }
        } else {
          payload.constituentTasksPassedReason =
            "wave-scoped fail without --wave — tasks-unverifiable";
        }
      }

      const verdict = recordReviewVerdict(projectRoot, changeId, payload);
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
        const parts = [`outcome=${verdict.outcome}`];
        if (verdict.scope) parts.push(`scope=${verdict.scope}`);
        if (verdict.classification) parts.push(`classification=${verdict.classification}`);
        if (verdict.reason) parts.push(`reason=${verdict.reason}`);
        console.log(`Recorded verdict for ${changeId}: ${parts.join(" ")}`);
      }
    }, "gate verdict failed");
  },
});

export const gateCommand = defineGraceCommand({
  meta: {
    name: "gate",
    description:
      "Evaluate transition gates (approve / apply / archive) or record a review verdict. Records in run-ledger.xml. Approve writes draft to approved and fingerprints those bytes; apply, archive, and verdict do not write status or move bundles.",
  },
  subCommands: {
    approve: approveSubCommand(),
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
