import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath));
    }
  }
  return files.sort();
}

describe("GRACE lifecycle skill contracts", () => {
  it("documents strict specs and immutable approved plans", () => {
    const spec = read("skills/ngrace/ngrace-spec/SKILL.md");
    const specTemplate = read("skills/ngrace/ngrace-spec/references/change-spec-template.xml");
    const plan = read("skills/ngrace/ngrace-plan/SKILL.md");
    const reviewer = read("skills/ngrace/ngrace-reviewer/SKILL.md");

    expect(spec).toContain("<shape_sources>");
    expect(spec).toContain("docs/schema-reference.md");
    expect(spec).toContain("ngrace spec new");
    expect(spec).toContain("AC-*");
    expect(spec).toContain("<acceptance_criteria_anchors>");
    // G-19: strict_contract is a numbered table (not a prose paragraph).
    expect(spec).toContain("<strict_contract>");
    expect(spec).toMatch(/\| # \| requirement \|/);
    expect(spec).toContain("<ceremony_tiers>");
    expect(spec).toContain("**T0**");
    expect(spec).toContain("**T3**");
    expect(spec).toContain("--assertions final");
    expect(spec).toContain("<design_references>");
    expect(spec).toContain("DesignReferences");
    expect(spec).toContain("references/design-context-template.xml");
    expect(spec).toContain("<approval_lexicon>");
    expect(spec).toContain("<docs_and_examples>");
    expect(specTemplate).toContain("<Constraints>");
    expect(specTemplate).toContain("AC-SKELETON");
    expect(specTemplate).toContain("<DesignReferences>");
    expect(specTemplate).toContain("<Figma url=");
    expect(plan).toContain("<shape_sources>");
    expect(plan).toContain("ngrace plan new");
    expect(plan).toContain("<approval_lexicon>");
    expect(plan).toContain("<approved_plan_immutability>");
    expect(plan).toContain("Create a new `C-*` bundle");
    expect(plan).toContain("mark the old bundle superseded");
    expect(plan).toContain("as draft unless the user explicitly approves");
    expect(plan).toContain("--assertions current");
    expect(plan).toContain("--parallel-preflight");
    expect(plan).toContain("<spec_plan_traceability>");
    expect(plan).toContain("Satisfies");
    expect(plan).toContain("OutOfPlanScope");
    // G-19: must_do is a numbered table preserving every requirement.
    expect(plan).toContain("<must_do>");
    expect(plan).toMatch(/\| # \| requirement \|/);
    expect(plan).toContain("Reject unsupported scope glob syntax instead of guessing");
    expect(plan).toContain("<ceremony_tiers>");
    expect(plan).toContain("Never invent a \"skip plan\" path");
    expect(reviewer).toContain("<ceremony_tier_review>");
    expect(reviewer).toContain("T0 misuse on architectural change");
    expect(reviewer).toContain("tiers never bypass `--assertions final`");
    const planTemplate = read("skills/ngrace/ngrace-plan/references/change-plan-template.xml");
    expect(planTemplate).toContain("<Satisfies>");
    expect(planTemplate).toContain("AC-SKELETON");
    expect(planTemplate).toContain("OutOfPlanScope");
  });

  it("spec-teaches-close-evidence: spec skill teaches CloseEvidence under acceptance_criteria_anchors", () => {
    const spec = read("skills/ngrace/ngrace-spec/SKILL.md");
    const section = spec.match(/<acceptance_criteria_anchors>[\s\S]*?<\/acceptance_criteria_anchors>/)?.[0] ?? "";
    expect(section).toContain("CloseEvidence");
    expect(section).toMatch(/<CloseEvidence>[\s\S]*?<Command>/);
  });

  it("plan-excludes-satisfies-close-evidence: plan skill says CloseEvidence AC-* are not Satisfies targets", () => {
    const plan = read("skills/ngrace/ngrace-plan/SKILL.md");
    const section = plan.match(/<spec_plan_traceability>[\s\S]*?<\/spec_plan_traceability>/)?.[0] ?? "";
    expect(section).toContain("CloseEvidence");
    expect(section).toMatch(/not Satisfies targets/);
  });

  it("reviewer-checklist-close-evidence: reviewer checklist requires recorded evaluation", () => {
    const reviewer = read("skills/ngrace/ngrace-reviewer/SKILL.md");
    const section = reviewer.match(/<review_checklist>[\s\S]*?<\/review_checklist>/)?.[0] ?? "";
    expect(section).toContain("CloseEvidence");
    expect(section).toMatch(/applied-archive|applied archive/);
    expect(section).toMatch(/recorded evaluation/);
  });

  it("states TraceAssertion plus tests as the default evidence doctrine", () => {
    for (const rel of [
      "skills/ngrace/ngrace-verification/SKILL.md",
      "plugins/ngrace/skills/ngrace/ngrace-verification/SKILL.md",
    ]) {
      const text = read(rel);
      expect(text).toContain("<evidence_contract>");
      expect(text).toContain("TraceAssertion plus tests is the default");
      expect(text).not.toContain(
        "A non-empty marker or trace assertion satisfies the module-health evidence requirement",
      );
    }
  });

  it("requires a shape_sources block on the five inverted skills", () => {
    for (const skill of [
      "ngrace-spec",
      "ngrace-plan",
      "ngrace-design",
      "ngrace-verification",
      "ngrace-cli",
    ]) {
      expect(read(`skills/ngrace/${skill}/SKILL.md`)).toContain("<shape_sources>");
      expect(read(`plugins/ngrace/skills/ngrace/${skill}/SKILL.md`)).toContain("<shape_sources>");
    }
  });

  it("defines one recovery table and explicit selected assertion commands", () => {
    const execute = read("skills/ngrace/ngrace-execute/SKILL.md");

    expect(execute.match(/<recovery_decision_table>/g)).toHaveLength(1);
    expect(execute.match(/<\/recovery_decision_table>/g)).toHaveLength(1);
    expect(execute).toContain("--change C-ID --assertions baseline");
    expect(execute).toContain("--change C-ID --assertions target --run-commands");
    expect(execute).toContain("--change C-ID --assertions final");
    expect(execute).toContain("does not re-evaluate the selected plan's superseded baseline");
    expect(execute).toContain("--parallel-preflight");
    expect(execute).toContain("explicit apply confirmation");
    expect(execute.toLowerCase()).not.toContain("refresh assertions");
  });

  it("protocol-documented: execute skill names run-commands scope and fold-before-archive", () => {
    const execute = read("skills/ngrace/ngrace-execute/SKILL.md");
    expect(execute).toContain("argv token run-commands requires a declared task in scope");
    expect(execute).toContain(
      "after a fold, final run-commands writes loose events and archive requires no-open-epoch, so terminal the declared task and fold before gate archive",
    );
    expect(execute).toContain("Do not terminal an undeclared event task");
    expect(execute).toContain("--change C-ID --assertions target --run-commands");
    expect(execute).toContain("--change C-ID --assertions final");
    expect(execute).toContain("--parallel-preflight");
  });

  it("documents fail-closed CLI and derived readiness behavior", () => {
    const cli = read("skills/ngrace/ngrace-cli/SKILL.md");
    const status = read("skills/ngrace/ngrace-status/SKILL.md");

    expect(cli).toContain('"schemaVersion": "1.0.0"');
    expect(cli).toContain('"ok": false');
    expect(cli).toContain("analysis.runtime-missing");
    expect(read("skills/ngrace/ngrace-explainer/references/semantic-markup.md")).toContain("analysis.heuristic-confidence");
    expect(status).toContain("needs-plan-approval");
    expect(status).toContain("stale-plan");
    expect(status).toContain("integrity-issues");
    expect(status).toContain("ready-to-execute");
    expect(status).toContain("mutually exclusive");
  });

  it("makes the grace CLI a hard precondition of init, not a recommendation", () => {
    // Skills without the CLI can author .ngrace artifacts that nothing validates — the
    // GRACE 3 failure this refusal exists to close. The wording is pinned so it cannot
    // be softened back into "when the CLI is available" without a test failing.
    const init = read("skills/ngrace/ngrace-init/SKILL.md");

    expect(init).toContain("<cli_precondition>");
    expect(init).toContain("ngrace --version");
    expect(init).toContain("bun add -g @neograce/cli");
    expect(init).toContain("refuse to initialize");
    expect(init).toContain("Create no");

    // The check must precede any write; a precondition that fires mid-run is not one.
    expect(init.indexOf("<cli_precondition>")).toBeLessThan(init.indexOf("<steps>"));

    // No escape hatch: a "continue anyway" path would defeat the refusal entirely.
    expect(init).toContain("Do not offer to continue without validation");

    // And init must not report success over a failing lint.
    expect(init).toContain("Do not report init complete while lint is failing");

    // The hedge this replaced must not come back, in either skill tree.
    for (const path of ["skills/ngrace/ngrace-init/SKILL.md", "plugins/ngrace/skills/ngrace/ngrace-init/SKILL.md"]) {
      expect(read(path)).not.toContain("when the CLI is available");
    }
  });
});

describe("GRACE migration cleanup contract", () => {
  it("requires backup, validation, coverage, and separate cleanup approval", () => {
    const skill = read("skills/ngrace/ngrace-migrate/SKILL.md");
    const checklist = read("skills/ngrace/ngrace-migrate/references/migration-checklist.md");
    const report = read("skills/ngrace/ngrace-migrate/references/migration-report-template.xml");

    for (const requirement of ["complete inventory", "restorable backup", "successful current lint", "verified generated coverage", "git availability/worktree inspection", "separate explicit cleanup approval", "dirty or non-git risk acknowledgement"]) {
      expect(skill).toContain(requirement);
    }
    expect(skill).toContain("no cleanup");
    expect(skill).toContain("git status --porcelain --untracked-files=all");
    expect(skill).toContain("Legacy GRACE 3 artifacts remain untouched unless the failure output explicitly lists a completed move.");
    expect(skill).toContain("Never retry destructive cleanup automatically");
    expect(checklist).toContain("no broad glob or unreviewed recursive deletion");
    expect(report).toContain('<Backup restorable="false">');
    expect(report).toContain('<Validation successful="false">');
    expect(report).toContain('<GitPreflight available="false" inWorktree="false" dirty="false">');
    expect(report).toContain('<CleanupProposal approved="false">');
    expect(report).toContain('<DirtyOrNonGitRiskAcknowledgement required="false" approved="false">');
    expect(report).toContain('<CleanupResults performed="false">');
  });
});

describe("published skill mirrors", () => {
  it("keeps every published canonical skill byte-identical to its packaged copy", () => {
    const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")) as {
      plugins: Array<{ skills: string[] }>;
    };

    for (const componentPath of marketplace.plugins[0]!.skills) {
      const relativePath = componentPath.replace(/^\.\//, "");
      const canonicalRoot = path.join(repoRoot, relativePath);
      const packagedRoot = path.join(repoRoot, "plugins/ngrace", relativePath);
      const canonicalFiles = collectFiles(canonicalRoot);
      const packagedFiles = collectFiles(packagedRoot);

      expect(packagedFiles).toEqual(canonicalFiles);
      for (const file of canonicalFiles) {
        expect(readFileSync(path.join(packagedRoot, file))).toEqual(readFileSync(path.join(canonicalRoot, file)));
      }
    }
  });
});

describe("fork attribution", () => {
  // Attribution that nothing enforces erodes. These assertions are the enforcement:
  // the methodology credit, the upstream credit, and the licence notice cannot be
  // removed by a later edit without a test failing.
  it("credits the methodology author and the upstream repository", () => {
    const lineage = read("LINEAGE.md");
    const readme = read("README.md");
    const license = read("LICENSE");

    // The methodology is Vladimir Ivanov's; forking the tooling never transfers that.
    expect(lineage).toContain("Vladimir Ivanov");
    expect(readme).toContain("Vladimir Ivanov");

    // The parent repository, named and linked in both places.
    expect(lineage).toContain("osovv/grace-marketplace");
    expect(readme).toContain("osovv/grace-marketplace");
    expect(readme).toContain("LINEAGE.md");

    // MIT requires the original copyright notice be retained, not replaced.
    expect(license).toContain("Copyright (c) 2026 GRACE Framework Contributors");
    expect(license).toContain("MIT License");

    // Every upstream contributor from the inherited git history.
    for (const person of [
      "Aleksei Chendemerov",
      "Aleksey Chendemerov",
      "Alex Shekhter",
      "Denis Scheglov",
      "dmkononenko",
    ]) {
      expect(lineage).toContain(person);
    }
  });

  it("keeps upstream release history unedited in the changelog", () => {
    const changelog = read("CHANGELOG.md");
    const historyStart = changelog.indexOf("## <small>4.0.4");
    expect(historyStart).toBeGreaterThan(0);

    // Entries at 4.0.4 and below describe work done in the upstream repository. Their
    // commit permalinks must keep pointing there — rewriting them would both break the
    // links and falsely claim the work happened here.
    const history = changelog.slice(historyStart);
    expect(history).toContain("github.com/osovv/grace-marketplace/commit/");
    expect(history).not.toContain("github.com/alex-shekhter/neo-grace/commit/");
  });
});

describe("C-APPROVAL-FINGERPRINT T-004 skill write path", () => {
  it("skill-spec-write-path: ngrace-spec status_rules say gate approve writes status", () => {
    const spec = read("skills/ngrace/ngrace-spec/SKILL.md");
    expect(spec).toContain("that command writes status");
    expect(spec).not.toContain(
      'Set `status="approved"` only after a sufficient phrase from `approval_lexicon`.',
    );
  });

  it("skill-plan-write-path: ngrace-plan requirement 15 says the gate writes status and records the fingerprint", () => {
    const plan = read("skills/ngrace/ngrace-plan/SKILL.md");
    expect(plan).toContain("the gate writes status and records the fingerprint");
    expect(plan).not.toContain("The gate records a Decision and does not itself set status.");
  });

  it("skill-reviewer-three-way: review_checklist names never-asked, mismatch, and unfingerprinted Decision silent", () => {
    const reviewer = read("skills/ngrace/ngrace-reviewer/SKILL.md");
    expect(reviewer).toContain("unfingerprinted Decision silent");
  });
});

describe("C-APPROVAL-FINGERPRINT T-005", () => {
  it("readme-gate: Change lifecycle prose no longer blankets never-author status; approve row names the write and fingerprint", () => {
    const readme = read("README.md");
    expect(readme).not.toContain("they never author `status`");
    expect(readme).toContain(
      "a permitting recorded approve writes approved onto the targeted spec or plan and records a fingerprint",
    );
    const applyRow = readme.split("\n").find((line) => line.includes("`ngrace gate apply"));
    const archiveRow = readme.split("\n").find((line) => line.includes("`ngrace gate archive"));
    expect(applyRow).toBeDefined();
    expect(archiveRow).toBeDefined();
    expect(applyRow).not.toMatch(/writes approved|records a fingerprint/i);
    expect(archiveRow).not.toMatch(/writes approved|records a fingerprint/i);
  });
});

describe("C-SUPERSEDE-COMMAND T-005", () => {
  it("skill-plan-path: approved_plan_immutability teaches spec new then ngrace supersede", () => {
    const plan = read("skills/ngrace/ngrace-plan/SKILL.md");
    const section = plan.split("<approved_plan_immutability>")[1]?.split("</approved_plan_immutability>")[0] ?? "";
    expect(section).toContain("ngrace supersede");
    expect(section).toContain("spec new");
    expect(section).toContain("change.invalid-active-status");
    expect(section).toContain("change.archive-status-mismatch");
    expect(section).toContain("change.superseded-missing-replacement");
    expect(section).toContain("change.superseded-self-replacement");
    expect(section).toContain("change.superseded-replacement-not-found");
    expect(section).toContain("Create a new `C-*` bundle");
    expect(section).toContain("mark the old bundle superseded");
    expect(section).not.toMatch(/\bmv\b/);
  });

  it("skill-execute-path: preflight and durable-state-changed name ngrace supersede", () => {
    const execute = read("skills/ngrace/ngrace-execute/SKILL.md");
    const preflight = execute.split("<preflight>")[1]?.split("</preflight>")[0] ?? "";
    expect(preflight).toContain("ngrace supersede");
    const table = execute.split("<recovery_decision_table>")[1]?.split("</recovery_decision_table>")[0] ?? "";
    expect(table).toContain("ngrace supersede");
    expect(execute).not.toContain("D19");
    expect(execute).not.toContain("D20");
  });

  it("skill-explainer-path: contract-driven-dev.md names ngrace supersede", () => {
    const explainer = read("skills/ngrace/ngrace-explainer/references/contract-driven-dev.md");
    expect(explainer).toContain("ngrace supersede");
    expect(explainer).not.toContain("D19");
    expect(explainer).not.toContain("D20");
  });
});

describe("C-BOUND-VERDICT T-006 skill split", () => {
  it("skill-execute-rule9: execute rule 9 runs ngrace review with --change and stops; does not invoke gate verdict", () => {
    const execute = read("skills/ngrace/ngrace-execute/SKILL.md");
    const rules = execute.split("<execution_rules>")[1]?.split("</execution_rules>")[0] ?? "";
    const rule9 = rules.split(/\n(?=\d+\. )/).find((block) => block.startsWith("9. ")) ?? "";
    expect(rule9).toContain("ngrace review");
    expect(rule9).toContain("--change");
    expect(rule9).toMatch(/\bstop\b/i);
    expect(rule9).not.toContain("record with `ngrace gate verdict --change C-ID --outcome <token>`");
    expect(execute).toContain("<recovery_decision_table>");
    expect(execute).toContain("<assertion_commands>");
    const reviewer = read("skills/ngrace/ngrace-reviewer/SKILL.md");
    const checklist = reviewer.match(/<review_checklist>[\s\S]*?<\/review_checklist>/)?.[0] ?? "";
    expect(checklist).toContain("CloseEvidence");
    expect(checklist).toContain("unfingerprinted Decision silent");
    expect(execute).not.toContain("D19");
    expect(execute).not.toContain("D20");
  });
});

function skillSection(text: string, tag: string): string {
  return text.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`))?.[0] ?? "";
}

function numberedItem(text: string, n: number): string {
  return text.split(/\n(?=\d+\. )/).find((block) => block.startsWith(`${n}. `)) ?? "";
}

describe("C-APPROVE-TIME-REVIEW T-001 ngrace-spec", () => {
  describe("spec-review-before-approve", () => {
    it("status_rules instructs ngrace review before gate approve and keeps that command writes status", () => {
      const statusRules = skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "status_rules");
      expect(statusRules).toContain("ngrace review --path . --change C-ID");
      expect(statusRules).toContain("does not record a verdict");
      expect(statusRules).toContain("that command writes status");
      const reviewAt = statusRules.indexOf("ngrace review --path . --change C-ID");
      const approveAt = statusRules.indexOf("ngrace gate approve");
      expect(reviewAt).toBeGreaterThanOrEqual(0);
      expect(approveAt).toBeGreaterThan(reviewAt);
    });

    it("workflow step 6 instructs ngrace review before gate approve and keeps that command writes status", () => {
      const step6 = numberedItem(skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "workflow"), 6);
      expect(step6).toContain("ngrace review --path . --change C-ID");
      expect(step6).toContain("does not record a verdict");
      expect(step6).toContain("that command writes status");
      const reviewAt = step6.indexOf("ngrace review --path . --change C-ID");
      const approveAt = step6.indexOf("ngrace gate approve");
      expect(reviewAt).toBeGreaterThanOrEqual(0);
      expect(approveAt).toBeGreaterThan(reviewAt);
    });

    it("status_rules states the F150 expected findings and ObservedWriteScope ban", () => {
      const statusRules = skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "status_rules");
      expect(statusRules).toContain("did not run (no plan)");
      expect(statusRules).toContain("ran over 0 pairs");
      expect(statusRules).toContain("not substantiation");
      expect(statusRules).toContain("review.scope-outside-write-scope");
      expect(statusRules).toContain("spec.xml");
      expect(statusRules).toContain("plan.xml");
      expect(statusRules).toContain("decisions.md");
      expect(statusRules).toContain("do not add those paths to ObservedWriteScope");
    });

    it("workflow step 6 states the F150 expected findings and ObservedWriteScope ban", () => {
      const step6 = numberedItem(skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "workflow"), 6);
      expect(step6).toContain("did not run (no plan)");
      expect(step6).toContain("ran over 0 pairs");
      expect(step6).toContain("not substantiation");
      expect(step6).toContain("review.scope-outside-write-scope");
      expect(step6).toContain("spec.xml");
      expect(step6).toContain("plan.xml");
      expect(step6).toContain("decisions.md");
      expect(step6).toContain("do not add those paths to ObservedWriteScope");
    });
  });

  describe("spec-lexicon-request-site", () => {
    it("approval_lexicon keeps the closed set and adds the F152 rules", () => {
      const lexicon = skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "approval_lexicon");
      expect(lexicon).toContain("approved");
      expect(lexicon).toContain("I approve");
      expect(lexicon).toContain("approve this spec");
      expect(lexicon).toContain("looks good");
      expect(lexicon).toContain("continue");
      expect(lexicon).toContain("any question");
      expect(lexicon).toContain("one approval request per message");
      expect(lexicon).toContain("record the ratifying phrase verbatim");
      expect(lexicon).toContain("bound to the artifact id and stage");
    });

    it("workflow step 6 quotes the sufficient phrases bound to C-ID and spec stage", () => {
      const step6 = numberedItem(skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "workflow"), 6);
      expect(step6).toContain("C-ID at spec stage");
      expect(step6).toContain("approved");
      expect(step6).toContain("I approve");
      expect(step6).toContain("approve this spec");
    });

    it("workflow step 2 is not lexicon ratification and must not run gate approve", () => {
      const step2 = numberedItem(skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "workflow"), 2);
      expect(step2).toContain("not lexicon ratification");
      expect(step2).not.toContain("ngrace gate approve");
    });
  });

  describe("spec-xml-escape", () => {
    it("hard_rules states the XML-escaping rule and markup-byte assertions belong in a TypeScript test", () => {
      const hardRules = skillSection(read("skills/ngrace/ngrace-spec/SKILL.md"), "hard_rules");
      expect(hardRules).toContain(
        "When a spec, plan, design-context, or skill XML block must name a tag, attribute form, or angle-bracketed token",
      );
      expect(hardRules).toContain("write it as character data with entities");
      expect(hardRules).toContain("&lt;");
      expect(hardRules).toContain("&gt;");
      expect(hardRules).toContain("&amp;");
      expect(hardRules).toContain("do not paraphrase the brackets away");
      expect(hardRules).toContain("markup-byte assertions belong in a TypeScript test");
    });
  });
});

function mustDoRow(plan: string, n: number): string {
  const mustDo = skillSection(plan, "must_do");
  return mustDo.split("\n").find((line) => line.startsWith(`| ${n} |`)) ?? "";
}

describe("C-APPROVE-TIME-REVIEW T-002 ngrace-plan", () => {
  describe("plan-review-before-approve", () => {
    it("must_do rule 15 instructs ngrace review before gate approve and keeps the fingerprint pin", () => {
      const plan = read("skills/ngrace/ngrace-plan/SKILL.md");
      const row15 = mustDoRow(plan, 15);
      expect(row15).toContain("ngrace review --path . --change C-ID");
      expect(row15).toContain("does not record a verdict");
      expect(row15).toContain("the gate writes status and records the fingerprint");
      const reviewAt = row15.indexOf("ngrace review --path . --change C-ID");
      const approveAt = row15.indexOf("ngrace gate approve");
      expect(reviewAt).toBeGreaterThanOrEqual(0);
      expect(approveAt).toBeGreaterThan(reviewAt);
      expect(mustDoRow(plan, 16).startsWith("| 16 |")).toBe(true);
      expect(mustDoRow(plan, 17).startsWith("| 17 |")).toBe(true);
    });

    it("must_do rule 15 states the F150 expected findings and ObservedWriteScope ban", () => {
      const row15 = mustDoRow(read("skills/ngrace/ngrace-plan/SKILL.md"), 15);
      expect(row15).toContain("did not run (no plan)");
      expect(row15).toContain("ran over 0 pairs");
      expect(row15).toContain("not substantiation");
      expect(row15).toContain("review.scope-outside-write-scope");
      expect(row15).toContain("spec.xml");
      expect(row15).toContain("plan.xml");
      expect(row15).toContain("decisions.md");
      expect(row15).toContain("do not add those paths to ObservedWriteScope");
    });
  });

  describe("plan-lexicon-request-site", () => {
    it("approval_lexicon keeps the closed set and adds the F152 rules", () => {
      const lexicon = skillSection(read("skills/ngrace/ngrace-plan/SKILL.md"), "approval_lexicon");
      expect(lexicon).toContain("approved");
      expect(lexicon).toContain("I approve");
      expect(lexicon).toContain("approve this plan");
      expect(lexicon).toContain("looks good");
      expect(lexicon).toContain("continue");
      expect(lexicon).toContain("any question");
      expect(lexicon).toContain("one approval request per message");
      expect(lexicon).toContain("record the ratifying phrase verbatim");
      expect(lexicon).toContain("bound to the artifact id and stage");
    });

    it("rule 15 quotes the sufficient phrases bound to C-ID and plan stage", () => {
      const row15 = mustDoRow(read("skills/ngrace/ngrace-plan/SKILL.md"), 15);
      expect(row15).toContain("C-ID at plan stage");
      expect(row15).toContain("approved");
      expect(row15).toContain("I approve");
      expect(row15).toContain("approve this plan");
    });
  });

  describe("plan-xml-escape", () => {
    it("hard_rules states the XML-escaping rule and markup-byte assertions belong in a TypeScript test", () => {
      const hardRules = skillSection(read("skills/ngrace/ngrace-plan/SKILL.md"), "hard_rules");
      expect(hardRules).toContain(
        "When a spec, plan, design-context, or skill XML block must name a tag, attribute form, or angle-bracketed token",
      );
      expect(hardRules).toContain("write it as character data with entities");
      expect(hardRules).toContain("&lt;");
      expect(hardRules).toContain("&gt;");
      expect(hardRules).toContain("&amp;");
      expect(hardRules).toContain("do not paraphrase the brackets away");
      expect(hardRules).toContain("markup-byte assertions belong in a TypeScript test");
    });
  });
});

describe("C-APPROVE-TIME-REVIEW T-003 ngrace-reviewer", () => {
  describe("reviewer-three-moments", () => {
    it("mechanized_first names spec-approve, plan-approve, and before close judgment", () => {
      const reviewer = read("skills/ngrace/ngrace-reviewer/SKILL.md");
      const block = skillSection(reviewer, "mechanized_first");
      expect(block).toContain("spec-approve");
      expect(block).toContain("plan-approve");
      expect(block).toContain("before close judgment");
      expect(block).toContain("ngrace review --path . --change C-ID");
      expect(block).not.toContain("Always run before judgment");
      expect(reviewer).toContain("unfingerprinted Decision silent");
    });
  });

  describe("reviewer-expected-findings", () => {
    it("states the F150 expected findings and ObservedWriteScope ban", () => {
      const reviewer = read("skills/ngrace/ngrace-reviewer/SKILL.md");
      expect(reviewer).toContain("did not run (no plan)");
      expect(reviewer).toContain("ran over 0 pairs");
      expect(reviewer).toContain("not substantiation");
      expect(reviewer).toContain("review.scope-outside-write-scope");
      expect(reviewer).toContain("spec.xml");
      expect(reviewer).toContain("plan.xml");
      expect(reviewer).toContain("decisions.md");
      expect(reviewer).toContain("do not add those paths to ObservedWriteScope");
      expect(reviewer).not.toContain("review.zero-or-more-swallow");
    });
  });
});









