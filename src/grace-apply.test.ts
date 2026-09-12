import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { renameSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";

import { ARTIFACT_DIR } from "./artifact/paths";
import { parseGraceXmlArtifact } from "./artifact/xml";
import { validateRunLedgerArtifact } from "./artifact/grammar";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "./artifact/test-fixtures";
import { recordGateDecision } from "./gates/ledger";
import type { DecisionGateId } from "./gates/ledger";
import type { evaluateGate } from "./gates/core";
import { GraceCommandError } from "./query/errors";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const GRACE_BIN = path.join(REPO_ROOT, "src/grace.ts");
const tempRoots: string[] = [];

function tempProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-apply-"));
  tempRoots.push(root);
  writeMinimalNgraceProject(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

function writeText(filePath: string, text: string): void {
  // Test-only writer; production writes for this verb live in gates/ledger.ts.
  writeFileSync(filePath, text);
}

function runApplyCli(args: string[]) {
  return spawnSync("bun", ["run", GRACE_BIN, "apply", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
}

function combinedOutput(result: ReturnType<typeof runApplyCli>): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function permit(gate: "apply" | "archive") {
  return {
    gate,
    decision: "permit" as const,
    requirements: [{ id: "probe", required: true, present: true, blocking: false }],
  };
}

function writePermits(root: string, changeId: string, gates: Array<"apply" | "archive">): void {
  for (const gate of gates) {
    recordGateDecision(root, changeId, permit(gate));
  }
}

function bundlePaths(root: string, changeId: string) {
  const active = path.join(root, ARTIFACT_DIR, "changes", "active", changeId);
  return {
    active,
    archive: path.join(root, ARTIFACT_DIR, "changes", "archive", changeId),
    spec: path.join(active, "spec.xml"),
    plan: path.join(active, "plan.xml"),
  };
}

describe("C-APPLY-VERB T-001", () => {
  it("pack-allowlist: PACK_ALLOWED_EXACT contains src/grace-apply.ts", () => {
    // Read the set literal from the release-check source bytes, not from
    // package.json files: the shipped allowlist is the normative surface.
    const source = readFileSync(
      path.resolve(import.meta.dir, "../scripts/release-check.ts"),
      "utf8",
    );
    const setStart = source.indexOf("const PACK_ALLOWED_EXACT = new Set([");
    expect(setStart).toBeGreaterThan(-1);
    const setEnd = source.indexOf("]);", setStart);
    expect(setEnd).toBeGreaterThan(setStart);
    const literal = source.slice(setStart, setEnd);
    expect(literal).toContain('"src/grace-apply.ts"');
  });
});
describe("C-APPLY-VERB T-002", () => {
  it("preconditions: the command delegates every read and write; no second status parser", () => {
    const source = readFileSync(path.resolve(import.meta.dir, "./grace-apply.ts"), "utf8");
    expect(source).not.toContain("rootStatusFromOpeningTag");
    expect(source).not.toContain("readFileSync");
    expect(source).not.toContain("existsSync");
    expect(source).not.toContain("writeFileSync");
    expect(source).not.toContain("mkdirSync");
    expect(source).not.toContain("unlinkSync");
    expect(source).not.toContain("rmSync");
    expect(source).not.toContain("hasPermittingDecision");
    expect(source).not.toMatch(/\bgit\b/);
    expect(source).toContain("validateApplyChangeBundle");
    expect(source).toContain("applyChangeBundle");
  });

  it("preconditions: a missing apply permit refuses naming apply and writes nothing", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toMatch(/apply permit/i);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.archive)).toBe(false);
  });

  it("preconditions: a missing archive permit refuses naming archive and writes nothing", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toMatch(/archive permit/i);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.archive)).toBe(false);
  });

  it("preconditions: an existing archive destination refuses naming already exists", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "archive",
      specStatus: "draft",
      planStatus: "draft",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toMatch(/already exists/i);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
  });
});

describe("C-APPLY-VERB T-002 plan-required", () => {
  it("plan-required: a spec-only active bundle is refused naming plan.xml and is not moved", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toMatch(/plan\.xml/i);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.archive)).toBe(false);
  });
});

describe("C-APPLY-VERB T-002 record-false", () => {
  it("record-false: validates and prints without writing status, Decision, or a move", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root, "--record=false"]);
    // Write isolation: bytes and location unchanged.
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.archive)).toBe(false);
    // Validation runs and prints a confirmation instead of throwing.
    expect(result.status).toBe(0);
    expect(combinedOutput(result)).toMatch(/no writes|dry-run|record=false/i);
  });
});

describe("C-APPLY-VERB T-003", () => {
  it("surgical-write: the applied write swaps only the root status attribute on both artifacts", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    // Single-quoted plan status: the surgical write must preserve the quote.
    const planPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-APPLYME", "plan.xml");
    const planApproved = readFileSync(planPath, "utf8");
    writeText(planPath, planApproved.replace('status="approved"', "status='approved'"));
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).toBe(0);
    // The close moved the bundle; the applied bytes are read from the archive.
    const archiveSpec = path.join(paths.archive, "spec.xml");
    const archivePlan = path.join(paths.archive, "plan.xml");
    const specAfter = readFileSync(archiveSpec, "utf8");
    const planAfter = readFileSync(archivePlan, "utf8");
    // First assertion: the status attribute value is applied (read the file even if exit is nonzero).
    expect(specAfter).toMatch(/<NgraceChangeSpec graceVersion="1.0" status="applied">/);
    // Byte-surgical: the rest of the spec is byte-identical to the pre-write bytes.
    expect(specAfter).toBe(specBefore.replace('status="approved"', 'status="applied"'));
    // Single-quoted plan keeps its quote character.
    expect(planAfter).toMatch(/status='applied'/);
    expect(planAfter).toBe(planApproved.replace('status="approved"', "status='applied'"));
  });
});

describe("C-APPLY-VERB T-003 atomic-move", () => {
  it("atomic-move: a successful invocation renames the bundle from active/ to archive/", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
      designContext: "<NgraceChangeDesignContext graceVersion=\"1.0\"><Change>C-APPLYME</Change></NgraceChangeDesignContext>",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).toBe(0);
    // First assertion: the directory location (active vs archive).
    expect(existsSync(paths.archive)).toBe(true);
    expect(existsSync(paths.active)).toBe(false);
    // Companions move with the directory.
    expect(existsSync(path.join(paths.archive, "design-context.xml"))).toBe(true);
    expect(existsSync(path.join(paths.archive, "run-ledger.xml"))).toBe(true);
  });

  it("atomic-move: on plan-write failure spec bytes under active/ match pre-write and dest does not exist", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");
    chmodSync(paths.plan, 0o444);
    try {
      const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
      expect(result.status).not.toBe(0);
      expect(existsSync(paths.active)).toBe(true);
      expect(existsSync(paths.archive)).toBe(false);
      expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    } finally {
      chmodSync(paths.plan, 0o644);
    }
  });

  it("atomic-move: EXDEV on the rename is refused after rollback", async () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");
    const planBefore = readFileSync(paths.plan, "utf8");
    const ledger = await import("./gates/ledger");
    const writer = (ledger as unknown as Record<string, unknown>).applyChangeBundle as
      | ((projectRoot: string, changeId: string, options?: { io?: { renameSync?: typeof renameSync } }) => unknown)
      | undefined;
    const exdev = Object.assign(new Error("cross-device"), { code: "EXDEV" });
    expect(writer).toBeDefined();
    try {
      writer!(root, "C-APPLYME", { io: { renameSync: () => { throw exdev; } } });
      expect.unreachable("expected EXDEV refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(GraceCommandError);
      expect((error as Error).message).toMatch(/EXDEV/);
    }
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.archive)).toBe(false);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(readFileSync(paths.plan, "utf8")).toBe(planBefore);
    expect(specBefore).toMatch(/status="approved"/);
    expect(planBefore).toMatch(/status="approved"/);
    const ledgerAfter = readFileSync(path.join(paths.active, "run-ledger.xml"), "utf8");
    const appliedDecisions = [...ledgerAfter.matchAll(/<Decision\b([^>]*)>/g)]
      .map((match) => match[1])
      .filter((attrs) => attrs.includes('gate="applied"'));
    expect(appliedDecisions).toHaveLength(0);
  });

  it("atomic-move: resume of applied-under-active skips matching status writes and does the rename", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    const paths = bundlePaths(root, "C-APPLYME");
    // Hand-place the applied bytes: the resume skips matching status writes.
    const specApplied = readFileSync(paths.spec, "utf8").replace('status="approved"', 'status="applied"');
    const planApplied = readFileSync(paths.plan, "utf8").replace('status="approved"', 'status="applied"');
    writeText(paths.spec, specApplied);
    writeText(paths.plan, planApplied);
    writePermits(root, "C-APPLYME", ["apply", "archive"]);

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).toBe(0);
    expect(existsSync(paths.archive)).toBe(true);
    expect(existsSync(paths.active)).toBe(false);
    expect(readFileSync(path.join(paths.archive, "spec.xml"), "utf8")).toBe(specApplied);
    expect(readFileSync(path.join(paths.archive, "plan.xml"), "utf8")).toBe(planApplied);
  });

  it("atomic-move: a bundle already under archive/ and not under active/ refuses", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "archive",
      specStatus: "applied",
      planStatus: "applied",
    });
    const paths = bundlePaths(root, "C-APPLYME");
    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(existsSync(paths.archive)).toBe(true);
  });
});

describe("C-APPLY-VERB T-003 fingerprint-record", () => {
  it("fingerprint-record: two gate-applied Decisions, spec then plan, each fingerprinting its applied bytes", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).toBe(0);
    const ledger = readFileSync(path.join(paths.archive, "run-ledger.xml"), "utf8");
    const decisions = [...ledger.matchAll(/<Decision\b([^>]*)>/g)].map((match) => match[1]);
    const appliedDecisions = decisions.filter((attrs) => attrs.includes('gate="applied"'));
    expect(appliedDecisions.length).toBe(2);
    // Document order: artifact spec then artifact plan.
    expect(appliedDecisions[0]).toContain('artifact="spec"');
    expect(appliedDecisions[1]).toContain('artifact="plan"');
    // decision permit, fingerprint = SHA-256 lowercase hex of the applied file bytes.
    for (const [index, artifactPath] of [[0, path.join(paths.archive, "spec.xml")], [1, path.join(paths.archive, "plan.xml")]] as const) {
      expect(appliedDecisions[index]).toContain('decision="permit"');
      const expected = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
      expect(appliedDecisions[index]).toContain(`fingerprint="${expected}"`);
    }
    // Per-artifact, not one combined digest.
    expect(appliedDecisions[0]).not.toBe(appliedDecisions[1]);
  });

  it("fingerprint-record: a Decision with gate applied and no non-Requirement child emits 0 ledger.invalid-decision", async () => {
    const { validateRunLedgerArtifact } = await import("./artifact/grammar");
    const parsed = parseGraceXmlArtifact(
      "run-ledger.xml",
      `<NgraceRunLedger graceVersion="1.0"><C-APPLYME><Decisions><Decision gate="applied" decision="permit"/></Decisions></C-APPLYME></NgraceRunLedger>`,
    );
    const issues = validateRunLedgerArtifact(parsed);
    expect(issues.issues.filter((issue) => issue.code === "ledger.invalid-decision")).toEqual([]);
  });

  it("fingerprint-record: applied is a DecisionGateId; evaluateGate still refuses it (typecheck)", () => {
    // Type-only imports are erased at runtime; this case is decided by bun run
    // typecheck. It exists so the assignability contract is pinned in the file
    // that ships the writer: applied is a DecisionGateId, and evaluateGate's
    // parameter stays GateId.
    const gate: DecisionGateId = "applied";
    expect(gate).toBe("applied");
    // @ts-expect-error applied never reaches evaluateGate (AC-GATE-PURITY)
    const rejected: Parameters<typeof evaluateGate>[2] = gate;
    expect(typeof rejected).toBe("string");
  });
});

describe("C-APPLY-VERB T-004", () => {
  it("force-hatch: force with a reason writes applied and records forced true plus that reason on both write Decisions", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    // No permits planted: force is the sanctioned bypass for exactly this hole.
    const paths = bundlePaths(root, "C-APPLYME");

    const result = runApplyCli([
      "--change", "C-APPLYME",
      "--path", root,
      "--force=true",
      "--reason", "operator override after refused gate",
    ]);
    expect(result.status).toBe(0);
    expect(existsSync(paths.archive)).toBe(true);
    expect(existsSync(paths.active)).toBe(false);
    const ledger = readFileSync(path.join(paths.archive, "run-ledger.xml"), "utf8");
    const appliedDecisions = [...ledger.matchAll(/<Decision\b([^>]*)>/g)]
      .map((match) => match[1])
      .filter((attrs) => attrs.includes('gate="applied"'));
    expect(appliedDecisions.length).toBe(2);
    for (const attrs of appliedDecisions) {
      expect(attrs).toContain('forced="true"');
      expect(attrs).toContain('reason="operator override after refused gate"');
      expect(attrs).toMatch(/fingerprint="[0-9a-f]{64}"/);
    }
  });

  it("force-hatch: force without a non-empty reason writes nothing and exits nonzero", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root, "--force=true"]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toMatch(/reason/i);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.archive)).toBe(false);
  });

  it("force-hatch: a ratified permit omits the forced attribute (never forced=false)", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "approved",
      planStatus: "approved",
    });
    writePermits(root, "C-APPLYME", ["apply", "archive"]);
    const paths = bundlePaths(root, "C-APPLYME");

    const result = runApplyCli(["--change", "C-APPLYME", "--path", root]);
    expect(result.status).toBe(0);
    const ledger = readFileSync(path.join(paths.archive, "run-ledger.xml"), "utf8");
    const appliedDecisions = [...ledger.matchAll(/<Decision\b([^>]*)>/g)]
      .map((match) => match[1])
      .filter((attrs) => attrs.includes('gate="applied"'));
    expect(appliedDecisions.length).toBe(2);
    for (const attrs of appliedDecisions) {
      expect(attrs).not.toContain("forced");
      expect(attrs).not.toContain('forced="false"');
      expect(attrs).not.toContain("reason=");
    }
  });

  it("force-hatch: force does not write applied onto draft and does not overwrite an existing dest", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-APPLYME",
      location: "archive",
      specStatus: "applied",
      planStatus: "applied",
    });
    const paths = bundlePaths(root, "C-APPLYME");
    const specBefore = readFileSync(paths.spec, "utf8");

    const result = runApplyCli([
      "--change", "C-APPLYME",
      "--path", root,
      "--force=true",
      "--reason", "operator override attempt",
    ]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(paths.spec, "utf8")).toBe(specBefore);
    expect(existsSync(paths.active)).toBe(true);
  });
});
