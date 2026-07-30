import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "./artifact/paths";
import {
  absenceCountsByReason,
  collectDoctorReport,
  formatDoctorText,
  partitionAbsenceIssues,
  toDoctorAbsenceIssues,
} from "./grace-doctor";
import { withLintIssueGuide } from "./lint/catalog";
import type { LintIssue } from "./lint/types";

function createRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-doctor-"));
}

function writeFile(root: string, rel: string, contents: string) {
  const filePath = path.join(root, rel);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeMinimalProject(root: string) {
  writeFile(root, `${ARTIFACT_DIR}/context/requirements.xml`, `<NgraceRequirements graceVersion="1.0"><Summary>Required.</Summary></NgraceRequirements>`);
  writeFile(root, `${ARTIFACT_DIR}/context/technology.xml`, `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`);
  writeFile(root, `${ARTIFACT_DIR}/context/principles.xml`, `<NgracePrinciples graceVersion="1.0"><Principle>Safe.</Principle></NgracePrinciples>`);
  writeFile(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<NgraceDeployment graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>CLI.</Reason></NgraceDeployment>`);
  writeFile(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<NgraceUXGuidelines graceVersion="1.0"><Applicability>not-applicable</Applicability><Reason>CLI.</Reason></NgraceUXGuidelines>`);
  writeFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
  );
  writeFile(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary><Path>src/example.ts</Path></M-EXAMPLE></GD-MAIN></NgraceGraphDocument>`,
  );
  writeFile(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
  );
  writeFile(
    root,
    `${ARTIFACT_DIR}/verification/main.xml`,
    `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>echo ok</Command><Scenario>ok</Scenario><TraceAssertion>n/a</TraceAssertion></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
  );
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });
  writeFile(
    root,
    "src/example.ts",
    `// START_MODULE_CONTRACT
// PURPOSE: Example.
// SCOPE: Test.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// run - Run.
// END_MODULE_MAP
export function run() { return 1; }
`,
  );
}

function guided(code: string, file = "x.ts"): LintIssue {
  return withLintIssueGuide({
    severity: code.startsWith("analysis.") ? "warning" : "error",
    code,
    file,
    message: `msg for ${code}`,
  });
}

describe("partitionAbsenceIssues", () => {
  it("keeps all three absence codes and drops defects", () => {
    const issues = [
      guided("analysis.no-adapter"),
      guided("analysis.runtime-missing"),
      guided("assertion.command-not-evaluated"),
      guided("analysis.adapter-failed"),
      guided("analysis.heuristic-confidence"),
      guided("assertion.MustExist"),
      guided("markup.missing-module-contract"),
    ];
    const absences = partitionAbsenceIssues(issues);
    expect(absences.map((i) => i.code).sort()).toEqual([
      "analysis.no-adapter",
      "analysis.runtime-missing",
      "assertion.command-not-evaluated",
    ]);
    expect(absenceCountsByReason(issues)).toEqual({
      "analysis.no-adapter": 1,
      "analysis.runtime-missing": 1,
      "assertion.command-not-evaluated": 1,
    });
    // Discriminating negative for prefix-filter regression (A4.3 / §0.7.2):
    // analysis.adapter-failed and analysis.heuristic-confidence start with analysis.
    // but must not appear in doctor rows.
    const rows = toDoctorAbsenceIssues(issues);
    expect(rows.map((r) => r.code).sort()).toEqual([
      "analysis.no-adapter",
      "analysis.runtime-missing",
      "assertion.command-not-evaluated",
    ]);
    expect(rows.every((r) => r.issueClass === "absence")).toBe(true);
  });
});

describe("collectDoctorReport", () => {
  it("zero case: clean project reports no analysis/absence issues", () => {
    const root = createRoot();
    writeMinimalProject(root);
    const report = collectDoctorReport(root);
    expect(report.tool).toBe("grace-doctor");
    expect(report.analysisIssues).toEqual([]);
    expect(formatDoctorText(report)).toContain("Analysis issues\n  None.");
  });

  it("non-zero case: governed .ex file yields analysis.no-adapter with issueClass", () => {
    const root = createRoot();
    writeMinimalProject(root);
    writeFile(
      root,
      ".ngrace-lint.json",
      JSON.stringify({ codeExtensions: [".ex"] }),
    );
    writeFile(
      root,
      "src/widget.ex",
      `# START_MODULE_CONTRACT
# PURPOSE: Elixir-shaped fixture.
# SCOPE: Doctor non-zero absence.
# DEPENDS: none
# LINKS: M-EXAMPLE
# ROLE: RUNTIME
# MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
# run - Run.
# END_MODULE_MAP
def run, do: :ok
`,
    );
    const report = collectDoctorReport(root);
    expect(report.analysisIssues.length).toBeGreaterThan(0);
    expect(report.analysisIssues.every((i) => i.issueClass === "absence")).toBe(true);
    expect(report.analysisIssues.some((i) => i.code === "analysis.no-adapter")).toBe(true);
    expect(report.analysisIssues.some((i) => i.code === "assertion.command-not-evaluated")).toBe(false);
    const text = formatDoctorText(report);
    expect(text).toContain("analysis.no-adapter:");
    expect(report.analysisIssues[0]?.issueClass).toBe("absence");
  });

  const hasPython = ["python3", "python"].some((binary) => {
    const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
    return !result.error && result.status === 0;
  });

  // A7.3 §3: skipIf so missing python is not-run, not a green vacuous pass.
  it.skipIf(!hasPython)(
    "does not list analysis.heuristic-confidence (discriminates analysis. prefix filter)",
    () => {
      const root = createRoot();
      writeMinimalProject(root);
      writeFile(
        root,
        "src/example.py",
        `# START_MODULE_CONTRACT
# PURPOSE: Python fixture.
# SCOPE: Heuristic export analysis.
# DEPENDS: none
# LINKS: M-EXAMPLE
# ROLE: RUNTIME
# MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
# greet - Public greeting.
# END_MODULE_MAP
def greet():
    return "hello"
`,
      );
      const report = collectDoctorReport(root);
      const codes = report.analysisIssues.map((i) => i.code);
      // Prefix filter would include analysis.heuristic-confidence; issueClass filter must not.
      expect(codes).not.toContain("analysis.heuristic-confidence");
      expect(report.analysisIssues.every((i) => i.issueClass === "absence")).toBe(true);
    },
  );
});
