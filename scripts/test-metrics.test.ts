import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parseJUnit, rankSlowest, type TestCase } from "./test-metrics";

const RUNNER = path.resolve(import.meta.dir, "test-metrics.ts");

const VALID_JUNIT = `<testsuites hostname="some-machine">
  <testsuite name="suite">
    <testcase file="src/a.test.ts" name="current-slow" time="1.5"/>
    <testcase file="src/a.test.ts" name="fast" time="0.01"/>
  </testsuite>
</testsuites>
`;

const STALE_JUNIT = `<testsuites><testsuite name="s"><testcase file="src/stale.test.ts" name="stale-slow" time="9.9"/></testsuite></testsuites>
`;

const MALFORMED_JUNIT = `<testsuites><testcase file="src/ghost.test.ts" name="ghost-slow" time="8.8"/><unclosed></testsuites>
`;

const METADATA_POISON_JUNIT = `<testsuites><testsuite name="s"><properties><testcase file="ghost.ts" name="metadata-poison" time="100"/></properties><testcase file="real.ts" name="real-only" time="0.5"/></testsuite></testsuites>`;

const METADATA_SUBTREE_JUNIT = `<testsuites>
  <testsuite name="s">
    <properties>
      <property name="slowest" value="true"/>
      <testcase file="props-ghost.test.ts" name="properties-poison" time="99"/>
    </properties>
    <testcase file="real.test.ts" name="real" time="0.5"/>
    <system-out><testcase file="out-ghost.test.ts" name="system-out-poison" time="88"/></system-out>
    <system-err><testcase file="err-ghost.test.ts" name="system-err-poison" time="77"/></system-err>
  </testsuite>
</testsuites>`;

const AGGREGATE_JUNIT = `<testsuites>
  <testsuite name="first">
    <testcase file="one.test.ts" name="first-case" time="0.25"/>
  </testsuite>
  <testsuite name="second">
    <testsuite name="nested">
      <testcase file="two.test.ts" name="nested-case" time="1.75"/>
    </testsuite>
  </testsuite>
</testsuites>`;

const FAKE_BUN_SHIM = `#!/bin/sh
if [ -n "$FAKE_SENTINEL" ]; then printf '%s\\n' "$*" >> "$FAKE_SENTINEL"; fi
outfile=""
for arg in "$@"; do
  case "$arg" in
    --reporter-outfile=*) outfile="\${arg#--reporter-outfile=}" ;;
  esac
done
mode="\${FAKE_MODE:-valid}"
if [ "$mode" = "dir" ]; then
  mkdir -p "$outfile"
elif [ "$mode" = "valid" ] || [ "$mode" = "malformed" ]; then
  printf '%s' "$FAKE_JUNIT" > "$outfile"
fi
if [ "\${FAKE_SIGNAL:-}" = "kill" ]; then kill -9 $$; fi
exit "\${FAKE_EXIT:-0}"
`;

const OBSERVER = `const cp = require("node:child_process");
const fs = require("node:fs");
const originalSpawn = cp.spawnSync;
cp.spawnSync = function (...args) {
  try { fs.appendFileSync(process.env.FAKE_LAUNCH_LOG, JSON.stringify(args[0]) + "\\n"); } catch {}
  return originalSpawn.apply(this, args);
};
const originalMkdir = fs.mkdirSync;
fs.mkdirSync = function (...args) {
  try { fs.appendFileSync(process.env.FAKE_MKDIR_LOG, JSON.stringify(args[0]) + "\\n"); } catch {}
  return originalMkdir.apply(this, args);
};
const originalRm = fs.rmSync;
fs.rmSync = function (...args) {
  try { fs.appendFileSync(process.env.FAKE_RM_LOG, JSON.stringify(args[0]) + "\\n"); } catch {}
  return originalRm.apply(this, args);
};
try { require("node:module").syncBuiltinESMExports(); } catch {}
`;

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFakeBin(root: string): string {
  const bin = path.join(root, "fake-bin");
  mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, "bun");
  writeFileSync(shim, FAKE_BUN_SHIM);
  chmodSync(shim, 0o755);
  return bin;
}

function makeObserver(root: string): string {
  const observer = path.join(root, "observer.cjs");
  writeFileSync(observer, OBSERVER);
  return observer;
}

type RunOptions = {
  projectRoot: string;
  fakeBin?: string;
  pathOverride?: string;
  reportPath?: string;
  mode?: "valid" | "missing" | "malformed" | "dir";
  junit?: string;
  exit?: number;
  signal?: boolean;
  observer?: string;
  launchLog?: string;
  mkdirLog?: string;
  rmLog?: string;
  tmpdir?: string;
};

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  attempts: number;
  launches: number | undefined;
  mkdirs: number | undefined;
  rms: number | undefined;
};

function runRunner(options: RunOptions): RunResult {
  const root = options.projectRoot;
  const sentinel = path.join(root, ".child-sentinel");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.PATH = options.pathOverride ?? `${options.fakeBin}${path.delimiter}${process.env.PATH ?? ""}`;
  env.FAKE_SENTINEL = sentinel;
  env.FAKE_MODE = options.mode ?? "valid";
  env.FAKE_JUNIT = options.junit ?? "";
  env.FAKE_EXIT = String(options.exit ?? 0);
  if (options.signal) env.FAKE_SIGNAL = "kill";
  else delete env.FAKE_SIGNAL;
  if (options.reportPath !== undefined) env.NGRACE_TEST_REPORT_PATH = options.reportPath;
  else delete env.NGRACE_TEST_REPORT_PATH;
  if (options.launchLog) env.FAKE_LAUNCH_LOG = options.launchLog;
  else delete env.FAKE_LAUNCH_LOG;
  if (options.mkdirLog) env.FAKE_MKDIR_LOG = options.mkdirLog;
  else delete env.FAKE_MKDIR_LOG;
  if (options.rmLog) env.FAKE_RM_LOG = options.rmLog;
  else delete env.FAKE_RM_LOG;
  if (options.tmpdir !== undefined) env.TMPDIR = options.tmpdir;
  else delete env.TMPDIR;
  const args = options.observer ? ["--preload", options.observer, RUNNER] : [RUNNER];
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8" });
  const count = (file: string | undefined): number | undefined =>
    file === undefined
      ? undefined
      : existsSync(file)
        ? readFileSync(file, "utf8").split("\n").filter((line) => line.length > 0).length
        : 0;
  const attempts = count(sentinel) ?? 0;
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    attempts,
    launches: count(options.launchLog),
    mkdirs: count(options.mkdirLog),
    rms: count(options.rmLog),
  };
}

function printedReport(stdout: string): string {
  const match = /report:\s*(\S+)/.exec(stdout);
  if (!match) throw new Error(`no report path printed in: ${stdout}`);
  return match[1]!;
}

function withProject<T>(fn: (root: string, bin: string) => T): T {
  const root = tempDir("ngrace-metrics-");
  try {
    return fn(root, makeFakeBin(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("per-run raw JUnit report path policy", () => {
  it("accepts a valid outside override under a missing parent directory", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `reports-${path.basename(root)}`, "missing", "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: VALID_JUNIT });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(1);
      expect(existsSync(report)).toBe(true);
      expect(readFileSync(report, "utf8")).toBe(VALID_JUNIT);
      expect(result.stdout).toContain("current-slow");
    });
  });

  it("writes a unique report outside the repository by default", () => {
    withProject((root, bin) => {
      const result = runRunner({ projectRoot: root, fakeBin: bin, junit: VALID_JUNIT });
      expect(result.status).toBe(0);
      const report = printedReport(result.stdout);
      expect(path.isAbsolute(report)).toBe(true);
      expect(report.startsWith(root + path.sep)).toBe(false);
      expect(existsSync(report)).toBe(true);
      expect(result.attempts).toBe(1);
    });
  });

  it("accepts a sibling path that only shares the project name prefix", () => {
    withProject((root, bin) => {
      const sibling = `${root}-sibling`;
      mkdirSync(sibling, { recursive: true });
      try {
        const report = path.join(sibling, "out", "junit.xml");
        const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: VALID_JUNIT });
        expect(result.status).toBe(0);
        expect(existsSync(report)).toBe(true);
      } finally {
        rmSync(sibling, { recursive: true, force: true });
      }
    });
  });

  it("refuses an inside-repository override before any write and makes no child attempt", () => {
    withProject((root, bin) => {
      const nested = path.join(root, "sub", "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: nested, junit: VALID_JUNIT });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toBe("");
      expect(result.attempts).toBe(0);
      expect(existsSync(path.join(root, "sub"))).toBe(false);
    });
  });

  it("refuses an inside-repository override aimed at an existing planted file, leaving it intact", () => {
    withProject((root, bin) => {
      const planted = path.join(root, "planted.json");
      writeFileSync(planted, "keep-me\n");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: planted, junit: VALID_JUNIT });
      expect(result.status).not.toBe(0);
      expect(result.attempts).toBe(0);
      expect(readFileSync(planted, "utf8")).toBe("keep-me\n");
    });
  });

  it("refuses an override whose parent is a symlink resolving inside the repository", () => {
    withProject((root, bin) => {
      const outside = tempDir("ngrace-metrics-outside-");
      try {
        const target = path.join(root, "linked-target");
        mkdirSync(target, { recursive: true });
        const link = path.join(outside, "link");
        symlinkSync(target, link);
        const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: path.join(link, "junit.xml"), junit: VALID_JUNIT });
        expect(result.status).not.toBe(0);
        expect(result.attempts).toBe(0);
        expect(existsSync(path.join(target, "junit.xml"))).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

describe("current-report-only ranking", () => {
  it("reads the current report, not a stale pre-seeded report", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `current-${path.basename(root)}`, "junit.xml");
      mkdirSync(path.dirname(report), { recursive: true });
      writeFileSync(report, STALE_JUNIT);
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: VALID_JUNIT });
      expect(result.status).toBe(0);
      expect(readFileSync(report, "utf8")).toBe(VALID_JUNIT);
      expect(result.stdout).toContain("current-slow");
      expect(result.stdout).not.toContain("stale-slow");
    });
  });

  it("fails without ranking when the child succeeds but produces no report", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `missing-${path.basename(root)}`, "junit.xml");
      mkdirSync(path.dirname(report), { recursive: true });
      writeFileSync(report, STALE_JUNIT);
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, mode: "missing" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("stale-slow");
      expect(result.stderr).not.toBe("");
    });
  });

  it("fails without ranking when the report is malformed despite a valid testcase inside", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `malformed-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, mode: "malformed", junit: MALFORMED_JUNIT });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("ghost-slow");
      expect(result.stderr).not.toBe("");
    });
  });

  it("fails without ranking when the report path is an unreadable directory", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `dir-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, mode: "dir" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toBe("");
    });
  });
});

describe("suite launch and failure propagation", () => {
  it("makes exactly one launch attempt when the executable is missing, with no retry", () => {
    withProject((root) => {
      const observer = makeObserver(root);
      const launchLog = path.join(root, "launches.log");
      const emptyPath = path.join(root, "empty-bin");
      mkdirSync(emptyPath, { recursive: true });
      const result = runRunner({ projectRoot: root, pathOverride: emptyPath, observer, launchLog, junit: VALID_JUNIT });
      expect(result.status).toBe(1);
      expect(result.launches).toBe(1);
      expect(result.attempts).toBe(0);
      expect(result.stderr).not.toBe("");
    });
  });

  it("treats a signaled child as a diagnostic failure with one start and no retry", () => {
    withProject((root, bin) => {
      const observer = makeObserver(root);
      const launchLog = path.join(root, "launches.log");
      const result = runRunner({ projectRoot: root, fakeBin: bin, observer, launchLog, signal: true, junit: VALID_JUNIT });
      expect(result.status).toBe(1);
      expect(result.launches).toBe(1);
      expect(result.attempts).toBe(1);
      expect(result.stderr).not.toBe("");
    });
  });

  it("preserves the child's exact exit code even when the report is missing", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `exit7-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, mode: "missing", exit: 7 });
      expect(result.status).toBe(7);
      expect(result.attempts).toBe(1);
      expect(result.stdout).not.toContain("stale-slow");
    });
  });

  it("preserves exit 7 and the produced report bytes when the report is malformed", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `exit7m-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, mode: "malformed", junit: MALFORMED_JUNIT, exit: 7 });
      expect(result.status).toBe(7);
      expect(readFileSync(report, "utf8")).toBe(MALFORMED_JUNIT);
    });
  });
});

describe("legacy committed cache is gone", () => {
  it("leaves a poisoned test-metrics.json unchanged and does not recreate it", () => {
    withProject((root, bin) => {
      const legacy = path.join(root, "test-metrics.json");
      writeFileSync(legacy, '{"schemaVersion":"1.0.0","poisoned":true}\n');
      const report = path.join(root, "..", `legacy-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: VALID_JUNIT });
      expect(result.status).toBe(0);
      expect(readFileSync(legacy, "utf8")).toBe('{"schemaVersion":"1.0.0","poisoned":true}\n');
    });
  });
});

describe("delivered runner path and report defects", () => {
  it("refuses an existing directory report target, preserving the directory and its canary, with zero launches", () => {
    withProject((root, bin) => {
      const outside = tempDir("ngrace-metrics-dirtarget-");
      try {
        const target = path.join(outside, "report-dir");
        mkdirSync(target, { recursive: true });
        const canary = path.join(target, "canary.txt");
        writeFileSync(canary, "canary\n");
        const observer = makeObserver(root);
        const launchLog = path.join(root, "launches.log");
        const rmLog = path.join(root, "rm.log");
        const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: target, observer, launchLog, rmLog, junit: VALID_JUNIT });
        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toBe("");
        expect(result.launches).toBe(0);
        expect(result.attempts).toBe(0);
        expect(result.rms).toBe(0);
        expect(existsSync(target)).toBe(true);
        expect(readFileSync(canary, "utf8")).toBe("canary\n");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("refuses a default output when TMPDIR resolves inside the project, creating nothing", () => {
    withProject((root, bin) => {
      const observer = makeObserver(root);
      const launchLog = path.join(root, "launches.log");
      const mkdirLog = path.join(root, "mkdir.log");
      const result = runRunner({ projectRoot: root, fakeBin: bin, observer, launchLog, mkdirLog, tmpdir: root, junit: VALID_JUNIT });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toBe("");
      expect(result.launches).toBe(0);
      expect(result.attempts).toBe(0);
      expect(result.mkdirs).toBe(0);
      expect(readdirSync(root).filter((name) => name.startsWith("ngrace-test-reports-"))).toEqual([]);
    });
  });

  it("refuses a default output when the temp base is a symlink resolving inside the project", () => {
    withProject((root, bin) => {
      const outside = tempDir("ngrace-metrics-tmplink-");
      try {
        const inside = path.join(root, "tmp-inside");
        mkdirSync(inside, { recursive: true });
        const link = path.join(outside, "templink");
        symlinkSync(inside, link);
        const result = runRunner({ projectRoot: root, fakeBin: bin, tmpdir: link, junit: VALID_JUNIT });
        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toBe("");
        expect(readdirSync(inside)).toEqual([]);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("refuses an override whose physical resolution crosses a symlink back inside, leaving outside siblings intact", () => {
    withProject((root, bin) => {
      const outside = tempDir("ngrace-metrics-phys-");
      try {
        const sub = path.join(root, "sub");
        mkdirSync(sub, { recursive: true });
        const link = path.join(outside, "link");
        symlinkSync(sub, link);
        const sibling = path.join(outside, "report.xml");
        writeFileSync(sibling, "sibling-keep\n");
        const override = `${link}${path.sep}..${path.sep}report.xml`;
        const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: override, junit: VALID_JUNIT });
        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toBe("");
        expect(result.attempts).toBe(0);
        expect(readFileSync(sibling, "utf8")).toBe("sibling-keep\n");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("refuses a dangling symlink override pointing at a missing in-project subtree before any mkdir or launch", () => {
    withProject((root, bin) => {
      const outside = tempDir("ngrace-metrics-dangle-");
      try {
        const link = path.join(outside, "dangling");
        symlinkSync(path.join(root, "missing-subtree"), link);
        const observer = makeObserver(root);
        const launchLog = path.join(root, "launches.log");
        const mkdirLog = path.join(root, "mkdir.log");
        const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: path.join(link, "junit.xml"), observer, launchLog, mkdirLog, junit: VALID_JUNIT });
        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toBe("");
        expect(result.launches).toBe(0);
        expect(result.mkdirs).toBe(0);
        expect(existsSync(path.join(root, "missing-subtree"))).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("keeps outside symlink-chain overrides working", () => {
    withProject((root, bin) => {
      const outside = tempDir("ngrace-metrics-chain-");
      try {
        const real = path.join(outside, "real");
        mkdirSync(real, { recursive: true });
        const linkA = path.join(outside, "a");
        symlinkSync(real, linkA);
        const linkB = path.join(outside, "b");
        symlinkSync(linkA, linkB);
        const report = path.join(linkB, "junit.xml");
        const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: VALID_JUNIT });
        expect(result.status).toBe(0);
        expect(existsSync(path.join(real, "junit.xml"))).toBe(true);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("parses JUnit elements only, ignoring comment and CDATA testcase-shaped text", () => {
    const xml = `<testsuites><testsuite name="s">
    <!-- <testcase file="x.test.ts" name="comment-poison" time="100"/> -->
    <testcase file="src/real.test.ts" name="real" time="0.5"/>
    <testcase file="src/other.test.ts" name="other"><system-out><![CDATA[<testcase file="y.test.ts" name="cdata-poison" time="200"/>]]></system-out></testcase>
  </testsuite></testsuites>`;
    const tests = parseJUnit(xml);
    expect(tests.map((test) => test.name).sort()).toEqual(["other", "real"]);
    expect(rankSlowest(tests, 1)[0]!.name).toBe("real");
  });

  it("decodes single-quoted attributes and XML entities", () => {
    const xml = `<testsuites><testsuite name='suite'><testcase file='src/a&amp;b.test.ts' name='case "quoted > value" &amp; more' time='1.25'/></testsuite></testsuites>`;
    const tests = parseJUnit(xml);
    expect(tests).toEqual([{ file: "src/a&b.test.ts", name: 'case "quoted > value" & more', ms: 1250 }]);
  });

  it("refuses a non-JUnit XML report after child success while keeping an empty JUnit report valid", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `notjunit-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: "<not-junit/>" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toBe("");
    });
    expect(() => parseJUnit("<not-junit/>")).toThrow();
    expect(parseJUnit("<testsuites></testsuites>")).toEqual([]);
  });
});

describe("suite-boundary testcase extraction", () => {
  it("ranks only real suite cases through the real outer entry, excluding a metadata testcase", () => {
    withProject((root, bin) => {
      const report = path.join(root, "..", `suite-boundary-${path.basename(root)}`, "junit.xml");
      const result = runRunner({ projectRoot: root, fakeBin: bin, reportPath: report, junit: METADATA_POISON_JUNIT });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(1);
      expect(readFileSync(report, "utf8")).toBe(METADATA_POISON_JUNIT);
      expect(result.stdout).toMatch(/500 ms\s+real\.ts\s+real-only/);
      expect(result.stdout).not.toContain("metadata-poison");
      expect(result.stdout).not.toContain("ghost.ts");
    });
  });

  it("extracts cases only from testsuite positions, not metadata containers", () => {
    expect(parseJUnit(METADATA_POISON_JUNIT)).toEqual([{ file: "real.ts", name: "real-only", ms: 500 }]);
    expect(parseJUnit(METADATA_SUBTREE_JUNIT).map((test) => test.name)).toEqual(["real"]);
    expect(parseJUnit('<testsuites><testcase file="direct.ts" name="direct-outside-suite" time="10"/></testsuites>')).toEqual([]);
  });

  it("keeps a single top-level testsuite's cases", () => {
    const xml = `<testsuite name="solo"><testcase file="solo.test.ts" name="solo" time="0.125"/></testsuite>`;
    expect(parseJUnit(xml)).toEqual([{ file: "solo.test.ts", name: "solo", ms: 125 }]);
  });

  it("keeps aggregate and nested suite cases", () => {
    const names = parseJUnit(AGGREGATE_JUNIT).map((test) => test.name).sort();
    expect(names).toEqual(["first-case", "nested-case"]);
  });
});

describe("parser and ranking", () => {
  it("parses testcase file, name, and milliseconds without retaining the hostname", () => {
    const tests = parseJUnit(VALID_JUNIT);
    expect(tests.length).toBe(2);
    expect(tests[0]).toEqual({ file: "src/a.test.ts", name: "current-slow", ms: 1500 });
    expect(JSON.stringify(tests)).not.toContain("some-machine");
  });

  it("ranks a distinct slow case first", () => {
    const tests: TestCase[] = [
      { file: "x.test.ts", name: "fast", ms: 1 },
      { file: "x.test.ts", name: "planted", ms: 2000 },
      { file: "x.test.ts", name: "medium", ms: 50 },
    ];
    expect(rankSlowest(tests, 1)[0]!.name).toBe("planted");
    expect(rankSlowest(tests, 2).map((test) => test.name)).toEqual(["planted", "medium"]);
  });

  it("rejects malformed XML that still contains a valid testcase", () => {
    expect(() => parseJUnit(MALFORMED_JUNIT)).toThrow();
  });
});
