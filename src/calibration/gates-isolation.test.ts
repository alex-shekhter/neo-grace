import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * AC-NO-GATE-READS (D6 condition 2 / §9.5.2 second half).
 *
 * A real test: any gate module that imports, reads, or pattern-matches
 * claimedConfidence / claimed-confidence fails this suite.
 *
 * Mutation witness (stage-2 report): temporarily add a reference to
 * claimedConfidence in src/gates/core.ts → this test goes red; remove → green.
 * Grep in a phase report is not this test.
 */

const GATES_DIR = path.join(import.meta.dir, "..", "gates");
const FORBIDDEN = /claimedConfidence|claimed-confidence|CLAIMED_CONFIDENCE/i;

function listGateSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listGateSourceFiles(full));
      continue;
    }
    // Production gate modules only — tests may mention the field to document isolation.
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out.sort();
}

describe("AC-NO-GATE-READS — no gate module reads claimedConfidence", () => {
  it("src/gates/ production sources never mention claimedConfidence", () => {
    const files = listGateSourceFiles(GATES_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.test(text)) {
        violations.push(path.relative(path.join(import.meta.dir, "..", ".."), file));
      }
    }
    expect(violations).toEqual([]);
  });
});
