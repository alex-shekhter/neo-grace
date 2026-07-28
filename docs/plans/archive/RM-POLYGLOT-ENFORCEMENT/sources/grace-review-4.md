# GRACE 4 Evaluation — Agentic Development Methodology Review

**Reviewed version:** 4.0.4 (`@osovv/grace-cli`, `grace-marketplace`)
**Review date:** 2026-07-28
**Reviewer framing:** Senior AI engineering evaluation, with a specific brief: *is GRACE viable for projects with high UI/UX requirements and very complex Rust/Go backends?*
**Method:** Source read of all 15 skills, the `.grace` grammar/assertion/projection engines, and the lint CLI — plus hands-on execution against two purpose-built fixtures (a polyglot Rust + Go + React project, and a 400-module scale project). Every claim marked **[verified]** was reproduced against the CLI at HEAD.

---

## 1. Executive Summary

GRACE 4 is a genuinely well-built methodology. Its core insight — that an AI agent's *context problem* is an *addressing problem*, and that unique XML tags (`<M-AUTH>` rather than `<Module id="M-AUTH">`) make architecture greppable and unambiguous — is correct and under-appreciated. The change-lifecycle machinery (immutable approved plans, phase-separated assertions, durable vs. observed scope, parallel-safety preflight) is the most rigorous agent-governance model I have evaluated. It is fast: **400 modules with full export-parity analysis lint in 0.14s** [verified].

But GRACE 4 is, today, **a TypeScript methodology with multi-language aspirations**. The gap is not cosmetic and it is not documented:

> `.rs` and `.go` files are recognized as code and *governed*, but receive **zero** semantic verification. A Rust `MODULE_MAP` declaring a symbol that does not exist anywhere in the file passes `grace lint` with **no error and no warning** [verified]. The same file in TypeScript is an error.

This is the single most important finding. It is worse than a missing feature, because GRACE's value proposition is *enforced* contract fidelity, and the enforcement silently degrades to zero on exactly the languages in your brief. Python and Dart fail *closed* (`analysis.runtime-missing`); Rust and Go fail *open*, silently.

On the UI/UX side, the picture is different but also limiting. GRACE has no vocabulary for design — no tokens, no component states, no interaction contracts, no visual or accessibility evidence class. A UI change spec can *say* "focus ring visible at 200% zoom" in prose, but nothing links that criterion to any assertion, and GRACE never checks that spec acceptance criteria are covered by the plan at all [verified].

**Bottom line:** GRACE 4's *skeleton* — the lifecycle, the graph, the assertion phases — generalizes well and is worth adopting. Its *muscle* — the checks that make the contracts load-bearing — is TypeScript-shaped. Sections 6–7 lay out a phased plan to close that gap, sequenced so that the highest-leverage fix (~200 lines of adapter code) lands first.

**Overall assessment**

| Dimension | Rating | Note |
|---|---|---|
| Conceptual model | ★★★★★ | Unique-tag addressing is the standout idea |
| Change lifecycle rigor | ★★★★★ | Immutability, phase separation, recovery table are excellent |
| TypeScript/JS enforcement | ★★★★☆ | Compiler-backed, exact, fast |
| Rust/Go enforcement | ★☆☆☆☆ | Silently inert — the critical gap |
| UI/UX modeling | ★☆☆☆☆ | One free-text file; no design vocabulary |
| Cross-service/API contracts | ★★☆☆☆ | Module links exist; interface contracts do not |
| Spec→plan traceability | ★★☆☆☆ | Identity checked; content never checked |
| Performance & scale | ★★★★★ | 400 modules / 0.14s |
| Skill instruction quality | ★★★★☆ | Dense, disciplined, occasionally over-compressed |

---

## 2. What GRACE 4 Actually Is

Stripped of marketing, GRACE 4 is four cooperating layers.

### 2.1 Durable project state — `.grace/`

```
.grace/
  context/       requirements | technology | principles | deployment | ux-guidelines  (5, fixed)
  graph/         index.xml → GD-* documents containing M-* modules and DF-* data flows
  verification/  index.xml → VD-* documents containing V-M-* entries
  changes/
    active/C-*/  spec.xml (normative) | design-context.xml (explanatory) | plan.xml
    archive/C-*/ terminal-status bundles
```

The index/document split is a routing table: an agent greps `index.xml` to find *which* document owns `M-AUTH`, then opens only that document. This is real context economy, and the CLI enforces that the routing table and the documents agree (`projection.graph.ownership-mismatch`, `projection.graph.unlisted-anchor`, `projection.graph.missing-anchor`).

### 2.2 The unique-tag convention

Anchors are tag *names*, never attributes:

```xml
<M-CONFIG>
  <Summary>Application configuration</Summary>
  <Path>src/config/index.ts</Path>
  <M-DB />              <!-- edge: M-CONFIG → M-DB -->
</M-CONFIG>
```

Enforced by `validateSemanticAnchorDiscipline` (`src/grace4/grammar.ts:176`), which rejects anchors hidden inside attribute values. The stated rationale — that `</Module>` creates "closing-tag polysemy" and semantic soup for LLMs, while `</M-CONFIG>` is unambiguous — is sound. It also makes the entire architecture `grep -r "M-CONFIG"`-addressable across XML, code headers, log markers, and test assertions. This is the best idea in GRACE.

### 2.3 File-local semantic markup

```rust
// START_MODULE_CONTRACT
//   PURPOSE: ...   SCOPE: ...   DEPENDS: ...   LINKS: M-LEDGER-CORE, V-M-LEDGER-CORE
//   ROLE: RUNTIME  MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   post - validates and commits a posting
// END_MODULE_MAP
```

`LINKS:` is load-bearing: it is what maps files → modules (`src/query/core.ts:134`). Module health, implementation-file discovery, and marker evidence all key off it. Notably, a module can span *many* files — each declares the same `LINKS:` — which handles Rust crates and Go packages correctly at the modeling level.

`ROLE` × `MAP_MODE` is a nice touch: `RUNTIME`+`EXPORTS`, `TEST`+`LOCALS`, `BARREL`+`SUMMARY`, `CONFIG`+`NONE`. It avoids the classic "why is my config file failing the export-parity check" failure mode.

### 2.4 The change lifecycle

```
spec.xml (approved)  →  plan.xml (approved, immutable)  →  execute  →  archive
```

The assertion phase model is the most rigorous part of the system:

| Mode | Meaning | When |
|---|---|---|
| `current` | evaluate all active approved baselines | pre-write preflight only |
| `baseline` | selected plan's pre-edit gate | immediately before edits |
| `target` | selected plan's post-edit evidence | after writes |
| `final` | outer apply/archive gate | before archiving |

`--assertions current` inside a `TargetAssertions/MustPassCommand` is a hard error (`assertion.phase-incompatible-command`) — GRACE explicitly prevents an agent from nesting a lifecycle command inside plan evidence to fake a green run. That is a subtle, real anti-gaming measure and it is well-reasoned.

Eight machine-checkable assertion kinds (`src/grace4/assertions.ts:48`): `MustExist`, `MustNotExist`, `MustOwn`, `MustLink`, `MustVerify`, `MustPassCommand`, `MustContain`, `MustNotContain`.

Two scope declarations per plan: `DurableScope` (which `.grace` anchors the change may mutate) and `ObservedWriteScope` (which files it may touch). A scope with no writes must use an explicit `<None />` — prose "none" is rejected. Overlap between active plans is detected and, under `--parallel-preflight`, blocks parallel execution.

---

## 3. Strengths

### 3.1 The lifecycle is genuinely agent-hostile in the right ways

Approved plans are immutable. If reality diverges, the agent must supersede and replan — it cannot quietly refresh assertions to match what it already did. `grace-execute`'s recovery decision table is the clearest expression:

| state | required action |
|---|---|
| clean-to-start | run baseline, execute |
| partial-observed-writes | inspect declared scope, ask resume/revert |
| durable-state-changed | **hard stop**; supersede and replan |
| target-already-satisfied | final validation + explicit apply confirmation |
| unsafe-unknown-drift | **hard stop**; report unexplained files |

Most agent methodologies have no concept of "the world moved under me." This one has five, and each maps to a distinct instruction. This is the part I would steal first.

### 3.2 Parallel-safety is real, not aspirational **[verified]**

Two active approved plans both writing `apps/web/src/components/LedgerTable.tsx`:

```
- [error] scope.observed-write-overlap … C-LEDGER-TABLE-A11Y and C-LEDGER-PERF cannot run in
  parallel; overlapping writes: apps/web/src/components/LedgerTable.tsx.
```

Glob overlap uses proper pattern intersection (`src/grace4/scope.ts:533`), not string equality. Durable overlap is a *warning* (planning smell); observed-write overlap is an *error* under preflight (correctness). That severity split is correct.

### 3.3 Path containment fails closed

`resolveContainedProjectPath` (`src/grace4/paths.ts`) rejects absolute paths, `..` escapes, and symlink escapes across assertions, `Cwd`, and `TestFiles`. Since `MustPassCommand` shells out, this matters — and it is handled.

### 3.4 Verification is modeled as architecture

`V-M-*` entries carry `Cwd`, `TestFiles`, `Command`, `Scenario`, `Marker`, `TraceAssertion`. The "autonomy gate" concept — a module is not ready for unsupervised agent work until it has command evidence, named success *and failure* scenarios, and observable divergence markers — is the right framing for long autonomous runs.

The `Marker`/`TraceAssertion` split is thoughtful: markers require proven runtime emission; trace assertions cover pure functions and type-level modules where log emission would be silly. Only authored markers demand matching `BLOCK_*` evidence.

### 3.5 Test-file inference is smarter than expected **[verified]**

I declared no `<TestFiles>`, only `<Command>bun test src/mod5.test.ts</Command>`. Health correctly reported `Verification Test Files: src/mod5.test.ts` and blocked on it not existing. Directory-form commands (`bun test src/`) and monorepo `Cwd` prefix-stripping are both handled (`src/verification/check-references.ts`).

### 3.6 Performance is excellent **[verified]**

| Fixture | Result |
|---|---|
| 400 modules, 400 governed TS files, 103 KB of XML | `grace lint` **0.14s**, `grace status --with modules` **0.18s** |

Full TypeScript compiler-backed export parity on all 400 files, projection integrity, scope analysis, assertion extraction. No caching needed. Fast enough for a pre-commit hook or an inner agent loop.

### 3.7 Migration is unusually careful

`grace-migrate` requires: complete inventory, restorable backup, explicit write approval, passing lint, clean status, git worktree inspection with recorded `--porcelain`, exact cleanup paths, a *separate* cleanup approval, and an *additional* acknowledgement for dirty/non-git trees. Broad globs and recursive deletion are prohibited. Any failure stops without destructive retry. This is the correct posture for an agent touching a user's files.

### 3.8 One small detail that shows care

`ux-guidelines.xml` marked `not-applicable` with the reason "not a web app" is **rejected** (`context.ux-not-applicable-reason-insufficient`, `src/grace4/grammar.ts:914`) — because UX applies to CLIs, APIs, docs, and agent interactions too. Someone thought about how agents evade obligations. That instinct is exactly right, and Section 6 argues it should be applied much more widely.

---

## 4. Weaknesses

Ordered by impact on your stated use case. Each is reproducible; see Appendix A.

### 4.1 🔴 CRITICAL — Rust and Go governance is silently inert

`.rs` and `.go` are in `CODE_EXTENSIONS` but **not** in `ADAPTER_BACKED_EXTENSIONS` (`src/language-registry.ts:14,27`). In `analyzeGovernedFile` (`src/project-utils.ts:274`), a non-adapter-backed file gets `language = null`, and `validateMapParity` is simply skipped — with no diagnostic.

**Reproduction [verified].** Polyglot fixture, three governed files. I replaced the Rust `MODULE_MAP` with a single fabricated symbol and the Go `MODULE_MAP` with another:

```rust
// START_MODULE_MAP
//   TotallyFakeSymbol - does not exist anywhere in this file
// END_MODULE_MAP
```

```
Files checked: 3   Governed files: 3   Errors: 1   Warnings: 0
- [error] markup.module-map-mismatch …/LedgerTable.tsx:12 — MODULE_MAP EXPORTS mismatch.
```

Only the TypeScript file is caught. **The fabricated Rust and Go module maps produce no error and no warning.**

Why this is severe rather than merely incomplete:

1. **It is invisible.** Python/Dart without a runtime emit `analysis.runtime-missing` and fail closed — an explicit, actionable "GRACE cannot verify this." Rust/Go emit nothing. A team reading a green `grace lint` reasonably concludes contracts are verified. They are not.
2. **It inverts the value proposition.** GRACE's pitch is that markup is *load-bearing structure*, not comments. On Rust and Go it is comments.
3. **It compounds under agent drift.** The `MODULE_MAP` is precisely the artifact an agent will let rot while refactoring. TypeScript gets a compiler check; Rust and Go get an honor system — in the languages where your complexity lives.
4. **Nothing in the docs says so.** `README.md` and `semantic-markup.md` describe TS/Python/Dart adapter coverage; neither states that Rust/Go parity is unchecked. The `CODE_EXTENSIONS` list (which includes `.rs`, `.go`, `.java`, `.kt`, `.rb`, `.php`, `.swift`, `.scala`, `.clj`) reads as a support matrix. It is a *file discovery* list.

### 4.2 🔴 CRITICAL — Marker evidence detection is JS/TS-shaped

`looksLikeEvidenceEmission` (`src/project-utils.ts:134`):

```js
/(console\.|logger\.|tracer\.|trace\s*\(|emit\s*\(|\.(info|warn|error|debug|trace)\s*\()/
```

Lowercase-only, dot-call-only. Every idiomatic Rust and Go logging form fails.

**Probe results [verified]** — required marker `[X][y][BLOCK_Z]`, exact string present in every line:

| Emission | Detected |
|---|---|
| `tracing::info!("[X][y][BLOCK_Z] hi")` — Rust standard | ❌ FAIL |
| `log::warn!("[X][y][BLOCK_Z] hi")` — Rust `log` crate | ❌ FAIL |
| `info!(target: "app", "[X][y][BLOCK_Z]")` — Rust structured | ❌ FAIL |
| `println!("[X][y][BLOCK_Z]")` | ❌ FAIL |
| `slog.Info("[X][y][BLOCK_Z]")` — Go stdlib | ❌ FAIL |
| `zap.L().Infow("[X][y][BLOCK_Z]")` — Go zap | ❌ FAIL |
| `log.Printf("[X][y][BLOCK_Z]")` — Go stdlib | ❌ FAIL |
| `log.Info().Msg("[X][y][BLOCK_Z]")` — Go zerolog | ❌ FAIL |
| `logger.Error("[X][y][BLOCK_Z]")` — Go | ✅ pass *(coincidence: matches `logger\.`)* |
| `logger.info("[X][y][BLOCK_Z]")` — TS | ✅ pass |
| `console.log("[X][y][BLOCK_Z]")` — TS | ✅ pass |

The one Go pass is accidental — the variable happened to be named `logger`. Rename it to `l` or `slog` and it fails.

Consequence: **every Rust and Go module with a `<Marker>` is permanently `blocked`**, with a misleading blocker telling you to emit a marker you already emit:

```
health.required-log-marker-not-found: V-M-LEDGER-CORE requires marker
[LedgerCore][post][BLOCK_VALIDATE_BALANCE], but it was not found in linked runtime files.
```

The Rust source contains, on line 39:
```rust
tracing::warn!("[LedgerCore][post][BLOCK_VALIDATE_BALANCE] unbalanced posting");
```

This is a **false negative that cannot be worked around** except by abandoning `<Marker>` on Rust/Go — which means abandoning trace-level verification exactly where distributed-systems debugging needs it most. Note 4.1 and 4.2 point opposite ways: 4.1 is a false *negative on checking* (silently passes), 4.2 is a false *positive on failure* (permanently blocks). Together they make GRACE's Rust/Go signal actively misleading in both directions.

### 4.3 🟠 HIGH — No spec→plan content traceability

`grace lint` checks spec/plan **identity** (`change.spec-plan-id-mismatch`, `change.bundle-id-mismatch`) but never **content**.

**Reproduction [verified].** I rewrote an approved plan's `DurableScope` to target `M-LEDGER-CORE` / `V-M-LEDGER-CORE`, while its approved spec's `AffectedAreas` still declared `M-WEB-LEDGER-TABLE`. The plan now governs an entirely different subsystem than the spec that authorized it.

```
Errors: 1   Warnings: 0     ← only the pre-existing unrelated TSX issue
```

No `change.*` or `plan.*` issue. Missing checks:

- `AffectedAreas` (spec) vs. `DurableScope`/`ObservedWriteScope` (plan) — **unrelated is fine**
- `AcceptanceCriteria` (spec) → any `TargetAssertions` entry or `T-*` task — **never correlated**
- `VerificationIntent/ExpectedCommand` (spec) vs. plan `MustPassCommand`/task `Verification` — **never compared**

This matters because the spec is what the *human approved* and the plan is what the *agent executes*. GRACE's whole premise is that approval is meaningful. Today an agent can obtain approval for spec A and execute plan B, and every gate stays green. This is the most exploitable hole in the lifecycle, and unlike 4.1/4.2 it is language-independent — it affects TypeScript projects too.

### 4.4 🟠 HIGH — No UI/UX vocabulary

A full-text search across `src/` and `skills/` for `design|token|breakpoint|storybook|screenshot|visual|a11y|accessib|wcag|axe|responsive|component-state` returns **zero** conceptual hits [verified] — only incidental matches (`GraceChangeDesignContext`, `leftTokens` in the glob matcher).

The entire UI/UX surface is `ux-guidelines.xml`:

```xml
<GraceUXGuidelines graceVersion="4.0">
  <Applicability>applicable</Applicability>
  <Audience>Finance operators</Audience>
  <Guideline>WCAG 2.2 AA; keyboard-first; dense data tables legible at 200% zoom.</Guideline>
</GraceUXGuidelines>
```

Validated only for: exactly one `Applicability`, a non-boilerplate reason when `not-applicable`, and at least one node with non-empty text. There is no design-token model, no component-state enumeration (default/hover/focus/active/disabled/loading/empty/error), no responsive-breakpoint contract, no accessibility criteria class, and no evidence class for visual or a11y proof.

**What this means concretely.** For the a11y change I specified:

| Acceptance criterion | Best available encoding |
|---|---|
| "Arrow keys move focus; Home/End jump" | `MustPassCommand` running a test — good |
| "axe reports zero serious/critical violations" | `MustPassCommand` running axe — good |
| "Focus ring visible at 200% zoom against dense background" | ❌ prose only — unverifiable |

For the third, the only structural option is `MustContain` — a **raw substring grep**:

```xml
<MustContain>
  <File>apps/web/src/components/LedgerTable.tsx</File>
  <Text>aria-rowcount</Text>
</MustContain>
```

It works [verified — correctly failed before the attribute existed], but grepping source text for design intent is a brittle proxy. It proves a string is present, not that a user can see a focus ring. And per 4.3, the criterion it is supposed to satisfy is never checked to have *any* assertion at all.

Practical effect: on a high-UI/UX project, GRACE governs the **plumbing** (module boundaries, exports, test commands) and is silent on the **product** (interaction, hierarchy, state coverage, motion, accessibility). Design intent lives in prose that no gate reads.

### 4.5 🟠 HIGH — No cross-service interface contracts

Your architecture is Rust ↔ Go ↔ TypeScript. The wire contract — protobuf, OpenAPI, JSON Schema — is where cross-service bugs actually live. GRACE has no node type for it.

The graph offers `M-*` (module) and `DF-*` (data flow) only. You can write:

```xml
<M-GATEWAY-ROUTER>
  <Path>services/gateway/internal/router/router.go</Path>
  <M-LEDGER-CORE />          <!-- an edge, and that is all it says -->
</M-GATEWAY-ROUTER>
```

The edge asserts adjacency. It cannot express: which schema governs it, which version, which fields, whether the Rust `serde` struct and the Go struct and the TS type agree, or whether a breaking change on one side was propagated. There is no `MustConform`-style assertion, and `MustLink` only verifies that the graph edge exists in the graph — it never inspects code.

`DF-POSTING` is likewise an **unordered set**:

```xml
<DF-POSTING>
  <M-WEB-LEDGER-TABLE /><M-GATEWAY-ROUTER /><M-LEDGER-CORE />
</DF-POSTING>
```

For a distributed flow (request → authn → validate → post → event bus → projection → notify) the *sequence* — and which hops are transactional, retryable, or idempotent — is the whole engineering content. GRACE records the participant list. For a "very complex backend," this is the modeling gap that will hurt most after the enforcement gaps in 4.1/4.2.

### 4.6 🟡 MEDIUM — `DEPENDS:` is validated for existence only

`analyzeGovernedFile` (`src/project-utils.ts:250`) checks that `PURPOSE`, `SCOPE`, `DEPENDS`, `LINKS` are non-empty. Nothing more.

**Reproduction [verified].** Set the Go router's header to `DEPENDS: M-DOES-NOT-EXIST, M-ALSO-FAKE` (both nonexistent, and dropping the real `M-LEDGER-CORE`):

```
Errors: 1     ← unchanged; the unrelated TSX issue
```

No error. Two gaps:

- **Referential:** declared `M-*` deps are never checked against the graph. (Graph-internal `<M-X />` link tags *are* dangling-checked — `validateDanglingGraphLinks` — so the machinery exists; it just isn't applied to file headers.)
- **Semantic:** `DEPENDS` is never reconciled with actual imports. The subagent role file instructs "Keep imports aligned with `DEPENDS`" — an instruction with no verification behind it. Since GRACE already parses TS/Python/Dart, import-vs-`DEPENDS` reconciliation is achievable there today.

### 4.7 🟡 MEDIUM — Test-file health checks are inert for Rust/Go

Health infers test files from command strings by path matching. Language-native commands carry no file paths:

| Command | Inferred test files |
|---|---|
| `bun test src/mod5.test.ts` | `src/mod5.test.ts` ✅ |
| `cargo test --lib` | none |
| `go test ./internal/router/...` | none |

So `health.verification-test-file-missing-on-disk` and `health.verification-command-does-not-reference-test-file` never fire for Rust/Go [verified — both fixture backend modules reported `Governed Test Files: none / Verification Test Files: none`]. A third silent degradation on the same languages.

### 4.8 🟡 MEDIUM — Segmentation is supported but unguided

At 400 modules in one `GD-MAIN` [verified]: `graph/main.xml` 36 KB, `verification/main.xml` 62 KB, `graph/index.xml` 5.3 KB. The CLI is fast, but an *agent* reading `main.xml` burns ~10k tokens on the whole architecture to answer one module question — inverting the context economy that motivates the index.

GD-*/VD-* routing exists and works. But nothing says when to split, how to choose boundaries, or caps document size. `grace-refresh` and `grace-status` do not report document-size pressure. On a large polyglot monorepo, teams will discover this only after `main.xml` is unwieldy.

The index also grows unboundedly: it lists every anchor (`<M-MOD-000 /><M-MOD-001 />…`). At 2,000 modules the *routing table alone* is ~25 KB — read on every navigation.

### 4.9 🟡 MEDIUM — `.grace/context` is a fixed set of five

`CONTEXT_ARTIFACTS` (`src/grace4/grammar.ts:82`) is a hardcoded list. Missing, for your domain:

- **architecture decisions** — an ADR log; `design-context.xml` is per-change and archived with its bundle, so rationale is scattered across `changes/archive/`
- **cross-cutting invariants** — "all ledger writes idempotent," "no blocking I/O in the async runtime," "every handler emits a correlation ID." These are the constraints that matter most on complex backends and have no home.
- **domain glossary** — high-value for agent grounding; nowhere to put it
- **performance budgets** — "p99 < 50ms," "frame time < 16ms" — prose in `Constraints` at best

`requirements.xml/Constraints` is a flat `<Constraint>` string list — no ID, no scope, no verification link. An invariant cannot be referenced by a plan or asserted.

### 4.10 🟢 LOW — Instruction compression may exceed model reliability

`SKILL.md` files run 16–55 lines of dense normative prose. `grace-plan`'s `<must_do>` is a single 7-line paragraph encoding ~12 distinct hard requirements. This is admirably token-efficient, but requirements buried mid-paragraph are the ones that get dropped under context pressure. `grace-execute`'s table-formatted recovery rules are noticeably more followable than `grace-plan`'s prose block — the format difference is doing real work and should be applied consistently.

### 4.11 🟢 LOW — No golden-path example project

`examples/` contains only `cli/`. There is no reference `.grace` tree for a realistic multi-module project. Skills reference templates, but templates are near-empty skeletons (`<GD-MAIN></GD-MAIN>`). Agents work markedly better from a worked example than from a schema, and every adopter currently reinvents conventions for module granularity, segmentation, and marker naming.

---

## 5. Fitness For Your Brief

### 5.1 Very complex Rust and Go backends

**Verdict: methodology yes, tooling not yet.**

| Capability | Rust/Go today |
|---|---|
| Module graph & ownership | ✅ works (language-agnostic XML) |
| Multi-file modules (crate/package) | ✅ works via `LINKS:` |
| Change lifecycle, scopes, parallel safety | ✅ works (language-agnostic) |
| `MustPassCommand` running `cargo test` / `go test` | ✅ works |
| `MODULE_MAP` export parity | ❌ **silently unchecked** (4.1) |
| Marker/trace evidence | ❌ **false-blocks on idiomatic logging** (4.2) |
| Test-file existence checks | ❌ inert (4.7) |
| `DEPENDS` ↔ import reconciliation | ❌ unchecked (4.6) |
| Wire/schema contracts across services | ❌ no model (4.5) |
| Ordered async/distributed flows | ❌ `DF-*` is an unordered set (4.5) |
| Concurrency/lifetime/error-taxonomy modeling | ❌ absent |

The lifecycle layer is language-agnostic and immediately useful — you get governed change management, immutable plans, and parallel-safety on day one. The *verification* layer, which is what makes GRACE more than documentation, is largely inert. Worse, 4.2 means a Rust/Go team following GRACE properly (declaring markers, emitting them) sees permanent false blockers, which trains everyone to ignore `grace module health`. **A methodology whose health signal is routinely ignored is worse than no methodology.**

Rust-specific concepts with no representation: trait/impl relationships (a trait is a contract — arguably GRACE's most natural fit), `unsafe` boundaries, `Send`/`Sync` and lifetime constraints, feature-flag conditional compilation, workspace/crate hierarchy. Go-specific: interface satisfaction (implicit, so *especially* worth documenting), goroutine/channel ownership, `context` propagation, package-vs-module granularity.

### 5.2 High UI/UX requirements

**Verdict: GRACE governs the code beneath the UI, not the UI.**

What works: TypeScript/TSX export parity is exact and enforced; component modules fit `M-*` cleanly; Playwright/Vitest/axe runs fit `MustPassCommand`; `TraceAssertion` suits render-behavior evidence.

What is missing is the entire design layer (4.4). Specifically, on a high-UI/UX project you need to govern:

- **Design tokens** — is `#3B82F6` a token or a hardcoded hex? GRACE cannot tell. `MustNotContain` on hex literals is the only lever, and it is per-file.
- **Component state coverage** — an agent implementing a table will produce the happy path and skip empty/loading/error/disabled/focus-visible. There is no way to *require* those states, and this is the single most common UI regression under agent authorship.
- **Interaction contracts** — keyboard maps, focus order, escape/dismiss behavior, announcement text. Prose only.
- **Responsive contracts** — breakpoints and per-breakpoint layout intent. No model.
- **Visual evidence** — the `V-M-*` evidence classes are `Command`/`Scenario`/`Marker`/`TraceAssertion`. There is no screenshot, visual-diff, or a11y-report class, so visual proof cannot be recorded as durable verification state.
- **Accessibility as a first-class criterion** — WCAG level, target size, contrast ratio, reduced-motion. Free text in a single `<Guideline>`.

Combined with 4.3 (acceptance criteria are never checked to have *any* assertion), the practical outcome is: **UI/UX intent enters as prose in the spec and exits as prose in the archive, having passed through no gate.** An agent can satisfy every GRACE check while shipping an inaccessible, off-system, state-incomplete component.

### 5.3 Where GRACE is already strong

Backend TypeScript services, Node/Bun monorepos, agent-heavy repos needing parallel-safe change governance, and any team wanting auditable AI change history. In those settings 4.0.4 is production-usable today.

---

## 6. Improvement Plan

Four phases, sequenced by leverage-per-unit-effort. Phase 1 alone converts GRACE from "TypeScript methodology" to "polyglot methodology."

### Phase 1 — Make polyglot governance honest *(highest leverage; ~1–2 weeks)*

#### 1.1 Never fail open — add an explicit unverified-coverage diagnostic 🔴

The cheapest and most important fix. In `analyzeGovernedFile` (`src/project-utils.ts:274`), when a governed file's extension is in `CODE_EXTENSIONS` but not `ADAPTER_BACKED_EXTENSIONS`, emit:

```
[warning] analysis.no-adapter <file>:<line> —
  MODULE_MAP parity is not verified for .rs files. GRACE has no export adapter for this
  language; treat MODULE_MAP as unverified documentation. Suppress per-repo via
  .grace-lint.json { "unverifiedLanguages": [".rs", ".go"] }.
```

Ship this **before** the adapters. It costs ~15 lines and immediately makes the current limitation visible instead of invisible. Add the acknowledgement key to `src/lint/config.ts` so teams opt into silence deliberately.

Also add to `grace status` a coverage line:

```
Analysis Coverage
- Adapter-backed: 41 files (.ts, .tsx)
- Unverified:    118 files (.rs, .go)  ← MODULE_MAP parity not enforced
```

#### 1.2 Rust and Go export adapters 🔴

Implement `src/lint/adapters/rust.ts` and `src/lint/adapters/go.ts` against the existing `LanguageAdapter` interface (`src/lint/types.ts`), register in `src/language-registry.ts` (add `.rs`, `.go` to `ADAPTER_BACKED_EXTENSIONS` and push the factories into `LANGUAGE_ADAPTERS`).

**Go** — `exactConfidence`, no external runtime. Exported identifiers are capitalized top-level decls; a regex/lightweight-parse pass over `func`, `type`, `var`, `const`, and grouped `(...)` declaration blocks gets exact results. Map `type`/`interface`/`struct` → `typeExports`, `func`/`var`/`const` → `valueExports`. `usesTestFramework` ← `testing.T`/`testing.B` import. Prefer `go list -json -f` when the toolchain is on `PATH`, with the parse as fallback.

**Rust** — `pub`, `pub(crate)`, `pub(super)`, `pub use` re-exports, `#[macro_export]`. Treat `pub(crate)`/`pub(super)` as `localSymbols`, not `exports` — the module boundary is the crate. `pub use` maps to `directReExportCount`. `#[cfg(test)] mod tests` → `usesTestFramework`. Prefer `cargo metadata` / `rustdoc --output-format json` where available; otherwise a bracket-aware scan of top-level items, flagged `heuristic` when `macro_rules!` or `include!` generate items.

Both should follow the Python/Dart precedent: **fail closed** if an optional external toolchain is expected but missing (`analysis.runtime-missing`), never silently pass.

Estimated ~200–300 lines each plus tests. Highest ROI in this document.

#### 1.3 Language-aware marker evidence detection 🔴

Replace the single regex at `src/project-utils.ts:134` with a per-language emission-pattern registry:

```ts
export type EmissionPatterns = { patterns: RegExp[] };

const EMISSION_PATTERNS: Record<string, EmissionPatterns> = {
  ".rs": { patterns: [
    /\b(?:tracing|log|slog)::\s*(?:trace|debug|info|warn|error)!\s*\(/i,
    /\b(?:trace|debug|info|warn|error)!\s*\(/i,          // imported macros
    /\b(?:println|eprintln)!\s*\(/,
    /\.(?:event|record)\s*\(/,                            // tracing spans
  ]},
  ".go": { patterns: [
    /\b(?:slog|log|logger|zap|logrus)\.[A-Za-z]*\s*\(/,
    /\.(?:Info|Warn|Error|Debug|Trace|Print|Printf|Println)(?:f|w|Context)?\s*\(/,
    /\.Msg(?:f)?\s*\(/,                                   // zerolog
  ]},
  // existing JS/TS behavior becomes the default entry
};
```

Match on file extension, falling back to the union of all patterns (better a false positive than a permanent false block). This ~40-line change unblocks every Rust/Go module using `<Marker>`. **It is the single highest-severity bug in 4.0.4** and should ship with or before 1.1.

Add a regression fixture asserting all eleven emission forms from §4.2.

#### 1.4 Language-aware test-file inference

Extend `checkModuleCheckReferences` (`src/verification/check-references.ts`) with per-toolchain resolvers: `go test ./internal/router/...` → the package directory; `cargo test --lib -p ledger` → the crate's `src/`; `cargo test --test integration` → `tests/integration.rs`. Where the command genuinely names no path (`cargo test --lib`), fall back to the `<Cwd>` directory rather than inferring nothing.

#### 1.5 Documentation honesty

`README.md` and `skills/grace/grace-explainer/references/semantic-markup.md` should carry an explicit support matrix — and `CODE_EXTENSIONS` should be documented as *discovery*, not *support*:

| Language | Export parity | Marker evidence | Test inference |
|---|---|---|---|
| TS/JS | exact (compiler) | ✅ | ✅ |
| Python | exact w/ `__all__`, else heuristic | ✅ | ✅ |
| Dart | exact (runtime) | ✅ | ✅ |
| Rust / Go | *(Phase 1)* | *(Phase 1)* | *(Phase 1)* |
| Java, Kotlin, Ruby, PHP, Swift, Scala, Clojure | ❌ unverified | partial | ❌ |

### Phase 2 — Close the traceability holes *(~1 week; language-independent)*

#### 2.1 Spec→plan coverage validation 🟠

`validateChangeBundlesInDirectory` (`src/grace4/grammar.ts:495`) already parses both artifacts. Add:

- `change.scope-does-not-cover-spec` (**error**) — every `M-*`/`DF-*` in spec `AffectedAreas` must appear in plan `DurableScope/GraphAnchors` or be justified by an explicit `<OutOfPlanScope><M-X><Reason>…</Reason></M-X></OutOfPlanScope>`.
- `change.plan-scope-exceeds-spec` (**warning**) — plan touches anchors the spec never mentioned.
- `change.acceptance-criterion-unmapped` (**warning**, error under a strict profile) — introduce criterion IDs and require each to be referenced:

```xml
<AcceptanceCriteria>
  <AC-KEYBOARD-NAV>Arrow keys move focus; Home/End jump to first/last row.</AC-KEYBOARD-NAV>
</AcceptanceCriteria>
```
```xml
<T-001>
  <Title>Add roving tabindex</Title>
  <Satisfies><AC-KEYBOARD-NAV /></Satisfies>
  …
</T-001>
```

`AC-*` slots naturally into `ANCHOR_FAMILIES` (`grammar.ts:68`) and inherits the unique-tag discipline. This closes the "approved spec A, executed plan B" hole and gives UI/UX criteria a structural home, which Phase 3 builds on.

#### 2.2 `DEPENDS` referential and semantic validation 🟡

- **Referential** (all languages, cheap): every `M-*` in a `DEPENDS:` header must exist in the graph → `markup.unknown-dependency` (error). The dangling-check machinery already exists in `validateDanglingGraphLinks`.
- **Semantic** (adapter-backed languages): compare declared `DEPENDS` against actual imports resolved through graph `Path` entries → `markup.undeclared-dependency` / `markup.unused-dependency` (warnings). Requires an `imports: Set<string>` field on `LanguageAnalysis`.

#### 2.3 Bidirectional `LINKS` validation 🟡

Today `LINKS: M-NONEXISTENT` is silently ignored. Add `markup.unknown-link` (error) and, conversely, `graph.module-without-linked-files` (warning) when a graph `M-*` has a `Path` but no file declares `LINKS:` to it.

### Phase 3 — Give UI/UX a first-class model *(~2–3 weeks)*

#### 3.1 New context artifact: `design-system.xml` 🟠

Extend `CONTEXT_ARTIFACTS` (`grammar.ts:82`):

```xml
<GraceDesignSystem graceVersion="4.0">
  <Applicability>applicable</Applicability>
  <TokenSource>apps/web/src/tokens.css</TokenSource>
  <Tokens>
    <DT-COLOR-ACCENT><Value>var(--color-accent)</Value><Usage>Primary actions, focus rings</Usage></DT-COLOR-ACCENT>
    <DT-SPACE-DENSE><Value>var(--space-1)</Value><Usage>Data-table row padding</Usage></DT-SPACE-DENSE>
  </Tokens>
  <Breakpoints>
    <BP-COMPACT><MaxWidth>767px</MaxWidth><Intent>Single column; table collapses to cards.</Intent></BP-COMPACT>
    <BP-WIDE><MinWidth>1280px</MinWidth><Intent>Full table with pinned columns.</Intent></BP-WIDE>
  </Breakpoints>
  <Accessibility>
    <Standard>WCAG 2.2 AA</Standard>
    <ContrastMinimum>4.5</ContrastMinimum>
    <TargetSizeMinimum>24px</TargetSizeMinimum>
    <ReducedMotion>required</ReducedMotion>
  </Accessibility>
</GraceDesignSystem>
```

`DT-*` and `BP-*` become anchor families, so tokens are greppable and assertable exactly like modules — the same idea that makes `M-*` work, applied to design.

#### 3.2 UI component states in the graph 🟠

Let a `UI_COMPONENT`-typed `M-*` declare required states, and make health check them:

```xml
<M-WEB-LEDGER-TABLE>
  <Summary>Virtualized ledger table.</Summary>
  <Path>apps/web/src/components/LedgerTable.tsx</Path>
  <Type>UI_COMPONENT</Type>
  <States>
    <ST-DEFAULT /><ST-EMPTY /><ST-LOADING /><ST-ERROR /><ST-FOCUS-VISIBLE /><ST-DISABLED />
  </States>
  <Interaction>
    <Keyboard>ArrowUp/ArrowDown move row focus; Home/End jump; Enter opens detail.</Keyboard>
    <FocusOrder>header filters → table body → pagination</FocusOrder>
  </Interaction>
</M-WEB-LEDGER-TABLE>
```

Then `V-M-WEB-LEDGER-TABLE` must name a scenario per declared state, and `health.ui-state-unverified` blocks otherwise. This directly attacks the most common agent UI failure — shipping the happy path only — using GRACE's existing health mechanism.

(Worth noting: `knowledge-graph.md` already documents a "Module Types" table including `UI_COMPONENT`, but no code references those values [verified]. `<Type>` is currently free text. This proposal gives the documented concept teeth.)

#### 3.3 New verification evidence classes 🟠

Extend `collectExactEvidence` (`src/grace4/projections.ts:416`) beyond `Command`/`Scenario`/`Marker`/`TraceAssertion`:

```xml
<V-M-WEB-LEDGER-TABLE>
  <Command>bun test apps/web/src/components/LedgerTable.test.tsx</Command>
  <Scenario>Arrow keys move the focused row.</Scenario>
  <AccessibilityCheck>
    <Tool>axe-core</Tool>
    <Command>bun run a11y:table</Command>
    <MaxSeverity>moderate</MaxSeverity>
  </AccessibilityCheck>
  <VisualCheck>
    <Tool>playwright</Tool>
    <Command>bun run visual:table</Command>
    <Baseline>tests/visual/__snapshots__/ledger-table</Baseline>
    <Viewports><BP-COMPACT /><BP-WIDE /></Viewports>
  </VisualCheck>
</V-M-WEB-LEDGER-TABLE>
```

These are commands under the hood — but naming them makes them *declarable, gateable, and reviewable*, and lets `grace status` report a11y and visual coverage as first-class health.

#### 3.4 New assertion kinds for design conformance 🟡

Add to `ASSERTION_SCHEMAS` (`src/grace4/assertions.ts:48`):

| Kind | Fields | Purpose |
|---|---|---|
| `MustUseToken` | `File`, `Token` | file references `DT-*`, not a raw literal |
| `MustNotUseLiteral` | `File`, `Pattern` | no raw hex/px where a token exists |
| `MustCoverStates` | `Module` | every declared `ST-*` has a scenario |
| `MustMatchPattern` | `File`, `Pattern` | regex generalization of `MustContain` |

`MustMatchPattern` alone is broadly useful — `MustContain`'s substring-only matching (§4.4) is limiting well beyond UI.

#### 3.5 A `grace-design` skill 🟡

Sibling to `grace-verification`: interview for design intent, populate `design-system.xml`, declare component states and interaction contracts, and wire a11y/visual checks into `V-M-*`. Without a skill, the new artifacts will not get filled in.

### Phase 4 — Complex-backend modeling *(~2–3 weeks)*

#### 4.1 Interface contracts as first-class nodes 🟠

New anchor family `IC-*` for wire contracts:

```xml
<IC-LEDGER-POSTING-V1>
  <Summary>gRPC posting contract between gateway and ledger core.</Summary>
  <Schema>proto/ledger/v1/posting.proto</Schema>
  <Version>1.2.0</Version>
  <Provider><M-LEDGER-CORE /></Provider>
  <Consumer><M-GATEWAY-ROUTER /></Consumer>
  <Consumer><M-WEB-LEDGER-TABLE /></Consumer>
  <BreakingChangePolicy>additive-only</BreakingChangePolicy>
</IC-LEDGER-POSTING-V1>
```

Plus a `MustConform` assertion (`Contract`, `Module`, `Command`) delegating to `buf breaking`, `oasdiff`, or a codegen-drift check. This gives the Rust↔Go↔TS boundary — where your real bugs live — an anchor, an owner, a version, and a gate. Combined with §2.1's scope-coverage check, a change to `IC-*` can be *required* to name every consumer in its scope.

#### 4.2 Ordered, typed data flows 🟠

Upgrade `DF-*` from an unordered participant set to a sequence with hop semantics:

```xml
<DF-POSTING>
  <Summary>Posting flow from console to ledger.</Summary>
  <Step order="1"><M-WEB-LEDGER-TABLE /><Emits>PostingRequested</Emits></Step>
  <Step order="2"><M-GATEWAY-ROUTER /><Contract><IC-LEDGER-POSTING-V1 /></Contract><Property>authenticated</Property></Step>
  <Step order="3"><M-LEDGER-CORE /><Property>idempotent</Property><Property>transactional</Property></Step>
  <FailureMode><Scenario>Duplicate posting id is rejected without side effects.</Scenario></FailureMode>
</DF-POSTING>
```

This is the artifact a debugging agent most needs and cannot currently get. Keep the flat form valid for backward compatibility.

#### 4.3 Cross-cutting invariants 🟠

New context artifact `invariants.xml` with `INV-*` anchors:

```xml
<GraceInvariants graceVersion="4.0">
  <INV-IDEMPOTENT-WRITES>
    <Statement>Every ledger write is idempotent under posting id.</Statement>
    <AppliesTo><M-LEDGER-CORE /><M-GATEWAY-ROUTER /></AppliesTo>
    <Verification><V-M-LEDGER-CORE /></Verification>
  </INV-IDEMPOTENT-WRITES>
  <INV-CORRELATION-ID>
    <Statement>Every request-scoped log carries correlationId.</Statement>
    <AppliesTo><DF-POSTING /></AppliesTo>
  </INV-CORRELATION-ID>
</GraceInvariants>
```

Then `MustUphold` (`Invariant`, `Module`) makes invariants assertable in plans. Today, "all writes must be idempotent" is an untraceable `<Constraint>` string; this makes it a referenceable anchor with owners and proof.

#### 4.4 Rust/Go idiom support 🟡

Once adapters exist: recognize `impl Trait for Type` and Go interface satisfaction as graph-expressible relations (`<Implements><IC-* /></Implements>`); support `#[cfg(feature)]`-conditional export surfaces; add `ROLE: MACRO` / `ROLE: GENERATED` for generated code that should be governed but not parity-checked.

#### 4.5 Segmentation guidance and tooling 🟡

- Emit `graph.document-too-large` (warning) past a configurable threshold (default ~50 anchors or ~30 KB).
- Add `grace graph split --by <path-prefix|subtree>` to mechanically re-route anchors into new GD-* documents and rewrite the index.
- Document a segmentation convention in `grace-explainer` (by service, then by bounded context).
- Consider a compact index form (`<Owns><Prefix>M-LEDGER-*</Prefix></Owns>`) to bound index growth (§4.8).

### Phase 5 — Adoption quality *(ongoing)*

- **Golden-path example.** Ship `examples/polyglot/` — a realistic Rust + Go + React `.grace` tree with 8–12 modules, segmented documents, a worked change bundle in archive, and one active bundle mid-lifecycle. This is the highest-value non-code deliverable; agents pattern-match from examples far better than from schemas.
- **Structure the dense skills.** Convert `grace-plan`'s `<must_do>` and `grace-spec`'s `<strict_contract>` from prose paragraphs to tables/lists, matching `grace-execute`'s recovery table (§4.10).
- **`grace lint --fix`** for mechanical issues (`MODULE_MAP` drift once adapters are exact, index/document route desync). Most `markup.*` and `projection.*` issues are deterministically repairable, and the fix loop is currently manual.
- **`grace doctor`** — one command reporting analysis coverage, adapter availability, document-size pressure, and unverified-language counts. Makes the honest-limitations story discoverable rather than buried in a support matrix.

---

## 7. Sequencing and Effort

| Phase | Item | Sev | Effort | Impact |
|---|---|---|---|---|
| 1 | 1.3 Language-aware marker detection | 🔴 | S | Unblocks all Rust/Go marker verification |
| 1 | 1.1 `analysis.no-adapter` warning | 🔴 | S | Makes silent failure visible |
| 1 | 1.2 Rust + Go adapters | 🔴 | L | Real enforcement on target languages |
| 1 | 1.5 Support-matrix docs | 🔴 | S | Sets correct expectations |
| 1 | 1.4 Test-file inference | 🟡 | M | Restores health checks |
| 2 | 2.1 Spec→plan coverage | 🟠 | M | Closes the approval-integrity hole |
| 2 | 2.2 `DEPENDS` validation | 🟡 | M | Graph/code truth alignment |
| 2 | 2.3 `LINKS` validation | 🟡 | S | Catches phantom anchors |
| 3 | 3.1 `design-system.xml` | 🟠 | M | Design becomes addressable |
| 3 | 3.2 UI component states | 🟠 | M | Blocks happy-path-only UI |
| 3 | 3.3 A11y/visual evidence | 🟠 | M | UI proof becomes durable |
| 3 | 3.4–3.5 Design assertions + skill | 🟡 | M | Makes the above usable |
| 4 | 4.1 `IC-*` interface contracts | 🟠 | L | Cross-service safety |
| 4 | 4.2 Ordered data flows | 🟠 | M | Distributed-flow modeling |
| 4 | 4.3 `INV-*` invariants | 🟠 | M | Cross-cutting constraints |
| 4 | 4.4–4.5 Idioms + segmentation | 🟡 | M | Scale ergonomics |
| 5 | Golden-path example | 🟠 | M | Best non-code adoption lever |

**Suggested releases**

- **4.1.0** — Phase 1. Turns GRACE into a genuine polyglot methodology. Ship 1.3 and 1.1 first even if adapters lag; they are small and stop the misleading signal immediately.
- **4.2.0** — Phase 2 + the golden-path example. Closes lifecycle integrity gaps; benefits existing TypeScript users too.
- **5.0.0** — Phases 3 and 4. New anchor families (`DT-*`, `BP-*`, `ST-*`, `IC-*`, `INV-*`, `AC-*`) and new context artifacts are additive but change what a complete project looks like, warranting a major version and a `grace-migrate` path.

---

## 8. Recommendation

**Adopt GRACE 4 now for the lifecycle; do not rely on it for Rust/Go or UI/UX verification until Phase 1–3 land.**

Concretely, if you start today:

1. Use `grace-spec` / `grace-plan` / `grace-execute` for change governance. This layer is language-agnostic and genuinely good — immutable plans, phase-separated assertions, and parallel-safety preflight are worth the adoption cost on their own.
2. Put your real Rust/Go/UI verification in `MustPassCommand` — `cargo test`, `go test`, `bun test`, `axe`, Playwright. That path works today and is the honest way to make GRACE gates meaningful on your stack.
3. Treat `MODULE_MAP` in `.rs`/`.go` as documentation, not a contract, and say so in your own `AGENTS.md` until adapters ship.
4. **Do not declare `<Marker>` on Rust/Go modules yet** — you will get permanent false blockers (§4.2) that erode trust in `grace module health`. Use `<TraceAssertion>` instead until 1.3 lands.
5. Add your own `MustContain`/`MustNotContain` assertions for design-token discipline as a stopgap for the missing design layer.

The methodology's foundations are strong and its author's instincts are consistently good — the unique-tag convention, the immutability rule, the phase separation, the anti-gaming checks, and the "not a web app is not a sufficient reason" guard all reflect careful thinking about how agents actually fail. The gaps identified here are gaps in *reach*, not in *design*. Phase 1 in particular is a small amount of well-scoped code standing between GRACE 4 and a materially broader claim.

---

## Appendix A — Reproduction

All fixtures built under a scratch directory; CLI run from the repo at 4.0.4 via `bun run ./src/grace.ts`.

**Fixture 1 — polyglot** (`services/ledger/src/lib.rs`, `services/gateway/internal/router/router.go`, `apps/web/src/components/LedgerTable.tsx`), full `.grace` tree, 3 modules + 1 data flow + 3 verification entries.

| # | Test | Result |
|---|---|---|
| A1 | Baseline lint | 1 error — TSX `MODULE_MAP` missing `LedgerRow` (correct) |
| A2 | Replace Rust `MODULE_MAP` with fabricated symbol | **no new issue** (§4.1) |
| A3 | Replace Go `MODULE_MAP` with fabricated symbol | **no new issue** (§4.1) |
| A4 | `tracing::warn!` emitting the exact required marker | `health.required-log-marker-not-found` (§4.2) |
| A5 | `slog.Info` emitting the exact required marker | `health.required-log-marker-not-found` (§4.2) |
| A6 | Same line as `slog.info` (lowercase) | blockers: none — confirms regex is the cause |
| A7 | 11-form emission probe via `hasRuntimeMarkerEvidence` | 3 pass / 8 fail — table in §4.2 |
| A8 | `DEPENDS: M-DOES-NOT-EXIST, M-ALSO-FAKE` | **no new issue** (§4.6) |
| A9 | Plan `DurableScope` rewritten to a different module than spec `AffectedAreas` | **no new issue** (§4.3) |
| A10 | UI plan `MustContain aria-rowcount` before implementation | `assertion.MustContain` error (correct) |
| A11 | Second overlapping active plan + `--parallelPreflight` | `scope.observed-write-overlap` error (correct) |
| A12 | Rust/Go module health test-file fields | `Governed Test Files: none / Verification Test Files: none` (§4.7) |
| A13 | Grep `src/` + `skills/` for UI/UX design concepts | zero conceptual hits (§4.4) |
| A14 | Grep `src/` for `ENTRY_POINT`/`UI_COMPONENT`/`CORE_LOGIC`/`DATA_LAYER` | zero hits — documented module types are unimplemented (§3.2) |

**Fixture 2 — scale**: 400 modules, 400 governed TS files, single `GD-MAIN`/`VD-MAIN`.

| # | Test | Result |
|---|---|---|
| B1 | `grace lint` | 0 errors, 0 warnings, **0.14s** |
| B2 | `grace status --with modules` | **0.18s**, all 400 module-health records |
| B3 | Artifact sizes | graph 36 KB / verification 62 KB / index 5.3 KB (§4.8) |
| B4 | Test-file inference from `bun test src/mod5.test.ts` | correctly inferred and correctly blocked as missing (§3.5) |

**Key source references**

| Concern | Location |
|---|---|
| Adapter registry / extension lists | `src/language-registry.ts:14,27,38` |
| Parity skipped for non-adapter files | `src/project-utils.ts:274` |
| Marker emission regex | `src/project-utils.ts:134` |
| Module health rules | `src/query/health.ts:47` |
| Assertion kinds and schemas | `src/grace4/assertions.ts:48` |
| Phase-incompatible command guard | `src/grace4/assertions.ts` (`validateAssertionPhase`) |
| Change bundle validation | `src/grace4/grammar.ts:495` |
| Context artifact list | `src/grace4/grammar.ts:82` |
| UX not-applicable guard | `src/grace4/grammar.ts:914` |
| Graph/verification projections | `src/grace4/projections.ts:57,161` |
| Scope overlap / glob intersection | `src/grace4/scope.ts:533` |
| Test-file reference matching | `src/verification/check-references.ts` |
