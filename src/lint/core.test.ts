import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { formatTextReport, lintGraceProject } from "./core";
import { isGateIssueCode } from "../gates/catalog";
import { advanceCursor, listLooseEvents } from "../grace-cursor";
import { isReviewIssueCode } from "../review/catalog";
import { runReview } from "../review/core";
import { mkdirSync, writeFileSync } from "node:fs";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("D14 boundary — runLint never emits gate.*", () => {
  it("open epoch + absent review verdict yields zero gate.* codes from lint", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-d14-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-D14",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    // Open epoch with loose events; no verdict recorded.
    advanceCursor(root, "C-D14", {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 10,
    });
    const result = lintGraceProject(root, {});
    const gateCodes = result.issues.filter((issue) => isGateIssueCode(issue.code));
    expect(gateCodes).toEqual([]);
    // Sanity: lint still ran and may have other issues, but never gate.*
    expect(result.issues.every((issue) => !issue.code.startsWith("gate."))).toBe(true);
  });

  it("both directions: gate evaluation still emits gate.* on its own surface", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-d14b-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-D14B",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    const { evaluateApplyGate } = await import("../gates/core");
    const evaluation = evaluateApplyGate(root, "C-D14B");
    expect(evaluation.issues.some((i) => i.code.startsWith("gate."))).toBe(true);
    const lint = lintGraceProject(root, {});
    expect(lint.issues.filter((i) => i.code.startsWith("gate."))).toHaveLength(0);
  });
});

describe("D14 boundary — runLint never emits review.*", () => {
  it("seeded regex-over-structure fixture yields zero review.* from lint", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-d14-review-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "check-status.ts"),
      `export function planIsApproved(xml: string): boolean {
  return /status\\s*=\\s*["']approved["']/i.test(xml);
}
`,
    );
    const lint = lintGraceProject(root, {});
    expect(lint.issues.filter((i) => isReviewIssueCode(i.code))).toHaveLength(0);
    expect(lint.issues.every((i) => !i.code.startsWith("review."))).toBe(true);
  });

  it("both directions: review surface emits review.* on the same fixture", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-d14-review-b-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "check-status.ts"),
      `export function planIsApproved(xml: string): boolean {
  return /status\\s*=\\s*["']approved["']/i.test(xml);
}
`,
    );
    const review = runReview(root, { processAudits: false, joinEngine: false });
    expect(review.findings.some((f) => f.code === "review.regex-over-structure")).toBe(true);
    const lint = lintGraceProject(root, {});
    expect(lint.issues.filter((i) => i.code.startsWith("review."))).toHaveLength(0);
  });
});

describe("C-CALIBRATION-COMMAND-EVIDENCE T-001: lint --run-commands writes command-run", () => {
  it("red-first: successful target --run-commands leaves durable kind=command-run under run/", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-cmd-ev-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    const changeId = "C-CMD-EV";
    const command = "exit 0";
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions:
        `<MustExist><Value>src/example.ts</Value></MustExist>`
        + `<MustPassCommand><Command>${command}</Command></MustPassCommand>`,
    });
    advanceCursor(root, changeId, {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 20,
    });

    const before = listLooseEvents(path.join(root, ARTIFACT_DIR, "changes", "active", changeId));
    expect(before.some((e) => e.kind === "command-run")).toBe(false);

    const result = lintGraceProject(root, {
      assertionMode: "target",
      changeId,
      runCommands: true,
    });
    expect(result.issues.filter((i) => i.severity === "error" && i.code.startsWith("assertion."))).toHaveLength(0);

    const bundlePath = path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
    const after = listLooseEvents(bundlePath);
    const commandRuns = after.filter((e) => e.kind === "command-run");
    // Discriminating negative: pre-fix path runs the command and returns [] with no durable write.
    expect(commandRuns.length).toBeGreaterThanOrEqual(1);
    const event = commandRuns[commandRuns.length - 1]!;
    expect(event.attributes.command).toBe(command);
    expect(event.attributes.exitCode).toBe("0");
    expect(event.attributes.assertionPassed).toBe("true");
    expect(event.attributes.assertionKind).toBe("MustPassCommand");
    expect(event.attributes.source).toBeTruthy();

    const runDir = path.join(bundlePath, "run");
    const files = readdirSync(runDir).filter((name) => name.includes("command-run"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const xml = readFileSync(path.join(runDir, files[files.length - 1]!), "utf8");
    expect(xml).toContain('kind="command-run"');
    expect(xml).toContain(`command="${command}"`);
  });

  it("when runCommands is false, invents no command-run events from plan text", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-cmd-ev-off-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    const changeId = "C-CMD-OFF";
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions:
        `<MustExist><Value>src/example.ts</Value></MustExist>`
        + `<MustPassCommand><Command>exit 0</Command></MustPassCommand>`,
    });
    advanceCursor(root, changeId, {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 20,
    });

    lintGraceProject(root, {
      assertionMode: "target",
      changeId,
      runCommands: false,
    });

    const after = listLooseEvents(path.join(root, ARTIFACT_DIR, "changes", "active", changeId));
    expect(after.filter((e) => e.kind === "command-run")).toHaveLength(0);
  });

  it("failed MustPassCommand still writes command-run with assertionPassed=false", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-cmd-ev-fail-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    const changeId = "C-CMD-FAIL";
    writeChangeBundleFixture(root, {
      changeId,
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planTargetAssertions:
        `<MustExist><Value>src/example.ts</Value></MustExist>`
        + `<MustPassCommand><Command>exit 9</Command></MustPassCommand>`,
    });
    advanceCursor(root, changeId, {
      task: "T-001",
      openEpoch: true,
      worker: "w0",
      from: 1,
      to: 20,
    });

    const result = lintGraceProject(root, {
      assertionMode: "target",
      changeId,
      runCommands: true,
    });
    expect(result.issues.some((i) => i.code === "assertion.MustPassCommand")).toBe(true);

    const commandRuns = listLooseEvents(
      path.join(root, ARTIFACT_DIR, "changes", "active", changeId),
    ).filter((e) => e.kind === "command-run");
    expect(commandRuns.length).toBeGreaterThanOrEqual(1);
    const event = commandRuns[commandRuns.length - 1]!;
    expect(event.attributes.exitCode).not.toBe("0");
    expect(event.attributes.assertionPassed).toBe("false");
  });
});

describe("C-REPORT-HONESTY T-006: AC-BASELINE-LINT-FRAMING", () => {
  /** Keys emitted by JSON.stringify of a lint result without changeId (undefined is dropped). */
  function jsonTopLevelKeys(result: ReturnType<typeof lintGraceProject>): string[] {
    return Object.keys(JSON.parse(JSON.stringify(result)) as Record<string, unknown>).sort();
  }

  it("failing BaselineAssertions MustNotExist: text report leads with N and issues stay errors", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-baseline-frame-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-BASE-FRAME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      // src/example.ts exists in the minimal project → MustNotExist fails (expected while C-* in progress)
      planBaselineAssertions: `<MustNotExist><Value>src/example.ts</Value></MustNotExist>`,
    });

    const result = lintGraceProject(root, {});
    const baselineIssues = result.issues.filter((i) => i.code.startsWith("assertion."));
    expect(baselineIssues.map((i) => i.code)).toEqual(["assertion.MustNotExist"]);
    expect(baselineIssues.every((i) => i.severity === "error")).toBe(true);

    const report = formatTextReport(result);
    const firstLine = report.split("\n")[0]!;
    // Singular branch is only reachable when N is exactly 1 — pin wording and count together
    expect(firstLine).toContain("Baseline expectation: 1");
    expect(firstLine).toMatch(/expected while a C-\* change is in progress/i);
    expect(firstLine).not.toMatch(/expectations/i);
    const countMatch = firstLine.match(/Baseline expectation:\s*(\d+)/i);
    expect(countMatch).not.toBeNull();
    expect(Number(countMatch![1])).toBe(1);
    // Title is no longer first when N > 0
    expect(report.split("\n")[0]).not.toBe("neo-grace Lint Report");
    expect(report).toContain("neo-grace Lint Report");
  });

  it("plural baseline failures: lead line count matches multiple baseline-sourced issues", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-baseline-plural-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-BASE-PLURAL",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planBaselineAssertions:
        `<MustNotExist><Value>src/example.ts</Value></MustNotExist>`
        + `<MustNotExist><Value>M-EXAMPLE</Value></MustNotExist>`,
    });

    const result = lintGraceProject(root, {});
    const baselineCodes = result.issues.filter((i) => i.code.startsWith("assertion.")).map((i) => i.code);
    expect(baselineCodes).toEqual(["assertion.MustNotExist", "assertion.MustNotExist"]);

    const report = formatTextReport(result);
    const firstLine = report.split("\n")[0]!;
    expect(firstLine).toContain("Baseline expectations: 2");
    expect(firstLine).toMatch(/expected while a C-\* change is in progress/i);
    const countMatch = firstLine.match(/Baseline expectations:\s*(\d+)/i);
    expect(countMatch).not.toBeNull();
    expect(Number(countMatch![1])).toBe(2);
  });

  it("N === 0: report leads with the title and emits no baseline line", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-baseline-n0-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    // No active approved plan with failing baselines — empty changes
    const result = lintGraceProject(root, {});
    const report = formatTextReport(result);
    expect(report.startsWith("neo-grace Lint Report\n")).toBe(true);
    expect(report.split("\n")[0]).toBe("neo-grace Lint Report");
    expect(report).not.toMatch(/^Baseline expectation/im);
  });

  it("TargetAssertions-only extraction issue does not inflate N or produce a lead line alone", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-target-extract-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-TGT-EXTRACT",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      // Passing baseline (M-EXAMPLE exists)
      planBaselineAssertions: `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      // Malformed TargetAssertions → assertion.invalid-shape under TargetAssertions call site
      planTargetAssertions: `<MustExist></MustExist>`,
    });

    const result = lintGraceProject(root, {});
    const extractionIssues = result.issues.filter((i) => i.code === "assertion.invalid-shape");
    expect(extractionIssues.length).toBeGreaterThanOrEqual(1);

    const report = formatTextReport(result);
    // No baseline-sourced failures → no lead line from TargetAssertions extraction alone
    expect(report.split("\n")[0]).toBe("neo-grace Lint Report");
    expect(report).not.toMatch(/^Baseline expectation/im);
  });

  it("archived plan baselines stay syntax-only and contribute 0 to N", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-arch-baseline-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-ARCH-BASE",
      location: "archive",
      specStatus: "approved",
      planStatus: "applied",
      // Would fail if evaluated semantically (file exists)
      planBaselineAssertions: `<MustNotExist><Value>src/example.ts</Value></MustNotExist>`,
    });

    const result = lintGraceProject(root, {});
    // Archived: no semantic MustNotExist evaluation
    expect(result.issues.filter((i) => i.code === "assertion.MustNotExist")).toHaveLength(0);

    const report = formatTextReport(result);
    expect(report.split("\n")[0]).toBe("neo-grace Lint Report");
    expect(report).not.toMatch(/^Baseline expectation/im);
  });

  it("malformed BaselineAssertions: N includes extraction issues from that call (design ruling)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-base-malformed-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-BASE-MALFORM",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      // Malformed only — extraction issues only, no semantic assertions
      planBaselineAssertions: `<MustExist></MustExist>`,
    });

    const result = lintGraceProject(root, {});
    // Whole-call delta includes extraction issues (design ruling): empty-section + invalid-shape
    const assertionCodes = result.issues
      .filter((i) => i.code.startsWith("assertion."))
      .map((i) => i.code)
      .sort();
    expect(assertionCodes).toEqual(["assertion.empty-section", "assertion.invalid-shape"]);

    const report = formatTextReport(result);
    const firstLine = report.split("\n")[0]!;
    expect(firstLine).toContain("Baseline expectations: 2");
    const countMatch = firstLine.match(/Baseline expectations:\s*(\d+)/i);
    expect(countMatch).not.toBeNull();
    expect(Number(countMatch![1])).toBe(2);
  });

  it("--format json / JSON.stringify result gains no new top-level key (D13)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-json-shape-"));
    tempRoots.push(root);
    writeMinimalNgraceProject(root);
    writeChangeBundleFixture(root, {
      changeId: "C-JSON-SHAPE",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      planBaselineAssertions: `<MustNotExist><Value>src/example.ts</Value></MustNotExist>`,
    });

    const result = lintGraceProject(root, {});
    // Derive key set from this fixture run (JSON.stringify drops undefined changeId)
    const keys = jsonTopLevelKeys(result);
    const expectedKeys = [
      "analysisCoverage",
      "assertionMode",
      "commandsEnabled",
      "filesChecked",
      "generatedAt",
      "governedFiles",
      "issues",
      "profile",
      "root",
      "schemaVersion",
      "summary",
      "tool",
      "xmlFilesChecked",
    ].sort();
    expect(keys).toEqual(expectedKeys);
    // Explicitly no cast-property leak
    expect(keys).not.toContain("baselineExpectationCount");
    expect(keys).not.toContain("baselineFramingCount");
  });
});
