// START_MODULE_CONTRACT
//   PURPOSE: Lint issue catalog and emission patterns
//   SCOPE: Titles, remediations, absence guides, and emission pattern sets
//   DEPENDS: none
//   LINKS: M-LINT-CATALOG
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DEFAULT_EMISSION_PATTERNS
//   EMISSION_PATTERN_SETS
//   EmissionPatternSet
//   emissionPatternsFor
// END_MODULE_MAP
/**
 * Language-aware patterns for recognizing runtime log/trace emission lines.
 * Used by hasRuntimeMarkerEvidence so idiomatic Rust/Go logging counts as
 * marker evidence (gap G-02).
 *
 * Implementation rules:
 * - Never use /g or /y flags: global/sticky regexes are stateful across .test()
 *   calls via lastIndex and produce alternating true/false results.
 * - Prefer false positives over permanent unfixable false negatives when the
 *   extension is unknown (union fallback).
 */

export type EmissionPatternSet = {
  id: string;
  extensions: ReadonlySet<string>;
  patterns: readonly RegExp[];
};

/** Existing JS/TS behavior, decomposed. Fallback for every language. */
export const DEFAULT_EMISSION_PATTERNS: readonly RegExp[] = [
  /console\./,
  /logger\./,
  /tracer\./,
  /trace\s*\(/,
  /emit\s*\(/,
  /\.(?:info|warn|error|debug|trace)\s*\(/,
];

const RUST_PATTERNS: readonly RegExp[] = [
  // tracing::info!(...)  log::warn!(...)  slog::error!(...)  defmt::info!(...)
  /\b(?:tracing|log|slog|defmt)\s*::\s*(?:trace|debug|info|warn|error)\s*!\s*\(/,
  // bare imported macros: info!(...)  warn!(target: "app", ...)
  /(?<![A-Za-z0-9_])(?:trace|debug|info|warn|error|event)\s*!\s*\(/,
  // println!/eprintln!/print!/eprint!/write!/writeln!/panic!
  /(?<![A-Za-z0-9_])(?:println|eprintln|print|eprint|write|writeln|panic)\s*!\s*\(/,
  // tracing span field recording
  /\.(?:event|record|emit|log)\s*\(/,
];

// Known limitation: zerolog structured fields (.Str("k", "[MARKER]")) are
// matched only when the same line also carries a terminal .Msg(...).
const GO_PATTERNS: readonly RegExp[] = [
  // slog.Info(...)  log.Printf(...)  zap.L().Info(...)  logrus.Warn(...)  klog.V(2).Info(...)
  /\b(?:slog|log|logger|logr|zap|sugar|logrus|klog|glog|zerolog)\s*\./,
  // exported method-call logging, incl. zap w/f/s variants and Context suffixes
  /\.(?:Info|Warn|Warning|Error|Debug|Trace|Fatal|Panic|Print|Printf|Println|Log)(?:f|w|s|Context|Ctx)?\s*\(/,
  // zerolog terminal calls: .Msg("...")  .Msgf("...")  .Send()
  /\.Msg(?:f)?\s*\(/,
  /\.Send\s*\(\s*\)/,
];

export const EMISSION_PATTERN_SETS: readonly EmissionPatternSet[] = [
  { id: "rust", extensions: new Set([".rs"]), patterns: RUST_PATTERNS },
  { id: "go", extensions: new Set([".go"]), patterns: GO_PATTERNS },
];

/**
 * Patterns for a file extension. Unknown language gets the union of everything
 * (prefer false positive over permanent false-negative blocker). Known languages
 * get their set plus DEFAULT as a shared baseline.
 */
export function emissionPatternsFor(extension: string | undefined): readonly RegExp[] {
  if (!extension) {
    return [...DEFAULT_EMISSION_PATTERNS, ...EMISSION_PATTERN_SETS.flatMap((set) => set.patterns)];
  }
  const set = EMISSION_PATTERN_SETS.find((candidate) => candidate.extensions.has(extension));
  return set ? [...set.patterns, ...DEFAULT_EMISSION_PATTERNS] : DEFAULT_EMISSION_PATTERNS;
}
