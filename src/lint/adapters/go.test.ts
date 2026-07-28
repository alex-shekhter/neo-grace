import { describe, expect, it } from "bun:test";

import { createGoAdapter, scanTopLevelDeclarations } from "./go";
import { stripGoNoise } from "../scanners/go-lexer";

const adapter = createGoAdapter();

function analyze(source: string, filePath = "example.go") {
  return adapter.analyze(filePath, source);
}

describe("GoAdapter.supports", () => {
  it("returns true only for .go files", () => {
    expect(adapter.supports("x.go")).toBe(true);
    expect(adapter.supports("x.ts")).toBe(false);
    expect(adapter.supports("x.rs")).toBe(false);
  });

  it("has adapter id go", () => {
    expect(adapter.id).toBe("go");
  });
});

describe("GoAdapter.analyze", () => {
  it("1 exported and unexported funcs", () => {
    const a = analyze(`package p\nfunc Exported() {}\nfunc unexported() {}\n`);
    expect([...a.exports]).toEqual(["Exported"]);
    expect(a.localSymbols.has("Exported")).toBe(true);
    expect(a.localSymbols.has("unexported")).toBe(true);
  });

  it("2 type exports", () => {
    const a = analyze(`package p\ntype Config struct{}\ntype internal struct{}\n`);
    expect([...a.typeExports]).toEqual(["Config"]);
    expect(a.localSymbols.has("internal")).toBe(true);
  });

  it("3 interface type", () => {
    const a = analyze(`package p\ntype Reader interface{ Read() }\n`);
    expect([...a.typeExports]).toEqual(["Reader"]);
  });

  it("4 type alias", () => {
    const a = analyze(`package p\ntype Config struct{}\ntype Alias = Config\n`);
    expect(a.typeExports.has("Alias")).toBe(true);
  });

  it("5 var exports", () => {
    const a = analyze(`package p\nvar Version = "1"\nvar debug = false\n`);
    expect([...a.valueExports]).toEqual(["Version"]);
  });

  it("6 const export", () => {
    const a = analyze(`package p\nconst MaxSize = 10\n`);
    expect([...a.valueExports]).toEqual(["MaxSize"]);
  });

  it("7 grouped const iota", () => {
    const a = analyze(`package p\nconst (\n\tA = iota\n\tb\n\tC\n)\n`);
    expect([...a.valueExports].sort()).toEqual(["A", "C"]);
    expect(a.localSymbols.has("b")).toBe(true);
    expect(a.valueExports.has("b")).toBe(false);
  });

  it("8 grouped var", () => {
    const a = analyze(`package p\nvar (\n\tX = 1\n\ty = 2\n)\n`);
    expect([...a.valueExports]).toEqual(["X"]);
  });

  it("9 grouped type", () => {
    const a = analyze(`package p\ntype (\n\tFoo struct{}\n\tbar struct{}\n)\n`);
    expect([...a.typeExports]).toEqual(["Foo"]);
  });

  it("10 methods are locals only, never package exports", () => {
    const a = analyze(`package p\ntype Server struct{}\nfunc (s *Server) Serve() {}\n`);
    expect(a.exports.has("Serve")).toBe(false);
    expect(a.localSymbols.has("Serve")).toBe(true);
  });

  it("11 generic func name", () => {
    const a = analyze(`package p\nfunc Map[K comparable, V any](m map[K]V) []K { return nil }\n`);
    expect([...a.exports]).toEqual(["Map"]);
  });

  it("12 generic type", () => {
    const a = analyze(`package p\ntype Set[T comparable] struct{}\n`);
    expect([...a.typeExports]).toEqual(["Set"]);
  });

  it("13 body decls invisible", () => {
    const a = analyze(`package p\nfunc Exported() { const Fake = 1 }\n`);
    expect([...a.exports]).toEqual(["Exported"]);
    expect(a.localSymbols.has("Fake")).toBe(false);
  });

  it("14 comment does not invent export — fails if lexer bypassed", () => {
    const a = analyze(`package p\n// func Fake()\n`);
    expect([...a.exports]).toEqual([]);
    // Discriminating: stripGoNoise must blank the comment body.
    expect(stripGoNoise(`// func Fake()\n`)).not.toContain("func");
  });

  it("15 raw string inside func does not invent export", () => {
    const a = analyze("package p\nfunc Real() {\n\ts := `func Fake()`\n}\n");
    expect(a.exports.has("Fake")).toBe(false);
    expect([...a.exports]).toEqual(["Real"]);
  });

  it("15b multi-line raw string does not invent export — fails if lexer bypassed", () => {
    // Single-line strings after `=` are skipped by the declaration scanner even
    // without the lexer. Multi-line raw strings are the seam that requires
    // stripGoNoise: the scanner's skip-to-EOL only covers the opening line.
    const source = "package p\nconst doc = `\nfunc Fake() {}\n`\nfunc Real() {}\n";
    const a = analyze(source);
    expect(a.exports.has("Fake")).toBe(false);
    expect([...a.exports]).toEqual(["Real"]);
    // Discriminating negatives: unstripped scan invents Fake; stripped does not.
    const unstripped = scanTopLevelDeclarations(source);
    expect(unstripped.some((d) => d.name === "Fake")).toBe(true);
    const stripped = scanTopLevelDeclarations(stripGoNoise(source));
    expect(stripped.some((d) => d.name === "Fake")).toBe(false);
  });

  it("16 package main with main has entrypoint", () => {
    const a = analyze(`package main\nfunc main() {}\n`);
    expect(a.hasMainEntrypoint).toBe(true);
  });

  it("17 non-main package main func is not entrypoint", () => {
    const a = analyze(`package p\nfunc main() {}\n`);
    expect(a.hasMainEntrypoint).toBe(false);
  });

  it("18 testing import and TestX", () => {
    const a = analyze(`package p\nimport "testing"\nfunc TestX(t *testing.T) {}\n`);
    expect(a.usesTestFramework).toBe(true);
  });

  it("19 BenchmarkX alone marks test framework", () => {
    const a = analyze(`package p\nfunc BenchmarkX(b *testing.B) {}\n`);
    expect(a.usesTestFramework).toBe(true);
  });

  it("20 go:build is heuristic", () => {
    const a = analyze(`//go:build linux\n\npackage p\nfunc Exported() {}\n`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("21 +build is heuristic", () => {
    const a = analyze(`// +build linux\n\npackage p\nfunc Exported() {}\n`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("22 import C is heuristic", () => {
    const a = analyze(`package p\nimport "C"\nfunc Exported() {}\n`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("23 ordinary file is exact", () => {
    const a = analyze(`package p\nfunc Exported() {}\n`);
    expect(a.exportConfidence).toBe("exact");
  });

  it("24 blank identifier never appears", () => {
    const a = analyze(`package p\nvar _ = something\n`);
    expect(a.exports.has("_")).toBe(false);
    expect(a.localSymbols.has("_")).toBe(false);
    expect(a.valueExports.has("_")).toBe(false);
  });

  it("25 multi-name var", () => {
    const a = analyze(`package p\nvar A, B = 1, 2\n`);
    expect([...a.valueExports].sort()).toEqual(["A", "B"]);
  });

  it("26 truncated invalid Go does not throw; confidence heuristic", () => {
    expect(() => analyze(`package p\nfunc Broken(`)).not.toThrow();
    const a = analyze(`package p\nfunc Broken(`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("27 unicode identifiers", () => {
    const a = analyze(`package p\nfunc Ünicode() {}\n`);
    expect([...a.exports]).toEqual(["Ünicode"]);
  });

  it("28 init is local only", () => {
    const a = analyze(`package p\nfunc init() {}\n`);
    expect([...a.exports]).toEqual([]);
    expect(a.localSymbols.has("init")).toBe(true);
  });

  // Review: multi-line bodies inside type/var groups must not invent field/method names.
  it("29 grouped multi-line struct exports only the type name", () => {
    const a = analyze(`package p\ntype (\n\tFoo struct {\n\t\tName string\n\t\tAge int\n\t}\n)\n`);
    expect([...a.exports].sort()).toEqual(["Foo"]);
    expect(a.exports.has("Name")).toBe(false);
    expect(a.exports.has("Age")).toBe(false);
    expect(a.exportConfidence).toBe("exact");
  });

  it("30 grouped multi-line interface exports only the type name", () => {
    const a = analyze(`package p\ntype (\n\tStore interface {\n\t\tGet(k string) error\n\t}\n)\n`);
    expect([...a.exports]).toEqual(["Store"]);
    expect(a.exports.has("Get")).toBe(false);
    expect(a.exportConfidence).toBe("exact");
  });

  it("31 grouped multi-line composite literal exports only the var name", () => {
    const a = analyze(`package p\nvar (\n\tClient = &http.Client{\n\t\tTimeout: 5,\n\t}\n)\n`);
    expect([...a.exports]).toEqual(["Client"]);
    expect(a.exports.has("Timeout")).toBe(false);
    expect(a.exportConfidence).toBe("exact");
  });

  it("32 multi-line function signature stays exact", () => {
    const a = analyze(`package p\nfunc Exported(\n\ta int,\n) error {\n\treturn nil\n}\n`);
    expect([...a.exports]).toEqual(["Exported"]);
    expect(a.exportConfidence).toBe("exact");
  });
});
