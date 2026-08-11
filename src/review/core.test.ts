import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { validateRunLedgerArtifact } from "../artifact/grammar";
import { writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { parseGraceXmlArtifact } from "../artifact/xml";
import { byPattern, corpus } from "../test-support/defect-corpus";
import {
  auditAttemptPairWriteEvidence,
  auditCompatNewErrors,
  auditHunkCoverage,
  auditScopeOutsideWriteScope,
  auditTestWeakening,
  expandScopePathsForArchiveIdentity,
  findingId,
  formatReviewResult,
  resolveChangePlanPath,
  runJoinProbes,
  listRuntimeSourceFilesForMarkerScan,
  runPatternDetectors,
  runReview,
} from "./core";
import { ATTEMPT_PAIR_FINDING_CODE, allReviewCodes, guideFor } from "./catalog";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function track(root: string): string {
  tempRoots.push(root);
  return root;
}

describe("finding IDs", () => {
  it("is stable across identical inputs", () => {
    const a = findingId({
      auditOrPatternId: "confidently-wrong",
      file: "src/a.ts",
      anchorOrHunkKey: "marker:X",
      ruleId: "marker-not-emitted",
    });
    const b = findingId({
      auditOrPatternId: "confidently-wrong",
      file: "src/a.ts",
      anchorOrHunkKey: "marker:X",
      ruleId: "marker-not-emitted",
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("does not change when only a blank line is inserted above the finding site", () => {
    const root = track(corpus().find((e) => e.id === "corpus-re-01-status-regex-on-xml")!.build());
    const entry = corpus().find((e) => e.id === "corpus-re-01-status-regex-on-xml")!;
    entry.apply(root);
    const first = runReview(root, { processAudits: false, joinEngine: false });
    const target = first.findings.find((f) => f.code === "review.regex-over-structure");
    expect(target).toBeDefined();

    const filePath = path.join(root, "src/check-status.ts");
    const body = awaitableRead(filePath);
    writeFileSync(filePath, `\n${body}`);

    const second = runReview(root, { processAudits: false, joinEngine: false });
    const again = second.findings.find((f) => f.code === "review.regex-over-structure");
    expect(again?.findingId).toBe(target!.findingId);
    expect(second.summary.findings).toBe(first.summary.findings);
  });

  it("two full runs on an unchanged tree produce identical ids and counts", () => {
    const root = track(corpus().find((e) => e.id === "corpus-sr-01-test-reads-own-source")!.build());
    corpus().find((e) => e.id === "corpus-sr-01-test-reads-own-source")!.apply(root);
    const a = runReview(root, { processAudits: false, joinEngine: false });
    const b = runReview(root, { processAudits: false, joinEngine: false });
    expect(a.findings.map((f) => f.findingId).sort()).toEqual(
      b.findings.map((f) => f.findingId).sort(),
    );
    expect(a.summary.findings).toBe(b.summary.findings);
  });
});

function awaitableRead(filePath: string): string {
  return require("node:fs").readFileSync(filePath, "utf8");
}

describe("pattern detectors — corpus fires/silent pairs", () => {
  const reviewMustFire = corpus().flatMap((entry) =>
    entry.expected
      .filter((e) => e.surface === "review" && e.mustFire)
      .map((e) => ({ entry, expected: e })),
  );

  for (const { entry, expected } of reviewMustFire) {
    it(`${entry.id} fires ${expected.code} after apply and is silent before`, () => {
      const root = track(entry.build());
      const before = runPatternDetectors(root).filter((f) => f.code === expected.code);
      expect(before).toHaveLength(0);
      entry.apply(root);
      const after = runPatternDetectors(root).filter((f) => f.code === expected.code);
      expect(after.length).toBeGreaterThan(0);
      expect(after.some((f) => f.file.includes(expected.file.split("/").pop()!) || expected.file.includes(f.file) || f.file.endsWith(expected.file) || expected.file.endsWith(f.file) || expected.file === f.file)).toBe(true);
    });
  }

  it("clean base project emits zero pattern findings", () => {
    const root = track(byPattern("confidently-wrong")[0]!.build());
    expect(runPatternDetectors(root)).toHaveLength(0);
  });
});

/**
 * Held-out controls (A37.1 + A38.3) — never in corpus() (A36.1 denominator stays 11).
 *
 * Controls come in pairs per pattern detector:
 *   - fire: a defect the detector was not fixture-fitted against
 *   - silent: legitimate code the detector was not written against (the 87/89 direction)
 */
describe("held-out controls (A37/A38) — not in corpus()", () => {
  function minimalWithSrc(relFile: string, body: string): string {
    const root = track(path.join(os.tmpdir(), `heldout-${Date.now()}-${Math.random().toString(16).slice(2)}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    // Emit the verification marker so confidently-wrong does not fire on the fixture shell.
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  return "ok";
}
`,
    );
    writeFileSync(path.join(root, relFile), body);
    return root;
  }

  // --- FIRE column (held-out defects) ---

  it("FIRE regex-over-structure: planHasTask new RegExp XML guard (A37.1 / corr 86)", () => {
    const root = minimalWithSrc(
      "src/plan-has-task.ts",
      `export function planHasTask(xml: string, id: string): boolean {
  const re = new RegExp(\`<Task[^>]*id="\${id}"\`);
  return re.test(xml);
}
`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.file.endsWith("plan-has-task.ts"))).toBe(true);
  });

  it("FIRE confidently-wrong: MustExist of a non-corpus path", () => {
    const root = track(byPattern("confidently-wrong")[0]!.build());
    const changeDir = path.join(root, ".ngrace/changes/active/C-HELDOUT-CW");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      path.join(changeDir, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-HELDOUT-CW>
  <IntentSummary>Held-out</IntentSummary>
  <BaselineAssertions><MustExist><Value>src/example.ts</Value></MustExist></BaselineAssertions>
  <TargetAssertions><MustExist><Value>build/artifacts/held-out-absent.bin</Value></MustExist></TargetAssertions>
  <DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors><VerificationAnchors><V-M-EXAMPLE /></VerificationAnchors></DurableScope>
  <ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>
  <ImplementationPlan><T-001><Title>T</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>c</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001></ImplementationPlan>
</C-HELDOUT-CW></NgraceChangePlan>`,
    );
    writeFileSync(
      path.join(changeDir, "spec.xml"),
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-HELDOUT-CW>
  <Summary>Held-out</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints>
  <NonGoals><NonGoal>n</NonGoal></NonGoals>
  <AcceptanceCriteria><AC-H1>a</AC-H1></AcceptanceCriteria>
  <AffectedAreas><M-EXAMPLE /></AffectedAreas>
  <VerificationIntent><ExpectedCommand>echo 1</ExpectedCommand><ExpectedEvidence>e</ExpectedEvidence></VerificationIntent>
</C-HELDOUT-CW></NgraceChangeSpec>`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.confidently-wrong");
    expect(findings.some((f) => f.message.includes("build/artifacts/held-out-absent.bin"))).toBe(true);
  });

  it("FIRE self-referential-comparison: expect(parsed).toEqual(parsed) after JSON.parse", () => {
    const root = minimalWithSrc(
      "src/roundtrip.test.ts",
      `import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
test("roundtrip", () => {
  const parsed = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
  expect(parsed).toEqual(parsed);
});
`,
    );
    const findings = runPatternDetectors(root).filter(
      (f) => f.code === "review.self-referential-comparison",
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it("FIRE zero-or-more-swallow: empty DependsOn with non-corpus sequencing title", () => {
    const entry = corpus().find((e) => e.id === "corpus-zo-02-empty-depends-malformed-task")!;
    const zoRoot = track(entry.build());
    const planPath = path.join(zoRoot, ".ngrace/changes/active/C-CORPUS-ZO2/plan.xml");
    const plan = require("node:fs").readFileSync(planPath, "utf8") as string;
    writeFileSync(
      planPath,
      plan.replace(
        /<ImplementationPlan>[\s\S]*?<\/ImplementationPlan>/,
        `<ImplementationPlan><T-001><Title>Bootstrap</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>First done.</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001><T-002><Title>Runs once T-001 completes</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Second done.</Criterion></AcceptanceCriteria><Verification><Command>echo 2</Command></Verification></T-002></ImplementationPlan>`,
      ),
    );
    const findings = runPatternDetectors(zoRoot).filter(
      (f) => f.code === "review.zero-or-more-swallow",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.message.includes("Runs once"))).toBe(true);
  });

  it("FIRE unthreaded-construct: unknown FutureHook child under V-M-*", () => {
    const root = track(byPattern("unthreaded-construct")[0]!.build());
    const verificationPath = path.join(root, ".ngrace/verification/main.xml");
    const xml = require("node:fs").readFileSync(verificationPath, "utf8") as string;
    writeFileSync(
      verificationPath,
      xml.replace("</V-M-EXAMPLE>", "<FutureHook mode=\"async\" />\n</V-M-EXAMPLE>"),
    );
    const findings = runPatternDetectors(root).filter(
      (f) => f.code === "review.unthreaded-construct",
    );
    expect(findings.some((f) => f.message.includes("FutureHook"))).toBe(true);
  });

  // --- SILENT column (held-out legitimate variants) ---

  it("SILENT regex-over-structure: renamed transform helper (A38.1 / corr 89 rename probe)", () => {
    // Pure rename of stripQuotedStrings → stripLiterals; behaviour identical; must stay silent.
    const root = minimalWithSrc(
      "src/markers.ts",
      `export function stripLiterals(text: string) {
  return text.replace(/"[^"]*"/g, " ");
}
export function hasGraceMarkers(text: string) {
  const searchable = stripLiterals(text);
  return searchable.split("\\n").some((line) =>
    /^(\\s*)(\\/\\/|#|--|;+|\\*)\\s*(?:START_MODULE_CONTRACT(?![A-Za-z0-9_]))/.test(line),
  );
}
`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.filter((f) => f.file.endsWith("markers.ts"))).toHaveLength(0);
  });

  it("SILENT confidently-wrong: MustExist of a path that is present on disk", () => {
    const root = track(byPattern("confidently-wrong")[0]!.build());
    const changeDir = path.join(root, ".ngrace/changes/active/C-HELDOUT-CW-OK");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      path.join(changeDir, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-HELDOUT-CW-OK>
  <IntentSummary>Held-out silent</IntentSummary>
  <BaselineAssertions><MustExist><Value>src/example.ts</Value></MustExist></BaselineAssertions>
  <TargetAssertions><MustExist><Value>src/example.ts</Value></MustExist></TargetAssertions>
  <DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors><VerificationAnchors><V-M-EXAMPLE /></VerificationAnchors></DurableScope>
  <ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>
  <ImplementationPlan><T-001><Title>T</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>c</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001></ImplementationPlan>
</C-HELDOUT-CW-OK></NgraceChangePlan>`,
    );
    writeFileSync(
      path.join(changeDir, "spec.xml"),
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-HELDOUT-CW-OK>
  <Summary>Held-out silent</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints>
  <NonGoals><NonGoal>n</NonGoal></NonGoals>
  <AcceptanceCriteria><AC-H1>a</AC-H1></AcceptanceCriteria>
  <AffectedAreas><M-EXAMPLE /></AffectedAreas>
  <VerificationIntent><ExpectedCommand>echo 1</ExpectedCommand><ExpectedEvidence>e</ExpectedEvidence></VerificationIntent>
</C-HELDOUT-CW-OK></NgraceChangeSpec>`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.confidently-wrong");
    expect(findings.filter((f) => f.message.includes("src/example.ts"))).toHaveLength(0);
  });

  it("SILENT self-referential-comparison: expect(actual).toEqual(expected) with distinct ids", () => {
    const root = minimalWithSrc(
      "src/roundtrip-ok.test.ts",
      `import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
test("roundtrip", () => {
  const actual = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
  const expected = { ok: true };
  expect(actual).toEqual(expected);
});
`,
    );
    const findings = runPatternDetectors(root).filter(
      (f) => f.code === "review.self-referential-comparison",
    );
    expect(findings).toHaveLength(0);
  });

  it("SILENT zero-or-more-swallow: empty DependsOn without sequencing claim in title", () => {
    const entry = corpus().find((e) => e.id === "corpus-zo-02-empty-depends-malformed-task")!;
    const zoRoot = track(entry.build());
    const planPath = path.join(zoRoot, ".ngrace/changes/active/C-CORPUS-ZO2/plan.xml");
    const plan = require("node:fs").readFileSync(planPath, "utf8") as string;
    writeFileSync(
      planPath,
      plan.replace(
        /<ImplementationPlan>[\s\S]*?<\/ImplementationPlan>/,
        `<ImplementationPlan><T-001><Title>Bootstrap utilities</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>First done.</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001><T-002><Title>Register adapters</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Second done.</Criterion></AcceptanceCriteria><Verification><Command>echo 2</Command></Verification></T-002></ImplementationPlan>`,
      ),
    );
    const findings = runPatternDetectors(zoRoot).filter(
      (f) => f.code === "review.zero-or-more-swallow",
    );
    expect(findings).toHaveLength(0);
  });

  it("SILENT unthreaded-construct: only known Command child under V-M-*", () => {
    const root = track(byPattern("unthreaded-construct")[0]!.build());
    // base clean project already has only known children; ensure no unthreaded findings
    const findings = runPatternDetectors(root).filter(
      (f) => f.code === "review.unthreaded-construct",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("A37/A38 corrections 86–90", () => {
  it("corr 87/89: transform-then-scan shape is silent regardless of helper name", () => {
    const root = track(path.join(os.tmpdir(), `corr87-${Date.now()}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return 1; }\n`,
    );
    writeFileSync(
      path.join(root, "src", "markers.ts"),
      `export function stripQuotedStrings(text: string) { return text; }
export function hasGraceMarkers(text: string) {
  const searchable = stripQuotedStrings(text);
  return searchable.split("\\n").some((line) =>
    /^(\\s*)(\\/\\/|#|--|;+|\\*)\\s*(?:START_MODULE_CONTRACT(?![A-Za-z0-9_]))/.test(line),
  );
}
`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.filter((f) => f.file.endsWith("markers.ts"))).toHaveLength(0);
  });

  it("corr 89: stripQuotedStrings *name* alone does not silence a raw-input scan", () => {
    // Pre-fix (symbol-name clause) stayed silent here; dataflow fix must fire.
    const root = track(path.join(os.tmpdir(), `corr89-raw-${Date.now()}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return 1; }\n`,
    );
    writeFileSync(
      path.join(root, "src", "raw-scan.ts"),
      `export function stripQuotedStrings(text: string) { return text; }
/** Mentions stripQuotedStrings but scans the raw parameter. */
export function fileLooksGoverned(source: string): boolean {
  void stripQuotedStrings;
  return source.split("\\n").some((line) =>
    /^(\\s*)(\\/\\/|#)\\s*START_MODULE_CONTRACT/.test(line),
  );
}
`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.some((f) => f.file.endsWith("raw-scan.ts"))).toBe(true);
  });

  it("corr 89: re-03 corpus instance still fires after dataflow fix", () => {
    const entry = corpus().find((e) => e.id === "corpus-re-03-nested-template-markers")!;
    const root = track(entry.build());
    entry.apply(root);
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.some((f) => f.file.endsWith("scan-markers.ts"))).toBe(true);
  });

  it("corr 88: review surface is scanned except shape-data modules", () => {
    const root = track(path.join(os.tmpdir(), `corr88-${Date.now()}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src", "review"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return 1; }\n`,
    );
    writeFileSync(
      path.join(root, "src", "review", "rogue-guard.ts"),
      `export function elementId(xml: string, id: string): boolean {
  return new RegExp(\`<Item id="\${id}"\`).test(xml);
}
`,
    );
    writeFileSync(
      path.join(root, "src", "review", "shape-data.ts"),
      `/** @ngrace-review-shape-data */
export function patternSourceLooksLikeMarkupGuard(p: string) {
  return /<[A-Za-z]/.test(p);
}
`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.some((f) => f.file.replaceAll("\\\\", "/").endsWith("review/rogue-guard.ts"))).toBe(
      true,
    );
    expect(findings.some((f) => f.file.includes("shape-data"))).toBe(false);
  });

  it("finding 91: pure-// marker line guard (no # alternative) still fires", () => {
    // Adversarial: pattern source is /^\/\/\s*START_MODULE…/ with only escaped slashes.
    const root = track(path.join(os.tmpdir(), `f91-${Date.now()}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return 1; }\n`,
    );
    writeFileSync(
      path.join(root, "src", "pure-slash.ts"),
      `export function fileLooksGoverned(source: string): boolean {
  return source.split("\\n").some((line) =>
    /^\\/\\/\\s*START_MODULE_CONTRACT/.test(line),
  );
}
`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
    expect(findings.some((f) => f.file.endsWith("pure-slash.ts"))).toBe(true);
  });

  it("corr 90: shape-data exemptions appear in summary count and JSON paths", () => {
    const root = track(path.join(os.tmpdir(), `corr90-${Date.now()}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src", "review"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return 1; }\n`,
    );
    writeFileSync(
      path.join(root, "src", "review", "shape-data.ts"),
      `/** @ngrace-review-shape-data */
export function patternSourceLooksLikeMarkupGuard(p: string) {
  return /<[A-Za-z]/.test(p);
}
`,
    );
    const result = runReview(root, { processAudits: false, joinEngine: false });
    expect(result.summary.shapeDataExemptions).toBeGreaterThanOrEqual(1);
    expect(result.shapeDataExemptions.some((p) => p.includes("shape-data"))).toBe(true);
    const text = formatReviewResult(result);
    expect(text).toContain("Shape-data exemptions:");
    expect(text).toMatch(/shape-data/);
  });
});

/**
 * A39.1 / corr 92 — four fixtures that differ only in form, not meaning.
 * (b) and (c) are the same program; only binding the transform result used to silence.
 * (d) firing pins that two-step raw scans are still caught (not form-matching the other way).
 */
describe("A39 correction 92 — inline vs bound transform (four fixtures)", () => {
  const MARKER_LINE =
    String.raw`/^(\s*)(\/\/|#)\s*START_MODULE_CONTRACT/`;

  function projectWith(body: string): string {
    const root = track(path.join(os.tmpdir(), `corr92-${Date.now()}-${Math.random().toString(16).slice(2)}`));
    mkdirSync(root, { recursive: true });
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return 1; }\n`,
    );
    writeFileSync(path.join(root, "src", "scan.ts"), body);
    return root;
  }

  function regexFindings(root: string) {
    return runPatternDetectors(root).filter((f) => f.code === "review.regex-over-structure");
  }

  it("(a) raw input chained: source.split.some → fire", () => {
    const root = projectWith(
      `export function fileLooksGoverned(source: string): boolean {
  return source.split("\\n").some((l) =>
    ${MARKER_LINE}.test(l),
  );
}
`,
    );
    expect(regexFindings(root).some((f) => f.file.endsWith("scan.ts"))).toBe(true);
  });

  it("(b) inline transform: normalize(source).split.some → silent", () => {
    const root = projectWith(
      `export function normalize(text: string): string { return text; }
export function fileLooksGoverned(source: string): boolean {
  return normalize(source).split("\\n").some((l) =>
    ${MARKER_LINE}.test(l),
  );
}
`,
    );
    expect(regexFindings(root).filter((f) => f.file.endsWith("scan.ts"))).toHaveLength(0);
  });

  it("(c) bound transform: const s = normalize(source); s.split via lines → silent", () => {
    const root = projectWith(
      `export function normalize(text: string): string { return text; }
export function fileLooksGoverned(source: string): boolean {
  const s = normalize(source);
  const lines = s.split("\\n");
  return lines.some((l) =>
    ${MARKER_LINE}.test(l),
  );
}
`,
    );
    expect(regexFindings(root).filter((f) => f.file.endsWith("scan.ts"))).toHaveLength(0);
  });

  it("(d) raw two-step: const lines = source.split; lines.some → fire", () => {
    const root = projectWith(
      `export function fileLooksGoverned(source: string): boolean {
  const lines = source.split("\\n");
  return lines.some((l) =>
    ${MARKER_LINE}.test(l),
  );
}
`,
    );
    expect(regexFindings(root).some((f) => f.file.endsWith("scan.ts"))).toBe(true);
  });
});

describe("join engine (A34.1) — family B codes", () => {
  it("scope×home fires when scope not admitted", () => {
    const fire = runJoinProbes([
      {
        kind: "scope-home",
        recordScope: "bundle",
        homeAdmits: ["task", "epoch"],
        file: "src/gates/ledger.ts",
      },
    ]);
    expect(fire.some((f) => f.code === "review.counterpart-scope-mismatch")).toBe(true);
    const silent = runJoinProbes([
      {
        kind: "scope-home",
        recordScope: "bundle",
        homeAdmits: ["bundle", "project"],
        file: "src/gates/ledger.ts",
      },
    ]);
    expect(silent).toHaveLength(0);
  });

  it("writer×commands fires when writer has no command (corr 62 shape)", () => {
    const fire = runJoinProbes([
      {
        kind: "writer-command",
        exportedWriters: ["recordReviewVerdict"],
        invocableCommands: ["gate approve", "gate apply"],
        file: "src/gates/ledger.ts",
      },
    ]);
    expect(fire.some((f) => f.code === "review.counterpart-writer-missing")).toBe(true);
    const silent = runJoinProbes([
      {
        kind: "writer-command",
        exportedWriters: ["recordReviewVerdict"],
        invocableCommands: ["gate verdict", "recordReviewVerdict"],
        file: "src/gates/ledger.ts",
      },
    ]);
    expect(silent).toHaveLength(0);
  });

  it("lint-catalog×reader fires when reader is more lenient", () => {
    const fire = runJoinProbes([
      {
        kind: "lint-vs-reader",
        lintRejects: true,
        readerTreatsAsBenign: true,
        file: "src/gates/ledger.ts",
        condition: "duplicate-verdicts-section",
      },
    ]);
    expect(fire.some((f) => f.code === "review.counterpart-reader-tolerates")).toBe(true);
    const silent = runJoinProbes([
      {
        kind: "lint-vs-reader",
        lintRejects: true,
        readerTreatsAsBenign: false,
        file: "src/gates/ledger.ts",
        condition: "duplicate-verdicts-section",
      },
    ]);
    expect(silent).toHaveLength(0);
  });

  it("diagnostic×preexisting fires when never-clearable", () => {
    const fire = runJoinProbes([
      {
        kind: "diagnostic-vs-preexisting",
        diagnosticCode: "applied-without-gate-record",
        preexistingCanNeverClear: true,
        file: "src/grace-status.ts",
      },
    ]);
    expect(fire.some((f) => f.code === "review.counterpart-grandfather-gap")).toBe(true);
    const silent = runJoinProbes([
      {
        kind: "diagnostic-vs-preexisting",
        diagnosticCode: "applied-without-gate-record",
        preexistingCanNeverClear: false,
        file: "src/grace-status.ts",
      },
    ]);
    expect(silent).toHaveLength(0);
  });
});

describe("process audits (family B)", () => {
  it("scope audit fires outside and silent inside", () => {
    const fire = auditScopeOutsideWriteScope(
      ["src/a.ts", "src/secret.ts"],
      ["src/a.ts"],
      [],
    );
    expect(fire.some((f) => f.code === "review.scope-outside-write-scope" && f.file === "src/secret.ts")).toBe(true);
    const silent = auditScopeOutsideWriteScope(["src/a.ts"], ["src/a.ts"], []);
    expect(silent).toHaveLength(0);
  });

  it("test weakening fires on assertion drop and silent on equal", () => {
    const fire = auditTestWeakening([
      {
        file: "src/a.test.ts",
        before: `expect(1).toBe(1);\nexpect(2).toBe(2);\n`,
        after: `expect(1).toBe(1);\n`,
      },
    ]);
    expect(fire.some((f) => f.code === "review.test-assertion-weakened")).toBe(true);
    const silent = auditTestWeakening([
      {
        file: "src/a.test.ts",
        before: `expect(1).toBe(1);\n`,
        after: `expect(1).toBe(1);\n`,
      },
    ]);
    expect(silent).toHaveLength(0);
  });

  it("compat audit fires on new codes", () => {
    const fire = auditCompatNewErrors(["a.one"], ["a.one", "b.two"]);
    expect(fire.some((f) => f.code === "review.compat-new-error")).toBe(true);
    const silent = auditCompatNewErrors(["a.one"], ["a.one"]);
    expect(silent).toHaveLength(0);
  });

  it("hunk coverage fires when uncovered", () => {
    const fire = auditHunkCoverage([
      { hunkKey: "src/a.ts:h1", file: "src/a.ts", covered: false },
    ]);
    expect(fire.some((f) => f.code === "review.hunk-uncovered")).toBe(true);
    const silent = auditHunkCoverage([
      { hunkKey: "src/a.ts:h1", file: "src/a.ts", covered: true },
    ]);
    expect(silent).toHaveLength(0);
  });
});

describe("runReview does not write", () => {
  it("leaves the tree free of Verdicts mutations (no ledger write)", () => {
    const root = track(mkdtempSyncSafe());
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "x.ts"),
      `export function f(s: string) { return /status\\s*=\\s*["']approved["']/.test(s); }\n`,
    );
    const before = listRel(root);
    runReview(root);
    const after = listRel(root);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// C-OBSERVABLE-CHECKS / A66 — scope audit input, absence, archive resolve
// Both directions on every axis (A7.2).
// ---------------------------------------------------------------------------

function writeScopedPlan(
  root: string,
  changeId: string,
  owsFiles: string[],
  location: "active" | "archive" = "active",
): string {
  const dir = path.join(root, ".ngrace", "changes", location, changeId);
  mkdirSync(dir, { recursive: true });
  const files = owsFiles.map((f) => `<File>${f}</File>`).join("");
  const body = `<NgraceChangePlan graceVersion="1.0" status="approved">
  <${changeId}>
    <IntentSummary>Scope audit fixture.</IntentSummary>
    <BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions>
    <TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>
    <DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>
    <ObservedWriteScope>${files}</ObservedWriteScope>
    <ImplementationPlan>
      <T-001>
        <Title>Fixture task</Title>
        <DependsOn></DependsOn>
        <AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria>
        <Verification><Command>bun test</Command></Verification>
      </T-001>
    </ImplementationPlan>
  </${changeId}>
</NgraceChangePlan>
`;
  const planPath = path.join(dir, "plan.xml");
  writeFileSync(planPath, body);
  return planPath;
}

function ensureTempRoot(): string {
  return track(mkdtempSyncSafe());
}

describe("C-OBSERVABLE-CHECKS scope audit (A66)", () => {
  it("outside scope is red; inside scope is silent (both directions)", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-SCOPE", ["src/in-scope.ts"]);
    const fire = runReview(root, {
      changeId: "C-SCOPE",
      changedFiles: ["src/in-scope.ts", "src/out-of-scope.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(fire.scopeAudit?.status).toBe("ran");
    expect(fire.findings.some((f) => f.code === "review.scope-outside-write-scope" && f.file === "src/out-of-scope.ts")).toBe(true);
    expect(fire.findings.some((f) => f.file === "src/in-scope.ts")).toBe(false);

    const silent = runReview(root, {
      changeId: "C-SCOPE",
      changedFiles: ["src/in-scope.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(silent.scopeAudit?.status).toBe("ran");
    expect(silent.findings.filter((f) => f.code === "review.scope-outside-write-scope")).toHaveLength(0);
    const text = formatReviewResult(silent);
    expect(text).toContain("Scope audit: ran over 1 changed file(s)");
    expect(text).toContain("No out-of-scope paths");
    expect(text).toContain("No review findings");
  });

  it("empty porcelain without flags is not-run (corr 169 false clean), not a silent pass", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-SCOPE", ["src/in-scope.ts"]);
    // Fully committed tree → porcelain [] → not-run (corr 169), never audit over empty set.
    spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" });
    spawnSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
      { cwd: root, encoding: "utf8" },
    );
    const result = runReview(root, {
      changeId: "C-SCOPE",
      patterns: false,
      joinEngine: false,
    });
    expect(result.scopeAudit?.status).toBe("not-run");
    expect(result.scopeAudit?.absence?.verdict).toBe("not-run");
    expect(result.scopeAudit?.reason).toMatch(/no changed files available/i);
    const text = formatReviewResult(result);
    expect(text).toContain("Scope audit: not-run —");
    expect(text).not.toMatch(/^No review findings\.$/m);
    expect(text).not.toContain("No out-of-scope paths");
  });

  it("caller-supplied empty --changed-files is clean and names the empty set (state 5)", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-SCOPE", ["src/in-scope.ts"]);
    const result = runReview(root, {
      changeId: "C-SCOPE",
      changedFiles: [],
      patterns: false,
      joinEngine: false,
    });
    expect(result.scopeAudit?.status).toBe("ran");
    expect(result.scopeAudit?.callerSuppliedEmpty).toBe(true);
    expect(result.scopeAudit?.changedFileCount).toBe(0);
    expect(result.findings).toHaveLength(0);
    const text = formatReviewResult(result);
    expect(text).toContain("caller-supplied empty set");
    expect(text).toContain("No out-of-scope paths");
    expect(text).toContain("No review findings");
  });

  it("no plan under active/ or archive/ is not-run (state 4)", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    const result = runReview(root, {
      changeId: "C-DOES-NOT-EXIST",
      changedFiles: ["src/x.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(result.scopeAudit?.status).toBe("not-run");
    expect(result.scopeAudit?.reason).toMatch(/no plan found for C-DOES-NOT-EXIST under active\/ or archive\//);
    const text = formatReviewResult(result);
    expect(text).toContain("Scope audit: not-run —");
    expect(text).not.toMatch(/^No review findings\.$/m);
  });

  it("archived plan resolves read-only and audits when diff is supplied (both directions)", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-ARCHIVED", ["src/in-scope.ts"], "archive");
    expect(resolveChangePlanPath(root, "C-ARCHIVED")?.location).toBe("archive");

    const fire = runReview(root, {
      changeId: "C-ARCHIVED",
      changedFiles: ["src/out-of-scope.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(fire.scopeAudit?.status).toBe("ran");
    expect(fire.scopeAudit?.planLocation).toBe("archive");
    expect(fire.findings.some((f) => f.file === "src/out-of-scope.ts")).toBe(true);

    const silent = runReview(root, {
      changeId: "C-ARCHIVED",
      changedFiles: ["src/in-scope.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(silent.findings.filter((f) => f.code === "review.scope-outside-write-scope")).toHaveLength(0);

    const again = resolveChangePlanPath(root, "C-ARCHIVED");
    expect(again?.location).toBe("archive");
  });

  it("active plan preferred over same id in archive", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-BOTH", ["src/active-only.ts"], "active");
    writeScopedPlan(root, "C-BOTH", ["src/archive-only.ts"], "archive");
    const resolved = resolveChangePlanPath(root, "C-BOTH");
    expect(resolved?.location).toBe("active");
    const result = runReview(root, {
      changeId: "C-BOTH",
      changedFiles: ["src/active-only.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(result.scopeAudit?.planLocation).toBe("active");
    expect(result.findings).toHaveLength(0);
    const fire = runReview(root, {
      changeId: "C-BOTH",
      changedFiles: ["src/archive-only.ts"],
      patterns: false,
      joinEngine: false,
    });
    expect(fire.findings.some((f) => f.file === "src/archive-only.ts")).toBe(true);
  });

  it("explicit non-empty diff is used (supplied path used; absent path not assumed)", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-SCOPE", ["src/a.ts"]);
    const result = runReview(root, {
      changeId: "C-SCOPE",
      changedFiles: ["src/b.ts"],
      baseRef: "origin/main", // ignored when changedFiles is defined
      patterns: false,
      joinEngine: false,
    });
    expect(result.scopeAudit?.inputSource).toBe("explicit");
    expect(result.findings.some((f) => f.file === "src/b.ts")).toBe(true);
  });

  it("ran with findings does not print No review findings (state 2)", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-SCOPE", ["src/a.ts"]);
    const result = runReview(root, {
      changeId: "C-SCOPE",
      changedFiles: ["src/secret.ts"],
      patterns: false,
      joinEngine: false,
    });
    const text = formatReviewResult(result);
    expect(text).toContain("review.scope-outside-write-scope");
    expect(text).not.toContain("No review findings");
    expect(text).toContain("Scope audit: ran over 1 changed file(s)");
  });
});

// ---------------------------------------------------------------------------
// Corr 171 — archive identity for the reviewed change only (A68)
// ---------------------------------------------------------------------------

describe("corr 171 archive identity (A68)", () => {
  const ownActive = ".ngrace/changes/active/C-MINE/plan.xml";
  const ownArchive = ".ngrace/changes/archive/C-MINE/plan.xml";
  const ownLedgerArchive = ".ngrace/changes/archive/C-MINE/run-ledger.xml";
  const otherArchive = ".ngrace/changes/archive/C-OTHER/plan.xml";
  const outside = "src/evil.ts";

  it("own relocated artifacts are silent when plan resolved from archive", () => {
    // OWS still declares active/<id>/… (as written before archive); diff shows archive/<id>/…
    const silent = auditScopeOutsideWriteScope(
      [ownArchive, ownLedgerArchive],
      [ownActive, ".ngrace/changes/active/C-MINE/run-ledger.xml"],
      [],
      { changeId: "C-MINE", planLocation: "archive" },
    );
    expect(silent).toHaveLength(0);
  });

  it("another bundle under archive/<other-id>/ is still a finding (both directions)", () => {
    const fire = auditScopeOutsideWriteScope(
      [ownArchive, otherArchive],
      [ownActive],
      [],
      { changeId: "C-MINE", planLocation: "archive" },
    );
    expect(fire.some((f) => f.file === otherArchive)).toBe(true);
    expect(fire.some((f) => f.file === ownArchive)).toBe(false);

    // Without other-bundle path: clean
    const onlyOwn = auditScopeOutsideWriteScope(
      [ownArchive],
      [ownActive],
      [],
      { changeId: "C-MINE", planLocation: "archive" },
    );
    expect(onlyOwn).toHaveLength(0);
  });

  it("active plan location is unchanged — no archive alias when still active", () => {
    // Declared active, changed is archive path: still out of scope when plan is active
    // (close-time is under active/; we do not rewrite before archive).
    const fire = auditScopeOutsideWriteScope(
      [ownArchive],
      [ownActive],
      [],
      { changeId: "C-MINE", planLocation: "active" },
    );
    expect(fire.some((f) => f.file === ownArchive)).toBe(true);

    // Declared active, changed active: silent as today
    const silent = auditScopeOutsideWriteScope(
      [ownActive],
      [ownActive],
      [],
      { changeId: "C-MINE", planLocation: "active" },
    );
    expect(silent).toHaveLength(0);
  });

  it("non-artifact path outside scope is still a finding", () => {
    const fire = auditScopeOutsideWriteScope(
      [ownArchive, outside],
      [ownActive, "src/in-scope.ts"],
      [],
      { changeId: "C-MINE", planLocation: "archive" },
    );
    expect(fire.some((f) => f.file === outside)).toBe(true);
    expect(fire.some((f) => f.file === ownArchive)).toBe(false);
  });

  it("expand is id-scoped: does not alias another change id", () => {
    const expanded = expandScopePathsForArchiveIdentity(
      [ownActive, ".ngrace/changes/active/C-OTHER/spec.xml"],
      { changeId: "C-MINE", planLocation: "archive" },
    );
    expect(expanded).toContain(ownArchive);
    expect(expanded).toContain(ownActive);
    // C-OTHER active path is present as declared but NOT expanded to archive/C-OTHER
    expect(expanded).toContain(".ngrace/changes/active/C-OTHER/spec.xml");
    expect(expanded).not.toContain(".ngrace/changes/archive/C-OTHER/spec.xml");
  });

  it("end-to-end: archived plan + own archive paths clean; other archive red", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(
      root,
      "C-MINE",
      [
        ".ngrace/changes/active/C-MINE/plan.xml",
        ".ngrace/changes/active/C-MINE/spec.xml",
        "src/in-scope.ts",
      ],
      "archive",
    );
    const clean = runReview(root, {
      changeId: "C-MINE",
      changedFiles: [
        ".ngrace/changes/archive/C-MINE/plan.xml",
        ".ngrace/changes/archive/C-MINE/spec.xml",
        "src/in-scope.ts",
      ],
      patterns: false,
      joinEngine: false,
    });
    expect(clean.scopeAudit?.planLocation).toBe("archive");
    expect(clean.findings.filter((f) => f.code === "review.scope-outside-write-scope")).toHaveLength(0);

    const dirty = runReview(root, {
      changeId: "C-MINE",
      changedFiles: [
        ".ngrace/changes/archive/C-MINE/plan.xml",
        ".ngrace/changes/archive/C-OTHER/plan.xml",
      ],
      patterns: false,
      joinEngine: false,
    });
    expect(dirty.findings.some((f) => f.file === ".ngrace/changes/archive/C-OTHER/plan.xml")).toBe(true);
    expect(dirty.findings.some((f) => f.file === ".ngrace/changes/archive/C-MINE/plan.xml")).toBe(false);
  });
});

/**
 * C-REPORT-HONESTY T-003 / AC-MUSTEXIST-ARCHIVE-IDENTITY (F16).
 * detectConfidentlyWrong must apply Correction 171 to MustExist disk paths —
 * same expandScopePathsForArchiveIdentity as the scope audit, not a second rule.
 */
describe("C-REPORT-HONESTY T-003 MustExist archive identity (F16)", () => {
  function writeArchivedPlanWithMustExist(
    root: string,
    changeId: string,
    mustExistPath: string,
    opts?: { alsoWriteSpecAtArchive?: boolean; alsoWriteSpecAtActive?: boolean },
  ) {
    const archiveDir = path.join(root, ".ngrace/changes/archive", changeId);
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      path.join(archiveDir, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="applied"><${changeId}>
  <IntentSummary>F16 fixture</IntentSummary>
  <BaselineAssertions><MustExist><Value>${mustExistPath}</Value></MustExist></BaselineAssertions>
  <TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>
  <DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>
  <ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>
  <ImplementationPlan><T-001><Title>T</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>c</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001></ImplementationPlan>
</${changeId}></NgraceChangePlan>`,
    );
    if (opts?.alsoWriteSpecAtArchive) {
      writeFileSync(
        path.join(archiveDir, "spec.xml"),
        `<NgraceChangeSpec graceVersion="1.0" status="applied"><${changeId}><Summary>s</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints><NonGoals><NonGoal>n</NonGoal></NonGoals><AcceptanceCriteria><Criterion>a</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>echo 1</ExpectedCommand><ExpectedEvidence>e</ExpectedEvidence></VerificationIntent></${changeId}></NgraceChangeSpec>`,
      );
    }
    if (opts?.alsoWriteSpecAtActive) {
      const activeDir = path.join(root, ".ngrace/changes/active", changeId);
      mkdirSync(activeDir, { recursive: true });
      writeFileSync(
        path.join(activeDir, "spec.xml"),
        `<NgraceChangeSpec graceVersion="1.0" status="applied"><${changeId}><Summary>s</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints><NonGoals><NonGoal>n</NonGoal></NonGoals><AcceptanceCriteria><Criterion>a</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>echo 1</ExpectedCommand><ExpectedEvidence>e</ExpectedEvidence></VerificationIntent></${changeId}></NgraceChangeSpec>`,
      );
    }
  }

  it("archive plan MustExist active/<own-id>/spec.xml is silent when file lives under archive/<own-id>/", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    // Emit default verification marker so marker half does not fire.
    writeFileSync(
      path.join(root, "src/example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return "ok"; }\n`,
    );
    writeArchivedPlanWithMustExist(
      root,
      "C-ARCH-OWN",
      ".ngrace/changes/active/C-ARCH-OWN/spec.xml",
      { alsoWriteSpecAtArchive: true },
    );
    const findings = runPatternDetectors(root).filter(
      (f) =>
        f.code === "review.confidently-wrong"
        && f.file.includes("C-ARCH-OWN")
        && f.message.includes("MustExist"),
    );
    expect(findings).toHaveLength(0);
  });

  it("counterweight: path absent under both active and archive aliases still fires", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeFileSync(
      path.join(root, "src/example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return "ok"; }\n`,
    );
    writeArchivedPlanWithMustExist(
      root,
      "C-ARCH-MISS",
      ".ngrace/changes/active/C-ARCH-MISS/spec.xml",
      // neither archive nor active gets the file
    );
    const findings = runPatternDetectors(root).filter(
      (f) =>
        f.code === "review.confidently-wrong"
        && f.message.includes(".ngrace/changes/active/C-ARCH-MISS/spec.xml"),
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it("counterweight: MustExist of a different change id that is absent still fires", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeFileSync(
      path.join(root, "src/example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return "ok"; }\n`,
    );
    // Own archive has its own spec, but MustExist names a foreign id's active path.
    writeArchivedPlanWithMustExist(
      root,
      "C-ARCH-OWN2",
      ".ngrace/changes/active/C-FOREIGN/spec.xml",
      { alsoWriteSpecAtArchive: true },
    );
    // Even if foreign exists only under archive, same-id expansion must not clear C-FOREIGN.
    mkdirSync(path.join(root, ".ngrace/changes/archive/C-FOREIGN"), { recursive: true });
    writeFileSync(
      path.join(root, ".ngrace/changes/archive/C-FOREIGN/spec.xml"),
      `<NgraceChangeSpec graceVersion="1.0" status="applied"><C-FOREIGN><Summary>foreign</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints><NonGoals><NonGoal>n</NonGoal></NonGoals><AcceptanceCriteria><Criterion>a</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>echo 1</ExpectedCommand><ExpectedEvidence>e</ExpectedEvidence></VerificationIntent></C-FOREIGN></NgraceChangeSpec>`,
    );
    const findings = runPatternDetectors(root).filter(
      (f) =>
        f.code === "review.confidently-wrong"
        && f.message.includes(".ngrace/changes/active/C-FOREIGN/spec.xml"),
    );
    // Global active→archive would silence this because archive/C-FOREIGN/spec.xml exists.
    // Id-scoped Correction 171 must still fire.
    expect(findings.length).toBeGreaterThan(0);
  });

  it("counterweight: active plan MustExist of a genuinely missing path still fires", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeFileSync(
      path.join(root, "src/example.ts"),
      `export function run() { console.info("[Example][run][BLOCK_RUN]"); return "ok"; }\n`,
    );
    const activeDir = path.join(root, ".ngrace/changes/active/C-ACTIVE-MISS");
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(
      path.join(activeDir, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-ACTIVE-MISS>
  <IntentSummary>Active missing</IntentSummary>
  <BaselineAssertions><MustExist><Value>build/artifacts/genuinely-absent.bin</Value></MustExist></BaselineAssertions>
  <TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>
  <DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>
  <ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>
  <ImplementationPlan><T-001><Title>T</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>c</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001></ImplementationPlan>
</C-ACTIVE-MISS></NgraceChangePlan>`,
    );
    const findings = runPatternDetectors(root).filter(
      (f) =>
        f.code === "review.confidently-wrong"
        && f.message.includes("build/artifacts/genuinely-absent.bin"),
    );
    expect(findings.length).toBeGreaterThan(0);
  });
});

/**
 * C-REPORT-HONESTY T-004 / AC-SCOPE-LIFECYCLE-EXCLUSION + AC-LEDGER-INVALID-STILL-CATCHES (F11).
 * CLI lifecycle paths are tool-owned; scope audit must not cry wolf on them.
 * Assert via auditScopeOutsideWriteScope directly (not live porcelain).
 */
describe("C-REPORT-HONESTY T-004 scope lifecycle exclusion (F11)", () => {
  const ows = ["src/in-scope.ts"];
  const lifecyclePaths = [
    ".ngrace/changes/active/C-A/run/1-T-001-opened.xml",
    ".ngrace/changes/active/C-A/run/2-T-001-attempt.xml",
    ".ngrace/changes/active/C-A/run.xml",
    ".ngrace/changes/active/C-A/run-ledger.xml",
    ".ngrace/changes/archive/C-B/run/9-T-003-progress.xml",
    ".ngrace/changes/archive/C-B/run.xml",
    ".ngrace/changes/archive/C-B/run-ledger.xml",
  ];

  it("AC-SCOPE-LIFECYCLE-EXCLUSION: lifecycle-only paths for any C-* yield zero findings", () => {
    // Empty OWS for lifecycle would also skip via empty-scope short-circuit; declare
    // real OWS so silence is from the lifecycle exclusion, not the empty-scope guard.
    const findings = auditScopeOutsideWriteScope(lifecyclePaths, ows, [], {
      changeId: "C-REVIEW",
      planLocation: "active",
    });
    expect(findings.filter((f) => f.code === "review.scope-outside-write-scope")).toHaveLength(0);
  });

  it("AC-SCOPE-LIFECYCLE-EXCLUSION: cross-bundle — fold of A does not error a review of B", () => {
    // Porcelain from C-A lifecycle while reviewing C-B; identity is C-B, not C-A.
    const foldOfA = [
      ".ngrace/changes/active/C-A/run/1-T-001-opened.xml",
      ".ngrace/changes/active/C-A/run/2-T-001-terminal.xml",
      ".ngrace/changes/active/C-A/run-ledger.xml",
      ".ngrace/changes/active/C-A/run.xml",
    ];
    const findings = auditScopeOutsideWriteScope(foldOfA, ows, [], {
      changeId: "C-B",
      planLocation: "active",
    });
    expect(findings).toHaveLength(0);
  });

  it("AC-SCOPE-LIFECYCLE-EXCLUSION: fold deletions (run/** paths as deleted porcelain) yield zero findings", () => {
    // auditScopeOutsideWriteScope sees paths only — deleted and modified look the same.
    const deletedEvents = [
      ".ngrace/changes/active/C-FOLD/run/1-T-001-opened.xml",
      ".ngrace/changes/active/C-FOLD/run/2-T-001-attempt.xml",
      ".ngrace/changes/active/C-FOLD/run/3-T-001-terminal.xml",
      ".ngrace/changes/active/C-FOLD/run-ledger.xml",
    ];
    const findings = auditScopeOutsideWriteScope(deletedEvents, ows, []);
    expect(findings).toHaveLength(0);
  });

  it("AC-SCOPE-LIFECYCLE-EXCLUSION: plan.xml and spec.xml are not excluded", () => {
    const findings = auditScopeOutsideWriteScope(
      [
        ".ngrace/changes/active/C-A/plan.xml",
        ".ngrace/changes/active/C-A/spec.xml",
        ...lifecyclePaths,
      ],
      ows,
      [],
    );
    const codes = findings.filter((f) => f.code === "review.scope-outside-write-scope");
    expect(codes.some((f) => f.file === ".ngrace/changes/active/C-A/plan.xml")).toBe(true);
    expect(codes.some((f) => f.file === ".ngrace/changes/active/C-A/spec.xml")).toBe(true);
    // Lifecycle companions must still be silent.
    expect(codes.some((f) => f.file.includes("/run"))).toBe(false);
  });

  it("AC-SCOPE-LIFECYCLE-EXCLUSION counterweight: src/secret.ts alongside lifecycle still fires", () => {
    const findings = auditScopeOutsideWriteScope(
      [...lifecyclePaths, "src/secret.ts"],
      ows,
      [],
    );
    expect(findings.some((f) => f.file === "src/secret.ts" && f.code === "review.scope-outside-write-scope")).toBe(
      true,
    );
    expect(findings.filter((f) => f.file !== "src/secret.ts")).toHaveLength(0);
  });

  it("AC-SCOPE-LIFECYCLE-EXCLUSION: non-canonical id (scratch) is not treated as lifecycle", () => {
    // ANCHOR_PATTERNS.change must gate the id segment — bare "any directory" would silence this.
    const findings = auditScopeOutsideWriteScope(
      [".ngrace/changes/active/scratch/run.xml", ".ngrace/changes/active/scratch/run/1.xml"],
      ows,
      [],
    );
    expect(findings.some((f) => f.file === ".ngrace/changes/active/scratch/run.xml")).toBe(true);
    expect(findings.some((f) => f.file === ".ngrace/changes/active/scratch/run/1.xml")).toBe(true);
  });

  it("AC-LEDGER-INVALID-STILL-CATCHES: malformed Allocation still raises ledger.invalid-allocation", () => {
    const result = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        `<NgraceRunLedger graceVersion="1.0"><C-X><Epoch-1><Allocation worker="w0" from="NaN" to="10"/><Event id="1" task="T-001" kind="opened"/><Event id="2" task="T-001" kind="terminal"/></Epoch-1></C-X></NgraceRunLedger>`,
      ),
    );
    expect(result.issues.some((i) => i.code === "ledger.invalid-allocation")).toBe(true);
  });

  it("AC-LEDGER-INVALID-STILL-CATCHES: malformed Event still raises ledger.invalid-event", () => {
    const result = validateRunLedgerArtifact(
      parseGraceXmlArtifact(
        "run-ledger.xml",
        `<NgraceRunLedger graceVersion="1.0"><C-X><Epoch-1><Allocation worker="w0" from="1" to="10"/><Event id="bad" task="T-001" kind="opened"/><Event id="2" task="T-001" kind="terminal"/></Epoch-1></C-X></NgraceRunLedger>`,
      ),
    );
    expect(result.issues.some((i) => i.code === "ledger.invalid-event")).toBe(true);
  });
});

function mkdtempSyncSafe(): string {
  const root = path.join(os.tmpdir(), `ngrace-review-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function listRel(root: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(root, rel || "."))) {
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(root, r)).isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk("");
  return out.sort();
}


describe("corr 205 — review language scope (polyglot false positives)", () => {
  it("marker emitted from Go is silent; missing marker still fires", () => {
    const root = track(path.join(os.tmpdir(), `corr205-go-${Date.now()}`));
    writeMinimalNgraceProject(root);
    // Linked Go runtime with the verification marker
    mkdirSync(path.join(root, "services/api"), { recursive: true });
    writeFileSync(
      path.join(root, "services/api/router.go"),
      `package api\n\nfunc Route() { slog.Info("[Example][run][BLOCK_RUN] ok") }\n`,
    );
    // Point module path + LINKS at the Go file
    writeFileSync(
      path.join(root, ".ngrace/graph/main.xml"),
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>services/api/router.go</Path></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
    );
    writeFileSync(
      path.join(root, "services/api/router.go"),
      `// START_MODULE_CONTRACT
//   PURPOSE: Gateway.
//   SCOPE: Dispatch.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   Route
// END_MODULE_MAP
package api
func Route() { println("[Example][run][BLOCK_RUN] ok") }
`,
    );
    // Remove default TS example marker emission so Go is the sole emitter
    writeFileSync(
      path.join(root, "src/example.ts"),
      `// START_MODULE_CONTRACT
//   PURPOSE: Example.
//   SCOPE: Fixture.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   run
// END_MODULE_MAP
export function run() { return 1; }
`,
    );
    const silent = runPatternDetectors(root).filter(
      (f) => f.code === "review.confidently-wrong" && f.message.includes("marker"),
    );
    expect(silent).toHaveLength(0);

    // Discriminating negative: change marker requirement so nothing emits it
    const vPath = path.join(root, ".ngrace/verification/main.xml");
    const xml = require("node:fs").readFileSync(vPath, "utf8") as string;
    writeFileSync(vPath, xml.replace("[Example][run][BLOCK_RUN]", "[Example][run][BLOCK_NEVER]"));
    const fires = runPatternDetectors(root).filter(
      (f) => f.code === "review.confidently-wrong" && f.message.includes("BLOCK_NEVER"),
    );
    expect(fires.length).toBeGreaterThan(0);
  });

  it("marker emitted from Rust is silent", () => {
    const root = track(path.join(os.tmpdir(), `corr205-rs-${Date.now()}`));
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "crates/core/src"), { recursive: true });
    writeFileSync(
      path.join(root, "crates/core/src/lib.rs"),
      `// START_MODULE_CONTRACT
//   PURPOSE: Core.
//   SCOPE: Post.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   post
// END_MODULE_MAP
pub fn post() { println!("[Example][run][BLOCK_RUN]"); }
`,
    );
    writeFileSync(
      path.join(root, ".ngrace/graph/main.xml"),
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>crates/core/src/lib.rs</Path></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
    );
    writeFileSync(
      path.join(root, "src/example.ts"),
      `// START_MODULE_CONTRACT
//   PURPOSE: Example.
//   SCOPE: Fixture.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   run
// END_MODULE_MAP
export function run() { return 1; }
`,
    );
    const findings = runPatternDetectors(root).filter(
      (f) => f.code === "review.confidently-wrong" && f.message.includes("marker"),
    );
    expect(findings).toHaveLength(0);
  });

  it("MustExist IC-* / DF-* is not treated as a path; missing path still fires", () => {
    const root = track(path.join(os.tmpdir(), `corr205-me-${Date.now()}`));
    writeMinimalNgraceProject(root);
    const changeDir = path.join(root, ".ngrace/changes/active/C-ME");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      path.join(changeDir, "spec.xml"),
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-ME><Summary>s</Summary><Goals><Goal>g</Goal></Goals><AcceptanceCriteria><AC-1>a</AC-1></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas></C-ME></NgraceChangeSpec>`,
    );
    writeFileSync(
      path.join(changeDir, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-ME>
        <IntentSummary>i</IntentSummary>
        <BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions>
        <TargetAssertions>
          <MustExist><Value>IC-POSTING-V1</Value></MustExist>
          <MustExist><Value>DF-POSTING</Value></MustExist>
          <MustExist><Value>src/never-created.ts</Value></MustExist>
        </TargetAssertions>
        <DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>
        <ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>
        <ImplementationPlan><T-001><Title>t</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>c</Criterion></AcceptanceCriteria><Verification><Command>echo 1</Command></Verification></T-001></ImplementationPlan>
      </C-ME></NgraceChangePlan>`,
    );
    const findings = runPatternDetectors(root).filter((f) => f.code === "review.confidently-wrong");
    const messages = findings.map((f) => f.message).join("\n");
    expect(messages).not.toContain("IC-POSTING-V1");
    expect(messages).not.toContain("DF-POSTING");
    expect(messages).toContain("src/never-created.ts");
  });

  it("AccessibilityCheck and VisualCheck are silent; FutureHook still fires", () => {
    const root = track(byPattern("unthreaded-construct")[0]!.build());
    const vPath = path.join(root, ".ngrace/verification/main.xml");
    let xml = require("node:fs").readFileSync(vPath, "utf8") as string;
    xml = xml.replace(
      "</V-M-EXAMPLE>",
      `<AccessibilityCheck><Tool>axe</Tool></AccessibilityCheck>
      <VisualCheck><Tool>percy</Tool></VisualCheck>
      </V-M-EXAMPLE>`,
    );
    writeFileSync(vPath, xml);
    let findings = runPatternDetectors(root).filter((f) => f.code === "review.unthreaded-construct");
    expect(findings).toHaveLength(0);

    xml = require("node:fs").readFileSync(vPath, "utf8") as string;
    writeFileSync(
      vPath,
      xml.replace("</V-M-EXAMPLE>", `<FutureHook mode="async" />\n</V-M-EXAMPLE>`),
    );
    findings = runPatternDetectors(root).filter((f) => f.code === "review.unthreaded-construct");
    expect(findings.some((f) => f.message.includes("FutureHook"))).toBe(true);
  });

  it("polyglot golden path is green with Markers, MustExist anchors, and AccessibilityCheck restored", () => {
    const poly = path.resolve(import.meta.dir, "../../examples/polyglot");
    const report = runReview(poly);
    expect(report.summary.errors).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it("listRuntimeSourceFilesForMarkerScan prefers linked files over src-only guess", () => {
    const poly = path.resolve(import.meta.dir, "../../examples/polyglot");
    const files = listRuntimeSourceFilesForMarkerScan(poly);
    expect(files.some((f) => f.endsWith(".go"))).toBe(true);
    expect(files.some((f) => f.endsWith(".rs"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C-SUBSTANTIATION-HONESTY — identical-tree attempt-pair write evidence
// ---------------------------------------------------------------------------

/** Build WriteEvidence content digests for auditAttemptPairWriteEvidence. */
function evidenceMap(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(entries);
}

/** Retired code — must never appear in catalog or live findings after the rename. */
const RETIRED_ATTEMPT_PAIR_CODE = "review.attempt-pair-unsubstantiated";

/**
 * Authoring-time archive C-* set (plan D0 / HEAD 098783b). Frozen so a silent
 * vanish from the corpus is caught; total count is not pinned to 26.
 */
const AUTHORING_ARCHIVE_C_IDS = [
  "C-ABSENCE-VALUE",
  "C-ADOPTION-SURFACE",
  "C-ATTEMPT-LOG",
  "C-CALIBRATION",
  "C-CALIBRATION-COMMAND-EVIDENCE",
  "C-CALIBRATION-CONTEXT",
  "C-CALIBRATION-PROVENANCE",
  "C-CURSOR-INTEGRITY",
  "C-ESCALATION-HONESTY",
  "C-EXECUTION-CONTRACT",
  "C-FAILURE-LOCALIZATION",
  "C-FLAG-HONESTY",
  "C-GATE-RECORD-ABSENCE",
  "C-GATE-SURFACE",
  "C-GRAPH-COVERAGE",
  "C-LEDGER-READ-ABSENCE",
  "C-LEGIBLE-FAILURE",
  "C-OBSERVABLE-CHECKS",
  "C-PLAN-QUALITY",
  "C-RECOVER-FOLDABLE",
  "C-REPORT-HONESTY",
  "C-REVIEW-LANGUAGE-SCOPE",
  "C-REVIEW-SURFACE",
  "C-RUN-LEDGER",
  "C-SELECTION",
  "C-TOKEN-INTEGRITY",
] as const;

describe("attempt-pair identical-tree (C-SUBSTANTIATION-HONESTY)", () => {
  it("identical-tree must raise: pure identical non-.ngrace digests", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-001",
          failEventId: 2,
          passEventId: 3,
          failDigests: evidenceMap([
            ["src/impl.ts", "aaa"],
            ["src/impl.test.ts", "same"],
          ]),
          passDigests: evidenceMap([
            ["src/impl.ts", "aaa"],
            ["src/impl.test.ts", "same"],
          ]),
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(ATTEMPT_PAIR_FINDING_CODE);
    expect(findings[0]!.severity).toBe("warning");
  });

  it("identical-tree must raise: both sides empty of non-.ngrace content", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-001",
          failEventId: 1,
          passEventId: 2,
          failDigests: evidenceMap([]),
          passDigests: evidenceMap([]),
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(ATTEMPT_PAIR_FINDING_CODE);
  });

  it("identical-tree must raise: only .ngrace/ paths differ (ledger noise)", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-001",
          failEventId: 1,
          passEventId: 2,
          failDigests: evidenceMap([
            ["src/impl.ts", "x"],
            [".ngrace/changes/active/C-PAIR/run.xml", "a"],
          ]),
          passDigests: evidenceMap([
            ["src/impl.ts", "x"],
            [".ngrace/changes/active/C-PAIR/run.xml", "b"],
            [".ngrace/changes/active/C-PAIR/run/1-T-001-attempt.xml", "c"],
          ]),
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(ATTEMPT_PAIR_FINDING_CODE);
  });

  it("silent: test-only movement", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-005",
          failEventId: 16,
          passEventId: 17,
          failDigests: evidenceMap([["src/lint/catalog.test.ts", "fb93cc5603fc"]]),
          passDigests: evidenceMap([["src/lint/catalog.test.ts", "f708df110a50"]]),
        },
      ],
    });
    expect(findings.filter((f) => f.code === ATTEMPT_PAIR_FINDING_CODE)).toHaveLength(0);
    expect(findings.filter((f) => f.code === RETIRED_ATTEMPT_PAIR_CODE)).toHaveLength(0);
  });

  it("silent: production identical + test movement (old F9 pure shape)", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-TOKEN-INTEGRITY",
      pairs: [
        {
          task: "T-002",
          failEventId: 6,
          passEventId: 7,
          failDigests: evidenceMap([
            ["src/artifact/grammar.ts", "9376220ca2613ead"],
            ["src/artifact/grammar.test.ts", "641ae7e71887"],
          ]),
          passDigests: evidenceMap([
            ["src/artifact/grammar.ts", "9376220ca2613ead"],
            ["src/artifact/grammar.test.ts", "aa645bd172ae"],
          ]),
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("silent: skills-only movement", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-EXECUTION-CONTRACT",
      pairs: [
        {
          task: "T-001",
          failEventId: 2,
          passEventId: 5,
          failDigests: evidenceMap([["src/grace-cursor.ts", "same"]]),
          passDigests: evidenceMap([
            ["src/grace-cursor.ts", "same"],
            ["skills/ngrace/ngrace-execute/SKILL.md", "new"],
            ["plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md", "new"],
          ]),
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("silent: production content movement (textbook red-first)", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-001",
          failEventId: 2,
          passEventId: 3,
          failDigests: evidenceMap([
            ["src/impl.ts", "before"],
            ["src/impl.test.ts", "t1"],
          ]),
          passDigests: evidenceMap([
            ["src/impl.ts", "after"],
            ["src/impl.test.ts", "t2"],
          ]),
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("silent: path present only on pass outside .ngrace/", () => {
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-001",
          failEventId: 1,
          passEventId: 2,
          failDigests: evidenceMap([]),
          passDigests: evidenceMap([["src/impl.ts", "new"]]),
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("live archive pairs that raised under the old rule are silent under both codes", () => {
    const repoRoot = path.resolve(import.meta.dir, "../..");
    const token = runReview(repoRoot, {
      changeId: "C-TOKEN-INTEGRITY",
      changedFiles: [],
      patterns: false,
      joinEngine: false,
    });
    const tokenLive = token.findings.filter((f) => f.code === ATTEMPT_PAIR_FINDING_CODE);
    const tokenRetired = token.findings.filter((f) => f.code === RETIRED_ATTEMPT_PAIR_CODE);
    expect(tokenLive).toHaveLength(0);
    expect(tokenRetired).toHaveLength(0);

    const cursor = runReview(repoRoot, {
      changeId: "C-CURSOR-INTEGRITY",
      changedFiles: [],
      patterns: false,
      joinEngine: false,
    });
    expect(cursor.findings.filter((f) => f.code === ATTEMPT_PAIR_FINDING_CODE)).toHaveLength(0);
    expect(cursor.findings.filter((f) => f.code === RETIRED_ATTEMPT_PAIR_CODE)).toHaveLength(0);
  });

  it("archive corpus: zero live and retired findings on every dynamically enumerated C-*", () => {
    const repoRoot = path.resolve(import.meta.dir, "../..");
    const archiveDir = path.join(repoRoot, ".ngrace/changes/archive");
    // Dynamic enumeration — no expect(dirs.length).toBe(26).
    const dirs = readdirSync(archiveDir).filter((name) => {
      if (!name.startsWith("C-")) return false;
      return statSync(path.join(archiveDir, name)).isDirectory();
    });
    for (const id of AUTHORING_ARCHIVE_C_IDS) {
      expect(dirs).toContain(id);
    }
    let totalLive = 0;
    let totalRetired = 0;
    for (const id of dirs) {
      const report = runReview(repoRoot, {
        changeId: id,
        changedFiles: [],
        patterns: false,
        joinEngine: false,
      });
      const live = report.findings.filter((f) => f.code === ATTEMPT_PAIR_FINDING_CODE);
      const retired = report.findings.filter((f) => f.code === RETIRED_ATTEMPT_PAIR_CODE);
      expect(live).toHaveLength(0);
      expect(retired).toHaveLength(0);
      totalLive += live.length;
      totalRetired += retired.length;
    }
    expect(totalLive).toBe(0);
    expect(totalRetired).toBe(0);
  });

  it("archived bundle finding anchors under archive/ not active/", () => {
    const repoRoot = path.resolve(import.meta.dir, "../..");
    const findings = auditAttemptPairWriteEvidence({
      changeId: "C-ESCALATION-HONESTY",
      projectRoot: repoRoot,
      pairs: [
        {
          task: "T-FORCE",
          failEventId: 1,
          passEventId: 2,
          failDigests: evidenceMap([["src/x.ts", "a"]]),
          passDigests: evidenceMap([["src/x.ts", "a"]]),
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(ATTEMPT_PAIR_FINDING_CODE);
    expect(findings[0]!.file.startsWith(".ngrace/changes/archive/C-ESCALATION-HONESTY")).toBe(true);
    expect(findings[0]!.file.includes("/active/")).toBe(false);
  });

  it("unscoped review reports attempt-pair audit not-run with reason naming missing --change", () => {
    const repoRoot = path.resolve(import.meta.dir, "../..");
    const report = runReview(repoRoot, {
      patterns: false,
      joinEngine: false,
    });
    expect(report.attemptPairAudit?.status).toBe("not-run");
    expect(report.attemptPairAudit?.reason).toMatch(/no --change/);
    const text = formatReviewResult(report);
    expect(text).toContain("Attempt-pair audit: not-run —");
    expect(text).toMatch(/no --change/);
  });

  it("scoped review with zero pairs reports attempt-pair audit ran", () => {
    const root = ensureTempRoot();
    writeMinimalNgraceProject(root);
    writeScopedPlan(root, "C-QUIET", ["src/example.ts", "src/example.test.ts"]);
    const report = runReview(root, {
      changeId: "C-QUIET",
      changedFiles: [],
      patterns: false,
      joinEngine: false,
    });
    expect(report.attemptPairAudit?.status).toBe("ran");
    expect(report.attemptPairAudit?.pairCount).toBe(0);
    expect(report.findings.filter((f) => f.code === ATTEMPT_PAIR_FINDING_CODE)).toHaveLength(0);
  });

  it("REVIEW_CATALOG registers exact live code; retired code absent; not on F10 allowlist", () => {
    const guide = guideFor(ATTEMPT_PAIR_FINDING_CODE);
    expect(guide).toBeDefined();
    expect(guide!.code).toBe(ATTEMPT_PAIR_FINDING_CODE);
    expect(guide!.severity).toBe("warning");
    expect(guide!.explanation).toMatch(/WriteEvidence|digest|fail|pass|\.ngrace/i);
    expect(guide!.remediation.some((r) => /gate verdict|--note|findingId/i.test(r))).toBe(true);
    expect(allReviewCodes()).toContain(ATTEMPT_PAIR_FINDING_CODE);
    expect(allReviewCodes()).not.toContain(RETIRED_ATTEMPT_PAIR_CODE);
    expect(allReviewCodes()).toHaveLength(14);
    expect(guideFor(RETIRED_ATTEMPT_PAIR_CODE)).toBeUndefined();
    const catalogTest = readFileSync(
      path.join(import.meta.dir, "../lint/catalog.test.ts"),
      "utf8",
    );
    const allowlistBlock = catalogTest.match(
      /const REVIEW_PREFIX_COVERED_LEGACY_CODES: readonly string\[\] = \[([\s\S]*?)\];/,
    );
    expect(allowlistBlock).toBeTruthy();
    expect(allowlistBlock![1]).not.toContain(ATTEMPT_PAIR_FINDING_CODE);
    expect(allowlistBlock![1]).not.toContain(RETIRED_ATTEMPT_PAIR_CODE);
  });

  it("findingId is stable and suitable for gate verdict --note keying", () => {
    const a = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-009",
          failEventId: 1,
          passEventId: 2,
          failDigests: evidenceMap([["src/impl.ts", "x"]]),
          passDigests: evidenceMap([["src/impl.ts", "x"]]),
        },
      ],
    });
    const b = auditAttemptPairWriteEvidence({
      changeId: "C-PAIR",
      pairs: [
        {
          task: "T-009",
          failEventId: 1,
          passEventId: 2,
          failDigests: evidenceMap([["src/impl.ts", "x"]]),
          passDigests: evidenceMap([["src/impl.ts", "x"]]),
        },
      ],
    });
    expect(a[0]!.code).toBe(ATTEMPT_PAIR_FINDING_CODE);
    expect(a[0]!.findingId).toBe(b[0]!.findingId);
    expect(a[0]!.findingId).toMatch(/^[a-f0-9]{16}$/);
  });
});
