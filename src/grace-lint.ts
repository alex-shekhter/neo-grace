#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Lint orchestration and language adapters
//   SCOPE: Project load, governed-file analysis, adapters, and scanners
//   DEPENDS: none
//   LINKS: M-LINT-CORE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   GraceLintConfig
//   LanguageAdapter
//   LanguageAnalysis
//   LintAssertionMode
//   LintIssue
//   LintOptions
//   LintProfile
//   LintResult
//   LintSeverity
//   MapMode
//   ModuleRole
//   formatTextReport
//   lintCommand
//   lintGraceProject
// END_MODULE_MAP

import { defineCommand, type CommandDef, runMain } from "citty";

import { defineGraceCommand } from "./query/command";

import { existsSync } from "node:fs";
import path from "node:path";

import { GRAMMAR_INVENTORIES } from "./artifact/grammar";
import { ARTIFACT_DIR } from "./artifact/paths";
import { isRegisteredSchemaShape, renderSchemaShape, SCHEMA_SHAPE_REGISTRY } from "./artifact/schema-reference";
import { ANCHOR_PATTERNS, CHANGE_STATUSES } from "./artifact/types";
import { classifyIssueCode, formatLintExplanation, getLintIssueGuide } from "./lint/catalog";
import { formatTextReport, isValidTextFormat, lintGraceProject } from "./lint/core";
import type { LintAssertionMode, LintOptions, LintProfile, LintResult } from "./lint/types";
import { GraceCommandError, runGraceCommand } from "./query/errors";

export type {
  GraceLintConfig,
  LanguageAdapter,
  LanguageAnalysis,
  LintIssue,
  LintAssertionMode,
  LintOptions,
  LintProfile,
  LintResult,
  LintSeverity,
  MapMode,
  ModuleRole,
} from "./lint/types";

export { formatTextReport, lintGraceProject } from "./lint/core";

function writeResult(format: string, result: LintResult) {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatTextReport(result)}\n`);
}

function resolveProfile(value: unknown): LintProfile {
  const profile = String(value ?? "standard");
  if (profile !== "standard") {
    throw new GraceCommandError("invalid-arguments", `Unsupported profile \`${profile}\`. Use \`standard\`.`);
  }

  return "standard";
}

function resolveFailOn(value: unknown) {
  const failOn = String(value ?? "errors");
  if (failOn !== "errors" && failOn !== "warnings" && failOn !== "never") {
    throw new GraceCommandError("invalid-arguments", `Unsupported fail-on policy \`${failOn}\`. Use \`errors\`, \`warnings\`, or \`never\`.`);
  }

  return failOn;
}

function resolveAssertionMode(value: unknown): LintAssertionMode {
  const mode = String(value ?? "current");
  if (mode !== "current" && mode !== "baseline" && mode !== "target" && mode !== "final") {
    throw new GraceCommandError("invalid-arguments", `Unsupported assertion mode \`${mode}\`. Use \`current\`, \`baseline\`, \`target\`, or \`final\`.`);
  }
  return mode;
}

const LINT_ASSERTION_MODES = new Set<string>(["current", "baseline", "target", "final"]);

function resolveAsStatus(value: unknown): string {
  const status = String(value);
  if ((CHANGE_STATUSES as readonly string[]).includes(status)) {
    return status;
  }
  if (LINT_ASSERTION_MODES.has(status)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported as status \`${status}\`. That token is an assertions mode. Use argv token as with a change status (${CHANGE_STATUSES.join(", ")}).`,
    );
  }
  if (GRAMMAR_INVENTORIES.GATE_DECISION_GATES.has(status)) {
    throw new GraceCommandError(
      "invalid-arguments",
      `Unsupported as status \`${status}\`. That token is a gate verb. Use argv token as with a ChangeStatus (${CHANGE_STATUSES.join(", ")}).`,
    );
  }
  throw new GraceCommandError(
    "invalid-arguments",
    `Unsupported as status \`${status}\`. Use ${CHANGE_STATUSES.join(", ")}.`,
  );
}

function resolveAsChangeId(projectRoot: string, changeValue: unknown): string {
  if (changeValue === undefined || changeValue === null || String(changeValue).trim() === "") {
    throw new GraceCommandError("invalid-arguments", "argv token as requires argv token change naming a C-* bundle.");
  }
  const changeId = String(changeValue);
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    throw new GraceCommandError("invalid-arguments", `Selected change '${changeId}' must be a canonical C-* identifier.`);
  }
  const root = path.resolve(projectRoot);
  const activeSpec = path.join(root, ARTIFACT_DIR, "changes", "active", changeId, "spec.xml");
  const archiveSpec = path.join(root, ARTIFACT_DIR, "changes", "archive", changeId, "spec.xml");
  if (!existsSync(activeSpec) && !existsSync(archiveSpec)) {
    throw new GraceCommandError("not-found", `Change ${changeId} was not found under active or archive.`);
  }
  return changeId;
}

function shouldFail(result: LintResult, failOn: string) {
  if (failOn === "never") {
    return false;
  }

  if (failOn === "warnings") {
    return result.summary.issues > 0;
  }

  return result.summary.errors > 0;
}

export const lintCommand = defineGraceCommand({
  meta: {
    name: "lint",
    description: "Lint neo-grace artifacts, XML tag conventions, semantic markup, and role-aware module maps.",
  },
  args: {
    path: {
      type: "string",
      alias: "p",
      description: "Project root to lint",
      default: ".",
    },
    format: {
      type: "string",
      alias: "f",
      description: "Output format: text or json",
      default: "text",
    },
    profile: {
      type: "string",
      description: "Lint profile (currently only \`standard\` is supported)",
      default: "standard",
    },
    explain: {
      type: "string",
      description: "Explain one lint issue code instead of linting a project",
    },
    remediate: {
      type: "boolean",
      description: "Include explanation and remediation hints in text output",
      default: false,
    },
    failOn: {
      type: "string",
      description: "Exit policy: errors, warnings, or never",
      default: "errors",
    },
    change: {
      type: "string",
      description: "Active C-* bundle selected for baseline or target assertion evaluation",
    },
    assertions: {
      type: "string",
      description: "Assertion mode: current (pre-write active baselines), baseline, target, or final",
      default: "current",
    },
    runCommands: {
      type: "boolean",
      description: "Execute MustPassCommand assertions for the selected change",
      default: false,
    },
    parallelPreflight: {
      type: "boolean",
      description: "Treat active-plan scope overlap as a parallel-execution blocker",
      default: false,
    },
    as: {
      type: "string",
      description: "Preview artifact-pure rules as if the selected change carried this lifecycle status",
    },
  },
  async run(context) {
    const errorFormat = context.args.format === "json" ? "json" : "text";
    await runGraceCommand(errorFormat, () => {
      const format = String(context.args.format ?? "text");
      const profile = resolveProfile(context.args.profile);
      const failOn = resolveFailOn(context.args.failOn);
      const assertionMode = resolveAssertionMode(context.args.assertions);
      if (!isValidTextFormat(format)) {
        throw new GraceCommandError("invalid-arguments", `Unsupported format \`${format}\`. Use \`text\` or \`json\`.`);
      }

      if (context.args.as !== undefined) {
        if (context.args.explain) {
          throw new GraceCommandError("invalid-arguments", "argv token as cannot be combined with argv token explain.");
        }
        if (Boolean(context.args.runCommands)) {
          throw new GraceCommandError("invalid-arguments", "argv token as cannot be combined with argv token runCommands.");
        }
        if (assertionMode !== "current") {
          throw new GraceCommandError(
            "invalid-arguments",
            "argv token as cannot be combined with argv token assertions other than current.",
          );
        }
      }

      if (context.args.explain) {
        const code = String(context.args.explain);
        if (isRegisteredSchemaShape(code)) {
          if (format === "json") {
            process.stdout.write(
              `${JSON.stringify({ kind: "shape", shape: code, body: renderSchemaShape(code) }, null, 2)}\n`,
            );
          } else {
            process.stdout.write(`Shape reference: ${code}\n${renderSchemaShape(code)}\n`);
          }
          process.exitCode = 0;
          return;
        }
        if (!code.includes(".")) {
          const registered = Object.keys(SCHEMA_SHAPE_REGISTRY);
          if (format === "json") {
            process.stdout.write(
              `${JSON.stringify({ kind: "unknown-shape", token: code, registered }, null, 2)}\n`,
            );
          } else {
            process.stdout.write(`Unknown shape: ${code}\n\nRegistered shapes: ${registered.join(", ")}.\n`);
          }
          process.exitCode = 1;
          return;
        }
        const classification = classifyIssueCode(code);
        const guide = getLintIssueGuide(code);
        if (format === "json") {
          process.stdout.write(
            `${JSON.stringify({ schemaVersion: "1.0.0", tool: "grace-lint", classification, guide }, null, 2)}\n`,
          );
        } else {
          process.stdout.write(`${formatLintExplanation(code)}\n`);
        }
        // Unknown codes: exit non-zero so recovery docs and scripts cannot treat fiction as success (A76 / 189).
        process.exitCode = classification === "unknown" ? 1 : 0;
        return;
      }

      const projectRoot = String(context.args.path ?? ".");
      const asStatus = context.args.as !== undefined ? resolveAsStatus(context.args.as) : undefined;
      const asChangeId = asStatus !== undefined ? resolveAsChangeId(projectRoot, context.args.change) : undefined;
      const result = lintGraceProject(projectRoot, {
        profile,
        assertionMode,
        changeId: asChangeId ?? (context.args.change ? String(context.args.change) : undefined),
        runCommands: Boolean(context.args.runCommands),
        parallelPreflight: Boolean(context.args.parallelPreflight),
        asStatus,
      });

      if (format === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatTextReport(result, { remediate: Boolean(context.args.remediate) })}\n`);
      }
      process.exitCode = shouldFail(result, failOn) ? 1 : 0;
    }, "Unable to complete GRACE lint. Check the project path and run again.");
  },
});

if (import.meta.main) {
  await runMain(lintCommand as CommandDef);
}
