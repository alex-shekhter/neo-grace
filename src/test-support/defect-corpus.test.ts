import { describe, expect, it } from "bun:test";

import { lintGraceProject } from "../lint/core";
import {
  PATTERNS,
  byPattern,
  corpus,
  type PatternId,
} from "./defect-corpus";
import { snapshotProjectTree } from "./fixtures";

describe("defect-corpus (D4)", () => {
  it("every id is unique", () => {
    const ids = corpus().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every pattern has at least two entries", () => {
    for (const pattern of PATTERNS) {
      expect(byPattern(pattern as PatternId).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("corpus has at least ten entries", () => {
    expect(corpus().length).toBeGreaterThanOrEqual(10);
  });

  it("every build() produces a project that lints clean before apply()", () => {
    for (const entry of corpus()) {
      const root = entry.build();
      const result = lintGraceProject(root);
      expect(result.summary.errors, `${entry.id} baseline errors`).toBe(0);
    }
  });

  it("every entry has a rationale and at least one expected finding", () => {
    for (const entry of corpus()) {
      expect(entry.rationale.length).toBeGreaterThan(10);
      expect(entry.expected.length).toBeGreaterThan(0);
      for (const finding of entry.expected) {
        expect(finding.code.length).toBeGreaterThan(0);
        expect(finding.file.length).toBeGreaterThan(0);
        expect(typeof finding.mustFire).toBe("boolean");
      }
    }
  });

  it("every expected finding declares a surface, with reachability fields when required", () => {
    const surfaces = new Set(["lint", "health", "gate", "review"]);
    for (const entry of corpus()) {
      for (const finding of entry.expected) {
        expect(surfaces.has(finding.surface), `${entry.id} ${finding.code} surface`).toBe(true);
        if (finding.surface === "lint") {
          expect(
            finding.lintMode === "current" || finding.lintMode === "target" || finding.lintMode === "final",
            `${entry.id} ${finding.code} lintMode`,
          ).toBe(true);
          if (finding.lintMode === "target" || finding.lintMode === "final") {
            expect(
              typeof finding.changeId === "string" && finding.changeId.length > 0,
              `${entry.id} ${finding.code} changeId required for lintMode ${finding.lintMode}`,
            ).toBe(true);
          }
        }
        if (finding.surface === "health") {
          expect(
            typeof finding.moduleId === "string" && finding.moduleId.length > 0,
            `${entry.id} ${finding.code} moduleId required for health surface`,
          ).toBe(true);
        }
      }
    }
  });

  it("apply() mutates the project tree", () => {
    for (const entry of corpus()) {
      const root = entry.build();
      const before = snapshotProjectTree(root);
      entry.apply(root);
      const after = snapshotProjectTree(root);
      expect(after, `${entry.id} apply() must change the project`).not.toEqual(before);
    }
  });
});
