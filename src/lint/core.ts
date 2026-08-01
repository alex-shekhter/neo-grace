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
//   formatTextReport
//   isModuleOwnableWritePath
//   isValidTextFormat
//   lintGraceProject
// END_MODULE_MAP
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { evaluateAssertion, extractAssertionsWithIssues } from "../artifact/assertions";
import { validateNgraceProject } from "../artifact/grammar";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveNgracePaths } from "../artifact/project";
import { buildGraphProjection, buildVerificationProjection, type GraphProjection, type VerificationProjection } from "../artifact/projections";
import {
  collectActiveChangeScopes,
  createDurableOwnershipIndex,
  detectScopeOverlaps,
  detectUnsafeConcurrentExecution,
  type ActiveChangeScope,
} from "../artifact/scope";
import { ARTIFACT_DIR } from "../artifact/paths";
import { ARTIFACT_TAG_PREFIX, ANCHOR_PATTERNS, type NgraceIssue, type NgraceProjectPaths } from "../artifact/types";
import { readGraceXmlArtifact } from "../artifact/xml";
import { ADAPTER_BACKED_EXTENSIONS, LANGUAGE_ADAPTERS } from "../language-registry";
import {
  analyzeGovernedFile,
  collectCodeFiles,
  collectNearMissMarkerIssues,
  hasGraceMarkers,
  type FileMarkupRecord,
} from "../project-utils";
import { withLintIssueGuide } from "./catalog";
import { loadGraceLintConfig } from "./config";
import { documentSizeIssues } from "./document-size";
import type { AnalysisCoverage, AnalysisCoverageEntry, LintIssue, LintOptions, LintProfile, LintResult } from "./types";

const TEXT_FORMAT_OPTIONS = new Set(["text", "json"]);

function emptyAnalysisCoverage(): AnalysisCoverage {
  return { adapterBacked: [], unverified: [], governedFiles: 0 };
}

function createResult(root: string, profile: LintProfile, options: LintOptions): LintResult {
  return {
    schemaVersion: "1.0.0",
    tool: "grace-lint",
    generatedAt: new Date().toISOString(),
    root,
    profile,
    assertionMode: options.assertionMode ?? "current",
    changeId: options.changeId,
    commandsEnabled: options.runCommands ?? false,
    filesChecked: 0,
    governedFiles: 0,
    xmlFilesChecked: 0,
    issues: [],
    summary: { issues: 0, errors: 0, warnings: 0 },
    analysisCoverage: emptyAnalysisCoverage(),
  };
}

function addIssue(result: LintResult, issue: LintIssue) {
  result.issues.push(issue);
}

function addNgraceIssue(result: LintResult, issue: NgraceIssue) {
  addIssue(result, {
    severity: issue.severity,
    code: issue.code,
    file: issue.file,
    line: issue.line,
    message: issue.message,
  });
}

function finalizeResult(result: LintResult): LintResult {
  result.issues.sort((left, right) => left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0) || left.code.localeCompare(right.code));
  result.summary = {
    issues: result.issues.length,
    errors: result.issues.filter((issue) => issue.severity === "error").length,
    warnings: result.issues.filter((issue) => issue.severity === "warning").length,
  };
  result.issues = result.issues.map(withLintIssueGuide);
  return result;
}

function adapterIdForExtension(extension: string): string | undefined {
  const probe = `probe${extension}`;
  return LANGUAGE_ADAPTERS.find((adapter) => adapter.supports(probe))?.id;
}

function finalizeCoverageCounts(
  counts: Map<string, number>,
  adapterBacked: boolean,
): AnalysisCoverageEntry[] {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([extension, files]) => ({
      extension,
      files,
      ...(adapterBacked ? { adapterId: adapterIdForExtension(extension) } : {}),
    }));
}

function validateGovernedFiles(result: LintResult, root: string): FileMarkupRecord[] {
  const records: FileMarkupRecord[] = [];
  const { config, issues } = loadGraceLintConfig(root);
  for (const configIssue of issues) {
    addIssue(result, configIssue);
  }
  if (issues.some((issue) => issue.severity === "error")) {
    return records;
  }

  const files = collectCodeFiles(root, [ARTIFACT_DIR, ...(config?.ignoredDirs ?? [])], root, config?.codeExtensions);
  result.filesChecked = files.length;
  const adapterBackedCounts = new Map<string, number>();
  const unverifiedCounts = new Map<string, number>();

  for (const file of files) {
    const text = readText(file);
    // A8: near-miss markers warn without governing the file.
    for (const issue of collectNearMissMarkerIssues(file, text)) {
      addIssue(result, issue);
    }
    if (!hasGraceMarkers(text)) {
      continue;
    }
    result.governedFiles += 1;
    const extension = path.extname(file);
    if (ADAPTER_BACKED_EXTENSIONS.has(extension)) {
      adapterBackedCounts.set(extension, (adapterBackedCounts.get(extension) ?? 0) + 1);
    } else {
      unverifiedCounts.set(extension, (unverifiedCounts.get(extension) ?? 0) + 1);
    }

    const analysis = analyzeGovernedFile(root, file, text, {
      unverifiedLanguages: config?.unverifiedLanguages,
      codeExtensions: config?.codeExtensions,
    });
    records.push(analysis.record);
    for (const issue of analysis.issues) {
      addIssue(result, issue);
    }
  }

  result.analysisCoverage = {
    adapterBacked: finalizeCoverageCounts(adapterBackedCounts, true),
    unverified: finalizeCoverageCounts(unverifiedCounts, false),
    governedFiles: result.governedFiles,
  };
  return records;
}

/**
 * Validate DEPENDS/LINKS anchors against graph and verification projections (G-10, G-11).
 * Unknown anchors are errors; modules with Path but no linking file are warnings.
 */
function validateFileHeaderReferences(
  result: LintResult,
  records: FileMarkupRecord[],
  graph: GraphProjection,
  verification: VerificationProjection,
): void {
  const knownModules = new Set(graph.modules.keys());
  const knownFlows = new Set(graph.dataFlows.keys());
  const knownVerif = new Set(verification.entries.keys());
  const linkedModuleCount = new Map<string, number>();

  for (const record of records) {
    const contractLine = record.moduleContract?.startLine;

    for (const dep of record.dependsModuleIds) {
      if (!knownModules.has(dep)) {
        addIssue(result, {
          severity: "error",
          code: "markup.unknown-dependency",
          file: record.path,
          line: contractLine,
          message: `MODULE_CONTRACT DEPENDS references ${dep}, which does not exist in the graph.`,
        });
      }
    }

    for (const link of record.linkedModuleIds) {
      if (knownModules.has(link) || knownFlows.has(link)) {
        linkedModuleCount.set(link, (linkedModuleCount.get(link) ?? 0) + 1);
      } else {
        addIssue(result, {
          severity: "error",
          code: "markup.unknown-link",
          file: record.path,
          line: contractLine,
          message: `MODULE_CONTRACT LINKS references ${link}, which does not exist in the graph.`,
        });
      }
    }

    for (const vid of record.linkedVerificationIds) {
      if (!knownVerif.has(vid)) {
        addIssue(result, {
          severity: "error",
          code: "markup.unknown-link",
          file: record.path,
          line: contractLine,
          message: `MODULE_CONTRACT LINKS references ${vid}, which does not exist in verification.`,
        });
      }
    }
  }

  for (const [moduleId, moduleRecord] of graph.modules) {
    if (moduleRecord.path && (linkedModuleCount.get(moduleId) ?? 0) === 0) {
      addIssue(result, {
        severity: "warning",
        code: "graph.module-without-linked-files",
        file: moduleRecord.file,
        message: `${moduleId} declares a Path but no governed file declares LINKS: ${moduleId}.`,
      });
    }
  }
}

function readText(file: string) {
  return readFileSync(file, "utf8");
}

function listPlanFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listPlanFiles(entryPath);
    }
    return entry.isFile() && entry.name === "plan.xml" ? [entryPath] : [];
  });
}

function readPlanStatus(planFile: string): string | null {
  const artifact = readGraceXmlArtifact(planFile);
  return artifact.root?.tag === `${ARTIFACT_TAG_PREFIX}ChangePlan` ? artifact.root.attributes.status ?? null : null;
}

function validateAssertions(
  result: LintResult,
  paths: NgraceProjectPaths,
  planFilesActive: string[],
  planFilesArchived: string[],
  graph: GraphProjection,
  verification: VerificationProjection,
  root: string,
  options: LintOptions,
) {
  const context = { root, graph, verification, runCommands: options.runCommands };
  const assertionMode = options.assertionMode ?? "current";
  const selectedPlan = assertionMode === "current" ? null : resolveSelectedApprovedPlan(result, paths, options.changeId);

  for (const planFile of planFilesActive) {
    const status = readPlanStatus(planFile);
    const isSelected = selectedPlan !== null && path.resolve(selectedPlan) === path.resolve(planFile);
    const evaluateCurrentBaseline = assertionMode === "current" && status === "approved";
    const evaluateUnrelatedFinalBaseline = assertionMode === "final" && status === "approved" && !isSelected;
    evaluateSection(result, planFile, "BaselineAssertions", context, evaluateCurrentBaseline || evaluateUnrelatedFinalBaseline, true, true);
    evaluateSection(result, planFile, "TargetAssertions", context, false);
  }

  for (const planFile of planFilesArchived) {
    // Archived plans: syntax only, never semantic (baseline may be stale, target may be superseded by later changes)
    evaluateSection(result, planFile, "BaselineAssertions", context, false, true, false, true);
    evaluateSection(result, planFile, "TargetAssertions", context, false, true, false, true);
  }

  if (assertionMode === "current") {
    return;
  }

  if (!selectedPlan) {
    return;
  }
  evaluateSection(
    result,
    selectedPlan,
    assertionMode === "baseline" ? "BaselineAssertions" : "TargetAssertions",
    context,
    true,
    false,
  );
}

function evaluateSection(
  result: LintResult,
  planFile: string,
  section: "BaselineAssertions" | "TargetAssertions",
  context: { root: string; graph: GraphProjection; verification: VerificationProjection; runCommands?: boolean },
  evaluateSemantically: boolean,
  includeExtractionIssues = true,
  skipUnevaluatedCommands = false,
  skipActivePhaseIssues = false,
) {
  const extraction = extractAssertionsWithIssues(planFile, section);
  if (includeExtractionIssues) {
    for (const issue of extraction.issues) {
      if (skipActivePhaseIssues && issue.code === "assertion.phase-incompatible-command") {
        continue;
      }
      addNgraceIssue(result, issue);
    }
  }
  if (evaluateSemantically) {
    for (const assertion of extraction.assertions) {
      if (
        skipUnevaluatedCommands
        && (assertion.kind === "MustPassCommand" || assertion.kind === "MustPassBudget")
        && !context.runCommands
      ) {
        continue;
      }
      for (const issue of evaluateAssertion(assertion, context)) {
        addNgraceIssue(result, issue);
      }
    }
  }
}

function resolveSelectedApprovedPlan(
  result: LintResult,
  paths: NgraceProjectPaths,
  changeId: string | undefined,
): string | null {
  if (!changeId) {
    addIssue(result, {
      severity: "error",
      code: "assertion.change-required",
      file: paths.changesActiveDir,
      message: "Selected baseline or target assertion evaluation requires one --change C-* identifier.",
    });
    return null;
  }
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    addIssue(result, {
      severity: "error",
      code: "assertion.invalid-change-id",
      file: paths.changesActiveDir,
      message: `Selected change '${changeId}' must be a canonical C-* identifier.`,
    });
    return null;
  }

  const bundleDir = path.join(paths.changesActiveDir, changeId);
  const specFile = path.join(bundleDir, "spec.xml");
  const planFile = path.join(bundleDir, "plan.xml");
  const spec = readGraceXmlArtifact(specFile);
  const plan = readGraceXmlArtifact(planFile);
  const specWrapper = spec.root?.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  const planWrapper = plan.root?.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  const approved = spec.root?.tag === `${ARTIFACT_TAG_PREFIX}ChangeSpec`
    && spec.root.attributes.status === "approved"
    && specWrapper?.length === 1
    && specWrapper[0]?.tag === changeId
    && plan.root?.tag === `${ARTIFACT_TAG_PREFIX}ChangePlan`
    && plan.root.attributes.status === "approved"
    && planWrapper?.length === 1
    && planWrapper[0]?.tag === changeId;

  if (!approved) {
    addIssue(result, {
      severity: "error",
      code: "assertion.change-not-approved",
      file: bundleDir,
      message: `Selected change ${changeId} must name one active bundle whose spec.xml and plan.xml are both approved and identity-matched.`,
    });
    return null;
  }
  return planFile;
}
/** Lints the current neo-grace .ngrace document state and file-local semantic markup. */
export function lintGraceProject(projectRoot: string, options: LintOptions = {}): LintResult {
  const root = path.resolve(projectRoot);
  const profile = options.profile ?? "standard";
  const result = createResult(root, profile, options);
  const kind = detectGraceProjectKind(root);

  if (kind === "grace3") {
    addIssue(result, {
      severity: "error",
      code: "project.grace3-detected",
      file: root,
      message: formatGrace3MigrationGuidance(root),
    });
    return finalizeResult(result);
  }

  if (kind === "none") {
    addIssue(result, {
      severity: "error",
      code: "project.missing-grace",
      file: root,
      message: `No ${ARTIFACT_DIR} directory found.`,
    });
    return finalizeResult(result);
  }

  const governedRecords = validateGovernedFiles(result, root);
  // Config already validated (and issues emitted) inside validateGovernedFiles; re-read for size limits.
  const { config } = loadGraceLintConfig(root);

  const paths = resolveNgracePaths(root);
  const validation = validateNgraceProject(root);
  result.xmlFilesChecked = validation.artifacts.length;
  for (const issue of validation.issues) {
    addNgraceIssue(result, issue);
  }

  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  for (const issue of [...graph.issues, ...verification.issues]) {
    addNgraceIssue(result, issue);
  }

  for (const issue of documentSizeIssues(graph, verification, config)) {
    addIssue(result, issue);
  }

  validateFileHeaderReferences(result, governedRecords, graph, verification);

  const activeScopes = collectActiveChangeScopes(paths);
  const ownership = createDurableOwnershipIndex(graph, verification);
  const scopeIssues = activeScopes.flatMap((scope) => scope.issues);
  const overlapIssues = detectScopeOverlaps(activeScopes, ownership);
  const parallelIssues = options.parallelPreflight ? detectUnsafeConcurrentExecution(activeScopes, ownership) : [];
  for (const issue of [...scopeIssues, ...overlapIssues, ...parallelIssues]) {
    addNgraceIssue(result, issue);
  }

  validateGraphAnchorsOwnWriteScope(result, activeScopes, governedRecords);

  const planFilesActive = [...listPlanFiles(paths.changesActiveDir)];
  const planFilesArchived = [...listPlanFiles(paths.changesArchiveDir)];
  validateAssertions(result, paths, planFilesActive, planFilesArchived, graph, verification, root, options);

  return finalizeResult(result);
}

/** Non-test paths under src/ are module-ownable for GraphAnchors↔OWS (C-GRAPH-COVERAGE / A53). */
export function isModuleOwnableWritePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized.startsWith("src/")) {
    return false;
  }
  if (/(^|\/)(?:__tests__|tests)(\/|$)|(?:\.test|\.spec)\.[^.]+$/.test(normalized)) {
    return false;
  }
  return true;
}

/**
 * Active plans only: each module-ownable ObservedWriteScope File must declare LINKS to at least
 * one GraphAnchors module. Ownership is LINKS only (no directory prefix). Archives are not in
 * activeScopes and are not evaluated (decision D / A53).
 */
function validateGraphAnchorsOwnWriteScope(
  result: LintResult,
  activeScopes: ActiveChangeScope[],
  governedRecords: FileMarkupRecord[],
): void {
  const linksByPath = new Map<string, readonly string[]>();
  for (const record of governedRecords) {
    linksByPath.set(record.path.replaceAll("\\", "/"), record.linkedModuleIds);
  }

  for (const scope of activeScopes) {
    const anchors = new Set(scope.durable.graphAnchors);
    const planFile = path.join(scope.bundlePath, "plan.xml");
    for (const file of scope.observedWrites.files) {
      const rel = file.replaceAll("\\", "/");
      if (!isModuleOwnableWritePath(rel)) {
        continue;
      }
      const links = linksByPath.get(rel);
      const owned = Boolean(links?.some((id) => anchors.has(id)));
      if (owned) {
        continue;
      }
      const anchorList = [...anchors].sort().join(", ") || "none";
      addIssue(result, {
        severity: "error",
        code: "change.graph-anchors-miss-write-scope",
        file: planFile,
        message: links && links.length > 0
          ? `ObservedWriteScope path ${rel} is not linked to any GraphAnchors module (file LINKS: ${links.join(", ")}; GraphAnchors: ${anchorList}).`
          : `ObservedWriteScope path ${rel} is under src/ but is not a governed file whose MODULE_CONTRACT LINKS include a GraphAnchors module.`,
      });
    }
  }
}

export function isValidTextFormat(format: string) {
  return TEXT_FORMAT_OPTIONS.has(format);
}

export function formatTextReport(result: LintResult, options: { remediate?: boolean } = {}) {
  const lines = [
    "neo-grace Lint Report",
    "=".repeat(21),
    `Root: ${result.root}`,
    `Profile: ${result.profile}`,
    `Files checked: ${result.filesChecked}`,
    `Governed files: ${result.governedFiles}`,
    `XML artifacts checked: ${result.xmlFilesChecked}`,
    `Errors: ${result.summary.errors}`,
    `Warnings: ${result.summary.warnings}`,
  ];

  if (result.issues.length === 0) {
    lines.push("", "No issues found.");
    return lines.join("\n");
  }

  lines.push("", "Issues");
  for (const issue of result.issues) {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    lines.push(`- [${issue.severity}] ${issue.code} ${location} — ${issue.message}`);
    if (options.remediate && issue.remediation) {
      lines.push(...issue.remediation.map((item) => `  • ${item}`));
    }
  }

  return lines.join("\n");
}
