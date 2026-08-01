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
