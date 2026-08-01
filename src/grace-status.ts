#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineCommand, type CommandDef, runMain } from "citty";

import { lintGraceProject } from "./lint/core";
import type { AnalysisCoverage, LintIssue } from "./lint/types";
import { ARTIFACT_DIR, toProjectRelativePath } from "./artifact/paths";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveNgracePaths } from "./artifact/project";
import { skillRef } from "./artifact/types";
import { buildGraphProjection, buildVerificationProjection, type GraphProjection, type VerificationProjection } from "./artifact/projections";
import { collectActiveChangeScopes, createDurableOwnershipIndex, detectScopeOverlaps, detectUnsafeConcurrentExecution, observedWriteScopeContains, type ActiveChangeScope } from "./artifact/scope";
import { readGraceXmlArtifact } from "./artifact/xml";
import { readPermittingDecision } from "./gates/ledger";
import { collectModuleHealth } from "./query/health";
import { loadGraceArtifactIndex } from "./query/core";
import { GraceCommandError, runGraceCommand } from "./query/errors";
import { formatModuleHealthTable } from "./query/render";
import type { ModuleHealthRecord } from "./query/types";

/** Current state of one neo-grace change bundle. */
export type ChangeBundleStatus = {
  changeId: string;
  location: "active" | "archive";
  specStatus?: string;
  planStatus?: string;
  derivedStates: string[];
  path: string;
  /** Closed epochs in run-ledger.xml, when present (Phase 3). */
  epochCount?: number;
  /** Tasks named in plan.xml ImplementationPlan, when present. */
  taskCount?: number;
  /**
   * A29.9 / A32.1 / A33.1: apply Decision read for archived applied bundles.
   * - permit: Decisions holds a permitting apply
   * - absent: no Decisions section (pre-gate grandfather; not a violation)
   * - no-permit: Decisions exists without a permitting apply (violation)
   * - invalid: unreadable Decisions (code/detail reach the report)
   */
  applyGateRecord?: {
    status: "permit" | "absent" | "no-permit" | "invalid";
    code?: string;
    detail?: string;
  };
};

/** neo-grace status result for text or JSON output. */
export type StatusResult = {
  schemaVersion: string;
  tool: "grace-status";
  generatedAt: string;
  root: string;
  projectKind: "grace4" | "grace3" | "none";
  summary: {
    graceVersion?: string;
    contextArtifacts: number;
    graphModules: number;
    verificationEntries: number;
    activeChanges: number;
    archivedChanges: number;
    integrityErrors: number;
    integrityWarnings: number;
    readyModules: number;
    attentionModules: number;
    blockedModules: number;
  };
  changes: ChangeBundleStatus[];
  derivedStates: string[];
  integrity: {
    errors: number;
    warnings: number;
    topIssues: string[];
  };
  observedDrift: {
    available: boolean;
    changedFiles: string[];
    explainedFiles: string[];
    unexplainedFiles: string[];
  };
  nextAction: string;
  migrationGuidance?: string;
  modules?: ModuleHealthRecord[];
  moduleHealthLoadError?: string;
  /** Sourced from lint result; MODULE_MAP parity coverage for governed files. */
  analysisCoverage?: AnalysisCoverage;
};

/** Bundle-local facts used to derive mutually safe execution readiness. */
type ChangeBundleFacts = {
  location: "active" | "archive";
  specStatus?: string;
  planStatus?: string;
  integrityErrors: number;
  baselineFailures: number;
};

/** Route ownership needed to explain changed GRACE graph and verification documents exactly. */
type DriftRouteIndex = {
  graphFiles: Map<string, { documents: Set<string>; anchors: Set<string> }>;
  verificationFiles: Map<string, { documents: Set<string>; anchors: Set<string> }>;
};

type CollectedObservedDrift = {
  drift: StatusResult["observedDrift"];
  trackedChangedFiles: Set<string>;
};

function topIssues(issues: LintIssue[]) {
  return issues.slice(0, 5).map((issue) => `${issue.code}: ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
}

function listBundleDirs(directory: string) {
  if (!existsSync(directory)) {
    return [] as string[];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function readRootStatus(file: string) {
  const artifact = readGraceXmlArtifact(file);
  return artifact.root?.attributes.status;
}

function collectChangeBundleStatuses(root: string, location: "active" | "archive", directory: string, lintIssues: LintIssue[]) {
  return listBundleDirs(directory).map((bundlePath) => {
    const changeId = path.basename(bundlePath);
    const specFile = path.join(bundlePath, "spec.xml");
    const planFile = path.join(bundlePath, "plan.xml");
    const ledgerFile = path.join(bundlePath, "run-ledger.xml");
    const specStatus = existsSync(specFile) ? readRootStatus(specFile) : undefined;
    const planStatus = existsSync(planFile) ? readRootStatus(planFile) : undefined;
    const relativeBundlePath = path.relative(root, bundlePath) || ".";
    const bundleLintIssues = lintIssues.filter((issue) => {
      const resolvedIssue = path.resolve(issue.file);
      return resolvedIssue === path.resolve(bundlePath) || resolvedIssue.startsWith(path.resolve(bundlePath) + path.sep);
    });
    const derivedStates = deriveChangeStates({
      location,
      specStatus,
      planStatus,
      integrityErrors: bundleLintIssues.filter((issue) => issue.severity === "error").length,
      baselineFailures: bundleLintIssues.filter((issue) => /^assertion\.(?:Must|command-not-evaluated)/.test(issue.code)).length,
    });

    // A29.9 / A32.1 / A33.1: gate-record findings for archived applied bundles (never gate.* from lint).
    // absent ≠ no-permit: no Decisions section is grandfathered with reason; section without permit is the violation.
    let applyGateRecord: ChangeBundleStatus["applyGateRecord"];
    if (location === "archive" && (specStatus === "applied" || planStatus === "applied")) {
      const permit = readPermittingDecision(root, changeId, "apply");
      if (permit.state === "permit") {
        applyGateRecord = { status: "permit" };
      } else if (permit.state === "invalid") {
        applyGateRecord = {
          status: "invalid",
          code: permit.code,
          detail: permit.detail,
        };
        derivedStates.push(`gate-record-invalid:${permit.code}`);
      } else if (permit.state === "absent") {
        applyGateRecord = {
          status: "absent",
          detail: "no Decisions section (bundle may predate the gate surface)",
        };
        // Absence with reason — not dressed as a violation (A33.1 / D5).
        derivedStates.push("apply-gate-record-absent");
      } else {
        // Decisions section exists and holds no permitting apply — the real violation.
        applyGateRecord = { status: "no-permit" };
        derivedStates.push("applied-without-gate-record");
      }
    }

    const epochCount = existsSync(ledgerFile) ? countLedgerEpochs(ledgerFile) : undefined;
    const taskCount = existsSync(planFile) ? countPlanTasks(planFile) : undefined;

    return {
      changeId,
      location,
      specStatus,
      planStatus,
      derivedStates: [...new Set(derivedStates)],
      path: relativeBundlePath,
      epochCount,
      taskCount,
      applyGateRecord,
    } satisfies ChangeBundleStatus;
  });
}

function countLedgerEpochs(ledgerFile: string): number {
  const artifact = readGraceXmlArtifact(ledgerFile);
  if (!artifact.root) return 0;
  let count = 0;
  for (const wrapper of artifact.root.children) {
    for (const child of wrapper.children) {
      if (/^Epoch-[1-9][0-9]*$/.test(child.tag)) count += 1;
    }
  }
  return count;
}

function countPlanTasks(planFile: string): number {
  const artifact = readGraceXmlArtifact(planFile);
  if (!artifact.root) return 0;
  let count = 0;
  for (const wrapper of artifact.root.children) {
    const plan = wrapper.children.find((child) => child.tag === "ImplementationPlan");
    if (!plan) continue;
    for (const child of plan.children) {
      if (/^T-[0-9]{3}$/.test(child.tag)) count += 1;
    }
  }
  return count;
}

/** Derives bundle states with readiness last so stale or invalid plans are never ready. */
function deriveChangeStates(facts: ChangeBundleFacts): string[] {
  const states: string[] = [];
  if (!facts.specStatus) {
    states.push("missing-spec-status");
  }
  if (facts.location === "active" && [facts.specStatus, facts.planStatus].some((status) => status && !["draft", "approved"].includes(status))) {
    states.push("invalid-active-status");
  }
  if (facts.location === "archive" && [facts.specStatus, facts.planStatus].some((status) => status && !["applied", "rejected", "cancelled", "superseded"].includes(status))) {
    states.push("invalid-archive-status");
  }
  if (facts.integrityErrors > 0) {
    states.push("integrity-issues");
  }
  if (facts.baselineFailures > 0) {
    states.push("stale-plan");
  }
  if (facts.location === "active" && facts.specStatus === "draft" && !facts.planStatus) {
    states.push("draft-spec");
  } else if (facts.location === "active" && facts.specStatus === "approved" && !facts.planStatus) {
    states.push("needs-plan");
  } else if (facts.location === "active" && facts.specStatus === "approved" && facts.planStatus === "draft") {
    states.push("needs-plan-approval");
  } else if (
    facts.location === "active"
    && facts.specStatus === "approved"
    && facts.planStatus === "approved"
    && facts.integrityErrors === 0
    && facts.baselineFailures === 0
  ) {
    states.push("ready-to-execute");
  }
  return [...new Set(states)];
}

function chooseNextAction(result: Omit<StatusResult, "nextAction">) {
  if (result.projectKind === "grace3") return `Use ${skillRef("migrate")} to migrate legacy GRACE 3 docs to ${ARTIFACT_DIR} artifacts.`;
  if (result.projectKind === "none") return `Run ${skillRef("init")} to create a neo-grace ${ARTIFACT_DIR} skeleton.`;
  if (result.derivedStates.includes("approved-contract-drift")) return "Hard stop: an approved spec.xml or plan.xml changed. Restore it or supersede and replan through a new C-* bundle.";
  if (result.derivedStates.includes("stale-plan")) return "Supersede and replan the stale approved change; do not edit the approved plan or continue execution.";
  if (result.integrity.errors > 0) return "Run ngrace lint --path <project-root> and fix neo-grace integrity errors.";
  if (result.derivedStates.includes("unexplained-observed-drift")) return `Use ${skillRef("refresh")} to reconcile unexplained repository changes through a new NgraceChangeSpec and NgraceChangePlan.`;
  if (result.derivedStates.includes("scope-overlap")) return "Review active change scope overlaps; replan or execute sequentially before parallel-safe work.";
  if (result.changes.some((change) => change.derivedStates.includes("ready-to-execute"))) return `Run ${skillRef("execute")} for approved active changes.`;
  if (result.changes.some((change) => change.derivedStates.includes("needs-plan"))) return `Run ${skillRef("plan")} for the approved NgraceChangeSpec.`;
  if (result.changes.some((change) => change.derivedStates.includes("needs-plan-approval"))) return "Review and approve the draft NgraceChangePlan, or replan if stale.";
  if (result.summary.activeChanges === 0) return `Create a change with ${skillRef("spec")}, then plan it with ${skillRef("plan")}.`;
  return "Project is healthy. Continue with the next approved neo-grace workflow step.";
}

function emptyStatus(root: string, projectKind: StatusResult["projectKind"], migrationGuidance?: string): StatusResult {
  const lint = lintGraceProject(root);
  const integrityErrors = lint.issues.filter((issue) => issue.severity === "error");
  const integrityWarnings = lint.issues.filter((issue) => issue.severity === "warning");
  const partial: Omit<StatusResult, "nextAction"> = {
    schemaVersion: "1.0.0",
    tool: "grace-status",
    generatedAt: new Date().toISOString(),
    root,
    projectKind,
    summary: {
      contextArtifacts: 0,
      graphModules: 0,
      verificationEntries: 0,
      activeChanges: 0,
      archivedChanges: 0,
      integrityErrors: integrityErrors.length,
      integrityWarnings: integrityWarnings.length,
      readyModules: 0,
      attentionModules: 0,
      blockedModules: 0,
    },
    changes: [],
    derivedStates: projectKind === "grace3" ? ["migration-candidate"] : ["missing-grace"],
    integrity: { errors: integrityErrors.length, warnings: integrityWarnings.length, topIssues: topIssues([...integrityErrors, ...integrityWarnings]) },
    observedDrift: { available: false, changedFiles: [], explainedFiles: [], unexplainedFiles: [] },
    migrationGuidance,
  };
  return { ...partial, nextAction: chooseNextAction(partial) };
}

/** Collects status without mutating any .ngrace artifact. */
export function collectProjectStatus(projectRoot: string, options: { includeModules?: boolean } = {}): StatusResult {
  const root = path.resolve(projectRoot);
  const kind = detectGraceProjectKind(root);
  if (kind === "grace3") return emptyStatus(root, "grace3", formatGrace3MigrationGuidance(root));
  if (kind === "none") return emptyStatus(root, "none");

  const paths = resolveNgracePaths(root);
  const lint = lintGraceProject(root, { profile: "standard" });
  const integrityErrors = lint.issues.filter((issue) => issue.severity === "error");
  const integrityWarnings = lint.issues.filter((issue) => issue.severity === "warning");
  // Load index once — reused by module health and status fields
  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  const activeScopes = collectActiveChangeScopes(paths);
  const ownership = createDurableOwnershipIndex(graph, verification);
  const overlapIssues = detectScopeOverlaps(activeScopes, ownership);
  const unsafeIssues = detectUnsafeConcurrentExecution(activeScopes, ownership);
  const rawChanges = [
    ...collectChangeBundleStatuses(root, "active", paths.changesActiveDir, lint.issues),
    ...collectChangeBundleStatuses(root, "archive", paths.changesArchiveDir, lint.issues),
  ];
  const collectedDrift = collectObservedDrift(root, activeScopes, buildDriftRouteIndex(root, graph, verification));
  const observedDrift = collectedDrift.drift;
  const approvedContractDrift = collectApprovedContractDrift(root, activeScopes, collectedDrift.trackedChangedFiles);
  const changes = rawChanges.map((change) => {
    if (!approvedContractDrift.has(change.changeId)) return change;
    return {
      ...change,
      derivedStates: [...new Set([...change.derivedStates.filter((state) => state !== "ready-to-execute"), "approved-contract-drift"])],
    };
  });
  const derivedStates = new Set<string>();
  if (overlapIssues.length > 0) derivedStates.add("scope-overlap");
  if (unsafeIssues.length > 0) derivedStates.add("unsafe-parallel-overlap");
  for (const change of changes) {
    for (const state of change.derivedStates) derivedStates.add(state);
  }
  if (observedDrift.explainedFiles.length > 0) derivedStates.add("explained-observed-drift");
  if (observedDrift.unexplainedFiles.length > 0) derivedStates.add("unexplained-observed-drift");

  let modules: ModuleHealthRecord[] | undefined;
  let evaluatedModules: ModuleHealthRecord[] | undefined;
  let moduleHealthLoadError: string | undefined;
  try {
    const index = loadGraceArtifactIndex(root);
    evaluatedModules = collectModuleHealth(index);
    if (options.includeModules) {
      modules = evaluatedModules;
    }
  } catch (error) {
    moduleHealthLoadError = error instanceof Error ? error.message : String(error);
  }

  const contextArtifacts = [
    "requirements.xml",
    "technology.xml",
    "principles.xml",
    "deployment.xml",
    "ux-guidelines.xml",
  ].filter((file) => existsSync(path.join(paths.contextDir, file))).length;

  const partial: Omit<StatusResult, "nextAction"> = {
    schemaVersion: "1.0.0",
    tool: "grace-status",
    generatedAt: new Date().toISOString(),
    root,
    projectKind: "grace4",
    summary: {
      graceVersion: "1.0",
      contextArtifacts,
      graphModules: graph.modules.size,
      verificationEntries: verification.entries.size,
      activeChanges: changes.filter((change) => change.location === "active").length,
      archivedChanges: changes.filter((change) => change.location === "archive").length,
      integrityErrors: integrityErrors.length,
      integrityWarnings: integrityWarnings.length,
      readyModules: evaluatedModules?.filter((module) => module.state === "ready").length ?? 0,
      attentionModules: evaluatedModules?.filter((module) => module.state === "attention").length ?? 0,
      blockedModules: evaluatedModules?.filter((module) => module.state === "blocked").length ?? 0,
    },
    changes,
    derivedStates: [...derivedStates].sort(),
    integrity: { errors: integrityErrors.length, warnings: integrityWarnings.length, topIssues: topIssues([...integrityErrors, ...integrityWarnings]) },
    observedDrift,
    modules,
    moduleHealthLoadError,
    analysisCoverage: lint.analysisCoverage,
  };
  return { ...partial, nextAction: chooseNextAction(partial) };
}

export function formatStatusText(result: StatusResult) {
  const lines = [
    "neo-grace Status",
    "=".repeat(16),
    `Root: ${result.root}`,
    `Project Kind: ${result.projectKind}`,
    "",
    "Summary",
    `- Context artifacts: ${result.summary.contextArtifacts}`,
    `- Graph modules: ${result.summary.graphModules}`,
    `- Verification entries: ${result.summary.verificationEntries}`,
    `- Active changes: ${result.summary.activeChanges}`,
    `- Archived changes: ${result.summary.archivedChanges}`,
    `- Integrity: ${result.summary.integrityErrors} errors, ${result.summary.integrityWarnings} warnings`,
    `- Derived states: ${result.derivedStates.join(", ") || "none"}`,
  ];

  if (result.migrationGuidance) lines.push("", "Migration Guidance", `- ${result.migrationGuidance}`);

  lines.push("", "Changes");
  if (result.changes.length === 0) {
    lines.push("- none");
  } else {
    for (const change of result.changes) {
      const epochPart = change.epochCount !== undefined ? ` epochs=${change.epochCount}` : "";
      const taskPart = change.taskCount !== undefined ? ` tasks=${change.taskCount}` : "";
      lines.push(
        `- ${change.changeId} [${change.location}] spec=${change.specStatus ?? "missing"} plan=${change.planStatus ?? "missing"}${epochPart}${taskPart} states=${change.derivedStates.join(",") || "none"}`,
      );
    }
  }

  lines.push("", "Integrity Snapshot", `- Errors: ${result.integrity.errors}`, `- Warnings: ${result.integrity.warnings}`);
  for (const issue of result.integrity.topIssues) lines.push(`- ${issue}`);
  lines.push(
    "",
    "Observed Drift",
    `- Available: ${result.observedDrift.available ? "yes" : "no"}`,
    `- Changed files: ${result.observedDrift.changedFiles.length}`,
    `- Explained by active approved changes: ${result.observedDrift.explainedFiles.length}`,
    `- Unexplained: ${result.observedDrift.unexplainedFiles.length}`,
  );
  for (const file of result.observedDrift.unexplainedFiles.slice(0, 10)) lines.push(`- unexplained: ${file}`);

  if (result.analysisCoverage) {
    const coverage = result.analysisCoverage;
    const adapterExts = coverage.adapterBacked.map((entry) => entry.extension).join(", ");
    const adapterFiles = coverage.adapterBacked.reduce((sum, entry) => sum + entry.files, 0);
    lines.push("", "Analysis Coverage");
    lines.push(`- Adapter-backed: ${adapterFiles} files (${adapterExts || "none"})`);
    const unverifiedFiles = coverage.unverified.reduce((sum, entry) => sum + entry.files, 0);
    if (unverifiedFiles > 0) {
      const unverifiedExts = coverage.unverified.map((entry) => entry.extension).join(", ");
      lines.push(`- Unverified:    ${unverifiedFiles} files (${unverifiedExts})  <- MODULE_MAP parity not enforced`);
    }
  }

  if (result.modules && result.modules.length > 0) lines.push("", "Module Health", formatModuleHealthTable(result.modules));
  if (result.moduleHealthLoadError) lines.push("", "Module Health", `- unavailable: ${result.moduleHealthLoadError}`);
  lines.push("", "Suggested Next Action", `- ${result.nextAction}`);
  return lines.join("\n");
}

function collectObservedDrift(root: string, activeScopes: ActiveChangeScope[], routes: DriftRouteIndex): CollectedObservedDrift {
  const statusResult = Bun.spawnSync({
    cmd: ["git", "-c", "status.relativePaths=true", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (statusResult.exitCode !== 0) {
    return { drift: { available: false, changedFiles: [], explainedFiles: [], unexplainedFiles: [] }, trackedChangedFiles: new Set() };
  }

  const statusOutput = new TextDecoder().decode(statusResult.stdout);
  const { changedFiles, trackedChangedFiles } = parsePorcelainV1ZPaths(statusOutput);

  const approvedScopes = activeScopes.filter((scope) => scope.specStatus === "approved" && scope.planStatus === "approved");
  const explainedFiles = changedFiles.filter((file) => approvedScopes.some((scope) => activeScopeExplainsFile(root, scope, file, routes, trackedChangedFiles)));
  const explained = new Set(explainedFiles);
  return {
    drift: {
      available: true,
      changedFiles,
      explainedFiles,
      unexplainedFiles: changedFiles.filter((file) => !explained.has(file)),
    },
    trackedChangedFiles,
  };
}

function parsePorcelainV1ZPaths(output: string): { changedFiles: string[]; trackedChangedFiles: Set<string> } {
  const records = output.split("\0");
  const authoredPaths: Array<{ path: string; tracked: boolean }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    const tracked = status !== "??";
    authoredPaths.push({ path: record.slice(3), tracked });
    if (status.includes("R") || status.includes("C")) {
      const sourcePath = records[index + 1];
      if (sourcePath) authoredPaths.push({ path: sourcePath, tracked: true });
      index += 1;
    }
  }

  const normalized = authoredPaths
    .map((entry) => ({ ...entry, path: entry.path.replaceAll("\\", "/").replace(/^\.\//, "") }))
    .filter((entry) => entry.path !== "" && !entry.path.startsWith("../") && entry.path !== ".." && !path.posix.isAbsolute(entry.path));
  return {
    changedFiles: [...new Set(normalized.map((entry) => entry.path))].sort(),
    trackedChangedFiles: new Set(normalized.filter((entry) => entry.tracked).map((entry) => entry.path)),
  };
}

function activeScopeExplainsFile(root: string, scope: ActiveChangeScope, file: string, routes: DriftRouteIndex, trackedChangedFiles: ReadonlySet<string>): boolean {
  if (observedWriteScopeContains(scope.observedWrites, file)) {
    return true;
  }

  const bundlePath = path.relative(root, scope.bundlePath).replaceAll(path.sep, "/");
  if (trackedChangedFiles.has(file) && (file === `${bundlePath}/spec.xml` || file === `${bundlePath}/plan.xml`)) {
    return false;
  }
  if (file === bundlePath || file.startsWith(`${bundlePath}/`)) {
    return true;
  }

  if (file.startsWith(`${ARTIFACT_DIR}/context/`)) {
    const contextFile = path.basename(file);
    return scope.durable.contextArtifacts.some((artifact) => artifact === contextFile || artifact.endsWith(`/${contextFile}`));
  }
  if (file.startsWith(`${ARTIFACT_DIR}/graph/`)) {
    const route = routes.graphFiles.get(file);
    return Boolean(route && (
      scope.durable.graphDocuments.some((document) => route.documents.has(document))
      || scope.durable.graphAnchors.some((anchor) => route.anchors.has(anchor))
    ));
  }
  if (file.startsWith(`${ARTIFACT_DIR}/verification/`)) {
    const route = routes.verificationFiles.get(file);
    return Boolean(route && (
      scope.durable.verificationDocuments.some((document) => route.documents.has(document))
      || scope.durable.verificationAnchors.some((anchor) => route.anchors.has(anchor))
    ));
  }
  return false;
}

function buildDriftRouteIndex(root: string, graph: GraphProjection, verification: VerificationProjection): DriftRouteIndex {
  const routes: DriftRouteIndex = { graphFiles: new Map(), verificationFiles: new Map() };
  const paths = resolveNgracePaths(root);
  // Document absolute paths are realpathed; project root may be lexical (macOS /var vs /private/var).
  routes.graphFiles.set(toProjectRelativePath(root, paths.graphIndex), {
    documents: new Set(graph.documents.keys()),
    anchors: new Set([...graph.modules.keys(), ...graph.dataFlows.keys(), ...graph.interfaceContracts.keys()]),
  });
  routes.verificationFiles.set(toProjectRelativePath(root, paths.verificationIndex), {
    documents: new Set(verification.documents.keys()),
    anchors: new Set(verification.entries.keys()),
  });
  for (const [document, file] of graph.documents) {
    const relativeFile = toProjectRelativePath(root, file);
    const anchors = new Set(
      [...graph.modules.values(), ...graph.dataFlows.values(), ...graph.interfaceContracts.values()]
        .filter((record) => record.owner === document)
        .map((record) => record.id),
    );
    routes.graphFiles.set(relativeFile, { documents: new Set([document]), anchors });
  }
  for (const [document, file] of verification.documents) {
    const relativeFile = toProjectRelativePath(root, file);
    const anchors = new Set([...verification.entries.values()].filter((record) => record.owner === document).map((record) => record.id));
    routes.verificationFiles.set(relativeFile, { documents: new Set([document]), anchors });
  }
  return routes;
}

function collectApprovedContractDrift(root: string, activeScopes: ActiveChangeScope[], trackedChangedFiles: ReadonlySet<string>): Set<string> {
  return new Set(activeScopes
    .filter((scope) => scope.specStatus === "approved" && scope.planStatus === "approved")
    .filter((scope) => {
      const bundlePath = path.relative(root, scope.bundlePath).replaceAll(path.sep, "/");
      return trackedChangedFiles.has(`${bundlePath}/spec.xml`) || trackedChangedFiles.has(`${bundlePath}/plan.xml`);
    })
    .map((scope) => scope.changeId));
}

function resolveFormat(format: unknown, json: unknown) {
  const resolved = Boolean(json) ? "json" : String(format ?? "text");
  if (resolved !== "text" && resolved !== "json") throw new GraceCommandError("invalid-arguments", `Unsupported format \`${resolved}\`. Use \`text\` or \`json\`.`);
  return resolved;
}

function resolveWithList(value: unknown) {
  return String(value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function resolveFailOn(value: unknown) {
  const failOn = String(value ?? "never");
  if (failOn !== "never" && failOn !== "errors" && failOn !== "warnings") throw new GraceCommandError("invalid-arguments", `Unsupported fail-on policy \`${failOn}\`. Use \`never\`, \`errors\`, or \`warnings\`.`);
  return failOn;
}

function shouldFail(result: StatusResult, failOn: string) {
  const errorCount = result.summary.integrityErrors + result.summary.blockedModules;
  const warningCount = result.summary.integrityWarnings + result.summary.attentionModules;
  if (failOn === "never") return false;
  if (failOn === "warnings") return errorCount + warningCount > 0;
  return errorCount > 0;
}

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show neo-grace durable health, active/archive changes, derived states, and next action.",
  },
  args: {
    path: { type: "string", alias: "p", description: "Project root to inspect", default: "." },
    format: { type: "string", alias: "f", description: "Output format: text or json", default: "text" },
    json: { type: "boolean", description: "Shortcut for --format json", default: false },
    with: { type: "string", description: "Optional extras, currently supports: modules", default: "" },
    failOn: { type: "string", description: "Exit policy: never, errors, or warnings", default: "never" },
  },
  async run(context) {
    const errorFormat = Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
    await runGraceCommand(errorFormat, () => {
      const format = resolveFormat(context.args.format, context.args.json);
      const withValues = resolveWithList(context.args.with);
      const failOn = resolveFailOn(context.args.failOn);
      const result = collectProjectStatus(String(context.args.path ?? "."), { includeModules: withValues.includes("modules") });

      if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`${formatStatusText(result)}\n`);
      process.exitCode = shouldFail(result, failOn) ? 1 : 0;
    }, "Unable to collect GRACE status. Check the project path and run again.");
  },
});

if (import.meta.main) {
  await runMain(statusCommand as CommandDef);
}
