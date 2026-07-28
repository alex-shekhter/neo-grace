#!/usr/bin/env bun

import { existsSync } from "node:fs";
import path from "node:path";

import { defineCommand, type CommandDef, runMain } from "citty";

import { GRACE4_OPTIONAL_CONTEXT_ARTIFACTS } from "./grace4/types";
import { detectGraceProjectKind, resolveGrace4Paths } from "./grace4/project";
import { buildGraphProjection, buildVerificationProjection } from "./grace4/projections";
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
  analysisIssues: Array<Pick<LintIssue, "code" | "severity" | "file" | "message">>;
};

/** Builds a read-only doctor report. Must not write to the filesystem. */
export function collectDoctorReport(projectRoot: string): DoctorResult {
  const root = path.resolve(projectRoot);
  const kind = detectGraceProjectKind(root);
  if (kind !== "grace4") {
    throw new GraceCommandError(
      "invalid-project",
      kind === "grace3"
        ? "Detected GRACE 3 docs. Run grace-migrate before grace doctor."
        : "No GRACE 4 .grace project found.",
    );
  }

  const lint = lintGraceProject(root);
  const { config } = loadGraceLintConfig(root);
  const limits = resolveDocumentSizeLimits(config);
  const paths = resolveGrace4Paths(root);
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
    optionalContextArtifacts: GRACE4_OPTIONAL_CONTEXT_ARTIFACTS.map((file) => ({
      file,
      present: existsSync(path.join(paths.contextDir, file)),
    })),
    analysisIssues: lint.issues
      .filter((issue) => issue.code.startsWith("analysis."))
      .map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        file: issue.file,
        message: issue.message,
      })),
  };
}

export function formatDoctorText(report: DoctorResult): string {
  const lines = [
    "GRACE Doctor",
    "============",
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

  lines.push("", "Analysis issues");
  if (report.analysisIssues.length === 0) {
    lines.push("  None.");
  } else {
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
    }, "Unable to complete grace doctor.");
  },
});

if (import.meta.main) {
  await runMain(doctorCommand as CommandDef);
}
