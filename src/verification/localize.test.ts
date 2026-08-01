import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeMinimalNgraceProject, writeSegmentedNgraceProject } from "../artifact/test-fixtures";
import { ARTIFACT_DIR } from "../artifact/paths";
import type { WriteEvidenceSnapshot } from "../grace-cursor";
import { loadGraceArtifactIndex } from "../query/core";
import type { ModuleRecord } from "../query/types";
import { allReviewCodes } from "../review/catalog";
import {
  ADMISSIBLE_REVIEW_CODES,
  excludedReviewCodesForLocalization,
  filterAdmissibleReviewFindings,
  firstDivergentBlock,
  formatLocalizationText,
  isAdmissibleLocalizationReviewCode,
  loadReviewJsonFindings,
  localizeFailure,
  parseObservedMarkers,
  projectMarkerAlphabet,
  resolveBlockLocations,
  resolveModuleForTestPath,
  splitObservedByEntry,
} from "./localize";

function stubModule(
  localFiles: ModuleRecord["localFiles"],
  id = "M-EXAMPLE",
): ModuleRecord {
  return {
    id,
    graph: {
      id,
      kind: "module",
      owner: "GD-MAIN",
      file: "graph/main.xml",
      text: "",
      links: [],
      depends: [],
      annotations: [],
      states: [],
    },
    verification: null,
    verifications: [],
    localFiles,
    plan: null,
    steps: [],
  };
}

const tempRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, rel: string, contents: string) {
  const filePath = path.join(root, rel);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

const M0 = "[A][m0][BLOCK_M0]";
const M1 = "[A][m1][BLOCK_M1]";
const M2 = "[A][m2][BLOCK_M2]";
const M3 = "[A][m3][BLOCK_M3]";
const FOREIGN = "[B][run][BLOCK_RUN]";

// ---------------------------------------------------------------------------
// firstDivergentBlock — seven axes (A40.2 / A42.6)
// ---------------------------------------------------------------------------

describe("firstDivergentBlock — seven axes (A40.2)", () => {
  it("axis: divergence at index 0", () => {
    const d = firstDivergentBlock([M0, M1], [M1, M0]);
    expect(d).toEqual({ index: 0, expected: M0, observed: M1 });
  });

  it("axis: divergence mid-sequence", () => {
    const d = firstDivergentBlock([M0, M1, M2], [M0, M2, M1]);
    expect(d).toEqual({ index: 1, expected: M1, observed: M2 });
  });

  it("axis: divergence at the end (last expected missing / wrong)", () => {
    const d = firstDivergentBlock([M0, M1, M2], [M0, M1, M3]);
    expect(d).toEqual({ index: 2, expected: M2, observed: M3 });
  });

  it("axis: observed shorter than expected", () => {
    const d = firstDivergentBlock([M0, M1, M2], [M0, M1]);
    expect(d).toEqual({ index: 2, expected: M2, observed: undefined });
  });

  it("axis: observed longer than expected", () => {
    const d = firstDivergentBlock([M0, M1], [M0, M1, M2]);
    expect(d).toEqual({ index: 2, expected: undefined, observed: M2 });
  });

  it("axis: repeated marker makes observed longer (production path to longer)", () => {
    // Comparator alone: hand-built longer array proves the comparator axis.
    const d = firstDivergentBlock([M0, M1], [M0, M1, M1]);
    expect(d).toEqual({ index: 2, expected: undefined, observed: M1 });
  });

  it("axis: identical sequences → null", () => {
    expect(firstDivergentBlock([M0, M1], [M0, M1])).toBeNull();
  });

  it("empty expected and empty observed → null", () => {
    expect(firstDivergentBlock([], [])).toBeNull();
  });

  it("empty expected, non-empty observed → index 0", () => {
    expect(firstDivergentBlock([], [M0])).toEqual({
      index: 0,
      expected: undefined,
      observed: M0,
    });
  });

  it("non-empty expected, empty observed → index 0", () => {
    expect(firstDivergentBlock([M0], [])).toEqual({
      index: 0,
      expected: M0,
      observed: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// parseObservedMarkers — every occurrence, log order (A42.6); parser cases
// ---------------------------------------------------------------------------

describe("parseObservedMarkers — every occurrence, log order (A42.6)", () => {
  const alphabet = [M0, M1, M2, FOREIGN];

  it("case: empty log → []", () => {
    expect(parseObservedMarkers("", alphabet)).toEqual([]);
  });

  it("case: log with no declared markers → []", () => {
    expect(parseObservedMarkers("Error: boom\n  at foo.ts:1\n  at bar.ts:2\n", alphabet)).toEqual([]);
  });

  it("case: foreign-only log still returns those markers (project-wide alphabet)", () => {
    const log = `start\n${FOREIGN}\nok\n`;
    expect(parseObservedMarkers(log, alphabet)).toEqual([FOREIGN]);
  });

  it("case: interleaved markers keep log order", () => {
    const log = `${M0}\n${FOREIGN}\n${M1}\n`;
    expect(parseObservedMarkers(log, alphabet)).toEqual([M0, FOREIGN, M1]);
  });

  it("case: repeated marker keeps every occurrence (path to observed-longer)", () => {
    const log = `${M0}\n${M1}\n${M1}\n`;
    expect(parseObservedMarkers(log, [M0, M1])).toEqual([M0, M1, M1]);
    // End-to-end: parse → firstDivergentBlock yields observed longer.
    const d = firstDivergentBlock([M0, M1], parseObservedMarkers(log, [M0, M1]));
    expect(d).toEqual({ index: 2, expected: undefined, observed: M1 });
  });

  it("empty alphabet → [] even when log contains text", () => {
    expect(parseObservedMarkers(`${M0}\n`, [])).toEqual([]);
  });

  it("prefers longer marker when one is a prefix of another", () => {
    const short = "[X]";
    const long = "[X][Y]";
    const log = `prefix ${long} suffix`;
    expect(parseObservedMarkers(log, [short, long])).toEqual([long]);
  });
});

// ---------------------------------------------------------------------------
// splitObservedByEntry / foreign markers (A42.3)
// ---------------------------------------------------------------------------

describe("splitObservedByEntry — foreign markers (A42.3)", () => {
  it("foreign-only → empty observed + foreign list (not silence)", () => {
    const { observed, foreignMarkers } = splitObservedByEntry([FOREIGN, FOREIGN], [M0, M1]);
    expect(observed).toEqual([]);
    expect(foreignMarkers).toEqual([FOREIGN, FOREIGN]);
  });

  it("interleaved produces same own-sequence as foreign lines removed", () => {
    const interleaved = [M0, FOREIGN, M1, FOREIGN];
    const cleaned = [M0, M1];
    const a = splitObservedByEntry(interleaved, [M0, M1]);
    const b = splitObservedByEntry(cleaned, [M0, M1]);
    expect(a.observed).toEqual(b.observed);
    expect(a.foreignMarkers).toEqual([FOREIGN, FOREIGN]);
    // Same divergence answer.
    expect(firstDivergentBlock([M0, M1], a.observed)).toEqual(
      firstDivergentBlock([M0, M1], b.observed),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBlockLocations — A42.2 four-row table
// ---------------------------------------------------------------------------

describe("resolveBlockLocations — A42.2 both directions", () => {
  it("row: BLOCK_* + one file → path:startLine-endLine", () => {
    const module = stubModule([
      {
        path: "src/example.ts",
        moduleContract: null,
        moduleMap: [],
        changeSummary: null,
        contracts: [],
        blocks: [{ name: "RUN", startLine: 10, endLine: 20 }],
        linkedModuleIds: ["M-EXAMPLE"],
        dependsModuleIds: [],
        linkedVerificationIds: [],
      },
    ]);
    const result = resolveBlockLocations("[Example][run][BLOCK_RUN]", module);
    expect(result.locations).toEqual([{ path: "src/example.ts", startLine: 10, endLine: 20 }]);
    expect(result.locationAbsence).toBeUndefined();
  });

  it("row: no BLOCK_* suffix → location absent with reason", () => {
    const result = resolveBlockLocations("[Example][run]", undefined);
    expect(result.locations).toEqual([]);
    expect(result.locationAbsence?.verdict).toBe("unable-to-determine");
    expect(result.locationAbsence?.reason).toMatch(/no \[BLOCK_\*\] suffix/);
  });

  it("row: block name resolves in no file → location absent", () => {
    const module = stubModule([
      {
        path: "src/example.ts",
        moduleContract: null,
        moduleMap: [],
        changeSummary: null,
        contracts: [],
        blocks: [{ name: "OTHER", startLine: 1, endLine: 2 }],
        linkedModuleIds: ["M-EXAMPLE"],
        dependsModuleIds: [],
        linkedVerificationIds: [],
      },
    ]);
    const result = resolveBlockLocations("[Example][run][BLOCK_RUN]", module);
    expect(result.locations).toEqual([]);
    expect(result.locationAbsence?.reason).toMatch(/no linked runtime file exposes BLOCK_RUN/);
  });

  it("row: more than one file → report all, do not pick one", () => {
    const module = stubModule([
      {
        path: "src/a.ts",
        moduleContract: null,
        moduleMap: [],
        changeSummary: null,
        contracts: [],
        blocks: [{ name: "RUN", startLine: 1, endLine: 5 }],
        linkedModuleIds: ["M-EXAMPLE"],
        dependsModuleIds: [],
        linkedVerificationIds: [],
      },
      {
        path: "src/b.ts",
        moduleContract: null,
        moduleMap: [],
        changeSummary: null,
        contracts: [],
        blocks: [{ name: "RUN", startLine: 3, endLine: 9 }],
        linkedModuleIds: ["M-EXAMPLE"],
        dependsModuleIds: [],
        linkedVerificationIds: [],
      },
    ]);
    const result = resolveBlockLocations("[Example][run][BLOCK_RUN]", module);
    expect(result.locations).toHaveLength(2);
    expect(result.locations.map((l) => l.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

// ---------------------------------------------------------------------------
// Review admissibility — closed by name (A42.4), table-driven over catalog
// ---------------------------------------------------------------------------

describe("review admissibility — closed by name (A42.4 / A41.5)", () => {
  it("exactly three admissible codes, named by D8", () => {
    expect([...ADMISSIBLE_REVIEW_CODES].sort()).toEqual([
      "review.compat-new-error",
      "review.scope-outside-write-scope",
      "review.test-assertion-weakened",
    ]);
  });

  it("every REVIEW_CATALOG code is either admissible or excluded (exhaustive)", () => {
    const catalog = allReviewCodes();
    expect(catalog.length).toBe(13);
    for (const code of catalog) {
      const admitted = isAdmissibleLocalizationReviewCode(code);
      const excluded = excludedReviewCodesForLocalization().includes(code);
      expect(admitted !== excluded).toBe(true);
    }
    expect(excludedReviewCodesForLocalization()).toHaveLength(10);
  });

  it("filter keeps only the three; never invents a divergence index", () => {
    const findings = allReviewCodes().map((code) => ({
      code,
      findingId: `id-${code}`,
      message: "x",
    }));
    const kept = filterAdmissibleReviewFindings(findings);
    expect(kept.map((f) => f.code).sort()).toEqual([...ADMISSIBLE_REVIEW_CODES].sort());
    // Family A and hunk-uncovered and counterpart-* are gone.
    expect(kept.some((f) => f.code.startsWith("review.confidently"))).toBe(false);
    expect(kept.some((f) => f.code === "review.hunk-uncovered")).toBe(false);
    expect(kept.some((f) => f.code.includes("counterpart"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadReviewJsonFindings — producer path (A42.5)
// ---------------------------------------------------------------------------

describe("loadReviewJsonFindings — --review-json producer (A42.5)", () => {
  it("reads ngrace review --format json shape (with ok wrapper)", () => {
    const root = tempRoot("ngrace-revjson-");
    const file = path.join(root, "review.json");
    writeFileSync(
      file,
      JSON.stringify({
        ok: true,
        schemaVersion: "1.0.0",
        tool: "ngrace-review",
        findings: [
          {
            code: "review.scope-outside-write-scope",
            findingId: "f1",
            message: "out of scope",
            file: "src/x.ts",
            severity: "error",
          },
          {
            code: "review.confidently-wrong",
            findingId: "f2",
            message: "pattern",
          },
        ],
      }),
    );
    const loaded = loadReviewJsonFindings(file);
    expect(Array.isArray(loaded)).toBe(true);
    if (Array.isArray(loaded)) {
      expect(loaded).toHaveLength(2);
      const filtered = filterAdmissibleReviewFindings(loaded);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.code).toBe("review.scope-outside-write-scope");
    }
  });

  it("missing file → absence", () => {
    const result = loadReviewJsonFindings("/no/such/review.json");
    expect("absence" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flake consumption (corr 98)
// ---------------------------------------------------------------------------

describe("flake consumption — classifyFlakeFromEvidence, not rebuilt", () => {
  const evidence = (digest: string): WriteEvidenceSnapshot => ({
    available: true,
    files: [{ path: "src/a.ts", kind: "content", digest }],
  });

  it("flaky → divergence suppressed, no causal claim", () => {
    const root = tempRoot("ngrace-flake-");
    writeMinimalNgraceProject(root);
    write(
      root,
      "src/example.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-EXAMPLE",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Example][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
      ].join("\n"),
    );
    const index = loadGraceArtifactIndex(root);
    const verification = index.verifications[0]!;
    const module = index.modules.find((m) => m.id === verification.moduleId);
    const result = localizeFailure({
      index,
      verification,
      module,
      logText: "no markers here\n",
      flakePair: {
        earlier: { outcome: "fail", writeEvidence: evidence("abc") },
        later: { outcome: "pass", writeEvidence: evidence("abc") },
      },
    });
    expect(result.flake?.verdict).toBe("flaky");
    expect(result.divergenceSuppressed).toBe(true);
    expect(result.divergence).toBeNull();
    expect(result.locationAbsence?.reason).toMatch(/flaky/);
  });

  it("retry → divergence still reported when log shows it", () => {
    const root = tempRoot("ngrace-retry-");
    writeMinimalNgraceProject(root);
    write(
      root,
      "src/example.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-EXAMPLE",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Example][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
      ].join("\n"),
    );
    const index = loadGraceArtifactIndex(root);
    const verification = index.verifications[0]!;
    const result = localizeFailure({
      index,
      verification,
      module: index.modules[0],
      logText: "nothing\n",
      flakePair: {
        earlier: { outcome: "fail", writeEvidence: evidence("aaa") },
        later: { outcome: "pass", writeEvidence: evidence("bbb") },
      },
    });
    expect(result.flake?.verdict).toBe("retry");
    expect(result.divergenceSuppressed).toBeUndefined();
    expect(result.divergence?.index).toBe(0);
  });

  it("unable-to-determine flake → no flake claim about flakiness, divergence may remain", () => {
    const root = tempRoot("ngrace-flake-ud-");
    writeMinimalNgraceProject(root);
    const index = loadGraceArtifactIndex(root);
    const verification = index.verifications[0]!;
    const result = localizeFailure({
      index,
      verification,
      module: index.modules[0],
      logText: "nothing\n",
      flakePair: {
        earlier: {
          outcome: "fail",
          writeEvidence: { available: false, absence: { verdict: "unable-to-determine", reason: "git unavailable" } },
        },
        later: {
          outcome: "pass",
          writeEvidence: { available: false, absence: { verdict: "unable-to-determine", reason: "git unavailable" } },
        },
      },
    });
    expect(result.flake?.verdict).toBe("unable-to-determine");
    expect(result.divergence?.index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// localizeFailure integration — absences, foreign, location, stack-trace ban
// ---------------------------------------------------------------------------

describe("localizeFailure — absences and end-to-end", () => {
  it("missing log → unable-to-determine, no invented observed sequence", () => {
    const root = tempRoot("ngrace-nolog-");
    writeMinimalNgraceProject(root);
    const index = loadGraceArtifactIndex(root);
    const result = localizeFailure({
      index,
      verification: index.verifications[0]!,
      module: index.modules[0],
      logText: null,
    });
    expect(result.absence?.verdict).toBe("unable-to-determine");
    expect(result.observed).toEqual([]);
    expect(result.divergence).toBeNull();
  });

  it("marker-less entry → absence, not a confident answer", () => {
    const root = tempRoot("ngrace-nomarkers-");
    writeMinimalNgraceProject(root);
    // Overwrite verification to remove markers.
    write(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>Example works.</Scenario></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
    );
    const index = loadGraceArtifactIndex(root);
    const result = localizeFailure({
      index,
      verification: index.verifications[0]!,
      module: index.modules[0],
      logText: "anything\n",
    });
    expect(result.absence?.verdict).toBe("unable-to-determine");
    expect(result.absence?.reason).toMatch(/no required log markers/);
  });

  it("stack-trace-only log → no divergence location from frames", () => {
    const root = tempRoot("ngrace-stack-");
    writeMinimalNgraceProject(root);
    write(
      root,
      "src/example.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-EXAMPLE",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Example][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
      ].join("\n"),
    );
    const index = loadGraceArtifactIndex(root);
    const stack = [
      "Error: boom",
      "    at Object.<anonymous> (/tmp/foo.ts:12:3)",
      "    at Module._compile (node:internal/modules:1:1)",
      "    at Object.Module._extensions..js (node:internal/modules:2:2)",
    ].join("\n");
    const result = localizeFailure({
      index,
      verification: index.verifications[0]!,
      module: index.modules.find((m) => m.id === "M-EXAMPLE"),
      logText: stack,
    });
    // Observed empty → diverge at 0; location is BLOCK region or absence — never a stack frame path.
    expect(result.observed).toEqual([]);
    expect(result.divergence?.index).toBe(0);
    expect(result.locations.every((l) => !l.path.includes("node:internal"))).toBe(true);
    const text = formatLocalizationText(result);
    expect(text).not.toMatch(/node:internal/);
    expect(text).not.toMatch(/at Object\./);
    // Location should be the BLOCK_RUN region when the file exposes it.
    if (result.locations.length > 0) {
      expect(result.locations[0]!.path).toBe("src/example.ts");
    }
  });

  it("foreign-only log reports foreign markers and empty own observed", () => {
    const root = tempRoot("ngrace-foreign-");
    writeSegmentedNgraceProject(root);
    write(
      root,
      "src/example.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-EXAMPLE",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Example][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
      ].join("\n"),
    );
    write(
      root,
      "src/second.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-SECOND",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Second][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
      ].join("\n"),
    );
    const index = loadGraceArtifactIndex(root);
    const example = index.verifications.find((v) => v.id === "V-M-EXAMPLE")!;
    const secondMarker = index.verifications.find((v) => v.id === "V-M-SECOND")!.requiredLogMarkers[0]!;
    const alphabet = projectMarkerAlphabet(index);
    expect(alphabet).toContain(secondMarker);
    const result = localizeFailure({
      index,
      verification: example,
      module: index.modules.find((m) => m.id === "M-EXAMPLE"),
      logText: `noise\n${secondMarker}\nmore\n`,
    });
    expect(result.observed).toEqual([]);
    expect(result.foreignMarkers).toEqual([secondMarker]);
    expect(result.divergence?.index).toBe(0);
  });

  it("happy path: partial sequence diverges at missing marker with location", () => {
    const root = tempRoot("ngrace-happy-");
    // Two markers on one entry.
    writeMinimalNgraceProject(root);
    write(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>Example works.</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker><Marker>[Example][validate][BLOCK_VALIDATE]</Marker></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
    );
    write(
      root,
      "src/example.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-EXAMPLE",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Example][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
        "// START_BLOCK_VALIDATE",
        'console.info("[Example][validate][BLOCK_VALIDATE]");',
        "// END_BLOCK_VALIDATE",
      ].join("\n"),
    );
    const index = loadGraceArtifactIndex(root);
    const verification = index.verifications[0]!;
    expect(verification.requiredLogMarkers).toHaveLength(2);
    const log = `${verification.requiredLogMarkers[0]}\n`;
    const result = localizeFailure({
      index,
      verification,
      module: index.modules.find((m) => m.id === "M-EXAMPLE"),
      logText: log,
    });
    expect(result.absence).toBeUndefined();
    expect(result.observed).toEqual([verification.requiredLogMarkers[0]!]);
    expect(result.divergence?.index).toBe(1);
    expect(result.divergence?.expected).toBe(verification.requiredLogMarkers[1]);
    expect(result.locations.some((l) => l.path === "src/example.ts")).toBe(true);
  });

  it("ungoverned test path → module absence", () => {
    const root = tempRoot("ngrace-ungov-");
    writeMinimalNgraceProject(root);
    const index = loadGraceArtifactIndex(root);
    const joined = resolveModuleForTestPath(index, "src/totally-ungoverned.test.ts");
    expect("absence" in joined).toBe(true);
    if ("absence" in joined) {
      expect(joined.absence.verdict).toBe("unable-to-determine");
    }
  });

  it("governed test path on V-M-* resolves to module", () => {
    const root = tempRoot("ngrace-gov-");
    writeMinimalNgraceProject(root);
    // TestFiles/File requires the path to exist on disk (mode: existing).
    write(root, "src/example.test.ts", 'test("example", () => {});');
    write(
      root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><TestFiles><File>src/example.test.ts</File></TestFiles><Scenario>Example works.</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-MAIN></NgraceVerificationDocument>`,
    );
    const index = loadGraceArtifactIndex(root);
    const joined = resolveModuleForTestPath(index, "src/example.test.ts");
    expect("moduleId" in joined).toBe(true);
    if ("moduleId" in joined) {
      expect(joined.moduleId).toBe("M-EXAMPLE");
    }
  });

  it("every absence verdict is unable-to-determine (A42.1 — not-run unused)", () => {
    const root = tempRoot("ngrace-verdict-");
    writeMinimalNgraceProject(root);
    const index = loadGraceArtifactIndex(root);
    const a = localizeFailure({
      index,
      verification: index.verifications[0]!,
      logText: null,
    });
    expect(a.absence?.verdict).toBe("unable-to-determine");
    expect(a.absence?.verdict).not.toBe("not-run");
  });
});

// ---------------------------------------------------------------------------
// CLI integration — ngrace verification localize
// ---------------------------------------------------------------------------

describe("CLI ngrace verification localize", () => {
  const repoRoot = path.resolve(import.meta.dir, "../..");

  it("localizes from --log and filters --review-json; no log is absence", () => {
    const root = tempRoot("ngrace-cli-loc-");
    writeMinimalNgraceProject(root);
    write(
      root,
      "src/example.ts",
      [
        "// START_MODULE_CONTRACT",
        "// LINKS: M-EXAMPLE",
        "// END_MODULE_CONTRACT",
        "// START_BLOCK_RUN",
        'console.info("[Example][run][BLOCK_RUN]");',
        "// END_BLOCK_RUN",
      ].join("\n"),
    );
    const logPath = path.join(root, "run.log");
    writeFileSync(logPath, "Error: boom\n    at Object.<anonymous> (/tmp/x.ts:1:1)\n");
    const reviewPath = path.join(root, "review.json");
    writeFileSync(
      reviewPath,
      JSON.stringify({
        ok: true,
        schemaVersion: "1.0.0",
        tool: "ngrace-review",
        findings: [
          {
            code: "review.scope-outside-write-scope",
            findingId: "f1",
            message: "out of scope",
            file: "src/x.ts",
            severity: "error",
          },
          {
            code: "review.confidently-wrong",
            findingId: "f2",
            message: "pattern",
          },
        ],
      }),
    );

    const withLog = Bun.spawnSync({
      cmd: [
        process.execPath,
        "./src/grace.ts",
        "verification",
        "localize",
        "V-M-EXAMPLE",
        "--path",
        root,
        "--log",
        logPath,
        "--review-json",
        reviewPath,
        "--json",
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(withLog.exitCode).toBe(0);
    const body = JSON.parse(Buffer.from(withLog.stdout).toString("utf8"));
    expect(body.ok).toBe(true);
    expect(body.tool).toBe("ngrace-verification-localize");
    expect(body.divergence?.index).toBe(0);
    expect(body.processContext.map((f: { code: string }) => f.code)).toEqual([
      "review.scope-outside-write-scope",
    ]);
    // Stack frames never appear as locations.
    expect(JSON.stringify(body.locations)).not.toContain("node:internal");
    expect(JSON.stringify(body.locations)).not.toContain("/tmp/x.ts");

    const noLog = Bun.spawnSync({
      cmd: [
        process.execPath,
        "./src/grace.ts",
        "verification",
        "localize",
        "V-M-EXAMPLE",
        "--path",
        root,
        "--json",
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(noLog.exitCode).toBe(0);
    const absent = JSON.parse(Buffer.from(noLog.stdout).toString("utf8"));
    expect(absent.absence?.verdict).toBe("unable-to-determine");
    expect(absent.observed).toEqual([]);
  });

  it("writes nothing under the project root (F1)", () => {
    const root = tempRoot("ngrace-cli-nowrite-");
    writeMinimalNgraceProject(root);
    const logPath = path.join(root, "run.log");
    writeFileSync(logPath, "x\n");
    const before = Bun.spawnSync({
      cmd: ["find", root, "-type", "f"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const beforeSet = new Set(
      Buffer.from(before.stdout).toString("utf8").trim().split("\n").filter(Boolean).sort(),
    );
    Bun.spawnSync({
      cmd: [
        process.execPath,
        "./src/grace.ts",
        "verification",
        "localize",
        "V-M-EXAMPLE",
        "--path",
        root,
        "--log",
        logPath,
        "--json",
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const after = Bun.spawnSync({
      cmd: ["find", root, "-type", "f"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const afterSet = new Set(
      Buffer.from(after.stdout).toString("utf8").trim().split("\n").filter(Boolean).sort(),
    );
    expect([...afterSet].sort()).toEqual([...beforeSet].sort());
  });
});
