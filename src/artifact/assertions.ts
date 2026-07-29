import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { NgraceIssue } from "./types";
import { ANCHOR_PATTERNS } from "./types";
import { ARTIFACT_DIR, ProjectPathError, resolveContainedProjectPath } from "./paths";
import type { GraphAnchorRecord, GraphProjection, VerificationProjection } from "./projections";
import { stateMatchesEvidence } from "./projections";
import { childText, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

/** Supported machine-checkable GRACE 4 assertion kinds. */
export type AssertionKind =
  | "MustExist"
  | "MustNotExist"
  | "MustOwn"
  | "MustLink"
  | "MustVerify"
  | "MustPassCommand"
  | "MustContain"
  | "MustNotContain"
  | "MustMatchPattern"
  | "MustUseToken"
  | "MustNotUseLiteral"
  | "MustCoverStates"
  | "MustConform"
  | "MustUphold"
  | "MustPassBudget";

/** Maximum accepted length for artifact-authored regex patterns. */
export const ASSERTION_PATTERN_MAX_LENGTH = 200;

/** Budget comparison operators for MustPassBudget. */
export const BUDGET_OPERATORS = ["lt", "lte", "gt", "gte"] as const;
export type BudgetOperator = (typeof BUDGET_OPERATORS)[number];

/** Parsed assertion from BaselineAssertions or TargetAssertions. */
export type GraceAssertion = {
  kind: AssertionKind;
  file: string;
  values: string[];
};

/** Context required to evaluate a GRACE 4 assertion. */
export type AssertionContext = {
  root: string;
  graph: GraphProjection;
  verification: VerificationProjection;
  /** Commands run only when an explicit target-verification path opts in. */
  runCommands?: boolean;
};

export type AssertionExtractionResult = {
  assertions: GraceAssertion[];
  issues: NgraceIssue[];
};

/** Exact child-field schema for one assertion kind. */
export type AssertionSchema = {
  fields: readonly string[];
  /** Present at most once; omitted fields are not required. */
  optionalFields?: readonly string[];
  fileField?: string;
  allowManyValues?: boolean;
};

/** Machine-checkable schema for every assertion kind. */
export const ASSERTION_SCHEMAS: Record<AssertionKind, AssertionSchema> = {
  MustExist: { fields: ["Value"], allowManyValues: true },
  MustNotExist: { fields: ["Value"], allowManyValues: true },
  MustOwn: { fields: ["Owner", "Anchor"] },
  MustLink: { fields: ["From", "To"] },
  MustVerify: { fields: ["Module"], allowManyValues: true },
  MustPassCommand: { fields: ["Command"], allowManyValues: true },
  MustContain: { fields: ["File", "Text"], fileField: "File" },
  MustNotContain: { fields: ["File", "Text"], fileField: "File" },
  MustMatchPattern: { fields: ["File", "Pattern"], fileField: "File" },
  MustUseToken: { fields: ["File", "Token"], fileField: "File" },
  MustNotUseLiteral: { fields: ["File", "Pattern"], fileField: "File" },
  MustCoverStates: { fields: ["Module"] },
  MustConform: { fields: ["Contract", "Module", "Command"] },
  MustUphold: { fields: ["Invariant", "Module"] },
  MustPassBudget: {
    fields: ["Command", "Metric", "Operator", "Threshold", "Unit"],
    optionalFields: ["Extract"],
  },
};

export const ASSERTION_KINDS = new Set<AssertionKind>([
  "MustExist",
  "MustNotExist",
  "MustOwn",
  "MustLink",
  "MustVerify",
  "MustPassCommand",
  "MustContain",
  "MustNotContain",
  "MustMatchPattern",
  "MustUseToken",
  "MustNotUseLiteral",
  "MustCoverStates",
  "MustConform",
  "MustUphold",
  "MustPassBudget",
]);

/** Evaluates one assertion and returns current-state issues. */
export function evaluateAssertion(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  switch (assertion.kind) {
    case "MustExist":
      return assertion.values.flatMap((value) => evaluateExistence(assertion, value, context, true));
    case "MustNotExist":
      return assertion.values.flatMap((value) => evaluateExistence(assertion, value, context, false));
    case "MustOwn":
      return evaluateMustOwn(assertion, context);
    case "MustLink":
      return evaluateMustLink(assertion, context);
    case "MustVerify":
      return evaluateMustVerify(assertion, context);
    case "MustPassCommand":
      return evaluateMustPassCommand(assertion, context);
    case "MustContain":
      return evaluateTextContainment(assertion, context, true);
    case "MustNotContain":
      return evaluateTextContainment(assertion, context, false);
    case "MustMatchPattern":
      return evaluateMustMatchPattern(assertion, context);
    case "MustUseToken":
      return evaluateMustUseToken(assertion, context);
    case "MustNotUseLiteral":
      return evaluateMustNotUseLiteral(assertion, context);
    case "MustCoverStates":
      return evaluateMustCoverStates(assertion, context);
    case "MustConform":
      return evaluateMustConform(assertion, context);
    case "MustUphold":
      return evaluateMustUphold(assertion, context);
    case "MustPassBudget":
      return evaluateMustPassBudget(assertion, context);
  }
}

/** Extracts assertions from BaselineAssertions or TargetAssertions under a NgraceChangePlan. */
export function extractAssertions(planFile: string, section: "BaselineAssertions" | "TargetAssertions"): GraceAssertion[] {
  return extractAssertionsWithIssues(planFile, section).assertions;
}

export function extractAssertionsWithIssues(
  planFile: string,
  section: "BaselineAssertions" | "TargetAssertions",
): AssertionExtractionResult {
  const artifact = readGraceXmlArtifact(planFile);
  const issues = [...artifact.issues];
  const assertions: GraceAssertion[] = [];

  if (!artifact.root) {
    return { assertions, issues };
  }

  const sections = [...walkNodes(artifact.root)].filter((node) => node.tag === section);
  for (const sectionNode of sections) {
    let validAssertions = 0;
    if (sectionNode.text.trim() || Object.keys(sectionNode.attributes).length > 0) {
      issues.push(issue("error", "assertion.invalid-section-shape", planFile, `${section} must contain only approved assertion child elements.`));
    }
    for (const node of sectionNode.children) {
      if (!ASSERTION_KINDS.has(node.tag as AssertionKind)) {
        issues.push(issue("error", "assertion.unknown-kind", planFile, `${node.tag} is not an approved GRACE 4 assertion kind.`));
        continue;
      }
      const extraction = extractAssertionNode(planFile, node, node.tag as AssertionKind);
      issues.push(...extraction.issues);
      if (!extraction.assertion) {
        continue;
      }
      const phaseIssues = validateAssertionPhase(planFile, section, extraction.assertion);
      issues.push(...phaseIssues);
      if (phaseIssues.length > 0) {
        validAssertions += 1;
        continue;
      }
      assertions.push({
        ...extraction.assertion,
        file: planFile,
      });
      validAssertions += 1;
    }
    if (validAssertions === 0) {
      issues.push(issue("error", "assertion.empty-section", planFile, `${section} must contain at least one valid machine-checkable assertion.`));
    }
  }

  return { assertions, issues };
}

function validateAssertionPhase(
  planFile: string,
  section: "BaselineAssertions" | "TargetAssertions",
  assertion: Omit<GraceAssertion, "file">,
): NgraceIssue[] {
  if (section !== "TargetAssertions" || assertion.kind !== "MustPassCommand") {
    return [];
  }

  return assertion.values
    .filter((command) => /(?:^|\s)--assertions(?:\s+|=)(?:current|["']current["'])(?=\s|$|[;&|])/i.test(command))
    .map((command) => issue(
      "error",
      "assertion.phase-incompatible-command",
      planFile,
      `TargetAssertions MustPassCommand must not invoke --assertions current: ${command}. Current mode evaluates active approved baselines and becomes stale after target writes; keep MustPassCommand as leaf project evidence and run selected target/final lint as the outer gate.`,
    ));
}

function evaluateMustOwn(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [owner, anchor] = assertion.values;
  if (!owner || !anchor) {
    return [assertionIssue(assertion, "MustOwn requires owner and anchor values.")];
  }

  if (owner.startsWith("GD-")) {
    const record = graphRecord(anchor, context.graph);
    return record?.owner === owner ? [] : [assertionIssue(assertion, `Expected ${owner} to own ${anchor}.`)];
  }

  if (owner.startsWith("VD-")) {
    const record = context.verification.entries.get(anchor);
    return record?.owner === owner ? [] : [assertionIssue(assertion, `Expected ${owner} to own ${anchor}.`)];
  }

  return [assertionIssue(assertion, `Unsupported owner '${owner}'.`)];
}

function evaluateMustLink(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [from, to] = assertion.values;
  if (!from || !to) {
    return [assertionIssue(assertion, "MustLink requires source and target values.")];
  }

  const fromRecord = graphRecord(from, context.graph);
  if (!fromRecord) {
    return [assertionIssue(assertion, `Link source ${from} does not exist.`)];
  }
  if (!graphRecord(to, context.graph)) {
    return [assertionIssue(assertion, `Link target ${to} does not exist.`)];
  }

  return fromRecord.links.includes(to) ? [] : [assertionIssue(assertion, `Expected ${from} to link to ${to}.`)];
}

function evaluateMustVerify(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  return assertion.values.flatMap((value) => {
    const verificationId = value.startsWith("V-") ? value : `V-${value}`;
    const record = context.verification.entries.get(verificationId);
    if (!record) {
      return [assertionIssue(assertion, `Expected ${verificationId} verification coverage.`)];
    }
    return [];
  });
}

function evaluateMustPassCommand(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  if (!context.runCommands) {
    return [issue("error", "assertion.command-not-evaluated", assertion.file, "MustPassCommand requires explicit command execution opt-in.")];
  }

  return assertion.values.flatMap((command) => {
    const result = spawnShellCommand(command, context.root);

    if (result.exitCode === 0) {
      return [];
    }

    const stderr = new TextDecoder().decode(result.stderr).trim();
    return [assertionIssue(assertion, `Command failed (${result.exitCode}): ${command}${stderr ? `: ${stderr}` : ""}`)];
  });
}

function evaluateTextContainment(assertion: GraceAssertion, context: AssertionContext, shouldContain: boolean): NgraceIssue[] {
  const [fileValue, expectedText] = assertion.values;
  if (!fileValue || expectedText == null) {
    return [assertionIssue(assertion, `${assertion.kind} requires file and text values.`)];
  }

  const contents = readAssertionFile(assertion, context, fileValue);
  if (typeof contents !== "string") {
    return contents;
  }

  const contains = contents.includes(expectedText);
  if (contains === shouldContain) {
    return [];
  }

  return [assertionIssue(assertion, shouldContain ? `${fileValue} must contain requested text.` : `${fileValue} must not contain requested text.`)];
}

function evaluateMustMatchPattern(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [fileValue, patternSource] = assertion.values;
  if (!fileValue || patternSource == null) {
    return [assertionIssue(assertion, "MustMatchPattern requires File and Pattern values.")];
  }

  const compiled = compileSafeAssertionPattern(patternSource);
  if (!compiled.ok) {
    return [issue("error", "assertion.invalid-pattern", assertion.file, `MustMatchPattern pattern rejected: ${compiled.error}`)];
  }

  const contents = readAssertionFile(assertion, context, fileValue);
  if (typeof contents !== "string") {
    return contents;
  }

  return compiled.pattern.test(contents)
    ? []
    : [assertionIssue(assertion, `${fileValue} does not match pattern ${JSON.stringify(patternSource)}.`)];
}

function evaluateMustNotUseLiteral(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [fileValue, patternSource] = assertion.values;
  if (!fileValue || patternSource == null) {
    return [assertionIssue(assertion, "MustNotUseLiteral requires File and Pattern values.")];
  }

  const compiled = compileSafeAssertionPattern(patternSource);
  if (!compiled.ok) {
    return [issue("error", "assertion.invalid-pattern", assertion.file, `MustNotUseLiteral pattern rejected: ${compiled.error}`)];
  }

  const contents = readAssertionFile(assertion, context, fileValue);
  if (typeof contents !== "string") {
    return contents;
  }

  return compiled.pattern.test(contents)
    ? [assertionIssue(assertion, `${fileValue} matches forbidden pattern ${JSON.stringify(patternSource)}.`) ]
    : [];
}

function evaluateMustUseToken(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [fileValue, tokenId] = assertion.values;
  if (!fileValue || !tokenId) {
    return [assertionIssue(assertion, "MustUseToken requires File and Token values.")];
  }
  if (!ANCHOR_PATTERNS.designToken.test(tokenId)) {
    return [assertionIssue(assertion, `Token ${JSON.stringify(tokenId)} must be a canonical DT-* design token id.`)];
  }

  const tokens = loadDesignTokenValues(context.root);
  const tokenValue = tokens.get(tokenId);
  if (!tokenValue) {
    return [assertionIssue(assertion, `Design token ${tokenId} is not defined in ${ARTIFACT_DIR}/context/design-system.xml.`)];
  }

  const contents = readAssertionFile(assertion, context, fileValue);
  if (typeof contents !== "string") {
    return contents;
  }

  return contents.includes(tokenValue)
    ? []
    : [assertionIssue(assertion, `${fileValue} does not reference token value ${JSON.stringify(tokenValue)} for ${tokenId}.`)];
}

function evaluateMustCoverStates(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [moduleId] = assertion.values;
  if (!moduleId) {
    return [assertionIssue(assertion, "MustCoverStates requires a Module value.")];
  }
  if (!ANCHOR_PATTERNS.module.test(moduleId)) {
    return [assertionIssue(assertion, `Module ${JSON.stringify(moduleId)} must be a canonical M-* id.`)];
  }

  const moduleRecord = context.graph.modules.get(moduleId);
  if (!moduleRecord) {
    return [assertionIssue(assertion, `Module ${moduleId} does not exist in the graph projection.`)];
  }

  const states = moduleRecord.states ?? [];
  if (states.length === 0) {
    return [assertionIssue(assertion, `${moduleId} declares no ST-* states to cover.`)];
  }

  const verificationId = `V-${moduleId}`;
  const verification = context.verification.entries.get(verificationId);
  if (!verification) {
    return [assertionIssue(assertion, `${moduleId} has no ${verificationId} verification entry.`)];
  }

  const evidence = [
    ...verification.scenarios,
    ...verification.accessibilityChecks,
    ...verification.visualChecks,
  ];

  return states.flatMap((stateId) => {
    if (evidence.some((text) => stateMatchesEvidence(stateId, text))) {
      return [];
    }
    return [assertionIssue(assertion, `${moduleId} state ${stateId} has no Scenario/AccessibilityCheck/VisualCheck evidence.`)];
  });
}

/**
 * Without --run-commands: validate that Contract (IC-*) and Module (M-*) exist and Command is non-empty.
 * With --run-commands: also execute Command (buf breaking, oasdiff, codegen-drift, …).
 */
function evaluateMustConform(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [contractId, moduleId, command] = assertion.values;
  if (!contractId || !moduleId || !command) {
    return [assertionIssue(assertion, "MustConform requires Contract, Module, and Command values.")];
  }
  if (!ANCHOR_PATTERNS.interfaceContract.test(contractId)) {
    return [assertionIssue(assertion, `Contract ${JSON.stringify(contractId)} must be a canonical IC-* id.`)];
  }
  if (!ANCHOR_PATTERNS.module.test(moduleId)) {
    return [assertionIssue(assertion, `Module ${JSON.stringify(moduleId)} must be a canonical M-* id.`)];
  }

  const issues: NgraceIssue[] = [];
  if (!context.graph.interfaceContracts.has(contractId)) {
    issues.push(assertionIssue(assertion, `Interface contract ${contractId} does not exist in the graph projection.`));
  }
  if (!context.graph.modules.has(moduleId)) {
    issues.push(assertionIssue(assertion, `Module ${moduleId} does not exist in the graph projection.`));
  }
  if (issues.length > 0) {
    return issues;
  }

  if (!context.runCommands) {
    // Reference-only pass — do not execute, and do not treat as "not evaluated" failure.
    return [];
  }

  return runShellCommand(command, context.root).flatMap((failure) => [
    assertionIssue(assertion, `Conform command failed (${failure.exitCode}): ${command}${failure.stderr ? `: ${failure.stderr}` : ""}`),
  ]);
}

function evaluateMustUphold(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [invariantId, moduleId] = assertion.values;
  if (!invariantId || !moduleId) {
    return [assertionIssue(assertion, "MustUphold requires Invariant and Module values.")];
  }
  if (!ANCHOR_PATTERNS.invariant.test(invariantId)) {
    return [assertionIssue(assertion, `Invariant ${JSON.stringify(invariantId)} must be a canonical INV-* id.`)];
  }
  if (!ANCHOR_PATTERNS.module.test(moduleId)) {
    return [assertionIssue(assertion, `Module ${JSON.stringify(moduleId)} must be a canonical M-* id.`)];
  }

  if (!context.graph.modules.has(moduleId)) {
    return [assertionIssue(assertion, `Module ${moduleId} does not exist in the graph projection.`)];
  }

  const invariants = loadInvariants(context.root);
  const inv = invariants.get(invariantId);
  if (!inv) {
    return [assertionIssue(assertion, `Invariant ${invariantId} is not defined in ${ARTIFACT_DIR}/context/invariants.xml.`)];
  }

  if (inv.appliesTo.length > 0) {
    const moduleTargets = inv.appliesTo.filter((target) => ANCHOR_PATTERNS.module.test(target));
    const flowTargets = inv.appliesTo.filter((target) => ANCHOR_PATTERNS.dataFlow.test(target));
    const inModuleList = moduleTargets.includes(moduleId);
    const inFlow = flowTargets.some((flowId) => {
      const flow = context.graph.dataFlows.get(flowId);
      if (!flow) return false;
      if (flow.steps?.some((step) => step.moduleId === moduleId)) return true;
      return flow.links.includes(moduleId);
    });
    if (moduleTargets.length + flowTargets.length > 0 && !inModuleList && !inFlow) {
      return [
        assertionIssue(
          assertion,
          `Module ${moduleId} is not in AppliesTo for ${invariantId} (${inv.appliesTo.join(", ")}).`,
        ),
      ];
    }
  }

  return [];
}

/**
 * MustPassBudget failure modes (each a distinct code — none may be mistaken for a pass):
 * 1. command fails → assertion.budget-command-failed
 * 2. Extract finds no match → assertion.budget-no-match
 * 3. capture is not a number → assertion.budget-not-a-number
 * 4. comparison fails → assertion.MustPassBudget
 */
function evaluateMustPassBudget(assertion: GraceAssertion, context: AssertionContext): NgraceIssue[] {
  const [command, metric, operator, thresholdRaw, unit, extractSource] = assertion.values;
  if (!command || !metric || !operator || thresholdRaw == null || !unit) {
    return [assertionIssue(assertion, "MustPassBudget requires Command, Metric, Operator, Threshold, and Unit.")];
  }
  if (!(BUDGET_OPERATORS as readonly string[]).includes(operator)) {
    return [assertionIssue(assertion, `Operator ${JSON.stringify(operator)} must be one of ${BUDGET_OPERATORS.join("|")}.`)];
  }
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold)) {
    return [assertionIssue(assertion, `Threshold ${JSON.stringify(thresholdRaw)} must be a finite number.`)];
  }

  if (!context.runCommands) {
    return [issue("error", "assertion.command-not-evaluated", assertion.file, "MustPassBudget requires explicit command execution opt-in.")];
  }

  const patternSource = extractSource?.trim()
    || `${escapeRegExpLiteral(metric)}\\s*[=:]\\s*([0-9.]+)`;
  const compiled = compileSafeAssertionPattern(patternSource);
  if (!compiled.ok) {
    return [issue("error", "assertion.invalid-pattern", assertion.file, `MustPassBudget Extract rejected: ${compiled.error}`)];
  }
  // A capturing group, not merely a "(" — `(?:…)` and `(?=…)` contain one but capture nothing,
  // and would otherwise surface as budget-no-match, blaming the command for an Extract mistake.
  if (!hasCapturingGroup(patternSource)) {
    return [issue("error", "assertion.invalid-pattern", assertion.file, "MustPassBudget Extract must contain one capture group for the metric value.")];
  }

  const result = spawnShellCommand(command, context.root);
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr).trim();

  if (result.exitCode !== 0) {
    return [
      issue(
        "error",
        "assertion.budget-command-failed",
        assertion.file,
        `Budget command failed (${result.exitCode}): ${command}${stderr ? `: ${stderr}` : ""}`,
      ),
    ];
  }

  const match = compiled.pattern.exec(stdout);
  if (!match || match[1] == null) {
    return [
      issue(
        "error",
        "assertion.budget-no-match",
        assertion.file,
        `Budget metric ${JSON.stringify(metric)} not found in command output (Extract ${JSON.stringify(patternSource)}).`,
      ),
    ];
  }

  const measured = Number(match[1]);
  if (!Number.isFinite(measured)) {
    return [
      issue(
        "error",
        "assertion.budget-not-a-number",
        assertion.file,
        `Budget capture ${JSON.stringify(match[1])} for ${metric} is not a number.`,
      ),
    ];
  }

  const ok = compareBudget(measured, operator as BudgetOperator, threshold);
  if (ok) {
    return [];
  }
  return [
    assertionIssue(
      assertion,
      `Budget ${metric}=${measured} ${unit} fails ${operator} ${threshold} ${unit}.`,
    ),
  ];
}

function compareBudget(measured: number, operator: BudgetOperator, threshold: number): boolean {
  switch (operator) {
    case "lt":
      return measured < threshold;
    case "lte":
      return measured <= threshold;
    case "gt":
      return measured > threshold;
    case "gte":
      return measured >= threshold;
  }
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Single shell-invocation shape for every command-running assertion, so they cannot drift apart. */
export function spawnShellCommand(command: string, cwd: string) {
  return Bun.spawnSync({
    cmd: process.platform === "win32"
      ? ["cmd.exe", "/d", "/s", "/c", command]
      : [process.env.SHELL || "sh", "-lc", command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function runShellCommand(command: string, cwd: string): Array<{ exitCode: number; stderr: string }> {
  const result = spawnShellCommand(command, cwd);
  if (result.exitCode === 0) {
    return [];
  }
  return [{ exitCode: result.exitCode ?? 1, stderr: new TextDecoder().decode(result.stderr).trim() }];
}

/**
 * True when the pattern has at least one capturing group — a `(` that is not escaped,
 * not inside a character class, and not the start of `(?…`.
 */
function hasCapturingGroup(source: string): boolean {
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "[") {
      i = charClassEnd(source, i);
      continue;
    }
    if (char === "(") {
      // `(?<name>…)` captures; `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!` do not.
      if (source[i + 1] !== "?") {
        return true;
      }
      if (source[i + 2] === "<" && source[i + 3] !== "=" && source[i + 3] !== "!") {
        return true;
      }
    }
  }
  return false;
}

type InvariantRecord = {
  id: string;
  statement: string;
  appliesTo: string[];
};

function loadInvariants(projectRoot: string): Map<string, InvariantRecord> {
  const result = new Map<string, InvariantRecord>();
  const file = path.join(projectRoot, ARTIFACT_DIR, "context", "invariants.xml");
  if (!existsSync(file)) {
    return result;
  }
  const artifact = readGraceXmlArtifact(file);
  if (!artifact.root) {
    return result;
  }
  for (const node of artifact.root.children) {
    if (!ANCHOR_PATTERNS.invariant.test(node.tag)) continue;
    const statement = childText(node, "Statement")?.trim() ?? "";
    const appliesTo: string[] = [];
    for (const section of node.children.filter((child) => child.tag === "AppliesTo")) {
      for (const child of section.children) {
        if (ANCHOR_PATTERNS.module.test(child.tag) || ANCHOR_PATTERNS.dataFlow.test(child.tag)) {
          appliesTo.push(child.tag);
        }
      }
    }
    result.set(node.tag, { id: node.tag, statement, appliesTo });
  }
  return result;
}

/**
 * Compiles an artifact-authored regex safely: length cap, no nested unbounded
 * quantifiers, no flags from the artifact. Rejects rather than hanging.
 */
export function compileSafeAssertionPattern(
  patternSource: string,
): { ok: true; pattern: RegExp } | { ok: false; error: string } {
  if (patternSource.length === 0) {
    return { ok: false, error: "pattern must not be empty" };
  }
  if (patternSource.length > ASSERTION_PATTERN_MAX_LENGTH) {
    return { ok: false, error: `pattern exceeds ${ASSERTION_PATTERN_MAX_LENGTH} characters` };
  }
  const risk = findBacktrackingRisk(patternSource);
  if (risk) {
    return { ok: false, error: risk };
  }
  try {
    // Never accept flags from the artifact — always construct with no flags.
    return { ok: true, pattern: new RegExp(patternSource) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid regular expression" };
  }
}

type GroupFrame = {
  /** An unbounded quantifier (`*`, `+`, `{n,}`) applies to something inside this group. */
  hasUnbounded: boolean;
  /** Source text of each top-level alternative inside this group. */
  alternatives: string[];
  current: string;
};

/**
 * Structural scan for catastrophic-backtracking shapes. A regex over the pattern text
 * cannot see paren nesting, so `((a+))+` and `(a|a)*` both slipped past the previous
 * heuristic and take exponential time. Returns a rejection reason, or null when safe.
 *
 * Rejects a group under an unbounded quantifier when either
 *   - the group itself contains an unbounded quantifier — `(a+)+`, `((a+))+`, `(x+x+)+`
 *   - two of its alternatives overlap, one being a prefix of the other — `(a|a)*`, `(a|ab)*`
 * Bounded repetition (`{2}`, `{2,5}`, `?`) is safe and stays accepted, so `(a+){2}` passes.
 */
function findBacktrackingRisk(source: string): string | null {
  const stack: GroupFrame[] = [{ hasUnbounded: false, alternatives: [], current: "" }];
  const top = () => stack[stack.length - 1]!;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;

    if (char === "\\") {
      top().current += source.slice(i, i + 2);
      i += 1;
      continue;
    }

    if (char === "[") {
      const end = charClassEnd(source, i);
      top().current += source.slice(i, end + 1);
      i = end;
      continue;
    }

    if (char === "(") {
      stack.push({ hasUnbounded: false, alternatives: [], current: "" });
      i = skipGroupPrefix(source, i);
      continue;
    }

    if (char === "|") {
      const frame = top();
      frame.alternatives.push(frame.current);
      frame.current = "";
      continue;
    }

    if (char === ")") {
      if (stack.length === 1) {
        // Unbalanced — let the RegExp constructor produce the real diagnostic.
        return null;
      }
      const frame = stack.pop()!;
      frame.alternatives.push(frame.current);
      const quantifier = quantifierAt(source, i + 1);
      if (quantifier.unbounded) {
        if (frame.hasUnbounded) {
          return "nested unbounded quantifiers are not allowed";
        }
        const overlap = overlappingAlternative(frame.alternatives);
        if (overlap) {
          return `ambiguous alternation ${JSON.stringify(overlap)} under an unbounded quantifier is not allowed`;
        }
      }
      const parent = top();
      parent.hasUnbounded = parent.hasUnbounded || frame.hasUnbounded || quantifier.unbounded;
      parent.current += `(${frame.alternatives.join("|")})${source.slice(i + 1, quantifier.end)}`;
      i = quantifier.end - 1;
      continue;
    }

    if (char === "*" || char === "+") {
      top().hasUnbounded = true;
      top().current += char;
      continue;
    }

    if (char === "{") {
      const quantifier = quantifierAt(source, i);
      if (quantifier.end > i) {
        top().hasUnbounded = top().hasUnbounded || quantifier.unbounded;
        top().current += source.slice(i, quantifier.end);
        i = quantifier.end - 1;
        continue;
      }
    }

    top().current += char;
  }

  return null;
}

function charClassEnd(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === "]") {
      return i;
    }
  }
  return source.length - 1;
}

/** Consumes `?:`, `?=`, `?!`, `?<=`, `?<!`, `?<name>` so a group prefix never reads as content. */
function skipGroupPrefix(source: string, openIndex: number): number {
  if (source[openIndex + 1] !== "?") {
    return openIndex;
  }
  const third = source[openIndex + 2];
  if (third === ":" || third === "=" || third === "!") {
    return openIndex + 2;
  }
  if (third === "<") {
    const fourth = source[openIndex + 3];
    if (fourth === "=" || fourth === "!") {
      return openIndex + 3;
    }
    const close = source.indexOf(">", openIndex + 3);
    return close === -1 ? openIndex + 2 : close;
  }
  return openIndex + 1;
}

/** Reads the quantifier starting at `index`; `end` is the first index past it. */
function quantifierAt(source: string, index: number): { unbounded: boolean; end: number } {
  const char = source[index];
  if (char === "*" || char === "+") {
    return { unbounded: true, end: lazyOrPossessiveEnd(source, index + 1) };
  }
  if (char === "?") {
    return { unbounded: false, end: lazyOrPossessiveEnd(source, index + 1) };
  }
  if (char === "{") {
    const close = source.indexOf("}", index);
    if (close === -1) {
      return { unbounded: false, end: index };
    }
    const body = source.slice(index + 1, close);
    if (!/^\d+(?:,\d*)?$/.test(body)) {
      return { unbounded: false, end: index };
    }
    return { unbounded: /,\s*$/.test(body), end: lazyOrPossessiveEnd(source, close + 1) };
  }
  return { unbounded: false, end: index };
}

function lazyOrPossessiveEnd(source: string, index: number): number {
  return source[index] === "?" || source[index] === "+" ? index + 1 : index;
}

/** Returns the offending alternative when one is a prefix of another (equal counts). */
function overlappingAlternative(alternatives: string[]): string | null {
  if (alternatives.length < 2) {
    return null;
  }
  for (let i = 0; i < alternatives.length; i += 1) {
    for (let j = i + 1; j < alternatives.length; j += 1) {
      const left = alternatives[i]!;
      const right = alternatives[j]!;
      if (left.startsWith(right) || right.startsWith(left)) {
        return left.length <= right.length ? left : right;
      }
    }
  }
  return null;
}

function readAssertionFile(
  assertion: GraceAssertion,
  context: AssertionContext,
  fileValue: string,
): string | NgraceIssue[] {
  let file: string;
  try {
    file = resolveAssertionPath(context.root, fileValue);
  } catch (error) {
    return [invalidPathIssue(assertion, fileValue, error)];
  }
  if (!existsSync(file)) {
    return [assertionIssue(assertion, `${fileValue} does not exist.`)];
  }

  try {
    if (!statSync(file).isFile()) {
      return [assertionIssue(assertion, `${fileValue} must resolve to a regular file.`)];
    }
  } catch (error) {
    return [assertionIssue(assertion, `Unable to inspect ${fileValue}: ${error instanceof Error ? error.message : String(error)}`)];
  }

  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    return [assertionIssue(assertion, `Unable to read ${fileValue}: ${error instanceof Error ? error.message : String(error)}`)];
  }
}

function loadDesignTokenValues(projectRoot: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const file = path.join(projectRoot, ARTIFACT_DIR, "context", "design-system.xml");
  if (!existsSync(file)) {
    return tokens;
  }
  const artifact = readGraceXmlArtifact(file);
  if (!artifact.root) {
    return tokens;
  }
  for (const node of walkNodes(artifact.root)) {
    if (!ANCHOR_PATTERNS.designToken.test(node.tag)) continue;
    const value = childText(node, "Value")?.trim();
    if (value) {
      tokens.set(node.tag, value);
    }
  }
  return tokens;
}

function existsInContext(value: string, context: AssertionContext): boolean {
  if (graphRecord(value, context.graph) || context.graph.documents.has(value) || context.verification.documents.has(value)) {
    return true;
  }
  if (context.verification.entries.has(value)) {
    return true;
  }
  if (value.startsWith("M-") && context.verification.entries.has(`V-${value}`)) {
    return true;
  }
  if (ANCHOR_PATTERNS.invariant.test(value) && loadInvariants(context.root).has(value)) {
    return true;
  }
  return existsSync(resolveAssertionPath(context.root, value));
}

function graphRecord(value: string, graph: GraphProjection): GraphAnchorRecord | undefined {
  return graph.modules.get(value) ?? graph.dataFlows.get(value) ?? graph.interfaceContracts.get(value);
}

function extractAssertionNode(
  planFile: string,
  node: GraceXmlNode,
  kind: AssertionKind,
): { assertion?: Omit<GraceAssertion, "file">; issues: NgraceIssue[] } {
  const issues: NgraceIssue[] = [];
  const schema = ASSERTION_SCHEMAS[kind];
  const allowedFields = new Set([...schema.fields, ...(schema.optionalFields ?? [])]);

  if (node.text.trim() || Object.keys(node.attributes).length > 0) {
    issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} must contain only its declared child fields.`));
  }

  for (const child of node.children) {
    if (!allowedFields.has(child.tag)) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} does not allow child <${child.tag}>.`));
    }
    if (child.children.length > 0 || Object.keys(child.attributes).length > 0) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${child.tag} must be a plain text field.`));
    }
  }

  const values: string[] = [];
  if (schema.allowManyValues) {
    const field = schema.fields[0]!;
    const matches = node.children.filter((child) => child.tag === field);
    if (matches.length === 0) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} requires at least one <${field}> field.`));
    }
    for (const match of matches) {
      const value = match.text.trim();
      if (!value) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${field} must not be empty.`));
      } else {
        values.push(value);
      }
    }
  } else {
    for (const field of schema.fields) {
      const matches = node.children.filter((child) => child.tag === field);
      if (matches.length !== 1) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} requires exactly one <${field}> field.`));
        continue;
      }
      const value = matches[0]!.text.trim();
      if (!value) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${field} must not be empty.`));
      } else {
        values.push(value);
      }
    }
    for (const field of schema.optionalFields ?? []) {
      const matches = node.children.filter((child) => child.tag === field);
      if (matches.length > 1) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} allows at most one <${field}> field.`));
        continue;
      }
      if (matches.length === 1) {
        const value = matches[0]!.text.trim();
        if (!value) {
          issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${field} must not be empty when present.`));
        } else {
          values.push(value);
        }
      }
    }
  }

  if (schema.fileField) {
    const fileIndex = schema.fields.indexOf(schema.fileField);
    const fileValue = values[fileIndex];
    if (fileValue) {
      try {
        resolveContainedProjectPath(inferProjectRoot(planFile), fileValue, { mode: "output" });
      } catch (error) {
        issues.push(invalidPathIssue({ kind, file: planFile, values }, fileValue, error));
      }
    }
  }

  if ((kind === "MustMatchPattern" || kind === "MustNotUseLiteral") && values.length >= 2) {
    const patternSource = values[1]!;
    const compiled = compileSafeAssertionPattern(patternSource);
    if (!compiled.ok) {
      issues.push(issue("error", "assertion.invalid-pattern", planFile, `${kind} pattern rejected: ${compiled.error}`));
    }
  }

  if (kind === "MustPassBudget" && values.length >= 6) {
    const extractSource = values[5]!;
    const compiled = compileSafeAssertionPattern(extractSource);
    if (!compiled.ok) {
      issues.push(issue("error", "assertion.invalid-pattern", planFile, `MustPassBudget Extract rejected: ${compiled.error}`));
    }
  }

  if (kind === "MustPassBudget" && values.length >= 3) {
    const operator = values[2]!;
    if (!(BUDGET_OPERATORS as readonly string[]).includes(operator)) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `MustPassBudget Operator must be one of ${BUDGET_OPERATORS.join("|")}.`));
    }
  }

  return issues.length > 0 ? { issues } : { assertion: { kind, values }, issues };
}

function evaluateExistence(
  assertion: GraceAssertion,
  value: string,
  context: AssertionContext,
  shouldExist: boolean,
): NgraceIssue[] {
  let exists: boolean;
  try {
    exists = existsInContext(value, context);
  } catch (error) {
    return [invalidPathIssue(assertion, value, error)];
  }
  if (exists === shouldExist) {
    return [];
  }
  return [assertionIssue(assertion, shouldExist ? `Expected ${value} to exist.` : `Expected ${value} not to exist.`)];
}

function inferProjectRoot(planFile: string): string {
  const resolvedPlan = path.resolve(planFile);
  let current = path.dirname(resolvedPlan);
  while (path.dirname(current) !== current) {
    if (path.basename(current) === ARTIFACT_DIR) {
      return path.dirname(current);
    }
    current = path.dirname(current);
  }
  return path.dirname(resolvedPlan);
}

function resolveAssertionPath(root: string, value: string): string {
  return resolveContainedProjectPath(root, value, { mode: "output" }).absolutePath;
}

function invalidPathIssue(assertion: GraceAssertion, value: string, error: unknown): NgraceIssue {
  const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
  return issue("error", "assertion.invalid-path", assertion.file, `Invalid assertion path ${JSON.stringify(value)}: ${detail}`);
}

function assertionIssue(assertion: GraceAssertion, message: string): NgraceIssue {
  return issue("error", `assertion.${assertion.kind}`, assertion.file, message);
}

function issue(severity: NgraceIssue["severity"], code: string, file: string, message: string): NgraceIssue {
  return { severity, code, file, message };
}
