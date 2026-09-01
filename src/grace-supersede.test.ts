import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ARTIFACT_DIR } from "./artifact/paths";
import { writeChangeBundleFixture, writeMinimalNgraceProject } from "./artifact/test-fixtures";
import { advanceCursor } from "./grace-cursor";
import { supersedeChangeBundle } from "./gates/ledger";
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

    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
    const specAfter = readFileSync(changeArtifactPath(root, "C-OLD", "spec.xml")!, "utf8");
    expect(specAfter).toContain("<Replacement>");
    expect(specAfter).toContain("<Replacement>C-NEW</Replacement>");
    expect(specAfter).not.toContain("<ReplacementChange>");
    expect(specAfter).not.toMatch(/<C-NEW[\s/>]/);

    const named = tempProject();
    writeChangeBundleFixture(named, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(named, {
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const namedSpec = path.join(named, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    writeFileSync(
      namedSpec,
      readFileSync(namedSpec, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-NEW</Replacement>"),
    );
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", named]);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD");
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
    const archiveDir = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD");
    expect(existsSync(archiveDir)).toBe(true);
    expect(existsSync(path.join(archiveDir, "plan.xml"))).toBe(false);
  });

  it("move-and-rollback: open epoch still moves", () => {
    const root = tempProject();
    writeChangeBundleFixture(root, {
      changeId: "C-OLD",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    writeChangeBundleFixture(root, {
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    advanceCursor(root, "C-OLD", { task: "T-001", openEpoch: true });
    runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD"))).toBe(true);
    expect(existsSync(path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "run"))).toBe(true);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const archivedSpec = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "spec.xml");
    writeFileSync(
      archivedSpec,
      readFileSync(archivedSpec, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-NEW</Replacement>"),
    );
    const archivedPlan = path.join(root, ARTIFACT_DIR, "changes", "archive", "C-OLD", "plan.xml");
    writeFileSync(
      archivedPlan,
      readFileSync(archivedPlan, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-NEW</Replacement>"),
    );
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const specPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "spec.xml");
    const planPath = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD", "plan.xml");
    writeFileSync(
      specPath,
      readFileSync(specPath, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-NEW</Replacement>"),
    );
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace("<C-OLD>", "<C-OLD><Replacement>C-NEW</Replacement>"),
    );
    const specBefore = readFileSync(specPath, "utf8");
    const planBefore = readFileSync(planPath, "utf8");
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    const specPath = path.join(activeDir, "spec.xml");
    const planPath = path.join(activeDir, "plan.xml");
    const specBefore = readFileSync(specPath, "utf8");
    chmodSync(planPath, 0o444);
    const result = runSupersedeCli(["--change", "C-OLD", "--replacement", "C-NEW", "--path", root]);
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
      changeId: "C-NEW",
      location: "active",
      specStatus: "draft",
      planStatus: "draft",
    });
    const activeDir = path.join(root, ARTIFACT_DIR, "changes", "active", "C-OLD");
    const specPath = path.join(activeDir, "spec.xml");
    const specBefore = readFileSync(specPath, "utf8");
    const exdev = Object.assign(new Error("cross-device"), { code: "EXDEV" });
    expect(() =>
      supersedeChangeBundle(root, "C-OLD", "C-NEW", {
        renameSync: () => {
          throw exdev;
        },
      }),
    ).toThrow(GraceCommandError);
    try {
      supersedeChangeBundle(root, "C-OLD", "C-NEW", {
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



