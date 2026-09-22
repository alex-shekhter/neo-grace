import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import * as runMembership from "./run-membership";
import * as graceCursor from "../grace-cursor";
import {
  listLooseEvents as listLooseEventsFromArtifact,
  listRunOrphans as listRunOrphansFromArtifact,
} from "./run-membership";
import {
  listLooseEvents as listLooseEventsFromCursor,
  listRunOrphans as listRunOrphansFromCursor,
} from "../grace-cursor";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "./test-fixtures";

/**
 * AC-MEMBERSHIP-ONE-DEFINITION (construction, not output-only).
 * Primary proof: re-export identity is the same function object (===).
 * Secondary: exactly one production implementation body under run-membership.ts.
 */
describe("run-membership extract (C-REPORT-HONESTY T-001)", () => {
  it("re-exports the same function objects as grace-cursor (=== identity)", () => {
    expect(listLooseEventsFromCursor).toBe(listLooseEventsFromArtifact);
    expect(listRunOrphansFromCursor).toBe(listRunOrphansFromArtifact);
  });

  it("parseAllocationNode stays private (not on either module namespace)", () => {
    // Was private in grace-cursor before the extract; must not become public API.
    expect("parseAllocationNode" in runMembership).toBe(false);
    expect("parseAllocationNode" in graceCursor).toBe(false);
  });

  it("has exactly one production listLooseEvents / listRunOrphans body under run-membership", () => {
    const srcRoot = path.resolve(import.meta.dir, "..");
    const productionBodies: { file: string; kind: string }[] = [];

    function walk(dir: string) {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (name.name === "node_modules" || name.name.endsWith(".test.ts")) continue;
        const full = path.join(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.name.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        // Secondary check only (a `const` form would evade — F10). Primary is === above.
        if (/export function listLooseEvents\s*\(/.test(text)) {
          productionBodies.push({ file: path.relative(srcRoot, full), kind: "listLooseEvents" });
        }
        if (/export function listRunOrphans\s*\(/.test(text)) {
          productionBodies.push({ file: path.relative(srcRoot, full), kind: "listRunOrphans" });
        }
      }
    }
    walk(srcRoot);

    expect(productionBodies.filter((b) => b.kind === "listLooseEvents")).toEqual([
      { file: "artifact/run-membership.ts", kind: "listLooseEvents" },
    ]);
    expect(productionBodies.filter((b) => b.kind === "listRunOrphans")).toEqual([
      { file: "artifact/run-membership.ts", kind: "listRunOrphans" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// F295 membership disappearance and orphan tolerance (C-FOLD-MEMBERSHIP-RECOVERY-2-2E6A79D5 T-001)
// ---------------------------------------------------------------------------

const MEMBERSHIP_REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const MEMBERSHIP_INSTRUMENT_DIR = mkdtempSync(path.join(os.tmpdir(), "membership-instrument-"));
const LATE_PRELOAD = path.join(MEMBERSHIP_INSTRUMENT_DIR, "late-preload.ts");
const INVENTORY_CHILD = path.join(MEMBERSHIP_INSTRUMENT_DIR, "inventory-child.ts");

writeFileSync(
  LATE_PRELOAD,
  [
    'import fs from "node:fs";',
    'import { mock } from "bun:test";',
    "let fired = false;",
    "const realExists = fs.existsSync;",
    "const realRead = fs.readFileSync;",
    "const target = process.env.LATE_TARGET!;",
    "const instrumented = function (file: any, ...args: any[]) {",
    "  if (!fired && String(file) === target && realExists(target)) {",
    "    fired = true;",
    '    fs.rmSync(target, { force: true });',
    '    process.stderr.write("LATE_FIRED\\n");',
    "  }",
    "  return realRead.call(fs, file, ...args);",
    "};",
    'mock.module("node:fs", () => ({ ...fs, readFileSync: instrumented }));',
    'process.on("exit", () => { if (!fired) { process.stderr.write("LATE_NOT_FIRED\\n"); process.exitCode = 97; } });',
  ].join("\n"),
);
writeFileSync(
  INVENTORY_CHILD,
  [
    'import path from "node:path";',
    'const mod = await import(path.join(process.env.LATE_REPO!, "src/artifact/run-membership.ts"));',
    "const bundle = process.env.LATE_BUNDLE!;",
    "try {",
    '  if (process.env.LATE_WHICH === "loose") {',
    "    console.log(JSON.stringify({ loose: mod.listLooseEvents(bundle).map((e: any) => ({ id: e.id, kind: e.kind, file: e.file })) }));",
    "  } else {",
    "    console.log(JSON.stringify({ orphans: mod.listRunOrphans(bundle).map((o: any) => ({ name: o.name, class: o.class })) }));",
    "  }",
    "} catch (error: any) {",
    "  console.log(JSON.stringify({ threw: true, code: error?.code, message: String(error?.message ?? error) }));",
    "  process.exitCode = 1;",
    "}",
  ].join("\n"),
);

function membershipProject(changeId: string): { root: string; bundle: string; run: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), `membership-${changeId}-`));
  writeMinimalNgraceProject(root);
  writeChangeBundleFixture(root, { changeId, location: "active", specStatus: "approved", planStatus: "approved" });
  const bundle = path.join(root, ".ngrace", "changes", "active", changeId);
  const run = path.join(bundle, "run");
  mkdirSync(run, { recursive: true });
  return { root, bundle, run };
}

const openedEvent = (id: number) =>
  `<NgraceRunEvent graceVersion="1.0" id="${id}" task="T-001" kind="opened"><Allocation worker="w0" from="${id}" to="99"/></NgraceRunEvent>`;
const progressEvent = (id: number) =>
  `<NgraceRunEvent graceVersion="1.0" id="${id}" task="T-001" kind="progress"/>`;

function spawnGrace(
  root: string,
  args: string[],
  options: { preload?: string; env?: Record<string, string> } = {},
): { exit: number; stdout: string; stderr: string; fired: boolean } {
  const cmd = [
    process.execPath,
    ...(options.preload ? ["--preload", options.preload] : []),
    "./src/grace.ts",
    ...args,
    "--path",
    root,
  ];
  const result = Bun.spawnSync({
    cmd,
    cwd: MEMBERSHIP_REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const stderr = Buffer.from(result.stderr).toString("utf8");
  return { exit: result.exitCode, stdout, stderr, fired: stderr.includes("LATE_FIRED") };
}

function spawnInventoryChild(
  bundle: string,
  which: "loose" | "orphans",
  target: string,
): { exit: number; stdout: string; stderr: string; fired: boolean } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--preload", LATE_PRELOAD, INVENTORY_CHILD],
    cwd: MEMBERSHIP_REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LATE_REPO: MEMBERSHIP_REPO_ROOT, LATE_BUNDLE: bundle, LATE_WHICH: which, LATE_TARGET: target },
  });
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const stderr = Buffer.from(result.stderr).toString("utf8");
  return { exit: result.exitCode, stdout, stderr, fired: stderr.includes("LATE_FIRED") };
}

afterEach(() => {
  (runMembership as { setLooseEventReadProbeForTests?: (probe: unknown) => void }).setLooseEventReadProbeForTests?.(
    undefined,
  );
});

describe("F295 membership disappearance (AC-MEMBER-EARLY-VANISH)", () => {
  it("the named seam's early removal omits the entry and reports it fired", () => {
    const { bundle, run } = membershipProject("C-EARLY");
    writeFileSync(path.join(run, "1-T-001-opened.xml"), openedEvent(1));
    const target = path.join(run, "2-T-001-progress.xml");
    writeFileSync(target, progressEvent(2));
    let fired = false;
    const seam = (
      runMembership as {
        setLooseEventReadProbeForTests?: (probe: (file: string) => void) => void;
      }
    ).setLooseEventReadProbeForTests;
    expect(typeof seam, "the named read-boundary seam is a production export").toBe("function");
    seam?.((file) => {
      if (file === target) {
        fired = true;
        rmSync(file, { force: true });
      }
    });
    const events = listLooseEventsFromArtifact(bundle);
    expect(fired, "the read-boundary seam must report it fired").toBe(true);
    expect(events.map((event) => event.id)).toEqual([1]);
    expect(events.some((event) => event.file.endsWith("2-T-001-progress.xml"))).toBe(false);
    rmSync(path.dirname(bundle), { recursive: true, force: true });
  });

  it("a dangling backing file is an equivalent portable control and cursor show exits 0", () => {
    const { root, bundle, run } = membershipProject("C-EARLY");
    writeFileSync(path.join(run, "1-T-001-opened.xml"), openedEvent(1));
    symlinkSync("does-not-exist.xml", path.join(run, "2-T-001-progress.xml"));
    const events = listLooseEventsFromArtifact(bundle);
    expect(events.map((event) => event.id)).toEqual([1]);
    const show = spawnGrace(root, ["cursor", "show", "--change", "C-EARLY"]);
    expect(show.exit).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("F295 late window (AC-MEMBER-LATE-VANISH)", () => {
  it("a direct listLooseEvents omits an event removed after existsSync, with the interceptor reported fired", () => {
    const { bundle, run } = membershipProject("C-LATE");
    writeFileSync(path.join(run, "1-T-001-opened.xml"), openedEvent(1));
    const target = path.join(run, "2-T-001-progress.xml");
    writeFileSync(target, progressEvent(2));
    const child = spawnInventoryChild(bundle, "loose", target);
    expect(child.fired, "the after-existsSync interceptor must report it fired").toBe(true);
    expect(child.exit).toBe(0);
    const parsed = JSON.parse(child.stdout.trim().split("\n")[0]!);
    expect(parsed.loose.map((event: { id: number }) => event.id)).toEqual([1]);
    rmSync(path.dirname(bundle), { recursive: true, force: true });
  });

  it("real cursor show exits 0 on the late window, with the interceptor reported fired", () => {
    const { root, run } = membershipProject("C-LATE");
    writeFileSync(path.join(run, "1-T-001-opened.xml"), openedEvent(1));
    const target = path.join(run, "2-T-001-progress.xml");
    writeFileSync(target, progressEvent(2));
    const show = spawnGrace(root, ["cursor", "show", "--change", "C-LATE"], {
      preload: LATE_PRELOAD,
      env: { LATE_TARGET: target },
    });
    expect(show.fired, "the after-existsSync interceptor must report it fired").toBe(true);
    expect(show.exit).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("an EISDIR event path still exits non-zero, retains EISDIR, and names the path", () => {
    const { root, run } = membershipProject("C-EISDIR");
    const eventDir = path.join(run, "2-T-001-progress.xml");
    mkdirSync(eventDir);
    const show = spawnGrace(root, ["cursor", "show", "--change", "C-EISDIR"]);
    expect(show.exit).not.toBe(0);
    expect(show.stdout + show.stderr).toMatch(/EISDIR|illegal operation on a directory/i);
    expect(show.stdout + show.stderr).toContain(eventDir);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("F295 orphan tolerance (AC-MEMBER-ORPHANS-TOLERANT)", () => {
  const orphan = `<NgraceRunEvent graceVersion="1.0" id="x" task="T-001" kind="progress"/>`;

  it("present invalid-id orphan keeps the exact status and gate diagnostics", () => {
    const { root, run } = membershipProject("C-ORPH");
    writeFileSync(path.join(run, "2-T-001-progress.xml"), orphan);
    const status = spawnGrace(root, ["status"]);
    expect(status.exit).toBe(0);
    expect(status.stdout + status.stderr).toContain("orphans=1");
    const gate = spawnGrace(root, ["gate", "archive", "--change", "C-ORPH"]);
    expect(gate.exit).toBe(0);
    expect(gate.stdout + gate.stderr).toContain("1 orphan(s): 2-T-001-progress.xml (invalid-id)");
    rmSync(root, { recursive: true, force: true });
  });

  it("removed-before-enumeration keeps the exact status and gate diagnostics", () => {
    const { root } = membershipProject("C-ORPH");
    const status = spawnGrace(root, ["status"]);
    expect(status.exit).toBe(0);
    expect(status.stdout).not.toContain("orphans=");
    const gate = spawnGrace(root, ["gate", "archive", "--change", "C-ORPH"]);
    expect(gate.exit).toBe(0);
    expect(gate.stdout + gate.stderr).toMatch(/no-open-epoch/);
    expect(gate.stdout + gate.stderr).toMatch(/run\/ empty/);
    expect(gate.stdout + gate.stderr).not.toMatch(/orphan/i);
    rmSync(root, { recursive: true, force: true });
  });

  it("the true late window keeps both consumers at exit 0, with the interceptor reported fired", () => {
    const directFixture = membershipProject("C-ORPH");
    const directTarget = path.join(directFixture.run, "2-T-001-progress.xml");
    writeFileSync(directTarget, orphan);
    const direct = spawnInventoryChild(directFixture.bundle, "orphans", directTarget);
    expect(direct.fired).toBe(true);
    expect(direct.exit).toBe(0);

    const statusFixture = membershipProject("C-ORPH");
    const statusTarget = path.join(statusFixture.run, "2-T-001-progress.xml");
    writeFileSync(statusTarget, orphan);
    const status = spawnGrace(statusFixture.root, ["status"], { preload: LATE_PRELOAD, env: { LATE_TARGET: statusTarget } });
    expect(status.fired).toBe(true);
    expect(status.exit).toBe(0);

    const gateFixture = membershipProject("C-ORPH");
    const gateTarget = path.join(gateFixture.run, "2-T-001-progress.xml");
    writeFileSync(gateTarget, orphan);
    const gate = spawnGrace(gateFixture.root, ["gate", "archive", "--change", "C-ORPH"], {
      preload: LATE_PRELOAD,
      env: { LATE_TARGET: gateTarget },
    });
    expect(gate.fired).toBe(true);
    expect(gate.exit).toBe(0);
    rmSync(directFixture.root, { recursive: true, force: true });
    rmSync(statusFixture.root, { recursive: true, force: true });
    rmSync(gateFixture.root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// F315 unparseable loose input inventory (C-LOOSE-MALFORMED-FOLD-1-4C18E876 T-001)
// ---------------------------------------------------------------------------

describe("F315 unparseable loose input inventory (AC-MEMBER-MALFORMED-AND-UNREADABLE)", () => {
  it("retains filename-derived attributes and empty children and exposes parseIssue, with no LooseEvent.root", () => {
    const { root, bundle, run } = membershipProject("C-MAL");
    writeFileSync(path.join(run, "1-T-001-opened.xml"), openedEvent(1));
    writeFileSync(path.join(run, "2-T-001-terminal.xml"), "<broken");
    const events = listLooseEventsFromArtifact(bundle);
    const malformed = events.find((event) => event.id === 2);
    expect(malformed).toBeDefined();
    expect(malformed!.kind).toBe("terminal");
    expect(malformed!.attributes).toEqual({ id: "2", task: "T-001", kind: "terminal" });
    expect(malformed!.children).toEqual([]);
    const parseIssue = (malformed as { parseIssue?: { code?: string; message?: string } }).parseIssue;
    expect(parseIssue?.code).toBe("xml.parse");
    expect(typeof parseIssue?.message).toBe("string");
    expect("root" in (malformed as object)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("cursor show and a root lint remain tolerant of the loose unparseable file", () => {
    const { root, run } = membershipProject("C-MAL");
    writeFileSync(path.join(run, "1-T-001-opened.xml"), openedEvent(1));
    writeFileSync(path.join(run, "2-T-001-terminal.xml"), "<broken");
    const show = spawnGrace(root, ["cursor", "show", "--change", "C-MAL"]);
    expect(show.exit).toBe(0);
    const lint = spawnGrace(root, ["lint", "--fail-on", "errors"]);
    expect(lint.exit).toBe(0);
    expect(lint.stdout + lint.stderr).not.toMatch(/2-T-001-terminal/);
    rmSync(root, { recursive: true, force: true });
  });
});
