#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: CLI entry point
//   SCOPE: Register ngrace subcommands on the process entry
//   DEPENDS: none
//   LINKS: M-CLI
//   ROLE: SCRIPT
//   MAP_MODE: LOCALS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   main
// END_MODULE_MAP

import { defineCommand, type CommandDef, runMain } from "citty";

import { contextCommand } from "./grace-context";
import { cursorCommand } from "./grace-cursor";
import { doctorCommand } from "./grace-doctor";
import { fileCommand } from "./grace-file";
import { graphCommand } from "./grace-graph";
import { gateCommand } from "./gates/command";
import { lintCommand } from "./grace-lint";
import { moduleCommand } from "./grace-module";
import { statusCommand } from "./grace-status";
import { verificationCommand } from "./grace-verification";
import { reviewCommand } from "./review/command";
import { ARTIFACT_DIR } from "./artifact/paths";

const main = defineCommand({
  meta: {
    name: "ngrace",
    version: "6.0.1",
    description: `neo-grace CLI for ${ARTIFACT_DIR} linting, status snapshots, module health, verification queries, semantic markup, and artifact navigation.`,
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
    review: reviewCommand,
    status: statusCommand,
    verification: verificationCommand,
  },
});

if (import.meta.main) {
  await runMain(main as CommandDef);
}
