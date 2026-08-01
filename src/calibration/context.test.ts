import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";
import {
  AUTHORED_CONTEXT_ATTRIBUTE_NAMES,
  deriveCalibrationContext,
  type ContextDerivationEvent,
} from "./context";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-ctx-"));
  roots.push(root);
  return root;
}

function write(root: string, rel: string, contents: string): void {
  const filePath = path.join(root, rel);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function planWithTask(
  root: string,
  changeId: string,
  options: { satisfies?: boolean } = {},
): void {
  const satisfies = options.satisfies
    ? `<Satisfies><AC-ONE /></Satisfies>`
    : `<Satisfies></Satisfies>`;
  write(
    root,
    `${ARTIFACT_DIR}/changes/active/${changeId}/plan.xml`,
    `<NgraceChangePlan graceVersion="1.0" status="approved"><${changeId}>` +
      `<IntentSummary>Ctx.</IntentSummary>` +
      `<BaselineAssertions><MustExist><Value>src/example.ts</Value></MustExist></BaselineAssertions>` +
      `<TargetAssertions><MustExist><Value>src/example.ts</Value></MustExist></TargetAssertions>` +
      `<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>` +
      `<ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>` +
      `<ImplementationPlan><T-001><Title>Task</Title><DependsOn></DependsOn>${satisfies}` +
      `<AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria>` +
      `<Verification><Command>true</Command></Verification></T-001></ImplementationPlan>` +
      `</${changeId}></NgraceChangePlan>`,
  );
}

function claimEvent(
  files: Array<{ path: string }>,
  options: { available?: boolean; task?: string } = {},
): ContextDerivationEvent {
  const available = options.available !== false;
  return {
    id: 2,
    task: options.task ?? "T-001",
    kind: "attempt",
    attributes: { outcome: "pass", claimedConfidence: "medium" },
    children: [
      {
        tag: "WriteEvidence",
        attributes: { available: available ? "true" : "false" },
        children: files.map((f) => ({
          tag: "File",
          attributes: { digest: "abc" },
          children: [],
          text: f.path,
        })),
        text: "",
      },
    ],
  };
}

describe("deriveCalibrationContext (A63 / §9.5.3)", () => {
  it("taskKind: satisfies-ac when plan task Satisfies AC-*", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.taskKind).toBe("satisfies-ac");
  });

  it("taskKind: no-satisfies when plan task has empty Satisfies", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: false });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.taskKind).toBe("no-satisfies");
  });

  it("adapterPresence: present for adapter-backed code writes", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.adapterPresence).toBe("present");
  });

  it("adapterPresence: absent when only non-adapter / artifact paths written", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [
        claimEvent([
          { path: ".ngrace/changes/active/C-CTX/plan.xml" },
          { path: "notes.md" },
        ]),
      ],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.adapterPresence).toBe("absent");
  });

  it("wroteVsRead: wrote when write evidence has files", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.wroteVsRead).toBe("wrote");
  });

  it("wroteVsRead: read-only when write evidence available with zero files", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.wroteVsRead).toBe("read-only");
  });

  it("sequentialVsParallel: sequential for one worker", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.sequentialVsParallel).toBe("sequential");
  });

  it("sequentialVsParallel: parallel for two workers", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [
        { worker: "w0", from: 1, to: 50 },
        { worker: "w1", from: 51, to: 99 },
      ],
    });
    expect(ctx.sequentialVsParallel).toBe("parallel");
  });

  it("authored context attribute names are enumerated for rejection", () => {
    expect(AUTHORED_CONTEXT_ATTRIBUTE_NAMES).toContain("contextClass");
    expect(AUTHORED_CONTEXT_ATTRIBUTE_NAMES).toContain("taskKind");
    expect(AUTHORED_CONTEXT_ATTRIBUTE_NAMES).toContain("adapterPresence");
    expect(AUTHORED_CONTEXT_ATTRIBUTE_NAMES).toContain("wroteVsRead");
    expect(AUTHORED_CONTEXT_ATTRIBUTE_NAMES).toContain("sequentialVsParallel");
  });

  it("contextClass key joins the four dimensions", () => {
    const root = createRoot();
    planWithTask(root, "C-CTX", { satisfies: true });
    const ctx = deriveCalibrationContext({
      projectRoot: root,
      changeId: "C-CTX",
      events: [],
      claimEvents: [claimEvent([{ path: "src/example.ts" }])],
      allocations: [{ worker: "w0", from: 1, to: 99 }],
    });
    expect(ctx.key).toBe(
      "satisfies-ac|present|wrote|sequential",
    );
  });
});
