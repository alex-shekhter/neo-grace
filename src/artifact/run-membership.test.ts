import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import * as runMembership from "./run-membership";
import * as graceCursor from "../grace-cursor";
import {
  listLooseEvents as listLooseEventsFromArtifact,
  listRunOrphans as listRunOrphansFromArtifact,
} from "./run-membership";
import {
  listLooseEvents as listLooseEventsFromCursor,
  listRunOrphans as listRunOrphansFromCursor,
} from "../grace-cursor";

/**
 * AC-MEMBERSHIP-ONE-DEFINITION (construction, not output-only).
 * Primary proof: re-export identity is the same function object (===).
 * Secondary: exactly one production implementation body under run-membership.ts.
 */
describe("run-membership extract (C-REPORT-HONESTY T-001)", () => {
  it("re-exports the same function objects as grace-cursor (=== identity)", () => {
    expect(listLooseEventsFromCursor).toBe(listLooseEventsFromArtifact);
    expect(listRunOrphansFromCursor).toBe(listRunOrphansFromArtifact);
  });

  it("parseAllocationNode stays private (not on either module namespace)", () => {
    // Was private in grace-cursor before the extract; must not become public API.
    expect("parseAllocationNode" in runMembership).toBe(false);
    expect("parseAllocationNode" in graceCursor).toBe(false);
  });

  it("has exactly one production listLooseEvents / listRunOrphans body under run-membership", () => {
    const srcRoot = path.resolve(import.meta.dir, "..");
    const productionBodies: { file: string; kind: string }[] = [];

    function walk(dir: string) {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (name.name === "node_modules" || name.name.endsWith(".test.ts")) continue;
        const full = path.join(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.name.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        // Secondary check only (a `const` form would evade — F10). Primary is === above.
        if (/export function listLooseEvents\s*\(/.test(text)) {
          productionBodies.push({ file: path.relative(srcRoot, full), kind: "listLooseEvents" });
        }
        if (/export function listRunOrphans\s*\(/.test(text)) {
          productionBodies.push({ file: path.relative(srcRoot, full), kind: "listRunOrphans" });
        }
      }
    }
    walk(srcRoot);

    expect(productionBodies.filter((b) => b.kind === "listLooseEvents")).toEqual([
      { file: "artifact/run-membership.ts", kind: "listLooseEvents" },
    ]);
    expect(productionBodies.filter((b) => b.kind === "listRunOrphans")).toEqual([
      { file: "artifact/run-membership.ts", kind: "listRunOrphans" },
    ]);
  });
});
