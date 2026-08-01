// START_MODULE_CONTRACT
//   PURPOSE: Plan-quality signal from review outcomes (D10)
//   SCOPE: Scope-aware verdict reads, resolution classification report, decomposition precondition
//   DEPENDS: none
//   LINKS: M-REVIEW
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   PLAN_QUALITY_PROXY_CAVEAT
//   PlanQualityReport
//   PlanQualityUnreadableBundle
//   PlanQualityVerdictRow
//   collectPlanQualityReport
//   computeConstituentTasksPassed
//   formatPlanQualityText
//   proposeResolutionClassification
// END_MODULE_MAP

/**
 * Plan-quality report (D10 / Phase 10 / A70–A72).
 *
 * Scope, classification, and constituentTasksPassed are **stored** on Verdict at write
 * time (rule 13). This module never invents scope for historical unscoped verdicts
 * (corr 182) and never pools task- and wave-scoped outcomes into one unlabeled rate.
 *
 * Unreadable Verdicts sections are recorded as absence (corr 183) — never catch-and-skip
 * into a shorter, cleaner-looking corpus (A31.2 / D5 / anti-pattern 8).
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { resolveNgracePaths } from "../artifact/project";
import { ANCHOR_PATTERNS } from "../artifact/types";
import { readGraceXmlArtifact, type GraceXmlNode } from "../artifact/xml";
import {
  readLedgerVerdictsSurface,
  type ResolutionClassification,
  type ReviewVerdictRecord,
  type ReviewVerdictScope,
} from "../gates/ledger";
import { resolveChangeBundle } from "../grace-cursor";

/** Frozen wording (A70.8 / P6). Shared by text and JSON. */
export const PLAN_QUALITY_PROXY_CAVEAT =
  "Proxy caveat: a code-only fix can paper over a plan defect and is scored as implementation. This classification is a proxy, not a ground truth.";

export type PlanQualityVerdictRow = {
  changeId: string;
  outcome: ReviewVerdictRecord["outcome"];
  /** Present only when stored on the Verdict; never inferred. */
  scope?: ReviewVerdictScope;
  scopeStatus: "recorded" | "scope-not-recorded";
  classification?: ResolutionClassification;
  classificationStatus: "stored" | "unstored";
  constituentTasksPassed?: boolean;
  constituentTasksPassedReason?: string;
  isDecompositionCandidate: boolean;
};

/** Bundle whose Verdicts section could not be read (corr 183 / A31.2). */
export type PlanQualityUnreadableBundle = {
  changeId: string;
  code: string;
  detail: string;
};

export type PlanQualityReport = {
  schemaVersion: "1.0.0";
  tool: "grace-plan-quality";
  root: string;
  /**
   * Readable verdict rows only. Unreadable bundles are not converted into a shorter total —
   * they appear in `unreadable` and in the summary sentence (corr 183).
   */
  verdictsTotal: number;
  scoped: number;
  scopeNotRecorded: number;
  /** Counts by recorded scope only — never a pooled rate across scopes. */
  byScope: { task: number; wave: number; bundle: number };
  classifications: {
    implementation: number;
    plan: number;
    unstored: number;
  };
  /** scope=wave ∧ outcome=fail ∧ stored constituentTasksPassed=true */
  decompositionCandidates: number;
  /**
   * Bundles whose run-ledger Verdicts section threw ledger.invalid-verdict (or equivalent).
   * Empty on a clean tree. Never silently omitted (corr 183).
   */
  unreadable: PlanQualityUnreadableBundle[];
  proxyCaveat: typeof PLAN_QUALITY_PROXY_CAVEAT;
  rows: PlanQualityVerdictRow[];
  summary: string;
};

function listChangeIds(projectRoot: string): string[] {
  const paths = resolveNgracePaths(projectRoot);
  const ids: string[] = [];
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ANCHOR_PATTERNS.change.test(entry.name)) {
        ids.push(entry.name);
      }
    }
  }
  return ids.sort();
}

function toRow(changeId: string, verdict: ReviewVerdictRecord): PlanQualityVerdictRow {
  const scopeStatus = verdict.scope ? "recorded" : "scope-not-recorded";
  const classificationStatus = verdict.classification ? "stored" : "unstored";
  const isDecompositionCandidate =
    verdict.scope === "wave" &&
    verdict.outcome === "fail" &&
    verdict.constituentTasksPassed === true;
  return {
    changeId,
    outcome: verdict.outcome,
    ...(verdict.scope ? { scope: verdict.scope } : {}),
    scopeStatus,
    ...(verdict.classification ? { classification: verdict.classification } : {}),
    classificationStatus,
    ...(verdict.constituentTasksPassed !== undefined
      ? { constituentTasksPassed: verdict.constituentTasksPassed }
      : {}),
    ...(verdict.constituentTasksPassedReason
      ? { constituentTasksPassedReason: verdict.constituentTasksPassedReason }
      : {}),
    isDecompositionCandidate,
  };
}

/**
 * Build the plan-quality report from stored Verdict attributes only.
 * Does not invent scope for unscoped history (corr 182).
 * Unreadable ledgers are named absences, never silent skips (corr 183 / 185).
 * Uses readLedgerVerdictsSurface so parse failures are not collapsed to absent (corr 185).
 */
export function collectPlanQualityReport(projectRoot: string): PlanQualityReport {
  const root = path.resolve(projectRoot);
  const rows: PlanQualityVerdictRow[] = [];
  const unreadable: PlanQualityUnreadableBundle[] = [];

  for (const changeId of listChangeIds(root)) {
    const surface = readLedgerVerdictsSurface(root, changeId);
    if (surface.state === "absent-no-file") {
      // No run-ledger.xml: zero verdicts, not unreadable (corr 183/185 discriminating negative).
      continue;
    }
    if (surface.state === "unreadable") {
      unreadable.push({
        changeId,
        code: surface.code,
        detail: surface.detail,
      });
      continue;
    }
    for (const v of surface.verdicts) {
      rows.push(toRow(changeId, v));
    }
  }

  rows.sort((a, b) => {
    const c = a.changeId.localeCompare(b.changeId);
    return c !== 0 ? c : a.outcome.localeCompare(b.outcome);
  });
  unreadable.sort((a, b) => a.changeId.localeCompare(b.changeId));

  const byScope = { task: 0, wave: 0, bundle: 0 };
  let scopeNotRecorded = 0;
  let implementation = 0;
  let plan = 0;
  let unstored = 0;
  let decompositionCandidates = 0;

  for (const row of rows) {
    if (row.scopeStatus === "scope-not-recorded") {
      scopeNotRecorded += 1;
    } else if (row.scope) {
      byScope[row.scope] += 1;
    }
    if (row.classification === "implementation") implementation += 1;
    else if (row.classification === "plan") plan += 1;
    else unstored += 1;
    if (row.isDecompositionCandidate) decompositionCandidates += 1;
  }

  const scoped = byScope.task + byScope.wave + byScope.bundle;
  const report: PlanQualityReport = {
    schemaVersion: "1.0.0",
    tool: "grace-plan-quality",
    root,
    verdictsTotal: rows.length,
    scoped,
    scopeNotRecorded,
    byScope,
    classifications: { implementation, plan, unstored },
    decompositionCandidates,
    unreadable,
    proxyCaveat: PLAN_QUALITY_PROXY_CAVEAT,
    rows,
    summary: "",
  };
  report.summary = buildSummary(report);
  return report;
}

function formatUnreadableClause(unreadable: PlanQualityUnreadableBundle[]): string {
  if (unreadable.length === 0) return "";
  const codes = [...new Set(unreadable.map((u) => u.code))].sort();
  const codePart = codes.join(", ");
  const n = unreadable.length;
  const noun = n === 1 ? "bundle" : "bundles";
  const ids = unreadable.map((u) => u.changeId).join(", ");
  return (
    ` ${n} ${noun} unreadable (${codePart}) and excluded from every count` +
    (n <= 3 ? `: ${ids}.` : `.`)
  );
}

function buildSummary(report: PlanQualityReport): string {
  const {
    scoped,
    scopeNotRecorded,
    classifications,
    decompositionCandidates,
    verdictsTotal,
    unreadable,
  } = report;
  const unreadableClause = formatUnreadableClause(unreadable);
  // No rate table. No "0% plan defects". No "plan quality: OK" (P7 / rule 11).
  // Spacing before caveat is a single literal space (corr 186 — no dead ternary).
  if (scoped === 0) {
    return (
      `Plan-quality report: 0 review verdicts with recorded scope, ` +
      `${classifications.implementation + classifications.plan} resolution classifications, ` +
      `${decompositionCandidates} decomposition candidates. ` +
      `No plan-quality rate is computed. ` +
      `${scopeNotRecorded} verdicts lack scope (scope-not-recorded) and are excluded from rates.` +
      unreadableClause +
      ` ` +
      PLAN_QUALITY_PROXY_CAVEAT
    );
  }
  return (
    `Plan-quality report: ${scoped} review verdicts with recorded scope ` +
    `(task=${report.byScope.task}, wave=${report.byScope.wave}, bundle=${report.byScope.bundle}), ` +
    `${scopeNotRecorded} scope-not-recorded of ${verdictsTotal} readable total.` +
    unreadableClause +
    ` ` +
    `Classifications stored: implementation=${classifications.implementation}, plan=${classifications.plan}, unstored=${classifications.unstored}. ` +
    `Decomposition candidates (wave fail + stored all-tasks-passed): ${decompositionCandidates}. ` +
    `Task- and wave-scoped outcomes are not pooled. ` +
    PLAN_QUALITY_PROXY_CAVEAT
  );
}

/** Text form for doctor. Caveat is always adjacent to the summary counts. */
export function formatPlanQualityText(report: PlanQualityReport): string {
  const lines = [
    "Plan quality",
    "-".repeat(12),
    report.summary,
    `  verdicts total (readable): ${report.verdictsTotal}`,
    `  scoped: ${report.scoped} (task=${report.byScope.task}, wave=${report.byScope.wave}, bundle=${report.byScope.bundle})`,
    `  scope-not-recorded: ${report.scopeNotRecorded}`,
    `  classifications: implementation=${report.classifications.implementation}, plan=${report.classifications.plan}, unstored=${report.classifications.unstored}`,
    `  decomposition candidates: ${report.decompositionCandidates}`,
    `  unreadable bundles: ${report.unreadable.length}`,
  ];
  if (report.unreadable.length > 0) {
    for (const u of report.unreadable) {
      lines.push(`    - ${u.changeId}: ${u.code} — ${u.detail}`);
    }
  }
  lines.push(`  ${report.proxyCaveat}`);
  return lines.join("\n");
}

/**
 * Deterministic proposal only — never silent code-only residual (P4).
 * Supersede + Replacement → propose plan; otherwise unknown with a reason.
 */
export function proposeResolutionClassification(
  projectRoot: string,
  changeId: string,
):
  | { proposal: "plan"; evidence: "superseded"; replacement: string }
  | { proposal: "unknown"; reason: string } {
  const root = path.resolve(projectRoot);
  let bundlePath: string;
  try {
    bundlePath = resolveChangeBundle(root, changeId);
  } catch {
    return { proposal: "unknown", reason: `bundle ${changeId} not found under active/ or archive/` };
  }
  for (const name of ["spec.xml", "plan.xml"]) {
    const file = path.join(bundlePath, name);
    if (!existsSync(file)) continue;
    const artifact = readGraceXmlArtifact(file);
    if (artifact.root?.attributes.status !== "superseded") continue;
    const wrapper = artifact.root.children.find((c) => c.tag === changeId);
    if (!wrapper) continue;
    const replacement = findReplacement(wrapper);
    if (replacement) {
      return { proposal: "plan", evidence: "superseded", replacement };
    }
    return {
      proposal: "unknown",
      reason: `${name} is superseded but has no Replacement / replacement C-* child`,
    };
  }
  return {
    proposal: "unknown",
    reason:
      "no superseded status with Replacement on this bundle; code-only implementation classification must be asserted explicitly (never a silent residual)",
  };
}

function findReplacement(wrapper: GraceXmlNode): string | undefined {
  for (const child of wrapper.children) {
    if (child.tag === "Replacement" || child.tag === "ReplacementChange") {
      const text = child.text.trim();
      if (ANCHOR_PATTERNS.change.test(text)) return text;
    }
    if (ANCHOR_PATTERNS.change.test(child.tag) && child.tag !== wrapper.tag) {
      return child.tag;
    }
  }
  return undefined;
}

/**
 * Compute constituent-tasks-passed from the ledger **at call time** for storage on a
 * wave-scoped fail Verdict. Result must be written into the Verdict; report reads storage only.
 */
export function computeConstituentTasksPassed(
  projectRoot: string,
  changeId: string,
  wave: string,
):
  | { value: true }
  | { value: false }
  | { value: "unknown"; reason: string } {
  const root = path.resolve(projectRoot);
  let bundlePath: string;
  try {
    bundlePath = resolveChangeBundle(root, changeId);
  } catch {
    return { value: "unknown", reason: `bundle ${changeId} not found` };
  }

  const ledgerPath = path.join(bundlePath, "run-ledger.xml");
  if (!existsSync(ledgerPath)) {
    return { value: "unknown", reason: "no run-ledger.xml — cannot verify constituent tasks" };
  }
  const artifact = readGraceXmlArtifact(ledgerPath);
  const wrapper = artifact.root?.children.find((c) => c.tag === changeId);
  if (!wrapper) {
    return { value: "unknown", reason: "ledger wrapper missing for change" };
  }

  const matchingEpochs = wrapper.children.filter(
    (c) => /^Epoch-\d+$/.test(c.tag) && (c.attributes.wave ?? "").trim() === wave,
  );
  if (matchingEpochs.length === 0) {
    return {
      value: "unknown",
      reason: `no Epoch-N with wave=${JSON.stringify(wave)} in ledger — tasks-unverifiable`,
    };
  }

  const taskIds = new Set<string>();
  const attemptOutcome = new Map<string, string>();
  const hasTerminal = new Set<string>();

  for (const epoch of matchingEpochs) {
    for (const child of epoch.children) {
      if (child.tag !== "Event") continue;
      const task = (child.attributes.task ?? "").trim();
      const kind = (child.attributes.kind ?? "").trim();
      if (!task) continue;
      taskIds.add(task);
      if (kind === "attempt" && child.attributes.outcome) {
        attemptOutcome.set(task, child.attributes.outcome);
      }
      if (kind === "terminal") {
        hasTerminal.add(task);
      }
    }
  }

  if (taskIds.size === 0) {
    return { value: "unknown", reason: "wave epoch has no task events — tasks-unverifiable" };
  }

  let allPassed = true;
  for (const task of taskIds) {
    const outcome = attemptOutcome.get(task);
    if (outcome === "fail") {
      return { value: false };
    }
    if (outcome !== "pass" || !hasTerminal.has(task)) {
      allPassed = false;
    }
  }
  if (!allPassed) {
    return {
      value: "unknown",
      reason: "one or more constituent tasks lack pass attempt + terminal — tasks-unverifiable",
    };
  }
  return { value: true };
}
