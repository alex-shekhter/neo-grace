/**
 * Shared neo-grace temp-project fixtures for unit and integration tests.
 *
 * Not published: package.json#files does not enumerate this directory.
 * Matches the mkdtempSync temp-dir idiom used by grace-lint.test.ts
 * (no afterAll cleanup; OS temp reclamation is fine for tests).
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ARTIFACT_DIR } from "../artifact/paths";

// ---------------------------------------------------------------------------
// Spec types
// ---------------------------------------------------------------------------

export type ModuleSpec = {
  id: string;
  summary?: string;
  path: string;
  type?: string;
  links?: string[];
  /** Optional ST-* UI states declared under <States>. */
  states?: string[];
};

export type GovernedFileSpec = {
  path: string;
  commentPrefix?: string;
  purpose?: string;
  scope?: string;
  depends?: string[];
  links?: string[];
  role?: string;
  mapMode?: string;
  mapEntries?: string[];
  /** Full source body placed after MODULE_CONTRACT / MODULE_MAP. */
  body?: string;
  /**
   * Optional semantic block names (without BLOCK_ prefix).
   * When set and body is empty, renders empty START/END_BLOCK pairs.
   * Prefer putting blocks inside `body` when the block wraps real code.
   */
  blocks?: string[];
};

export type VerificationSpec = {
  moduleId: string;
  cwd?: string;
  testFiles?: string[];
  commands?: string[];
  scenarios?: string[];
  markers?: string[];
  traceAssertions?: string[];
};

export type ChangeSpec = {
  changeId: string;
  location?: "active" | "archive";
  specStatus?: string;
  planStatus?: string;
  planBody?: string;
  planBaselineAssertions?: string;
  planTargetAssertions?: string;
  designContext?: string;
};

export type ContextFileName =
  | "requirements"
  | "technology"
  | "principles"
  | "deployment"
  | "ux-guidelines";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONTEXT: Record<ContextFileName, string> = {
  requirements: `<NgraceRequirements graceVersion="1.0"><Summary>Required behavior.</Summary></NgraceRequirements>`,
  technology: `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`,
  principles: `<NgracePrinciples graceVersion="1.0"><Principle>Prefer evidence.</Principle></NgracePrinciples>`,
  deployment: `<NgraceDeployment graceVersion="1.0"><Applicability>applicable</Applicability></NgraceDeployment>`,
  "ux-guidelines": `<NgraceUXGuidelines graceVersion="1.0"><Applicability>applicable</Applicability></NgraceUXGuidelines>`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp project directory. Same idiom as grace-lint.test.ts createProject(). */
export function createTempProject(prefix = "grace-fixture-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeProjectFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

export function commentPrefixForExtension(ext: string): string {
  switch (ext) {
    case ".py":
    case ".rb":
    case ".sh":
    case ".bash":
    case ".zsh":
      return "#";
    case ".sql":
      return "--";
    case ".clj":
    case ".cljs":
    case ".cljc":
      return ";;";
    default:
      return "//";
  }
}

function commentLine(prefix: string, text: string): string {
  return text.length === 0 ? prefix : `${prefix} ${text}`;
}

function renderModuleContract(prefix: string, spec: GovernedFileSpec): string {
  const purpose = spec.purpose ?? "Fixture governed file.";
  const scope = spec.scope ?? "Test fixture scope.";
  const depends = (spec.depends ?? ["none"]).join(", ");
  const links = (spec.links ?? []).join(", ") || "none";
  const lines = [
    commentLine(prefix, "START_MODULE_CONTRACT"),
    commentLine(prefix, `  PURPOSE: ${purpose}`),
    commentLine(prefix, `  SCOPE: ${scope}`),
    commentLine(prefix, `  DEPENDS: ${depends}`),
    commentLine(prefix, `  LINKS: ${links}`),
  ];
  if (spec.role) {
    lines.push(commentLine(prefix, `  ROLE: ${spec.role}`));
  }
  if (spec.mapMode) {
    lines.push(commentLine(prefix, `  MAP_MODE: ${spec.mapMode}`));
  }
  lines.push(commentLine(prefix, "END_MODULE_CONTRACT"));
  return lines.join("\n");
}

function renderModuleMap(prefix: string, mapEntries: string[]): string {
  const lines = [
    commentLine(prefix, "START_MODULE_MAP"),
    ...mapEntries.map((entry) => commentLine(prefix, `  ${entry}`)),
    commentLine(prefix, "END_MODULE_MAP"),
  ];
  return lines.join("\n");
}

function renderEmptyBlocks(prefix: string, blocks: string[]): string {
  return blocks
    .map((name) => {
      const block = name.startsWith("BLOCK_") ? name.slice("BLOCK_".length) : name;
      return [
        commentLine(prefix, `START_BLOCK_${block}`),
        commentLine(prefix, `END_BLOCK_${block}`),
      ].join("\n");
    })
    .join("\n");
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function listRelativeFiles(dir: string, base = dir): string[] {
  const entries = readdirSync(dir).sort();
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const rel = path.relative(base, full).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) {
      out.push(...listRelativeFiles(full, base));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Snapshot of relative path → contents for determinism checks. */
export function snapshotProjectTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const rel of listRelativeFiles(root)) {
    snapshot[rel] = readFileSync(path.join(root, rel), "utf8");
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class GraceProjectBuilder {
  private readonly modules: ModuleSpec[] = [];
  private readonly dataFlows: Array<{ id: string; members: string[]; summary?: string }> = [];
  private readonly verifications: VerificationSpec[] = [];
  private readonly files = new Map<string, string>();
  private readonly changes: ChangeSpec[] = [];
  private readonly contextOverrides: Partial<Record<ContextFileName, string>> = {};

  constructor(private readonly root: string = createTempProject()) {}

  context(overrides: Partial<Record<ContextFileName, string>>): this {
    Object.assign(this.contextOverrides, overrides);
    return this;
  }

  module(spec: ModuleSpec): this {
    this.modules.push(spec);
    return this;
  }

  dataFlow(id: string, memberIds: string[], summary?: string): this {
    this.dataFlows.push({ id, members: memberIds, summary });
    return this;
  }

  verification(spec: VerificationSpec): this {
    this.verifications.push(spec);
    return this;
  }

  file(relPath: string, contents: string): this {
    this.files.set(relPath.replaceAll("\\", "/"), contents);
    return this;
  }

  governedFile(spec: GovernedFileSpec): this {
    const relPath = spec.path.replaceAll("\\", "/");
    const prefix = spec.commentPrefix ?? commentPrefixForExtension(path.extname(relPath));
    const header = renderModuleContract(prefix, spec);
    const map = spec.mapEntries && spec.mapEntries.length > 0
      ? renderModuleMap(prefix, spec.mapEntries)
      : "";
    let body = spec.body ?? "";
    if (!body && spec.blocks && spec.blocks.length > 0) {
      body = renderEmptyBlocks(prefix, spec.blocks);
    }
    const parts = [header, map, body].filter((part) => part.length > 0);
    this.files.set(relPath, `${parts.join("\n")}\n`);
    return this;
  }

  change(spec: ChangeSpec): this {
    this.changes.push(spec);
    return this;
  }

  write(): string {
    // 1. Context artifacts
    for (const name of Object.keys(DEFAULT_CONTEXT) as ContextFileName[]) {
      writeProjectFile(
        this.root,
        `${ARTIFACT_DIR}/context/${name}.xml`,
        this.contextOverrides[name] ?? DEFAULT_CONTEXT[name],
      );
    }

    // 2. Graph: index + main document
    const ownedIds = [
      ...this.modules.map((m) => m.id),
      ...this.dataFlows.map((df) => df.id),
    ];
    const ownsXml = ownedIds.map((id) => `<${id} />`).join("");
    writeProjectFile(
      this.root,
      `${ARTIFACT_DIR}/graph/index.xml`,
      `<NgraceGraphIndex graceVersion="1.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns>${ownsXml}</Owns></GD-MAIN></GraphDocuments></NgraceGraphIndex>`,
    );

    const moduleElements = this.modules.map((m) => {
      const summary = escapeXml(m.summary ?? `${m.id} fixture module.`);
      const modulePath = escapeXml(m.path);
      const typeXml = m.type ? `<Type>${escapeXml(m.type)}</Type>` : "";
      const statesXml = m.states && m.states.length > 0
        ? `<States>${m.states.map((state) => `<${state} />`).join("")}</States>`
        : "";
      const linksXml = (m.links ?? []).map((link) => `<${link} />`).join("");
      return `<${m.id}><Summary>${summary}</Summary><Path>${modulePath}</Path>${typeXml}${statesXml}${linksXml}</${m.id}>`;
    }).join("");

    const dataFlowElements = this.dataFlows.map((df) => {
      const summary = escapeXml(df.summary ?? `${df.id} fixture flow.`);
      const members = df.members.map((id) => `<${id} />`).join("");
      return `<${df.id}><Summary>${summary}</Summary>${members}</${df.id}>`;
    }).join("");

    writeProjectFile(
      this.root,
      `${ARTIFACT_DIR}/graph/main.xml`,
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN>${moduleElements}${dataFlowElements}</GD-MAIN></NgraceGraphDocument>`,
    );

    // 3. Verification: auto-synthesize missing coverage so unrelated tests
    //    do not drown in projection.verification.missing-module-coverage.
    const verificationByModule = new Map(this.verifications.map((v) => [v.moduleId, v]));
    const effectiveVerifications: VerificationSpec[] = this.modules.map((m) => {
      const existing = verificationByModule.get(m.id);
      if (existing) {
        return existing;
      }
      return {
        moduleId: m.id,
        commands: [`echo "fixture verification for ${m.id}"`],
        scenarios: [`${m.id} fixture scenario.`],
      };
    });
    // Also keep any verifications declared for modules not in the module list
    for (const v of this.verifications) {
      if (!this.modules.some((m) => m.id === v.moduleId)) {
        effectiveVerifications.push(v);
      }
    }

    const verificationOwns = effectiveVerifications
      .map((v) => `<V-${v.moduleId} />`)
      .join("");
    writeProjectFile(
      this.root,
      `${ARTIFACT_DIR}/verification/index.xml`,
      `<NgraceVerificationIndex graceVersion="1.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns>${verificationOwns}</Owns></VD-MAIN></VerificationDocuments></NgraceVerificationIndex>`,
    );

    const verificationElements = effectiveVerifications.map((v) => {
      const parts: string[] = [];
      if (v.cwd) {
        parts.push(`<Cwd>${escapeXml(v.cwd)}</Cwd>`);
      }
      if (v.testFiles && v.testFiles.length > 0) {
        parts.push(`<TestFiles>${v.testFiles.map((f) => `<File>${escapeXml(f)}</File>`).join("")}</TestFiles>`);
      }
      for (const command of v.commands ?? []) {
        parts.push(`<Command>${escapeXml(command)}</Command>`);
      }
      for (const scenario of v.scenarios ?? []) {
        parts.push(`<Scenario>${escapeXml(scenario)}</Scenario>`);
      }
      for (const marker of v.markers ?? []) {
        parts.push(`<Marker>${escapeXml(marker)}</Marker>`);
      }
      for (const assertion of v.traceAssertions ?? []) {
        parts.push(`<TraceAssertion>${escapeXml(assertion)}</TraceAssertion>`);
      }
      return `<V-${v.moduleId}>${parts.join("")}</V-${v.moduleId}>`;
    }).join("");

    writeProjectFile(
      this.root,
      `${ARTIFACT_DIR}/verification/main.xml`,
      `<NgraceVerificationDocument graceVersion="1.0"><VD-MAIN>${verificationElements}</VD-MAIN></NgraceVerificationDocument>`,
    );

    // 4. Change directories + optional bundles
    mkdirSync(path.join(this.root, ARTIFACT_DIR, "changes", "active"), { recursive: true });
    mkdirSync(path.join(this.root, ARTIFACT_DIR, "changes", "archive"), { recursive: true });

    for (const change of this.changes) {
      writeChangeBundle(this.root, change);
    }

    // 5. Plain + governed files
    for (const [relPath, contents] of this.files) {
      writeProjectFile(this.root, relPath, contents);
    }

    return this.root;
  }
}

function writeChangeBundle(root: string, options: ChangeSpec): void {
  const location = options.location ?? "active";
  const changeId = options.changeId;
  const bundleRoot = `${ARTIFACT_DIR}/changes/${location}/${changeId}`;
  const specStatus = options.specStatus ?? "draft";

  writeProjectFile(
    root,
    `${bundleRoot}/spec.xml`,
    `<NgraceChangeSpec graceVersion="1.0" status="${specStatus}"><${changeId}><Summary>Fixture change.</Summary><Problem>Fixture problem.</Problem><Goals><Goal>Exercise the change lifecycle.</Goal></Goals><Constraints><Constraint>Preserve fixture validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand><ExpectedEvidence>Passing tests.</ExpectedEvidence></VerificationIntent><Assumptions><Assumption>The fixture project exists.</Assumption></Assumptions></${changeId}></NgraceChangeSpec>`,
  );

  if (options.planStatus) {
    const planBody = `<IntentSummary>Apply the fixture change.</IntentSummary><BaselineAssertions>${options.planBaselineAssertions ?? "<MustExist><Value>M-EXAMPLE</Value></MustExist>"}</BaselineAssertions><TargetAssertions>${options.planTargetAssertions ?? "<MustVerify><Module>M-EXAMPLE</Module></MustVerify>"}</TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>${options.planBody ?? ""}<ImplementationPlan><T-001><Title>Apply fixture change</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan>`;
    writeProjectFile(
      root,
      `${bundleRoot}/plan.xml`,
      `<NgraceChangePlan graceVersion="1.0" status="${options.planStatus}"><${changeId}>${planBody}</${changeId}></NgraceChangePlan>`,
    );
  }

  if (options.designContext) {
    writeProjectFile(root, `${bundleRoot}/design-context.xml`, options.designContext);
  }
}

// ---------------------------------------------------------------------------
// Ready-made scenario builders
// ---------------------------------------------------------------------------

/** Smallest project that lints clean: one module, one governed .ts, one verification. */
export function minimalTsFixture(): string {
  return new GraceProjectBuilder(createTempProject("grace-minimal-"))
    .module({
      id: "M-EXAMPLE",
      summary: "Example module.",
      path: "src/example.ts",
    })
    .governedFile({
      path: "src/example.ts",
      purpose: "Example runtime.",
      scope: "Small fixture.",
      depends: ["none"],
      links: ["M-EXAMPLE"],
      role: "RUNTIME",
      mapMode: "EXPORTS",
      mapEntries: ["run - Execute the example runtime."],
      // The marker is emitted inside the block it names. Both checks are
      // independent today, but later phases copy this file as a template.
      body: `export function run() {
  // START_BLOCK_RUN
  console.info("[Example][run][BLOCK_RUN] run");
  return "ok";
  // END_BLOCK_RUN
}
`,
    })
    .file("src/example.test.ts", `import { expect, test } from "bun:test";\ntest("example", () => expect(1).toBe(1));\n`)
    .verification({
      moduleId: "M-EXAMPLE",
      commands: ["bun test src/example.test.ts"],
      scenarios: ["Example works."],
      markers: ["[Example][run][BLOCK_RUN]"],
    })
    .write();
}

/**
 * Rust + Go + TSX polyglot fixture used to reproduce G-01 / G-02.
 * At HEAD: lints with zero errors (silent skip of Rust/Go parity),
 * but M-LEDGER-CORE module health is blocked on required-log-marker-not-found
 * because marker evidence is JS/TS-shaped only (G-02).
 */
export function polyglotFixture(): string {
  return new GraceProjectBuilder(createTempProject("grace-polyglot-"))
    .module({
      id: "M-LEDGER-CORE",
      summary: "Ledger core posting logic.",
      path: "services/ledger/src/lib.rs",
      type: "CORE_LOGIC",
    })
    .module({
      id: "M-GATEWAY-ROUTER",
      summary: "Gateway request router.",
      path: "services/gateway/internal/router/router.go",
      type: "INTEGRATION",
    })
    .module({
      id: "M-WEB-LEDGER-TABLE",
      summary: "Web ledger table component.",
      path: "apps/web/src/components/LedgerTable.tsx",
      type: "UI_COMPONENT",
      // Declare and cover default state so Phase 6 health stays ready for this fixture.
      states: ["ST-DEFAULT"],
    })
    .dataFlow("DF-POSTING", ["M-WEB-LEDGER-TABLE", "M-GATEWAY-ROUTER", "M-LEDGER-CORE"], "Posting flow.")
    .governedFile({
      path: "services/ledger/src/lib.rs",
      purpose: "Ledger core posting and balance validation.",
      scope: "Post journal entries with balance checks.",
      depends: ["none"],
      links: ["M-LEDGER-CORE"],
      role: "RUNTIME",
      mapMode: "EXPORTS",
      mapEntries: ["post - Post a balanced journal entry."],
      body: `pub fn post(amount: i64) -> Result<(), String> {
    // START_BLOCK_VALIDATE_BALANCE
    tracing::warn!("[LedgerCore][post][BLOCK_VALIDATE_BALANCE] unbalanced");
    if amount == 0 {
        return Err("zero amount".into());
    }
    // END_BLOCK_VALIDATE_BALANCE
    Ok(())
}
`,
    })
    .governedFile({
      path: "services/gateway/internal/router/router.go",
      purpose: "Route gateway requests to ledger services.",
      scope: "Dispatch inbound HTTP/gRPC traffic.",
      depends: ["none"],
      links: ["M-GATEWAY-ROUTER"],
      role: "RUNTIME",
      mapMode: "EXPORTS",
      mapEntries: ["Route - Dispatch a gateway request."],
      body: `func Route(path string) error {
	// START_BLOCK_DISPATCH
	slog.Info("[GatewayRouter][Route][BLOCK_DISPATCH] dispatch")
	// END_BLOCK_DISPATCH
	return nil
}
`,
    })
    .governedFile({
      path: "apps/web/src/components/LedgerTable.tsx",
      purpose: "Render ledger rows in the web UI.",
      scope: "Presentational ledger table.",
      depends: ["none"],
      links: ["M-WEB-LEDGER-TABLE"],
      role: "RUNTIME",
      mapMode: "EXPORTS",
      mapEntries: ["LedgerTable - Render the ledger table."],
      body: `export function LedgerTable() {
  return null;
}
`,
    })
    .file(
      "apps/web/src/components/LedgerTable.test.ts",
      `import { expect, test } from "bun:test";\n\ntest("renders", () => expect(1).toBe(1));\n`,
    )
    .verification({
      moduleId: "M-LEDGER-CORE",
      cwd: "services/ledger",
      commands: ["cargo test --lib"],
      scenarios: ["Ledger posts balanced entries."],
      markers: ["[LedgerCore][post][BLOCK_VALIDATE_BALANCE]"],
    })
    .verification({
      moduleId: "M-GATEWAY-ROUTER",
      cwd: "services/gateway",
      commands: ["go test ./internal/router/..."],
      scenarios: ["Gateway dispatches routes."],
      markers: ["[GatewayRouter][Route][BLOCK_DISPATCH]"],
    })
    .verification({
      moduleId: "M-WEB-LEDGER-TABLE",
      cwd: "apps/web",
      commands: ["bun test apps/web/src/components/LedgerTable.test.ts"],
      // Scenario names ST-DEFAULT ("default") so health.ui-state-unverified stays quiet.
      scenarios: ["Ledger table default render."],
      // TraceAssertion rather than Marker: a UI component proves render behavior
      // through tests, not log emission.
      traceAssertions: ["Render output is asserted by component tests without runtime log emission."],
    })
    .write();
}

/**
 * N modules, N governed TS files, single GD-MAIN / VD-MAIN.
 * Used for scale checks and the ~0.14s performance property.
 */
export function scaleFixture(moduleCount: number): string {
  const builder = new GraceProjectBuilder(createTempProject("grace-scale-"));
  for (let i = 1; i <= moduleCount; i += 1) {
    const id = `M-SCALE-${String(i).padStart(3, "0")}`;
    const filePath = `src/scale/m${String(i).padStart(3, "0")}.ts`;
    const fn = `run${i}`;
    builder
      .module({
        id,
        summary: `Scale fixture module ${i}.`,
        path: filePath,
      })
      .governedFile({
        path: filePath,
        purpose: `Scale module ${i}.`,
        scope: "Generated scale fixture.",
        depends: ["none"],
        links: [id],
        role: "RUNTIME",
        mapMode: "EXPORTS",
        mapEntries: [`${fn} - Scale fixture entrypoint.`],
        body: `export function ${fn}() {\n  return ${i};\n}\n`,
      })
      .verification({
        moduleId: id,
        commands: [`echo "scale ${i}"`],
        scenarios: [`Scale module ${i} works.`],
      });
  }
  return builder.write();
}
