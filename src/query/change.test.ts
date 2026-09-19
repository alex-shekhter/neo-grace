import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { writeMinimalNgraceProject } from "../artifact/test-fixtures";
import { collectCloseBoundCriterionIds, collectCloseEvidenceEvaluations } from "../artifact/grammar";
import { collectActiveChangeScopes } from "../artifact/scope";
import { resolveNgracePaths } from "../artifact/project";
import { readGraceXmlArtifact } from "../artifact/xml";
import { collectChangeView, findChangeBundles } from "./change";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const GRACE_BIN = path.join(REPO_ROOT, "src/grace.ts");
const CHANGE_ID = "C-FIXTURE-1-AAAA1111";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function tempProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-change-"));
  tempRoots.push(root);
  writeMinimalNgraceProject(root);
  return root;
}

function write(root: string, relative: string, content: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const SPEC = `<NgraceChangeSpec graceVersion="1.0" status="approved"><${CHANGE_ID}>`
  + `<Summary>Fixture.</Summary><Problem>Fixture.</Problem><Goals><Goal>Fixture.</Goal></Goals>`
  + `<Constraints><Constraint>Fixture.</Constraint></Constraints><NonGoals><NonGoal>Fixture.</NonGoal></NonGoals>`
  + `<AcceptanceCriteria>`
  + `<AC-CLOSE-BOUND>Text.<CloseEvidence><Command>bun test</Command></CloseEvidence></AC-CLOSE-BOUND>`
  + `<AC-ORDINARY>Text.</AC-ORDINARY>`
  + `</AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas>`
  + `<VerificationIntent><ExpectedCommand>bun test</ExpectedCommand><ExpectedEvidence>Fixture.</ExpectedEvidence></VerificationIntent>`
  + `<Assumptions><Assumption>Fixture.</Assumption></Assumptions></${CHANGE_ID}></NgraceChangeSpec>`;

const PLAN_BODY =
  `<IntentSummary>Fixture.</IntentSummary>`
  + `<BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions>`
  + `<TargetAssertions><MustVerify><Module>M-EXAMPLE</Module></MustVerify></TargetAssertions>`
  + `<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>`
  + `<ObservedWriteScope><File>src/example.ts</File><Glob>src/generated/**</Glob></ObservedWriteScope>`
  + `<ImplementationPlan><T-001><Title>Fixture</Title><DependsOn></DependsOn>`
  + `<AcceptanceCriteria><Criterion>Fixture.</Criterion></AcceptanceCriteria>`
  + `<Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan>`;

function writeBundle(root: string, options: { plan?: boolean; verdict?: boolean; location?: "active" | "archive" } = {}): string {
  const location = options.location ?? "active";
  const bundle = path.join(root, ".ngrace", "changes", location, CHANGE_ID);
  mkdirSync(bundle, { recursive: true });
  writeFileSync(path.join(bundle, "spec.xml"), location === "archive" ? SPEC.replace('status="approved"', 'status="applied"') : SPEC);
  if (options.plan !== false) {
    writeFileSync(
      path.join(bundle, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="${location === "archive" ? "applied" : "approved"}"><${CHANGE_ID}>${PLAN_BODY}</${CHANGE_ID}></NgraceChangePlan>`,
    );
  }
  if (options.verdict) {
    writeFileSync(
      path.join(bundle, "run-ledger.xml"),
      `<NgraceRunLedger graceVersion="1.0"><${CHANGE_ID}><Verdicts>`
        + `<Verdict outcome="pass"><AC-CLOSE-BOUND><Exit>0</Exit><Result>pass</Result></AC-CLOSE-BOUND></Verdict>`
        + `</Verdicts></${CHANGE_ID}></NgraceRunLedger>`,
    );
  }
  return bundle;
}

function runCli(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", GRACE_BIN, "change", ...args], { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function hashTree(dir: string): string {
  const entries: string[] = [];
  const walk = (rel: string) => {
    const full = path.join(dir, rel);
    for (const entry of readdirSync(full)) {
      const next = path.join(rel, entry);
      const abs = path.join(dir, next);
      if (statSync(abs).isDirectory()) walk(next);
      else entries.push(`${next}:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
    }
  };
  walk(".");
  return entries.sort().join("\n");
}

describe("C-INSPECTION-SURFACE-1-2628AA2B T-002 ngrace change", () => {
  it("show prints the close-bound criterion set equal to collectCloseBoundCriterionIds", () => {
    const root = tempProject();
    writeBundle(root);
    const wrapper = readGraceXmlArtifact(path.join(root, ".ngrace/changes/active", CHANGE_ID, "spec.xml"))
      .root!.children.find((child) => child.tag === CHANGE_ID)!;
    const expected = [...collectCloseBoundCriterionIds(wrapper)].sort();

    const view = collectChangeView(root, CHANGE_ID);
    expect(view.closeBoundCriteria).toEqual(expected);
    expect(view.closeBoundCriteria).toEqual(["AC-CLOSE-BOUND"]);
    expect(view.closeBoundCriteria).not.toContain("AC-ORDINARY");
  });

  it("show prints the plan scope equal to the shipped scope reader, and reports an absent plan as absent", () => {
    const root = tempProject();
    writeBundle(root);
    const paths = resolveNgracePaths(root);
    const active = collectActiveChangeScopes(paths).find((scope) => scope.changeId === CHANGE_ID)!;

    const view = collectChangeView(root, CHANGE_ID);
    expect(view.observedWriteScope).toEqual({ files: active.observedWrites.files, globs: active.observedWrites.globs });
    expect(view.observedWriteScope!.files).toContain("src/example.ts");
    expect(view.observedWriteScope!.globs).toContain("src/generated/**");
    expect(view.durableScope).toEqual({ state: "carried", scope: expect.objectContaining({ graphAnchors: active.durable.graphAnchors }) });
    expect(view.planStatus).toBe("approved");

    const noPlan = tempProject();
    writeBundle(noPlan, { plan: false });
    const absentView = collectChangeView(noPlan, CHANGE_ID);
    expect(absentView.observedWriteScope).toBeNull();
    expect(absentView.durableScope).toEqual({ state: "absent" });
    expect(absentView.planStatus).toBeNull();
  });

  it("show prints the latest Verdict's per-criterion Exit/Result equal to collectCloseEvidenceEvaluations", () => {
    const root = tempProject();
    writeBundle(root, { verdict: true });
    const ledgerWrapper = readGraceXmlArtifact(path.join(root, ".ngrace/changes/active", CHANGE_ID, "run-ledger.xml"))
      .root!.children.find((child) => child.tag === CHANGE_ID)!;
    const verdictNode = ledgerWrapper.children.find((child) => child.tag === "Verdicts")!.children.find((child) => child.tag === "Verdict")!;
    const expected = collectCloseEvidenceEvaluations(verdictNode);

    const view = collectChangeView(root, CHANGE_ID);
    expect(view.verdict!.closeEvidence).toEqual(expected);
    expect(view.verdict!.closeEvidence).toEqual([{ criterionId: "AC-CLOSE-BOUND", exit: "0", result: "pass" }]);

    const noVerdict = tempProject();
    writeBundle(noVerdict);
    expect(collectChangeView(noVerdict, CHANGE_ID).verdict).toBeNull();
  });

  it("find lists bundles, and the CLI exit contract discriminates empty from absent from present", () => {
    const root = tempProject();
    writeBundle(root);

    const listed = findChangeBundles(root);
    expect(listed.some((bundle) => bundle.changeId === CHANGE_ID && bundle.location === "active")).toBe(true);

    const findEmpty = runCli(root, ["find", "no-such-slug"]);
    expect(findEmpty.status).toBe(0);

    const findMatch = runCli(root, ["find", "FIXTURE"]);
    expect(findMatch.status).toBe(0);
    expect(findMatch.stdout).toContain(CHANGE_ID);

    const show = runCli(root, ["show", CHANGE_ID, "--format", "json"]);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).changeId).toBe(CHANGE_ID);

    const showAbsent = runCli(root, ["show", "C-NOPE-1-00000000"]);
    expect(showAbsent.status).toBe(1);
    expect(showAbsent.stderr).toContain("C-NOPE-1-00000000");
    expect(showAbsent.stdout).not.toContain("ok");
  });

  it("refuses a present-but-unparsable spec.xml or plan.xml instead of reporting it absent", () => {
    const specRoot = tempProject();
    const specBundle = writeBundle(specRoot);
    writeFileSync(path.join(specBundle, "spec.xml"), `<NgraceChangeSpec graceVersion="1.0" status="approved"><${CHANGE_ID}><Summary>truncated`);
    const specText = runCli(specRoot, ["show", CHANGE_ID]);
    expect(specText.status, "a present but unparsable spec.xml exits non-zero").not.toBe(0);
    expect(specText.stdout).not.toContain("Spec: absent");
    const specJson = runCli(specRoot, ["show", CHANGE_ID, "--format", "json"]);
    expect(specJson.status, "a present but unparsable spec.xml exits non-zero in JSON mode").not.toBe(0);
    expect(JSON.parse(specJson.stdout).ok).toBe(false);
    expect(JSON.parse(specJson.stdout).error.code).toBe("invalid-project");

    const planRoot = tempProject();
    const planBundle = writeBundle(planRoot);
    writeFileSync(path.join(planBundle, "plan.xml"), `<NgraceChangePlan graceVersion="1.0" status="approved"><${CHANGE_ID}><IntentSummary>truncated`);
    expect(runCli(planRoot, ["show", CHANGE_ID]).status, "a present but unparsable plan.xml exits non-zero").not.toBe(0);
  });

  it("still reports a genuinely absent spec.xml as absent with exit 0", () => {
    const root = tempProject();
    const bundle = writeBundle(root);
    rmSync(path.join(bundle, "spec.xml"));
    rmSync(path.join(bundle, "plan.xml"));
    const result = runCli(root, ["show", CHANGE_ID]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Spec: absent");
    expect(collectChangeView(root, CHANGE_ID).specStatus).toBeNull();
  });

  it("carries an archived applied bundle's declared durable anchors, never the third-state label", () => {
    const root = tempProject();
    writeBundle(root, { location: "archive" });
    // The archived plan declares <DurableScope><GraphAnchors><M-EXAMPLE/></GraphAnchors></DurableScope>.
    const archived = collectChangeView(root, CHANGE_ID);
    expect(archived.location).toBe("archive");
    expect(archived.durableScope.state).toBe("carried");
    expect(archived.durableScope).toMatchObject({ scope: expect.objectContaining({ graphAnchors: ["M-EXAMPLE"] }) });

    const text = runCli(root, ["show", CHANGE_ID]);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain("M-EXAMPLE");
    expect(text.stdout).not.toContain("not carried for an archived bundle");

    const json = runCli(root, ["show", CHANGE_ID, "--format", "json"]);
    const durable = JSON.parse(json.stdout).durableScope;
    expect(durable.state).toBe("carried");
    expect(durable.scope.graphAnchors).toContain("M-EXAMPLE");
  });

  it("distinguishes an archived declared <None /> from an archived non-applied bundle", () => {
    const none = tempProject();
    const noneBundle = writeBundle(none, { location: "archive" });
    writeFileSync(
      path.join(noneBundle, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="applied"><${CHANGE_ID}>${PLAN_BODY.replace("<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>", "<DurableScope><None /></DurableScope>")}</${CHANGE_ID}></NgraceChangePlan>`,
    );
    expect(collectChangeView(none, CHANGE_ID).durableScope.state).toBe("declared-none");

    const rejected = tempProject();
    const rejectedBundle = writeBundle(rejected, { location: "archive" });
    writeFileSync(
      path.join(rejectedBundle, "spec.xml"),
      readFileSync(path.join(rejectedBundle, "spec.xml"), "utf8").replace('status="applied"', 'status="rejected"'),
    );
    writeFileSync(
      path.join(rejectedBundle, "plan.xml"),
      readFileSync(path.join(rejectedBundle, "plan.xml"), "utf8").replace('status="applied"', 'status="rejected"'),
    );
    expect(collectChangeView(rejected, CHANGE_ID).durableScope.state).toBe("absent");
  });

  it("distinguishes an active bundle's real anchors (carried) from a declared <None /> (declared-none)", () => {
    const carried = tempProject();
    writeBundle(carried);
    expect(collectChangeView(carried, CHANGE_ID).durableScope.state).toBe("carried");

    const none = tempProject();
    const bundle = writeBundle(none);
    writeFileSync(
      path.join(bundle, "plan.xml"),
      `<NgraceChangePlan graceVersion="1.0" status="approved"><${CHANGE_ID}>${PLAN_BODY.replace("<DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope>", "<DurableScope><None /></DurableScope>")}</${CHANGE_ID}></NgraceChangePlan>`,
    );
    const declaredNone = collectChangeView(none, CHANGE_ID);
    expect(declaredNone.durableScope.state).toBe("declared-none");
    expect(runCli(none, ["show", CHANGE_ID]).stdout).toContain("declared none");
  });

  it("mutates nothing: the project tree hash is identical before and after find and show", () => {
    const root = tempProject();
    writeBundle(root, { verdict: true });
    const before = hashTree(root);
    runCli(root, ["find"]);
    runCli(root, ["show", CHANGE_ID]);
    expect(hashTree(root)).toBe(before);
  });

  it("answers change show through the per-bundle reader, leaving one whole-project walk in find", () => {
    const source = readFileSync(path.join(REPO_ROOT, "src/query/change.ts"), "utf8");
    expect((source.match(/collectProjectStatus\(/g) ?? []).length).toBe(1);
    expect(source).toContain("derivedStatesForChange");
  });
});
