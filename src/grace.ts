#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: CLI entry point
//   SCOPE: Register ngrace subcommands on the process entry and install process-fault handlers
//   DEPENDS: none
//   LINKS: M-CLI
//   ROLE: SCRIPT
//   MAP_MODE: LOCALS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   main
//   reportProcessFault
// END_MODULE_MAP

import { defineCommand, type CommandDef, runMain } from "citty";

import { contextCommand } from "./grace-context";
import { cursorCommand } from "./grace-cursor";
import { doctorCommand } from "./grace-doctor";
import { fileCommand } from "./grace-file";
import { planCommand, scaffoldCommand, specCommand } from "./grace-generate";
import { graphCommand } from "./grace-graph";
import { gateCommand } from "./gates/command";
import { lintCommand } from "./grace-lint";
import { moduleCommand } from "./grace-module";
import { statusCommand } from "./grace-status";
import { verificationCommand } from "./grace-verification";
import { reviewCommand } from "./review/command";
import { ARTIFACT_DIR } from "./artifact/paths";
import { formatCauseChain } from "./query/errors";

const main = defineCommand({
  meta: {
    name: "ngrace",
    version: "6.2.0",
    description: `neo-grace CLI for ${ARTIFACT_DIR} linting, transition gates, run ledger and cursor, mechanized review, task-scoped context slices, status snapshots, module health, verification queries, and semantic markup navigation.`,
  },
  subCommands: {
    context: contextCommand,
    cursor: cursorCommand,
    doctor: doctorCommand,
    file: fileCommand,
    gate: gateCommand,
    graph: graphCommand,
    lint: lintCommand,
    module: moduleCommand,
    plan: planCommand,
    review: reviewCommand,
    scaffold: scaffoldCommand,
    spec: specCommand,
    status: statusCommand,
    verification: verificationCommand,
  },
});

/** Report a process-level fault to stderr and halt. Sinks are injectable for tests. */
export function reportProcessFault(
  kind: "unhandledRejection" | "uncaughtException",
  error: unknown,
  sinks: {
    writeStderr: (text: string) => void;
    exit: (code: number) => void;
  } = {
    writeStderr: (text) => {
      process.stderr.write(text);
    },
    exit: (code) => {
      process.exit(code);
    },
  },
): void {
  sinks.writeStderr(`${kind}: ${formatCauseChain(error)}\n`);
  sinks.exit(1);
}

if (import.meta.main) {
  process.on("unhandledRejection", (reason) => {
    reportProcessFault("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    reportProcessFault("uncaughtException", error);
  });
  await runMain(main as CommandDef);
}
