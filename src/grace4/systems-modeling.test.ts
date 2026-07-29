import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { evaluateAssertion, type AssertionContext, type GraceAssertion } from "./assertions";
import { validateGrace4Project } from "./grammar";
import { ARTIFACT_DIR } from "./paths";
import { resolveGrace4Paths } from "./project";
import { buildGraphProjection, buildVerificationProjection } from "./projections";
import { collectActiveChangeScopes, createDurableOwnershipIndex } from "./scope";
import { writeMinimalGrace4Project } from "./test-fixtures";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-systems-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function codes(issues: Array<{ code: string }>) {
  return issues.map((issue) => issue.code);
}

function assertion(kind: GraceAssertion["kind"], values: string[]): GraceAssertion {
  return { kind, values, file: "plan.xml" };
}

function context(root: string): AssertionContext {
  const paths = resolveGrace4Paths(root);
  const graph = buildGraphProjection(paths);
  return { root, graph, verification: buildVerificationProjection(paths, graph) };
}

/** Two modules + flat DF (legacy form) + verification. */
function writeLegacyFlowProject(root: string) {
  writeProjectFile(root, "src/a.ts", "export const a = 1;\n");
  writeProjectFile(root, "src/b.ts", "export const b = 1;\n");
  writeProjectFile(root, "proto/posting.proto", "syntax = \"proto3\";\n");
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/context/requirements.xml`,
    `<GraceRequirements graceVersion="4.0"><Summary>Required.</Summary></GraceRequirements>`,
  );
  writeProjectFile(root, `${ARTIFACT_DIR}/context/technology.xml`, `<GraceTechnology graceVersion="4.0"><Runtime>Bun</Runtime></GraceTechnology>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/principles.xml`, `<GracePrinciples graceVersion="4.0"><Principle>Evidence.</Principle></GracePrinciples>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/deployment.xml`, `<GraceDeployment graceVersion="4.0"><Applicability>applicable</Applicability></GraceDeployment>`);
  writeProjectFile(root, `${ARTIFACT_DIR}/context/ux-guidelines.xml`, `<GraceUXGuidelines graceVersion="4.0"><Applicability>applicable</Applicability></GraceUXGuidelines>`);
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });

  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-GATEWAY /><M-LEDGER /><DF-POSTING /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN>`
      + `<M-GATEWAY><Summary>Gateway.</Summary><Path>src/a.ts</Path></M-GATEWAY>`
      + `<M-LEDGER><Summary>Ledger.</Summary><Path>src/b.ts</Path></M-LEDGER>`
      + `<DF-POSTING><Summary>Posting flow.</Summary><M-GATEWAY /><M-LEDGER /></DF-POSTING>`
      + `</GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/index.xml`,
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-GATEWAY /><V-M-LEDGER /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/verification/main.xml`,
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN>`
      + `<V-M-GATEWAY><Command>echo gateway</Command><Scenario>gateway works</Scenario></V-M-GATEWAY>`
      + `<V-M-LEDGER><Command>echo ledger</Command><Scenario>ledger works</Scenario></V-M-LEDGER>`
      + `</VD-MAIN></GraceVerificationDocument>`,
  );
}

function writeGraphWithContract(
  root: string,
  options: {
    schema?: string;
    provider?: string;
    consumer?: string;
    version?: string;
    policy?: string;
    orderedFlow?: string;
    owns?: string;
  } = {},
) {
  writeLegacyFlowProject(root);
  const schema = options.schema ?? "proto/posting.proto";
  const provider = options.provider ?? "M-LEDGER";
  const consumer = options.consumer ?? "M-GATEWAY";
  const version = options.version ?? "1.2.0";
  const policy = options.policy ?? "additive-only";
  const owns = options.owns
    ?? `<M-GATEWAY /><M-LEDGER /><DF-POSTING /><IC-POSTING-V1 />`;
  const flow = options.orderedFlow
    ?? `<DF-POSTING><Summary>Posting flow.</Summary><M-GATEWAY /><M-LEDGER /></DF-POSTING>`;

  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/index.xml`,
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns>${owns}</Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    `${ARTIFACT_DIR}/graph/main.xml`,
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN>`
      + `<M-GATEWAY><Summary>Gateway.</Summary><Path>src/a.ts</Path></M-GATEWAY>`
      + `<M-LEDGER><Summary>Ledger.</Summary><Path>src/b.ts</Path></M-LEDGER>`
      + flow
      + `<IC-POSTING-V1>`
      + `<Summary>Posting contract.</Summary>`
      + `<Schema>${schema}</Schema>`
      + `<Version>${version}</Version>`
      + `<Provider><${provider} /></Provider>`
      + `<Consumer><${consumer} /></Consumer>`
      + `<BreakingChangePolicy>${policy}</BreakingChangePolicy>`
      + `</IC-POSTING-V1>`
      + `</GD-MAIN></GraceGraphDocument>`,
  );
}

describe("Phase 7 systems modeling — legacy DF compatibility (written first)", () => {
  it("validates a flat DF-* participant set exactly as before", () => {
    const root = createProject();
    writeLegacyFlowProject(root);
    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    expect(codes(graph.issues)).toEqual([]);
    expect(graph.dataFlows.has("DF-POSTING")).toBe(true);
    expect(graph.dataFlows.get("DF-POSTING")?.steps).toBeUndefined();
    expect(graph.dataFlows.get("DF-POSTING")?.links).toEqual(["M-GATEWAY", "M-LEDGER"]);
    expect(validateGrace4Project(root).issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

describe("Phase 7 systems modeling — IC-* interface contracts", () => {
  it("accepts a well-formed IC-* and exposes it for MustLink / dangling checks", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues).filter((c) => c.startsWith("projection.graph.invalid-interface"))).toEqual([]);
    const contract = graph.interfaceContracts.get("IC-POSTING-V1");
    expect(contract?.schema).toBe("proto/posting.proto");
    expect(contract?.version).toBe("1.2.0");
    expect(contract?.provider).toBe("M-LEDGER");
    expect(contract?.consumers).toEqual(["M-GATEWAY"]);
    expect(contract?.breakingChangePolicy).toBe("additive-only");
    expect(contract?.links).toContain("M-LEDGER");
    expect(contract?.links).toContain("M-GATEWAY");
  });

  it("rejects Schema that escapes the project root", () => {
    const root = createProject();
    writeGraphWithContract(root, { schema: "../../etc/passwd" });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues)).toContain("projection.graph.invalid-interface-contract");
    expect(graph.issues.some((i) => i.message.includes("contained project path"))).toBe(true);
  });

  it("rejects Schema that is missing on disk", () => {
    const root = createProject();
    writeGraphWithContract(root, { schema: "proto/missing.proto" });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues)).toContain("projection.graph.invalid-interface-contract");
    expect(graph.issues.some((i) => i.message.includes("does not exist"))).toBe(true);
  });

  it("rejects Provider naming a nonexistent module", () => {
    const root = createProject();
    writeGraphWithContract(root, { provider: "M-DOES-NOT-EXIST" });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    // Provider M-* is also a dangling link from IC-*; both codes may fire.
    expect(codes(graph.issues)).toContain("projection.graph.invalid-interface-contract");
    expect(graph.issues.some((i) => i.message.includes("Provider") && i.message.includes("M-DOES-NOT-EXIST"))).toBe(true);
  });

  it("rejects a Provider or Consumer child that is not a canonical M-* anchor", () => {
    // Consumer is zero-or-more, so a wrapper element would otherwise record no consumers
    // while the author believes one is declared, with no diagnostic anywhere.
    const consumerRoot = createProject();
    writeGraphWithContract(consumerRoot);
    let text = readFileSync(path.join(consumerRoot, `${ARTIFACT_DIR}/graph/main.xml`), "utf8");
    writeProjectFile(
      consumerRoot,
      `${ARTIFACT_DIR}/graph/main.xml`,
      text.replace("<Consumer><M-GATEWAY /></Consumer>", "<Consumer><Module>M-GATEWAY</Module></Consumer>"),
    );
    const consumerIssues = buildGraphProjection(resolveGrace4Paths(consumerRoot)).issues;
    expect(codes(consumerIssues)).toContain("projection.graph.invalid-interface-contract");
    expect(consumerIssues.some((i) => i.message.includes("<Consumer> does not allow child <Module>"))).toBe(true);

    const providerRoot = createProject();
    writeGraphWithContract(providerRoot);
    text = readFileSync(path.join(providerRoot, `${ARTIFACT_DIR}/graph/main.xml`), "utf8");
    writeProjectFile(
      providerRoot,
      `${ARTIFACT_DIR}/graph/main.xml`,
      text.replace("<Provider><M-LEDGER /></Provider>", "<Provider><Module>M-LEDGER</Module></Provider>"),
    );
    const providerIssues = buildGraphProjection(resolveGrace4Paths(providerRoot)).issues;
    expect(providerIssues.some((i) => i.message.includes("<Provider> does not allow child <Module>"))).toBe(true);
  });

  it("rejects non-semver Version and unknown BreakingChangePolicy", () => {
    const root = createProject();
    writeGraphWithContract(root, { version: "not-a-version", policy: "yolo" });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    const messages = graph.issues.map((i) => i.message).join("\n");
    expect(codes(graph.issues)).toContain("projection.graph.invalid-interface-contract");
    expect(messages).toContain("semver");
    expect(messages).toContain("BreakingChangePolicy");
  });
});

describe("Phase 7 systems modeling — ordered DF-* steps", () => {
  it("rejects a gap in Step order (1, 3)", () => {
    const root = createProject();
    writeGraphWithContract(root, {
      orderedFlow:
        `<DF-POSTING><Summary>Ordered.</Summary>`
        + `<Step order="1"><M-GATEWAY /></Step>`
        + `<Step order="3"><M-LEDGER /></Step>`
        + `</DF-POSTING>`,
    });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues)).toContain("projection.graph.invalid-data-flow-step");
    expect(graph.issues.some((i) => i.message.includes("missing 2"))).toBe(true);
  });

  it("rejects duplicate Step order", () => {
    const root = createProject();
    writeGraphWithContract(root, {
      orderedFlow:
        `<DF-POSTING><Summary>Ordered.</Summary>`
        + `<Step order="1"><M-GATEWAY /></Step>`
        + `<Step order="1"><M-LEDGER /></Step>`
        + `</DF-POSTING>`,
    });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues)).toContain("projection.graph.invalid-data-flow-step");
    expect(graph.issues.some((i) => i.message.includes("duplicate Step order 1"))).toBe(true);
  });

  it("rejects Step naming a nonexistent M-*", () => {
    const root = createProject();
    writeGraphWithContract(root, {
      orderedFlow:
        `<DF-POSTING><Summary>Ordered.</Summary>`
        + `<Step order="1"><M-MISSING-MODULE /></Step>`
        + `</DF-POSTING>`,
    });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues)).toContain("projection.graph.invalid-data-flow-step");
    expect(graph.issues.some((i) => i.message.includes("M-MISSING-MODULE"))).toBe(true);
  });

  it("accepts a well-formed ordered DF with Contract and Properties", () => {
    const root = createProject();
    writeGraphWithContract(root, {
      orderedFlow:
        `<DF-POSTING><Summary>Ordered posting.</Summary>`
        + `<Step order="1"><M-GATEWAY /><Emits>PostingRequested</Emits><Property>authenticated</Property></Step>`
        + `<Step order="2"><M-LEDGER /><Contract><IC-POSTING-V1 /></Contract><Property>idempotent</Property><Property>transactional</Property></Step>`
        + `</DF-POSTING>`,
    });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues).filter((c) => c === "projection.graph.invalid-data-flow-step")).toEqual([]);
    const steps = graph.dataFlows.get("DF-POSTING")?.steps;
    expect(steps).toHaveLength(2);
    expect(steps?.[0]).toMatchObject({ order: 1, moduleId: "M-GATEWAY", emits: "PostingRequested", properties: ["authenticated"] });
    expect(steps?.[1]).toMatchObject({
      order: 2,
      moduleId: "M-LEDGER",
      contract: "IC-POSTING-V1",
      properties: ["idempotent", "transactional"],
    });
  });

  it("rejects unknown Property values", () => {
    const root = createProject();
    writeGraphWithContract(root, {
      orderedFlow:
        `<DF-POSTING><Summary>Ordered.</Summary>`
        + `<Step order="1"><M-GATEWAY /><Property>magic</Property></Step>`
        + `</DF-POSTING>`,
    });
    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(codes(graph.issues)).toContain("projection.graph.invalid-data-flow-step");
    expect(graph.issues.some((i) => i.message.includes("magic"))).toBe(true);
  });
});

describe("Phase 7 systems modeling — invariants.xml", () => {
  it("projects without invariants.xml remain unaffected", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    expect(existsSync(path.join(root, ".grace/context/invariants.xml"))).toBe(false);
    const before = codes(validateGrace4Project(root).issues);
    expect(before.filter((c) => c.startsWith("context.invariants."))).toEqual([]);
    expect(validateGrace4Project(root).issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("rejects empty Statement and invalid AppliesTo children", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/invariants.xml`,
      `<GraceInvariants graceVersion="4.0">`
        + `<INV-EMPTY><Statement></Statement></INV-EMPTY>`
        + `<INV-BAD-APPLIES><Statement>x</Statement><AppliesTo><NotAnAnchor /></AppliesTo></INV-BAD-APPLIES>`
        + `</GraceInvariants>`,
    );
    const resultCodes = codes(validateGrace4Project(root).issues);
    expect(resultCodes).toContain("context.invariants.empty-statement");
    expect(resultCodes).toContain("context.invariants.invalid-applies-to");
  });

  it("accepts well-formed INV-* anchors", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/invariants.xml`,
      `<GraceInvariants graceVersion="4.0">`
        + `<INV-IDEMPOTENT-WRITES>`
        + `<Statement>Every ledger write is idempotent under posting id.</Statement>`
        + `<AppliesTo><M-EXAMPLE /></AppliesTo>`
        + `<Verification><V-M-EXAMPLE /></Verification>`
        + `</INV-IDEMPOTENT-WRITES>`
        + `</GraceInvariants>`,
    );
    expect(codes(validateGrace4Project(root).issues).filter((c) => c.startsWith("context.invariants."))).toEqual([]);
  });
});

describe("Phase 7 systems modeling — assertions", () => {
  it("MustConform without --run-commands validates references only", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = context(root);
    expect(evaluateAssertion(assertion("MustConform", ["IC-POSTING-V1", "M-GATEWAY", "exit 99"]), ctx)).toHaveLength(0);
    expect(
      evaluateAssertion(assertion("MustConform", ["IC-MISSING", "M-GATEWAY", "exit 0"]), ctx)[0]?.message,
    ).toContain("IC-MISSING");
    expect(
      evaluateAssertion(assertion("MustConform", ["IC-POSTING-V1", "M-MISSING", "exit 0"]), ctx)[0]?.message,
    ).toContain("M-MISSING");
  });

  it("MustConform with --run-commands executes the command", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const fail = evaluateAssertion(assertion("MustConform", ["IC-POSTING-V1", "M-GATEWAY", "exit 99"]), ctx);
    expect(fail).toHaveLength(1);
    expect(fail[0]?.code).toBe("assertion.MustConform");
    expect(evaluateAssertion(assertion("MustConform", ["IC-POSTING-V1", "M-GATEWAY", "exit 0"]), ctx)).toHaveLength(0);
  });

  it("MustUphold checks invariant and AppliesTo membership", () => {
    const root = createProject();
    writeGraphWithContract(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/invariants.xml`,
      `<GraceInvariants graceVersion="4.0">`
        + `<INV-IDEMPOTENT><Statement>Idempotent writes.</Statement><AppliesTo><M-LEDGER /></AppliesTo></INV-IDEMPOTENT>`
        + `</GraceInvariants>`,
    );
    const ctx = context(root);
    expect(evaluateAssertion(assertion("MustUphold", ["INV-IDEMPOTENT", "M-LEDGER"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustUphold", ["INV-IDEMPOTENT", "M-GATEWAY"]), ctx)[0]?.code).toBe("assertion.MustUphold");
    expect(evaluateAssertion(assertion("MustUphold", ["INV-MISSING", "M-LEDGER"]), ctx)[0]?.code).toBe("assertion.MustUphold");
  });

  it("MustPassBudget p99=42 vs lt 50 ms passes", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const cmd = process.platform === "win32" ? "echo p99=42" : "printf 'p99=42\\n'";
    expect(
      evaluateAssertion(assertion("MustPassBudget", [cmd, "p99", "lt", "50", "ms"]), ctx),
    ).toHaveLength(0);
  });

  it("MustPassBudget p99=61 vs lt 50 ms fails comparison", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const cmd = process.platform === "win32" ? "echo p99=61" : "printf 'p99=61\\n'";
    const issues = evaluateAssertion(assertion("MustPassBudget", [cmd, "p99", "lt", "50", "ms"]), ctx);
    expect(issues[0]?.code).toBe("assertion.MustPassBudget");
  });

  it("MustPassBudget with no match emits assertion.budget-no-match", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const cmd = process.platform === "win32" ? "echo no metrics here" : "printf 'no metrics here\\n'";
    const issues = evaluateAssertion(assertion("MustPassBudget", [cmd, "p99", "lt", "50", "ms"]), ctx);
    expect(issues[0]?.code).toBe("assertion.budget-no-match");
  });

  it("rejects an Extract whose only parentheses capture nothing", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const cmd = process.platform === "win32" ? "echo p99=42" : "printf 'p99=42\\n'";

    // `(?:…)` and `(?=…)` contain "(" but capture nothing. Without a real capture-group
    // check these surface as budget-no-match, blaming the command for an Extract mistake.
    for (const extract of ["p99(?:ms)?\\s*[=:]\\s*[0-9.]+", "(?=p99)[0-9.]+"]) {
      const issues = evaluateAssertion(assertion("MustPassBudget", [cmd, "p99", "lt", "50", "ms", extract]), ctx);
      expect(issues[0]?.code).toBe("assertion.invalid-pattern");
      expect(issues[0]?.message).toContain("capture group");
    }

    // A named group does capture, and must still be accepted.
    expect(
      evaluateAssertion(assertion("MustPassBudget", [cmd, "p99", "lt", "50", "ms", "p99=(?<value>[0-9.]+)"]), ctx),
    ).toHaveLength(0);
  });

  it("MustPassBudget command failure emits assertion.budget-command-failed", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const issues = evaluateAssertion(assertion("MustPassBudget", ["exit 7", "p99", "lt", "50", "ms"]), ctx);
    expect(issues[0]?.code).toBe("assertion.budget-command-failed");
  });

  it("MustPassBudget non-numeric capture emits assertion.budget-not-a-number", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const ctx = { ...context(root), runCommands: true };
    const cmd = process.platform === "win32" ? "echo p99=NaN" : "printf 'p99=NaN\\n'";
    // Number("NaN") is NaN → not finite
    const issues = evaluateAssertion(
      assertion("MustPassBudget", [cmd, "p99", "lt", "50", "ms", "p99\\s*=\\s*([A-Za-z]+)"]),
      ctx,
    );
    expect(issues[0]?.code).toBe("assertion.budget-not-a-number");
  });

  it("MustPassBudget without --run-commands is not evaluated", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const issues = evaluateAssertion(
      assertion("MustPassBudget", ["echo p99=1", "p99", "lt", "50", "ms"]),
      context(root),
    );
    expect(issues[0]?.code).toBe("assertion.command-not-evaluated");
  });

  it("MustExist sees IC-* and INV-* anchors", () => {
    const root = createProject();
    writeGraphWithContract(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/context/invariants.xml`,
      `<GraceInvariants graceVersion="4.0"><INV-X><Statement>x</Statement></INV-X></GraceInvariants>`,
    );
    const ctx = context(root);
    expect(evaluateAssertion(assertion("MustExist", ["IC-POSTING-V1"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustExist", ["INV-X"]), ctx)).toHaveLength(0);
  });
});

describe("Phase 7 systems modeling — ownership and scope wiring", () => {
  it("includes IC-* in durable ownership index (pins scope.ts ownership change)", () => {
    const root = createProject();
    writeGraphWithContract(root);
    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);
    const ownership = createDurableOwnershipIndex(graph, verification);
    const owned = ownership.graphDocuments.get("GD-MAIN");
    expect(owned?.has("IC-POSTING-V1")).toBe(true);
    expect(owned?.has("M-GATEWAY")).toBe(true);
    expect(owned?.has("DF-POSTING")).toBe(true);
  });

  it("accepts IC-* under DurableScope GraphAnchors and as a direct DurableScope child", () => {
    const root = createProject();
    writeGraphWithContract(root);
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-CONTRACT/spec.xml`,
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-CONTRACT><Summary>s</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints><NonGoals><NonGoal>n</NonGoal></NonGoals><AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria><AffectedAreas><IC-POSTING-V1 /><M-GATEWAY /></AffectedAreas><VerificationIntent><ExpectedCommand>echo ok</ExpectedCommand></VerificationIntent></C-CONTRACT></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      `${ARTIFACT_DIR}/changes/active/C-CONTRACT/plan.xml`,
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-CONTRACT>`
        + `<IntentSummary>Contract change.</IntentSummary>`
        + `<BaselineAssertions><MustExist><Value>IC-POSTING-V1</Value></MustExist></BaselineAssertions>`
        + `<TargetAssertions><MustConform><Contract>IC-POSTING-V1</Contract><Module>M-GATEWAY</Module><Command>exit 0</Command></MustConform></TargetAssertions>`
        + `<DurableScope><GraphAnchors><IC-POSTING-V1 /><M-GATEWAY /></GraphAnchors></DurableScope>`
        + `<ObservedWriteScope><File>proto/posting.proto</File></ObservedWriteScope>`
        + `<ImplementationPlan><T-001><Title>t</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria><Verification><Command>echo ok</Command></Verification></T-001></ImplementationPlan>`
        + `</C-CONTRACT></GraceChangePlan>`,
    );
    const scopes = collectActiveChangeScopes(resolveGrace4Paths(root));
    const contract = scopes.find((s) => s.changeId === "C-CONTRACT");
    expect(contract?.durable.graphAnchors).toContain("IC-POSTING-V1");
    expect(contract?.durable.graphAnchors).toContain("M-GATEWAY");
    expect(scopes.flatMap((s) => s.issues).map((i) => i.code)).not.toContain("scope.invalid-durable-shape");
  });

  it("applies spec→plan coverage to IC-* exactly as it does to M-*", () => {
    // IC-* is a first-class graph anchor that participates in DurableScope, drift routing
    // and dangling-link checks. Exempting it from G-05 would leave the newest cross-service
    // family as the one place a plan may quietly ignore its authorizing spec.
    const specXml = (affected: string) =>
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-CONTRACT><Summary>s</Summary><Goals><Goal>g</Goal></Goals><Constraints><Constraint>c</Constraint></Constraints><NonGoals><NonGoal>n</NonGoal></NonGoals><AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria><AffectedAreas>${affected}</AffectedAreas><VerificationIntent><ExpectedCommand>echo ok</ExpectedCommand></VerificationIntent></C-CONTRACT></GraceChangeSpec>`;
    const planXml = (durable: string) =>
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-CONTRACT>`
      + `<IntentSummary>Contract change.</IntentSummary>`
      + `<BaselineAssertions><MustExist><Value>M-GATEWAY</Value></MustExist></BaselineAssertions>`
      + `<TargetAssertions><MustVerify><Module>M-GATEWAY</Module></MustVerify></TargetAssertions>`
      + `<DurableScope><GraphAnchors>${durable}</GraphAnchors></DurableScope>`
      + `<ObservedWriteScope><File>proto/posting.proto</File></ObservedWriteScope>`
      + `<ImplementationPlan><T-001><Title>t</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>ok</Criterion></AcceptanceCriteria><Verification><Command>echo ok</Command></Verification></T-001></ImplementationPlan>`
      + `</C-CONTRACT></GraceChangePlan>`;

    const bundleCodes = (affected: string, durable: string) => {
      const root = createProject();
      writeGraphWithContract(root);
      writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-CONTRACT/spec.xml`, specXml(affected));
      writeProjectFile(root, `${ARTIFACT_DIR}/changes/active/C-CONTRACT/plan.xml`, planXml(durable));
      return codes(validateGrace4Project(root).issues);
    };

    expect(bundleCodes("<M-GATEWAY /><IC-POSTING-V1 />", "<M-GATEWAY />")).toContain("change.scope-does-not-cover-spec");
    expect(bundleCodes("<M-GATEWAY />", "<M-GATEWAY /><IC-POSTING-V1 />")).toContain("change.plan-scope-exceeds-spec");
    expect(bundleCodes("<M-GATEWAY /><IC-POSTING-V1 />", "<M-GATEWAY /><IC-POSTING-V1 />")).not.toContain(
      "change.scope-does-not-cover-spec",
    );
  });
});
