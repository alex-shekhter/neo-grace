// START_MODULE_CONTRACT
//   PURPOSE: C-APPLY-VERB CloseEvidence instrument
//   SCOPE: Post-archive assertion over this bundle's own gate=applied write Decisions
//   DEPENDS: M-GRAMMAR
//   LINKS: M-TEST-SUPPORT
//   ROLE: SCRIPT
//   MAP_MODE: LOCALS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   archiveDir
//   ledgerPath
//   repositoryRoot
// END_MODULE_MAP
//
// AC-DOGFOOD CloseEvidence instrument (C-APPLY-VERB). Not named .test.ts or
// .spec.ts, so default bun test and validate:ci never collect it; it is driven
// explicitly at the close: bun test --timeout=30000
// ./src/test-support/c-apply-verb-close-evidence.ts
//
// The repository root resolves from the process cwd (or the file's own
// location), never an absolute path, so a whole-repository copy reads the copy
// (F235). While the bundle is still active this file exits non-zero — that red
// is the in-flight state, not a task pair (F45).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "bun:test";

import { parseGraceXmlArtifact } from "../artifact/xml";

function repositoryRoot(): string {
  const fromCwd = process.cwd();
  if (existsSync(path.join(fromCwd, ".ngrace", "changes"))) return fromCwd;
  return path.resolve(import.meta.dir, "..", "..");
}

const archiveDir = path.join(repositoryRoot(), ".ngrace", "changes", "archive", "C-APPLY-VERB");
const ledgerPath = path.join(archiveDir, "run-ledger.xml");

describe("C-APPLY-VERB close evidence (AC-DOGFOOD)", () => {
  it("the archived run-ledger carries two gate=applied permitting Decisions, spec then plan, each fingerprinting its applied bytes", () => {
    // Existence is asserted, never skipped or early-returned on absence.
    expect(existsSync(archiveDir), `archive bundle missing at ${archiveDir}`).toBe(true);
    expect(existsSync(ledgerPath), `run-ledger.xml missing at ${ledgerPath}`).toBe(true);
    const artifact = parseGraceXmlArtifact(ledgerPath, readFileSync(ledgerPath, "utf8"));
    expect(artifact.root, "run-ledger.xml parses with the shipped parser").not.toBeNull();
    const wrapper = artifact.root!.children.find((child) => child.tag === "C-APPLY-VERB");
    expect(wrapper, "the C-APPLY-VERB wrapper exists in the ledger").toBeDefined();
    const decisions = wrapper!.children.find((child) => child.tag === "Decisions");
    expect(decisions, "the Decisions section exists in the ledger").toBeDefined();
    const appliedDecisions = decisions!.children.filter(
      (child) => child.tag === "Decision" && (child.attributes.gate ?? "") === "applied",
    );
    expect(appliedDecisions, "exactly two gate=applied Decisions").toHaveLength(2);
    // Document order: artifact spec then artifact plan.
    expect(appliedDecisions[0]!.attributes.artifact ?? "", "first write Decision targets spec").toBe("spec");
    expect(appliedDecisions[1]!.attributes.artifact ?? "", "second write Decision targets plan").toBe("plan");
    const byArtifact: Array<readonly [0 | 1, string]> = [
      [0, "spec.xml"],
      [1, "plan.xml"],
    ];
    for (const [index, name] of byArtifact) {
      const decision = appliedDecisions[index]!;
      expect(decision.attributes.decision ?? "", `${name}: the write Decision is a permit`).toBe("permit");
      const fingerprint = decision.attributes.fingerprint ?? "";
      expect(fingerprint, `${name}: the fingerprint is SHA-256 lowercase hex`).toMatch(/^[0-9a-f]{64}$/);
      const appliedBytes = readFileSync(path.join(archiveDir, name));
      const expected = createHash("sha256").update(appliedBytes).digest("hex");
      expect(fingerprint, `${name}: the fingerprint equals the applied bytes on disk`).toBe(expected);
    }
  });
});