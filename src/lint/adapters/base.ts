// START_MODULE_CONTRACT
//   PURPOSE: Lint orchestration and language adapters
//   SCOPE: Project load, governed-file analysis, adapters, and scanners
//   DEPENDS: none
//   LINKS: M-LINT-CORE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   getLanguageAdapter
// END_MODULE_MAP
import path from "node:path";
import { LANGUAGE_ADAPTERS } from "../../language-registry";

export function getLanguageAdapter(filePath: string) {
  const normalizedPath = path.normalize(filePath);
  return LANGUAGE_ADAPTERS.find((adapter) => adapter.supports(normalizedPath)) ?? null;
}
