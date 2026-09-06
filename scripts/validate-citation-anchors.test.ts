import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT = path.join(import.meta.dir, "validate-citation-anchors.ts");

const tempRoots: string[] = [];

function isolatedRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "citation-anchors-"));
  tempRoots.push(root);
  return root;
}

function plant(dir: string, name: string, body: string): string {
  const abs = path.join(dir, name);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

function runValidator(target?: string): { status: number | null; stdout: string; stderr: string } {
  const args = target === undefined ? [SCRIPT] : [SCRIPT, target];
  const result = spawnSync("bun", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function happyDir(): { dir: string; stub: string } {
  const dir = isolatedRoot();
  const stub = plant(
    dir,
    "decisions.md",
    `# stub\n\nThe parseable citation index is [./decisions.xml](./decisions.xml).\n`,
  );
  plant(
    dir,
    "decisions.xml",
    `<RecordIndex>
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`,
  );
  plant(
    dir,
    "record-inventory.json",
    `${JSON.stringify(
      [
        { token: "F1", id: "f1", bodyHash: "a" },
        { token: "D1", id: "d1", bodyHash: "b" },
      ],
      null,
      2,
    )}\n`,
  );
  plant(
    dir,
    "findings.xml",
    `<Findings>
  <Finding id="f1" token="F1" status="live">
    <Title>### F1</Title>
    <Body>See [D1](#d1).</Body>
  </Finding>
</Findings>
`,
  );
  return { dir, stub };
}

describe("validate-citation-anchors", () => {
  it("exits 0 on a happy stub-plus-index fixture", () => {
    const { stub } = happyDir();
    const result = runValidator(stub);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("citation-anchors: ok");
    expect(result.stderr).toBe("");
  });

  it("does not read the repository record files when argv names a fixture path", () => {
    const { stub } = happyDir();
    const result = runValidator(stub);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(stub);
    expect(result.stdout).not.toContain(`${REPO_ROOT}/docs/plans/active/RM-GOVERNED-PATH/decisions.md`);
  });

  it("refuses a missing stub", () => {
    const dir = isolatedRoot();
    const missing = path.join(dir, "decisions.md");
    const result = runValidator(missing);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-stub");
  });

  it("refuses a stub that does not name the index", () => {
    const dir = isolatedRoot();
    const stub = plant(dir, "decisions.md", `# stub\n\nNo pointer here.\n`);
    plant(dir, "decisions.xml", `<RecordIndex></RecordIndex>\n`);
    plant(dir, "record-inventory.json", "[]\n");
    const result = runValidator(stub);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-index-pointer");
  });

  it("refuses an index missing one inventory id", () => {
    const { dir, stub } = happyDir();
    plant(
      dir,
      "decisions.xml",
      `<RecordIndex>
  <Entry id="f1" token="F1" genre="finding" layer="live" />
</RecordIndex>
`,
    );
    const result = runValidator(stub);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-inventory-id");
    expect(result.stderr).toContain("d1");
  });

  it("refuses a duplicate index id", () => {
    const { dir, stub } = happyDir();
    plant(
      dir,
      "decisions.xml",
      `<RecordIndex>
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f1" token="F1" genre="finding" layer="retired" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`,
    );
    const result = runValidator(stub);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("duplicate-id");
  });

  it("refuses Body ](#f9999) whose slug is absent from the index", () => {
    const { dir, stub } = happyDir();
    plant(
      dir,
      "findings.xml",
      `<Findings>
  <Finding id="f1" token="F1" status="live">
    <Title>### F1</Title>
    <Body>See [missing](#f9999).</Body>
  </Finding>
</Findings>
`,
    );
    const result = runValidator(stub);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unresolved-fragment");
    expect(result.stderr).toContain("f9999");
  });

  it("keeps validate:citation-anchors on validate:ci", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["validate:citation-anchors"]).toContain(
      "bun ./scripts/validate-citation-anchors.ts",
    );
    expect(pkg.scripts["validate:ci"]).toContain("validate:citation-anchors");
  });
});
