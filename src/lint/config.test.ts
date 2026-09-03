import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { loadGraceLintConfig } from "./config";

function writeConfig(root: string, contents: string) {
  writeFileSync(path.join(root, ".ngrace-lint.json"), contents);
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

  it("names supported keys on unknown-key", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ nope: 1 }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues.map((issue) => issue.code)).toContain("config.unknown-key");
    expect(issues[0]?.message).toContain("ignoredDirs");
    expect(issues[0]?.message).toContain("unverifiedLanguages");
    expect(issues[0]?.message).toContain("documentAnchorLimit");
    expect(issues[0]?.message).toContain("closeEvidenceCommandShapes");
  });

  it("accepts closeEvidenceCommandShapes as an array of non-empty strings", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ closeEvidenceCommandShapes: ["bun run validate:examples"] }));
    const { config, issues } = loadGraceLintConfig(root);
    expect(issues).toEqual([]);
    expect(config?.closeEvidenceCommandShapes).toEqual(["bun run validate:examples"]);
  });

  it("rejects a non-array closeEvidenceCommandShapes at error", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ closeEvidenceCommandShapes: "bun run validate:examples" }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("config.invalid-close-evidence-command-shapes");
    expect(issues[0]?.severity).toBe("error");
  });

  it("rejects an empty-string closeEvidenceCommandShapes entry at error", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ closeEvidenceCommandShapes: [""] }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("config.invalid-close-evidence-command-shapes");
    expect(issues[0]?.severity).toBe("error");
  });

  it("rejects a whitespace-only closeEvidenceCommandShapes entry at error", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ closeEvidenceCommandShapes: ["   "] }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("config.invalid-close-evidence-command-shapes");
    expect(issues[0]?.severity).toBe("error");
  });

  it("accepts document size limit keys", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ documentAnchorLimit: 10, documentByteLimit: 4096 }));
    const { config, issues } = loadGraceLintConfig(root);
    expect(issues).toEqual([]);
    expect(config?.documentAnchorLimit).toBe(10);
    expect(config?.documentByteLimit).toBe(4096);
  });

  it("rejects non-positive document limits", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-cfg-"));
    writeConfig(root, JSON.stringify({ documentAnchorLimit: 0 }));
    const { issues } = loadGraceLintConfig(root);
    expect(issues.map((issue) => issue.code)).toContain("config.invalid-document-limit");
  });
});
