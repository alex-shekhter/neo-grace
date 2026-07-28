import { describe, expect, it } from "bun:test";

import { stripGoNoise } from "./go-lexer";

/** Every fixture must preserve length and newline count (plan invariants 7 & 8). */
function assertStructuralInvariants(input: string, output: string) {
  expect(output.length).toBe(input.length);
  expect(output.split("\n").length).toBe(input.split("\n").length);
}

const FIXTURES: Array<{ label: string; input: string; assert: (output: string) => void }> = [
  {
    label: "1 line comment blanks func",
    input: `// func Fake()\npackage p\n`,
    assert: (output) => {
      expect(output).not.toContain("func");
      expect(output).toContain("package");
    },
  },
  {
    label: "2 block comment blanks Fake, keeps Real",
    input: `/* func Fake() */ func Real() {}\n`,
    assert: (output) => {
      expect(output).toContain("Real");
      expect(output).not.toMatch(/func\s+Fake/);
      expect(output).toMatch(/func\s+Real/);
    },
  },
  {
    label: "3 interpreted string blanks func",
    input: `s := "func Fake()"\n`,
    assert: (output) => {
      expect(output).not.toContain("func");
    },
  },
  {
    label: "4 raw string blanks func and preserves newlines",
    input: "s := `func Fake()\nfunc Also()`\n",
    assert: (output) => {
      expect(output).not.toContain("func");
      expect(output.split("\n").length).toBe(3);
    },
  },
  {
    label: "5 escaped quote does not end string early",
    input: `s := "a\\"func Fake()\\""\n`,
    assert: (output) => {
      expect(output).not.toContain("func");
    },
  },
  {
    label: "6 rune with escaped quote then Real",
    input: `r := '\\''\nfunc Real() {}\n`,
    assert: (output) => {
      expect(output).toMatch(/func\s+Real/);
    },
  },
  {
    label: "9 unterminated interpreted string at EOF",
    input: `s := "unterminated`,
    assert: (output) => {
      expect(output.length).toBe(`s := "unterminated`.length);
    },
  },
  {
    label: "10 unterminated raw string at EOF",
    input: "s := `unterminated",
    assert: (output) => {
      expect(output.length).toBe("s := `unterminated".length);
    },
  },
  // Discriminating bypass guard (review note): if stripGoNoise is identity, this
  // still contains "func Fake" and the declaration scanner would invent Fake.
  {
    label: "bypass-guard top-level string hides package-level Fake",
    input: `package p\nvar s = "func Fake()"\nfunc Real() {}\n`,
    assert: (output) => {
      expect(output).not.toMatch(/func\s+Fake/);
      expect(output).toMatch(/func\s+Real/);
    },
  },
];

describe("stripGoNoise", () => {
  for (const fixture of FIXTURES) {
    it(fixture.label, () => {
      const output = stripGoNoise(fixture.input);
      assertStructuralInvariants(fixture.input, output);
      fixture.assert(output);
    });
  }

  it("assert structural invariants across every fixture in a single loop", () => {
    for (const fixture of FIXTURES) {
      const output = stripGoNoise(fixture.input);
      assertStructuralInvariants(fixture.input, output);
    }
  });

  it("returns without throwing on empty input", () => {
    expect(stripGoNoise("")).toBe("");
  });
});
