/**
 * Phase 9 — DesignReferences (G-18) and golden-path example integrity (G-20).
 *
 * Defect lessons applied:
 * - Defect 14: zero-or-more DesignReferences children need an explicit shape check
 * - Defect 8: shipped example must pass the checks this phase adds
 * - Defect 5/15: negative cases exercise both sides of validation (valid + each failure mode)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { validateChangeArtifact, validateGrace4Project } from "./grammar";
import { writeMinimalGrace4Project } from "./test-fixtures";
import { parseGraceXmlArtifact } from "./xml";
import { ARTIFACT_DIR } from "./paths";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-adoption-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function codes(result: { issues: { code: string }[] }) {
  return result.issues.map((issue) => issue.code);
}

function validSpecWithDesignRefs(designRefs: string): string {
  return (
    `<NgraceChangeSpec graceVersion="4.0" status="approved">`
    + `<C-EXAMPLE>`
    + `<Summary>Summary.</Summary>`
    + `<Goals><Goal>Goal.</Goal></Goals>`
    + `<Constraints><Constraint>Constraint.</Constraint></Constraints>`
    + `<NonGoals><NonGoal>Non-goal.</NonGoal></NonGoals>`
    + `<AcceptanceCriteria><Criterion>Accepted.</Criterion></AcceptanceCriteria>`
    + `<AffectedAreas><M-EXAMPLE /></AffectedAreas>`
    + `<VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent>`
    + designRefs
    + `</C-EXAMPLE></NgraceChangeSpec>`
  );
}

describe("Phase 9 DesignReferences (G-18)", () => {
  it("accepts well-formed Figma https URLs and contained UserResearch paths", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "docs/research/auth.md", "# Auth research\n");
    const xml = validSpecWithDesignRefs(
      `<DesignReferences>`
        + `<Figma url="https://www.figma.com/design/abc/Dashboard">Dashboard</Figma>`
        + `<Figma url="http://localhost:3000/mock">Local mock</Figma>`
        + `<UserResearch>docs/research/auth.md</UserResearch>`
      + `</DesignReferences>`,
    );
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-EXAMPLE/spec.xml`, xml);
    const result = validateGrace4Project(root);
    expect(codes(result).filter((c) => c.startsWith("change."))).toEqual([]);
  });

  it("accepts absence of DesignReferences (purely optional)", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-EXAMPLE/spec.xml`, validSpecWithDesignRefs(""));
    expect(codes(validateGrace4Project(root)).filter((c) => c.includes("design-reference") || c.includes("figma") || c.includes("user-research"))).toEqual([]);
  });

  it("rejects non-Figma/UserResearch children (zero-or-more shape check)", () => {
    // Defect 14: cardinality zero-or-more cannot protect against wrong child tags.
    const xml = validSpecWithDesignRefs(
      `<DesignReferences><Module>M-GATEWAY</Module><FigmaFile>https://figma.com/x</FigmaFile></DesignReferences>`,
    );
    const result = validateChangeArtifact(parseGraceXmlArtifact("spec.xml", xml), "active", "/tmp");
    expect(codes(result)).toContain("change.invalid-design-reference-child");
    expect(result.issues.filter((i) => i.code === "change.invalid-design-reference-child")).toHaveLength(2);
  });

  it("rejects empty, relative, javascript, and non-http Figma urls", () => {
    const cases: Array<{ url: string; label: string }> = [
      { url: "", label: "empty" },
      { url: "figma.com/file/abc", label: "relative host" },
      { url: "javascript:alert(1)", label: "javascript scheme" },
      { url: "data:text/html,hi", label: "data scheme" },
      { url: "ftp://files.example/design", label: "ftp scheme" },
      { url: "not a url", label: "garbage" },
    ];
    for (const { url } of cases) {
      const attr = url.length === 0 ? "" : ` url="${url}"`;
      const xml = validSpecWithDesignRefs(`<DesignReferences><Figma${attr}>label</Figma></DesignReferences>`);
      const result = validateChangeArtifact(parseGraceXmlArtifact("spec.xml", xml), "active");
      expect(codes(result)).toContain("change.invalid-figma-url");
    }
  });

  it("still rejects escaping UserResearch paths when no project root is supplied", () => {
    // validateChangeArtifact is exported with an optional root. Omitting it must not
    // turn the escape check into a no-op — a guard that silently disables itself is
    // worse than none, because callers believe the path was checked.
    for (const authored of ["../../etc/passwd", "/etc/passwd", "docs/../../outside.md"]) {
      const xml = validSpecWithDesignRefs(`<DesignReferences><UserResearch>${authored}</UserResearch></DesignReferences>`);
      const result = validateChangeArtifact(parseGraceXmlArtifact("spec.xml", xml), "active");
      expect(codes(result)).toContain("change.user-research-path-invalid");
    }

    const ok = validSpecWithDesignRefs(`<DesignReferences><UserResearch>docs/research/ok.md</UserResearch></DesignReferences>`);
    expect(codes(validateChangeArtifact(parseGraceXmlArtifact("spec.xml", ok), "active"))).not.toContain(
      "change.user-research-path-invalid",
    );
  });

  it("rejects empty and escaping UserResearch paths against authored input", () => {
    // Fidelity: compare validation against authored path, not a re-derived path.
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "docs/research/ok.md", "ok\n");

    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-EXAMPLE/spec.xml`,
      validSpecWithDesignRefs(`<DesignReferences><UserResearch></UserResearch></DesignReferences>`),
    );
    expect(codes(validateGrace4Project(root))).toContain("change.user-research-path-invalid");

    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-EXAMPLE/spec.xml`,
      validSpecWithDesignRefs(`<DesignReferences><UserResearch>../../etc/passwd</UserResearch></DesignReferences>`),
    );
    expect(codes(validateGrace4Project(root))).toContain("change.user-research-path-invalid");

    // Contained path is accepted even if the file does not exist yet (containment only).
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-EXAMPLE/spec.xml`,
      validSpecWithDesignRefs(`<DesignReferences><UserResearch>docs/research/planned.md</UserResearch></DesignReferences>`),
    );
    expect(codes(validateGrace4Project(root))).not.toContain("change.user-research-path-invalid");
  });
});

describe("Phase 9 golden-path example (G-20)", () => {
  it("examples/polyglot exists and lints with zero errors", () => {
    const exampleRoot = path.resolve(import.meta.dir, "../../examples/polyglot");
    expect(existsSync(exampleRoot)).toBe(true);
    expect(existsSync(path.join(exampleRoot, ".ngrace"))).toBe(true);
    const result = validateGrace4Project(exampleRoot);
    const errors = result.issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      // Surface codes for debugging when the golden path bitrots.
      expect(errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
    }
    expect(errors).toHaveLength(0);
  });
});

describe("Phase 9 catalog pins (G-18)", () => {
  it("registers DesignReferences issue codes for --explain", async () => {
    // Pin: catalog.ts alone is invisible to behavior tests; renaming a key must fail.
    const { getLintIssueGuide } = await import("../lint/catalog");
    const expected: Record<string, string> = {
      "change.invalid-design-reference-child": "Invalid DesignReferences Child",
      "change.invalid-figma-url": "Invalid Figma URL",
      "change.user-research-path-invalid": "Invalid UserResearch Path",
    };
    for (const [code, title] of Object.entries(expected)) {
      const guide = getLintIssueGuide(code);
      expect(guide.title).toBe(title);
      // Fallback explanation is shared by unregistered codes; dedicated guides are specific.
      expect(guide.explanation).not.toContain("does not yet have a dedicated explanation entry");
      expect(guide.remediation.length).toBeGreaterThan(0);
    }
  });
});
