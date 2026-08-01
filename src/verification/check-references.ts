// START_MODULE_CONTRACT
//   PURPOSE: Failure localization
//   SCOPE: Marker divergence comparison and verification localize CLI
//   DEPENDS: none
//   LINKS: M-LOCALIZE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   checkModuleCheckReferences
//   commandReferencesNormalizedTestFile
//   expandCommandTargets
//   normalizeTestFileForChecks
// END_MODULE_MAP
import path from "node:path";

/**
 * Extra path tokens implied by a language-native test command.
 * Purely additive: never removes a match that literal path tokens would make.
 */
export function expandCommandTargets(command: string): string[] {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];

  // ---- Go ----
  if (tokens.includes("go") && tokens.includes("test")) {
    let sawPackageArg = false;
    for (const token of tokens) {
      if (token === "..." || token.startsWith("./")) {
        sawPackageArg = true;
        const cleaned = token.replace(/^\.\//, "").replace(/\/?\.\.\.$/, "");
        out.push(cleaned === "" ? "." : cleaned);
      }
    }
    // `go test` with no package argument means the current directory
    if (!sawPackageArg) {
      out.push(".");
    }
  }

  // ---- Rust: cargo test / cargo nextest / cargo bench ----
  const isCargo = tokens.includes("cargo");
  const isCargoTest = isCargo && (tokens.includes("test") || tokens.includes("nextest") || tokens.includes("bench"));
  if (isCargoTest) {
    let specialized = false;
    const valueAfter = (flag: string): string | undefined => {
      const idx = tokens.indexOf(flag);
      if (idx < 0 || idx + 1 >= tokens.length) {
        return undefined;
      }
      return tokens[idx + 1];
    };

    // Named --test/--bench targets imply the specific file only (not the whole
    // tests/ or benches/ tree), so `cargo test --test other` does not match
    // tests/transfer.rs.
    const testName = valueAfter("--test");
    if (testName) {
      specialized = true;
      out.push(`tests/${testName}.rs`);
    }
    const benchName = valueAfter("--bench");
    if (benchName) {
      specialized = true;
      out.push(`benches/${benchName}.rs`);
    }
    if (tokens.includes("--lib")) {
      specialized = true;
      out.push("src");
    }
    const binName = valueAfter("--bin");
    if (binName) {
      specialized = true;
      out.push(`src/bin/${binName}.rs`);
      out.push("src");
    }
    if (!specialized) {
      out.push("src");
      out.push("tests");
    }
  }

  return [...new Set(out)];
}

function normalizeCwd(cwd?: string): string | undefined {
  if (!cwd) {
    return undefined;
  }
  const normalized = cwd.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return undefined;
  }
  return normalized;
}

/** Normalize a test file path relative to optional command cwd. */
export function normalizeTestFileForChecks(testFile: string, cwd?: string): { normalized: string; dir: string } {
  let normalized = testFile.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedCwd = normalizeCwd(cwd);
  if (normalizedCwd && normalized.startsWith(`${normalizedCwd}/`)) {
    normalized = normalized.slice(normalizedCwd.length + 1);
  }
  return { normalized, dir: path.dirname(normalized) };
}

/**
 * Whether one command string references a (already cwd-normalized) test file path.
 * Uses literal includes, directory tokens, and expandCommandTargets.
 */
export function commandReferencesNormalizedTestFile(
  check: string,
  normalized: string,
  dir: string,
): boolean {
  const normalizedCheck = check.replaceAll("\\", "/");
  if (normalizedCheck.includes(normalized)) {
    return true;
  }

  if (dir !== ".") {
    const tokens = normalizedCheck.split(/\s+/);
    if (tokens.some((token) => token === dir || token === `${dir}/`)) {
      return true;
    }
  }

  const implied = expandCommandTargets(check);
  return implied.some((target) => {
    if (target === ".") {
      return true;
    }
    return (
      normalized === target
      || normalized.startsWith(`${target}/`)
      || dir === target
      || dir.startsWith(`${target}/`)
    );
  });
}

/**
 * Checks whether module-check command strings reference declared test files.
 *
 * When cwd is provided and a testFile starts with "cwd/", the cwd prefix is
 * stripped before comparison. This allows monorepo authors to write testFiles
 * as repo-root-relative paths while moduleChecks use package-root-relative paths.
 *
 * @param testFiles - repo-root-relative test file paths (e.g., "packages/auth/src/auth.test.ts")
 * @param moduleChecks - command strings from module-checks block (e.g., "bun test src/auth.test.ts")
 * @param cwd - optional working directory for commands, relative to project root (e.g., "packages/auth")
 * @returns false if any testFile is not referenced by any moduleCheck; true otherwise
 */
export function checkModuleCheckReferences(
  testFiles: string[],
  moduleChecks: string[],
  cwd?: string,
): boolean {
  if (testFiles.length === 0) {
    return true;
  }

  for (const testFile of testFiles) {
    const { normalized, dir } = normalizeTestFileForChecks(testFile, cwd);
    const found = moduleChecks.some((check) => commandReferencesNormalizedTestFile(check, normalized, dir));
    if (!found) {
      return false;
    }
  }

  return true;
}
