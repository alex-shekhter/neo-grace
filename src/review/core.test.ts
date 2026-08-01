import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { byPattern, corpus } from "../test-support/defect-corpus";
import {
  auditCompatNewErrors,
  auditHunkCoverage,
  auditScopeOutsideWriteScope,
  auditTestWeakening,
  findingId,
  formatReviewResult,
  runJoinProbes,
  runPatternDetectors,
  runReview,
} from "./core";

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
