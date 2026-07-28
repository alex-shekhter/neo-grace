import { describe, expect, it } from "bun:test";

import { stripRustNoise } from "./rust-lexer";

function assertStructuralInvariants(input: string, output: string) {
  expect(output.length).toBe(input.length);
  expect(output.split("\n").length).toBe(input.split("\n").length);
  // Newline positions preserved
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] === "\n") {
      expect(output[i]).toBe("\n");
    }
  }
}

const FIXTURES: Array<{ label: string; input: string; assert: (output: string) => void }> = [
  {
    // #1 nested block comments — the #1 Rust lexer bug if copied from Go
    label: "1 nested block comments blank Fake keep Real",
    input: `/* /* pub fn Fake */ */ pub fn Real() {}\n`,
    assert: (output) => {
      expect(output).toMatch(/pub\s+fn\s+Real/);
      expect(output).not.toMatch(/pub\s+fn\s+Fake/);
      expect(output).not.toContain("Fake");
    },
  },
  {
    label: "2 doc line comment",
    input: `/// pub fn Fake\npub fn Real() {}\n`,
    assert: (output) => {
      expect(output).not.toMatch(/fn\s+Fake/);
      expect(output).toMatch(/fn\s+Real/);
    },
  },
  {
    label: "3 inner doc line comment",
    input: `//! pub fn Fake\npub fn Real() {}\n`,
    assert: (output) => {
      expect(output).not.toMatch(/fn\s+Fake/);
    },
  },
  {
    label: "4 raw string r#",
    input: `let s = r#"pub fn Fake"#;\n`,
    assert: (output) => {
      expect(output).not.toContain("Fake");
      expect(output).not.toMatch(/fn\s+Fake/);
    },
  },
  {
    label: "5 raw string r## with inner quote-hash",
    input: `let s = r##"pub fn "# Fake"##;\n`,
    assert: (output) => {
      expect(output).not.toContain("Fake");
    },
  },
  {
    label: "6 lifetime then Real",
    input: `fn f<'a>(x: &'a str) {}\npub fn Real() {}\n`,
    assert: (output) => {
      expect(output).toContain("'a");
      expect(output).toMatch(/pub\s+fn\s+Real/);
    },
  },
  {
    label: "7 escaped char quote then Real",
    input: `let c = '\\'';\npub fn Real() {}\n`,
    assert: (output) => {
      expect(output).toMatch(/pub\s+fn\s+Real/);
    },
  },
  {
    label: "8 unicode char escape then Real",
    input: `let c = '\\u{1F600}';\npub fn Real() {}\n`,
    assert: (output) => {
      expect(output).toMatch(/pub\s+fn\s+Real/);
    },
  },
  {
    label: "9 struct with lifetimes then Real",
    input: `struct S<'a, T: 'a> { x: &'a T }\npub fn Real() {}\n`,
    assert: (output) => {
      expect(output).toMatch(/pub\s+fn\s+Real/);
      expect(output).toContain("'a");
    },
  },
  {
    label: "12 unterminated raw string at EOF",
    input: `let s = r#"unterminated`,
    assert: (output) => {
      expect(output.length).toBe(`let s = r#"unterminated`.length);
    },
  },
];

describe("stripRustNoise", () => {
  for (const fixture of FIXTURES) {
    it(fixture.label, () => {
      const output = stripRustNoise(fixture.input);
      assertStructuralInvariants(fixture.input, output);
      fixture.assert(output);
    });
  }

  it("assert length and newline invariants across every fixture", () => {
    for (const fixture of FIXTURES) {
      assertStructuralInvariants(fixture.input, stripRustNoise(fixture.input));
    }
  });

  it("nested comment still blanks if Go-style non-nesting would leave Fake", () => {
    // Discriminating: non-nesting would close at first */, leaving `*/ pub fn Fake */`
    // and then Fake would remain. Nested correctly blanks everything through outer */.
    const input = `/* outer /* inner pub fn Fake */ still comment */\npub fn Real() {}\n`;
    const output = stripRustNoise(input);
    expect(output).not.toContain("Fake");
    expect(output).toMatch(/pub\s+fn\s+Real/);
  });
});
