import { describe, expect, it } from "bun:test";

import { createRustAdapter } from "./rust";
import { stripRustNoise } from "../scanners/rust-lexer";

const adapter = createRustAdapter();

function analyze(source: string, filePath = "lib.rs") {
  return adapter.analyze(filePath, source);
}

describe("RustAdapter.supports", () => {
  it("returns true only for .rs files", () => {
    expect(adapter.supports("x.rs")).toBe(true);
    expect(adapter.supports("x.go")).toBe(false);
    expect(adapter.id).toBe("rust");
  });
});

// Multi-line bodies first (plan amendment): these catch Phase-2-class scanner bugs.
describe("RustAdapter multi-line bodies (write-first cases 33-40)", () => {
  it("33 multi-line enum: variants and fields are not exports", () => {
    const a = analyze(`pub enum Error {\n    NotFound { id: u64 },\n    Timeout,\n}\n`);
    expect([...a.typeExports]).toEqual(["Error"]);
    expect(a.exports.has("NotFound")).toBe(false);
    expect(a.exports.has("Timeout")).toBe(false);
    expect(a.exports.has("id")).toBe(false);
    expect(a.exportConfidence).toBe("exact");
  });

  it("34 multi-line trait: methods are locals only", () => {
    const a = analyze(`pub trait Store {\n    fn get(&self) -> Result<()>;\n    fn put(&self);\n}\n`);
    expect([...a.typeExports]).toEqual(["Store"]);
    expect(a.exports.has("get")).toBe(false);
    expect(a.exports.has("put")).toBe(false);
    expect(a.localSymbols.has("get")).toBe(true);
    expect(a.localSymbols.has("put")).toBe(true);
  });

  it("35 multi-line impl: helper is local not export", () => {
    const a = analyze(`impl Store for Db {\n    pub fn helper() {}\n}\n`);
    expect(a.exports.has("helper")).toBe(false);
    expect(a.localSymbols.has("helper")).toBe(true);
  });

  it("36 multi-line struct: pub fields are not module exports", () => {
    // The trap: pub on a field sits beside pub on the struct.
    const a = analyze(`pub struct S {\n    pub name: String,\n    pub age: u32,\n}\n`);
    expect([...a.typeExports]).toEqual(["S"]);
    expect(a.exports.has("name")).toBe(false);
    expect(a.exports.has("age")).toBe(false);
    expect(a.exportConfidence).toBe("exact");
  });

  it("37 multi-line inline mod: inner is not top-level export", () => {
    const a = analyze(`pub mod api {\n    pub fn inner() {}\n}\n`);
    expect(a.exports.has("api")).toBe(true);
    expect(a.exports.has("inner")).toBe(false);
  });

  it("38 multi-line fn signature stays exact", () => {
    const a = analyze(`pub fn f(\n    a: u32,\n    b: u32,\n) -> u32 { 0 }\n`);
    expect([...a.exports]).toEqual(["f"]);
    expect(a.exportConfidence).toBe("exact");
  });

  it("39 multi-line use tree", () => {
    const a = analyze(`pub use crate::a::{\n    Foo,\n    Bar as Baz,\n};\n`);
    expect(a.exports.has("Foo")).toBe(true);
    expect(a.exports.has("Baz")).toBe(true);
    expect(a.exports.has("Bar")).toBe(false);
  });

  it("40 multi-line const array", () => {
    const a = analyze(`pub const TABLE: [u8; 4] = [\n    1, 2,\n    3, 4,\n];\n`);
    expect([...a.valueExports]).toEqual(["TABLE"]);
  });
});

describe("RustAdapter.analyze", () => {
  it("1 exported and private fns", () => {
    const a = analyze(`pub fn post() {}\nfn helper() {}\n`);
    expect([...a.exports]).toEqual(["post"]);
    expect(a.localSymbols.has("post")).toBe(true);
    expect(a.localSymbols.has("helper")).toBe(true);
  });

  it("2 pub struct", () => {
    const a = analyze(`pub struct Ledger;\n`);
    expect([...a.typeExports]).toEqual(["Ledger"]);
  });

  it("3 pub enum variants not exported", () => {
    const a = analyze(`pub enum Error { A, B }\n`);
    expect([...a.typeExports]).toEqual(["Error"]);
    expect(a.exports.has("A")).toBe(false);
  });

  it("4 pub trait methods local", () => {
    const a = analyze(`pub trait Store { fn get(&self); }\n`);
    expect([...a.typeExports]).toEqual(["Store"]);
    expect(a.localSymbols.has("get")).toBe(true);
    expect(a.exports.has("get")).toBe(false);
  });

  it("5 pub type alias", () => {
    const a = analyze(`pub type Result<T> = std::result::Result<T, Error>;\n`);
    expect([...a.typeExports]).toEqual(["Result"]);
  });

  it("6 pub const", () => {
    const a = analyze(`pub const MAX: u32 = 10;\n`);
    expect([...a.valueExports]).toEqual(["MAX"]);
  });

  it("7 pub static", () => {
    const a = analyze(`pub static NAME: &str = "x";\n`);
    expect([...a.valueExports]).toEqual(["NAME"]);
  });

  it("8 pub(crate) not an export", () => {
    const a = analyze(`pub(crate) fn internal() {}\n`);
    expect(a.exports.has("internal")).toBe(false);
    expect(a.localSymbols.has("internal")).toBe(true);
  });

  it("9 pub(super) and pub(in path) not exports", () => {
    const a = analyze(`pub(super) fn s() {}\npub(in crate::a) fn t() {}\n`);
    expect(a.exports.has("s")).toBe(false);
    expect(a.exports.has("t")).toBe(false);
  });

  it("10 pub use single", () => {
    const a = analyze(`pub use crate::a::Foo;\n`);
    expect(a.exports.has("Foo")).toBe(true);
    expect(a.directReExportCount).toBe(1);
  });

  it("11 pub use group with alias", () => {
    const a = analyze(`pub use crate::a::{Foo, Bar as Baz};\n`);
    expect(a.exports.has("Foo")).toBe(true);
    expect(a.exports.has("Baz")).toBe(true);
    expect(a.exports.has("Bar")).toBe(false);
  });

  it("12 pub use wildcard", () => {
    const a = analyze(`pub use crate::a::*;\n`);
    expect(a.hasWildcardReExport).toBe(true);
  });

  it("13 private use not exported", () => {
    const a = analyze(`use crate::a::Foo;\n`);
    expect(a.exports.has("Foo")).toBe(false);
    expect(a.directReExportCount).toBe(0);
  });

  it("14 pub mod", () => {
    const a = analyze(`pub mod api;\n`);
    expect(a.typeExports.has("api")).toBe(true);
  });

  it("15 macro_export", () => {
    const a = analyze(`#[macro_export]\nmacro_rules! m { () => {} }\n`);
    expect(a.exports.has("m")).toBe(true);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("16 private macro_rules", () => {
    const a = analyze(`macro_rules! m { () => {} }\n`);
    expect(a.exports.has("m")).toBe(false);
    expect(a.localSymbols.has("m")).toBe(true);
  });

  it("17 pub async fn", () => {
    const a = analyze(`pub async fn a() {}\n`);
    expect([...a.exports]).toEqual(["a"]);
  });

  it("18 pub const fn", () => {
    const a = analyze(`pub const fn c() -> u8 { 0 }\n`);
    expect([...a.exports]).toEqual(["c"]);
  });

  it("19 pub unsafe fn", () => {
    const a = analyze(`pub unsafe fn u() {}\n`);
    expect([...a.exports]).toEqual(["u"]);
  });

  it("20 pub extern C fn", () => {
    const a = analyze(`pub extern "C" fn e() {}\n`);
    expect([...a.exports]).toEqual(["e"]);
  });

  it("21 impl methods local only", () => {
    const a = analyze(`impl Ledger { pub fn post(&self) {} }\n`);
    expect(a.exports.has("post")).toBe(false);
    expect(a.localSymbols.has("post")).toBe(true);
  });

  it("22 generics with nested angle brackets", () => {
    const a = analyze(`pub fn f<T: Into<String>>(x: T) {}\n`);
    expect([...a.exports]).toEqual(["f"]);
  });

  it("23 cfg test and #[test]", () => {
    const a = analyze(`#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {}\n}\n`);
    expect(a.usesTestFramework).toBe(true);
  });

  it("24 main entrypoint", () => {
    const a = analyze(`fn main() {}\n`);
    expect(a.hasMainEntrypoint).toBe(true);
  });

  it("25 cfg feature heuristic", () => {
    const a = analyze(`#[cfg(feature = "x")]\npub fn f() {}\n`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("26 include! heuristic", () => {
    const a = analyze(`include!("generated.rs");\n`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("27 plain file exact", () => {
    const a = analyze(`pub fn post() {}\n`);
    expect(a.exportConfidence).toBe("exact");
  });

  it("28 nested comments do not invent export", () => {
    const a = analyze(`/* /* pub fn fake */ */ pub fn real() {}\n`);
    expect([...a.exports]).toEqual(["real"]);
    expect(stripRustNoise(`/* /* pub fn fake */ */`)).not.toContain("fake");
  });

  it("29 raw string inside fn does not invent export", () => {
    const a = analyze(`fn outer() {\n    let s = r#"pub fn fake"#;\n}\npub fn real() {}\n`);
    expect(a.exports.has("fake")).toBe(false);
    expect([...a.exports]).toEqual(["real"]);
  });

  it("30 lifetimes do not hang; real export found", () => {
    const a = analyze(`fn f<'a>(x: &'a str) {}\npub fn real() {}\n`);
    expect([...a.exports]).toEqual(["real"]);
  });

  it("31 truncated does not throw; heuristic", () => {
    expect(() => analyze(`pub fn broken(`)).not.toThrow();
    const a = analyze(`pub fn broken(`);
    expect(a.exportConfidence).toBe("heuristic");
  });

  it("32 pub union", () => {
    const a = analyze(`pub union U { a: u32 }\n`);
    expect([...a.typeExports]).toEqual(["U"]);
    expect(a.exports.has("a")).toBe(false);
  });

  it("41 raw identifier fn r#type", () => {
    const a = analyze(`pub fn r#type() {}\n`);
    expect([...a.exports]).toEqual(["r#type"]);
    expect(a.exports.has("r")).toBe(false);
    expect(a.exportConfidence).toBe("exact");
  });

  it("42 raw identifier struct r#match", () => {
    const a = analyze(`pub struct r#match;\n`);
    expect([...a.typeExports]).toEqual(["r#match"]);
    expect(a.exports.has("r")).toBe(false);
  });
});
