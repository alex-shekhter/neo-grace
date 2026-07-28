import { expect, test, describe } from "bun:test";
import { checkModuleCheckReferences, expandCommandTargets } from "./check-references.ts";

describe("checkModuleCheckReferences", () => {
  test("returns true when all testFiles are referenced", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/a.test.ts"])).toBe(true);
  });

  test("returns false when a testFile is not found", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/b.test.ts"])).toBe(false);
  });

  test("without cwd, compares testFiles as-is", () => {
    expect(checkModuleCheckReferences(["auth/src/auth.test.ts"], ["bun test auth/src/auth.test.ts"])).toBe(true);
    expect(checkModuleCheckReferences(["auth/src/auth.test.ts"], ["bun test src/b.test.ts"])).toBe(false);
  });

  test("with cwd, strips cwd prefix from testFile", () => {
    expect(checkModuleCheckReferences(["packages/auth/src/auth.test.ts"], ["bun test src/auth.test.ts"], "packages/auth")).toBe(true);
    expect(checkModuleCheckReferences(["packages/auth/src/auth.test.ts"], ["bun test other.test.ts"], "packages/auth")).toBe(false);
  });

  test("normalizes Windows separators before Cwd-relative comparison", () => {
    expect(checkModuleCheckReferences(["packages\\auth\\src\\auth.test.ts"], ["bun test src/auth.test.ts"], "packages\\auth")).toBe(true);
    expect(checkModuleCheckReferences(["packages\\auth\\src\\auth.test.ts"], ["bun test src\\auth.test.ts"], "packages\\auth")).toBe(true);
  });

  test("with cwd that does not match testFile prefix, no stripping", () => {
    expect(checkModuleCheckReferences(["packages/web/src/test.ts"], ["bun test packages/web/src/test.ts"], "packages/auth")).toBe(true);
    expect(checkModuleCheckReferences(["packages/web/src/test.ts"], ["bun test other.test.ts"], "packages/auth")).toBe(false);
  });

  test("with cwd='.' treated as absent — no stripping", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/a.test.ts"], ".")).toBe(true);
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/b.test.ts"], ".")).toBe(false);
  });

  test("with cwd='' treated as absent — no stripping", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/a.test.ts"], "")).toBe(true);
  });

  test("returns true when testFiles is empty", () => {
    expect(checkModuleCheckReferences([], ["bun test anything.ts"])).toBe(true);
  });

  test("directory match via dirname", () => {
    expect(checkModuleCheckReferences(["src/auth.test.ts"], ["bun test src/"])).toBe(true);
  });

  test("returns false when at least one testFile is missing from moduleChecks", () => {
    expect(checkModuleCheckReferences(["src/auth.test.ts", "src/session.test.ts"], ["bun test src/auth.test.ts"])).toBe(false);
  });

  test("returns true when all testFiles are referenced across multiple checks", () => {
    expect(checkModuleCheckReferences(["src/auth.test.ts", "src/session.test.ts"], ["bun test src/auth.test.ts src/session.test.ts"])).toBe(true);
  });

  // Phase 4 — language-aware inference (G-12)
  test("1 go test package path with cwd", () => {
    expect(checkModuleCheckReferences(
      ["services/gateway/internal/router/router_test.go"],
      ["go test ./internal/router/..."],
      "services/gateway",
    )).toBe(true);
  });

  test("2 go test wrong package is false", () => {
    expect(checkModuleCheckReferences(
      ["services/gateway/internal/router/router_test.go"],
      ["go test ./internal/other/..."],
      "services/gateway",
    )).toBe(false);
  });

  test("3 go test ./... covers package root", () => {
    expect(checkModuleCheckReferences(
      ["services/gateway/main_test.go"],
      ["go test ./..."],
      "services/gateway",
    )).toBe(true);
  });

  test("4 go test with no package arg means cwd", () => {
    expect(checkModuleCheckReferences(
      ["services/gateway/main_test.go"],
      ["go test"],
      "services/gateway",
    )).toBe(true);
  });

  test("5 cargo test --test name", () => {
    expect(checkModuleCheckReferences(
      ["services/ledger/tests/transfer.rs"],
      ["cargo test --test transfer"],
      "services/ledger",
    )).toBe(true);
  });

  test("6 cargo test --test other is false", () => {
    expect(checkModuleCheckReferences(
      ["services/ledger/tests/transfer.rs"],
      ["cargo test --test other"],
      "services/ledger",
    )).toBe(false);
  });

  test("7 cargo test --lib", () => {
    expect(checkModuleCheckReferences(
      ["services/ledger/src/lib.rs"],
      ["cargo test --lib"],
      "services/ledger",
    )).toBe(true);
  });

  test("8 cargo test default covers src", () => {
    expect(checkModuleCheckReferences(
      ["services/ledger/src/lib.rs"],
      ["cargo test"],
      "services/ledger",
    )).toBe(true);
  });

  test("9 cargo bench --bench", () => {
    expect(checkModuleCheckReferences(
      ["services/ledger/benches/b.rs"],
      ["cargo bench --bench b"],
      "services/ledger",
    )).toBe(true);
  });

  test("10 cargo nextest run --lib", () => {
    expect(checkModuleCheckReferences(
      ["services/ledger/src/lib.rs"],
      ["cargo nextest run --lib"],
      "services/ledger",
    )).toBe(true);
  });

  // No-regression rows 11–14
  test("11 bun test explicit file", () => {
    expect(checkModuleCheckReferences(["src/mod5.test.ts"], ["bun test src/mod5.test.ts"])).toBe(true);
  });

  test("12 bun test directory token", () => {
    expect(checkModuleCheckReferences(["src/mod5.test.ts"], ["bun test src/"])).toBe(true);
  });

  test("13 bun test with cwd strip", () => {
    expect(checkModuleCheckReferences(["packages/auth/src/a.test.ts"], ["bun test src/a.test.ts"], "packages/auth")).toBe(true);
  });

  test("14 empty testFiles", () => {
    expect(checkModuleCheckReferences([], ["go test ./..."])).toBe(true);
  });
});

describe("expandCommandTargets", () => {
  test("is purely additive for bun (empty expansion)", () => {
    expect(expandCommandTargets("bun test src/a.test.ts")).toEqual([]);
  });

  test("go test package and default cwd", () => {
    expect(expandCommandTargets("go test ./internal/router/...")).toEqual(["internal/router"]);
    expect(expandCommandTargets("go test")).toEqual(["."]);
    expect(expandCommandTargets("go test ./...")).toEqual(["."]);
  });
});
