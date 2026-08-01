// START_MODULE_CONTRACT
//   PURPOSE: Artifact query and navigation CLI
//   SCOPE: Module, file, graph, and verification resolution
//   DEPENDS: none
//   LINKS: M-QUERY
//   ROLE: TYPES
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FileBlockRecord
//   FileContractRecord
//   FileFieldSection
//   FileListItem
//   FileMarkupRecord
//   GraceArtifactIndex
//   ModuleFindOptions
//   ModuleGraphRecord
//   ModuleHealthIssue
//   ModuleHealthRecord
//   ModuleInterfaceItem
//   ModuleMatch
//   ModuleRecord
//   ModuleVerificationRecord
//   NgraceModuleRecord
//   VerificationFindOptions
//   VerificationMatch
//   VerificationScenario
// END_MODULE_MAP
import type { NgraceIssue } from "../artifact/types";
import type { GraphAnchorRecord, GraphProjection, VerificationProjection } from "../artifact/projections";
import type { FileMarkupRecord } from "../project-utils";

export type { FileBlockRecord, FileContractRecord, FileFieldSection, FileListItem, FileMarkupRecord } from "../project-utils";

export type ModuleInterfaceItem = {
  tag: string;
  purpose?: string;
  text?: string;
};

export type VerificationScenario = {
  tag: string;
  kind?: string;
  text: string;
};

export type ModuleVerificationRecord = {
  id: string;
  moduleId?: string;
  priority?: string;
  cwd?: string;
  testFiles: string[];
  moduleChecks: string[];
  scenarios: VerificationScenario[];
  requiredLogMarkers: string[];
  requiredTraceAssertions: string[];
  accessibilityChecks: string[];
  visualChecks: string[];
  waveFollowUp?: string;
  phaseFollowUp?: string;
};

export type ModuleGraphRecord = GraphAnchorRecord & {
  name?: string;
  type?: string;
  status?: string;
  purpose?: string;
  path?: string;
  depends: string[];
  annotations: ModuleInterfaceItem[];
  /** Declared ST-* UI states (from graph <States>). */
  states: string[];
};

export type NgraceModuleRecord = {
  id: string;
  name?: string;
  type?: string;
  graph: ModuleGraphRecord;
  verification: ModuleVerificationRecord | null;
  verifications: ModuleVerificationRecord[];
  localFiles: FileMarkupRecord[];
  /** neo-grace query layer is projection-backed; development-plan records are intentionally absent. */
  plan: null;
  steps: [];
};

export type ModuleRecord = NgraceModuleRecord;

export type GraceArtifactIndex = {
  root: string;
  graph: GraphProjection;
  verification: VerificationProjection;
  modules: NgraceModuleRecord[];
  verifications: ModuleVerificationRecord[];
  files: FileMarkupRecord[];
  issues: NgraceIssue[];
};

export type ModuleFindOptions = {
  query?: string;
  type?: string;
  dependsOn?: string;
};

export type ModuleMatch = {
  module: NgraceModuleRecord;
  score: number;
  matchedBy: string[];
};

export type VerificationFindOptions = {
  query?: string;
  module?: string;
  priority?: string;
};

export type VerificationMatch = {
  verification: ModuleVerificationRecord;
  module: NgraceModuleRecord | null;
  score: number;
  matchedBy: string[];
};

export type ModuleHealthIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  remediation: string;
};

export type ModuleHealthRecord = {
  moduleId: string;
  name: string;
  type?: string;
  path?: string;
  state: "ready" | "attention" | "blocked";
  verificationIds: string[];
  implementationFiles: string[];
  governedTestFiles: string[];
  verificationTestFiles: string[];
  blockers: ModuleHealthIssue[];
  warnings: ModuleHealthIssue[];
  summary: {
    hasGraph: boolean;
    hasImplementationFiles: boolean;
    hasVerification: boolean;
    hasVerificationTests: boolean;
    autonomyReady: boolean;
  };
  nextAction: string;
};
