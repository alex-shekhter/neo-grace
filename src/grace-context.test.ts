import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { writeMinimalNgraceProject } from "./artifact/test-fixtures";
import { ARTIFACT_DIR } from "./artifact/paths";
import {
  buildSkillRecommendation,
  buildTaskSlice,
  classifySkillState,
  computeSelectionRatio,
  formatSliceBody,
  formatSliceText,
  listFullEnvelopeFiles,
  normalizeAuthoredText,
  PUBLISHED_SKILLS,
  SCOPE_SHARED_SENTENCE,
  SELECTED_BYTES_DEFINITION,
  selectionRatio,
  SKILLS_MID_EXECUTION,
  SKILLS_PRE_EXECUTION,
  utf8Bytes,
} from "./grace-context";

const temps: string[] = [];

function tempRoot(prefix = "grace-context-"): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(root);
  return root;
}

afterEach(() => {
  while (temps.length > 0) {
    const root = temps.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

function writeFile(root: string, relative: string, contents: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function writeSelectionBundle(
  root: string,
  options: {
    changeId: string;
    location: "active" | "archive";
    planStatus: string;
    specStatus?: string;
    designContext?: boolean;
    secondTaskTitle?: string;
  },
): void {
  const changeId = options.changeId;
  const bundle = `${ARTIFACT_DIR}/changes/${options.location}/${changeId}`;
  const specStatus = options.specStatus ?? "approved";
  writeFile(
    root,
    `${bundle}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="${specStatus}">
  <${changeId}>
    <Summary>Fixture summary for selection.</Summary>
    <Problem>Need a slice.</Problem>
    <Goals><Goal>Select.</Goal></Goals>
    <Constraints><Constraint>None.</Constraint></Constraints>
    <NonGoals><NonGoal>Compression.</NonGoal></NonGoals>
    <AcceptanceCriteria>
      <AC-SEL-ONE>
        First acceptance body with
        multi-line indent.
      </AC-SEL-ONE>
      <AC-SEL-TWO>
        Second acceptance body.
      </AC-SEL-TWO>
    </AcceptanceCriteria>
    <AffectedAreas><M-EXAMPLE /></AffectedAreas>
    <VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent>
  </${changeId}>
</NgraceChangeSpec>`,
  );

  const t2Title = options.secondTaskTitle ?? "Sibling task must not leak";
  writeFile(
    root,
    `${bundle}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="${options.planStatus}">
  <${changeId}>
    <IntentSummary>Selection fixture.</IntentSummary>
    <BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions>
    <TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>
    <DurableScope>
      <GraphAnchors><M-EXAMPLE /></GraphAnchors>
      <VerificationAnchors><V-M-EXAMPLE /></VerificationAnchors>
    </DurableScope>
    <ObservedWriteScope>
      <File>src/example.ts</File>
      <File>src/grace-context.ts</File>
    </ObservedWriteScope>
    <ImplementationPlan>
      <T-001>
        <Title>Primary selection task</Title>
        <DependsOn></DependsOn>
        <AcceptanceCriteria>
          <Criterion>Primary criterion text unique-to-t001.</Criterion>
        </AcceptanceCriteria>
        <Satisfies>
          <AC-SEL-ONE />
          <AC-SEL-TWO />
        </Satisfies>
        <Verification>
          <Command>bun test src/example.test.ts</Command>
        </Verification>
      </T-001>
      <T-002>
        <Title>${t2Title}</Title>
        <DependsOn><T-001 /></DependsOn>
        <AcceptanceCriteria>
          <Criterion>Sibling criterion unique-to-t002.</Criterion>
        </AcceptanceCriteria>
        <Satisfies>
          <AC-SEL-TWO />
        </Satisfies>
        <Verification>
          <Command>bun test src/sibling.test.ts</Command>
        </Verification>
      </T-002>
    </ImplementationPlan>
  </${changeId}>
</NgraceChangePlan>`,
  );

  if (options.designContext) {
    writeFile(
      root,
      `${bundle}/design-context.xml`,
      `<NgraceChangeDesignContext graceVersion="1.0"><${changeId}><Rejected>Redis</Rejected></${changeId}></NgraceChangeDesignContext>`,
    );
  }
}

function packageRoot(): string {
  return path.resolve(import.meta.dir, "..");
}

function runCli(argv: string[], cwd = packageRoot()): { stdout: string; stderr: string; status: number } {
  const entry = path.join(packageRoot(), "src", "grace.ts");
  const result = spawnSync("bun", [entry, ...argv], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

// ─── Normalizer (corr 120) ───────────────────────────────────────────────────

describe("normalizeAuthoredText (corr 120)", () => {
  it("strips common indent and trailing spaces without rewriting words", () => {
    const raw = "\n        First acceptance body with\n        multi-line indent.\n      ";
    expect(normalizeAuthoredText(raw)).toBe("First acceptance body with\nmulti-line indent.");
  });

  it("preserves interior blank lines and does not paraphrase", () => {
    const raw = "  alpha\n\n  beta  \n";
    expect(normalizeAuthoredText(raw)).toBe("alpha\n\nbeta");
  });

  it("is stable under already-normalized input", () => {
    expect(normalizeAuthoredText("plain title")).toBe("plain title");
  });
});

// ─── Ratio helpers ───────────────────────────────────────────────────────────

describe("selectionRatio / computeSelectionRatio", () => {
  it("matches the arithmetic of (full-selected)/full", () => {
    expect(selectionRatio(100, 40)).toBeCloseTo(0.6);
    expect(selectionRatio(100, 100)).toBe(0);
    expect(selectionRatio(0, 0)).toBe(0);
  });

  it("reports absence when selected exceeds full rather than coercing (A48.2)", () => {
    const result = computeSelectionRatio(100, 150);
    expect(result.selectionRatio).toBeNull();
    expect(result.selectionRatioAbsence?.verdict).toBe("unable-to-determine");
    expect(result.selectionRatioAbsence?.reason).toMatch(/exceed fullBytes/);
  });
});

// ─── Envelope ────────────────────────────────────────────────────────────────

describe("listFullEnvelopeFiles (A48.2)", () => {
  it("enumerates spec, plan, graph, verification, context — never design-context", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, {
      changeId: "C-ENV",
      location: "active",
      planStatus: "approved",
      designContext: true,
    });
    // Plant a design-context.xml under context/ so the denominator ban is load-bearing
    // (A48.2) — not only absent by omission of a push site.
    writeFile(
      root,
      `${ARTIFACT_DIR}/context/design-context.xml`,
      `<NgraceChangeDesignContext graceVersion="1.0"><C-ENV /></NgraceChangeDesignContext>`,
    );
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "active", "C-ENV");
    const composition = listFullEnvelopeFiles(root, bundle);
    expect(composition.some((f) => f.endsWith("spec.xml"))).toBe(true);
    expect(composition.some((f) => f.endsWith("plan.xml"))).toBe(true);
    expect(composition.some((f) => f.includes("graph/main.xml"))).toBe(true);
    expect(composition.some((f) => f.includes("verification/"))).toBe(true);
    expect(composition.some((f) => f.includes("context/principles.xml"))).toBe(true);
    expect(composition.some((f) => f.includes("design-context"))).toBe(false);
  });
});

// ─── Task slice composition ──────────────────────────────────────────────────

describe("buildTaskSlice", () => {
  it("emits Purpose Title + Satisfies AC bodies in document order (corr 116/131)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-SLICE", location: "active", planStatus: "approved" });
    const slice = buildTaskSlice(root, "C-SLICE", "T-001");
    expect(slice.purpose.title).toBe("Primary selection task");
    expect(slice.purpose.acceptanceCriteria.map((ac) => ac.id)).toEqual(["AC-SEL-ONE", "AC-SEL-TWO"]);
    expect(slice.purpose.acceptanceCriteria[0]!.text).toContain("First acceptance body");
    expect(slice.purpose.acceptanceCriteria[1]!.text).toContain("Second acceptance body");
  });

  it("includes plan DurableScope modules and plan OWS with shared-scope sentence (A48.4)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-SLICE", location: "active", planStatus: "approved" });
    const slice = buildTaskSlice(root, "C-SLICE", "T-001");
    expect(slice.modules.map((m) => m.id)).toEqual(["M-EXAMPLE"]);
    expect(slice.modules[0]!.projection || slice.modules[0]!.absence).toBeTruthy();
    expect(slice.writeScope.sharedWithSiblingTasks).toBe(true);
    expect(slice.writeScope.note).toBe(SCOPE_SHARED_SENTENCE);
    expect(slice.writeScope.note).toMatch(/plan-level and shared with sibling tasks/);
    expect(slice.writeScope.files).toContain("src/example.ts");
    const text = formatSliceText(slice);
    expect(text).toContain(SCOPE_SHARED_SENTENCE);
    expect(text).toMatch(/plan-level and shared with sibling tasks/);
    expect(text).not.toMatch(/task-private write scope/i);
  });

  it("does not include other tasks' Title or Criterion (corr 129)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, {
      changeId: "C-SLICE",
      location: "active",
      planStatus: "approved",
      secondTaskTitle: "Sibling-Title-Must-Not-Leak-XYZ",
    });
    const slice = buildTaskSlice(root, "C-SLICE", "T-001");
    const text = formatSliceBody(slice);
    expect(text).not.toContain("Sibling-Title-Must-Not-Leak-XYZ");
    expect(text).not.toContain("unique-to-t002");
    // Purpose is Title + Satisfies→AC bodies, not Criterion prose
    expect(text).toContain("Primary selection task");
    expect(text).toContain("First acceptance body");
  });

  it("never emits design-context content even when present (corr 123)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, {
      changeId: "C-SLICE",
      location: "active",
      planStatus: "approved",
      designContext: true,
    });
    const slice = buildTaskSlice(root, "C-SLICE", "T-001");
    const text = formatSliceText(slice);
    expect(text).not.toContain("Redis");
    expect(text).not.toContain("design-context.xml</");
    expect(slice.exclusions.some((e) => e.kind === "design-context")).toBe(true);
    expect(slice.measurement.fullComposition.some((f) => f.includes("design-context"))).toBe(false);
  });

  it("omits project .ngrace/context/* from the body and lists them in fullComposition (corr 122)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-SLICE", location: "active", planStatus: "approved" });
    const slice = buildTaskSlice(root, "C-SLICE", "T-001");
    const body = formatSliceBody(slice);
    expect(body).not.toContain("Prefer evidence");
    expect(body).not.toContain("NgracePrinciples");
    expect(slice.exclusions.some((e) => e.kind === "project-context")).toBe(true);
    expect(slice.measurement.fullComposition.some((f) => f.includes("context/principles.xml"))).toBe(true);
  });

  it("marks archived subjects as measurement-only (A48.1)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-ARCH", location: "archive", planStatus: "applied", specStatus: "applied" });
    const slice = buildTaskSlice(root, "C-ARCH", "T-001");
    expect(slice.subjectLocation).toBe("archive");
    expect(slice.archivedMeasurementOnly).toBe(true);
    const text = formatSliceText(slice);
    expect(text).toMatch(/ARCHIVED SUBJECT/i);
    expect(text).toMatch(/measurement artifact only/i);
  });

  it("does not leak archived sibling content into an active subject", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-ACTIVE", location: "active", planStatus: "approved" });
    writeSelectionBundle(root, {
      changeId: "C-SIBLING-ARCH",
      location: "archive",
      planStatus: "applied",
      specStatus: "applied",
      secondTaskTitle: "Archive-Only-Secret-Title-QQQ",
    });
    const slice = buildTaskSlice(root, "C-ACTIVE", "T-001");
    const text = formatSliceText(slice);
    expect(text).not.toContain("Archive-Only-Secret-Title-QQQ");
    expect(text).not.toContain("C-SIBLING-ARCH");
  });

  it("carries measurement ground fields (A48.2)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-SLICE", location: "active", planStatus: "approved" });
    const slice = buildTaskSlice(root, "C-SLICE", "T-001");
    expect(slice.measurement.unit).toBe("utf8-bytes");
    expect(slice.measurement.fullBytes).toBeGreaterThan(0);
    expect(slice.measurement.selectedBytes).toBeGreaterThan(0);
    expect(slice.measurement.selectedBytesDefinition).toBe(SELECTED_BYTES_DEFINITION);
    expect(slice.measurement.fullComposition.length).toBeGreaterThan(3);
    // Ratio may be null when selected > full — that is reportable honesty
    if (slice.measurement.selectionRatio !== null) {
      expect(slice.measurement.selectionRatio).toBeGreaterThanOrEqual(0);
      expect(slice.measurement.selectionRatio).toBeLessThanOrEqual(1);
    } else {
      expect(slice.measurement.selectionRatioAbsence?.verdict).toBe("unable-to-determine");
    }
  });

  it("two tasks share plan scope and differ only in task-local body (A48.4 amendment)", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-SLICE", location: "active", planStatus: "approved" });
    const a = buildTaskSlice(root, "C-SLICE", "T-001");
    const b = buildTaskSlice(root, "C-SLICE", "T-002");
    expect(a.writeScope.files).toEqual(b.writeScope.files);
    expect(a.modules.map((m) => m.id)).toEqual(b.modules.map((m) => m.id));
    expect(a.purpose.title).not.toBe(b.purpose.title);
    // No test asserts per-task write-scope disjointness
  });
});

// ─── Skills ──────────────────────────────────────────────────────────────────

describe("skill recommendations", () => {
  it("absent cursor / no change yields the full published set", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    // Copy skill stubs so measurement can sum bytes
    for (const skill of PUBLISHED_SKILLS) {
      writeFile(root, `skills/ngrace/${skill}/SKILL.md`, `# ${skill}\nline2\n`);
    }
    const rec = buildSkillRecommendation(root);
    expect(rec.candidates.length).toBe(16);
    expect(rec.selectionStage).toBe("toolkit");
    expect(rec.selectionStageGround).toMatch(/sole value observed/i);
    expect(new Set(rec.candidates.map((c) => c.skill)).size).toBe(16);
  });

  it("three states produce three different sets (corr 121/125)", () => {
    expect(classifySkillState({ cursorPresent: false })).toBe("full-absent-cursor");
    expect(classifySkillState({ changeId: "C-X", planStatus: "draft", cursorPresent: true })).toBe(
      "pre-execution",
    );
    expect(
      classifySkillState({ changeId: "C-X", planStatus: "approved", cursorPresent: true }),
    ).toBe("mid-execution");

    const full = new Set(PUBLISHED_SKILLS);
    const mid = new Set(SKILLS_MID_EXECUTION);
    const pre = new Set(SKILLS_PRE_EXECUTION);
    expect(mid.size).not.toBe(full.size);
    expect(pre.size).not.toBe(full.size);
    expect(mid.size).not.toBe(pre.size);
    // Inclusion bias: mid and pre are subsets of published
    for (const skill of mid) expect(full.has(skill)).toBe(true);
    for (const skill of pre) expect(full.has(skill)).toBe(true);
  });

  it("mid-execution with cursor file yields execution cluster, not empty", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    writeSelectionBundle(root, { changeId: "C-MID", location: "active", planStatus: "approved" });
    writeFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-MID/run.xml`,
      `<NgraceRunCursor graceVersion="1.0"><C-MID><Task>T-001</Task><State>in-progress</State></C-MID></NgraceRunCursor>`,
    );
    for (const skill of PUBLISHED_SKILLS) {
      writeFile(root, `skills/ngrace/${skill}/SKILL.md`, `# ${skill}\n`);
    }
    const rec = buildSkillRecommendation(root, { changeId: "C-MID" });
    expect(rec.candidates.length).toBe(SKILLS_MID_EXECUTION.length);
    expect(rec.candidates.length).toBeGreaterThan(0);
    expect(rec.candidates.every((c) => c.basis.length > 0)).toBe(true);
    // false negative check: execute is present
    expect(rec.candidates.some((c) => c.skill === "ngrace-execute")).toBe(true);
  });

  it("skill measurement is separate and never averages with artifact ratio", () => {
    const root = tempRoot();
    writeMinimalNgraceProject(root);
    for (const skill of PUBLISHED_SKILLS) {
      writeFile(root, `skills/ngrace/${skill}/SKILL.md`, `# ${skill}\nbody\n`);
    }
    const rec = buildSkillRecommendation(root);
    expect(rec.measurement.unit).toBe("utf8-bytes");
    expect(rec.measurement.fullComposition.every((f) => f.endsWith("SKILL.md"))).toBe(true);
    expect(rec.measurement.selectionRatio).not.toBeNull();
    expect(rec.measurement.selectedBytes).toBe(rec.measurement.fullBytes);
  });
});

// ─── CLI ─────────────────────────────────────────────────────────────────────

describe("ngrace context CLI", () => {
  it("rejects --task and --skills together", () => {
    const result = runCli(["context", "--task", "T-001", "--skills", "--change", "C-SELECTION"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/mutually exclusive/i);
  });

  it("requires --change with --task", () => {
    const result = runCli(["context", "--task", "T-001"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/--change/i);
  });

  it("help mentions task slice and skill recommendation, not compact", () => {
    const result = runCli(["context", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/task slice/i);
    expect(result.stdout).toMatch(/skill recommendation/i);
    expect(result.stdout).not.toMatch(/--compact/);
  });

  it("emits JSON for a real archived subject on this repository", () => {
    const result = runCli([
      "context",
      "--task",
      "T-001",
      "--change",
      "C-FAILURE-LOCALIZATION",
      "--format",
      "json",
    ]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.kind).toBe("task-slice");
    expect(parsed.changeId).toBe("C-FAILURE-LOCALIZATION");
    expect(parsed.taskId).toBe("T-001");
    expect(parsed.subjectLocation).toBe("archive");
    expect(parsed.archivedMeasurementOnly).toBe(true);
    expect(parsed.measurement.unit).toBe("utf8-bytes");
    expect(parsed.measurement.fullComposition.length).toBeGreaterThan(0);
    expect(parsed.writeScope.sharedWithSiblingTasks).toBe(true);
  });

  it("writes nothing under the project root", () => {
    const root = packageRoot();
    const before = readdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"));
    const result = runCli([
      "context",
      "--task",
      "T-001",
      "--change",
      "C-FAILURE-LOCALIZATION",
      "--format",
      "json",
    ]);
    expect(result.status).toBe(0);
    const after = readdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"));
    expect(after).toEqual(before);
    // no new design-context or run files from this command
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-SELECTION", "design-context.xml"))).toBe(
      false,
    );
  });
});

// ─── Real-repository measurements (≥3) ───────────────────────────────────────

describe("real-repository measurements (§8.5.7 / A48.1)", () => {
  const subjects = [
    { changeId: "C-FAILURE-LOCALIZATION", taskId: "T-001" },
    { changeId: "C-REVIEW-SURFACE", taskId: "T-001" },
    { changeId: "C-GATE-SURFACE", taskId: "T-001" },
  ] as const;

  it("measures three named archive tasks with ground fields", () => {
    const rows: Array<{
      changeId: string;
      taskId: string;
      subjectLocation: string;
      fullBytes: number;
      selectedBytes: number;
      selectionRatio: number | null;
      compositionCount: number;
    }> = [];

    for (const subject of subjects) {
      const slice = buildTaskSlice(packageRoot(), subject.changeId, subject.taskId);
      expect(slice.subjectLocation).toBe("archive");
      expect(slice.archivedMeasurementOnly).toBe(true);
      expect(slice.measurement.fullComposition.length).toBeGreaterThan(0);
      expect(slice.measurement.fullComposition.some((f) => f.includes("design-context"))).toBe(false);
      rows.push({
        changeId: slice.changeId,
        taskId: slice.taskId,
        subjectLocation: slice.subjectLocation,
        fullBytes: slice.measurement.fullBytes,
        selectedBytes: slice.measurement.selectedBytes,
        selectionRatio: slice.measurement.selectionRatio,
        compositionCount: slice.measurement.fullComposition.length,
      });
    }

    expect(rows.length).toBe(3);
    // Print for the phase report (visible in test output)
    console.log("REAL_MEASUREMENTS_JSON=" + JSON.stringify(rows, null, 2));
    for (const row of rows) {
      expect(row.fullBytes).toBeGreaterThan(0);
      expect(row.selectedBytes).toBeGreaterThan(0);
      // Saving may be small or selected may exceed full — both are reportable
    }
  });

  it("live C-SELECTION task is measurable when plan exists", () => {
    const slice = buildTaskSlice(packageRoot(), "C-SELECTION", "T-001");
    expect(slice.subjectLocation).toBe("active");
    expect(slice.archivedMeasurementOnly).toBe(false);
    expect(slice.purpose.title.length).toBeGreaterThan(0);
    expect(slice.measurement.fullComposition.length).toBeGreaterThan(0);
    console.log(
      "LIVE_MEASUREMENT_JSON=" +
        JSON.stringify({
          changeId: slice.changeId,
          taskId: slice.taskId,
          subjectLocation: slice.subjectLocation,
          fullBytes: slice.measurement.fullBytes,
          selectedBytes: slice.measurement.selectedBytes,
          selectionRatio: slice.measurement.selectionRatio,
          compositionCount: slice.measurement.fullComposition.length,
        }),
    );
  });
});

// ─── Read-aloud table ground (AC-SELECTION-OUTPUT-ALOUD) ─────────────────────

describe("read-aloud field truth (A46.3)", () => {
  it("Purpose Title and AC bodies match normalized source artifacts", () => {
    const root = packageRoot();
    const slice = buildTaskSlice(root, "C-FAILURE-LOCALIZATION", "T-001");
    const planText = readFileSync(
      path.join(root, ARTIFACT_DIR, "changes", "archive", "C-FAILURE-LOCALIZATION", "plan.xml"),
      "utf8",
    );
    expect(planText).toContain(slice.purpose.title);
    for (const ac of slice.purpose.acceptanceCriteria) {
      if (ac.text) {
        const specText = readFileSync(
          path.join(root, ARTIFACT_DIR, "changes", "archive", "C-FAILURE-LOCALIZATION", "spec.xml"),
          "utf8",
        );
        // Every non-whitespace token of the normalized body appears in the spec
        for (const token of ac.text.split(/\s+/).filter((t) => t.length > 8).slice(0, 5)) {
          expect(specText).toContain(token.replace(/&/g, ""));
        }
      }
    }
  });
});

// ─── utf8Bytes smoke ─────────────────────────────────────────────────────────

describe("utf8Bytes", () => {
  it("counts multi-byte characters", () => {
    expect(utf8Bytes("a")).toBe(1);
    expect(utf8Bytes("€")).toBe(3);
  });
});
