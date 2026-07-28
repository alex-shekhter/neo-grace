import { describe, expect, it } from "bun:test";

import { emissionPatternsFor, EMISSION_PATTERN_SETS } from "./emission-patterns";
import { hasRuntimeMarkerEvidence } from "../project-utils";

const MARKER = "[X][y][BLOCK_Z]";

function matches(line: string, extension: string | undefined): boolean {
  return hasRuntimeMarkerEvidence(line, MARKER, extension === undefined ? {} : { filePath: `file${extension}` });
}

describe("emission-patterns", () => {
  it("supports lookbehind so bare info! does not match xinfo!", () => {
    expect(/(?<![A-Za-z0-9_])info\s*!\s*\(/.test("info!(")).toBe(true);
    expect(/(?<![A-Za-z0-9_])info\s*!\s*\(/.test("xinfo!(")).toBe(false);
  });

  it("never registers global or sticky patterns (stateless .test())", () => {
    for (const set of EMISSION_PATTERN_SETS) {
      for (const pattern of set.patterns) {
        expect(pattern.global).toBe(false);
        expect(pattern.sticky).toBe(false);
      }
    }
    // Call twice and re-assert: emissionPatternsFor must not mutate pattern state.
    emissionPatternsFor(".go");
    for (const pattern of emissionPatternsFor(".go")) {
      expect(pattern.global).toBe(false);
      expect(pattern.sticky).toBe(false);
    }
  });

  // Eleven-form probe from review.md Appendix A, plus negatives and indirect cases.
  const cases: Array<{ line: string; extension: string | undefined; expected: boolean; label: string }> = [
    { label: "1 rust tracing::info!", line: `tracing::info!("${MARKER} hi");`, extension: ".rs", expected: true },
    { label: "2 rust log::warn!", line: `log::warn!("${MARKER} hi");`, extension: ".rs", expected: true },
    { label: "3 rust bare info!", line: `info!(target: "app", "${MARKER}");`, extension: ".rs", expected: true },
    { label: "4 rust println!", line: `println!("${MARKER}");`, extension: ".rs", expected: true },
    { label: "5 rust eprintln!", line: `eprintln!("${MARKER}");`, extension: ".rs", expected: true },
    { label: "6 rust tracing::warn!", line: `tracing::warn!("${MARKER} unbalanced");`, extension: ".rs", expected: true },
    { label: "7 go slog.Info", line: `slog.Info("${MARKER}")`, extension: ".go", expected: true },
    { label: "8 go zap Infow", line: `zap.L().Infow("${MARKER}")`, extension: ".go", expected: true },
    { label: "9 go log.Printf", line: `log.Printf("${MARKER}")`, extension: ".go", expected: true },
    { label: "10 go zerolog Msg", line: `log.Info().Msg("${MARKER}")`, extension: ".go", expected: true },
    { label: "11 go logger.Error", line: `logger.Error("${MARKER}")`, extension: ".go", expected: true },
    { label: "12 ts console.log", line: `console.log("${MARKER}")`, extension: ".ts", expected: true },
    { label: "13 ts logger.info", line: `logger.info("${MARKER}")`, extension: ".ts", expected: true },
    { label: "14 rust assignment alone", line: `const s = "${MARKER}";`, extension: ".rs", expected: false },
    { label: "15 rust comment-only", line: `// tracing::info!("${MARKER}");`, extension: ".rs", expected: false },
    { label: "16 go return not emission", line: `return "${MARKER}";`, extension: ".go", expected: false },
    {
      label: "17 rust indirect",
      line: `const MARKER: &str = "${MARKER}";\ntracing::info!("{}", MARKER);`,
      extension: ".rs",
      expected: true,
    },
    {
      label: "18 go indirect",
      line: `const marker = "${MARKER}"\nslog.Info(marker)`,
      extension: ".go",
      expected: true,
    },
    {
      label: "19 unknown extension union fallback",
      line: `tracing::info!("${MARKER}")`,
      extension: undefined,
      expected: true,
    },
    {
      // Pins language-aware selection itself. `.Msg(` is a Go/zerolog shape that
      // no DEFAULT pattern matches, so a .ts file must NOT credit it. Without a
      // filePath the union fallback would match, which is why every other
      // positive case passes with or without threading - only this one fails.
      label: "20 go-only emission shape is not credited in a .ts file",
      line: `foo.Msg("${MARKER}")`,
      extension: ".ts",
      expected: false,
    },
    {
      label: "21 same go-only shape is credited in a .go file",
      line: `foo.Msg("${MARKER}")`,
      extension: ".go",
      expected: true,
    },
  ];

  for (const { label, line, extension, expected } of cases) {
    it(label, () => {
      expect(matches(line, extension)).toBe(expected);
    });
  }
});
