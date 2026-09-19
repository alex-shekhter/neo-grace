import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkApprovalLexicon,
  checkClaimedShapes,
  checkCliTokenForms,
  checkDocsAndExamplesDecision,
  checkPolyglotDefault,
  checkRecordTokens,
  checkStaleReviewClaims,
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
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "only ceiling" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "shipped engine" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "both directions" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "only against an active" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "what must the close write" },
  { skill: "ngrace-spec", section: "clarifications", token: "declared nowhere else" },
  { skill: "ngrace-spec", section: "workflow", token: "stand in for the interview" },
  { skill: "ngrace-spec", section: "shape_sources", token: "rewritten wholesale" },
  { skill: "ngrace-spec", section: "shape_sources", token: "relative to this skill's directory" },
  { skill: "ngrace-spec", section: "shape_sources", token: "codes are namespaced" },
  { skill: "ngrace-spec", section: "status_rules", token: "revised in place" },
  { skill: "ngrace-plan", section: "must_do", token: "placeholders" },
  { skill: "ngrace-plan", section: "must_do", token: "re-home" },
  { skill: "ngrace-plan", section: "must_do", token: "on a prototype" },
  { skill: "ngrace-plan", section: "must_do", token: "other than the author" },
  { skill: "ngrace-plan", section: "must_do", token: "assert only what the bundle leaves unchanged" },
  { skill: "ngrace-plan", section: "must_do", token: "structurally redundant" },
  { skill: "ngrace-plan", section: "must_do", token: "faithful post-close copy" },
  { skill: "ngrace-plan", section: "must_do", token: "red-direction fixture" },
  { skill: "ngrace-plan", section: "must_do", token: "change.graph-anchors-miss-write-scope" },
  { skill: "ngrace-plan", section: "must_do", token: "the close writes" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "uncloseable bundle" },
  { skill: "ngrace-plan", section: "command_phase_rules", token: "stage the task runs" },
  { skill: "ngrace-execute", section: "execution_rules", token: "no declared task is in scope" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only cycle" },
  { skill: "ngrace-execute", section: "execution_rules", token: "Atomic Mechanism Exception" },
  { skill: "ngrace-execute", section: "execution_rules", token: "reverting a landed mechanism" },
  { skill: "ngrace-execute", section: "execution_rules", token: "engine-written" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "report evidence" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "interleaves them" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "simultaneous red" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "after the edit that greens it" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "artifact whole" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "is a claim" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "forced-file set" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "both directions" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "faithful copy" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "any later lawful move of the record" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "red-direction fixture" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "read the shape first" },
  { skill: "ngrace-plan", section: "must_do", token: "tree state its task leaves" },
  { skill: "ngrace-plan", section: "must_do", token: "excludes every earlier task's files" },
  { skill: "ngrace-plan", section: "must_do", token: "evaluated by nothing before the plan is approved" },
  { skill: "ngrace-plan", section: "must_do", token: "to a test slice, never a whole file" },
  { skill: "ngrace-plan", section: "must_do", token: "skips the bundle's own" },
  { skill: "ngrace-plan", section: "must_do", token: "by identity" },
  { skill: "ngrace-plan", section: "must_do", token: "design-context.xml" },
  { skill: "ngrace-plan", section: "must_do", token: "gate approve --artifact plan" },
  { skill: "ngrace-plan", section: "validation", token: "does not require an open epoch" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "status reset to draft" },
  { skill: "ngrace-plan", section: "must_do", token: ".git/info/exclude" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "exits non-zero" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "does not require an open epoch" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "selected-baseline lint" },
  { skill: "ngrace-execute", section: "execution_rules", token: "gate.apply.no-verdict" },
  { skill: "ngrace-execute", section: "execution_rules", token: "does not open a fresh epoch" },
  { skill: "ngrace-execute", section: "execution_rules", token: "hidden by the default severity" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "review.attempt-pair-unpaired-pass" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "namespace import" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "opens a new epoch" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "terminal", token: "stays on the last task" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "silently under-counts" },
  { skill: "ngrace-execute", section: "recovery_decision_table", token: "approved plan's own baseline assertion is false at HEAD" },
  { skill: "ngrace-spec", section: "status_rules", token: "skips the bundle's own" },
  { skill: "ngrace-spec", section: "status_rules", token: "by identity" },
  { skill: "ngrace-spec", section: "status_rules", token: "design-context.xml" },
  { skill: "ngrace-spec", section: "workflow", token: "skips the bundle's own" },
  { skill: "ngrace-spec", section: "workflow", token: "by identity" },
  { skill: "ngrace-spec", section: "docs_and_examples", token: "replace this placeholder" },
  { skill: "ngrace-spec", section: "workflow", token: "never hand-type an id or its suffix" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "--supersedes" },
  { skill: "ngrace-reviewer", section: "mechanized_first", token: "skips the bundle's own" },
  { skill: "ngrace-reviewer", section: "mechanized_first", token: "by identity" },
  { skill: "ngrace-reviewer", section: "mechanized_first", token: "design-context.xml" },
  { skill: "ngrace-plan", section: "must_do", token: "assertion.command-not-evaluated" },
  { skill: "ngrace-plan", section: "validation", token: "assertion.change-required" },
  { skill: "ngrace-plan", section: "must_do", token: "review.confidently-wrong" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "maps only criteria without" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "task that owns the surface" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only correction" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "attributes to it" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "the intended task" },

  { skill: "ngrace-plan", section: "must_do", token: "commit the approved plan" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "the event carries no" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "archived predecessor's draft" },
  { skill: "ngrace-spec", section: "shape_sources", token: "exactly one of a bare slug" },
  { skill: "ngrace-plan", section: "must_do", token: "never from a hand-rolled reader" },
  { skill: "ngrace-execute", section: "execution_rules", token: "fold again before" },
  { skill: "ngrace-execute", section: "execution_rules", token: "a faithful throwaway copy may invoke" },
  { skill: "ngrace-execute", section: "execution_rules", token: "one guard per pair" },
  { skill: "ngrace-spec", section: "shape_sources", token: "bounded diff" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "states the relation" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "list what the deliverable moves" },
  { skill: "ngrace-spec", section: "ceremony_tiers", token: "never which files are in scope" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "the pinned number becomes the relation" },
  { skill: "ngrace-plan", section: "must_do", token: "narrowest instrument" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "close-time only" },
  { skill: "ngrace-execute", section: "execution_rules", token: "close-time only" },
  { skill: "ngrace-spec", section: "shape_sources", token: "overwriting the minted skeleton" },
  { skill: "ngrace-spec", section: "shape_sources", token: "carried verbatim" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "predecessor's archive arrival" },
];

function taughtSkillBody(skill: string, drop?: { section: string; token?: string }): string {
  const bySection = new Map<string, Array<{ kind?: string; tokens: string[] }>>();
  const kindIndex = new Map<string, Map<string | undefined, number>>();
  for (const rule of TAUGHT_RULES) {
    if (rule.skill !== skill) continue;
    if (drop && drop.section === rule.section && drop.token === rule.token) {
      continue;
    }
    let entries = bySection.get(rule.section);
    if (!entries) {
      entries = [];
      bySection.set(rule.section, entries);
      kindIndex.set(rule.section, new Map());
    }
    const idx = kindIndex.get(rule.section)!;
    let at = idx.get(rule.kind);
    if (at === undefined) {
      at = entries.length;
      entries.push({ kind: rule.kind, tokens: [] });
      idx.set(rule.kind, at);
    }
    entries[at]!.tokens.push(rule.token);
  }
  const parts: string[] = [];
  for (const [section, entries] of bySection) {
    const innerParts = entries.map((entry) => {
      const body = entry.tokens.map((token) => `Rule carrying ${token} in voice.`).join("\n");
      return entry.kind ? `<kind id="${entry.kind}">\n${body}\n</kind>` : body;
    });
    parts.push(`<${section}>\n${innerParts.join("\n")}\n</${section}>`);
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
  it("returns zero when every taught token sits at its named section home in both trees", () => {
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

  it("returns non-zero naming the file, section and token when the interleaving sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-execute/SKILL.md",
      body: taughtSkillBody("ngrace-execute", { section: "cursor_kinds", token: "interleaves them" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-execute/SKILL.md");
    expect(output).toContain("cursor_kinds");
    expect(output).toContain("interleaves them");
  });

  it("returns non-zero naming the file, section and token when the namespaced-codes sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-spec/SKILL.md",
      body: taughtSkillBody("ngrace-spec", { section: "shape_sources", token: "codes are namespaced" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-spec/SKILL.md");
    expect(output).toContain("shape_sources");
    expect(output).toContain("codes are namespaced");
  });

  it("returns non-zero naming the file, section and token when the copy-commit sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-plan/SKILL.md",
      body: taughtSkillBody("ngrace-plan", { section: "must_do", token: "commit the approved plan" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-plan/SKILL.md");
    expect(output).toContain("must_do");
    expect(output).toContain("commit the approved plan");
  });

  it("returns non-zero naming the file, section and token when the pass-discard sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-execute/SKILL.md",
      body: taughtSkillBody("ngrace-execute", { section: "cursor_kinds", token: "the event carries no" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-execute/SKILL.md");
    expect(output).toContain("cursor_kinds");
    expect(output).toContain("the event carries no");
  });

  it("returns non-zero naming the file, section and token when the archived-draft sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-plan/SKILL.md",
      body: taughtSkillBody("ngrace-plan", { section: "approved_plan_immutability", token: "archived predecessor's draft" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-plan/SKILL.md");
    expect(output).toContain("approved_plan_immutability");
    expect(output).toContain("archived predecessor's draft");
  });

  it("returns non-zero naming the file, section and token when the lineage-path sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "skills/ngrace/ngrace-spec/SKILL.md",
      body: taughtSkillBody("ngrace-spec", { section: "shape_sources", token: "exactly one of a bare slug" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-spec/SKILL.md");
    expect(output).toContain("shape_sources");
    expect(output).toContain("exactly one of a bare slug");
  });

  it("returns non-zero naming the file, section and token when the close-evidence verdict sentence is deleted from one tree", () => {
    const root = isolatedRoot();
    plantTaughtSkills(root, {
      relative: "plugins/ngrace/skills/ngrace/ngrace-plan/SKILL.md",
      body: taughtSkillBody("ngrace-plan", { section: "must_do", token: "never from a hand-rolled reader" }),
    });
    const { code, output } = captureStderr(() => checkTaughtRules(root));
    expect(code).not.toBe(0);
    expect(output).toContain("plugins/ngrace/skills/ngrace/ngrace-plan/SKILL.md");
    expect(output).toContain("must_do");
    expect(output).toContain("never from a hand-rolled reader");
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

// ---------------------------------------------------------------------------
// C-FLUSH-AND-TEACH T-003: checkCliTokenForms — the F239 rule sentence in
// ngrace-cli shape_sources and no bare `argv token `explain`` form in either
// tree. The red directions plant into whichever tree the helper walks.
// ---------------------------------------------------------------------------

const CLI_FORM_TREES = ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const;
const CLI_FORM_SKILLS = [
  "ngrace-plan",
  "ngrace-spec",
  "ngrace-cli",
  "ngrace-design",
  "ngrace-verification",
  "ngrace-execute",
] as const;

function plantCliTokenSkills(root: string, override?: { relative: string; body: string }): void {
  for (const tree of CLI_FORM_TREES) {
    for (const skill of CLI_FORM_SKILLS) {
      const relative = `${tree}/${skill}/SKILL.md`;
      const body =
        override?.relative === relative
          ? override.body
          : "<shape_sources>\nnames the command that takes it\n</shape_sources>\n";
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
  }
}

describe("checkCliTokenForms", () => {
  it("returns zero when ngrace-cli shape_sources carries the F239 rule token in both trees and no tree carries the bare form", () => {
    const root = isolatedRoot();
    plantCliTokenSkills(root);
    expect(checkCliTokenForms(root)).toBe(0);
  });

  it("returns non-zero naming the file and the token when a bare argv token explain line is planted in one tree", () => {
    const root = isolatedRoot();
    plantCliTokenSkills(root, {
      relative: "skills/ngrace/ngrace-design/SKILL.md",
      body: "<shape_sources>\nExplain a shape or code: argv token `explain`.\n</shape_sources>\n",
    });
    const { code, output } = captureStderr(() => checkCliTokenForms(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-design/SKILL.md");
    expect(output).toContain("argv token `explain`");
  });

  it("returns non-zero naming the file and the token when the bare form is planted OUTSIDE the five authoring skills (ngrace-execute), so the walk is every SKILL.md on disk", () => {
    const root = isolatedRoot();
    plantCliTokenSkills(root, {
      relative: "skills/ngrace/ngrace-execute/SKILL.md",
      body: "<shape_sources>\nExplain a shape or code: argv token `explain`.\n</shape_sources>\n",
    });
    const { code, output } = captureStderr(() => checkCliTokenForms(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-execute/SKILL.md");
    expect(output).toContain("argv token `explain`");
  });

  it("returns non-zero when the F239 rule token is missing from ngrace-cli shape_sources", () => {
    const root = isolatedRoot();
    plantCliTokenSkills(root, {
      relative: "skills/ngrace/ngrace-cli/SKILL.md",
      body: "<shape_sources>\nsomething else\n</shape_sources>\n",
    });
    const { code, output } = captureStderr(() => checkCliTokenForms(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-cli/SKILL.md");
    expect(output).toContain("names the command that takes it");
  });

  it(
    "real-repository: ngrace-cli shape_sources carries the rule and no SKILL.md carries the bare form in either tree (generous timeout)",
    () => {
      expect(checkCliTokenForms(REPO_ROOT)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------
// C-TEACH-DRIVE-BEFORE-APPROVE-2 T-002: checkStaleReviewClaims — no SKILL.md
// under either tree carries the stale F247 review-scope claim. The walk is
// every SKILL.md on disk, never only the four governed skills.
// ---------------------------------------------------------------------------

const STALE_CLAIM = "and (when that file changed) decisions.md is expected";

function plantStaleClaim(root: string, relative: string): void {
  for (const tree of ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const) {
    const clean = path.join(root, tree, "ngrace-execute", "SKILL.md");
    mkdirSync(path.dirname(clean), { recursive: true });
    if (!existsSync(clean)) {
      writeFileSync(clean, "<status_rules>clean</status_rules>\n");
    }
  }
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `<status_rules>\nX ${STALE_CLAIM} X.\n</status_rules>\n`);
}

describe("checkStaleReviewClaims", () => {
  it("returns zero on a whole tree whose SKILL.md files carry no stale claim", () => {
    const root = isolatedRoot();
    for (const tree of ["skills/ngrace", "plugins/ngrace/skills/ngrace"] as const) {
      for (const skill of ["ngrace-spec", "ngrace-plan", "ngrace-reviewer"]) {
        const file = path.join(root, tree, skill, "SKILL.md");
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "<status_rules>clean</status_rules>\n");
      }
    }
    expect(checkStaleReviewClaims(root)).toBe(0);
  });

  it("returns non-zero naming the file when the stale claim is planted in a skill OUTSIDE the four governed skills", () => {
    const root = isolatedRoot();
    plantStaleClaim(root, "skills/ngrace/ngrace-cli/SKILL.md");
    const { code, output } = captureStderr(() => checkStaleReviewClaims(root));
    expect(code).not.toBe(0);
    expect(output).toContain("skills/ngrace/ngrace-cli/SKILL.md");
    expect(output).toContain(STALE_CLAIM);
  });

  it("returns non-zero naming the file when the stale claim is planted in the packaged mirror", () => {
    const root = isolatedRoot();
    plantStaleClaim(root, "plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md");
    const { code, output } = captureStderr(() => checkStaleReviewClaims(root));
    expect(code).not.toBe(0);
    expect(output).toContain("plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md");
  });

  it(
    "real-repository: no SKILL.md under either tree carries the stale claim (generous timeout)",
    () => {
      expect(checkStaleReviewClaims(REPO_ROOT)).toBe(0);
    },
  );
});

const NEW_NEEDLES = [
  { skill: "ngrace-plan", section: "must_do", token: "assertion.command-not-evaluated" },
  { skill: "ngrace-plan", section: "validation", token: "assertion.change-required" },
  { skill: "ngrace-plan", section: "must_do", token: "review.confidently-wrong" },
  { skill: "ngrace-plan", section: "spec_plan_traceability", token: "maps only criteria without" },
  { skill: "ngrace-execute", section: "cursor_kinds", token: "task that owns the surface" },
  { skill: "ngrace-execute", section: "execution_rules", token: "pass-only correction" },
  { skill: "ngrace-execute", section: "cursor_kinds", token: "attributes to it" },
  { skill: "ngrace-execute", section: "cursor_kinds", token: "the intended task" },
];

describe("C-TEACH-PLAN-DRIVES-CORRECTIONS-2-1E59AEAA red directions", () => {
  for (const needle of NEW_NEEDLES) {
    it("returns non-zero naming the file, section and token when " + needle.token + " is deleted from one tree", () => {
      const root = isolatedRoot();
      plantTaughtSkills(root, {
        relative: "skills/ngrace/" + needle.skill + "/SKILL.md",
        body: taughtSkillBody(needle.skill, { section: needle.section, token: needle.token }),
      });
      const { code, output } = captureStderr(() => checkTaughtRules(root));
      expect(code).not.toBe(0);
      expect(output).toContain(needle.token);
    });
  }
});


// C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD T-002/T-003/T-004: one red-direction case per added
// needle, grown one needle per pair as each needle lands.
const NEW_NEEDLES_C6 = [
  { skill: "ngrace-execute", section: "execution_rules", token: "fold again before" },
  { skill: "ngrace-execute", section: "execution_rules", token: "a faithful throwaway copy may invoke" },
  { skill: "ngrace-execute", section: "execution_rules", token: "one guard per pair" },
  { skill: "ngrace-spec", section: "shape_sources", token: "bounded diff" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "states the relation" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "list what the deliverable moves" },
  { skill: "ngrace-spec", section: "ceremony_tiers", token: "never which files are in scope" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "the pinned number becomes the relation" },
  { skill: "ngrace-plan", section: "must_do", token: "narrowest instrument" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "close-time only" },
  { skill: "ngrace-execute", section: "execution_rules", token: "close-time only" },
];

describe("C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD red directions", () => {
  for (const needle of NEW_NEEDLES_C6) {
    it("returns non-zero naming the file, section and token when " + needle.token + " is deleted from one tree", () => {
      const root = isolatedRoot();
      plantTaughtSkills(root, {
        relative: "skills/ngrace/" + needle.skill + "/SKILL.md",
        body: taughtSkillBody(needle.skill, { section: needle.section, token: needle.token }),
      });
      const { code, output } = captureStderr(() => checkTaughtRules(root));
      expect(code).not.toBe(0);
      expect(output).toContain(needle.token);
    });
  }
});

// C-TEACHING-CLOSE-PATH-1-3E91B69F T-001/T-002/T-003/T-004: one red-direction case per
// newly added needle, grown one needle per pair as each needle lands.
const NEW_NEEDLES_CTCP = [
  { skill: "ngrace-spec", section: "shape_sources", token: "overwriting the minted skeleton" },
  { skill: "ngrace-spec", section: "shape_sources", token: "carried verbatim" },
  { skill: "ngrace-spec", section: "acceptance_criteria_anchors", token: "predecessor's archive arrival" },
  { skill: "ngrace-plan", section: "approved_plan_immutability", token: "status reset to draft" },
  { skill: "ngrace-plan", section: "must_do", token: ".git/info/exclude" },
  { skill: "ngrace-plan", section: "validation", token: "does not require an open epoch" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "exits non-zero" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "does not require an open epoch" },
  { skill: "ngrace-execute", section: "assertion_commands", token: "selected-baseline lint" },
  { skill: "ngrace-execute", section: "execution_rules", token: "gate.apply.no-verdict" },
  { skill: "ngrace-execute", section: "execution_rules", token: "does not open a fresh epoch" },
  { skill: "ngrace-execute", section: "execution_rules", token: "hidden by the default severity" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "review.attempt-pair-unpaired-pass" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "namespace import" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "attempt", token: "opens a new epoch" },
  { skill: "ngrace-execute", section: "cursor_kinds", kind: "terminal", token: "stays on the last task" },
  { skill: "ngrace-reviewer", section: "review_judgment", token: "silently under-counts" },
];

describe("C-TEACHING-CLOSE-PATH-1-3E91B69F red directions", () => {
  for (const needle of NEW_NEEDLES_CTCP) {
    it("returns non-zero naming the file, section and token when " + needle.token + " is deleted from one tree", () => {
      const root = isolatedRoot();
      plantTaughtSkills(root, {
        relative: "skills/ngrace/" + needle.skill + "/SKILL.md",
        body: taughtSkillBody(needle.skill, { section: needle.section, token: needle.token }),
      });
      const { code, output } = captureStderr(() => checkTaughtRules(root));
      expect(code).not.toBe(0);
      expect(output).toContain(needle.token);
    });
  }
});
