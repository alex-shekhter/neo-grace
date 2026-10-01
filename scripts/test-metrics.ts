#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Per-test metrics emitter
//   SCOPE: One suite run into a fresh raw JUnit report outside the repository; slowest-test ranking
//   DEPENDS: none
//   LINKS: [M-RELEASE-AUTOMATION, V-M-RELEASE-AUTOMATION]
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   TestCase
//   parseJUnit
//   rankSlowest
// END_MODULE_MAP
/**
 * Run the suite once and rank its slowest tests from a raw JUnit report produced
 * afresh for this invocation. Informational: no duration is a gate, no report is
 * committed, and the report is written outside the repository by default.
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type TestCase = { file: string; name: string; ms: number };

function asRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
}

/** Take a suite's own cases, then any nested suites. Metadata containers are never entered. */
function collectSuiteCases(suite: Record<string, unknown>, out: Record<string, unknown>[]): void {
  for (const testcase of asRecords(suite.testcase)) out.push(testcase);
  for (const nested of asRecords(suite.testsuite)) collectSuiteCases(nested, out);
}

/** Follow the testsuites/testsuite hierarchy and take cases only from suite positions. */
function collectTestcases(root: Record<string, unknown>, out: Record<string, unknown>[]): void {
  for (const suites of asRecords(root.testsuites)) {
    for (const suite of asRecords(suites.testsuite)) collectSuiteCases(suite, out);
  }
  for (const suite of asRecords(root.testsuite)) collectSuiteCases(suite, out);
}

/** Parse the current JUnit report structurally. Minimal: testcase file, name, and time. */
export function parseJUnit(xml: string): TestCase[] {
  if (XMLValidator.validate(xml) !== true) {
    throw new Error("JUnit report is not well-formed XML");
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: false,
  });
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new Error(`JUnit report could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = document && typeof document === "object" ? (document as Record<string, unknown>) : {};
  const envelope = Object.keys(root).filter((key) => !key.startsWith("?") && !key.startsWith("#"));
  if (!envelope.includes("testsuites") && !envelope.includes("testsuite")) {
    throw new Error("report is not a usable JUnit document");
  }
  const nodes: Record<string, unknown>[] = [];
  collectTestcases(root, nodes);
  return nodes.map((node) => ({
    file: String(node.file ?? "?"),
    name: String(node.name ?? "?"),
    ms: Number(node.time ?? "0") * 1000,
  }));
}

export function rankSlowest(tests: TestCase[], n: number): TestCase[] {
  return [...tests].sort((a, b) => b.ms - a.ms).slice(0, n);
}

/**
 * Resolve a path the way the OS does: left to right, following symlinks, applying
 * `..` to the physical directory. Distinct from `path.resolve`, which collapses
 * `..` lexically before any symlink is followed.
 */
function physicalPath(base: string, target: string): string {
  let current = path.isAbsolute(target) ? path.sep : base;
  for (const part of target.split(path.sep)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      current = path.dirname(current);
      continue;
    }
    const candidate = path.join(current, part);
    const link = lstatSync(candidate, { throwIfNoEntry: false });
    current = link?.isSymbolicLink() ? realpathSync(candidate) : candidate;
  }
  return current;
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

/**
 * Resolve the one report path. `NGRACE_TEST_REPORT_PATH` wins when set; otherwise a
 * unique directory under the physical temp base is created. Both an override that
 * physically resolves inside the repository and a temp base that does so are refused
 * before any filesystem mutation.
 */
function resolveReportPath(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const physicalRoot = realpathSync(root);
  const override = env.NGRACE_TEST_REPORT_PATH;
  if (override && override.trim() !== "") {
    let physical: string;
    try {
      physical = physicalPath(physicalRoot, override);
    } catch (error) {
      throw new Error(`NGRACE_TEST_REPORT_PATH is not resolvable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (isInside(physicalRoot, physical)) {
      throw new Error(`NGRACE_TEST_REPORT_PATH resolves inside the repository: ${override}`);
    }
    return physical;
  }
  const tempBase = os.tmpdir();
  let physicalTemp: string;
  try {
    physicalTemp = physicalPath(physicalRoot, tempBase);
  } catch (error) {
    throw new Error(`temporary directory is not resolvable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (isInside(physicalRoot, physicalTemp)) {
    throw new Error(`temporary directory resolves inside the repository: ${tempBase}`);
  }
  return path.join(mkdtempSync(path.join(tempBase, "ngrace-test-reports-")), "junit.xml");
}

/** Clear only a stale report file; refuse a directory target before touching it. */
function prepareReport(reportPath: string): void {
  const stat = statSync(reportPath, { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    throw new Error(`refusing to replace a directory report target: ${reportPath}`);
  }
  if (stat) rmSync(reportPath, { force: true });
  mkdirSync(path.dirname(reportPath), { recursive: true });
}

function runMetrics(reportPath: string): number {
  try {
    prepareReport(reportPath);
  } catch (error) {
    console.error(`test-metrics: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(`report: ${reportPath}`);
  const run = spawnSync("bun", ["test", "--timeout=0", "--reporter=junit", `--reporter-outfile=${reportPath}`], {
    stdio: "inherit",
  });
  if (run.error || run.status === null || run.status === undefined) {
    console.error(`test-metrics: suite launch failed${run.error ? `: ${run.error.message}` : ""}`);
    return 1;
  }
  if (run.status !== 0) return run.status;
  let xml: string;
  try {
    xml = readFileSync(reportPath, "utf8");
  } catch {
    console.error(`test-metrics: current report unreadable: ${reportPath}`);
    return 1;
  }
  let tests: TestCase[];
  try {
    tests = parseJUnit(xml);
  } catch (error) {
    console.error(`test-metrics: current report malformed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (const [index, test] of rankSlowest(tests, 10).entries()) {
    console.log(`${String(index + 1).padStart(2)}. ${test.ms.toFixed(0).padStart(6)} ms  ${test.file}  ${test.name}`);
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(runMetrics(resolveReportPath(process.cwd())));
  } catch (error) {
    console.error(`test-metrics: refusing report path: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
