import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  canonicalizeExistingPath,
  normalizeProjectRelativePath,
  ProjectPathError,
  resolveContainedProjectPath,
  toProjectRelativePath,
} from "./paths";

function createDirectory(prefix: string): string {
  const root = path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe("GRACE 4 contained project paths", () => {
  it("rejects portable absolute and traversal forms before filesystem resolution", () => {
    const cases = ["/tmp/x", "C:\\x", "C:x", "\\\\server\\share", "../x", "a/../../x", "a\\..\\x"] as const;
    for (const authoredPath of cases) {
      try {
        normalizeProjectRelativePath(authoredPath);
        throw new Error(`Expected ${authoredPath} to fail.`);
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectPathError);
        const code = (error as ProjectPathError).code;
        if (authoredPath.includes("..")) expect(code).toBe("path.traversal");
        else expect(["path.absolute", "path.invalid-drive"]).toContain(code);
      }
    }
  });

  it("normalizes slash and backslash paths without losing the authored diagnostic value", () => {
    expect(normalizeProjectRelativePath("src\\feature/./index.ts")).toBe("src/feature/index.ts");

    const authoredPath = "a\\..\\secret";
    try {
      normalizeProjectRelativePath(authoredPath);
      throw new Error("Expected traversal to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectPathError);
      expect((error as ProjectPathError).authoredPath).toBe(authoredPath);
    }
  });

  it("resolves an ordinary existing file to a contained absolute path", () => {
    const root = createDirectory("grace4-paths-existing");
    const file = path.join(root, "src", "example.ts");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export {};\n");

    // absolutePath is realpath'd (macOS: /var/folders → /private/var/folders).
    expect(resolveContainedProjectPath(root, "src\\example.ts")).toEqual({
      authoredPath: "src\\example.ts",
      relativePath: "src/example.ts",
      absolutePath: realpathSync(file),
    });
  });

  it("rejects an existing symlink whose realpath escapes the allowed root", () => {
    const root = createDirectory("grace4-paths-symlink-root");
    const outside = createDirectory("grace4-paths-symlink-outside");
    writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));

    expect(() => resolveContainedProjectPath(root, "escape.txt")).toThrow(
      expect.objectContaining({ code: "path.symlink-escape", authoredPath: "escape.txt" }),
    );
  });

  it("accepts a nonexistent output only when its nearest existing ancestor is contained", () => {
    const root = createDirectory("grace4-paths-output");
    const existingDirectory = path.join(root, "generated");
    mkdirSync(existingDirectory);

    // Output mode realpaths the nearest existing ancestor, then appends the suffix.
    expect(resolveContainedProjectPath(root, "generated/deep/result.xml", { mode: "output", extension: ".xml" })).toEqual({
      authoredPath: "generated/deep/result.xml",
      relativePath: "generated/deep/result.xml",
      absolutePath: path.join(realpathSync(existingDirectory), "deep", "result.xml"),
    });
  });

  it("rejects an output whose nearest existing ancestor escapes through a symlink", () => {
    const root = createDirectory("grace4-paths-output-root");
    const outside = createDirectory("grace4-paths-output-outside");
    symlinkSync(outside, path.join(root, "generated"), "dir");

    expect(() => resolveContainedProjectPath(root, "generated/result.xml", { mode: "output" })).toThrow(
      expect.objectContaining({ code: "path.symlink-escape", authoredPath: "generated/result.xml" }),
    );
  });

  it("computes project-relative paths when root is lexical and absolute is realpathed", () => {
    const root = createDirectory("grace4-paths-relative");
    const file = path.join(root, ".grace", "graph", "main.xml");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "<x/>\n");

    const realFile = realpathSync(file);
    // Regression: path.relative(lexicalRoot, realFile) escapes on macOS (/var → /private/var).
    expect(toProjectRelativePath(root, realFile)).toBe(".grace/graph/main.xml");
    expect(toProjectRelativePath(root, file)).toBe(".grace/graph/main.xml");
    expect(canonicalizeExistingPath(root)).toBe(realpathSync(root));
    expect(canonicalizeExistingPath(file)).toBe(realFile);
  });

  it("canonicalizes paths that do not exist through their nearest existing ancestor", () => {
    const root = createDirectory("grace4-paths-missing");
    mkdirSync(path.join(root, ".grace", "graph"), { recursive: true });

    // Regression: resolving only fully existing paths left the symlinked prefix
    // lexical, so a missing document produced an escaping ../../.. route key.
    const missing = path.join(root, ".grace", "graph", "deleted.xml");
    expect(toProjectRelativePath(root, missing)).toBe(".grace/graph/deleted.xml");
    expect(canonicalizeExistingPath(missing)).toBe(path.join(realpathSync(root), ".grace", "graph", "deleted.xml"));

    // Nonexistent intermediate directories resolve too.
    const deep = path.join(root, "never", "created", "file.xml");
    expect(toProjectRelativePath(root, deep)).toBe("never/created/file.xml");
  });

  it("does not enforce containment and must not be used for authored paths", () => {
    const root = createDirectory("grace4-paths-uncontained");

    // Documents the trap: toProjectRelativePath is an identity helper for paths
    // GRACE derived itself. resolveContainedProjectPath is the security boundary.
    // The *shape* of the escape is platform-dependent: POSIX yields a ../-prefixed
    // relative path, while on Windows the target can resolve onto another drive, where
    // no relative path exists and path.relative returns an absolute one. Assert the
    // invariant that actually matters — the result points outside the project — rather
    // than the POSIX spelling of it.
    const escaped = toProjectRelativePath(root, "/etc/passwd");
    expect(path.resolve(root, escaped).startsWith(path.resolve(root) + path.sep)).toBe(false);
    expect(() => resolveContainedProjectPath(root, "../etc/passwd")).toThrow(
      expect.objectContaining({ code: "path.traversal" }),
    );
  });
});
