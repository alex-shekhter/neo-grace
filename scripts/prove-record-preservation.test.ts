import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hashBody } from "./validate-record-retirement.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT = path.join(import.meta.dir, "prove-record-preservation.ts");

const tempRoots: string[] = [];

function isolatedRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "record-preservation-"));
  tempRoots.push(root);
  return root;
}

function plant(dir: string, name: string, body: string): void {
  const abs = path.join(dir, name);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function runValidator(recordDir: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [SCRIPT, recordDir], {
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

function writeHappy(dir: string, opts?: { dropBody?: boolean; dropIndex?: boolean }): void {
  const bodyOne = "body one";
  const bodyTwo = "body two";
  plant(
    dir,
    "record-inventory.json",
    `${JSON.stringify(
      [
        { token: "F1", id: "f1", bodyHash: hashBody(bodyOne) },
        { token: "D1", id: "d1", bodyHash: hashBody(bodyTwo) },
      ],
      null,
      2,
    )}\n`,
  );
  const indexEntries = opts?.dropIndex
    ? `  <Entry id="f1" token="F1" genre="finding" layer="live" />\n`
    : `  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
`;
  plant(dir, "decisions.xml", `<RecordIndex>\n${indexEntries}</RecordIndex>\n`);
  plant(
    dir,
    "findings.xml",
    `<Findings>
  <Finding id="f1" token="F1" status="live">
    <Title>### F1</Title>
    <Body>${bodyOne}</Body>
  </Finding>
</Findings>
`,
  );
  plant(dir, "findings-retired.xml", `<Findings>\n</Findings>\n`);
  const rulingBody = opts?.dropBody ? "other body" : bodyTwo;
  plant(
    dir,
    "rulings.xml",
    `<Rulings>
  <Decision id="d1" token="D1" status="live">
    <Title>## D1</Title>
    <Body>${rulingBody}</Body>
  </Decision>
</Rulings>
`,
  );
  plant(dir, "rulings-retired.xml", `<Rulings>\n</Rulings>\n`);
}

describe("prove-record-preservation", () => {
  it("exits 0 when inventory tokens, ids, and body hashes are present", () => {
    const dir = isolatedRoot();
    writeHappy(dir);
    const result = runValidator(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("record-preservation: ok");
  });

  it("plants a missing heading token and exits non-zero", () => {
    const dir = isolatedRoot();
    writeHappy(dir, { dropIndex: true });
    const result = runValidator(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-heading-token");
    expect(result.stderr).toContain("D1");
  });

  it("plants a missing inventory body and exits non-zero", () => {
    const dir = isolatedRoot();
    writeHappy(dir, { dropBody: true });
    const result = runValidator(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing-body-hash");
  });

  it("hashes xmlDecode of the raw Body, so &amp;lt; matches inventory &lt;", () => {
    const dir = isolatedRoot();
    const markdownBody = "names &lt;Replacement&gt;";
    plant(
      dir,
      "record-inventory.json",
      `${JSON.stringify([{ token: "F1", id: "f1", bodyHash: hashBody(markdownBody) }], null, 2)}\n`,
    );
    plant(
      dir,
      "decisions.xml",
      `<RecordIndex>\n  <Entry id="f1" token="F1" genre="finding" layer="live" />\n</RecordIndex>\n`,
    );
    plant(
      dir,
      "findings.xml",
      `<Findings>
  <Finding id="f1" token="F1" status="live">
    <Title>### F1</Title>
    <Body>names &amp;lt;Replacement&amp;gt;</Body>
  </Finding>
</Findings>
`,
    );
    plant(dir, "findings-retired.xml", `<Findings>\n</Findings>\n`);
    plant(dir, "rulings.xml", `<Rulings>\n</Rulings>\n`);
    plant(dir, "rulings-retired.xml", `<Rulings>\n</Rulings>\n`);
    const result = runValidator(dir);
    expect(result.status).toBe(0);
  });

  it("reads package.json and fails if validate:ci drops the preservation member", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["prove-record-preservation"]).toContain(
      "bun ./scripts/prove-record-preservation.ts",
    );
    expect(pkg.scripts["validate:ci"]).toContain("prove-record-preservation");
    expect(pkg.scripts["validate:ci"]).toContain("validate:citation-anchors");
  });
});
