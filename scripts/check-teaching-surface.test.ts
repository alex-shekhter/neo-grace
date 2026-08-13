import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkApprovalLexicon,
  checkClaimedShapes,
  checkDocsAndExamplesDecision,
  checkPolyglotDefault,
  checkTemplateFill,
} from "./check-teaching-surface";

const SKILL_RELATIVES = [
  "skills/ngrace/ngrace-spec/SKILL.md",
  "skills/ngrace/ngrace-plan/SKILL.md",
  "plugins/ngrace/skills/ngrace/ngrace-spec/SKILL.md",
  "plugins/ngrace/skills/ngrace/ngrace-plan/SKILL.md",
] as const;

const COMPLETE_LEXICON = `<approval_lexicon>
Sufficient approving phrases: the standalone word approved; the phrase I approve; the phrase approve this spec or approve this plan matching the artifact.
Named non-approvals: looks good; continue; any question.
A question is not an approval even when it contains an approving word.
</approval_lexicon>
`;

const tempRoots: string[] = [];

function isolatedRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-teaching-surface-"));
  tempRoots.push(root);
  return root;
}

function plantSkills(root: string, bodies: Record<(typeof SKILL_RELATIVES)[number], string>): void {
  for (const relative of SKILL_RELATIVES) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bodies[relative]);
  }
}

function completeBodies(
  override?: Partial<Record<(typeof SKILL_RELATIVES)[number], string>>,
): Record<(typeof SKILL_RELATIVES)[number], string> {
  const bodies = {} as Record<(typeof SKILL_RELATIVES)[number], string>;
  for (const relative of SKILL_RELATIVES) {
    bodies[relative] = override?.[relative] ?? COMPLETE_LEXICON;
  }
  return bodies;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("checkApprovalLexicon", () => {
  it("returns non-zero when approval_lexicon is missing under an isolated root", () => {
    const root = isolatedRoot();
    plantSkills(
      root,
      completeBodies({
        "skills/ngrace/ngrace-spec/SKILL.md": "<skill>no lexicon</skill>\n",
      }),
    );
    expect(checkApprovalLexicon(root)).not.toBe(0);
  });

  it("returns non-zero when a named non-approval is absent from the block", () => {
    const root = isolatedRoot();
    const missingLooksGood = `<approval_lexicon>
Sufficient approving phrases: approved; I approve; approve this spec.
Named non-approvals: continue; any question.
</approval_lexicon>
`;
    plantSkills(
      root,
      completeBodies({
        "skills/ngrace/ngrace-plan/SKILL.md": missingLooksGood,
      }),
    );
    expect(checkApprovalLexicon(root)).not.toBe(0);
  });

  it("returns zero when both spec and plan skills in both trees carry the block", () => {
    const root = isolatedRoot();
    plantSkills(root, completeBodies());
    expect(checkApprovalLexicon(root)).toBe(0);
  });

  it("does not write in check mode", () => {
    const root = isolatedRoot();
    expect(checkApprovalLexicon(root)).not.toBe(0);
    expect(existsSync(path.join(root, SKILL_RELATIVES[0]))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("composes the check token into validate:ci", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["validate:teaching-surface"]).toContain("check-teaching-surface");
    expect(pkg.scripts["validate:teaching-surface"]).toMatch(/(?:^|\s)check(?:\s|$)/);
    expect(pkg.scripts["validate:ci"]).toContain("validate:teaching-surface");
  });
});

describe("checkPolyglotDefault", () => {
  it("returns non-zero on an isolated-root Marker-majority fixture", () => {
    const root = isolatedRoot();
    plantPolyglot(root, {
      "api.xml": vmEntry("V-M-A", "Marker"),
      "core.xml": vmEntry("V-M-B", "Marker"),
      "ui.xml": vmEntry("V-M-C", "TraceAssertion"),
    });
    expect(checkPolyglotDefault(root)).not.toBe(0);
  });

  it("returns non-zero when Marker count is zero", () => {
    const root = isolatedRoot();
    plantPolyglot(root, {
      "api.xml": vmEntry("V-M-A", "TraceAssertion"),
      "ui.xml": vmEntry("V-M-C", "TraceAssertion"),
    });
    expect(checkPolyglotDefault(root)).not.toBe(0);
  });

  it("returns zero when TraceAssertion count is strictly greater than Marker count with at least one Marker", () => {
    const root = isolatedRoot();
    plantPolyglot(root, {
      "api.xml": vmEntry("V-M-A", "Marker"),
      "core.xml": vmEntry("V-M-B", "TraceAssertion"),
      "ui.xml": vmEntry("V-M-C", "TraceAssertion"),
    });
    expect(checkPolyglotDefault(root)).toBe(0);
  });

  it("does not write in check mode", () => {
    const root = isolatedRoot();
    expect(checkPolyglotDefault(root)).not.toBe(0);
    expect(existsSync(path.join(root, "examples/polyglot"))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

function vmEntry(id: string, evidence: "Marker" | "TraceAssertion"): string {
  return `<NgraceVerificationDocument graceVersion="1.0"><VD-X><${id}><${evidence}>x</${evidence}></${id}></VD-X></NgraceVerificationDocument>\n`;
}

function plantPolyglot(root: string, files: Record<string, string>): void {
  const dir = path.join(root, "examples/polyglot/.ngrace/verification");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body);
  }
}

const TEMPLATE_KIND_PATHS = {
  "design-context-template.xml": [
    "skills/ngrace/ngrace-spec/references/design-context-template.xml",
    "plugins/ngrace/skills/ngrace/ngrace-spec/references/design-context-template.xml",
  ],
  "design-system-template.xml": [
    "skills/ngrace/ngrace-design/references/design-system-template.xml",
    "plugins/ngrace/skills/ngrace/ngrace-design/references/design-system-template.xml",
  ],
  "migration-report-template.xml": [
    "skills/ngrace/ngrace-migrate/references/migration-report-template.xml",
    "plugins/ngrace/skills/ngrace/ngrace-migrate/references/migration-report-template.xml",
  ],
} as const;

function plantTemplateKind(root: string, filename: keyof typeof TEMPLATE_KIND_PATHS, body: string): void {
  for (const relative of TEMPLATE_KIND_PATHS[filename]) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

function plantAllTemplateKinds(
  root: string,
  bodies: Record<keyof typeof TEMPLATE_KIND_PATHS, string>,
): void {
  for (const filename of Object.keys(TEMPLATE_KIND_PATHS) as Array<keyof typeof TEMPLATE_KIND_PATHS>) {
    plantTemplateKind(root, filename, bodies[filename]);
  }
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");

function repoTemplate(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("checkTemplateFill", () => {
  it("returns non-zero when a filled design-system plant is missing under an isolated root", () => {
    const root = isolatedRoot();
    expect(checkTemplateFill(root)).not.toBe(0);
    expect(existsSync(path.join(root, TEMPLATE_KIND_PATHS["design-system-template.xml"][0]))).toBe(false);
  });

  it("returns non-zero when a filled migration-report loses a pinned child name", () => {
    const root = isolatedRoot();
    plantAllTemplateKinds(root, {
      "design-context-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["design-context-template.xml"][0]),
      "design-system-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["design-system-template.xml"][0]),
      "migration-report-template.xml": `<NgraceMigrationReport graceVersion="1.0"><Validation successful="false"><Check>ok</Check></Validation></NgraceMigrationReport>\n`,
    });
    expect(checkTemplateFill(root)).not.toBe(0);
  });

  it("returns non-zero when a filled migration-report is not well-formed XML", () => {
    const root = isolatedRoot();
    plantAllTemplateKinds(root, {
      "design-context-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["design-context-template.xml"][0]),
      "design-system-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["design-system-template.xml"][0]),
      "migration-report-template.xml": `<NgraceMigrationReport graceVersion="1.0"><Backup restorable="false"></NgraceMigrationReport>\n`,
    });
    expect(checkTemplateFill(root)).not.toBe(0);
  });

  it("returns zero when both trees match", () => {
    const root = isolatedRoot();
    plantAllTemplateKinds(root, {
      "design-context-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["design-context-template.xml"][0]),
      "design-system-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["design-system-template.xml"][0]),
      "migration-report-template.xml": repoTemplate(TEMPLATE_KIND_PATHS["migration-report-template.xml"][0]),
    });
    expect(checkTemplateFill(root)).toBe(0);
  });

  it("does not write in check mode", () => {
    const root = isolatedRoot();
    expect(checkTemplateFill(root)).not.toBe(0);
    expect(readdirSync(root)).toEqual([]);
  });
});

const CLAIMED_SKILLS = [
  "ngrace-spec",
  "ngrace-plan",
  "ngrace-design",
  "ngrace-verification",
  "ngrace-cli",
] as const;

const CLAIMED_TREES = ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const;

function plantClaimedSkills(
  root: string,
  bodies: Record<(typeof CLAIMED_SKILLS)[number], string>,
  xmlFiles?: Record<string, string>,
): void {
  for (const tree of CLAIMED_TREES) {
    for (const skill of CLAIMED_SKILLS) {
      const file = path.join(root, tree, skill, "SKILL.md");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bodies[skill]);
    }
  }
  for (const [relative, body] of Object.entries(xmlFiles ?? {})) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

describe("checkClaimedShapes", () => {
  it("returns non-zero when a cited references XML path is missing under an isolated root", () => {
    const root = isolatedRoot();
    plantClaimedSkills(root, {
      "ngrace-spec": "See references/missing-template.xml\n",
      "ngrace-plan": "no cites\n",
      "ngrace-design": "no cites\n",
      "ngrace-verification": "no cites\n",
      "ngrace-cli": "no cites\n",
    });
    expect(checkClaimedShapes(root)).not.toBe(0);
  });

  it("returns zero when every cited path exists in both trees", () => {
    const root = isolatedRoot();
    plantClaimedSkills(
      root,
      {
        "ngrace-spec": "See references/design-context-template.xml\n",
        "ngrace-plan": "See references/change-plan-template.xml\n",
        "ngrace-design": "See references/design-system-template.xml\n",
        "ngrace-verification": "no cites\n",
        "ngrace-cli": "no cites\n",
      },
      {
        "skills/ngrace/ngrace-spec/references/design-context-template.xml": "<ok />\n",
        "plugins/ngrace/skills/ngrace/ngrace-spec/references/design-context-template.xml": "<ok />\n",
        "skills/ngrace/ngrace-plan/references/change-plan-template.xml": "<ok />\n",
        "plugins/ngrace/skills/ngrace/ngrace-plan/references/change-plan-template.xml": "<ok />\n",
        "skills/ngrace/ngrace-design/references/design-system-template.xml": "<ok />\n",
        "plugins/ngrace/skills/ngrace/ngrace-design/references/design-system-template.xml": "<ok />\n",
      },
    );
    expect(checkClaimedShapes(root)).toBe(0);
  });

  it("does not write in check mode", () => {
    const root = isolatedRoot();
    expect(checkClaimedShapes(root)).not.toBe(0);
    expect(readdirSync(root)).toEqual([]);
  });
});

function specWith(sections: string): string {
  return `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-FIXTURE>${sections}</C-FIXTURE></NgraceChangeSpec>\n`;
}

describe("checkDocsAndExamplesDecision", () => {
  it("returns non-zero on a fixture spec that names neither README.md nor examples/", () => {
    const silent = specWith(
      "<Goals><Goal>No user-facing docs decision.</Goal></Goals><Constraints><Constraint>Keep scope tight.</Constraint></Constraints><NonGoals><NonGoal>Unrelated work.</NonGoal></NonGoals>",
    );
    expect(checkDocsAndExamplesDecision(silent)).not.toBe(0);
  });

  it("returns zero on a fixture that names both under NonGoal", () => {
    const decided = specWith(
      "<NonGoals><NonGoal>README.md and examples/ unchanged; no user-visible surface.</NonGoal></NonGoals>",
    );
    expect(checkDocsAndExamplesDecision(decided)).toBe(0);
  });

  it("returns non-zero when only one of the two paths is decided", () => {
    const onlyReadme = specWith("<Goals><Goal>Update README.md numbers.</Goal></Goals>");
    expect(checkDocsAndExamplesDecision(onlyReadme)).not.toBe(0);
  });
});
