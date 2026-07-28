import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { GraphProjection, VerificationProjection } from "../grace4/projections";
import {
  DEFAULT_DOCUMENT_ANCHOR_LIMIT,
  DEFAULT_DOCUMENT_BYTE_LIMIT,
  type GraceLintConfig,
  type LintIssue,
} from "./types";

/** Resolved document-size thresholds for lint and doctor. */
export type DocumentSizeLimits = {
  anchorLimit: number;
  byteLimit: number;
};

export function resolveDocumentSizeLimits(config: GraceLintConfig | null | undefined): DocumentSizeLimits {
  return {
    anchorLimit: config?.documentAnchorLimit ?? DEFAULT_DOCUMENT_ANCHOR_LIMIT,
    byteLimit: config?.documentByteLimit ?? DEFAULT_DOCUMENT_BYTE_LIMIT,
  };
}

export type DocumentSizePressure = {
  kind: "graph" | "verification";
  documentId: string;
  file: string;
  anchorCount: number;
  byteSize: number;
  overAnchorLimit: boolean;
  overByteLimit: boolean;
};

/**
 * Measures size pressure for every routed graph and verification document.
 * Warnings only — large documents remain valid; they are hard to navigate.
 */
export function collectDocumentSizePressure(
  graph: GraphProjection,
  verification: VerificationProjection,
  limits: DocumentSizeLimits,
): DocumentSizePressure[] {
  const results: DocumentSizePressure[] = [];

  const graphAnchorsByOwner = new Map<string, number>();
  for (const record of [
    ...graph.modules.values(),
    ...graph.dataFlows.values(),
    ...graph.interfaceContracts.values(),
  ]) {
    graphAnchorsByOwner.set(record.owner, (graphAnchorsByOwner.get(record.owner) ?? 0) + 1);
  }
  for (const [documentId, file] of graph.documents) {
    results.push(measureDocument("graph", documentId, file, graphAnchorsByOwner.get(documentId) ?? 0, limits));
  }

  const verifAnchorsByOwner = new Map<string, number>();
  for (const record of verification.entries.values()) {
    verifAnchorsByOwner.set(record.owner, (verifAnchorsByOwner.get(record.owner) ?? 0) + 1);
  }
  for (const [documentId, file] of verification.documents) {
    results.push(
      measureDocument("verification", documentId, file, verifAnchorsByOwner.get(documentId) ?? 0, limits),
    );
  }

  return results;
}

function measureDocument(
  kind: "graph" | "verification",
  documentId: string,
  file: string,
  anchorCount: number,
  limits: DocumentSizeLimits,
): DocumentSizePressure {
  const byteSize = existsSync(file) ? statSync(file).size : 0;
  return {
    kind,
    documentId,
    file,
    anchorCount,
    byteSize,
    overAnchorLimit: anchorCount > limits.anchorLimit,
    overByteLimit: byteSize > limits.byteLimit,
  };
}

/** Emits warning-only document-too-large issues for documents over either limit. */
export function documentSizeIssues(
  graph: GraphProjection,
  verification: VerificationProjection,
  config: GraceLintConfig | null | undefined,
): LintIssue[] {
  const limits = resolveDocumentSizeLimits(config);
  const issues: LintIssue[] = [];
  for (const pressure of collectDocumentSizePressure(graph, verification, limits)) {
    if (!pressure.overAnchorLimit && !pressure.overByteLimit) {
      continue;
    }
    const reasons: string[] = [];
    if (pressure.overAnchorLimit) {
      reasons.push(`${pressure.anchorCount} anchors (limit ${limits.anchorLimit})`);
    }
    if (pressure.overByteLimit) {
      reasons.push(`${pressure.byteSize} bytes (limit ${limits.byteLimit})`);
    }
    const code = pressure.kind === "graph" ? "graph.document-too-large" : "verification.document-too-large";
    const splitHint = pressure.kind === "graph"
      ? `Split ${pressure.documentId} with \`grace graph split --by <path-prefix>\` (e.g. by service or package root).`
      : `Split ${pressure.documentId} into additional VD-* documents by module cluster or service boundary.`;
    issues.push({
      severity: "warning",
      code,
      file: pressure.file,
      message: `${pressure.documentId} is large (${reasons.join("; ")}). ${splitHint}`,
    });
  }
  return issues;
}

/** Relative path helper for doctor output (lexical, display-only). */
export function displayProjectPath(projectRoot: string, absoluteFile: string): string {
  return path.relative(projectRoot, absoluteFile).replaceAll("\\", "/") || absoluteFile;
}
