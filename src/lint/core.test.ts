import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeChangeBundleFixture, writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { lintGraceProject } from "./core";
import { isGateIssueCode } from "../gates/catalog";
import { advanceCursor } from "../grace-cursor";

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
