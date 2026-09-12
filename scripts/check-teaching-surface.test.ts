import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkApprovalLexicon,
  checkClaimedShapes,
  checkDocsAndExamplesDecision,
  checkPolyglotDefault,
  checkRecordTokens,
  checkTaughtRules,
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
Use one approval request per message, one artifact, nothing else asked. Then record the ratifying phrase verbatim.
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

  it("lexicon-f152-needle: returns non-zero when an otherwise complete lexicon lacks one approval request per message", () => {
    const root = isolatedRoot();
    const missingF152 = `<approval_lexicon>
Sufficient approving phrases: the standalone word approved; the phrase I approve; the phrase approve this spec or approve this plan matching the artifact.
Named non-approvals: looks good; continue; any question.
A question is not an approval even when it contains an approving word.
</approval_lexicon>
`;
    plantSkills(
      root,
      completeBodies({
        "skills/ngrace/ngrace-spec/SKILL.md": missingF152,
      }),
    );
    expect(checkApprovalLexicon(root)).not.toBe(0);
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

// ---------------------------------------------------------------------------
// C-TAUGHT-RULES T-001: checkRecordTokens's isolated contract. Written
// red-first: the export is absent from the runner at this state, so the suite
// reds on the import before the production edit lands.
// ---------------------------------------------------------------------------

const GOVERNED_SKILLS = ["ngrace-spec", "ngrace-plan", "ngrace-execute", "ngrace-reviewer"] as const;
const GOVERNED_TREES = ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const;

const GOVERNED_RELATIVES = GOVERNED_TREES.flatMap((tree) =>
  GOVERNED_SKILLS.map((skill) => `${tree}/${skill}/SKILL.md`),
);

const TOKEN_CLEAN_BODY = "Teaching prose with no governed tokens.\n";

function plantGovernedSkills(root: string, bodies: Record<string, string> = {}): void {
  for (const relative of GOVERNED_RELATIVES) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bodies[relative] ?? TOKEN_CLEAN_BODY);
  }
}

function captureStderr(fn: () => number): { code: number; output: string } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { code: fn(), output: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

describe("checkRecordTokens", () => {
  it("returns zero on a carrier-absent clean fixture in both trees", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root);
    expect(checkRecordTokens(root)).toBe(0);
  });

  it("returns non-zero naming the file and token when an F-token is planted", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root, {
      "plugins/ngrace/skills/ngrace/ngrace-reviewer/SKILL.md": "cites F999 here\n",
    });
    const { code, output } = captureStderr(() => checkRecordTokens(root));
    expect(code).not.toBe(0);
    expect(output).toContain("plugins/ngrace/skills/ngrace/ngrace-reviewer/SKILL.md");
    expect(output).toContain("F999");
  });

  it("returns non-zero naming the file and needle when RM-GOVERNED-PATH is planted", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root, {
      "skills/ngrace/ngrace-plan/SKILL.md": "names RM-GOVERNED-PATH\n",
    });
    const { code, output } = captureStderr(() => checkRecordTokens(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-plan/SKILL.md");
    expect(output).toContain("RM-GOVERNED-PATH");
  });

  it("returns non-zero naming the file and name when a governed record file name is planted", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root, {
      "skills/ngrace/ngrace-reviewer/SKILL.md": "reads decisions.xml directly\n",
    });
    const { code, output } = captureStderr(() => checkRecordTokens(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-reviewer/SKILL.md");
    expect(output).toContain("decisions.xml");
  });

  it("stays green for a D-token immediately preceded by an RM- plan id and reds on a bare one", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root, {
      "skills/ngrace/ngrace-spec/SKILL.md": "pinned form (RM-AGENT-RELIABILITY D4) stays\n",
    });
    expect(checkRecordTokens(root)).toBe(0);

    const bareRoot = isolatedRoot();
    plantGovernedSkills(bareRoot, {
      "skills/ngrace/ngrace-spec/SKILL.md": "a bare D4 citation reds\n",
    });
    const { code, output } = captureStderr(() => checkRecordTokens(bareRoot));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-spec/SKILL.md");
    expect(output).toContain("D4");
  });

  it("decisions.md is the named exception and never reddens the scan", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root, {
      "skills/ngrace/ngrace-plan/SKILL.md": "the citation index is decisions.md\n",
    });
    expect(checkRecordTokens(root)).toBe(0);
  });

  it("does not write in check mode", () => {
    const root = isolatedRoot();
    expect(checkRecordTokens(root)).not.toBe(0);
    expect(readdirSync(root)).toEqual([]);
  });

  it(
    "real-repository token-free: the four governed skills in both trees carry no governed record token (T-002 red-first; generous timeout)",
    () => {
      expect(checkRecordTokens(REPO_ROOT)).toBe(0);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// C-TAUGHT-RULES T-004 red A: checkTaughtRules's isolated contract. The export
// is absent at this state, so the suite reds on the import.
// ---------------------------------------------------------------------------

const TAUGHT_RULES: Array<{
  skill: string;
  section: string;
  kind?: string;
  token: string;
}> = [
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "named baseline commit" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "archive arrival" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "applied-archive state" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "every module list" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "shipped parser" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "through a pipe" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "explicit generous timeout" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "shipped engine" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "both directions" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "only against an active" },
  { skill: "ngrace-spec", section: "clarifications", token: "declared nowhere else" },
  { skill: "ngrace-spec", section: "workflow", token: "stand in for the interview" },
  { skill: "ngrace-spec", section: "shape_sources", token: "rewritten wholesale" },
  { skill: "ngrace-spec", section: "status_rules", token: "revised in place" },
  { skill: "ngrace-plan", section: "must_do", token: "placeholders" },
  { skill: "ngrace-plan", section: "must_do", token: "re-home" },
  { skill: "ngrace-plan", section: "must_do", token: "on a prototype" },
  { skill: "ngrace-plan", section: "must_do", token: "other than the author" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "uncloseable bundle" },
  { skill: "ngrace-plan", section: "command_phase_rules", token: "stage the task runs" },
  { skill: "ngrace-execute", section: "execution_rules", token: "no declared task is in scope" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only cycle" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "report evidence" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "artifact whole" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "is a claim" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "forced-file set" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "both directions" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "faithful copy" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "life cycle produces next" },
];

function taughtSkillBody(skill: string, drop?: { section: string; token?: string }): string {
  const sections = new Map<string, { kind?: string; tokens: string[] }>();
  for (const rule of TAUGHT_RULES) {
    if (rule.skill !== skill) continue;
    const key = `${rule.section}${rule.kind ? `#${rule.kind}` : ""}`;
    const entry = sections.get(key) ?? { kind: rule.kind, tokens: [] };
    if (drop && drop.section === rule.section && drop.token === rule.token) {
      continue;
    }
    entry.tokens.push(rule.token);
    sections.set(key, entry);
  }
  const parts: string[] = [];
  for (const [key, entry] of sections) {
    const [section, kind] = key.split("#");
    const body = entry.tokens.map((token) => `Rule carrying ${token} in voice.`).join("\n");
    const inner = kind ? `<kind id="${kind}">\n${body}\n</kind>` : body;
    parts.push(`<${section}>\n${inner}\n</${section}>`);
  }
  return `${parts.join("\n")}\n`;
}

function plantTaughtSkills(root: string, override?: { relative: string; body: string }): void {
  for (const tree of GOVERNED_TREES) {
    for (const skill of GOVERNED_SKILLS) {
      const relative = `${tree}/${skill}/SKILL.md`;
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, override?.relative === relative ? override.body : taughtSkillBody(skill));
    }
  }
}

describe("checkTaughtRules", () => {
  it("returns zero when the twenty-nine taught tokens sit at their named section homes in both trees", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root);
    expect(checkTaughtRules(root)).toBe(0);
  });

  it("returns non-zero naming the file, section and token when one taught rule's sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-spec/SKILL.md",
      body: taughtSkillBody("ngrace-spec", { section: "acceptance_criteria_anchors", token: "named baseline commit" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-spec/SKILL.md");
    expect(output).toContain("acceptance_criteria_anchors");
    expect(output).toContain("named baseline commit");
  });

  it("returns non-zero naming the file and block when the review_judgment block is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "plugins/ngrace/skills/ngrace/ngrace-reviewer/SKILL.md",
      body: "<mechanized_first>runs</mechanized_first>\n<review_checklist>items</review_checklist>\n",
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("plugins/ngrace/skills/ngrace/ngrace-reviewer/SKILL.md");
    expect(output).toContain("review_judgment");
  });

  it(
    "real-repository taught-rules: every taught token at its named section home in both trees (generous timeout)",
    () => {
      expect(checkTaughtRules(REPO_ROOT)).toBe(0);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// C-TAUGHT-RULES T-004 red B: refusal readability — every refusal path of the
// runner names the file, the rule and the missing tokens. The shipped checks'
// refusals are the measured zero-byte form, so these assertions red until the
// diagnostics land in production.
// ---------------------------------------------------------------------------

describe("refusal readability (T-004 red B — shipped runner is silent on refusal)", () => {
  it("approval-lexicon refusal names the file, the rule and the missing non-approval", () => {
    const root = isolatedRoot();
    const missing = COMPLETE_LEXICON.replace("looks good; continue; any question.", "continue; any question.");
    plantSkills(root, completeBodies({ "skills/ngrace/ngrace-spec/SKILL.md": missing }));
    const { code, output } = captureStderr(() => checkApprovalLexicon(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-spec/SKILL.md");
    expect(output).toContain("looks good");
  });

  it("polyglot refusal names the subject and the rule", () => {
    const root = isolatedRoot();
    plantPolyglot(root, {
      "api.xml": vmEntry("V-M-A", "Marker"),
      "ui.xml": vmEntry("V-M-C", "TraceAssertion"),
    });
    const { code, output } = captureStderr(() => checkPolyglotDefault(root));
    expect(code).not.toBe(0);
    expect(output).toContain("examples/polyglot");
    expect(output).toContain("TraceAssertion");
  });

  it("template-fill refusal names the missing plant file and the rule", () => {
    const root = isolatedRoot();
    const { code, output } = captureStderr(() => checkTemplateFill(root));
    expect(code).not.toBe(0);
    expect(output).toContain("design-context-template.xml");
    expect(output).toContain("template fill");
    expect(output).toContain("missing");
  });

  it("claimed-shapes refusal names the file and the missing references path", () => {
    const root = isolatedRoot();
    plantClaimedSkills(root, {
      "ngrace-spec": "See references/missing-template.xml\n",
      "ngrace-plan": "no cites\n",
      "ngrace-design": "no cites\n",
      "ngrace-verification": "no cites\n",
      "ngrace-cli": "no cites\n",
    });
    const { code, output } = captureStderr(() => checkClaimedShapes(root));
    expect(code).not.toBe(0);
    expect(output).toContain("ngrace-spec/SKILL.md");
    expect(output).toContain("references/missing-template.xml");
  });

  it("docs-and-examples refusal names the spec file and the undecided token", () => {
    const { code, output } = captureStderr(() =>
      checkDocsAndExamplesDecision(
        specWith("<Goals><Goal>Update README.md numbers.</Goal></Goals>"),
      ),
    );
    expect(code).not.toBe(0);
    expect(output).toContain("examples/");
  });

  it("record-token refusal (already loud since T-001) names the file and the token", () => {
    const root = isolatedRoot();
    plantGovernedSkills(root, {
      "skills/ngrace/ngrace-plan/SKILL.md": "names RM-GOVERNED-PATH\n",
    });
    const { code, output } = captureStderr(() => checkRecordTokens(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-plan/SKILL.md");
    expect(output).toContain("RM-GOVERNED-PATH");
  });

  it("taught-rules refusal (production) names the file, the section and the missing token", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-spec/SKILL.md",
      body: taughtSkillBody("ngrace-spec", { section: "acceptance_criteria_anchors", token: "shipped parser" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-spec/SKILL.md");
    expect(output).toContain("acceptance_criteria_anchors");
    expect(output).toContain("shipped parser");
  });
});
