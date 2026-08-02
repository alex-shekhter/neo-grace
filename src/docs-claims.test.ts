import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { NGRACE_ARTIFACT_VERSION } from "./artifact/types";

/**
 * The visual explainer is the first document README sends a newcomer to, and
 * nothing else validates it. Its colophon claimed "neo-grace 5.0.1" and
 * "Artifact grammar 4.0" through two major releases — a published claim about
 * what the binary enforces that nobody checked.
 *
 * These assert only the two facts that rot: no product-version literal (the
 * release flow does not update this file, so any number here goes stale), and
 * a grammar version that agrees with the one lint actually requires.
 */

const repoRoot = path.resolve(import.meta.dir, "..");
const explainerPath = path.join(repoRoot, "docs/ngrace-explainer.html");

describe("docs/ngrace-explainer.html claims", () => {
  const html = readFileSync(explainerPath, "utf8");

  it("states no product version, because nothing updates this file on release", () => {
    const productVersion = html.match(/neo-grace\s+\d+\.\d+\.\d+/);
    expect(productVersion).toBeNull();
  });

  it("names the artifact grammar version lint requires, and no other", () => {
    const grammarClaims = [...html.matchAll(/[Aa]rtifact grammar\s+(\d+\.\d+)/g)].map((m) => m[1]);
    expect(grammarClaims.length).toBeGreaterThan(0);
    for (const claimed of grammarClaims) {
      expect(claimed).toBe(NGRACE_ARTIFACT_VERSION);
    }
  });
});
