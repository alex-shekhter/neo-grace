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
//   SHAPE_DATA_MARKER
//   patternSourceLooksLikeMarkupGuard
// END_MODULE_MAP
/**
 * @ngrace-review-shape-data
 *
 * Lexemes used by pattern detectors to *recognize* defective shapes in other files.
 * Exempt from regex-over-structure scanning (A37.3 / corr 88): this file holds shapes as data,
 * not as production guards over XML/source. Do not put runtime guards here.
 */

/** True when a regex *pattern source* (the body, not the host file) carries markup/attribute syntax. */
export function patternSourceLooksLikeMarkupGuard(patternSource: string): boolean {
  const p = patternSource;
  // XML/HTML tags: <Name or </Name. Do NOT treat JS lookbehinds `(?<!` / `(?<=` as tags.
  if (/<\/[A-Za-z]/.test(p) || /<[A-Za-z]/.test(p)) return true;
  // Attribute matchers aimed at structured markup (status="…", id='…') — not bare `=` in lookarounds
  if (/\w+\\s\*=\\s\*\[?["'`]/.test(p)) return true;
  if (/(?:^|[^?=])\b[a-zA-Z_][\w-]*\s*=\s*["'`]/.test(p)) return true;
  if (/status\\s\*=|\bstatus\s*=\s*["'`]/.test(p)) return true;
  // Structural export scan of raw source (corpus re-02 family)
  if (/export\s+function/.test(p)) return true;
  return false;
}

/** Marker comment a file may carry to opt out of self-scan (shape-as-data only). */
export const SHAPE_DATA_MARKER = "@ngrace-review-shape-data";
