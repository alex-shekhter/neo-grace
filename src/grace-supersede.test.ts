import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ARTIFACT_DIR } from "./artifact/paths";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "./artifact/test-fixtures";
import { advanceCursor, expectedLedgerEventAttributes, listLedgerEvents, listLooseEvents } from "./grace-cursor";
import type { GraceXmlNode } from "./artifact/xml";
import { mintResolvedBundle, resolveSpecMint, setCandidateCleanupObserverForTests, type ResolvedSpecMint } from "./grace-generate";
import { readAmendmentInstrument, supersedeChangeBundle } from "./gates/ledger";
import { GraceCommandError } from "./query/errors";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const GRACE_BIN = path.join(REPO_ROOT, "src/grace.ts");
const tempRoots: string[] = [];

function tempProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-supersede-"));
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

function runSupersedeCli(args: string[]) {
  return spawnSync("bun", ["run", GRACE_BIN, "supersede", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
}

function combinedOutput(result: ReturnType<typeof runSupersedeCli>): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function runCursorAdvanceCli(args: string[]) {
  return spawnSync("bun", ["run", GRACE_BIN, "cursor", "advance", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
}

/**
 * Deterministic, byte-complete recursive path/type/SHA-256 snapshot of a directory
 * tree; "" when absent. Shared by every validate-before-fold refusal row so the
 * invariance claim covers `spec.xml`, `plan.xml`, `run/`, and `run-ledger.xml`.
 */
function recursiveSnapshot(dir: string): string {
  if (!existsSync(dir)) return "";
  const lines: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(path.join(abs, name), rel ? `${rel}/${name}` : name);
      return;
    }
    lines.push(`${rel}\tfile\t${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
  };
  walk(dir, "");
  return lines.sort().join("\n");
}

describe("C-SUPERSEDE-COMMAND T-002", () => {
  it("pack-allowlist: PACK_ALLOWED_EXACT contains src/grace-supersede.ts", () => {
    const source = readFileSync(path.resolve(import.meta.dir, "../scripts/release-check.ts"), "utf8");
    const block = source.match(/const PACK_ALLOWED_EXACT = new Set\(\[([\s\S]*?)\]\)/);
    expect(block).not.toBeNull();
    const members = [...block![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(members).toContain("src/grace-supersede.ts");
  });
});

describe("C-SUPERSEDE-COMMAND T-003", () => {
  it("require-replacement: missing replacement directory names that absence", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const specPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    const specBefore = readFileSync(specPath, "utf8");

    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    expect(combinedOutput(result)).toMatch(/missing as a directory/);
    expect(result.status).not.toBe(0);
    expect(readFileSync(specPath, "utf8")).toBe(specBefore);
  });

  it("require-replacement: self-replacement refuses and writes nothing", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const specPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    const specBefore = readFileSync(specPath, "utf8");

    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(specPath, "utf8")).toBe(specBefore);
  });

  it("require-replacement: malformed replacement id refuses and writes nothing", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const specPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    const specBefore = readFileSync(specPath, "utf8");

    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "not-a-change", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(specPath, "utf8")).toBe(specBefore);
  });
});

function changeArtifactPath(root: string, changeId: string, fileName: string): string | undefined {
  for (const location of ["active", "archive"] as const) {
    const filePath = path.join(root, ARTIFACT_DIR, "changes", location, changeId, fileName);
    if (existsSync(filePath)) return filePath;
  }
  return undefined;
}

describe("C-SUPERSEDE-COMMAND T-004", () => {
  it("shape-replacement: inserts a Replacement element and does not write the other shapes", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    const specAfter = readFileSync(changeArtifactPath(root, "C-OLD", "spec.xml")!, "utf8");
    expect(specAfter).toContain("<Replacement>");
    expect(specAfter).toContain("<Replacement>C-OLD-2</Replacement>");
    expect(specAfter).not.toContain("<ReplacementChange>");
    expect(specAfter).not.toMatch(/<C-OLD-2[\s/>]/);

    const named = tempProject();
    writeChangeBundleFixture(named, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(named, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const namedSpec = path.join(named, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    writeFileSync(
      namedSpec,
      readFileSync(namedSpec, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-OLD-2</Replacement>"),
    );
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", named]);
    const namedAfter = readFileSync(changeArtifactPath(named, "C-OLD", "spec.xml")!, "utf8");
    expect((namedAfter.match(/<Replacement>/g) ?? []).length).toBe(1);
  });

  it("move-and-rollback: bundle directory moves from active to archive", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD");
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    expect(existsSync(archiveDir)).toBe(true);
    expect(existsSync(activeDir)).toBe(false);
  });

  it("move-and-rollback: spec-only source moves without inventing a plan", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const specOnly = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    expect(specOnly.status).toBe(0);
    expect(combinedOutput(specOnly)).not.toMatch(/No loose run\/ events to fold/);
    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD");
    expect(existsSync(archiveDir)).toBe(true);
    expect(existsSync(path.join(archiveDir, "plan.xml"))).toBe(false);
  });

  it("move-and-rollback: open epoch still moves", () => {
    const reserved =
      'kind "discarded" is reserved; ngrace supersede writes it when abandoning an open epoch.';
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const bundle = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    advanceCursor(root, "C-OLD", { task: "T-001", openEpoch: true });
    const beforeRun = readdirSync(path.join(bundle, "run")).sort();

    let caught: unknown;
    try {
      advanceCursor(root, "C-OLD", { task: "T-001", kind: "discarded" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    expect((caught as GraceCommandError).code).toBe("invalid-arguments");
    expect((caught as GraceCommandError).message).toBe(reserved);
    expect(readdirSync(path.join(bundle, "run")).sort()).toEqual(beforeRun);

    const cliRefuse = runCursorAdvanceCli([
      "--change",
      "C-OLD",
      "--task",
      "T-001",
      "--kind",
      "discarded",
      "--path",
      root,
    ]);
    expect(cliRefuse.status).not.toBe(0);
    expect(combinedOutput(cliRefuse)).toContain(reserved);
    expect(readdirSync(path.join(bundle, "run")).sort()).toEqual(beforeRun);

    const cursorSrc = readFileSync(path.resolve(import.meta.dir, "./grace-cursor.ts"), "utf8");
    const advanceStart = cursorSrc.indexOf("advance: defineCommand({");
    const attemptStart = cursorSrc.indexOf("attempt: defineCommand({", advanceStart);
    expect(advanceStart).toBeGreaterThanOrEqual(0);
    expect(attemptStart).toBeGreaterThan(advanceStart);
    expect(cursorSrc.slice(advanceStart, attemptStart)).not.toContain("discarded");

    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(ARTIFACT_DIR, "changes", "archive", "C-OLD").replaceAll(path.sep, "/"));
    expect(combinedOutput(result)).not.toMatch(/\bFold\b/i);

    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD");
    expect(existsSync(archiveDir)).toBe(true);
    const ledger = readFileSync(path.join(archiveDir, "run-ledger.xml"), "utf8");
    expect(ledger).toMatch(/<Epoch-1\b/);
    expect(ledger).toContain('kind="opened"');
    expect(ledger).toContain('kind="discarded"');
    expect(ledger).not.toContain('kind="terminal"');
    expect(listLooseEvents(archiveDir)).toHaveLength(0);
  });

  it("ordinary cursor fold still refuses an unterminated range on the real CLI", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    advanceCursor(root, "C-OLD", { task: "T-001", openEpoch: true });
    advanceCursor(root, "C-OLD", { task: "T-001", kind: "progress" });
    const fold = spawnSync("bun", ["run", GRACE_BIN, "cursor", "fold", "--change", "C-OLD", "--path", root], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: process.env,
    });
    expect(fold.status).not.toBe(0);
    expect(`${fold.stdout ?? ""}${fold.stderr ?? ""}`).toMatch(/unterminated range/);
  });

  it("move-and-rollback: a bundle already under archive/ and not under active/ refuses", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "archive",
      specStatus: "superseded",
      planStatus: "superseded",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const archivedSpec = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "spec.xml");
    writeFileSync(
      archivedSpec,
      readFileSync(archivedSpec, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-OLD-2</Replacement>"),
    );
    const archivedPlan = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "plan.xml");
    writeFileSync(
      archivedPlan,
      readFileSync(archivedPlan, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-OLD-2</Replacement>"),
    );
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    expect(combinedOutput(result)).toMatch(/already under archive\/ and not under active\//i);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD"))).toBe(true);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD"))).toBe(false);
  });

  it("move-and-rollback: matching superseded-in-active resume only renames", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "superseded",
      planStatus: "superseded",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const specPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    const planPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "plan.xml");
    writeFileSync(
      specPath,
      readFileSync(specPath, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-OLD-2</Replacement>"),
    );
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-OLD-2</Replacement>"),
    );
    const specBefore = readFileSync(specPath, "utf8");
    const planBefore = readFileSync(planPath, "utf8");
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    expect(result.status).toBe(0);
    const archivedSpec = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "spec.xml");
    const archivedPlan = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "plan.xml");
    expect(readFileSync(archivedSpec, "utf8")).toBe(specBefore);
    expect(readFileSync(archivedPlan, "utf8")).toBe(planBefore);
  });

  it("move-and-rollback: plan write failure restores spec under active", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    const specPath = path.join(activeDir, "spec.xml");
    const planPath = path.join(activeDir, "plan.xml");
    const specBefore = readFileSync(specPath, "utf8");
    chmodSync(planPath, 0o444);
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root]);
    chmodSync(planPath, 0o644);
    expect(result.status).not.toBe(0);
    expect(existsSync(activeDir)).toBe(true);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD"))).toBe(false);
    expect(readFileSync(specPath, "utf8")).toBe(specBefore);
  });

  it("move-and-rollback: EXDEV is refused after rollback", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-OLD-2",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    const specPath = path.join(activeDir, "spec.xml");
    const specBefore = readFileSync(specPath, "utf8");
    const exdev = Object.assign(new Error("cross-device"), { code: "EXDEV" });
    expect(() =>
      supersedeChangeBundle(root, "C-OLD", { kind: "explicit", id: "C-OLD-2" }, {
        renameSync: () => {
          throw exdev;
        },
      }),
    ).toThrow(GraceCommandError);
    try {
      supersedeChangeBundle(root, "C-OLD", { kind: "explicit", id: "C-OLD-2" }, {
        renameSync: () => {
          throw exdev;
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(GraceCommandError);
      expect((error as Error).message).toMatch(/EXDEV/);
    }
    expect(existsSync(activeDir)).toBe(true);
    expect(readFileSync(specPath, "utf8")).toBe(specBefore);
  });
});




describe("C-HASHED-BUNDLE-IDS-2 lineage successor", () => {
  it("accepts a lineage successor replacement", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-OLD", location: "active", specStatus: "draft", planStatus: "draft" });
    writeChangeBundleFixture(root, { changeId: "C-OLD-2-ABCDEF12", location: "active", specStatus: "draft", planStatus: "draft" });
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-2-ABCDEF12", "--path", root]);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "spec.xml"))).toBe(true);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD-2-ABCDEF12", "spec.xml"))).toBe(true);
  });

  it("refuses a wrong-lineage successor", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-OLD", location: "active", specStatus: "draft", planStatus: "draft" });
    writeChangeBundleFixture(root, { changeId: "C-OLD-3-ABCDEF12", location: "active", specStatus: "draft", planStatus: "draft" });
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OLD-3-ABCDEF12", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toContain("lineage successor");
  });

  it("refuses a wrong-slug replacement", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-OLD", location: "active", specStatus: "draft", planStatus: "draft" });
    writeChangeBundleFixture(root, { changeId: "C-OTHER-2-ABCDEF12", location: "active", specStatus: "draft", planStatus: "draft" });
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-OTHER-2-ABCDEF12", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toContain("lineage successor");
  });

  it("mints the lineage successor itself when --replacement is omitted", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-OLD", location: "active", specStatus: "draft", planStatus: "draft" });
    const result = runSupersedeCli(["--change", "C-OLD", "--timestamp", "2026-09-14T03:00:00Z", "--branch", "b", "--path", root]);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "spec.xml"))).toBe(true);
    const active = readdirSync(path.join(root, ARTIFACT_DIR, "changes", "active")).filter((name) => /^C-OLD-2-[0-9A-F]{8}$/.test(name));
    expect(active).toHaveLength(1);
  });

  it("derives the successor from a legacy hash-less predecessor", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-LEGACY-2", location: "active", specStatus: "draft", planStatus: "draft" });
    const result = runSupersedeCli(["--change", "C-LEGACY-2", "--timestamp", "2026-09-14T03:00:00Z", "--branch", "b", "--path", root]);
    expect(result.status).toBe(0);
    const active = readdirSync(path.join(root, ARTIFACT_DIR, "changes", "active")).filter((name) => /^C-LEGACY-3-[0-9A-F]{8}$/.test(name));
    expect(active).toHaveLength(1);
  });
});

// C-SUPERSEDE-MEMBERSHIP-1-7D8B2BE8 T-003: transaction ownership and post-mint cleanup.
describe("supersede transaction cleanup", () => {
  it("removes a minted successor when the governance write fails", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-MINTFAIL",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const resolved: ResolvedSpecMint = {
      id: "C-MINTFAIL-2-ABCDEF12",
      slug: "MINTFAIL",
      lineage: 2,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active");
    const before = readdirSync(activeDir).sort();
    let writes = 0;
    expect(() =>
      supersedeChangeBundle(
        root,
        "C-MINTFAIL",
        {
          kind: "mint",
          id: resolved.id,
          mint: () => mintResolvedBundle(root, resolved).acquired,
        },
        {
          writeFileSync: ((...args: Parameters<typeof writeFileSync>) => {
            writes += 1;
            if (writes === 1) throw new Error("injected governance write failure");
            return writeFileSync(...args);
          }) as typeof writeFileSync,
        },
      ),
    ).toThrow(/injected governance write failure/);
    expect(readdirSync(activeDir).sort()).toEqual(before);
    expect(existsSync(path.join(activeDir, "C-MINTFAIL-2-ABCDEF12"))).toBe(false);
  });

  it("refuses a replacement whose lineage is invalid under the locks", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-LIN", location: "active", specStatus: "draft" });
    writeChangeBundleFixture(root, { changeId: "C-OTHER-2", location: "active", specStatus: "draft" });
    expect(() =>
      supersedeChangeBundle(root, "C-LIN", { kind: "explicit", id: "C-OTHER-2" }),
    ).toThrow(/lineage successor/i);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "active", "C-LIN"))).toBe(true);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-001: implicit supersede mint acquisition.
describe("implicit supersede acquisition", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");

  it("(a) the implicit mint acquires exclusively and publishes with no leftover marker", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).toBe(0);
    const minted = readdirSync(activeDir(root)).filter((name) => /^C-OLD-2-[0-9A-F]{8}$/.test(name));
    expect(minted).toHaveLength(1);
    const dir = path.join(activeDir(root), minted[0]!);
    expect(existsSync(path.join(dir, "spec.xml"))).toBe(true);
    expect(existsSync(path.join(dir, ".ngrace-mint-owner"))).toBe(false);
  });

  it("(b) a competitor at the resolved implicit id is preserved and no discarded is written", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const predecessor = path.join(activeDir(root), "C-OLD");
    advanceCursor(root, "C-OLD", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    const resolved = resolveSpecMint(
      { supersedes: "C-OLD", timestamp: "2026-09-19T00:00:00Z", branch: "b" },
      root,
    );
    const competitor = path.join(activeDir(root), resolved.id);
    mkdirSync(competitor, { recursive: true });
    writeFileSync(path.join(competitor, "spec.xml"), "<competitor />");
    const runBefore = readdirSync(path.join(predecessor, "run")).sort();
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(competitor, "spec.xml"), "utf8")).toBe("<competitor />");
    expect(readdirSync(path.join(predecessor, "run")).sort()).toEqual(runBefore);
    expect(existsSync(predecessor)).toBe(true);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-003: validate before fold.
describe("supersede validate before fold", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const archiveDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "archive");

  function openPredecessor(root: string, id: string, specStatus = "draft"): string {
    writeChangeBundleFixture(root, { changeId: id, location: "active", specStatus, planStatus: "draft" });
    const bundle = path.join(activeDir(root), id);
    advanceCursor(root, id, { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, id, { task: "T-001", kind: "progress" });
    return bundle;
  }

  function invariantSnapshot(bundle: string): string {
    return recursiveSnapshot(bundle);
  }

  it("(a) an existing implicit successor under active/ refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-OLD");
    const resolved = resolveSpecMint(
      { supersedes: "C-OLD", timestamp: "2026-09-19T00:00:00Z", branch: "b" },
      root,
    );
    mkdirSync(path.join(activeDir(root), resolved.id), { recursive: true });
    writeFileSync(path.join(activeDir(root), resolved.id, "spec.xml"), "<competitor />");
    const before = invariantSnapshot(bundle);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(invariantSnapshot(bundle)).toEqual(before);
    expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(false);
  });

  it("(b) an existing implicit successor under archive/ refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-OLD");
    const resolved = resolveSpecMint(
      { supersedes: "C-OLD", timestamp: "2026-09-19T00:00:00Z", branch: "b" },
      root,
    );
    mkdirSync(path.join(archiveDir(root), resolved.id), { recursive: true });
    writeFileSync(path.join(archiveDir(root), resolved.id, "spec.xml"), "<competitor />");
    const before = invariantSnapshot(bundle);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(invariantSnapshot(bundle)).toEqual(before);
  });

  it("(c) a missing predecessor spec.xml refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-OLD");
    rmSync(path.join(bundle, "spec.xml"));
    const before = invariantSnapshot(bundle);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(invariantSnapshot(bundle)).toEqual(before);
  });

  it("(e) an invalid predecessor spec status refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-OLD", "applied");
    const before = invariantSnapshot(bundle);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(invariantSnapshot(bundle)).toEqual(before);
    expect(existsSync(path.join(bundle, "run-ledger.xml"))).toBe(false);
  });

  it("(h) an invalid lineage relation refuses with a byte-identical tree", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-OLD");
    writeChangeBundleFixture(root, { changeId: "C-OTHER-2", location: "active", specStatus: "draft", planStatus: "draft" });
    const before = invariantSnapshot(bundle);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--replacement", "C-OTHER-2", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(invariantSnapshot(bundle)).toEqual(before);
  });

  it("(i) a missing replacement refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-OLD");
    const before = invariantSnapshot(bundle);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--replacement", "C-OLD-2", "--path", root,
    ]);
    expect(result.status).not.toBe(0);
    expect(invariantSnapshot(bundle)).toEqual(before);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-008: the success path shape, chain depth, and the five-step chain.
describe("success path preserved", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const archiveDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "archive");
  function canonicalNode(node: GraceXmlNode): unknown {
    const attrs = Object.fromEntries(Object.entries(node.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    return { tag: node.tag, attrs, text: node.text ?? "", children: (node.children ?? []).map(canonicalNode) };
  }
  const canonicalChildren = (children: GraceXmlNode[]): string => JSON.stringify(children.map(canonicalNode));

  it("AC-SUCCESS-PATH-PRESERVED: one open epoch folds with one discarded and the run/ directory survives empty", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-OLD", location: "active", specStatus: "draft", planStatus: "draft" });
    const bundle = path.join(activeDir(root), "C-OLD");
    const example = path.join(root, "src", "example.ts");
    writeFileSync(example, "export const example = 1;\n");
    const exampleBefore = readFileSync(example, "utf8");
    advanceCursor(root, "C-OLD", { task: "T-001", openEpoch: true, from: 1, to: 10 });
    const looseSnapshot = listLooseEvents(bundle).map((event) => ({
      id: event.id,
      attrs: expectedLedgerEventAttributes(event),
      children: canonicalChildren(event.children),
    }));
    expect(looseSnapshot.length, "a loose event is folded").toBeGreaterThan(0);
    const result = runSupersedeCli([
      "--change", "C-OLD", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      path.join(ARTIFACT_DIR, "changes", "archive", "C-OLD").replaceAll(path.sep, "/"),
    );
    const archived = path.join(archiveDir(root), "C-OLD");
    expect(existsSync(bundle)).toBe(false);
    expect(existsSync(archived)).toBe(true);
    expect(readFileSync(path.join(archived, "spec.xml"), "utf8")).toContain('status="superseded"');
    expect(readFileSync(path.join(archived, "plan.xml"), "utf8")).toContain('status="superseded"');
    expect(readFileSync(path.join(archived, "spec.xml"), "utf8")).toMatch(/<Replacement>C-OLD-2-[0-9A-F]{8}<\/Replacement>/);
    expect(readFileSync(path.join(archived, "plan.xml"), "utf8")).toMatch(/<Replacement>C-OLD-2-[0-9A-F]{8}<\/Replacement>/);
    const ledger = readFileSync(path.join(archived, "run-ledger.xml"), "utf8");
    expect((ledger.match(/<Epoch-1\b/g) ?? []).length).toBe(1);
    expect(ledger).toContain('kind="discarded"');
    expect(ledger).not.toContain('kind="terminal"');
    const ledgerEvents = listLedgerEvents(archived);
    for (const snap of looseSnapshot) {
      const written = ledgerEvents.find((event) => event.id === snap.id);
      expect(written, `event ${snap.id} present in the ledger`).toBeDefined();
      expect(expectedLedgerEventAttributes(written!)).toEqual(snap.attrs);
      expect(canonicalChildren(written!.children), `event ${snap.id} child subtrees`).toBe(snap.children);
    }
    // Non-vacuity: the comparator detects a mutated child attribute.
    const firstSnap = looseSnapshot.find((snap) => snap.children !== "[]")!;
    const parsed = JSON.parse(firstSnap.children) as Array<Record<string, unknown>>;
    const mutated = parsed.map((node) => ({ ...node, attrs: { ...(node.attrs as Record<string, string>), to: "999" } }));
    expect(JSON.stringify(mutated)).not.toBe(firstSnap.children);
    expect(listLooseEvents(archived)).toHaveLength(0);
    expect(existsSync(path.join(archived, "run"))).toBe(true);
    expect(readdirSync(path.join(archived, "run"))).toEqual([]);
    expect(readFileSync(example, "utf8")).toBe(exampleBefore);
    const successor = readdirSync(activeDir(root)).find((name) => /^C-OLD-2-[0-9A-F]{8}$/.test(name))!;
    expect(readAmendmentInstrument(root, "C-OLD").supersedeChainDepth).toBe(0);
    expect(readAmendmentInstrument(root, successor).supersedeChainDepth).toBe(1);
  });

  it("AC-SUCCESS-PATH-PRESERVED: a spec-only predecessor supersedes with exit 0 and no invented plan.xml", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-ONLY", location: "active", specStatus: "draft" });
    const result = runSupersedeCli([
      "--change", "C-ONLY", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root,
    ]);
    expect(result.status).toBe(0);
    const archived = path.join(archiveDir(root), "C-ONLY");
    expect(existsSync(archived)).toBe(true);
    expect(existsSync(path.join(archived, "plan.xml"))).toBe(false);
    expect(existsSync(path.join(archived, "run"))).toBe(false);
  });

  it("AC-REFUSED-NO-SUCCESSOR positive control: a five-step chain leaves exactly one active successor each step", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-CHAIN-1", location: "active", specStatus: "draft", planStatus: "draft" });
    let current = "C-CHAIN-1";
    for (let step = 1; step <= 5; step += 1) {
      const result = runSupersedeCli([
        "--change", current, "--timestamp", `2026-09-19T0${step}:00:00Z`, "--branch", "b", "--path", root,
      ]);
      expect(result.status).toBe(0);
      const active = readdirSync(activeDir(root)).filter((name) => name.startsWith("C-CHAIN-"));
      expect(active).toHaveLength(1);
      expect(active[0]!.startsWith(`C-CHAIN-${step + 1}-`)).toBe(true);
      current = active[0]!;
    }
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-003: the remaining validate-before-fold rows.
describe("supersede validate-before-fold rows", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const archiveDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "archive");

  function openPredecessor(root: string, id: string, planStatus = "draft"): string {
    writeChangeBundleFixture(root, { changeId: id, location: "active", specStatus: "draft", planStatus });
    const bundle = path.join(activeDir(root), id);
    advanceCursor(root, id, { task: "T-001", openEpoch: true, from: 1, to: 10 });
    return bundle;
  }
  function snapshot(bundle: string): string {
    return recursiveSnapshot(bundle);
  }

  it("(d) an archive-destination conflict refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-DEST");
    writeChangeBundleFixture(root, { changeId: "C-DEST", location: "archive", specStatus: "superseded", planStatus: "superseded" });
    const before = snapshot(bundle);
    const result = runSupersedeCli(["--change", "C-DEST", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(snapshot(bundle)).toEqual(before);
  });

  it("(f) an invalid predecessor plan status refuses before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-PLANST", "applied");
    const before = snapshot(bundle);
    const result = runSupersedeCli(["--change", "C-PLANST", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(snapshot(bundle)).toEqual(before);
  });

  it("(g) malformed predecessor artifacts refuse before any discarded write", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-MALFORMED-SUP");
    writeFileSync(path.join(bundle, "spec.xml"), "<broken");
    const before = snapshot(bundle);
    const result = runSupersedeCli(["--change", "C-MALFORMED-SUP", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(snapshot(bundle)).toEqual(before);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-003: the persistent-rollback sequence.
describe("supersede persistent rollback", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const archiveDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "archive");

  it("spec write succeeds, plan write fails, spec rollback fails persistently: composed error, exactly one cleanup with a recorded success outcome", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-ROLLBACK", location: "active", specStatus: "draft", planStatus: "draft" });
    const resolved: ResolvedSpecMint = {
      id: "C-ROLLBACK-2-ABCDEF12",
      slug: "ROLLBACK",
      lineage: 2,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    const active = activeDir(root);
    const before = readdirSync(active).sort();
    let writes = 0;
    const cleanups: Array<{ removed: boolean; diagnostic?: string }> = [];
    let caught: unknown;
    try {
      supersedeChangeBundle(
        root,
        "C-ROLLBACK",
        { kind: "mint", id: resolved.id, mint: () => mintResolvedBundle(root, resolved).acquired },
        {
          writeFileSync: ((...args: Parameters<typeof writeFileSync>) => {
            writes += 1;
            if (writes === 2) throw new Error("injected plan status write failure");
            if (writes === 3) throw new Error("injected persistent spec rollback failure");
            return writeFileSync(...args);
          }) as typeof writeFileSync,
          observeCleanupForTests: (outcome) => cleanups.push(outcome),
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    const message = (caught as Error).message;
    expect(message).toMatch(/injected plan status write failure/);
    expect(message).toMatch(/injected persistent spec rollback failure|rollback/i);
    expect(cleanups, "exactly one production cleanup invocation").toHaveLength(1);
    expect(cleanups[0]!.removed, "the successful cleanup outcome is recorded").toBe(true);
    // A successful cleanup composes no residual-state diagnostic.
    expect(message).not.toMatch(/Residual state preserved/);
    const specBytes = readFileSync(path.join(active, "C-ROLLBACK", "spec.xml"), "utf8");
    expect(specBytes).toContain('status="superseded"');
    expect(existsSync(path.join(active, resolved.id))).toBe(false);
    expect(readdirSync(active).sort()).toEqual(before);
    expect(existsSync(path.join(archiveDir(root), "C-ROLLBACK"))).toBe(false);
  });

  it("a cleanup refusal records exactly one attempt with a preserved-residue outcome and exactly one residual diagnostic", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, { changeId: "C-ROLLBACK2", location: "active", specStatus: "draft", planStatus: "draft" });
    const resolved: ResolvedSpecMint = {
      id: "C-ROLLBACK2-2-ABCDEF12",
      slug: "ROLLBACK2",
      lineage: 2,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    let writes = 0;
    const cleanups: Array<{ removed: boolean; diagnostic?: string }> = [];
    let caught: unknown;
    try {
      supersedeChangeBundle(
        root,
        "C-ROLLBACK2",
        {
          kind: "mint",
          id: resolved.id,
          mint: () => {
            const acquired = mintResolvedBundle(root, resolved).acquired;
            // A foreign entry so cleanup must preserve and refuse.
            writeFileSync(path.join(activeDir(root), resolved.id, "foreign.txt"), "x");
            return acquired;
          },
        },
        {
          writeFileSync: ((...args: Parameters<typeof writeFileSync>) => {
            writes += 1;
            if (writes === 1) throw new Error("injected governance write failure");
            return writeFileSync(...args);
          }) as typeof writeFileSync,
          observeCleanupForTests: (outcome) => cleanups.push(outcome),
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    const message = (caught as Error).message;
    expect(message).toMatch(/injected governance write failure/);
    expect(cleanups, "exactly one production cleanup invocation").toHaveLength(1);
    expect(cleanups[0]!.removed, "the preserved-residue outcome is recorded").toBe(false);
    expect(message.match(/Residual state preserved/g) ?? [], "one residual diagnostic, composed once").toHaveLength(1);
    expect(existsSync(path.join(activeDir(root), resolved.id, "foreign.txt"))).toBe(true);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-003: explicit-replacement type and under-lock revalidation.
describe("explicit replacement validation", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const archiveDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "archive");

  function openPredecessor(root: string, id: string): string {
    writeChangeBundleFixture(root, { changeId: id, location: "active", specStatus: "draft", planStatus: "draft" });
    const bundle = path.join(activeDir(root), id);
    advanceCursor(root, id, { task: "T-001", openEpoch: true, from: 1, to: 10 });
    return bundle;
  }
  function snapshot(bundle: string): string {
    return recursiveSnapshot(bundle);
  }

  it("the recursive predecessor snapshot detects a same-filename payload change", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-SNAP-1");
    const before = snapshot(bundle);
    const runDir = path.join(bundle, "run");
    const eventFile = path.join(runDir, readdirSync(runDir)[0]!);
    writeFileSync(eventFile, `${readFileSync(eventFile, "utf8")}<!--changed-->`);
    expect(snapshot(bundle), "byte-complete snapshot detects the payload change").not.toBe(before);
  });

  it("AC-SUPERSEDE-VALIDATE-BEFORE-FOLD: a regular file at the explicit replacement path refuses before any fold", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-FILE-1");
    const replacementPath = path.join(activeDir(root), "C-FILE-2");
    writeFileSync(replacementPath, "regular file\n");
    const before = snapshot(bundle);
    const result = runSupersedeCli(["--change", "C-FILE-1", "--replacement", "C-FILE-2", "--path", root]);
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toMatch(/not a directory/i);
    expect(snapshot(bundle)).toEqual(before);
    expect(existsSync(bundle)).toBe(true);
    expect(existsSync(path.join(archiveDir(root), "C-FILE-1"))).toBe(false);
    expect(readFileSync(replacementPath, "utf8")).toBe("regular file\n");
  });

  function seededRace(changeId: string, replacementId: string, replacementLocation: "active" | "archive") {
    const root = tempProject();
    const bundle = openPredecessor(root, changeId);
    writeChangeBundleFixture(root, { changeId: replacementId, location: replacementLocation, specStatus: "draft", planStatus: "draft" });
    mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });
    return {
      root,
      bundle,
      replacementActive: path.join(activeDir(root), replacementId),
      replacementArchive: path.join(archiveDir(root), replacementId),
    };
  }

  for (const row of [
    {
      name: "disappearance",
      location: "active" as const,
      seam: (r: { replacementActive: string; replacementArchive: string }) => rmSync(r.replacementActive, { recursive: true, force: true }),
    },
    {
      name: "active-to-archive relocation",
      location: "active" as const,
      seam: (r: { replacementActive: string; replacementArchive: string }) => renameSync(r.replacementActive, r.replacementArchive),
    },
    {
      name: "archive-to-active relocation",
      location: "archive" as const,
      seam: (r: { replacementActive: string; replacementArchive: string }) => renameSync(r.replacementArchive, r.replacementActive),
    },
    {
      name: "second location appears",
      location: "active" as const,
      seam: (r: { replacementActive: string; replacementArchive: string }) => cpSync(r.replacementActive, r.replacementArchive, { recursive: true }),
    },
    {
      name: "same-path identity change",
      location: "active" as const,
      seam: (r: { replacementActive: string; replacementArchive: string }) => {
        const tmp = `${r.replacementActive}.swap`;
        renameSync(r.replacementActive, tmp);
        cpSync(tmp, r.replacementActive, { recursive: true });
        rmSync(tmp, { recursive: true, force: true });
      },
    },
  ]) {
    it(`AC-SUPERSEDE-VALIDATE-BEFORE-FOLD (j) ${row.name}: refused on under-lock revalidation`, () => {
      const { root, bundle, replacementActive, replacementArchive } = seededRace("C-RACE-1", "C-RACE-2-ABCDEF12", row.location);
      const before = snapshot(bundle);
      let fired = false;
      let afterMutation: { active: string; archive: string } | undefined;
      expect(() =>
        supersedeChangeBundle(root, "C-RACE-1", { kind: "explicit", id: "C-RACE-2-ABCDEF12" }, {
          afterReplacementValidationForTests: () => {
            fired = true;
            row.seam({ replacementActive, replacementArchive });
            afterMutation = { active: recursiveSnapshot(replacementActive), archive: recursiveSnapshot(replacementArchive) };
          },
        }),
      ).toThrow(/missing as a directory|changed location or identity|both active\/ and archive\//i);
      expect(fired, "the under-lock seam fired").toBe(true);
      expect(snapshot(bundle), "complete predecessor bundle bytes are unchanged").toBe(before);
      expect(afterMutation, "the actor's mutation was captured").toBeDefined();
      // The engine adds no second mutation after refusing.
      expect({ active: recursiveSnapshot(replacementActive), archive: recursiveSnapshot(replacementArchive) }).toEqual(afterMutation!);
      expect(existsSync(path.join(archiveDir(root), "C-RACE-1"))).toBe(false);
    });
  }

  it("AC-SUPERSEDE-VALIDATE-BEFORE-FOLD (j) initially ambiguous both-locations: refused before any fold", () => {
    const { root, bundle, replacementActive, replacementArchive } = seededRace("C-RACE-1", "C-RACE-2-ABCDEF12", "active");
    cpSync(replacementActive, replacementArchive, { recursive: true });
    const before = snapshot(bundle);
    const replacementBefore = { active: recursiveSnapshot(replacementActive), archive: recursiveSnapshot(replacementArchive) };
    let fired = false;
    expect(() =>
      supersedeChangeBundle(root, "C-RACE-1", { kind: "explicit", id: "C-RACE-2-ABCDEF12" }, {
        afterReplacementValidationForTests: () => {
          fired = true;
        },
      }),
    ).toThrow(/both active\/ and archive\//i);
    expect(fired, "the seam never fires for an initially ambiguous state").toBe(false);
    expect(snapshot(bundle), "complete predecessor bundle bytes are unchanged").toBe(before);
    expect({ active: recursiveSnapshot(replacementActive), archive: recursiveSnapshot(replacementArchive) }).toEqual(replacementBefore);
  });

  it("AC-SUPERSEDE-VALIDATE-BEFORE-FOLD (j): a replacement removed during the fired under-lock seam is refused on revalidation", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-RACE-1");
    const replacementPath = path.join(activeDir(root), "C-RACE-2-ABCDEF12");
    writeChangeBundleFixture(root, { changeId: "C-RACE-2-ABCDEF12", location: "active", specStatus: "draft", planStatus: "draft" });
    const before = snapshot(bundle);
    let fired = false;
    expect(() =>
      supersedeChangeBundle(root, "C-RACE-1", { kind: "explicit", id: "C-RACE-2-ABCDEF12" }, {
        afterReplacementValidationForTests: () => {
          fired = true;
          rmSync(replacementPath, { recursive: true, force: true });
        },
      }),
    ).toThrow(/missing as a directory/i);
    expect(fired, "the under-lock seam fired").toBe(true);
    expect(snapshot(bundle)).toEqual(before);
    expect(existsSync(path.join(archiveDir(root), "C-RACE-1"))).toBe(false);
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-008: discriminating negative controls for the exact comparator.
describe("success payload comparator", () => {
  function canonicalNode(node: GraceXmlNode): unknown {
    const attrs = Object.fromEntries(Object.entries(node.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    return { tag: node.tag, attrs, text: node.text ?? "", children: (node.children ?? []).map(canonicalNode) };
  }
  const canonicalChildren = (children: GraceXmlNode[]): string => JSON.stringify(children.map(canonicalNode));
  const node = (tag: string, attributes: Record<string, string>, text: string, children: GraceXmlNode[] = []): GraceXmlNode =>
    ({ tag, attributes, text, children });

  it("detects attribute, text-whitespace, order, and nested-descendant changes", () => {
    const childA = node("Note", { key: "a" }, "A");
    const childB = node("Note", { key: "b" }, "B");
    const base = node("Allocation", { worker: "w0", from: "1", to: "10" }, "", [childA, childB]);
    const reversed = node("Allocation", { worker: "w0", from: "1", to: "10" }, "", [childB, childA]);
    const extra = node("Allocation", { worker: "w0", from: "1", to: "10" }, "", [childA, childB, node("Note", { key: "c" }, "C")]);
    const changedAttr = node("Allocation", { worker: "w0", from: "1", to: "999" }, "", [childA, childB]);
    const changedTextWhitespace = node("Allocation", { worker: "w0", from: "1", to: "10" }, "", [childA, node("Note", { key: "b" }, " B ")]);
    const nested = node("Allocation", { worker: "w0", from: "1", to: "10" }, "", [childA, node("Note", { key: "b" }, "B", [node("Deep", {}, "d")])]);
    expect(canonicalChildren([reversed]), "same two children reversed").not.toBe(canonicalChildren([base]));
    expect(canonicalChildren([extra]), "one extra child").not.toBe(canonicalChildren([base]));
    expect(canonicalChildren([changedAttr]), "attribute change").not.toBe(canonicalChildren([base]));
    expect(canonicalChildren([changedTextWhitespace]), "leading/trailing whitespace change").not.toBe(canonicalChildren([base]));
    expect(canonicalChildren([nested]), "nested descendant").not.toBe(canonicalChildren([base]));
  });
});

// C-SUPERSEDE-MEMBERSHIP-2-C459A20C T-003: implicit-mint success and post-fold failure.
describe("implicit mint transaction", () => {
  const activeDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "active");
  const archiveDir = (root: string) => path.join(root, ARTIFACT_DIR, "changes", "archive");

  function openPredecessor(root: string, id: string): string {
    writeChangeBundleFixture(root, { changeId: id, location: "active", specStatus: "draft", planStatus: "draft" });
    const bundle = path.join(activeDir(root), id);
    advanceCursor(root, id, { task: "T-001", openEpoch: true, from: 1, to: 10 });
    advanceCursor(root, id, { task: "T-001", kind: "progress" });
    return bundle;
  }

  it("implicit mint success with an open predecessor epoch folds, mints, and archives through the real CLI", () => {
    const root = tempProject();
    openPredecessor(root, "C-MINT-OK-1");
    const result = runSupersedeCli(["--change", "C-MINT-OK-1", "--timestamp", "2026-09-19T00:00:00Z", "--branch", "b", "--path", root]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(ARTIFACT_DIR, "changes", "archive", "C-MINT-OK-1").replaceAll(path.sep, "/"));
    const archived = path.join(archiveDir(root), "C-MINT-OK-1");
    expect(existsSync(archived)).toBe(true);
    const ledger = readFileSync(path.join(archived, "run-ledger.xml"), "utf8");
    expect(ledger).toContain('kind="discarded"');
    expect(ledger).not.toContain('kind="terminal"');
    const successor = readdirSync(activeDir(root)).find((name) => /^C-MINT-OK-2-[0-9A-F]{8}$/.test(name));
    expect(successor, "the successor was minted").toBeDefined();
    expect(existsSync(path.join(activeDir(root), successor!, "spec.xml"))).toBe(true);
    expect(existsSync(path.join(activeDir(root), successor!, "run"))).toBe(false);
  });

  /** Inject an inner-mint failure at a named write/publication step through the production I/O seam. */
  function innerMintWriteFailure(
    root: string,
    resolved: ResolvedSpecMint,
    failAtWrite: number,
    onFail?: () => void,
  ): { io: { writeFileSync: typeof writeFileSync }; writes: () => number } {
    let writes = 0;
    const io = {
      writeFileSync: ((...args: Parameters<typeof writeFileSync>) => {
        writes += 1;
        if (writes === failAtWrite) {
          onFail?.();
          throw new Error(`injected inner spec write failure at write ${writes}`);
        }
        return writeFileSync(...args);
      }) as typeof writeFileSync,
    };
    void root;
    void resolved;
    return { io, writes: () => writes };
  }

  it("a real inner mint failure after exclusive acquisition cleans up once and leaves no successor", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-MINT-INNER-1");
    const resolved: ResolvedSpecMint = {
      id: "C-MINT-INNER-2-ABCDEF12",
      slug: "MINT-INNER",
      lineage: 2,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    const observed: Array<{ removed: boolean; diagnostic?: string }> = [];
    const outer: Array<{ removed: boolean; diagnostic?: string }> = [];
    setCandidateCleanupObserverForTests((outcome) => observed.push(outcome));
    // write 1 = ownership marker, write 2 = spec.xml: fail after the leaf was acquired.
    const { io, writes } = innerMintWriteFailure(root, resolved, 2);
    let caught: unknown;
    try {
      supersedeChangeBundle(
        root,
        "C-MINT-INNER-1",
        { kind: "mint", id: resolved.id, mint: () => mintResolvedBundle(root, resolved, io).acquired },
        { observeCleanupForTests: (outcome) => outer.push(outcome) },
      );
    } catch (error) {
      caught = error;
    } finally {
      setCandidateCleanupObserverForTests(undefined);
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/injected inner spec write failure at write 2/);
    expect(writes(), "the candidate acquisition and the named failure point both occurred").toBe(2);
    expect(observed, "the inner publisher cleanup runs exactly once").toHaveLength(1);
    expect(observed[0]!.removed, "the successful inner cleanup outcome is recorded").toBe(true);
    expect(outer, "no outer governance cleanup without a returned AcquiredCandidate").toHaveLength(0);
    expect(existsSync(path.join(activeDir(root), resolved.id)), "successful cleanup leaves no successor").toBe(false);
    expect(existsSync(bundle), "the predecessor stays active").toBe(true);
    expect(
      readFileSync(path.join(bundle, "run-ledger.xml"), "utf8"),
      "the legitimate fold evidence remains exactly as allowed",
    ).toContain('kind="discarded"');
    expect(existsSync(path.join(archiveDir(root), "C-MINT-INNER-1"))).toBe(false);
    expect(message, "a successful cleanup composes no residual diagnostic").not.toMatch(/Residual state preserved/);
  });

  it("a real inner mint failure whose cleanup is refused names the bounded residue exactly once", () => {
    const root = tempProject();
    const bundle = openPredecessor(root, "C-MINT-RES-1");
    const resolved: ResolvedSpecMint = {
      id: "C-MINT-RES-2-ABCDEF12",
      slug: "MINT-RES",
      lineage: 2,
      hash: "ABCDEF12",
      branch: "probe",
      timestamp: "2026-09-19T00:00:00.000Z",
    };
    const observed: Array<{ removed: boolean; diagnostic?: string }> = [];
    const outer: Array<{ removed: boolean; diagnostic?: string }> = [];
    setCandidateCleanupObserverForTests((outcome) => observed.push(outcome));
    const { io, writes } = innerMintWriteFailure(root, resolved, 2, () => {
      // A foreign entry planted after acquisition so the inner cleanup must preserve.
      writeFileSync(path.join(activeDir(root), resolved.id, "foreign.txt"), "x");
    });
    let caught: unknown;
    try {
      supersedeChangeBundle(
        root,
        "C-MINT-RES-1",
        { kind: "mint", id: resolved.id, mint: () => mintResolvedBundle(root, resolved, io).acquired },
        { observeCleanupForTests: (outcome) => outer.push(outcome) },
      );
    } catch (error) {
      caught = error;
    } finally {
      setCandidateCleanupObserverForTests(undefined);
    }
    expect(caught).toBeInstanceOf(GraceCommandError);
    const message = (caught as Error).message;
    expect(message).toMatch(/injected inner spec write failure at write 2/);
    expect(writes()).toBe(2);
    expect(observed, "the inner publisher cleanup runs exactly once").toHaveLength(1);
    expect(observed[0]!.removed, "the refused inner cleanup outcome is recorded").toBe(false);
    expect(observed[0]!.diagnostic).toMatch(/foreign entry/);
    expect(outer, "no outer governance cleanup without a returned AcquiredCandidate").toHaveLength(0);
    expect(existsSync(path.join(activeDir(root), resolved.id, "foreign.txt")), "the bounded residue is preserved").toBe(true);
    expect(message, "the exact named bounded residue appears exactly once").toContain(resolved.id);
    expect(message.match(/Residual state preserved/g) ?? [], "one residual diagnostic").toHaveLength(1);
    expect(existsSync(bundle), "the predecessor stays active").toBe(true);
    expect(readFileSync(path.join(bundle, "run-ledger.xml"), "utf8")).toContain('kind="discarded"');
  });

  it("a pre-fold mint callback error after the predecessor fold is a defensive control outside the reachable mint contract", () => {
    // This callback throws before entering the real mint transaction, so it does not
    // exercise the inner publisher cleanup boundary; it is retained only as a
    // defensive control for the outer composition and is not the universal cleanup claim.
    const root = tempProject();
    const bundle = openPredecessor(root, "C-MINT-FAIL-1");
    const cleanups: Array<{ removed: boolean; diagnostic?: string }> = [];
    setCandidateCleanupObserverForTests((outcome) => cleanups.push(outcome));
    let caught: unknown;
    try {
      supersedeChangeBundle(root, "C-MINT-FAIL-1", {
        kind: "mint",
        id: "C-MINT-FAIL-2-ABCDEF12",
        mint: () => {
          throw new Error("injected pre-acquisition mint callback failure");
        },
      });
    } catch (error) {
      caught = error;
    } finally {
      setCandidateCleanupObserverForTests(undefined);
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/injected pre-acquisition mint callback failure/);
    expect(existsSync(bundle), "the predecessor stays active").toBe(true);
    expect(readFileSync(path.join(bundle, "run-ledger.xml"), "utf8"), "the legitimate fold evidence remains").toContain('kind="discarded"');
    expect(existsSync(path.join(activeDir(root), "C-MINT-FAIL-2-ABCDEF12"))).toBe(false);
    expect(existsSync(path.join(archiveDir(root), "C-MINT-FAIL-1"))).toBe(false);
    expect(cleanups, "no candidate was acquired to clean").toHaveLength(0);
  });
});
