import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, appendFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "bun:test";
import { runCoordinator, validateCoordinatorPlan, type CoordinatorPlan, type CoordinatorOptions } from "./coordinator";
import { writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { resolveSpecMint } from "../grace-generate";
import { ARTIFACT_DIR } from "../artifact/paths";

const repo = process.cwd();
const graceBin = path.join(repo, "src", "grace.ts");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { if ((e as { code?: string }).code === "ESRCH") return false; throw e; } };
type Proc = ReturnType<typeof Bun.spawn>;
/** Record every spawned child so a test can reap it in `finally`, without `ps`. */
const makeSpawnRecorder = () => {
  const procs: Proc[] = [];
  const spawn = ((o: Parameters<typeof Bun.spawn>[0]) => { const p = Bun.spawn(o); procs.push(p); return p; }) as typeof Bun.spawn;
  return { spawn, procs };
};
/** SIGKILL and await each child's exit (bounded); confirm none is still alive. */
const reapProcs = async (procs: Proc[]): Promise<void> => {
  const stuck: number[] = [];
  for (const p of procs) {
    try { process.kill(p.pid, "SIGKILL"); } catch { /* may already be gone */ }
    const reaped = await Promise.race([p.exited.then(() => true), Bun.sleep(2000).then(() => false)]);
    if (!reaped || alive(p.pid)) stuck.push(p.pid);
  }
  if (stuck.length > 0) throw new Error(`unreaped pids after SIGKILL: ${stuck.join(", ")}`);
};
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const fresh = (prefix: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const L = { root, project: path.join(root, "project"), control: path.join(root, "control") };
  mkdirSync(L.project, { recursive: true });
  mkdirSync(L.control, { recursive: true });
  return { root, L };
};

describe("coordinator preflight", () => {
  it("AC-COORDINATOR-PREFLIGHT-REFUSES: 20 required cases plus layout, knob, and id cases refuse with offending id/path, zero spawns, no new workspace", async () => {
    const { root, L } = fresh("coord-preflight-");
    const ws = (n: string) => path.join(root, "workers", n);
    mkdirSync(ws("real"), { recursive: true });
    symlinkSync(ws("real"), ws("alias"));
    const base = (workers: CoordinatorPlan["workers"]): CoordinatorPlan => ({ ...L, workers });
    const w = (over: Partial<CoordinatorPlan["workers"][number]> = {}, id = "a") => ({ id, command: ["true"], workspace: ws(id), ...over });
    type Case = { name: string; required: boolean; plan: CoordinatorPlan; opts: CoordinatorOptions; precreated: string[]; expects: string[] };
    const cases: Case[] = [
      { name: "duplicate-id", required: true, plan: base([w({}, "w"), w({}, "w")]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["duplicate worker id w"] },
      { name: "equal-workspaces", required: true, plan: base([{ id: "a", command: ["true"], workspace: ws("eq") }, { id: "b", command: ["true"], workspace: ws("eq") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["overlap", "a and b"] },
      { name: "nested-workspace", required: true, plan: base([{ id: "a", command: ["true"], workspace: ws("x") }, { id: "b", command: ["true"], workspace: path.join(ws("x"), "inner") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["overlap", "a and b"] },
      { name: "symlink-alias", required: true, plan: base([{ id: "a", command: ["true"], workspace: ws("real") }, { id: "b", command: ["true"], workspace: ws("alias") }]), opts: { timeoutMs: 1000 }, precreated: [ws("real"), ws("alias")], expects: ["overlap", "a and b"] },
      { name: "escaping-output", required: true, plan: base([w({ outputs: [path.join(root, "project", "out.txt")] })]), opts: { timeoutMs: 1000 }, precreated: [L.project], expects: ["worker a output", "escapes its workspace"] },
      { name: "duplicate-output-name", required: true, plan: base([w({ outputs: [path.join(ws("a"), "out.txt")] }), { id: "b", command: ["true"], workspace: ws("b"), outputs: [path.join(ws("b"), "out.txt")] }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["duplicate output name out.txt", "a and b"] },
      { name: "reserved-log-collision", required: true, plan: base([w({ outputs: [path.join(ws("a"), "stdout.log")] })]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["reserved log path", "stdout.log"] },
      { name: "gate-inside-workspace", required: true, plan: base([w({ startAfterPath: path.join(ws("a"), "gate"), startAfterTimeoutMs: 100 })]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a startAfterPath", "inside a worker workspace"] },
      { name: "gate-timeout-zero", required: true, plan: base([w({ startAfterPath: path.join(L.control, "gate"), startAfterTimeoutMs: 0 })]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a startAfterTimeoutMs must be finite and positive"] },
      { name: "gate-timeout-negative", required: true, plan: base([w({ startAfterPath: path.join(L.control, "gate"), startAfterTimeoutMs: -1 })]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a startAfterTimeoutMs must be finite and positive"] },
      { name: "gate-timeout-nan", required: true, plan: base([w({ startAfterPath: path.join(L.control, "gate"), startAfterTimeoutMs: Number.NaN })]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a startAfterTimeoutMs must be finite and positive"] },
      { name: "gate-timeout-infinity", required: true, plan: base([w({ startAfterPath: path.join(L.control, "gate"), startAfterTimeoutMs: Number.POSITIVE_INFINITY })]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a startAfterTimeoutMs must be finite and positive"] },
      { name: "global-zero", required: true, plan: base([w()]), opts: { timeoutMs: 0 }, precreated: [], expects: ["global deadline must be finite and positive, got 0"] },
      { name: "global-negative", required: true, plan: base([w()]), opts: { timeoutMs: -1 }, precreated: [], expects: ["global deadline must be finite and positive, got -1"] },
      { name: "global-nan", required: true, plan: base([w()]), opts: { timeoutMs: Number.NaN }, precreated: [], expects: ["global deadline must be finite and positive, got NaN"] },
      { name: "global-infinity", required: true, plan: base([w()]), opts: { timeoutMs: Number.POSITIVE_INFINITY }, precreated: [], expects: ["global deadline must be finite and positive, got Infinity"] },
      { name: "workspace-contains-project", required: true, plan: { root, project: path.join(root, "ws", "project"), control: L.control, workers: [{ id: "a", command: ["true"], workspace: path.join(root, "ws") }] }, opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a workspace", "must not contain project/ or control/"] },
      { name: "workspace-inside-project", required: true, plan: base([{ id: "a", command: ["true"], workspace: path.join(L.project, "workers", "a") }]), opts: { timeoutMs: 1000 }, precreated: [L.project], expects: ["worker a workspace", "must not be nested inside project/ or control/"] },
      { name: "workspace-contains-control", required: true, plan: { root, project: L.project, control: path.join(root, "ws2", "control"), workers: [{ id: "a", command: ["true"], workspace: path.join(root, "ws2") }] }, opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a workspace", "must not contain project/ or control/"] },
      { name: "workspace-inside-control", required: true, plan: base([{ id: "a", command: ["true"], workspace: path.join(L.control, "workers", "a") }]), opts: { timeoutMs: 1000 }, precreated: [L.control], expects: ["worker a workspace", "must not be nested inside project/ or control/"] },
      // Additional ownership, knob, and id refusals (beyond the 20 required cases).
      { name: "symlinked-project-control", required: false, plan: (() => { const r = path.join(root, "sym"); mkdirSync(path.join(r, "control"), { recursive: true }); symlinkSync(path.join(r, "control"), path.join(r, "project")); return { root: r, project: path.join(r, "project"), control: path.join(r, "control"), workers: [{ id: "a", command: ["true"], workspace: path.join(r, "workers", "a") }] }; })(), opts: { timeoutMs: 1000 }, precreated: [], expects: ["canonically distinct"] },
      { name: "workspace-under-misc", required: false, plan: base([{ id: "a", command: ["true"], workspace: path.join(root, "misc", "a") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a workspace must be the canonical sibling root/workers/a directory"] },
      { name: "workspace-wrong-name", required: false, plan: base([{ id: "a", command: ["true"], workspace: path.join(root, "workers", "b") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["worker a workspace must be the canonical sibling root/workers/a directory"] },
      { name: "poll-ms-infinity", required: false, plan: base([w()]), opts: { timeoutMs: 1000, pollMs: Number.POSITIVE_INFINITY }, precreated: [], expects: ["pollMs must be finite and positive"] },
      { name: "reap-timeout-infinity", required: false, plan: base([w()]), opts: { timeoutMs: 1000, reapTimeoutMs: Number.POSITIVE_INFINITY }, precreated: [], expects: ["reapTimeoutMs must be finite and positive"] },
      { name: "id-parent-segment", required: false, plan: base([{ id: "../misc", command: ["true"], workspace: path.join(root, "misc") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ['worker id "../misc" must be a nonempty single path segment'] },
      { name: "id-separator", required: false, plan: base([{ id: "a/b", command: ["true"], workspace: path.join(root, "workers", "a", "b") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ['worker id "a/b" must be a nonempty single path segment'] },
      { name: "id-dot", required: false, plan: base([{ id: ".", command: ["true"], workspace: path.join(root, "workers", "z1") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ['worker id "." must be a nonempty single path segment'] },
      { name: "id-empty", required: false, plan: base([{ id: "", command: ["true"], workspace: path.join(root, "workers", "z2") }]), opts: { timeoutMs: 1000 }, precreated: [], expects: ["must be a nonempty single path segment"] },
    ];
    expect(cases.filter((c) => c.required).length).toBe(20);
    const observed: Record<string, string> = {};
    for (const c of cases) {
      const spy = { calls: 0 };
      const spawn = ((o: Parameters<typeof Bun.spawn>[0]) => { spy.calls += 1; return Bun.spawn(o); }) as typeof Bun.spawn;
      let refusal = "";
      try {
        await runCoordinator(c.plan, c.opts, { spawn });
      } catch (e) { refusal = (e as Error).message; }
      for (const token of c.expects) expect(refusal, `${c.name} missing token: ${token}`).toContain(token);
      expect(spy.calls, c.name).toBe(0);
      for (const worker of c.plan.workers) {
        if (c.precreated.includes(worker.workspace)) expect(existsSync(worker.workspace), c.name).toBe(true);
        else expect(existsSync(worker.workspace), c.name).toBe(false);
      }
      observed[c.name] = refusal;
    }
    console.log("PREFLIGHT_CASES", JSON.stringify(observed));
    rmSync(root, { recursive: true, force: true });
  });

  it("AC-COORDINATOR-PREFLIGHT-REFUSES: validateCoordinatorPlan refuses a nested workspace directly", () => {
    const { root, L } = fresh("coord-direct-");
    expect(() => validateCoordinatorPlan({ ...L, workers: [
      { id: "a", command: ["true"], workspace: path.join(root, "workers", "x") },
      { id: "b", command: ["true"], workspace: path.join(root, "workers", "x", "inner") },
    ] }, { timeoutMs: 1000 })).toThrow(/overlap/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("coordinator termination", () => {
  it("AC-COORDINATOR-TIMEOUT-KILLS: a finite poll larger than the deadline cannot extend it; each worker's timedOut, exit 7, absent output recorded", async () => {
    const { root, L } = fresh("coord-timeout-");
    const recorder = makeSpawnRecorder();
    const procs = recorder.procs;
    const quickCommand = [process.execPath, "-e", "process.exit(7)"];
    // Establish the finished fixture by real subprocess observation: start the quick worker and
    // await its actual exit before the coordinator observes it, so the completed outcome does not
    // depend on a fresh subprocess starting and finishing inside the 100ms deadline.
    const quickProc = Bun.spawn({ cmd: quickCommand, stdout: "pipe", stderr: "pipe" });
    await quickProc.exited;
    procs.push(quickProc);
    const spawn = ((o: Parameters<typeof Bun.spawn>[0]) => {
      const cmd = (o as { cmd?: readonly string[] }).cmd;
      if (Array.isArray(cmd) && cmd.length === 3 && cmd[0] === quickCommand[0] && cmd[2] === quickCommand[2]) return quickProc;
      return recorder.spawn(o);
    }) as typeof Bun.spawn;
    try {
      const t0 = Date.now();
      const r = await runCoordinator({ ...L, workers: [
        { id: "forever", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "forever"), outputs: [path.join(root, "workers", "forever", "never.txt")] },
        { id: "quick", command: [process.execPath, "-e", "process.exit(7)"], workspace: path.join(root, "workers", "quick") },
      ] }, { timeoutMs: 100, pollMs: 800, onWorkerStateChange: () => {} }, { spawn });
      const elapsed = Date.now() - t0;
      expect(r.timedOut).toBe(true);
      expect(elapsed).toBeLessThan(700); // large poll bounded by the 100ms global deadline
      expect(r.workers.find((w) => w.id === "forever")?.timedOut).toBe(true);
      expect(r.workers.find((w) => w.id === "quick")?.timedOut).toBe(false);
      expect(r.workers.find((w) => w.id === "forever")?.signalCode).toBe("SIGKILL");
      expect(r.workers.find((w) => w.id === "quick")?.exitCode).toBe(7);
      expect(r.workers.find((w) => w.id === "forever")?.outputs[0]?.exists).toBe(false);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-COORDINATOR-TIMEOUT-KILLS: a worker exit 7 is returned as data, not thrown", async () => {
    const { root, L } = fresh("coord-exit7-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      const r = await runCoordinator({ ...L, workers: [{ id: "seven", command: [process.execPath, "-e", "process.exit(7)"], workspace: path.join(root, "workers", "seven") }] }, { timeoutMs: 2000, pollMs: 10 }, { spawn });
      expect(r.timedOut).toBe(false);
      expect(r.workers[0]?.exitCode).toBe(7);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("coordinator deadline precedence", () => {
  it("AC-COORDINATOR-DEADLINE-PRECEDENCE: the global deadline wins over a longer gate timeout and reaps the started worker", async () => {
    const { root, L } = fresh("coord-prec-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      const r = await runCoordinator({ ...L, workers: [
        { id: "first", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "first") },
        { id: "gated", command: [process.execPath, "-e", "process.exit(0)"], workspace: path.join(root, "workers", "gated"), startAfterPath: path.join(L.control, "never"), startAfterTimeoutMs: 500 },
      ] }, { timeoutMs: 100, pollMs: 10 }, { spawn });
      expect(r.timedOut).toBe(true);
      expect(r.elapsedMs).toBeLessThan(500);
      expect(r.workers.map((w) => w.id)).toEqual(["first"]);
      expect(r.workers[0]?.signalCode).toBe("SIGKILL");
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-COORDINATOR-DEADLINE-PRECEDENCE: a shorter gate timeout fails fast after cleanup", async () => {
    const { root, L } = fresh("coord-prec2-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      await expect(runCoordinator({ ...L, workers: [
        { id: "gated", command: [process.execPath, "-e", "process.exit(0)"], workspace: path.join(root, "workers", "gated"), startAfterPath: path.join(L.control, "never"), startAfterTimeoutMs: 200 },
      ] }, { timeoutMs: 10000, pollMs: 10 }, { spawn })).rejects.toThrow(/start gate did not appear/);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("coordinator fail-fast cleanup", () => {
  it("AC-COORDINATOR-FAIL-FAST-CLEANUP: reaps a running first worker when a gated second spawn fails", async () => {
    const { root, L } = fresh("coord-cleanup-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      const ready = path.join(L.control, "first.ready");
      let pid = NaN;
      let thrown = "";
      try {
        await runCoordinator({ ...L, workers: [
          { id: "first", command: [process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(ready)}, "1"); await Bun.sleep(600000);`], workspace: path.join(root, "workers", "first") },
          { id: "second", command: ["/nonexistent/binary-that-does-not-exist"], workspace: path.join(root, "workers", "second"), startAfterPath: ready, startAfterTimeoutMs: 5000 },
        ] }, { timeoutMs: 600000, pollMs: 10, onWorkerStateChange: (e) => { if (e.id === "first" && e.phase === "started") pid = e.pid; } }, { spawn });
      } catch (e) { thrown = (e as Error).message; }
      expect(thrown).toContain("terminated and reaped");
      expect(Number.isFinite(pid)).toBe(true);
      expect(alive(pid)).toBe(false);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-COORDINATOR-FAIL-FAST-CLEANUP: an unreadable present output interrupts promptly, not at the deadline, and reaps the long worker", async () => {
    const { root, L } = fresh("coord-unreadable-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      mkdirSync(path.join(root, "workers", "b", "out.txt"), { recursive: true });
      const pids: number[] = [];
      let thrown = "";
      const t0 = Date.now();
      try {
        await runCoordinator({ ...L, workers: [
          { id: "a", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "a") },
          { id: "b", command: [process.execPath, "-e", "process.exit(0)"], workspace: path.join(root, "workers", "b"), outputs: [path.join(root, "workers", "b", "out.txt")] },
        ] }, { timeoutMs: 5000, pollMs: 10, onWorkerStateChange: (e) => { if (e.phase === "started") pids.push(e.pid); } }, { spawn });
      } catch (e) { thrown = (e as Error).message; }
      expect(thrown).toContain("EISDIR");
      expect(Date.now() - t0).toBeLessThan(1500);
      for (const p of pids) expect(alive(p)).toBe(false);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-COORDINATOR-FAIL-FAST-CLEANUP: a failed kill returns a bounded error naming the unreaped PID", async () => {
    const { root, L } = fresh("coord-kill-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      let pid = NaN;
      let thrown = "";
      const t0 = Date.now();
      try {
        await runCoordinator({ ...L, workers: [{ id: "stuck", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "stuck") }] }, { timeoutMs: 200, pollMs: 10, reapTimeoutMs: 300, onWorkerStateChange: (e) => { if (e.phase === "started") pid = e.pid; } }, { spawn, kill: () => { throw new Error("kill refused"); } });
      } catch (e) { thrown = (e as Error).message; }
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(Number.isFinite(pid)).toBe(true);
      expect(thrown).toContain(String(pid));
      expect(thrown).toContain("reap incomplete");
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("coordinator stream faults", () => {
  it("AC-COORDINATOR-STREAM-FAULT: fails fast on a running-phase pump fault with no started PID alive", async () => {
    const { root, L } = fresh("coord-stream-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      mkdirSync(path.join(root, "workers", "broken", "stdout.log"), { recursive: true });
      const pids: number[] = [];
      let thrown = "";
      const t0 = Date.now();
      try {
        await runCoordinator({ ...L, workers: [
          { id: "broken", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "broken") },
          { id: "other", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "other") },
        ] }, { timeoutMs: 10000, pollMs: 10, onWorkerStateChange: (e) => { if (e.phase === "started") pids.push(e.pid); } }, { spawn });
      } catch (e) { thrown = (e as Error).message; }
      expect(thrown).toContain("EISDIR");
      expect(Date.now() - t0).toBeLessThan(3000);
      for (const p of pids) expect(alive(p)).toBe(false);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-COORDINATOR-STREAM-FAULT: a stream fault interrupts the staged gate wait and never spawns the gated worker", async () => {
    const { root, L } = fresh("coord-gatefault-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      mkdirSync(path.join(root, "workers", "broken", "stdout.log"), { recursive: true });
      const events: string[] = [];
      let pid = NaN;
      const t0 = Date.now();
      let thrown = "";
      try {
        await runCoordinator({ ...L, workers: [
          { id: "broken", command: [process.execPath, "-e", "await Bun.sleep(600000)"], workspace: path.join(root, "workers", "broken") },
          { id: "gated", command: [process.execPath, "-e", "process.exit(0)"], workspace: path.join(root, "workers", "gated"), startAfterPath: path.join(L.control, "never"), startAfterTimeoutMs: 1200 },
        ] }, { timeoutMs: 5000, pollMs: 10, onWorkerStateChange: (e) => { events.push(`${e.id}:${e.phase}`); if (e.id === "broken" && e.phase === "started") pid = e.pid; } }, { spawn });
      } catch (e) { thrown = (e as Error).message; }
      expect(Date.now() - t0).toBeLessThan(1200);
      expect(thrown).toContain("EISDIR");
      expect(events).not.toContain("gated:started");
      expect(alive(pid)).toBe(false);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("AC-COORDINATOR-STREAM-FAULT: an output-read fault interrupts a gate wait and never spawns the gated worker", async () => {
    const { root, L } = fresh("coord-gateout-");
    const { spawn, procs } = makeSpawnRecorder();
    try {
      mkdirSync(path.join(root, "workers", "a", "out.txt"), { recursive: true });
      const events: string[] = [];
      let pid = NaN;
      const t0 = Date.now();
      let thrown = "";
      try {
        await runCoordinator({ ...L, workers: [
          { id: "a", command: [process.execPath, "-e", "process.exit(0)"], workspace: path.join(root, "workers", "a"), outputs: [path.join(root, "workers", "a", "out.txt")] },
          { id: "gated", command: [process.execPath, "-e", "process.exit(0)"], workspace: path.join(root, "workers", "gated"), startAfterPath: path.join(L.control, "never"), startAfterTimeoutMs: 1500 },
        ] }, { timeoutMs: 5000, pollMs: 10, onWorkerStateChange: (e) => { events.push(`${e.id}:${e.phase}`); if (e.id === "a" && e.phase === "started") pid = e.pid; } }, { spawn });
      } catch (e) { thrown = (e as Error).message; }
      expect(Date.now() - t0).toBeLessThan(1200);
      expect(thrown).toContain("EISDIR");
      expect(events).not.toContain("gated:started");
      expect(alive(pid)).toBe(false);
    } finally {
      await reapProcs(procs);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("coordinator concurrent CLI", () => {
  it("AC-COORDINATOR-AWAITS-ALL: contender exits numeric nonzero, exactly the minted bundle and both logs exist, bytes equal while held, planted byte reddens", async () => {
    const run = async (planted: boolean) => {
      const { root, L } = fresh("coord-staged-");
      writeMinimalNgraceProject(L.project);
      const activeDir = path.join(L.project, ARTIFACT_DIR, "changes", "active");
      const release = path.join(L.control, "release");
      const mint = resolveSpecMint({ slug: "COORD", timestamp: "2026-09-27T19:13:02Z", branch: "feat/coordinator-boundary" }, L.project);
      const lockPath = path.join(activeDir, `.candidate-${mint.id}.lock`);
      const specPath = path.join(activeDir, mint.id, "spec.xml");
      const planPath = path.join(activeDir, mint.id, "plan.xml");
      const env = { ...process.env, NGRACE_PAUSE_CANDIDATE_FILE: release } as Record<string, string>;
      const events: string[] = [];
      let baseline: string | null = null;
      let pending = false;
      let noPlan = false;
      let bytesEqualWhileHeld = false;
      const observer = (async () => {
        for (let i = 0; i < 8000 && !existsSync(specPath); i++) await Bun.sleep(2);
        baseline = existsSync(specPath) ? sha(specPath) : null;
        for (let i = 0; i < 8000 && !events.includes("contender:started"); i++) await Bun.sleep(2);
        await Bun.sleep(200);
        pending = events.includes("contender:started") && !events.includes("contender:exited");
        noPlan = !existsSync(planPath);
        if (planted) appendFileSync(specPath, " ");
        bytesEqualWhileHeld = baseline !== null && existsSync(specPath) && sha(specPath) === baseline;
        writeFileSync(release, "go\n");
      })();
      const result = await runCoordinator({ ...L, workers: [
        { id: "publisher", command: [process.execPath, graceBin, "spec", "new", "COORD", "--timestamp", "2026-09-27T19:13:02Z", "--branch", "feat/coordinator-boundary", "--path", L.project], cwd: repo, env, workspace: path.join(root, "workers", "publisher") },
        { id: "contender", command: [process.execPath, graceBin, "plan", "new", mint.id, "--path", L.project], cwd: repo, env: process.env as Record<string, string>, workspace: path.join(root, "workers", "contender"), startAfterPath: lockPath, startAfterTimeoutMs: 10000 },
      ] }, { timeoutMs: 20000, pollMs: 5, onWorkerStateChange: (e) => events.push(`${e.id}:${e.phase}`) });
      await observer;
      const bytesEqualAfter = baseline !== null && existsSync(specPath) && sha(specPath) === baseline;
      const bundleDirs = existsSync(activeDir) ? readdirSync(activeDir).filter((n) => n.startsWith("C-COORD-1-")) : [];
      const publisher = result.workers.find((w) => w.id === "publisher");
      const contender = result.workers.find((w) => w.id === "contender");
      const expectedBundle = existsSync(path.join(activeDir, mint.id)) && bundleDirs.length === 1 && bundleDirs[0] === mint.id;
      const expectedPublisherLog = path.join(root, "workers", "publisher", "stdout.log");
      const expectedContenderLog = path.join(root, "workers", "contender", "stdout.log");
      const out = { timedOut: result.timedOut, publisher: publisher?.exitCode, contender: contender?.exitCode, publisherLogOk: publisher?.stdoutLog === expectedPublisherLog && existsSync(expectedPublisherLog), contenderLogOk: contender?.stdoutLog === expectedContenderLog && existsSync(expectedContenderLog), pending, noPlan, bytesEqualWhileHeld, bytesEqualAfter, expectedBundle, planAfter: existsSync(planPath), markerAfter: existsSync(path.join(activeDir, mint.id, ".ngrace-mint-owner")), lockAfter: existsSync(lockPath) };
      rmSync(root, { recursive: true, force: true });
      return out;
    };
    const green = await run(false);
    expect(green.timedOut).toBe(false);
    expect(green.publisher).toBe(0);
    expect(typeof green.contender).toBe("number");
    expect(green.contender as number).not.toBe(0);
    expect(green.publisherLogOk).toBe(true);
    expect(green.contenderLogOk).toBe(true);
    expect(green.pending).toBe(true);
    expect(green.noPlan).toBe(true);
    expect(green.bytesEqualWhileHeld).toBe(true);
    expect(green.bytesEqualAfter).toBe(true);
    expect(green.expectedBundle).toBe(true);
    expect(green.planAfter).toBe(false);
    expect(green.markerAfter).toBe(false);
    expect(green.lockAfter).toBe(false);
    const red = await run(true);
    expect(red.bytesEqualWhileHeld).toBe(false);
    const restored = await run(false);
    expect(restored.bytesEqualWhileHeld).toBe(true);
  });
});
