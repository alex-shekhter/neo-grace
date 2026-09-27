#!/usr/bin/env bun
// START_MODULE_CONTRACT
//   PURPOSE: Direct-worker supervisor contract for deterministic concurrent CLI tests
//   SCOPE: Plan preflight, sibling worker spaces, staged direct launch, log draining, bounded reap
//   DEPENDS: none
//   LINKS: M-TEST-SUPPORT
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   CoordinatorIo
//   CoordinatorOptions
//   CoordinatorPlan
//   CoordinatorPlanError
//   CoordinatorResult
//   CoordinatorWorker
//   OutputSnapshot
//   WorkerOutcome
//   WorkerPhase
//   canonicalPath
//   runCoordinator
//   validateCoordinatorPlan
// END_MODULE_MAP
//
// Sibling layout: <root>/project (shared GRACE fixture), <root>/control (coordinator
// gates), <root>/workers/<id> (each direct worker's logs and outputs). One global
// deadline governs every phase. Fail-fast: preflight refuses before any spawn; an
// infrastructure failure (spawn, gate, output read, stream pump) stops scheduling
// immediately, bounded-kills and reaps every started direct worker, then propagates the
// original error composed with any cleanup failure. Each owner's declared outputs are
// snapshotted at that owner's exit, so an output-read failure interrupts supervision.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type CoordinatorWorker = {
  id: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  workspace: string;
  outputs?: string[];
  startAfterPath?: string;
  startAfterTimeoutMs?: number;
};

export type CoordinatorPlan = { root: string; project: string; control: string; workers: CoordinatorWorker[] };
export type WorkerPhase = "started" | "exited";
export type CoordinatorOptions = {
  timeoutMs: number;
  pollMs?: number;
  reapTimeoutMs?: number;
  onWorkerStateChange?: (event: { id: string; pid: number; phase: WorkerPhase; exitCode?: number | null }) => void;
};
export type CoordinatorIo = {
  spawn?: typeof Bun.spawn;
  kill?: (proc: ReturnType<typeof Bun.spawn>, signal: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type OutputSnapshot = { path: string; exists: boolean; bytes: number | null; sha256: string | null };
export type WorkerOutcome = {
  id: string;
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
  stdoutLog: string;
  stderrLog: string;
  outputs: OutputSnapshot[];
};
export type CoordinatorResult = { workers: WorkerOutcome[]; timedOut: boolean; elapsedMs: number };

export class CoordinatorPlanError extends Error {}

const RESERVED_LOG_NAMES = ["stdout.log", "stderr.log"];

/** Canonical path: resolve the deepest existing ancestor through symlinks, keep the tail. */
export function canonicalPath(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const real = existsSync(current) ? realpathSync(current) : current;
  return path.join(real, ...tail);
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(canonicalPath(parent), canonicalPath(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Pure preflight. Refuses before any workspace is created or process spawned. */
export function validateCoordinatorPlan(plan: CoordinatorPlan, options: CoordinatorOptions): void {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new CoordinatorPlanError(`global deadline must be finite and positive, got ${options.timeoutMs}`);
  }
  if (options.pollMs !== undefined && (!Number.isFinite(options.pollMs) || options.pollMs <= 0)) {
    throw new CoordinatorPlanError(`pollMs must be finite and positive, got ${options.pollMs}`);
  }
  if (options.reapTimeoutMs !== undefined && (!Number.isFinite(options.reapTimeoutMs) || options.reapTimeoutMs <= 0)) {
    throw new CoordinatorPlanError(`reapTimeoutMs must be finite and positive, got ${options.reapTimeoutMs}`);
  }
  for (const [label, dir] of [["root", plan.root], ["project", plan.project], ["control", plan.control]] as const) {
    if (!path.isAbsolute(dir)) throw new CoordinatorPlanError(`${label} must be an absolute path`);
  }
  const workspaces = plan.workers.map((w) => canonicalPath(w.workspace));
  const seenOutputs = new Map<string, string>();
  const seenOutputNames = new Map<string, string>();
  const seenIds = new Set<string>();
  for (const w of plan.workers) {
    if (w.id.trim() === "" || w.id === "." || w.id === ".." || w.id.includes("/") || w.id.includes("\\")) {
      throw new CoordinatorPlanError(`worker id ${JSON.stringify(w.id)} must be a nonempty single path segment`);
    }
    if (seenIds.has(w.id)) throw new CoordinatorPlanError(`duplicate worker id ${w.id}`);
    seenIds.add(w.id);
    const ws = canonicalPath(w.workspace);
    if (!inside(ws, plan.root)) throw new CoordinatorPlanError(`worker ${w.id} workspace must be under the root`);
    // project and control must be siblings of worker spaces, not nested inside one.
    if (inside(plan.project, ws) || inside(plan.control, ws)) {
      throw new CoordinatorPlanError(`worker ${w.id} workspace must not contain project/ or control/`);
    }
    if (inside(ws, plan.project) || inside(ws, plan.control)) {
      throw new CoordinatorPlanError(`worker ${w.id} workspace must not be nested inside project/ or control/`);
    }
    for (const o of w.outputs ?? []) {
      const co = canonicalPath(o);
      if (!inside(co, ws)) throw new CoordinatorPlanError(`worker ${w.id} output ${o} escapes its workspace`);
      if (RESERVED_LOG_NAMES.includes(path.basename(co))) {
        throw new CoordinatorPlanError(`worker ${w.id} output ${o} collides with a reserved log path`);
      }
      const prior = seenOutputs.get(co);
      if (prior !== undefined) throw new CoordinatorPlanError(`duplicate output ${o} declared by ${prior} and ${w.id}`);
      seenOutputs.set(co, w.id);
      const name = path.basename(co);
      const priorName = seenOutputNames.get(name);
      if (priorName !== undefined) throw new CoordinatorPlanError(`duplicate output name ${name} declared by ${priorName} and ${w.id}`);
      seenOutputNames.set(name, w.id);
    }
    if (w.startAfterPath !== undefined) {
      if (!path.isAbsolute(w.startAfterPath)) throw new CoordinatorPlanError(`worker ${w.id} startAfterPath must be absolute`);
      if (plan.workers.some((other) => inside(w.startAfterPath!, other.workspace))) {
        throw new CoordinatorPlanError(`worker ${w.id} startAfterPath must not be inside a worker workspace`);
      }
      if (!Number.isFinite(w.startAfterTimeoutMs) || (w.startAfterTimeoutMs ?? 0) <= 0) {
        throw new CoordinatorPlanError(`worker ${w.id} startAfterTimeoutMs must be finite and positive`);
      }
    }
  }
  for (let i = 0; i < workspaces.length; i++) {
    for (let j = i + 1; j < workspaces.length; j++) {
      if (inside(workspaces[i]!, workspaces[j]!) || inside(workspaces[j]!, workspaces[i]!)) {
        throw new CoordinatorPlanError(`worker workspaces overlap: ${plan.workers[i]!.id} and ${plan.workers[j]!.id}`);
      }
    }
  }
  // Canonical sibling ownership: project/ and control/ are distinct direct children of the
  // root, and each workers/<id>/ is the canonical path for its own id. These run after the
  // specific containment and overlap refusals so those reasons are never masked.
  const canonicalProject = canonicalPath(plan.project);
  const canonicalControl = canonicalPath(plan.control);
  if (canonicalProject === canonicalControl) {
    throw new CoordinatorPlanError("project and control must be canonically distinct sibling directories");
  }
  if (canonicalProject !== canonicalPath(path.join(plan.root, "project"))) {
    throw new CoordinatorPlanError("project must be the canonical sibling root/project directory");
  }
  if (canonicalControl !== canonicalPath(path.join(plan.root, "control"))) {
    throw new CoordinatorPlanError("control must be the canonical sibling root/control directory");
  }
  for (let i = 0; i < plan.workers.length; i++) {
    if (workspaces[i] !== canonicalPath(path.join(plan.root, "workers", plan.workers[i]!.id))) {
      throw new CoordinatorPlanError(`worker ${plan.workers[i]!.id} workspace must be the canonical sibling root/workers/${plan.workers[i]!.id} directory`);
    }
  }
}

function snapshotOutput(file: string): OutputSnapshot {
  if (!existsSync(file)) return { path: file, exists: false, bytes: null, sha256: null };
  const buf = readFileSync(file); // an unreadable present file is an infrastructure failure
  return { path: file, exists: true, bytes: buf.byteLength, sha256: createHash("sha256").update(buf).digest("hex") };
}

async function pump(stream: ReadableStream<Uint8Array>, file: string): Promise<void> {
  const writer = Bun.file(file).writer();
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
    }
  } finally {
    writer.end();
  }
}

export async function runCoordinator(
  plan: CoordinatorPlan,
  options: CoordinatorOptions,
  io: CoordinatorIo = {},
): Promise<CoordinatorResult> {
  validateCoordinatorPlan(plan, options);
  const sleep = io.sleep ?? ((ms: number) => Bun.sleep(ms));
  const spawn = io.spawn ?? Bun.spawn;
  const kill = io.kill ?? ((proc, signal) => proc.kill(signal as never));
  const reapTimeoutMs = options.reapTimeoutMs ?? 2000;
  const pollMs = options.pollMs ?? 10;
  const start = Date.now();
  const globalDeadline = start + options.timeoutMs;

  type Started = { spec: CoordinatorWorker; proc: ReturnType<typeof Bun.spawn>; stdoutLog: string; stderrLog: string; pumps: Promise<void>[] };
  const started: Started[] = [];
  const finishedIds = new Set<string>();
  const outputsById = new Map<string, OutputSnapshot[]>();
  let infrastructureFailure: Error | null = null;
  let signalInfrastructureFailure: () => void = () => {};
  const infrastructureFailed = new Promise<void>((resolve) => { signalInfrastructureFailure = resolve; });

  const boundedKillAndReap = async (): Promise<string[]> => {
    const unreaped: string[] = [];
    for (const s of started) {
      if (finishedIds.has(s.spec.id)) continue;
      try {
        kill(s.proc, "SIGKILL");
      } catch {
        // fall through to the bounded reap; the PID is reported if it never reaps
      }
      const ok = await Promise.race([s.proc.exited.then(() => true), sleep(reapTimeoutMs).then(() => false)]);
      if (!ok) unreaped.push(`worker ${s.spec.id} pid ${s.proc.pid}`);
    }
    return unreaped;
  };

  const spawnWorker = (spec: CoordinatorWorker): void => {
    mkdirSync(spec.workspace, { recursive: true });
    const stdoutLog = path.join(spec.workspace, "stdout.log");
    const stderrLog = path.join(spec.workspace, "stderr.log");
    const proc = spawn({
      cmd: spec.command,
      cwd: spec.cwd,
      env: spec.env as Record<string, string> | undefined,
      stdout: "pipe",
      stderr: "pipe",
    });
    const record = { spec, proc, stdoutLog, stderrLog, pumps: [pump(proc.stdout as ReadableStream<Uint8Array>, stdoutLog), pump(proc.stderr as ReadableStream<Uint8Array>, stderrLog)] };
    started.push(record);
    for (const p of record.pumps) p.catch((error) => { infrastructureFailure = error as Error; signalInfrastructureFailure(); });
    options.onWorkerStateChange?.({ id: spec.id, pid: proc.pid, phase: "started" });
    // Snapshot this owner's declared outputs at its own exit, never before. A read
    // failure here is an infrastructure failure that interrupts supervision.
    void proc.exited.then(() => {
      finishedIds.add(spec.id);
      try {
        outputsById.set(spec.id, (spec.outputs ?? []).map(snapshotOutput));
      } catch (error) {
        infrastructureFailure = error as Error;
        signalInfrastructureFailure();
      }
      options.onWorkerStateChange?.({ id: spec.id, pid: proc.pid, phase: "exited", exitCode: proc.exitCode });
    });
  };

  const finish = async (deadlineReached: boolean): Promise<CoordinatorResult> => {
    const running = () => started.filter((s) => !finishedIds.has(s.spec.id));
    // Ordinary deadline path: kill survivors, bounded reap, explicit unreaped-PID failure.
    const survivors = running();
    const unreaped = survivors.length > 0 ? await boundedKillAndReap() : [];
    if (unreaped.length > 0) throw new Error(`${deadlineReached ? "global deadline" : "deadline"} reap incomplete: ${unreaped.join("; ")}`);
    await Promise.all(started.map((s) => s.proc.exited));
    await Promise.all(started.flatMap((s) => s.pumps));
    return {
      workers: started.map((s) => ({
        id: s.spec.id,
        exitCode: s.proc.exitCode,
        signalCode: s.proc.signalCode,
        timedOut: survivors.includes(s),
        stdoutLog: s.stdoutLog,
        stderrLog: s.stderrLog,
        outputs: outputsById.get(s.spec.id) ?? (s.spec.outputs ?? []).map(snapshotOutput),
      })),
      timedOut: survivors.length > 0 || deadlineReached,
      elapsedMs: Date.now() - start,
    };
  };

  try {
    // Staged launch, bounded by the global deadline as well as each gate timeout.
    let launchExpired = false;
    for (const spec of plan.workers) {
      if (infrastructureFailure) throw infrastructureFailure;
      if (Date.now() >= globalDeadline) { launchExpired = true; break; }
      if (spec.startAfterPath !== undefined) {
        const gateBound = Math.min(globalDeadline, Date.now() + (spec.startAfterTimeoutMs ?? 0));
        // A stream-pump or output-read fault interrupts the gate wait too.
        while (!existsSync(spec.startAfterPath) && Date.now() < gateBound) {
          if (infrastructureFailure) throw infrastructureFailure;
          const remaining = Math.min(gateBound, globalDeadline) - Date.now();
          await Promise.race([sleep(Math.max(1, Math.min(pollMs, remaining))), infrastructureFailed]);
        }
        if (infrastructureFailure) throw infrastructureFailure;
        if (!existsSync(spec.startAfterPath)) {
          if (Date.now() >= globalDeadline) { launchExpired = true; break; }
          throw new Error(`worker ${spec.id} start gate did not appear within ${spec.startAfterTimeoutMs}ms`);
        }
      }
      spawnWorker(spec);
      if (infrastructureFailure) throw infrastructureFailure;
    }

    // Monitor: wait on process completion, woken early by an infrastructure fault or the poll interval.
    let deadlineReached = false;
    while (finishedIds.size < started.length) {
      if (infrastructureFailure) throw infrastructureFailure;
      if (Date.now() >= globalDeadline) { deadlineReached = true; break; }
      const remaining = globalDeadline - Date.now();
      await Promise.race([sleep(Math.max(1, Math.min(pollMs, remaining))), infrastructureFailed]);
    }
    if (infrastructureFailure) throw infrastructureFailure;
    return await finish(launchExpired || deadlineReached);
  } catch (error) {
    const unreaped = await boundedKillAndReap();
    const primary = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (unreaped.length > 0) throw new Error(`${primary}; cleanup failure: ${unreaped.join("; ")}`);
    throw new Error(`${primary}; all started direct workers terminated and reaped`);
  }
}
