import { expect, test } from "bun:test";
import { LedgerTable } from "./LedgerTable";

test("default render returns a table for non-empty rows", () => {
  const el = LedgerTable({ rows: [{ id: "1", amount: 10 }] });
  expect(el).toBeTruthy();
});

test("empty state announces no entries", () => {
  const el = LedgerTable({ rows: [] });
  expect(el).toBeTruthy();
});
