---
id: RM-LANGUAGE-EXTENSIBILITY
kind: context
status: draft
supersededBy: null
created: 2026-07-28
updated: 2026-07-28
baseline: 5.0.0
targets: []
normative: false
plan: null
related: [RM-AGENT-RELIABILITY]
---

# Language extensibility: who can add a language, and what it costs

> **Status: exploration, not a commitment.** There is no `plan.md` and no phase has been
> approved. Nothing here is normative.
>
> Sibling document: [RM-AGENT-RELIABILITY](../RM-AGENT-RELIABILITY/review.md) covers the
> agent operating on GRACE artifacts. This one covers the tool's own extension model.
> They are deliberately separate: different evidence, different sequencing, different
> completion dates.

## 1. The measured starting point

All figures taken from the 5.0.0 tree.

```
CODE_EXTENSIONS            26 extensions governed
ADAPTER_BACKED             13 extensions with export verification
governed, no adapter       13   .java .kt .rb .php .swift .scala .sql .sh .bash .zsh .clj .cljs .cljc

adapter + scanner source   3,245 lines
…of which hand lexing      1,902 lines  (59%)

CLI package                0.47 MB unpacked
```

Three facts drive everything below.

**59% of the language code is hand-written lexing.** `src/lint/scanners/` plus the
lexer-heavy portions of the Go and Rust adapters. This is also where the defects were:
the Go grouped-declaration bug (defect 2) and the Rust raw-identifier bug (defect 3) were
both lexer bugs, both shipped with a green suite, both asserted `exact` confidence while
being wrong.

**The package is 0.47 MB.** Small. Any proposal that bundles multi-megabyte grammar
artifacts changes what this tool *is* by an order of magnitude.

**Support is a spectrum, not a boolean.** This was under-appreciated before measuring:

| Tier | State | Consequence |
|---|---|---|
| 0 | Extension unknown to GRACE | File invisible. No contracts, no health, no drift. |
| 1 | Governed, no adapter | Contracts, `LINKS:`, blocks, health, drift all work. `MODULE_MAP` parity unverified. |
| 2 | Adapter, `heuristic` confidence | Export comparison offered with stated uncertainty. |
| 3 | Adapter, `exact` confidence | Export comparison trusted. |

Java, Ruby, Kotlin, PHP, Swift and Scala teams have always been at Tier 1 and can adopt
GRACE fully apart from export verification. The hard wall was Tier 0 — C#, Elixir, Zig,
Haskell, Julia, R, Lua, Terraform, OCaml and everything else absent from a hardcoded
`Set`. **That wall was removed in 5.x by the `codeExtensions` config key**; the rest of
this document is about Tier 2 and 3.

## 2. The trap: "grammar" meaning a declarative pattern file

The obvious-looking design is a per-language JSON or XML file of regexes and rules that a
generic engine interprets. **Do not build this.**

Regex-over-source is the anti-pattern in §10.4 of RM-POLYGLOT-ENFORCEMENT, and it
produced defects 4, 9 and 11 in that plan alone. A declarative regex format would not
merely permit that mistake — it would make it the *only* thing a contributor can express,
and ship it as the officially blessed contribution shape.

The generalized rule, already recorded in the sibling plan's defect log:

> A guard written as a regex over structured text is a guard you do not have.

A contribution format that can only express regexes is a contribution format that can
only produce unreliable adapters.

## 3. The strong version: a real parser, uniformly invoked

"Grammar" meaning an actual parser points at tree-sitter: roughly 200 grammars already
exist, maintained by people who care about that language's raw strings, nested comments,
lifetimes and raw identifiers — precisely the constructs GRACE's hand-written lexers got
wrong.

Under that model, adding a language means writing **queries against a parse tree** rather
than a lexer, and the 1,902 lines of hand lexing go away along with their bug class.

**Constraint:** a tree-sitter WASM grammar is roughly 1–3 MB. Against a 0.47 MB package,
bundling five grammars is a 20–60× size increase. Grammars therefore cannot ship in the
tarball by default; they would need to be fetched on demand or enabled per language. That
is a real cost, not a blocker, but it decides the rollout shape and should be measured
before committing.

**Prior decision to respect:** `review.md` §5 of RM-POLYGLOT-ENFORCEMENT already ruled out
shelling out to `go list` / `cargo metadata` — GRACE must work without those toolchains
installed. Tree-sitter WASM honours that ruling. Delegating to native toolchains would
reverse it and should not be reopened casually.

**What tree-sitter does not solve.** A correct parse tree does not decide whether
`pub(crate)` is an export, or whether a method on an unexported Go type is part of the
public surface. Those were genuine judgment calls in Phases 2 and 3 and they remain
judgment calls. Expect the semantic-mapping defects to survive; only the lexing defects
disappear.

## 4. The durable idea: a language is a bundle

Independent of what parses, **make a language a self-contained bundle the framework
discovers and invokes**, rather than a set of edits scattered across the registry:

```
languages/elixir/
  language.json      id, extensions, confidence ceiling,
                     grammar reference, runtime requirements
  analyze.ts         or queries/*.scm once tree-sitter lands
  fixtures/
    exports.ex + exports.expected.json
    multiline-decls.ex          ← required scenario
    syntax-inside-strings.ex    ← required scenario
    near-miss-identifiers.ex    ← required scenario
    truncated.ex                ← required scenario
```

Four properties follow, and they are why this is worth doing before any parser decision.

**Extensions stop being hand-maintained.** `CODE_EXTENSIONS` and
`ADAPTER_BACKED_EXTENSIONS` become derived from the discovered bundles. (5.x already
derived the second from the adapters; the bundle model finishes the job for the first.)

**Fixtures become the admission test.** The framework runs every bundle's fixtures. A
bundle whose fixtures fail is **not registered** — it degrades to `analysis.no-adapter`,
which is the honest outcome. Nobody has to remember to check.

**The required-scenario list is derived from real defects, not invented.** Every bundle
must supply its own instance of: a construct that opens a body across multiple lines; an
identifier that near-misses a keyword; syntax appearing inside a string or comment; a
truncated file. Those are exactly what broke Go and Rust. A bundle missing a required
scenario cannot claim the confidence tier that scenario protects.

**Confidence becomes earned rather than declared.** This is the important one:

> A bundle may claim `exact` only if its fixtures prove it. Fixtures missing or failing →
> capped at `heuristic`, or refused.

That resolves the objection to runtime-loaded adapters. The concern was that a
user-supplied adapter could claim `exact` for everything and GRACE's central guarantee —
that it does not lie about what it verified — would be unenforceable. If the framework
verifies the adapter against its own fixtures before trusting it, a project can load a
local language bundle *and* the guarantee survives. Security of executing project-supplied
analysis code is a separate question and still needs an answer.

`ngrace doctor` then extends naturally to the analyzers themselves:

```
Languages
  - rust    bundled   14/14 scenarios   confidence: exact
  - elixir  project   11/14 scenarios   confidence: heuristic (3 scenarios missing)
```

## 5. Suggested sequencing

| Order | Work | Status |
|---|---|---|
| 0 | `codeExtensions` config key; derive `ADAPTER_BACKED_EXTENSIONS` from the adapters | **done in 5.x** — removed the Tier 0 wall |
| 1 | Language bundles: manifest with extensions, auto-discovery, fixtures as admission test, confidence earned from fixtures | analyzers stay hand-written TS; no package-size cost |
| 2 | Swap analyzer implementation to tree-sitter queries, per language, grammar fetched or opt-in | internal change behind the bundle interface |
| 3 | Authoring skill for contributors | needs a stable bundle format to author against |

Doing 1 before 2 means the tree-sitter decision stays optional and incremental. If the
size cost proves unacceptable, the conformance gate and the derived extension lists are
still won.

**This sequence should not block RM-AGENT-RELIABILITY §3.1 and §3.2.** Step 0 already
removed the adoption wall; steps 1–3 are quality improvements for a small population of
contributors, whereas context slices and scope-drift detection affect every user of every
supported language.

## 6. Open questions

1. Is executing project-supplied analysis code acceptable at all, even gated by fixtures?
   A bundle that passes conformance can still be malicious. Sandboxing WASM queries is
   tractable; sandboxing arbitrary TypeScript is not.
2. What is the real measured size of a tree-sitter WASM grammar for the languages GRACE
   would want first? The 1–3 MB figure is from memory and must be verified before it is
   used to make a decision.
3. Should `heuristic` confidence adapters be accepted upstream at all, or should the
   bundled set stay `exact`-only with `heuristic` reserved for project-local bundles?
4. Does the required-scenario list need to differ per language family? Whitespace-
   significant languages have failure modes that brace languages do not.
5. Does `MAP_MODE: LOCALS` need the same conformance treatment as `EXPORTS`, or is the
   export surface the only thing worth gating?
