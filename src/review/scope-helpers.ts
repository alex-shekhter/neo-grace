// START_MODULE_CONTRACT
//   PURPOSE: Review surface
//   SCOPE: Process audits, pattern detectors, and review.* findings
//   DEPENDS: none
//   LINKS: M-REVIEW
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   extractObservedWriteScopeFromPlan
// END_MODULE_MAP
/**
 * Lightweight ObservedWriteScope extraction for process audits.
 * Does not re-implement scope validation — only lists File/Path/Glob values.
 */

import { existsSync } from "node:fs";

import { readGraceXmlArtifact, walkNodes } from "../artifact/xml";

export function extractObservedWriteScopeFromPlan(
  planFile: string,
  _projectRoot: string,
): { files: string[]; globs: string[] } {
  if (!existsSync(planFile)) return { files: [], globs: [] };
  const artifact = readGraceXmlArtifact(planFile);
  if (!artifact.root) return { files: [], globs: [] };
  const files: string[] = [];
  const globs: string[] = [];
  for (const node of walkNodes(artifact.root)) {
    if (node.tag !== "ObservedWriteScope") continue;
    for (const child of node.children) {
      const text = child.text.trim();
      if (!text) continue;
      if (child.tag === "File" || child.tag === "Path") files.push(text.replaceAll("\\", "/"));
      if (child.tag === "Glob") globs.push(text.replaceAll("\\", "/"));
    }
  }
  return {
    files: [...new Set(files)].sort(),
    globs: [...new Set(globs)].sort(),
  };
}
