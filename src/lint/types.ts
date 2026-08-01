export type LintSeverity = "error" | "warning";

export type LintProfile = "standard";

/** Selected assertion section evaluated by ngrace lint. */
export type LintAssertionMode = "current" | "baseline" | "target" | "final";

export type ModuleRole = "RUNTIME" | "TEST" | "BARREL" | "CONFIG" | "TYPES" | "SCRIPT";
export type MapMode = "EXPORTS" | "LOCALS" | "SUMMARY" | "NONE";

/**
 * Classification of a lint issue. Absent field means defect (additive default).
 * Absence codes are those for which no answer was produced, with the reason in `code`.
 */
export type IssueClass = "defect" | "absence";

export type LintIssue = {
  severity: LintSeverity;
  code: string;
  file: string;
  line?: number;
  message: string;
  title?: string;
  explanation?: string;
  remediation?: string[];
  /** Optional; absent means defect. Attached from exact catalog entries (route 2). */
  issueClass?: IssueClass;
};

export type AnalysisCoverageEntry = {
  extension: string;
  files: number;
  adapterId?: string;
};

export type AnalysisCoverage = {
  adapterBacked: AnalysisCoverageEntry[];
  unverified: AnalysisCoverageEntry[];
  governedFiles: number;
};

export type LintResult = {
  schemaVersion: string;
  tool: "grace-lint";
  generatedAt: string;
  root: string;
  profile: LintProfile;
  assertionMode: LintAssertionMode;
  changeId?: string;
  commandsEnabled: boolean;
  filesChecked: number;
  governedFiles: number;
  xmlFilesChecked: number;
  issues: LintIssue[];
  summary: {
    issues: number;
    errors: number;
    warnings: number;
  };
  analysisCoverage: AnalysisCoverage;
};

export type LintOptions = {
  profile?: LintProfile;
  assertionMode?: LintAssertionMode;
  changeId?: string;
  runCommands?: boolean;
  parallelPreflight?: boolean;
};

/** Project policy for whether host-capability-missing (and similar) blocks apply (D11 / A29.5). */
export type GateFailOn = "errors" | "warnings" | "never";

export type GraceLintConfig = {
  ignoredDirs?: string[];
  /** Extensions that deliberately skip analysis.no-adapter, e.g. [".rs", ".go"]. */
  unverifiedLanguages?: string[];
  /**
   * Additional extensions GRACE should govern, e.g. [".ex", ".exs"] for a language with
   * no built-in adapter. Additive to the built-in set; it cannot remove governance.
   * Governed-without-adapter files still emit `analysis.no-adapter` unless the extension
   * also appears in `unverifiedLanguages`.
   */
  codeExtensions?: string[];
  /** Max anchors per graph/verification document before warning (default 50). */
  documentAnchorLimit?: number;
  /** Max bytes per graph/verification document before warning (default 30720 = 30 KB). */
  documentByteLimit?: number;
  /**
   * Project declaration: whether a recorded host-capability-missing review verdict is fatal
   * at the apply gate (D11 / A29.5). Default when omitted: errors (strict).
   * Distinct from per-command --fail-on on lint/status.
   */
  gateFailOn?: GateFailOn;
};

/** Defaults for document-size pressure warnings (Phase 8 / G-16). */
export const DEFAULT_DOCUMENT_ANCHOR_LIMIT = 50;
export const DEFAULT_DOCUMENT_BYTE_LIMIT = 30 * 1024;

export type MarkupSection = {
  content: string;
  startLine: number;
  endLine: number;
};

export type ModuleContractInfo = {
  fields: Record<string, string>;
  purpose?: string;
  scope?: string;
  depends?: string;
  links?: string;
  role?: ModuleRole;
  mapMode?: MapMode;
};

export type ModuleMapItem = {
  label: string;
  symbolName?: string;
  line: number;
};

export type LanguageAnalysis = {
  adapterId: string;
  exports: Set<string>;
  valueExports: Set<string>;
  typeExports: Set<string>;
  localSymbols: Set<string>;
  exportConfidence: "exact" | "heuristic";
  hasDefaultExport: boolean;
  hasWildcardReExport: boolean;
  hasMainEntrypoint: boolean;
  directReExportCount: number;
  localExportCount: number;
  localImplementationCount: number;
  usesTestFramework: boolean;
};

export type LanguageAdapter = {
  id: string;
  supports(filePath: string): boolean;
  analyze(filePath: string, text: string): LanguageAnalysis;
};

/** Actionable failure raised when an optional language runtime is unavailable. */
export class LanguageRuntimeMissingError extends Error {
  readonly adapterId: string;
  readonly runtimeCandidates: string[];

  constructor(adapterId: string, runtimeCandidates: string[], message: string) {
    super(message);
    this.name = "LanguageRuntimeMissingError";
    this.adapterId = adapterId;
    this.runtimeCandidates = runtimeCandidates;
  }
}
