---
id: RM-POLYGLOT-ENFORCEMENT
kind: context
status: complete
created: 2026-07-28
updated: 2026-07-28
normative: false
plan: ./plan.md
---

> **Non-normative.** This document explains *why* `plan.md` exists and records the
> evidence and adjudications behind it. It is the roadmap-level analogue of a GRACE
> `design-context.xml`. Acceptance criteria and execution steps live in `plan.md`.

# GRACE 4 — Unified Review

**Subject:** `grace-marketplace` / `@osovv/grace-cli` **4.0.4**
**Brief:** Is GRACE 4 viable for projects with *high UI/UX requirements* and *very complex Rust & Go backends*?
**Date:** 2026-07-28
**Method:** Synthesis of four independent reviews (`sources/grace-review-1..4.md`), re-grounded against the source at HEAD. Every claim carried forward is tagged with its evidence level and the reviews that raised it.

---

## 0. How to read this document

Each finding carries three tags:

| Tag | Meaning |
|---|---|
| **[verified]** | Reproduced against the CLI (review 4 built fixtures and ran them; re-checked here against source) |
| **[source-grounded]** | Confirmed by reading the named file/line in this repo during synthesis |
| **[asserted]** | Raised by a reviewer as design judgement; not mechanically reproduced |

Source references were re-checked during synthesis. Where reviews disagreed, §5 records the resolution and the reasoning — those resolutions are binding inputs to the implementation plan.

---

## 1. Executive summary

GRACE 4 is a genuinely well-built agentic engineering methodology. Its core insight — that an agent's *context problem* is an *addressing problem*, and that unique XML tags (`<M-AUTH>` rather than `<Module id="M-AUTH">`) make architecture greppable and unambiguous — is correct and under-appreciated. The change-lifecycle machinery (immutable approved plans, phase-separated assertions, durable vs. observed scope, parallel-safety preflight, a five-state recovery table) is the most rigorous agent-governance model any of the four reviews had evaluated. It is also fast: **400 modules with full export-parity analysis lint in 0.14s** [verified].

All four reviews converged on the same verdict, in different words:

> **GRACE 4 is a TypeScript methodology with polyglot aspirations and no design vocabulary.**

The *skeleton* — lifecycle, graph, scopes, assertion phases — is language-agnostic and immediately useful. The *muscle* — the checks that make contracts load-bearing rather than decorative — is TypeScript-shaped and degrades on exactly the two axes in the brief.

Two findings dominate everything else, and both come from review 4's hands-on probing:

1. **Rust/Go governance fails *open*, silently.** A `.rs` or `.go` `MODULE_MAP` declaring a fabricated symbol passes `grace lint` with no error and no warning [verified]. Python and Dart fail *closed* (`analysis.runtime-missing`). Rust and Go emit nothing. A green lint on a polyglot repo is not evidence.
2. **Marker evidence detection false-*blocks* every idiomatic Rust/Go logger.** `tracing::warn!`, `slog.Info`, `log.Printf`, `zap`, `zerolog` all fail the emission regex [verified], so every Rust/Go module declaring a `<Marker>` is permanently `blocked` with a message telling you to emit a marker you already emit.

These point in opposite directions — one silently passes, one permanently fails — which together make GRACE's Rust/Go health signal **actively misleading in both directions**. A methodology whose health signal is routinely ignored is worse than no methodology.

On UI/UX the picture is simpler: a full-text search across `src/` and `skills/` for `design|token|breakpoint|storybook|screenshot|visual|a11y|accessib|wcag|axe|responsive|component-state` returns **zero conceptual hits** [verified]. The entire design surface is one free-text `ux-guidelines.xml`. Design intent enters as prose in the spec and exits as prose in the archive, having passed through no gate.

A third, language-independent hole matters more than its low profile suggests: **the plan is never checked against the spec that authorized it** [verified]. An agent can obtain approval for spec A and execute plan B with every gate green. This affects TypeScript projects too.

**The gaps are gaps in *reach*, not in *design*.** Nothing in the grammar forbids Rust, Go, or UI. Extending GRACE for these targets is aligned with its architecture, not a contradiction of it — and the highest-leverage fix (the marker regex) is roughly forty lines.

### Consolidated scorecard

Merged from reviews 1, 3, and 4 (review 2 did not score). Where reviews differed, the more conservative rating grounded in reproduction wins.

| Dimension | Today | After the plan |
|---|---|---|
| Conceptual model (unique-tag addressing) | ★★★★★ | ★★★★★ |
| Change-lifecycle rigor | ★★★★★ | ★★★★★ |
| TypeScript/JS enforcement | ★★★★☆ | ★★★★★ |
| **Rust/Go enforcement** | **★☆☆☆☆** | ★★★★☆ |
| **UI/UX modeling** | **★☆☆☆☆** | ★★★★☆ |
| Cross-service / API contracts | ★★☆☆☆ | ★★★★☆ |
| Spec→plan traceability | ★★☆☆☆ | ★★★★☆ |
| Multi-language monorepos | ★★☆☆☆ | ★★★★☆ |
| Ceremony flexibility | ★★★☆☆ | ★★★★☆ |
| Performance & scale | ★★★★★ | ★★★★★ |
| Skill instruction quality | ★★★★☆ | ★★★★★ |

---

## 2. What GRACE 4 actually is

Four cooperating layers. All four reviews described this consistently; this is the merged, source-grounded account.

### 2.1 Durable project state — `.grace/`

```
.grace/
  context/       requirements | technology | principles | deployment | ux-guidelines   (exactly 5, hardcoded)
  graph/         index.xml → GD-* documents containing M-* modules and DF-* data flows
  verification/  index.xml → VD-* documents containing V-M-* entries
  changes/
    active/C-*/  spec.xml (normative) | design-context.xml (explanatory) | plan.xml
    archive/C-*/ terminal-status bundles
```

The index/document split is a routing table: an agent greps `index.xml` to learn *which* document owns `M-AUTH`, then opens only that document. This is real context economy, and the CLI enforces that routing table and documents agree (`projection.graph.ownership-mismatch`, `.unlisted-anchor`, `.missing-anchor`) [source-grounded: `src/grace4/projections.ts`].

Context artifacts are a fixed list of five [source-grounded: `src/grace4/types.ts` `GRACE4_CONTEXT_ARTIFACTS`, `src/grace4/grammar.ts` `CONTEXT_ARTIFACTS`].

### 2.2 The unique-tag convention

Anchors are tag *names*, never attributes:

```xml
<M-CONFIG>
  <Summary>Application configuration</Summary>
  <Path>src/config/index.ts</Path>
  <M-DB />              <!-- edge: M-CONFIG → M-DB -->
</M-CONFIG>
```

Enforced by `validateSemanticAnchorDiscipline`, which rejects anchors hidden in attribute values. The rationale — `</Module>` creates closing-tag polysemy and forces backtracking, while `</M-CONFIG>` is a self-describing semantic accumulator — is sound and is the single best idea in GRACE. It also makes the whole architecture `grep -r "M-CONFIG"`-addressable across XML, code headers, log markers, and test assertions.

Anchor families today: `GD-`, `VD-`, `C-`, `M-`, `V-M-`, `DF-`, `T-NNN` [source-grounded: `ANCHOR_PATTERNS`, `ANCHOR_FAMILIES`].

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

`LINKS:` is load-bearing: it maps files → modules [source-grounded: `src/query/core.ts`]. Module health, implementation-file discovery, and marker evidence all key off it. Importantly, **a module may span many files** — each declares the same `LINKS:` — which already handles Rust crates and Go packages at the *modeling* level.

`ROLE` × `MAP_MODE` (`RUNTIME`+`EXPORTS`, `TEST`+`LOCALS`, `BARREL`+`SUMMARY`, `CONFIG`+`NONE`) avoids the classic "why is my config file failing export parity" failure mode [source-grounded: `src/lint/types.ts`, `src/project-utils.ts`].

### 2.4 The change lifecycle

```
grace-init → fill context → grace-spec (draft→approved) → grace-plan (approved, immutable)
  → lint --assertions current            (pre-write preflight over ALL active baselines)
  → lint --change C-ID --assertions baseline
  → grace-execute (sequential | parallel-safe)
  → lint --change C-ID --assertions target [--run-commands]
  → lint --change C-ID --assertions final → explicit apply → archive
```

| Mode | Meaning | When |
|---|---|---|
| `current` | evaluate all active approved baselines | pre-write preflight only |
| `baseline` | selected plan's pre-edit gate | immediately before edits |
| `target` | selected plan's post-edit evidence | after writes |
| `final` | outer apply/archive gate | before archiving |
| `parallel-preflight` | scope coexistence across active plans | parallel-safe mode |

Eight assertion kinds [source-grounded: `src/grace4/assertions.ts` `ASSERTION_SCHEMAS`]: `MustExist`, `MustNotExist`, `MustOwn`, `MustLink`, `MustVerify`, `MustPassCommand`, `MustContain`, `MustNotContain`.

Two scopes per plan: `DurableScope` (which `.grace` anchors may mutate) and `ObservedWriteScope` (which files may be touched). A scope with no writes must use explicit `<None />`; prose "none" is rejected.

### 2.5 Language tooling reality

| Capability | Status [source-grounded: `src/language-registry.ts`] |
|---|---|
| `CODE_EXTENSIONS` (discovery) | `.ts .tsx .js .jsx .mjs .cjs .mts .cts .py .pyi .go .java .kt .rs .rb .php .swift .scala .sql .sh .bash .zsh .clj .cljs .cljc .dart` |
| `ADAPTER_BACKED_EXTENSIONS` (enforcement) | `.js .jsx .ts .tsx .mjs .cjs .mts .cts .py .pyi .dart` |
| `LANGUAGE_ADAPTERS` | TypeScript (compiler-backed, exact), Python (subprocess `ast`, exact w/ `__all__`), Dart (subprocess) |

`CODE_EXTENSIONS` reads as a support matrix. It is a *file discovery* list. This distinction is the root of finding G-01.

---

## 3. Consolidated strengths

Merged and de-duplicated across all four reviews.

1. **The lifecycle is agent-hostile in the right ways.** Approved plans are immutable; if reality diverges the agent must supersede and replan, not quietly refresh assertions to match what it already did. The recovery decision table is the clearest expression:

   | state | required action |
   |---|---|
   | clean-to-start | run baseline, execute |
   | partial-observed-writes | inspect declared scope, ask resume/revert |
   | durable-state-changed | **hard stop**; supersede and replan |
   | target-already-satisfied | final validation + explicit apply confirmation |
   | unsafe-unknown-drift | **hard stop**; report unexplained files |

   Most agent methodologies have no concept of "the world moved under me." This one has five, each mapped to a distinct instruction.

2. **Parallel safety is real, not aspirational** [verified]. Two active approved plans writing the same file produce `scope.observed-write-overlap` under `--parallel-preflight`. Overlap uses proper glob *intersection* (BFS with memoization, globstar-aware), not string equality [source-grounded: `src/grace4/scope.ts`]. Durable overlap is a *warning* (planning smell); observed-write overlap is an *error* (correctness). That severity split is correct.

3. **Anti-gaming is designed in.** `--assertions current` nested inside a `TargetAssertions/MustPassCommand` is a hard error (`assertion.phase-incompatible-command`) — GRACE explicitly prevents an agent from nesting a lifecycle command inside plan evidence to fake a green run. Subtle, real, and well-reasoned.

4. **Path containment fails closed.** `resolveContainedProjectPath` rejects absolute paths, `..` escapes, and symlink escapes across assertions, `Cwd`, and `TestFiles`. Since `MustPassCommand` shells out, this matters — and it is handled.

5. **Verification is modeled as architecture, not late CI.** `V-M-*` entries carry `Cwd`, `TestFiles`, `Command`, `Scenario`, `Marker`, `TraceAssertion`. The "autonomy gate" framing — a module is not ready for unsupervised work until it has command evidence, named success *and failure* scenarios, and observable divergence markers — is right for long autonomous runs. The `Marker`/`TraceAssertion` split is thoughtful: markers demand proven runtime emission; trace assertions cover pure functions and type-level modules where logging would be silly.

6. **Test-file inference is smarter than expected** [verified]. With no `<TestFiles>` and only `<Command>bun test src/mod5.test.ts</Command>`, health correctly inferred the test file and blocked on its absence. Directory-form commands and monorepo `Cwd` prefix-stripping are both handled.

7. **Performance is excellent** [verified]. 400 modules / 400 governed TS files / 103 KB XML → `grace lint` **0.14s**, `grace status --with modules` **0.18s**, with full compiler-backed export parity. Fast enough for a pre-commit hook or an inner agent loop. No caching needed.

8. **Migration is unusually careful.** `grace-migrate` requires complete inventory, restorable backup, explicit write approval, passing lint, clean status, git worktree inspection with recorded `--porcelain`, exact cleanup paths, a *separate* cleanup approval, and an *additional* acknowledgement for dirty/non-git trees. Broad globs and recursive deletion are prohibited. Correct posture for an agent touching a user's files.

9. **Fail-closed as a house style.** Structured JSON error envelopes, drift distinction (explained vs. unexplained git changes), ambiguous-ownership rejection, missing-runtime errors. Production-minded engineering, not methodology prose.

10. **Grep-first navigation order** (graph index → graph doc → verification index → verification doc → changes → file markup) gives agents a deterministic path to understanding any project.

11. **One detail that shows the author's instincts.** `ux-guidelines.xml` marked `not-applicable` with reason "not a web app" is **rejected** (`context.ux-not-applicable-reason-insufficient`) — because UX applies to CLIs, APIs, docs, and agent interactions too. Someone thought about how agents evade obligations. §6 argues that instinct should be applied far more widely.

12. **The core artifacts are already language-agnostic.** XML context/graph/verification/change lifecycle require nothing from TypeScript; markup comment syntax adapts (`//`, `#`, `--`). Go and Rust projects can adopt the lifecycle *today* with `MustPassCommand` evidence. What is missing is enforcement depth, not conceptual fit.

---

## 4. Unified gap register

One row per distinct defect, de-duplicated across reviews. Ordered by severity for the stated brief. `Sources` names the reviews that raised it; a finding raised by one review is not weaker — review 4 was the only one that ran fixtures, so most **[verified]** rows are single-sourced.

| ID | Finding | Sev | Evidence | Sources | Primary surface |
|---|---|---|---|---|---|
| **G-01** | **Rust/Go governance fails open, silently.** `.rs`/`.go` are in `CODE_EXTENSIONS` but not `ADAPTER_BACKED_EXTENSIONS`; `analyzeGovernedFile` sets `language = null` and skips `validateMapParity` with **no diagnostic**. Fabricated `MODULE_MAP` symbols pass clean. | 🔴 Critical | [verified] A2/A3; [source-grounded] `src/project-utils.ts` adapter lookup | 1, 2, 3, 4 | `src/project-utils.ts`, `src/language-registry.ts` |
| **G-02** | **Marker emission regex is JS/TS-shaped.** `looksLikeEvidenceEmission` is `/(console\.|logger\.|tracer\.|trace\s*\(|emit\s*\(|\.(info\|warn\|error\|debug\|trace)\s*\()/` — lowercase-only, dot-call-only. 8 of 11 idiomatic Rust/Go emissions fail; the one Go pass is coincidence (variable named `logger`). Every Rust/Go module with a `<Marker>` is permanently `blocked`. | 🔴 Critical | [verified] A4–A7; [source-grounded] `src/project-utils.ts:134` | 4 | `src/project-utils.ts`, `src/query/health.ts` |
| **G-03** | **No Go language adapter.** No export-parity checking for `.go`; `MODULE_MAP` may drift undetected. | 🔴 Critical | [source-grounded] | 1, 2, 3, 4 | `src/lint/adapters/` |
| **G-04** | **No Rust language adapter.** Same for `.rs`, plus `pub`/`pub(crate)`/`pub use` visibility nuance. | 🔴 Critical | [source-grounded] | 1, 2, 3, 4 | `src/lint/adapters/` |
| **G-05** | **No spec→plan content traceability.** Lint checks spec/plan *identity* only. A plan rewritten to govern a different subsystem than its approved spec produces no issue. `AcceptanceCriteria` are never correlated with any assertion or task. Language-independent. | 🟠 High | [verified] A9 | 4 | `src/grace4/grammar.ts` (`validateChangeBundlesInDirectory`) |
| **G-06** | **No UI/UX vocabulary at all.** Zero conceptual hits for design/token/breakpoint/visual/a11y/wcag across `src/` and `skills/`. `ux-guidelines.xml` is validated only for one `Applicability`, a non-boilerplate reason when `not-applicable`, and one non-empty node. No design tokens, component states, interaction contracts, responsive contracts, visual or a11y evidence class. | 🟠 High | [verified] A13 | 1, 2, 3, 4 | grammar, projections, context artifacts |
| **G-07** | **No cross-service interface contracts.** The graph has `M-*` and `DF-*` only. A graph edge asserts adjacency and nothing else — not which schema governs it, which version, which fields, or whether Rust `serde` / Go struct / TS type agree. No `MustConform`-style assertion; `MustLink` only checks the graph, never code. | 🟠 High | [source-grounded] | 1, 2, 3, 4 | grammar, assertions, projections |
| **G-08** | **`DF-*` is an unordered participant set.** For a distributed flow (request → authn → validate → post → bus → projection → notify) the *sequence* — and which hops are transactional, retryable, idempotent — is the entire engineering content. GRACE records the participant list. | 🟠 High | [verified] fixture inspection | 4 (2 partially, via `DF-RPC`) | projections, grammar |
| **G-09** | **Documented module types are unimplemented.** `knowledge-graph.md` documents `ENTRY_POINT` / `UI_COMPONENT` / `CORE_LOGIC` / `DATA_LAYER`; grep of `src/` returns zero hits. `<Type>` is free text. | 🟡 Medium | [verified] A14 | 3, 4 | projections, health |
| **G-10** | **`DEPENDS:` validated for existence only.** `DEPENDS: M-DOES-NOT-EXIST, M-ALSO-FAKE` produces no issue — declared deps are never checked against the graph, nor reconciled with actual imports. The dangling-check machinery already exists (`validateDanglingGraphLinks`); it just is not applied to file headers. | 🟡 Medium | [verified] A8 | 4 | `src/project-utils.ts`, projections |
| **G-11** | **`LINKS:` accepts phantom anchors.** `LINKS: M-NONEXISTENT` is silently ignored. Conversely a graph `M-*` with a `Path` but no file linking to it is never flagged. | 🟡 Medium | [source-grounded] | 4 | `src/project-utils.ts`, `src/query/core.ts` |
| **G-12** | **Test-file health checks are inert for Rust/Go.** Inference is path-matching over command strings; `cargo test --lib` and `go test ./internal/router/...` name no file, so `health.verification-test-file-missing-on-disk` and `...command-does-not-reference-test-file` never fire. | 🟡 Medium | [verified] A12 | 4 | `src/verification/check-references.ts` |
| **G-13** | **Single-stack `GraceTechnology`.** `Language`/`Runtime`/`Framework`/`TestingStack` imply one stack. A React UI + Go API + Rust core repo cannot declare per-root stacks or per-package verification defaults. | 🟡 Medium | [source-grounded] | 3 (1, 2 implicitly) | grammar, init templates |
| **G-14** | **No cross-cutting invariants or ADR home.** "All ledger writes idempotent", "no blocking I/O in the async runtime", "every handler emits a correlation ID" have nowhere to live. `requirements.xml/Constraints` is a flat string list — no ID, no scope, no verification link, not referenceable by a plan. `design-context.xml` is per-change and archived with its bundle, so rationale scatters. Domain glossary and perf budgets likewise homeless. | 🟡 Medium | [source-grounded] | 3, 4 | context artifacts |
| **G-15** | **No performance / budget assertion kind.** Latency percentiles, throughput, memory, bundle size, frame time are prose in `Constraints` at best; `MustPassCommand` can run a benchmark but cannot assert a threshold. | 🟡 Medium | [asserted] | 1, 3 | assertions |
| **G-16** | **Segmentation is supported but unguided.** 400 modules in one `GD-MAIN` → `graph/main.xml` 36 KB, `verification/main.xml` 62 KB. The CLI is fast, but an agent reading `main.xml` burns ~10k tokens to answer one module question — inverting the context economy that motivates the index. Nothing says when to split; nothing reports size pressure. The index also grows unboundedly (~25 KB of routing table at 2,000 modules). | 🟡 Medium | [verified] B1–B3 | 3, 4 | status, refresh, explainer |
| **G-17** | **Ceremony is uniform regardless of risk.** Full spec→plan→multi-gate→execute→final→apply for a padding tweak or a hotfix. An escape hatch exists in prose ("small direct fix") but is underspecified — no risk tiers with differing required sections. | 🟡 Medium | [asserted] | 1, 2, 3 | skills |
| **G-18** | **No design-artifact linking.** No structured way to reference Figma files, design specs, or user research from a change bundle or module. | 🟢 Low | [asserted] | 1, 3 | grammar (spec) |
| **G-19** | **Instruction compression may exceed model reliability.** `grace-plan`'s `<must_do>` is a single 7-line paragraph encoding ~12 hard requirements. `grace-execute`'s table-formatted recovery rules are noticeably more followable — the format difference is doing real work and is not applied consistently. | 🟢 Low | [asserted] | 4 | `skills/grace/*/SKILL.md` |
| **G-20** | **No golden-path example.** `examples/` contains only `cli/`. Templates are near-empty skeletons (`<GD-MAIN></GD-MAIN>`). Every adopter reinvents conventions for module granularity, segmentation, and marker naming. Agents pattern-match from worked examples far better than from schemas. | 🟢 Low | [source-grounded] | 1, 3, 4 | `examples/` |
| **G-21** | **Documentation implies parity that does not exist.** Neither `README.md` nor `semantic-markup.md` states that Rust/Go `MODULE_MAP` parity is unchecked. Combined with G-01 this converts a missing feature into a misleading claim. | 🟠 High (docs) | [source-grounded] | 3, 4 | `README.md`, explainer references |
| **G-22** | **No mechanical repair path.** Most `markup.*` and `projection.*` issues are deterministically repairable (map drift once adapters are exact, index/document route desync), but the fix loop is entirely manual. No `grace lint --fix`, no `grace doctor` surfacing adapter coverage. | 🟢 Low | [asserted] | 4 | `src/grace.ts` |

---

## 5. Where the reviews disagreed — and the resolution

These resolutions are **binding inputs** to the implementation plan. Each is a real fork where following the wrong reviewer costs weeks.

### 5.1 How to implement the Rust/Go adapters

| Review | Proposal |
|---|---|
| 1 | Ship helper programs: a Go program using `go/parser`+`go/types`, a Rust binary using `syn`; invoke as subprocesses |
| 2 | `cargo check --message-format=json` + tree-sitter; `go vet` + `go/ast` |
| 4 | Pure-TS scanner first; prefer `go list -json` / `cargo metadata` *when available*, scanner as the always-present path |

**Resolution: review 4's approach, and this matters more than it looks.**

`@osovv/grace-cli` is a Bun/TypeScript package whose `files` list contains only `src/**/*.ts`. Shipping a compiled Go binary or a Rust `syn` helper would mean per-platform binaries in an npm tarball, a build toolchain in CI for four target triples, and a hard dependency on `go`/`cargo` being installed before GRACE can lint. That is a distribution and maintenance burden out of all proportion to the win, and it would make the adapters *less* available than the Python and Dart ones, which at least degrade to a clear `analysis.runtime-missing`.

A hand-written scanner in TypeScript has none of those costs and can be **exact** for Go (capitalization-based export rules over top-level declarations are mechanically simple once you tokenize correctly) and **exact-or-honestly-heuristic** for Rust (`pub` visibility is simple; `macro_rules!`, `include!`, and heavy proc-macro generation are not, and must downgrade to `heuristic` rather than lie).

The non-negotiable: the scanner must be a real lexer, not a line regex. Go raw strings (`` ` ``), Rust raw strings (`r#"…"#`), block comments, nested generics, and grouped declaration blocks all break naive matching. See plan Phase 2/3.

Toolchain-backed upgrade (`go list`, `cargo metadata`) is deferred, optional, and must never be *required* — otherwise G-01 is replaced by a new fail-closed wall for users who have Rust code but no Rust toolchain on the lint machine.

### 5.2 Package/crate as a first-class graph unit

- **Review 3:** one `M-*` → one `<Path>` file is insufficient; add `<UnitKind>go-package</UnitKind>` / `rust-crate` and allow directory paths.
- **Review 4:** a module already spans many files via `LINKS:`, and this "handles Rust crates and Go packages correctly at the modeling level."

**Both are partly right.** Review 4 is correct that *modeling* works: N files each declaring `LINKS: M-X` all belong to `M-X`, and health's implementation-file discovery keys off `LINKS:`, not `<Path>`. Review 3 is correct that *analysis* does not: export parity is computed per file, so a Go package whose exported surface is spread over five files cannot be checked against a single `MODULE_MAP`.

**Resolution: do not add `UnitKind` grammar in the adapter phases.** Solve it inside the adapters and in convention:

- The adapters analyze **per file** (matching the existing `LanguageAdapter` contract — no interface break).
- Convention, documented in the Go/Rust language references: put the `MODULE_MAP` in the package's designated primary file (`doc.go` for Go, `lib.rs`/`mod.rs` for Rust) with `MAP_MODE: SUMMARY`, and use `ROLE: RUNTIME` + `MAP_MODE: EXPORTS` on single-file modules only.
- Revisit `UnitKind` only if real usage proves the convention insufficient. Grammar sprawl is a stated risk (§5.6); prefer convention first.

### 5.3 Hierarchical vs. flat graph documents

- **Review 1:** allow `GD-*` documents to own other `GD-*` documents (nested).
- **Reviews 3, 4:** keep the "anchors are direct children of the GD wrapper" rule; support *many flat* GD documents, add size warnings and a split tool.

**Resolution: flat, many documents.** Nesting reintroduces exactly the ambiguity the unique-tag convention exists to remove, and the existing projection validator's ownership model (one owner per anchor, index routes to file) is clean precisely because it is flat. Add `graph.document-too-large`, a `grace graph split` helper, and a documented segmentation convention (by service, then by bounded context). This is G-16.

### 5.4 Fast-path / prototype / tiered ceremony

- **Review 1:** a `prototype` change status that skips assertions and scopes and allows direct edits without a plan.
- **Review 2:** `C-FAST-*` bundles that *bypass* `GraceChangeSpec` approval for scoped visual edits.
- **Review 3:** four risk tiers T0–T3 that change required *sections*, plus an explicit warning that tiers can become loopholes and a reviewer must flag T0 misuse.

**Resolution: review 3's model, with review 3's own warning enforced.** Review 2's bypass-approval design directly contradicts the fail-closed core that all four reviews rank as GRACE's best property; a "fast path" that skips human approval is not a ceremony tier, it is an ungoverned edit. Review 1's `prototype` status has the same problem in weaker form.

Tiers may change **which sections a spec/plan must contain** and **how many gates are pre-declared**. Tiers may never change **whether the gates run**. `--assertions final` remains the release gate at every tier. This is deliberately deferred to a late phase (Phase 9) so it cannot be used to route around the earlier enforcement work.

### 5.5 Versioning and release framing

- **Review 2:** frame the whole body of work as "GRACE 5."
- **Review 4:** `4.1.0` (polyglot honesty), `4.2.0` (traceability + example), `5.0.0` (new anchor families and context artifacts).

**Resolution: review 4's staged releases.** The Phase 1–5 work is additive and backward compatible; calling it GRACE 5 would force a migration story for changes that need none. New anchor families (`AC-*`, `DT-*`, `BP-*`, `ST-*`, `IC-*`, `INV-*`) and new context artifacts *do* change what a complete project looks like, and that is what earns the major bump — together with a `grace-migrate` path.

Note: `GRACE4_VERSION = "4.0"` is the *artifact grammar* version and is validated on every root tag. Any change that adds required structure must either keep `graceVersion="4.0"` valid (additive, optional) or bump the grammar version and ship migration. Phases 1–5 are additive-only. Phases 6–7 introduce optional artifacts — still additive; the grammar version bumps only when something becomes *required*.

### 5.6 Severity of "prose is not lintable"

Reviews 1 and 2 propose large new XML vocabularies quickly (design tokens, UI component metadata, API contracts, RPC data flows) in early phases. Review 3 explicitly warns: *"Prefer skill conventions first; promote to grammar only when lint value is proven."* Review 4 sequences by leverage-per-unit-effort and puts ~200 lines of adapter code before any new vocabulary.

**Resolution: reviews 3 + 4.** Every new tag must arrive with the check that makes it load-bearing. A `<DesignSystem>` block that nothing validates reproduces the exact failure it is meant to fix — G-06 exists because `ux-guidelines.xml` is a tag with no teeth. **Rule for the implementation plan: no new grammar without a validator, a health rule, or an assertion that reads it.**

### 5.7 Effort estimates

Reviews 1 and 2 give calendar estimates (4–6 weeks for adapters, 6–8 for UI/UX). Review 4 gives S/M/L per item and estimates ~200–300 lines per adapter. Review 3 gives horizons in weeks with overlap.

**Resolution: drop calendar estimates.** They were produced without knowledge of the executor's throughput and disagree with each other by 3×. The implementation plan sizes work in *phases with explicit definitions of done and review gates*, which is what actually controls scope.

---

## 6. Fitness for the brief

### 6.1 Very complex Rust and Go backends — *methodology yes, tooling not yet*

| Capability | Rust/Go today |
|---|---|
| Module graph & ownership | ✅ works (language-agnostic XML) |
| Multi-file modules (crate/package) | ✅ works via `LINKS:` (see §5.2) |
| Change lifecycle, scopes, parallel safety | ✅ works (language-agnostic) |
| `MustPassCommand` running `cargo test` / `go test` | ✅ works |
| `MODULE_MAP` export parity | ❌ **silently unchecked** (G-01) |
| Marker / trace evidence | ❌ **false-blocks on idiomatic logging** (G-02) |
| Test-file existence checks | ❌ inert (G-12) |
| `DEPENDS` ↔ import reconciliation | ❌ unchecked (G-10) |
| Wire/schema contracts across services | ❌ no model (G-07) |
| Ordered async / distributed flows | ❌ unordered set (G-08) |
| Concurrency, lifetimes, error taxonomy | ❌ prose only |

Rust concepts with no representation: trait/impl relationships (a trait *is* a contract — arguably GRACE's most natural fit), `unsafe` boundaries, `Send`/`Sync` and lifetime constraints, feature-flag conditional compilation, workspace/crate hierarchy. Go: interface satisfaction (implicit, so *especially* worth documenting), goroutine/channel ownership, `context` propagation, package-vs-file granularity.

### 6.2 High UI/UX requirements — *GRACE governs the code beneath the UI, not the UI*

What already works: TSX export parity is exact and enforced; component modules fit `M-*` cleanly; Playwright/Vitest/axe runs fit `MustPassCommand`; `TraceAssertion` suits render-behavior evidence.

What is missing is the whole design layer. Concretely, for a real a11y change:

| Acceptance criterion | Best available encoding |
|---|---|
| "Arrow keys move focus; Home/End jump" | `MustPassCommand` running a test — good |
| "axe reports zero serious/critical violations" | `MustPassCommand` running axe — good |
| "Focus ring visible at 200% zoom against dense background" | ❌ prose only — unverifiable |

For the third the only structural option is `MustContain`, a raw substring grep. It works [verified], but grepping source text for design intent proves a string is present, not that a user can see a focus ring. And per G-05, the criterion it is meant to satisfy is never checked to have *any* assertion at all.

The single most common agent UI failure — shipping the happy path and skipping empty/loading/error/disabled/focus-visible — has no structural prevention today.

### 6.3 Failure modes if adopted as-is

1. Backend agents pass `cargo test` / `go test` while public crate/package maps drift invisibly.
2. Rust/Go teams following GRACE properly (declaring markers, emitting them) see permanent false blockers, and learn to ignore `grace module health`.
3. UI agents implement acceptance criteria as API behavior and skip visual/a11y quality entirely.
4. Integration bugs at language boundaries escape module-local verification.
5. UX polish loops fight plan immutability → process abandonment on the product surface, leaving GRACE as a backend-only tool and reintroducing methodology fragmentation.
6. The graph becomes TS-shaped even when the critical logic lives in Rust/Go packages.

### 6.4 What to do *today*, before any code lands

All four reviews agree on the interim posture, and it costs nothing:

1. Use `grace-spec` / `grace-plan` / `grace-execute` for change governance now — that layer is language-agnostic and genuinely good.
2. Put real Rust/Go/UI verification in `MustPassCommand`: `cargo test`, `clippy`, `go test`, `golangci-lint`, `bun test`, Playwright, axe. That path works today.
3. Treat `MODULE_MAP` in `.rs`/`.go` as documentation, not contract, and say so in your own `AGENTS.md`.
4. **Do not declare `<Marker>` on Rust/Go modules** until G-02 is fixed — use `<TraceAssertion>` instead, or you will get permanent false blockers.
5. Use `MustContain` / `MustNotContain` for design-token discipline as a stopgap.
6. Segment the graph by stack from day one (`graph/ui.xml`, `graph/api-go.xml`, `graph/core-rust.xml`) — retrofitting segmentation is more expensive than starting with it.
7. Freeze API contracts before parallel UI/backend implementation.
8. Run `grace status --with modules` in CI and treat unexplained drift as stop-ship.

---

## 7. Prioritized remediation order

Sequenced by leverage-per-unit-effort, merging review 4's sequencing with review 3's workstream dependencies.

| Rank | Work | Gaps closed | Why here |
|---|---|---|---|
| 1 | Language-aware marker emission registry | G-02 | ~40 lines; unblocks all Rust/Go marker verification; the highest-severity live bug |
| 2 | `analysis.no-adapter` diagnostic + coverage reporting + honest docs | G-01, G-21 | ~15 lines of logic; converts a silent failure into a visible, actionable one *before* the adapters exist |
| 3 | Go export adapter | G-03 | Real enforcement; mechanically the simpler of the two |
| 4 | Rust export adapter | G-04 | Real enforcement; visibility rules need more care |
| 5 | Language-aware test-file inference; `DEPENDS`/`LINKS` referential validation | G-10, G-11, G-12 | Restores health checks on the target languages; reuses existing dangling-link machinery |
| 6 | Spec→plan coverage (`AC-*` anchors, scope coverage) | G-05 | Closes the approval-integrity hole; benefits existing TS users; `AC-*` is the structural home Phase 6 builds on |
| 7 | Design-system layer: `design-system.xml`, `DT-*`/`BP-*`/`ST-*`, state coverage health, a11y/visual evidence classes, design assertions | G-06, G-09 | Makes design addressable and gateable; depends on `AC-*` from rank 6 |
| 8 | Systems modeling: `IC-*` + `MustConform`, ordered `DF-*` steps, `invariants.xml` + `MustUphold`, perf budgets | G-07, G-08, G-14, G-15 | Cross-service safety; the modeling gap that hurts most once enforcement is fixed |
| 9 | Scale & ergonomics: document-size warnings, `grace graph split`, `grace doctor`, multi-stack `GraceTechnology` | G-13, G-16, G-22 | Needed before large monorepo adoption, not before correctness |
| 10 | Adoption: golden-path polyglot example, ceremony tiers, skill restructuring, design-artifact links | G-17, G-18, G-19, G-20 | Highest-value *non-code* lever, but only credible once the enforcement it demonstrates actually exists |

**Suggested releases:** `4.1.0` = ranks 1–5 · `4.2.0` = ranks 6 + golden-path example · `5.0.0` = ranks 7–10 (new anchor families and context artifacts warrant a major bump plus a `grace-migrate` path).

---

## 8. Non-negotiable constraints on any change

Merged from review 3's explicit constraint list and review 4's design observations. These bound the implementation plan.

1. **Keep fail-closed integrity.** No new code path may degrade silently. If a check cannot run, it must say so with a code and a remediation.
2. **Keep approved-plan immutability.** Improve the *supersede* experience; never permit silent in-place edits to approved assertions, scopes, or tasks.
3. **Keep semantic anchors as tags, never attributes.** Every new family (`AC-*`, `DT-*`, `BP-*`, `ST-*`, `IC-*`, `INV-*`) follows the existing pattern and registers in `ANCHOR_PATTERNS`/`ANCHOR_FAMILIES`.
4. **Keep `MustPassCommand` as leaf evidence.** The CLI remains the outer lifecycle gate; plan evidence never nests lifecycle commands.
5. **Do not dual-validate GRACE 3.** Migration stays a one-way, agent-applied, explicitly gated operation.
6. **No new grammar without a validator.** Every new tag ships with the check that makes it load-bearing (§5.6).
7. **No new required external toolchain.** New analysis must work with the Bun runtime alone; toolchain-backed paths are optional upgrades, never prerequisites (§5.1).
8. **Additive before breaking.** Existing valid `.grace` trees must keep validating. Bump `GRACE4_VERSION` only when something becomes *required*, and ship migration with it.
9. **Canonical/packaged skill trees stay in sync.** `skills/grace/*` ↔ `plugins/grace/skills/grace/*`, verified by `scripts/validate-marketplace.ts`.
10. **Ceremony tiers may change required sections, never whether gates run** (§5.4).

---

## 9. Why GRACE is worth extending

| Approach | Strength | Weakness |
|---|---|---|
| Chat-only "plan then code" | Fast | No durable proof, no parallel safety |
| ADR + tickets | Human process | Agents ignore it; not machine-checkable |
| Spec-driven codegen | Good WHAT | Weak HOW control; drift |
| **GRACE 4** | Durable graph, scopes, assertions, verification-as-architecture | UX depth and polyglot enforcement lag |

GRACE already solved the hardest agentic problems — addressing, scope, evidence, immutability, recovery. The unique-tag convention, the immutability rule, the phase separation, the anti-gaming guard, and the "not a web app is not a sufficient reason" check all reflect careful thinking about how agents actually fail.

Extending it for UI quality and Rust/Go systems is **incremental product work, not a rewrite of the philosophy**. Rank 1 and rank 2 together are a few dozen lines standing between GRACE 4 and a materially broader and, more importantly, *honest* claim.

---

## Appendix A — Reproduction ledger

From review 4's fixtures, re-checked against source during synthesis. Fixture 1: polyglot (`services/ledger/src/lib.rs`, `services/gateway/internal/router/router.go`, `apps/web/src/components/LedgerTable.tsx`), full `.grace` tree, 3 modules + 1 data flow + 3 verification entries. Fixture 2: 400 modules, 400 governed TS files, single `GD-MAIN`/`VD-MAIN`.

| # | Test | Result | Gap |
|---|---|---|---|
| A1 | Baseline lint | 1 error — TSX `MODULE_MAP` missing `LedgerRow` (correct) | — |
| A2 | Rust `MODULE_MAP` replaced with fabricated symbol | **no new issue** | G-01 |
| A3 | Go `MODULE_MAP` replaced with fabricated symbol | **no new issue** | G-01 |
| A4 | `tracing::warn!` emitting the exact required marker | `health.required-log-marker-not-found` | G-02 |
| A5 | `slog.Info` emitting the exact required marker | `health.required-log-marker-not-found` | G-02 |
| A6 | Same line as `slog.info` (lowercase) | no blockers — confirms the regex is the cause | G-02 |
| A7 | 11-form emission probe via `hasRuntimeMarkerEvidence` | 3 pass / 8 fail | G-02 |
| A8 | `DEPENDS: M-DOES-NOT-EXIST, M-ALSO-FAKE` | **no new issue** | G-10 |
| A9 | Plan `DurableScope` rewritten to a different module than spec `AffectedAreas` | **no new issue** | G-05 |
| A10 | UI plan `MustContain aria-rowcount` before implementation | `assertion.MustContain` error (correct) | — |
| A11 | Second overlapping active plan + `--parallel-preflight` | `scope.observed-write-overlap` error (correct) | — |
| A12 | Rust/Go module health test-file fields | `Governed Test Files: none / Verification Test Files: none` | G-12 |
| A13 | Grep `src/` + `skills/` for UI/UX design concepts | zero conceptual hits | G-06 |
| A14 | Grep `src/` for `ENTRY_POINT`/`UI_COMPONENT`/`CORE_LOGIC`/`DATA_LAYER` | zero hits | G-09 |
| B1 | `grace lint` on 400 modules | 0 errors, **0.14s** | — |
| B2 | `grace status --with modules` | **0.18s**, all 400 records | — |
| B3 | Artifact sizes | graph 36 KB / verification 62 KB / index 5.3 KB | G-16 |
| B4 | Test-file inference from `bun test src/mod5.test.ts` | correctly inferred, correctly blocked | — |

### Emission probe detail (A7)

Required marker `[X][y][BLOCK_Z]`, exact string present in every line:

| Emission | Detected |
|---|---|
| `tracing::info!("[X][y][BLOCK_Z] hi")` — Rust standard | ❌ |
| `log::warn!("[X][y][BLOCK_Z] hi")` — Rust `log` | ❌ |
| `info!(target: "app", "[X][y][BLOCK_Z]")` — Rust structured | ❌ |
| `println!("[X][y][BLOCK_Z]")` | ❌ |
| `slog.Info("[X][y][BLOCK_Z]")` — Go stdlib | ❌ |
| `zap.L().Infow("[X][y][BLOCK_Z]")` — Go zap | ❌ |
| `log.Printf("[X][y][BLOCK_Z]")` — Go stdlib | ❌ |
| `log.Info().Msg("[X][y][BLOCK_Z]")` — Go zerolog | ❌ |
| `logger.Error("[X][y][BLOCK_Z]")` — Go | ✅ *(coincidence: matches `logger\.`)* |
| `logger.info("[X][y][BLOCK_Z]")` — TS | ✅ |
| `console.log("[X][y][BLOCK_Z]")` — TS | ✅ |

---

## Appendix B — Key source references

| Concern | Location |
|---|---|
| Adapter registry / extension lists | `src/language-registry.ts` |
| Parity skipped for non-adapter files | `src/project-utils.ts` (`analyzeGovernedFile`, adapter lookup) |
| Marker emission regex | `src/project-utils.ts` (`looksLikeEvidenceEmission`) |
| Marker evidence entry point | `src/project-utils.ts` (`hasRuntimeMarkerEvidence`) |
| Module health rules | `src/query/health.ts` (`buildModuleHealth`) |
| Assertion kinds and schemas | `src/grace4/assertions.ts` (`ASSERTION_SCHEMAS`) |
| Phase-incompatible command guard | `src/grace4/assertions.ts` (`validateAssertionPhase`) |
| Change-bundle validation | `src/grace4/grammar.ts` (`validateChangeBundlesInDirectory`) |
| Context artifact list | `src/grace4/grammar.ts` (`CONTEXT_ARTIFACTS`), `src/grace4/types.ts` (`GRACE4_CONTEXT_ARTIFACTS`) |
| Anchor families / patterns | `src/grace4/grammar.ts` (`ANCHOR_FAMILIES`), `src/grace4/types.ts` (`ANCHOR_PATTERNS`) |
| UX not-applicable guard | `src/grace4/grammar.ts` (`context.ux-not-applicable-reason-insufficient`) |
| Graph/verification projections | `src/grace4/projections.ts` (`buildGraphProjection`, `buildVerificationProjection`, `collectExactEvidence`) |
| Scope overlap / glob intersection | `src/grace4/scope.ts` |
| Test-file reference matching | `src/verification/check-references.ts` |
| Lint orchestration | `src/lint/core.ts` (`validateGovernedFiles`, `validateAssertions`) |
| Lint config | `src/lint/config.ts` (`SUPPORTED_KEYS`) |
| Lint issue guides | `src/lint/catalog.ts` (`EXACT_GUIDES`, `PREFIX_GUIDES`) |
| Adapter reference implementation | `src/lint/adapters/python.ts` |

---

## Appendix C — Source review attribution

| Review | Distinctive contribution |
|---|---|
| **1** | Broadest improvement catalogue; UI verification framework sketch; performance/benchmark assertions; project archetypes; risk tables |
| **2** | Sharpest framing of the polyglot blind spot; RPC/protobuf data-flow modeling (`DF-RPC`); design-token artifact; structured compiler-diagnostic parsing (`rustc --error-format=json`, `go test -json`) |
| **3** | Best strategic framing (progressive ceremony, evidence-kind vocabulary, multi-stack technology model); Phase 0 "adopt safely today" playbook; explicit "no false parity" honesty rule; risks-of-the-plan-itself table; showcase-monorepo argument |
| **4** | Only review with reproduction. Found G-02, G-05, G-10, G-11, G-12 — none of which appear in the others. Established that Rust/Go fails *open* rather than merely being unimplemented; precise source line references; leverage-ordered sequencing |

Review 4's fixture work is the reason this document's top two priorities are not the ones three of four reviews led with. Adapters are the obvious gap; the marker regex and the fail-open behaviour are the ones that make a green build a lie, and they are an order of magnitude cheaper to fix.

*End of unified review.*
