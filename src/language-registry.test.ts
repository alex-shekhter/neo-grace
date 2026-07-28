import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  ADAPTER_BACKED_EXTENSIONS,
  CODE_EXTENSIONS,
  isGovernedCodeExtension,
  LANGUAGE_ADAPTERS,
} from "./language-registry";
import { lintGraceProject } from "./grace-lint";
import { writeMinimalGrace4Project } from "./grace4/test-fixtures";

function createProject() {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-lang-"));
  writeMinimalGrace4Project(root);
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

/** A governed file in a language GRACE has no adapter for. */
const ELIXIR_MODULE = `# START_MODULE_CONTRACT
#   PURPOSE: Ledger posting core.
#   SCOPE: Elixir posting rules.
#   DEPENDS: none
#   LINKS: M-EXAMPLE
#   ROLE: RUNTIME
#   MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
#   post - Apply a posting.
# END_MODULE_MAP
defmodule Ledger do
  def post(entry), do: {:ok, entry}
end
`;

describe("language registry", () => {
  it("derives ADAPTER_BACKED_EXTENSIONS from the adapters themselves", () => {
    // A hand-maintained mirror of what the adapters support is a list that eventually
    // disagrees with them, and `ngrace doctor` reports from this one.
    const actuallySupported = new Set(
      [...CODE_EXTENSIONS].filter((extension) =>
        LANGUAGE_ADAPTERS.some((adapter) => adapter.supports(`probe${extension}`)),
      ),
    );

    expect([...ADAPTER_BACKED_EXTENSIONS].sort()).toEqual([...actuallySupported].sort());
    expect(ADAPTER_BACKED_EXTENSIONS.size).toBeGreaterThan(0);

    // Every adapter-backed extension is also governed, or files would be analysed
    // by an adapter that never sees them.
    for (const extension of ADAPTER_BACKED_EXTENSIONS) {
      expect(CODE_EXTENSIONS.has(extension)).toBe(true);
    }
  });

  it("treats project-declared extensions as governed without dropping built-ins", () => {
    expect(isGovernedCodeExtension(".ts")).toBe(true);
    expect(isGovernedCodeExtension(".ex")).toBe(false);
    expect(isGovernedCodeExtension(".ex", [".ex", ".exs"])).toBe(true);
    // Additive only: declaring one language never removes governance for another.
    expect(isGovernedCodeExtension(".ts", [".ex"])).toBe(true);
  });
});

/** Issue codes raised against the Elixir file specifically, not the project as a whole. */
function issuesForElixir(result: { issues: Array<{ code: string; file?: string }> }): string[] {
  return result.issues.filter((issue) => (issue.file ?? "").endsWith("ledger.ex")).map((issue) => issue.code);
}

describe("codeExtensions config", () => {
  it("does not govern an unlisted language by default", () => {
    const root = createProject();
    writeProjectFile(root, "lib/ledger.ex", ELIXIR_MODULE);

    const result = lintGraceProject(root);
    // The file is invisible: never discovered, so its markup is never validated.
    expect(issuesForElixir(result)).toEqual([]);
    expect(result.governedFiles).toBe(0);
  });

  it("governs a project-declared language and reports it as unverified", () => {
    const root = createProject();
    writeProjectFile(root, "lib/ledger.ex", ELIXIR_MODULE);
    writeProjectFile(root, ".grace-lint.json", JSON.stringify({ codeExtensions: [".ex", ".exs"] }));

    const result = lintGraceProject(root);
    expect(result.governedFiles).toBe(1);
    // Governed, and honest about what it cannot verify.
    expect(issuesForElixir(result)).toContain("analysis.no-adapter");
  });

  it("lets a project acknowledge the missing adapter to reach a clean lint", () => {
    const root = createProject();
    writeProjectFile(root, "lib/ledger.ex", ELIXIR_MODULE);
    writeProjectFile(
      root,
      ".grace-lint.json",
      JSON.stringify({ codeExtensions: [".ex", ".exs"], unverifiedLanguages: [".ex", ".exs"] }),
    );

    const result = lintGraceProject(root);
    expect(result.governedFiles).toBe(1);
    expect(issuesForElixir(result)).not.toContain("analysis.no-adapter");
    expect(result.summary.errors).toBe(0);
  });

  it("rejects malformed codeExtensions values", () => {
    for (const value of [".EX", "ex", "/etc/passwd", ".", "", 42, { ex: true }]) {
      const root = createProject();
      writeProjectFile(root, ".grace-lint.json", JSON.stringify({ codeExtensions: [value] }));
      expect(lintGraceProject(root).issues.map((issue) => issue.code)).toContain("config.invalid-code-extensions");
    }
  });
});
