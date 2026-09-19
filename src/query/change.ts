// START_MODULE_CONTRACT
//   PURPOSE: Artifact query and navigation CLI
//   SCOPE: Change-bundle query reader: close-bound criteria, plan scopes, and the latest verdict tally
//   DEPENDS: none
//   LINKS: M-QUERY
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ChangeBundleListing
//   ChangeCriterionTally
//   ChangeDurableScope
//   ChangeDurableSummary
//   ChangeScopeSummary
//   ChangeView
//   collectChangeView
//   findChangeBundles
// END_MODULE_MAP
import { existsSync } from "node:fs";
import path from "node:path";

import { collectCloseBoundCriterionIds } from "../artifact/grammar";
import { resolveNgracePaths } from "../artifact/project";
import { collectActiveChangeScopes, collectAppliedChangeScopes, type DurableScope } from "../artifact/scope";
import { ANCHOR_PATTERNS } from "../artifact/types";
import { readGraceXmlArtifact } from "../artifact/xml";
import { collectProjectStatus, derivedStatesForChange } from "../grace-status";
import { readLatestReviewVerdict } from "../gates/ledger";
import { GraceCommandError } from "./errors";

/** One recorded close-evidence evaluation on a Verdict. */
export type ChangeCriterionTally = { criterionId: string; exit: string; result: string };

/** Observed write scope as the shipped scope reader returns it. */
export type ChangeScopeSummary = { files: string[]; globs: string[] };

/** Durable scope as the shipped active-scope reader returns it (active bundles only). */
export type ChangeDurableSummary = {
  graphAnchors: string[];
  verificationAnchors: string[];
  graphDocuments: string[];
  verificationDocuments: string[];
  contextArtifacts: string[];
  optionalContextArtifacts: string[];
};

/** Durable scope as the shipped readers label it: the plan's declared anchors, a declared
 * `<None />` (`declared-none`), or no carried scope at all (`absent`). */
export type ChangeDurableScope =
  | { state: "carried"; scope: ChangeDurableSummary }
  | { state: "declared-none" }
  | { state: "absent" };

/** One change bundle's derived state, for `change find`. */
export type ChangeBundleListing = {
  changeId: string;
  location: "active" | "archive";
  specStatus: string | null;
  planStatus: string | null;
  derivedStates: string[];
};

/** The change-bundle view `ngrace change show` prints. */
export type ChangeView = {
  changeId: string;
  location: "active" | "archive";
  path: string;
  specStatus: string | null;
  planStatus: string | null;
  closeBoundCriteria: string[];
  observedWriteScope: ChangeScopeSummary | null;
  durableScope: ChangeDurableScope;
  /** Integrity signal: derived states from the shipped status reader (missing spec status, drift, …). */
  derivedStates: string[];
  verdict: {
    outcome: string;
    scope?: string;
    classification?: string;
    closeEvidence: ChangeCriterionTally[];
  } | null;
};

function isArchivePath(bundlePath: string): boolean {
  return bundlePath.includes(`${path.sep}changes${path.sep}archive${path.sep}`);
}

/** Maps one plan's durable scope to the carried/`<None />` label the view prints. */
function durableScopeFrom(durable: DurableScope): ChangeDurableScope {
  const carried: ChangeDurableSummary = {
    graphAnchors: durable.graphAnchors,
    verificationAnchors: durable.verificationAnchors,
    graphDocuments: durable.graphDocuments,
    verificationDocuments: durable.verificationDocuments,
    contextArtifacts: durable.contextArtifacts,
    optionalContextArtifacts: durable.optionalContextArtifacts,
  };
  const empty = carried.graphAnchors.length === 0
    && carried.verificationAnchors.length === 0
    && carried.graphDocuments.length === 0
    && carried.verificationDocuments.length === 0
    && carried.contextArtifacts.length === 0
    && carried.optionalContextArtifacts.length === 0;
  return empty ? { state: "declared-none" } : { state: "carried", scope: carried };
}

function changeWrapper(root: ReturnType<typeof readGraceXmlArtifact>["root"]) {
  return root?.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
}

/**
 * Resolve a bundle path without throwing for absence; mirrors `resolveChangeBundle`'s
 * two locations but keeps the not-found refusal in the command layer.
 */
function resolveBundlePath(projectRoot: string, changeId: string): string | null {
  const paths = resolveNgracePaths(projectRoot);
  for (const location of ["active", "archive"] as const) {
    const candidate = path.join(location === "active" ? paths.changesActiveDir : paths.changesArchiveDir, changeId);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every bundle with its spec/plan status and derived states, via the shipped status reader. */
export function findChangeBundles(projectRoot: string, query?: string): ChangeBundleListing[] {
  const status = collectProjectStatus(projectRoot);
  const normalized = query?.trim().toLowerCase();
  return status.changes
    .map((change) => ({
      changeId: change.changeId,
      location: change.location,
      specStatus: change.specStatus ?? null,
      planStatus: change.planStatus ?? null,
      derivedStates: change.derivedStates,
    }))
    .filter((change) => !normalized || change.changeId.toLowerCase().includes(normalized))
    .sort((left, right) => left.changeId.localeCompare(right.changeId));
}

/** Read one change bundle through the shipped readers. Throws `not-found` / `invalid-project`. */
export function collectChangeView(projectRoot: string, changeId: string): ChangeView {
  const bundlePath = resolveBundlePath(projectRoot, changeId);
  if (!bundlePath) {
    throw new GraceCommandError("not-found", `No change bundle found for \`${changeId}\`.`);
  }
  const location: "active" | "archive" = isArchivePath(bundlePath) ? "archive" : "active";

  const specPath = path.join(bundlePath, "spec.xml");
  const spec = existsSync(specPath) ? readGraceXmlArtifact(specPath) : null;
  if (spec && !spec.root) {
    throw new GraceCommandError("invalid-project", `spec.xml is present but unparsable in \`${changeId}\`.`, {
      issues: ["project.unreadable-artifact"],
    });
  }
  const specStatus = spec?.root?.attributes.status ?? null;
  const wrapper = changeWrapper(spec?.root ?? null);
  const closeBoundCriteria = wrapper ? [...collectCloseBoundCriterionIds(wrapper)].sort() : [];

  const planPath = path.join(bundlePath, "plan.xml");
  const plan = existsSync(planPath) ? readGraceXmlArtifact(planPath) : null;
  if (plan && !plan.root) {
    throw new GraceCommandError("invalid-project", `plan.xml is present but unparsable in \`${changeId}\`.`, {
      issues: ["project.unreadable-artifact"],
    });
  }
  const planStatus = plan?.root?.attributes.status ?? null;

  const paths = resolveNgracePaths(projectRoot);
  let observedWriteScope: ChangeScopeSummary | null = null;
  let durableScope: ChangeDurableScope = { state: "absent" };
  if (location === "active") {
    const scope = collectActiveChangeScopes(paths).find((candidate) => candidate.changeId === changeId);
    if (scope) {
      observedWriteScope = { files: scope.observedWrites.files, globs: scope.observedWrites.globs };
      durableScope = durableScopeFrom(scope.durable);
    }
  } else {
    const scope = collectAppliedChangeScopes(paths).find((candidate) => candidate.changeId === changeId);
    if (scope) {
      observedWriteScope = { files: scope.observedWrites.files, globs: scope.observedWrites.globs };
      durableScope = durableScopeFrom(scope.durable);
    }
  }

  const derivedStates = derivedStatesForChange(projectRoot, changeId);

  const latest = readLatestReviewVerdict(projectRoot, changeId);
  if (latest.state === "invalid") {
    throw new GraceCommandError("invalid-project", `${latest.code}: ${latest.detail}`, { issues: [latest.code] });
  }
  const verdict = latest.state === "present"
    ? {
      outcome: latest.verdict.outcome,
      ...(latest.verdict.scope ? { scope: latest.verdict.scope } : {}),
      ...(latest.verdict.classification ? { classification: latest.verdict.classification } : {}),
      closeEvidence: latest.verdict.closeEvidence ?? [],
    }
    : null;

  return {
    changeId,
    location,
    path: bundlePath,
    specStatus,
    planStatus,
    closeBoundCriteria,
    observedWriteScope,
    durableScope,
    derivedStates,
    verdict,
  };
}
