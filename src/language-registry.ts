// START_MODULE_CONTRACT
//   PURPOSE: Governed-file discovery and markup analysis
//   SCOPE: Scanning, contracts, language routing, and graph projections
//   DEPENDS: none
//   LINKS: M-PROJECT-UTILS
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ADAPTER_BACKED_EXTENSIONS
//   CODE_EXTENSIONS
//   LANGUAGE_ADAPTERS
//   isGovernedCodeExtension
// END_MODULE_MAP
import { createDartAdapter } from "./lint/adapters/dart";
import { createGoAdapter } from "./lint/adapters/go";
import { createPythonAdapter } from "./lint/adapters/python";
import { createRustAdapter } from "./lint/adapters/rust";
import { createTypeScriptAdapter } from "./lint/adapters/typescript";
import type { LanguageAdapter } from "./lint/types";

/**
 * File extensions that GRACE recognizes as code files.
 * When adding a new language, add its extension(s) here.
 */
export const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".pyi",
  ".go",
  ".java",
  ".kt",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".scala",
  ".sql",
  ".sh", ".bash", ".zsh",
  ".clj", ".cljs", ".cljc",
  ".dart",
]);

/**
 * Language adapters registered with the linter, in order.
 * The first adapter whose supports() returns true for a given file is used.
 * Add new adapter factories here when adding language support.
 */
export const LANGUAGE_ADAPTERS: readonly LanguageAdapter[] = [
  createTypeScriptAdapter(),
  createPythonAdapter(),
  createDartAdapter(),
  createGoAdapter(),
  createRustAdapter(),
];

/**
 * Extensions with a registered language adapter and export/local analysis support.
 *
 * Derived by asking the adapters, never hand-maintained: a second list that must agree
 * with the first is a list that eventually won't, and `ngrace doctor` reports from this
 * one — drift here would make the honesty surface itself dishonest.
 */
export const ADAPTER_BACKED_EXTENSIONS: ReadonlySet<string> = new Set(
  [...CODE_EXTENSIONS].filter((extension) => LANGUAGE_ADAPTERS.some((adapter) => adapter.supports(`probe${extension}`))),
);

/**
 * True when GRACE governs files with this extension. Projects extend the built-in set
 * through `codeExtensions` in `.ngrace-lint.json`; extension is additive, so a project
 * can add a language but never silently drop governance for one.
 */
export function isGovernedCodeExtension(extension: string, projectExtensions?: Iterable<string>): boolean {
  if (CODE_EXTENSIONS.has(extension)) {
    return true;
  }
  if (!projectExtensions) {
    return false;
  }
  for (const candidate of projectExtensions) {
    if (candidate === extension) {
      return true;
    }
  }
  return false;
}
