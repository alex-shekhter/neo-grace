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
