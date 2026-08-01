#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Doctor CLI surface
//   SCOPE: Adapter coverage and absence-by-reason reports
//   DEPENDS: none
//   LINKS: M-DOCTOR
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DoctorAdapterReport
//   DoctorResult
//   absenceCountsByReason
//   collectDoctorReport
//   doctorCommand
//   formatDoctorText
//   partitionAbsenceIssues
//   toDoctorAbsenceIssues
// END_MODULE_MAP

import { existsSync } from "node:fs";
import path from "node:path";

import { defineCommand, type CommandDef, runMain } from "citty";

import { ARTIFACT_DIR } from "./artifact/paths";
import { detectGraceProjectKind, resolveNgracePaths } from "./artifact/project";
import { NGRACE_OPTIONAL_CONTEXT_ARTIFACTS, skillName } from "./artifact/types";
import { buildGraphProjection, buildVerificationProjection } from "./artifact/projections";
import { ADAPTER_BACKED_EXTENSIONS, LANGUAGE_ADAPTERS } from "./language-registry";
import { loadGraceLintConfig } from "./lint/config";
import { lintGraceProject } from "./lint/core";
import {
  collectDocumentSizePressure,
  displayProjectPath,
  resolveDocumentSizeLimits,
} from "./lint/document-size";
import type { AnalysisCoverage, LintIssue } from "./lint/types";
import { GraceCommandError, runGraceCommand } from "./query/errors";

export type DoctorAdapterReport = {
  id: string;
  extensions: string[];
};

export type DoctorResult = {
  schemaVersion: "1.0.0";
  tool: "grace-doctor";
  generatedAt: string;
  root: string;
  adapters: DoctorAdapterReport[];
  adapterBackedExtensions: string[];
  analysisCoverage: AnalysisCoverage;
  documentSize: {
    anchorLimit: number;
    byteLimit: number;
    pressure: Array<{
      kind: "graph" | "verification";
      documentId: string;
      file: string;
      anchorCount: number;
      byteSize: number;
      overLimit: boolean;
    }>;
  };
  optionalContextArtifacts: Array<{
    file: string;
    present: boolean;
  }>;
  analysisIssues: Array<Pick<LintIssue, "code" | "severity" | "file" | "message" | "issueClass">>;
};

/**
 * Pure absence partition over lint issues (A5.2). Unit-testable for all three
 * absence codes regardless of which surface can emit them under current mode.
 */
export function partitionAbsenceIssues(issues: readonly LintIssue[]): LintIssue[] {
  return issues.filter((issue) => issue.issueClass === "absence");
}

/** Count absence issues grouped by reason code (stable key order). */
export function absenceCountsByReason(issues: readonly LintIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of partitionAbsenceIssues(issues)) {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  }
  return counts;
}

/** Builds a read-only doctor report. Must not write to the filesystem. */
export function collectDoctorReport(projectRoot: string): DoctorResult {
  const root = path.resolve(projectRoot);
  const kind = detectGraceProjectKind(root);
  if (kind !== "grace4") {
    throw new GraceCommandError(
      "invalid-project",
      kind === "grace3"
        ? `Detected GRACE 3 docs. Run ${skillName("migrate")} before ngrace doctor.`
        : `No neo-grace ${ARTIFACT_DIR} project found.`,
    );
  }

  const lint = lintGraceProject(root);
  const { config } = loadGraceLintConfig(root);
  const limits = resolveDocumentSizeLimits(config);
  const paths = resolveNgracePaths(root);
  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  const pressure = collectDocumentSizePressure(graph, verification, limits);

  const adapters: DoctorAdapterReport[] = LANGUAGE_ADAPTERS.map((adapter) => ({
    id: adapter.id,
    extensions: [...ADAPTER_BACKED_EXTENSIONS].filter((ext) => adapter.supports(`probe${ext}`)).sort(),
  }));

  return {
    schemaVersion: "1.0.0",
    tool: "grace-doctor",
    generatedAt: new Date().toISOString(),
    root,
    adapters,
    adapterBackedExtensions: [...ADAPTER_BACKED_EXTENSIONS].sort(),
    analysisCoverage: lint.analysisCoverage,
    documentSize: {
      anchorLimit: limits.anchorLimit,
      byteLimit: limits.byteLimit,
      pressure: pressure.map((item) => ({
        kind: item.kind,
        documentId: item.documentId,
        file: displayProjectPath(root, item.file),
        anchorCount: item.anchorCount,
        byteSize: item.byteSize,
        overLimit: item.overAnchorLimit || item.overByteLimit,
      })),
    },
    optionalContextArtifacts: NGRACE_OPTIONAL_CONTEXT_ARTIFACTS.map((file) => ({
      file,
      present: existsSync(path.join(paths.contextDir, file)),
    })),
    // A4.3 / A5.1: classify via issueClass, not an analysis. prefix allowlist.
    // assertion.command-not-evaluated is absence but unreachable from doctor under
    // current mode (A5.2) — partition still includes it when present on the issue list.
    analysisIssues: toDoctorAbsenceIssues(lint.issues),
  };
}

/** Maps lint issues to doctor's absence rows (issueClass filter, not analysis. prefix). */
export function toDoctorAbsenceIssues(
  issues: readonly LintIssue[],
): Array<Pick<LintIssue, "code" | "severity" | "file" | "message" | "issueClass">> {
  return partitionAbsenceIssues(issues).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    file: issue.file,
    message: issue.message,
    issueClass: issue.issueClass,
  }));
}

export function formatDoctorText(report: DoctorResult): string {
  const lines = [
    "neo-grace Doctor",
    "=".repeat(16),
    `Root: ${report.root}`,
    "",
    "Adapters",
    ...report.adapters.map((adapter) => `  - ${adapter.id}: ${adapter.extensions.join(", ") || "(none)"}`),
    "",
    "Analysis coverage",
    `  Governed files: ${report.analysisCoverage.governedFiles}`,
    `  Adapter-backed: ${
      report.analysisCoverage.adapterBacked.length === 0
        ? "(none)"
        : report.analysisCoverage.adapterBacked.map((e) => `${e.extension}×${e.files}`).join(", ")
    }`,
    `  Unverified: ${
      report.analysisCoverage.unverified.length === 0
        ? "(none)"
        : report.analysisCoverage.unverified.map((e) => `${e.extension}×${e.files}`).join(", ")
    }`,
    "",
    `Document size (limits: ${report.documentSize.anchorLimit} anchors / ${report.documentSize.byteLimit} bytes)`,
  ];
  const over = report.documentSize.pressure.filter((item) => item.overLimit);
  if (over.length === 0) {
    lines.push("  No documents over limit.");
  } else {
    for (const item of over) {
      lines.push(
        `  - ${item.documentId} (${item.file}): ${item.anchorCount} anchors, ${item.byteSize} bytes`,
      );
    }
  }

  lines.push("", "Optional context artifacts");
  for (const artifact of report.optionalContextArtifacts) {
    lines.push(`  - ${artifact.file}: ${artifact.present ? "present" : "missing (optional)"}`);
  }

  // Heading kept as "Analysis issues" for Phase 10 baseline continuity (A2); content is
  // absence-class issues only (A4.3 filter replacement).
  lines.push("", "Analysis issues");
  if (report.analysisIssues.length === 0) {
    lines.push("  None.");
  } else {
    // Count by code only — rows already come from toDoctorAbsenceIssues (A7.3 §4).
    const counts: Record<string, number> = {};
    for (const issue of report.analysisIssues) {
      counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    }
    for (const code of Object.keys(counts).sort()) {
      lines.push(`  ${code}: ${counts[code]}`);
    }
    for (const issue of report.analysisIssues) {
      lines.push(`  - [${issue.severity}] ${issue.code} ${issue.file} — ${issue.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Read-only report: adapters, analysis coverage, document size pressure, optional context gaps.",
  },
  args: {
    path: {
      type: "string",
      alias: "p",
      description: "Project root",
      default: ".",
    },
    format: {
      type: "string",
      alias: "f",
      description: "Output format: text or json",
      default: "text",
    },
  },
  async run(context) {
    const format = String(context.args.format ?? "text") === "json" ? "json" : "text";
    await runGraceCommand(format, () => {
      const report = collectDoctorReport(String(context.args.path ?? "."));
      if (format === "json") {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(formatDoctorText(report));
      }
    }, "Unable to complete ngrace doctor.");
  },
});

if (import.meta.main) {
  await runMain(doctorCommand as CommandDef);
}
