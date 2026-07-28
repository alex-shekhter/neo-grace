# GRACE 4 Evaluation, Findings, and Improvement Plan

**Evaluator:** Senior AI / agentic-systems review (Grok 4.5 Heavy)  
**Subject:** GRACE marketplace package `@osovv/grace-cli` / skills surface, version **4.0.4**  
**Source reviewed:** `/Users/sas/Projects/grace-marketplace` (canonical `skills/grace/*`, CLI `src/`, packaging, explainer references)  
**Target use cases:** projects with **high UI/UX requirements** and **very complex backends in Rust and Go**  
**Date:** 2026-07-28  
**Document status:** Findings + actionable plan (not an implementation PR)

---

## 1. Executive summary

GRACE (Graph-RAG Anchored Code Engineering) version 4 is a **contract-first, fail-closed agentic engineering methodology**. It externalizes what coding agents normally keep only in chat: requirements context, module graph, verification contracts, change specs/plans, scopes, and machine-checkable assertions—all under a durable `.grace/` model with grep-stable semantic anchors in both XML and source comments.

**Verdict in one paragraph:** GRACE 4 is unusually strong for **governed multi-step implementation**, **parallel-safe multi-agent work**, **drift control**, and **evidence-based completion** on backend-shaped modules with clear public interfaces and deterministic tests. It is **not yet a first-class methodology for high-end UI/UX work** (visual design systems, interaction quality, accessibility evidence, design-to-code fidelity) and it is **only partially ready for industrial Rust/Go backends** (extensions recognized; no export-parity adapters; verification model still biased toward log-marker / unit-test patterns typical of TS services). The core ideas are language-agnostic and extensible; the **tooling and skill depth currently center TypeScript/Python/Dart** and a module-centric graph that under-models design, API contracts, concurrency, and cross-service systems.

**Bottom line for adoption:**

| Domain | Fit today | Path to strong fit |
| --- | --- | --- |
| Complex modular backends (general) | Strong | Extend verification levels & polyglot adapters |
| Go / Rust systems services | Medium | Language adapters + crate/package graph + build/test matrix |
| High UI/UX product surfaces | Weak–medium | UX artifact model, design contracts, visual/a11y verification kinds |
| Multi-language monorepos (TS + Go + Rust) | Medium | Multi-root technology model, package-scoped projections |
| Tiny scripts / one-file hacks | Poor by design | Keep out of full GRACE; use escape hatch |

This document explains **how GRACE works**, its **strengths and weak points**, whether it is **project-type-limited**, and a **detailed multi-phase plan** to make it credible for premium UI and complex Rust/Go systems without destroying the fail-closed core.

---

## 2. How GRACE 4 works

### 2.1 Mental model

GRACE assumes agents fail less when they:

1. **Navigate by stable anchors** rather than free-form “read the whole repo.”
2. **Separate WHAT from HOW** via contracts (PCAM: Purpose, Constraints, Autonomy, Metrics).
3. **Prove completion with machine-checkable evidence**, not narrative claims.
4. **Never silently rewrite the approved plan**; supersede and replan instead.
5. **Scope writes** so parallel workers cannot collide or mutate durable architecture ad hoc.

The durable project model is `.grace/`:

| Area | Role |
| --- | --- |
| `.grace/context/*.xml` | Requirements, technology, principles, deployment, UX guidelines |
| `.grace/graph/` | Module / data-flow graph (`GD-*`, `M-*`, `DF-*`) |
| `.grace/verification/` | Per-module verification contracts (`VD-*`, `V-M-*`) |
| `.grace/changes/active|archive/C-*` | Spec + optional design context + plan lifecycle |
| Source file markup | `MODULE_CONTRACT`, `MODULE_MAP`, function contracts, `START_BLOCK_*`, `CHANGE_SUMMARY` |

Legacy GRACE 3 `docs/*.xml` is **not** dual-validated; migration is agent-applied via `$grace-migrate` with explicit cleanup gates.

### 2.2 Lifecycle (agent + CLI)

Canonical flow:

```
grace-init
  → fill .grace/context
  → grace-spec        (draft → user-approved GraceChangeSpec)
  → grace-plan        (assertions, scopes, T-* tasks)
  → grace lint --assertions current     # active-baseline preflight (pre-write)
  → grace lint --change C-ID --assertions baseline [--run-commands]
  → grace-execute (sequential | parallel-safe)
  → task-level verification + central durable apply
  → grace lint --change C-ID --assertions final [--run-commands]
  → explicit apply → archive C-* as applied
```

Supporting skills: `grace-status`, `grace-refresh` (drift → new change, no silent mutation), `grace-fix`, `grace-refactor`, `grace-verification`, `grace-reviewer`, `grace-ask`, `grace-setup-subagents`, `grace-cli`, `grace-explainer`.

### 2.3 Semantic anchors and unique tags

Two complementary anchoring systems:

1. **XML unique tags** (`<M-AUTH>…</M-AUTH>`) instead of generic `<Module id="…">`—reduces closing-tag polysemy for LLMs.
2. **File-local comment markers** (`START_BLOCK_VALIDATE_INPUT`, `LINKS: M-AUTH V-M-AUTH`) that are grep-first navigation targets and map to log markers for trajectory evidence.

This is the Graph-RAG angle: indexes + routed documents + code anchors form a navigable knowledge graph optimized for agent retrieval, not human prose docs alone.

### 2.4 Assertions, scopes, and fail-closed CLI

Plans carry machine-checkable vocabulary:

- **Existence / graph:** `MustExist`, `MustNotExist`, `MustOwn`, `MustLink`, `MustVerify`
- **Content:** `MustContain`, `MustNotContain`
- **Commands:** `MustPassCommand` (leaf project evidence only—tests, typecheck, build—not nested `grace lint`)

Scopes:

- **DurableScope** — which graph/verification/context artifacts the change may permanently alter
- **ObservedWriteScope** — which files/globs workers may touch

Execution phases are deliberate:

| Mode | Meaning |
| --- | --- |
| `current` | Active-baseline preflight only (before observed writes) |
| `baseline` | Immutable selected pre-edit gate |
| `target` | Selected post-edit evidence |
| `final` | Outer apply/archive gate |
| `parallel-preflight` | Scope coexistence for parallel-safe mode |

Health checks demand verification entries, scenarios, commands, and either **Markers** (runtime log evidence + block alignment) or **TraceAssertions** (for pure / non-logging modules).

### 2.5 Language tooling reality

| Capability | Status |
| --- | --- |
| Code extensions recognized | Broad (`.ts`, `.py`, `.go`, `.rs`, `.java`, …) |
| MODULE_MAP export/local parity adapters | **TS/JS bundled**, **Python**, **Dart** only |
| Rust / Go adapters | **Missing** (files can be governed by markup, not by exact export analysis) |
| Technology context | Single `Language` / `Runtime` / `Framework` fields—monolingual bias |
| UX context | Present as `ux-guidelines.xml` but **thin template** (applicability + free-text guidelines) |

### 2.6 Design principles that matter for evaluation

- **Approved plans are immutable.** Drift or wrong plan → supersede, not patch.
- **Workers propose durable deltas; controller applies.** Protects multi-agent races.
- **Public interface in graph; private helpers in file markup.** Prevents graph bloat.
- **Verification is architecture**, not a late CI add-on.
- **Fail closed** on malformed grammar, bad paths, ambiguous ownership, missing runtimes for adapters.

These principles are sound for long-horizon agent autonomy.

---

## 3. Strengths

### 3.1 Best-in-class process scaffolding for agents

Most agentic workflows are chat discipline (“plan then code”). GRACE makes process **stateful, inspectable, and lintable**. Spec/plan approval, baseline/target/final gates, and archive history give continuity across sessions and model swaps—critical when agents have no durable memory.

### 3.2 Graph-RAG oriented navigation

Grep-first order (graph index → document → module → file contracts → blocks) is the right default for large codebases. Unique tags and canonical ID grammar (`M-*`, `V-M-*`, `C-*`, `T-NNN`) reduce ambiguous retrieval and hallucinated module names.

### 3.3 Parallel-safe multi-agent design

Durable vs observed scopes, parallel preflight, and centralized durable apply address the hard problem: **many implementers, one architecture truth**. Subagent role presets (implementer, contract reviewer, verification reviewer, fixer) match real controller/worker patterns.

### 3.4 Verification as first-class architecture

`V-M-*` entries binding commands, test files, scenarios, markers, and optional `Cwd` (monorepo-aware) are better than “tests somewhere.” Failure packets, wave/phase levels, and TraceAssertion for pure modules show maturity from earlier GRACE 3 autonomy gates.

### 3.5 Fail-closed tooling quality

Path containment, assertion phase rules (reject nesting `--assertions current` in target commands), structured JSON errors, drift distinction (explained vs unexplained git changes), and migration cleanup gates show production-minded engineering—not just methodology prose.

### 3.6 Language-agnostic core artifacts

XML context, graph, verification, and change lifecycle do **not** require TypeScript. Markup comment syntax adapts (`//`, `#`, `--`). In principle, Go and Rust projects can adopt GRACE today with agent discipline + `MustPassCommand` evidence (`go test`, `cargo test`, `clippy`, etc.).

### 3.7 Honest UX and deployment applicability hooks

Having dedicated `ux-guidelines.xml` and `deployment.xml` with applicability is correct: not every project is user-facing or deployed. The **slot exists**; depth does not yet.

### 3.8 Drift and refresh without silent mutation

`$grace-refresh` proposing reconciliation through normal change lifecycle is the right integrity model for multi-agent systems that otherwise “fix docs quietly.”

---

## 4. Weak points and risks

### 4.1 Process overhead and ceremony cost

Full lifecycle (spec interview → plan → multi-gate lint → execute → final → apply) is expensive for:

- exploratory UI iteration
- visual polish loops
- hotfixes
- spike prototypes

**Escape hatch exists** (“small direct fix” language in AGENTS template) but is underspecified: no formal **risk tiers** (L0 hotfix / L1 module / L2 architectural / L3 multi-system) with different ceremony.

**Risk:** teams abandon GRACE on product UI work and keep it only for backend, reintroducing methodology fragmentation.

### 4.2 UI/UX is a second-class citizen

Evidence from the package:

- Module type `UI_COMPONENT` exists in knowledge-graph docs only as a label.
- `ux-guidelines.xml` is a free-text bag; no design tokens, component inventory, interaction contracts, a11y criteria, or design-system graph.
- No verification kinds for screenshots, Storybook, visual regression, Playwright/Cypress journeys, axe/a11y scores, or design-token parity.
- Function contracts model **inputs/outputs/side effects**—excellent for services; weak for **layout, motion, state machines of UI, responsive breakpoints, empty/loading/error presentation**.
- Subagent roles have no **design implementer**, **a11y reviewer**, or **visual QA** preset.

**Risk:** high-UX products get “mechanically correct” components that fail product quality bars agents cannot see.

### 4.3 Backend model is module-centric, not systems-centric

Complex Go/Rust backends need first-class concepts that are only lightly modeled:

| Needed concept | GRACE today |
| --- | --- |
| Packages/crates/workspaces | Single path per `M-*`, optional `Cwd` on verification |
| Public API surface (proto/OpenAPI/gRPC) | Annotation tags exist; no dedicated API contract artifacts |
| Concurrency / ownership / lifetime invariants | Free text only |
| Error taxonomy / status codes | Informal |
| Data models / schemas | Table/column tag conventions in docs, not enforced schema graph |
| Cross-service data flows | `DF-*` exists but templates/docs underdevelop multi-service topology |
| Feature flags / config surfaces | Weak |
| Performance / SLO gates | No first-class assertion kinds |
| Build matrix (targets, features, OS) | Only via opaque `MustPassCommand` strings |
| FFI boundaries (Rust↔Go, Rust↔TS) | No boundary module type / contract pattern |

Agents can encode these in prose Constraints, but **prose is not lintable**—the methodology’s own strength is undermined.

### 4.4 Polyglot tooling gap (Rust/Go)

Recognizing `.rs` / `.go` extensions without adapters creates a **false sense of parity**:

- TS gets compiler-backed MODULE_MAP enforcement.
- Python/Dart get runtime adapters with fail-closed missing-runtime diagnostics.
- Rust/Go get comment contracts only → map drift is invisible to `grace lint`.

For crates with `pub use` re-exports, feature-gated APIs, or Go packages with many files per package, the **single-file MODULE_MAP** model also mismatches language package units.

### 4.5 Verification bias toward log markers

Marker + block linkage is excellent for service-domain code with structured logging. It is awkward for:

- pure Rust libraries (partially mitigated by TraceAssertion)
- UI components (console logs are not product evidence)
- systems that use tracing spans / OpenTelemetry without string markers
- property tests, fuzz targets, model checking, invariants

Health can warn on missing markers/trace assertions, but the **cultural default** in skills is still log-marker heavy.

### 4.6 Single-technology context artifact

`GraceTechnology` fields (`Language`, `Runtime`, `Framework`, `TestingStack`) imply one stack. Real targets (React/Next UI + Go API + Rust data plane) need multi-stack declaration, package maps, and per-package verification defaults.

### 4.7 Graph scale and maintenance burden

Every module wants graph + verification + file markup + map. At hundreds of modules, **maintenance tax** and **stale-graph risk** rise. `grace-refresh` helps detect drift but does not reduce authoring cost. Nested anchors are rejected (good for clarity, hard for hierarchical domains).

### 4.8 Skill depth vs skill surface

Many skills are short operational contracts (excellent for CLI alignment) but **thin on methodology heuristics** for hard domains. Explainer references are strong on contracts/markup/graph/verification philosophy; they are light on:

- UI architecture patterns
- Rust module/crate layout
- Go package design
- monorepo orchestration
- progressive disclosure of ceremony

New agents may apply GRACE **correctly and still build the wrong product**.

### 4.9 Immutability can amplify replan thrash

Correct for integrity; costly when early implementation reveals design errors common in UX discovery. Without a **lightweight supersede path** (diff-oriented replan, partial plan replacement, or discovery-mode changes), agents may thrash on new `C-*` bundles.

### 4.10 Human design collaboration missing

High-UX work is human-in-the-loop (Figma, design critique, brand). GRACE encodes user approval at spec/plan/apply gates, but lacks **artifact links to design sources**, review checklists for visual intent, or “design frozen / design fluid” modes.

---

## 5. Is GRACE limited to certain project types?

### 5.1 Implicit sweet spot (today)

GRACE 4’s **implicit center of mass** is:

- Modular applications with clear file/module boundaries
- Deterministic automated tests
- Structured logging
- TypeScript-heavy or adapter-backed languages
- Backend / full-stack service work more than visual product craft

### 5.2 Not formally limited

Nothing in the grammar forbids UI, Rust, or Go. The limitation is **depth of:

1. language analysis,
2. verification vocabulary,
3. context models,
4. skill guidance,
5. examples and fixtures.**

### 5.3 Project types that struggle without extensions

| Type | Friction |
| --- | --- |
| Design-system-driven SPAs / mobile | No visual/a11y evidence model |
| Game UIs / highly interactive clients | Contracts miss temporal/interaction semantics |
| Embedded / no_std Rust | Test/command model may not fit target hardware |
| Large Go monorepos | Package unit ≠ single file module |
| Multi-crate Rust workspaces | Feature matrices, crate graphs under-modeled |
| Data science notebooks | Markup/test model mismatched |
| Infrastructure-as-code heavy repos | Module graph less natural |

### 5.4 Conclusion on generality

GRACE is a **general agentic engineering operating system** with a **currently specialized toolchain**. Generality of principles is high; generality of out-of-the-box effectiveness is medium and skewed. Extending it for UI + Rust/Go is **aligned with the architecture**, not a contradiction of it.

---

## 6. Fit analysis: high UI/UX + complex Rust/Go backends

### 6.1 What works well already for this target

1. **Cross-cutting change bundles** can span UI package + Go API + Rust service if ObservedWriteScope and DurableScope are authored carefully.
2. **Parallel-safe waves** can separate UI and backend workers when scopes do not overlap.
3. **`Cwd` + monorepo-relative test paths** support polyglot package layouts.
4. **MustPassCommand** can encode real gates: `cargo test -p …`, `go test ./…`, `pnpm test`, Playwright, clippy, golangci-lint.
5. **DF-\*** data flows can document UI → BFF → core service paths if authored diligently.
6. **Design-context.xml** can hold UX rationale non-normatively without polluting acceptance criteria.
7. **TraceAssertion** allows pure Rust crates without forced logging.

### 6.2 Critical gaps for this target

```
┌─────────────────────────────────────────────────────────────┐
│ Product surface (UI/UX)                                     │
│  - visual intent, a11y, interaction, design tokens          │
│  - currently: free-text ux-guidelines only                  │
└───────────────────────────┬─────────────────────────────────┘
                            │ weak contracts / weak evidence
┌───────────────────────────▼─────────────────────────────────┐
│ API / BFF boundary                                          │
│  - OpenAPI/proto/versioning under-modeled                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ Complex backends (Go/Rust)                                  │
│  - concurrency, packages/crates, build features             │
│  - adapters missing; module unit mismatch                   │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Failure modes if adopted as-is

1. **Backend agents pass** `cargo test` / `go test` while **public crate/package maps drift**.
2. **UI agents implement acceptance criteria as API behavior** and skip visual/a11y quality.
3. **Integration bugs** at language boundaries escape module-local verification.
4. **UX polish loops** fight plan immutability → process abandonment.
5. **Graph becomes TS-shaped** even when critical logic lives in Rust/Go packages.

### 6.4 Requirements for strong fit (acceptance bar)

GRACE should support a project like:

- Next.js (or similar) design-system UI with strict a11y and visual regression
- Go API gateway / BFF with OpenAPI contracts
- Rust core service(s) with workspace crates, clippy, integration tests, tracing
- Multi-package verification from one `.grace` root
- Parallel UI and backend tasks with shared API contract freeze
- Human design review gates without destroying automated evidence

The plan below is sized to that bar.

---

## 7. Improvement themes (strategy)

### Theme A — Progressive ceremony (don’t force full process always)

Risk-tiered workflows so high-UX iteration and hotfixes stay inside GRACE without full architectural theater.

### Theme B — First-class UX/design artifacts and evidence

Make design intent **lintable and verifiable**, not free text.

### Theme C — Polyglot systems model for Rust/Go (and multi-stack monorepos)

Package/crate units, multi-technology context, language adapters, systems-level verification.

### Theme D — Richer verification vocabulary

Beyond markers: visual, a11y, contract tests, fuzz, perf budgets, tracing span assertions, build matrices.

### Theme E — Skill and role depth

Domain heuristics and subagent presets for UI, a11y, Go, Rust, API boundary, SRE-ish verification.

### Theme F — Ergonomics and scale

Reduce markup tax; optional lighter maps; hierarchical graph documents; auto-suggestions from adapters; better examples.

**Non-negotiable constraints while improving:**

- Keep fail-closed integrity.
- Keep approved-plan immutability (extend with better supersede UX, don’t silent-edit).
- Keep semantic anchors as tags, not attribute soup.
- Prefer leaf evidence in `MustPassCommand`; CLI remains outer lifecycle gate.
- Do not dual-validate GRACE 3.

---

## 8. Detailed improvement plan

### 8.0 Roadmap overview

| Phase | Name | Goal | Horizon |
| --- | --- | --- | --- |
| **0** | Baseline adoption kit | Use GRACE as-is safely on polyglot+UI repos | 1–2 weeks |
| **1** | Progressive ceremony + UX context v1 | Make UX + fast paths real | 3–6 weeks |
| **2** | Polyglot adapters + multi-tech model | Rust/Go first-class in lint/health | 6–12 weeks |
| **3** | Systems verification + API/UX evidence kinds | High-bar product quality evidence | 8–16 weeks |
| **4** | Scale, DX, and reference implementations | Prove on a showcase monorepo | ongoing |

Phases 1–3 can partially overlap after Phase 0.

---

### Phase 0 — Baseline adoption kit (no methodology break)

**Purpose:** Run high-UI + Go/Rust projects **today** without lying about CLI capabilities.

#### 0.1 Project topology conventions (document + AGENTS guidance)

Recommend a **single GRACE root** at monorepo root with graph segmentation:

```
.grace/
  context/
  graph/
    index.xml
    ui.xml          # GD-UI
    api-go.xml      # GD-API-GO
    core-rust.xml   # GD-CORE-RUST
    platform.xml    # GD-PLATFORM
  verification/
    index.xml
    ui.xml
    api-go.xml
    core-rust.xml
  changes/
```

**Module ID namespaces (convention, not grammar change):**

- `M-UI-*` — presentation components/pages
- `M-DS-*` — design-system primitives
- `M-API-*` — Go HTTP/gRPC handlers
- `M-DOM-*` — domain logic (language-agnostic naming)
- `M-RS-*` / crate-aligned modules
- `M-INT-*` — integration/adapters
- `DF-UI-TO-API`, `DF-API-TO-CORE`, etc.

#### 0.2 Verification command matrices (templates)

Ship skill reference snippets (not necessarily grammar changes):

```xml
<!-- Go package -->
<V-M-API-AUTH>
  <Cwd>services/api</Cwd>
  <TestFiles>
    <File>services/api/internal/auth/auth_test.go</File>
  </TestFiles>
  <Command>go test ./internal/auth -count=1</Command>
  <Scenario>Invalid token returns 401 without side effects.</Scenario>
  <TraceAssertion>table-driven cases cover expired, malformed, and revoked tokens</TraceAssertion>
</V-M-API-AUTH>

<!-- Rust crate -->
<V-M-RS-LEDGER>
  <Cwd>crates/ledger</Cwd>
  <TestFiles>
    <File>crates/ledger/tests/transfer.rs</File>
  </TestFiles>
  <Command>cargo test -p ledger --all-features</Command>
  <Scenario>Concurrent transfers preserve balance invariants.</Scenario>
  <TraceAssertion>loom or integration test asserts no lost updates</TraceAssertion>
</V-M-RS-LEDGER>

<!-- UI journey -->
<V-M-UI-CHECKOUT>
  <Cwd>apps/web</Cwd>
  <TestFiles>
    <File>apps/web/e2e/checkout.spec.ts</File>
  </TestFiles>
  <Command>pnpm --filter web test:e2e checkout</Command>
  <Scenario>Keyboard-only user completes checkout.</Scenario>
  <TraceAssertion>axe violations = 0 on checkout route</TraceAssertion>
</V-M-UI-CHECKOUT>
```

#### 0.3 Explicit “no false parity” rule in skills

Update `grace-cli`, `grace-reviewer`, `grace-verification` to state:

> MODULE_MAP parity is enforced only for adapter-backed languages (TS/JS, Python, Dart). For Go/Rust, treat MODULE_MAP as human/agent-maintained and require `MustPassCommand` + package-level tests as the source of structural truth until adapters ship.

#### 0.4 Deliverables

- `docs/` or skill references: **polyglot monorepo playbook**
- Example fixture project skeleton (even if synthetic) under marketplace `examples/`
- Checklist for Phase 0 project onboarding

**Exit criteria:** A team can initialize GRACE on a TS+Go+Rust monorepo and complete one cross-stack change without inventing conventions from scratch.

---

### Phase 1 — Progressive ceremony + UX context v1

#### 1.1 Risk-tiered change classes

Extend methodology (skills + optional plan metadata) with explicit tiers:

| Tier | Name | Ceremony | Use when |
| --- | --- | --- | --- |
| **T0** | Hotfix | Minimal: issue link + ObservedWriteScope + target tests; optional thin plan | Production break/fix |
| **T1** | Module change | Full spec+plan, single package | Normal feature slice |
| **T2** | Cross-cutting | Full + multi-wave + integration gates | API+UI or multi-crate |
| **T3** | Architectural | Full + design freeze + multi-phase verification | New subsystem, redesign |

**Implementation options (prefer least grammar break first):**

1. **Skill-only (v1):** `grace-spec` asks for tier; encodes in `Constraints` / design-context; plan templates differ.
2. **Grammar (v1.1):** optional `<ChangeClass>T1</ChangeClass>` on `GraceChangeSpec` with lint rules for required sections per class.

#### 1.2 UX context model v1 (structured, still XML)

Expand `GraceUXGuidelines` (or split companion artifacts) beyond free text:

```xml
<GraceUXGuidelines graceVersion="4.0">
  <Applicability>applicable</Applicability>
  <Audience>…</Audience>
  <DesignSystem>
    <Library>@acme/ui</Library>
    <TokenSource>packages/ui/tokens.json</TokenSource>
    <FigmaFile>…</FigmaFile>
  </DesignSystem>
  <Accessibility>
    <Standard>WCAG-2.2-AA</Standard>
    <KeyboardRequired>true</KeyboardRequired>
    <ReducedMotion>honor</ReducedMotion>
  </Accessibility>
  <InteractionPrinciples>
    <Principle>Optimistic UI only when rollback is safe and visible</Principle>
  </InteractionPrinciples>
  <Content>
    <Tone>…</Tone>
    <i18n>required</i18n>
  </Content>
  <EvidenceDefaults>
    <Preferred>component-test</Preferred>
    <Preferred>a11y-scan</Preferred>
    <Preferred>visual-regression</Preferred>
    <Preferred>e2e-journey</Preferred>
  </EvidenceDefaults>
  <Guideline>…</Guideline>
</GraceUXGuidelines>
```

Lint: if `Applicability=applicable`, require DesignSystem **or** explicit `Reason` why deferred; warn if no EvidenceDefaults.

#### 1.3 UI module contract extensions (file-local)

Extend recommended `START_MODULE_CONTRACT` / function contracts for UI (compatible comments):

```
// START_MODULE_CONTRACT
//   PURPOSE: Checkout summary panel
//   SCOPE: display totals, discounts, tax; no payment capture
//   TYPE: UI_COMPONENT
//   STATES: loading | ready | error | empty
//   A11Y: role=region, labelled-by=checkout-heading, focus trap=false
//   TOKENS: color.surface, space.4, type.body
//   DEPENDS: M-DS-BUTTON M-API-CHECKOUT-CLIENT
//   LINKS: M-UI-CHECKOUT V-M-UI-CHECKOUT DF-UI-TO-API
// END_MODULE_CONTRACT
```

Skills: `grace-plan` / `grace-execute` must treat missing STATES/A11Y on `UI_COMPONENT` as plan quality warnings when UX applicability is on.

#### 1.4 Discovery-mode supersede path

Add skill guidance (and later CLI helpers) for **fast supersede**:

- `grace-spec` can clone prior C-* summary with `Supersedes` reference
- Plan generator diffs previous ObservedWriteScope/tasks
- Status reports “replan recommended” with reason codes (`ux-discovery`, `api-mismatch`, `perf-regression`)

Keep immutability; reduce thrash cost.

#### 1.5 New subagent roles (setup-subagents)

Add role files:

- `ui-implementer.md` — design tokens, states, a11y, no layout hacks
- `a11y-reviewer.md` — WCAG checklist against code + tests
- `visual-qa.md` — Storybook/visual diff evidence
- (optional) `design-liaison.md` — maps Figma intent to acceptance criteria without inventing brand

#### 1.6 Deliverables

- Updated templates: `ux-guidelines.xml.template`, AGENTS.md.template
- Skill updates: spec, plan, execute, reviewer, setup-subagents, explainer reference `ux-driven-dev.md`
- Tests for new optional grammar if introduced
- Version bump discipline per repo rules

**Exit criteria:** A pure UI change can be planned with UX-specific acceptance + verification intent, and T0 hotfixes are documented without shame.

---

### Phase 2 — Polyglot first-class support (Rust & Go)

#### 2.1 Language adapter architecture

Extend `src/language-registry.ts` + `src/lint/adapters/`:

| Adapter | Analysis goals (v1) | Exactness |
| --- | --- | --- |
| **Go** | Package exports via `go/packages` or `go list` + AST; map `MAP_MODE=EXPORTS` to exported decls in package | High when module mode works |
| **Rust** | Public items via `rust-analyzer` or `cargo metadata` + syn-based public surface for target crate | High for non-macro-heavy crates; heuristic for heavy macros |

Follow existing fail-closed patterns:

- missing toolchain → `analysis.runtime-missing`
- adapter crash → `analysis.adapter-failed`
- never claim exact parity on heuristic paths

#### 2.2 Package/crate as first-class module unit

Problem: one `M-*` → one `Path` file is insufficient.

**Proposal:** extend graph module records (skill docs + projection parsing) to allow:

```xml
<M-API-AUTH>
  <Summary>Auth handlers and middleware</Summary>
  <Path>services/api/internal/auth</Path>
  <UnitKind>go-package</UnitKind>
  <PrimaryFile>services/api/internal/auth/handler.go</PrimaryFile>
  <fn-Login />
  <fn-Middleware />
</M-API-AUTH>

<M-RS-LEDGER>
  <Summary>Double-entry ledger core</Summary>
  <Path>crates/ledger</Path>
  <UnitKind>rust-crate</UnitKind>
  <PackageName>ledger</PackageName>
</M-RS-LEDGER>
```

Rules:

- Directory/package paths allowed when `UnitKind` set
- Health implementation-file discovery walks package unit
- MODULE_MAP may live in `PrimaryFile` or `lib.rs` / `doc.go` convention

#### 2.3 Multi-technology context

Evolve `GraceTechnology` to support multiple stacks:

```xml
<GraceTechnology graceVersion="4.0">
  <Stacks>
    <Stack-WEB>
      <Language>TypeScript</Language>
      <Runtime>Node 24</Runtime>
      <Framework>Next.js</Framework>
      <Root>apps/web</Root>
      <TestingStack>vitest,playwright,axe</TestingStack>
    </Stack-WEB>
    <Stack-API>
      <Language>Go</Language>
      <Runtime>Go 1.23</Runtime>
      <Framework>chi</Framework>
      <Root>services/api</Root>
      <TestingStack>go test,golangci-lint</TestingStack>
    </Stack-API>
    <Stack-CORE>
      <Language>Rust</Language>
      <Runtime>stable</Runtime>
      <Framework>tokio</Framework>
      <Root>crates</Root>
      <TestingStack>cargo test,clippy,nextest</TestingStack>
    </Stack-CORE>
  </Stacks>
  <OperationalConstraints>…</OperationalConstraints>
</GraceTechnology>
```

Preserve backward compatibility: single `Language`/`Runtime`/`Framework` remains valid for simple projects.

#### 2.4 Go/Rust semantic markup guides

New explainer references:

- `languages/go.md` — package contracts, table-driven tests as TraceAssertion, `//` markup placement relative to godoc
- `languages/rust.md` — crate visibility, `pub` surface vs private modules, feature flags, where to put MODULE_MAP (`lib.rs`), async/tracing guidance

#### 2.5 Concurrency and systems annotations (lightweight)

Optional graph/module fields (warnings, not hard errors initially):

```xml
<M-RS-LEDGER>
  …
  <Invariants>
    <Invariant>Account balances never negative under concurrent transfer</Invariant>
  </Invariants>
  <ConcurrencyModel>actor-like services; no shared mutable accounts without lock ordering</ConcurrencyModel>
</M-RS-LEDGER>
```

Plan skill: if invariants present, verification must mention property/integration/loom/stress command.

#### 2.6 Deliverables

- Go adapter + tests
- Rust adapter + tests (start with cargo metadata + rustc-level public items; expand)
- Grammar/projection support for unit kinds
- Multi-stack technology parsing + lint
- Skill/docs updates; fixtures in `src/grace4/test-fixtures` style

**Exit criteria:** `grace lint` on a sample Go package and Rust crate fails closed on MODULE_MAP drift for public surface; multi-stack technology validates.

---

### Phase 3 — Systems verification & product-quality evidence

#### 3.1 Extended assertion / verification vocabulary

Add verification child kinds (and optionally plan assertions):

| Kind | Purpose | Example |
| --- | --- | --- |
| `VisualCheck` | Storybook/Chromatic/Playwright screenshot | `pnpm chromatic --only-story=…` |
| `A11yCheck` | axe/pa11y/lighthouse a11y | `pnpm test:a11y` |
| `ContractTest` | Pact/OpenAPI/buf breaking | `buf breaking`, `spectral lint` |
| `PerfBudget` | budgets / benchmarks | `go test -bench`, `cargo bench`, Lighthouse CI |
| `FuzzCheck` | Go fuzz / cargo fuzz | time-bounded |
| `SpanAssertion` | OTel/tracing field presence | alternative to string Marker |
| `MatrixCommand` | feature/OS matrix | rust features, go tags |

**Compatibility:** keep `Command` as generic escape; specialized tags improve health scoring and skill prompts.

#### 3.2 Boundary modules and API freeze

Introduce recommended module types / patterns:

- `API_CONTRACT` — OpenAPI/proto source of truth
- `FFI_BOUNDARY` — Rust cdylib / Go cgo / WASM
- `UI_ROUTE` — page-level composition

Change flow for UI+backend features:

1. Spec requires **contract freeze** acceptance criterion when both sides change.
2. Plan tasks: `T-001` contract update → `T-002` backend → `T-003` UI client → `T-004` e2e.
3. Target assertions: `MustPassCommand` contract tests + e2e; `MustLink` UI client → API module.

#### 3.3 Wave-level and phase-level evidence as first-class plan sections

Today levels are described in verification-driven-dev prose. Elevate into `GraceChangePlan`:

```xml
<VerificationGates>
  <ModuleLevel>…</ModuleLevel>
  <WaveLevel>
    <Command>pnpm --filter web test:e2e auth</Command>
    <Command>go test ./internal/auth ./internal/session -count=1</Command>
  </WaveLevel>
  <PhaseLevel>
    <Command>docker compose -f deploy/compose.test.yml run smoke</Command>
  </PhaseLevel>
</VerificationGates>
```

`grace-execute` must not complete apply without wave/phase gates when declared.

#### 3.4 UX acceptance criteria quality lint (skill + optional CLI)

Heuristics for `grace-reviewer` / plan validation:

- UI-affected changes must include at least one of: component test, a11y check, visual check, e2e journey
- Ban acceptance criteria that only say “looks good” without evidence hook
- Require empty/loading/error state coverage for interactive components when STATES declared

#### 3.5 Observability beyond printf markers

Document and support:

- tracing span names as evidence (`SpanAssertion`)
- structured field schemas
- correlation IDs across UI → API → Rust core (`DF-*` + shared field names in context)

#### 3.6 Deliverables

- Grammar + projection + health updates for new evidence kinds
- Plan template + execute skill updates
- Explainer: `systems-verification.md`, `ux-verification.md`
- Example C-* plans for cross-stack feature

**Exit criteria:** A cross-stack auth feature change can declare contract + UI a11y + Go tests + Rust unit tests and have execute refuse apply if any declared gate fails.

---

### Phase 4 — Scale, DX, and proof

#### 4.1 Reference monorepo (public or private showcase)

Build/maintain `examples/polyglot-ux-system/` (or external repo):

- `apps/web` UI with design tokens + Playwright + axe
- `services/api` Go service with OpenAPI
- `crates/core` Rust domain crate
- full `.grace` graph/verification
- one archived happy-path change and one supersede example

This is the most important adoption asset for “not limited to TS services.”

#### 4.2 Markup tax reduction

- `MAP_MODE=SUMMARY` defaults for large UI barrels
- Optional generate-map helpers: `grace map suggest --path file` using adapters
- Allow package-level contracts without per-private-function contracts (already partly true; make skills emphatic for UI/Rust internals)

#### 4.3 Hierarchical graph without nested-anchor bugs

Keep “anchors direct children of GD wrapper” rule, but support **many GD documents** and index ownership at scale; provide generator for splitting `main.xml` when too large.

#### 4.4 Metrics for methodology success

Instrument (in project status or external):

- % modules healthy
- median time draft→applied
- supersede rate (high may mean poor discovery tier usage)
- verification flake rate
- unexplained drift events

#### 4.5 Agent skill progressive disclosure

Split explainer into core + domain packs loaded on demand (`grace-explainer` routes):

- core (contracts, graph, verification lifecycle)
- ui-pack
- go-pack
- rust-pack
- monorepo-pack

Reduces context bloat for simple projects while enabling complex ones.

---

## 9. Concrete recommendations prioritized for the stated goal

### P0 — Do now (unblocks UI + Rust/Go without waiting for adapters)

1. **Polyglot monorepo playbook** + example graph segmentation (Phase 0).
2. **Honest adapter limits** in CLI/skills so Go/Rust teams rely on package tests, not false MODULE_MAP safety.
3. **UX verification defaults** in `ux-guidelines` + plan checklists (even as prose standards).
4. **Tiered ceremony** skill guidance (T0–T3) so UI iteration does not abandon GRACE.
5. **Cross-stack plan pattern**: contract → backend → UI → e2e as task DAG template.

### P1 — Highest leverage product work

1. **Go + Rust language adapters** (Phase 2).
2. **Package/crate unit kinds** in graph.
3. **Structured UX context** + UI contract fields (Phase 1).
4. **New evidence kinds** for a11y/visual/contract (Phase 3).
5. **Subagent roles** for UI/a11y/visual QA.

### P2 — Moat builders

1. Showcase monorepo.
2. Span/OTel assertions.
3. Perf/fuzz matrix commands.
4. Auto map suggest / lower markup tax.
5. Status metrics for methodology health.

---

## 10. Suggested PR / workstream breakdown (for implementers)

These are plan slices aligned with this packaging repo’s own GRACE culture (each could be a real `C-*` later).

| ID | Workstream | Primary surfaces | Depends |
| --- | --- | --- | --- |
| W1 | Polyglot+UI playbook docs & examples | `skills/grace/grace-explainer/references/*`, `examples/` | — |
| W2 | Ceremony tiers in skills | `grace-spec`, `grace-plan`, `grace-execute`, AGENTS template | — |
| W3 | UX guidelines schema v1 | init templates, grammar optional fields, reviewer skill | W2 helpful |
| W4 | UI/a11y subagent roles | `grace-setup-subagents/references/roles/*` | W3 |
| W5 | Multi-stack `GraceTechnology` | `src/grace4/*`, init template, tests | — |
| W6 | Graph unit kinds (package/crate) | projections, health, skills | W5 helpful |
| W7 | Go adapter | `src/lint/adapters/go.ts`, registry, CI Go toolchain | W6 |
| W8 | Rust adapter | `src/lint/adapters/rust.ts`, registry, CI Rust toolchain | W6 |
| W9 | Verification evidence kinds | verification schema, health, skills | W1 |
| W10 | Plan VerificationGates | plan template, execute skill, lint | W9 |
| W11 | Showcase monorepo | `examples/` or sibling repo | W1, ideally W7–W9 |
| W12 | Map suggest CLI | `src/grace.ts`, adapters | W7/W8 |

**Validation rules for this repo (from Agents.md):**

- Skill changes in `skills/grace/*` must mirror `plugins/grace/skills/grace/*`
- Version sync across README, openpackage, marketplace, plugin manifests when releasing
- `bun run ./scripts/validate-marketplace.ts` after packaging changes
- CLI: `bun run validate:cli` and fixture-based `grace lint`

---

## 11. Example target architecture (guidance for users adopting GRACE on hard projects)

```
repo/
  apps/web/                 # UI (high UX)
  packages/ui/              # design system
  services/api/             # Go
  crates/                   # Rust workspace
  proto/ or openapi/        # boundary contracts
  .grace/
    context/
      requirements.xml
      technology.xml        # multi-stack
      ux-guidelines.xml     # structured
      principles.xml
      deployment.xml
    graph/
      index.xml
      ui.xml
      api.xml
      core.xml
      contracts.xml
    verification/
      index.xml
      ui.xml
      api.xml
      core.xml
      contracts.xml
    changes/active/C-…/
```

**Change example:** “Add passkey login”

| Task | Scope | Evidence |
| --- | --- | --- |
| T-001 | Update OpenAPI + `M-CONTRACT-AUTH` | spectral/buf + contract tests |
| T-002 | Go handlers `M-API-AUTH` | `go test`, integration |
| T-003 | Rust crypto helper if needed | `cargo test -p …`, clippy |
| T-004 | UI flows `M-UI-PASSKEY` | component tests, axe, Playwright |
| T-005 | Wave e2e | full journey + a11y on critical routes |

Parallel-safe: T-002 and T-003 after T-001; T-004 after T-001 (mock contract); T-005 after all.

---

## 12. Risks of the improvement plan itself

| Risk | Mitigation |
| --- | --- |
| Grammar sprawl / complexity explosion | Prefer skill conventions first; promote to grammar only when lint value is proven |
| Adapter false confidence on macros/codegen | Explicit heuristic confidence states; fail closed when toolchain missing |
| UI evidence flakiness (visual tests) | Quarantine flake policy; prefer a11y+interaction determinism first |
| Ceremony tiers become loopholes | Reviewer skill flags T0 misuse on architectural changes |
| Showcase monorepo bitrots | CI job that lints example with grace CLI |
| Dual skill trees drift | Existing marketplace validation; keep using it |

---

## 13. Comparative judgment (why GRACE is still worth extending)

Relative to common agent practices:

| Approach | Strength | Weakness |
| --- | --- | --- |
| Chat-only plan | Fast | No durable proof, no parallel safety |
| ADR + tickets | Human process | Agents ignore; not machine-checkable |
| Spec-driven codegen only | Good WHAT | Weak HOW control & drift |
| **GRACE 4** | Durable graph, scopes, assertions, verification architecture | UX depth & polyglot tooling lag |

GRACE already solved the hardest agentic problems (scope, evidence, immutability, navigation). Extending it for UI quality and Rust/Go systems is **incremental product work**, not a rewrite of the philosophy.

---

## 14. Final recommendations

### For methodology owners (this repo)

1. Treat **UI + polyglot systems** as a first-class product roadmap, not edge cases.
2. Ship **Phase 0 playbooks immediately** so advanced users do not invent conflicting conventions.
3. Prioritize **Go/Rust adapters + package units** for backend credibility.
4. Prioritize **structured UX + evidence kinds + ceremony tiers** for product UI credibility.
5. Prove with a **showcase monorepo**; methodology without living examples will remain TS-service biased in practice.
6. Keep the fail-closed core; grow vocabulary carefully.

### For teams wanting high UX + Rust/Go now

1. Adopt GRACE 4 lifecycle for all cross-stack features (T1–T3).
2. Use T0 only for true hotfixes with tight ObservedWriteScope.
3. Segment graph by stack; invest in DF-* boundary flows.
4. Put real gates in `MustPassCommand` (lint, tests, e2e, a11y)—do not wait for new assertion kinds.
5. Freeze API contracts before parallel UI/backend implementation.
6. Store design-system and a11y standards in `ux-guidelines.xml` even if free text at first.
7. Prefer TraceAssertion/property tests for pure Rust; do not force log markers.
8. Run `grace status --with modules` in CI; treat unexplained drift as a stop-ship signal.

### Overall scorecard (today → after plan)

| Dimension | Today | After Phases 1–3 |
| --- | --- | --- |
| Agentic process integrity | Excellent | Excellent |
| Backend modular services | Strong | Excellent |
| Complex Go/Rust systems | Medium | Strong–Excellent |
| High UI/UX product quality | Weak–Medium | Strong |
| Multi-language monorepos | Medium | Strong |
| Ceremony flexibility | Medium | Strong |
| Tooling honesty (polyglot) | Medium | Strong |

---

## 15. Appendix A — Artifact & skill map (quick reference)

| Skill | Role in agentic loop |
| --- | --- |
| `grace-init` | Bootstrap `.grace` + AGENTS |
| `grace-spec` | Normative change intent + approval |
| `grace-plan` | Assertions, scopes, tasks |
| `grace-execute` | Sequential / parallel-safe implementation |
| `grace-verification` | Maintain V-M-* evidence contracts |
| `grace-reviewer` | Integrity review |
| `grace-refresh` | Drift → new change |
| `grace-fix` / `grace-refactor` | Scoped repair / structure changes |
| `grace-status` / `grace-cli` | Health and gates |
| `grace-setup-subagents` | Worker/reviewer presets |
| `grace-ask` / `grace-explainer` | Navigation & methodology education |
| `grace-migrate` | GRACE 3 → 4 |

### Assertion kinds (current)

`MustExist` · `MustNotExist` · `MustOwn` · `MustLink` · `MustVerify` · `MustPassCommand` · `MustContain` · `MustNotContain`

### Adapter-backed languages (current)

TypeScript/JavaScript · Python · Dart  
**Recognized but not adapter-backed:** Go · Rust · others in `CODE_EXTENSIONS`

---

## 16. Appendix B — Evaluation method

Sources inspected for this review:

- `README.md`, `CHANGELOG.md`, `Agents.md`
- Canonical skills under `skills/grace/*` (init/spec/plan/execute/verification/reviewer/fix/refresh/refactor/setup-subagents/cli/ask/explainer/migrate)
- Explainer references: contract-driven, knowledge-graph, semantic-markup, unique-tag, verification-driven
- Init templates including `ux-guidelines.xml.template` and AGENTS template
- CLI core: `src/grace4/*` (types, grammar, assertions, scope, projections), `src/language-registry.ts`, `src/query/health.ts`, lint adapters presence
- Explicit absence of Go/Rust adapters and thin UX model used as primary gap evidence

This is a **methodology and packaging evaluation**, not a production runtime benchmark of agents on a live polyglot product. Phase 4’s showcase monorepo is the right place for empirical agent trials (task success rate, replan rate, defect escape rate).

---

## 17. Appendix C — One-page action plan (printout)

**If you only do five things:**

1. **Write the polyglot+UI playbook** and segment graphs by stack.  
2. **Add ceremony tiers** so UX iteration stays inside GRACE.  
3. **Structure UX guidelines** and require a11y/visual/e2e evidence for UI modules.  
4. **Build Go and Rust MODULE_MAP adapters** + package/crate unit kinds.  
5. **Elevate wave/phase gates and API contract freezes** for cross-stack changes.

**Success looks like:** an agent team ships a passkey login feature across React UI + Go API + Rust crypto helper with parallel workers, frozen OpenAPI, a11y-clean UI evidence, and `grace lint --assertions final` as the true release gate—without abandoning process for “just this UI polish.”

---

*End of document.*
