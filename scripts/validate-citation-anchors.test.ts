import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function writeFixture(body: string): string {
  const file = path.join(isolatedRoot(), "decisions.md");
  writeFileSync(file, body);
  return file;
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

const HAPPY = `<a id="d11" name="d11"></a>
## D11 — F12 and F9.8 are not deferred

<a id="d1.1" name="d1.1"></a>
### D1.1 — Relationship to A29.2

<a id="f91" name="f91"></a>
### F91 — scaffold cannot create the first module

<a id="f9.1" name="f9.1"></a>
#### F9.1 — Disposition: leave the ledger

<a id="f74.1" name="f74.1"></a>
### F74.1 correction — unique correction keeps primary slug

<a id="f21" name="f21"></a>
### F21 — The fix budget counts attempts

<a id="f21-correction" name="f21-correction"></a>
### F21 correction — the attempt budget was renamed

See [F9.1](#f9.1), [F91](#f91), [D11](#d11), [D1.1](#d1.1),
[F74.1](#f74.1), [F21](#f21), and [F21 correction](#f21-correction).
`;

describe("validate-citation-anchors", () => {
  it("exits 0 on the live decisions.md file", () => {
    const result = runValidator();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("citation-anchors: ok");
    expect(result.stderr).toBe("");
  });

  it("exits 0 on a happy fixture with H4 F and H3 D headings", () => {
    const file = writeFixture(HAPPY);
    const result = runValidator(file);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("citation-anchors: ok");
  });

  it("refuses a heading with no preceding anchor", () => {
    const file = writeFixture(`### F91 — scaffold\n`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-anchor");
  });

  it("refuses a duplicate id", () => {
    const file = writeFixture(`<a id="f91" name="f91"></a>
### F91 — one

<a id="f91" name="f91"></a>
### F92 — two
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("duplicate-id");
  });

  it("refuses an unresolved fragment", () => {
    const file = writeFixture(`<a id="f91" name="f91"></a>
### F91 — scaffold

See [missing](#f99).
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unresolved-fragment");
  });

  it("refuses ](#f882) against id=f88.2", () => {
    const file = writeFixture(`<a id="f88.2" name="f88.2"></a>
### F88.2 — given a reachable human

See [F88.2](#f882).
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unresolved-fragment");
    expect(result.stderr).toContain("f882");
  });

  it("refuses when id and name disagree", () => {
    const file = writeFixture(`<a id="f9.1" name="f91"></a>
#### F9.1 — Disposition
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("id-name-disagree");
  });

  it("refuses HTML inside the heading line", () => {
    const file = writeFixture(`<a id="f9.1" name="f9.1"></a>
#### F9.1 <a id="f9.1" name="f9.1"></a> — Disposition
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("html-in-heading");
  });

  it("refuses a {#id} suffix on the heading", () => {
    const file = writeFixture(`<a id="f9.1" name="f9.1"></a>
#### F9.1 — Disposition {#f9.1}
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pandoc-heading-id");
  });

  it("refuses a strip-dot id on F9.1", () => {
    const file = writeFixture(`<a id="f91" name="f91"></a>
#### F9.1 — Disposition
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("slug-mismatch");
    expect(result.stderr).toContain("f9.1");
  });

  it("refuses a qualifier suffix on a unique correction heading", () => {
    const file = writeFixture(`<a id="f74.1-correction" name="f74.1-correction"></a>
### F74.1 correction — unique
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("slug-mismatch");
    expect(result.stderr).toContain("f74.1");
  });

  it("refuses a two-level-cut fixture that omits an H4 F heading", () => {
    const file = writeFixture(`<a id="d11" name="d11"></a>
## D11 — not deferred

<a id="f91" name="f91"></a>
### F91 — scaffold

#### F9.1 — Disposition
`);
    const result = runValidator(file);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-anchor");
  });

  it("exits 0 on unique-but-wrong #f93 when F9.3 and F93 both have keep-dot ids", () => {
    const file = writeFixture(`<a id="f9.3" name="f9.3"></a>
#### F9.3 — The rule proposed in F9.2 is refuted

<a id="f93" name="f93"></a>
### F93 — the archive gate permits a cursor that lint rejects

Citing sentence meant F9.3 but the dest is [F93](#f93).
`);
    const result = runValidator(file);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("citation-anchors: ok");
  });

});
