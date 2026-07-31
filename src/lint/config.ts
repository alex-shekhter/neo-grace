import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { GraceLintConfig, LintIssue } from "./types";

export const CONFIG_FILE_NAME = ".ngrace-lint.json";
const SUPPORTED_KEYS = new Set([
  "ignoredDirs",
  "unverifiedLanguages",
  "codeExtensions",
  "documentAnchorLimit",
  "documentByteLimit",
  "gateFailOn",
]);

export function loadGraceLintConfig(projectRoot: string): { config: GraceLintConfig | null; issues: LintIssue[] } {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    return { config: null as GraceLintConfig | null, issues: [] as LintIssue[] };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as GraceLintConfig;
    const issues: LintIssue[] = [];

    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      issues.push({
        severity: "error",
        code: "config.invalid-shape",
        file: CONFIG_FILE_NAME,
        message: `${CONFIG_FILE_NAME} must contain a JSON object.`,
      });
      return { config: parsed, issues };
    }

    for (const key of Object.keys(parsed)) {
      if (SUPPORTED_KEYS.has(key)) {
        continue;
      }

      issues.push({
        severity: "error",
        code: "config.unknown-key",
        file: CONFIG_FILE_NAME,
        message: `Unsupported key \`${key}\` in ${CONFIG_FILE_NAME}. Supported keys: ignoredDirs, unverifiedLanguages, codeExtensions, documentAnchorLimit, documentByteLimit, gateFailOn.`,
      });
    }

    if (parsed.ignoredDirs && !Array.isArray(parsed.ignoredDirs)) {
      issues.push({
        severity: "error",
        code: "config.invalid-ignored-dirs",
        file: CONFIG_FILE_NAME,
        message: `\`ignoredDirs\` in ${CONFIG_FILE_NAME} must be an array of directory names.`,
      });
    }

    if (parsed.unverifiedLanguages !== undefined) {
      if (
        !Array.isArray(parsed.unverifiedLanguages)
        || parsed.unverifiedLanguages.some((value) => typeof value !== "string" || !value.startsWith("."))
      ) {
        issues.push({
          severity: "error",
          code: "config.invalid-unverified-languages",
          file: CONFIG_FILE_NAME,
          message: "`unverifiedLanguages` must be an array of file extensions beginning with a dot, e.g. [\".rs\", \".go\"].",
        });
      }
    }

    if (parsed.codeExtensions !== undefined) {
      const invalid = !Array.isArray(parsed.codeExtensions)
        || parsed.codeExtensions.some(
          (value) => typeof value !== "string"
            || !/^\.[a-z0-9][a-z0-9.+-]*$/.test(value),
        );
      if (invalid) {
        issues.push({
          severity: "error",
          code: "config.invalid-code-extensions",
          file: CONFIG_FILE_NAME,
          message: "`codeExtensions` must be an array of lowercase file extensions beginning with a dot, e.g. [\".ex\", \".exs\"].",
        });
      }
    }

    for (const key of ["documentAnchorLimit", "documentByteLimit"] as const) {
      const value = parsed[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        issues.push({
          severity: "error",
          code: "config.invalid-document-limit",
          file: CONFIG_FILE_NAME,
          message: `\`${key}\` must be a positive integer.`,
        });
      }
    }

    if (parsed.gateFailOn !== undefined) {
      if (parsed.gateFailOn !== "errors" && parsed.gateFailOn !== "warnings" && parsed.gateFailOn !== "never") {
        issues.push({
          severity: "error",
          code: "config.invalid-gate-fail-on",
          file: CONFIG_FILE_NAME,
          message: "`gateFailOn` must be one of: errors, warnings, never.",
        });
      }
    }

    return { config: parsed, issues };
  } catch (error) {
    return {
      config: null,
      issues: [
        {
          severity: "error",
          code: "config.invalid-json",
          file: CONFIG_FILE_NAME,
          message: `Failed to parse ${CONFIG_FILE_NAME}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
