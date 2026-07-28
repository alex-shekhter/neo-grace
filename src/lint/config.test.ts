import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { loadGraceLintConfig } from "./config";

function writeConfig(root: string, contents: string) {
  writeFileSync(path.join(root, ".grace-lint.json"), contents);
}

describe("loadGraceLintConfig", () => {
  it("accepts unverifiedLanguages extensions", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ unverifiedLanguages: [".rs"] }));
    const { config, issues } = loadGraceLintConfig(root);
    expect(issues).toEqual([]);
    expect(config?.unverifiedLanguages).toEqual([".rs"]);
  });

  it("rejects non-array unverifiedLanguages", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ unverifiedLanguages: "rs" }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues.map((issue) => issue.code)).toContain("config.invalid-unverified-languages");
  });

  it("rejects extensions missing a leading dot", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ unverifiedLanguages: ["rs"] }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues.map((issue) => issue.code)).toContain("config.invalid-unverified-languages");
  });

  it("names both supported keys on unknown-key", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ nope: 1 }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues.map((issue) => issue.code)).toContain("config.unknown-key");
    expect(issues[0]?.message).toContain("ignoredDirs");
    expect(issues[0]?.message).toContain("unverifiedLanguages");
  });
});
