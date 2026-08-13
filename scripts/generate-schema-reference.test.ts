import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderSchemaReference } from "../src/artifact/schema-reference";
import { checkSchemaReference } from "./generate-schema-reference";

const tempRoots: string[] = [];

function isolatedRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-schema-ref-"));
  tempRoots.push(root);
  return root;
}

function writeReference(root: string, contents: string): void {
  const file = path.join(root, "docs", "schema-reference.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("AC-DRIFT-DETECTABLE", () => {
  it("returns non-zero when the committed file is missing under an isolated root", () => {
    const root = isolatedRoot();
    expect(checkSchemaReference(root)).not.toBe(0);
  });

  it("returns non-zero when the committed file differs from the renderer", () => {
    const root = isolatedRoot();
    writeReference(root, `${renderSchemaReference()}\n# stale\n`);
    expect(checkSchemaReference(root)).not.toBe(0);
  });

  it("returns zero when the committed file is byte-identical to the renderer", () => {
    const root = isolatedRoot();
    writeReference(root, renderSchemaReference());
    expect(checkSchemaReference(root)).toBe(0);
  });

  it("does not write the missing file in check mode", () => {
    const root = isolatedRoot();
    expect(checkSchemaReference(root)).not.toBe(0);
    expect(existsSync(path.join(root, "docs", "schema-reference.md"))).toBe(false);
  });

  it("composes the check token into validate:ci", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["validate:schema-reference"]).toContain("generate-schema-reference");
    expect(pkg.scripts["validate:schema-reference"]).toMatch(/(?:^|\s)check(?:\s|$)/);
    expect(pkg.scripts["validate:ci"]).toContain("validate:schema-reference");
  });
});
