---
id: RM-GOVERNED-PATH
kind: plan
status: draft
supersededBy: null
created: 2026-08-09
updated: 2026-08-09
baseline: 6.1.1
targets: [6.2.0, 6.3.0, 6.4.0]
context: ./README.md
---

# RM-GOVERNED-PATH — consolidated neo-grace improvement plan

> **Status: proposal, not approved.** Baseline: `ngrace` v6.1.1 (`f340a98`).
>
> **Provenance.** This document merges two independently produced consolidations of the same
> corpus — `consolidated-improvement-plan-kimi.md` (RM-GOVERNED-PATH) and
> `RM-ADOPTION-INTEGRITY-plan.md` — after a three-round adversarial review between their
> authors. Both passes read the same ten agent reviews, ten brownfield guides, and the
> mistakes log; both verified claims against the working tree rather than trusting the
> reviews. The disagreement set closed at zero contested items. Where the two passes
> disagreed, §12 records who conceded what and why, so the reasoning survives the merge.
>
> **Structure.** Written to `neo-grace/docs/plans/active/` convention. If adopted, §1–§4 and
> §12 become `review.md`; §5 onward becomes `plan.md`.
>
> **Epistemics.** Every claim carries **[verified]** (reproduced against `f340a98` during a
> merge pass, with the reproduction recorded) or **[reported]** (from the corpus, not
> reproduced — carried as investigation, never as a premise). No phase depends on a
> `[reported]` claim being true.

---

## 1. The thesis the evidence supports

Ten agents, across at least four codebases and eight model families, kept failing in the same
places. Read together the reviews are not fifty feature requests. They describe one
structural imbalance:

> The governed path through neo-grace has high friction and late feedback. The ungoverned
> path — freestyle edits, self-approved commits, "fill in the XML until status looks green" —
> has zero friction and instant reward. Every expensive failure in the corpus is an agent
> taking the second path, or paying compound interest for having taken it earlier.

The mistakes log quantifies it: **13 mistakes, 8 change bundles, 3 reconciliation bundles — to
govern one bootstrap.** Agent-10's own estimate is that with the right tooling that session
produces 2–3 mistakes and 2–3 bundles.

So the program is not "add features." It is:

**Make the governed path the path of least resistance — by pulling every check earlier in the
lifecycle, removing every mechanical step that exists only as folklore, and giving review
output a signal-to-noise ratio worth trusting.**

Every accepted item below is one of five moves:

1. **Shift-left.** Checks that fire at gate/archive time and force a supersede cycle move to
   authoring time.
2. **Reject, don't filter.** Authored input the grammar does not recognize becomes an error,
   never a silent discard.
3. **Kill folklore.** Every "remember these three manual steps after the gate permits"
   becomes one recorded operation.
4. **Fix the audit's universe.** Review compares the wrong sets; the cure is attribution,
   not suppression.
5. **Give brownfield adoption a first-class honest shape** — a ratify path instead of the
   current trap.

This plan also **rejects or defers** a significant minority of the corpus's suggestions
(§7, §8). Several proposed cures would damage load-bearing parts of the model — gate purity,
anchor grep-stability, the lint/health split — to treat symptoms with cheaper, better
remedies.

---

## 2. Evidence synthesis

Two layers. **E-themes** rank by how many of the ten reviews independently hit a symptom —
a reasonable severity proxy given different models, hosts, and projects. **Root causes**
reduce ~60 reported symptoms to seven causes. Both are kept because they answer different
questions: frequency says what hurts most, cause says what to build. Two 8/10 symptoms can
share one fix, and E7 (3/10) punches far above its count causally.

### 2.1 Themes by frequency

| # | Theme (deduplicated) | Reviews | Verdict | RC |
|---|---|---|---|---|
| E1 | **`ngrace review` audits the wrong universe** — flags the change's own bundle, CLI-generated ledger files, and pre-existing uncommitted drift; noise trains reviewers to record dishonest `pass` verdicts | 8/10 (ag1 F-2/F-6, ag2 §3.4, ag3 §3.5/3.9, ag6, ag7 §3.5, ag8, ag9 #8/#10, ag10 §4.1) | Real, structural | RC-2 |
| E2 | **Authoring knowledge is discoverable only via the polyglot example and TS source** — schema, LINKS syntax, DurableScope rules, MAP_MODE semantics, MustExist anchor shapes | 8/10 (ag1 meta/F-5, ag4, ag5, ag6 §1/2, ag7 §3.2/3.8, ag8 §1, ag9 §1, ag10) | Real, structural | RC-4 |
| E3 | **Verification-documented ≠ verification-executed** — `V-M-*` commands never run unless mirrored into plan `MustPassCommand`; Marker vs TraceAssertion trap; weak leaf commands yield `ready` | 7/10 (ag1 F-4, ag2 §3.7/3.9, ag3 §3.1, ag8, ag9 §2, ag10, mistakes #8) | Real, honesty-critical | RC-7 |
| E4 | **Brownfield bootstrap has no honest path** — init leaves a trap; retroactive C-* ban + freestyle land = dead end; ten parallel guides were written to paper over it | 7/10 (ag2, ag3, ag5, ag6, ag8, ag9, ag10) | Real, deepest problem | RC-6 |
| E5 | **Error messages say what, not how to fix** — `--explain` exists but nothing points at it; cryptic codes cost hours | 7/10 (ag1 F-5, ag4, ag6, ag7, ag8, ag9, ag10) | Real, cheapest high leverage | RC-4 |
| E6 | **Lifecycle completion is folklore** — gate permits but doesn't finish; cursor loose-events dead-end requires deleting `run/`; NaN allocation | 6/10 (ag1 F-3, ag3 §3.5, ag7 §3.6/3.7, ag8, ag9 #6, ag10) | Real | RC-3, RC-1 |
| E7 | **Approved-plan corrections force full supersede for one-line scope fixes** | 3/10 (ag6, ag7 §3.3, ag10) but strongly felt | Real; needs a narrow audited channel | RC-5 |
| E8 | **XML is verbose/hostile to author** — escaping, brittleness | 3/10 (ag4, ag5, ag6) | Symptom of E2, not a format problem | §8 R1 |
| E9 | **Ceremony too heavy for small changes** | 2/10 explicit (ag4, ag7); ag1 declared out of scope | Reject the bypass; cut mechanical cost instead | §8 R4 |
| E10 | **Process health conflated with model health; git commit outside the model** | 2/10 (ag2, ag9) | Partially real; cheap half accepted | §7 D1 |
| E11 | **No-adapter file types are silent traps** (CSS/HTML entry points, `.sh`) | 4/10 (ag2 §4.9, ag3 §3.8, ag6, ag9 #4/#5) | Real but bounded by `RM-LANGUAGE-EXTENSIBILITY` | P1.6 + defer |
| E12 | **Detached review degrades silently on hosts without subagents** | 3/10 (ag2, ag3 §3.6, ag9 #5/#8) | Half-fixed in 6.1.0 | §7 D2 |

### 2.2 Root causes

- **RC-1 — The parser filters what it should reject.** `LINKS: M-A M-B` links nothing;
  `--from T-001` writes `NaN`; text in `<Owns>` surfaces as an unrelated index error. Three
  instances of one rule violation. The product's thesis is that the agent cannot lie to the
  model; these paths invert it — the *model* silently discards what the agent authored, and
  lint stays green.
- **RC-2 — The scope audit measures the wrong universe.** Porcelain contains init scaffold,
  the change's own bundle, CLI-authored ledger files, other bundles, pre-existing dirt.
  Reported noise: 14/19 (ag1), ~18/20 (ag8), 45 flagged with 2 attributable (ag10), 58 (ag9).
  Compounded by a second, divergent glob matcher (§4.6).
- **RC-3 — The lifecycle's last mile is folklore.** Ten of ten guides transcribe the same
  post-gate recipe.
- **RC-4 — Rules are discovered after they are expensive.** A rule learned after plan
  approval costs a supersede cycle. This is what turns 2 changes into 8 bundles.
- **RC-5 — No correction path proportional to the defect.** Immutability is correct; a full
  supersede for one forgotten scope path is not.
- **RC-6 — Brownfield adoption has no honest first-class path.** The model assumes a
  project's history begins at `init`; in brownfield it does not, and the CLI reports that
  past as unattributable drift permanently.
- **RC-7 — Two systematic authoring mis-selections.** `Marker` vs `TraceAssertion` (polyglot
  teaches the rarer, harder one by example); and documented `V-M-*` commands that never
  execute because they were not mirrored into `MustPassCommand`.

### 2.3 The strongest evidence in the corpus is not any review

It is the existence of **ten near-identical brownfield guides.** Guides 2–10 each re-derive
the same doctrine — epoch allocation rules, `ObservedWriteScope` comprehensiveness, Marker
vs TraceAssertion, apply/archive choreography — because the product does not carry that
knowledge. When every adopter must rewrite a 500-line operations manual, the manual is a
missing feature. Collectively those guides are an already-written specification of what is
absent from `ngrace-init`, `ngrace-plan`, and `ngrace-execute`.

**This plan's success criterion:** the guides collapse to one short canonical in-repo
document, because the product absorbed the rest. The eleventh agent has no reason to write
guide-11.

---

## 3. Already fixed at HEAD — do not re-propose

Verified in the working tree. The reviews tested 6.1.1; several of these landed late in the
6.1.0 cycle and were missed.

| Item | Evidence |
|---|---|
| `MAP_MODE: NONE` for zero-export files (ag6 idea 3, ag8 §5) | **[verified]** `src/lint/types.ts:41` defines `"EXPORTS" \| "LOCALS" \| "SUMMARY" \| "NONE"`; `src/project-utils.ts:812` enforces it. The *discovery* problem remains; the feature gap does not |
| Near-miss marker warnings (part of ag9 §2) | **[verified]** `src/lint/catalog.ts:91` `markup.near-miss-marker`; `src/lint/core.ts:131` |
| Honest verdict vocabulary (`unable-to-determine` + `host-capability-missing`) | **[verified]** `src/gates/command.ts:171`, `src/gates/ledger.ts:68`, `src/gates/core.ts:303` |
| `review --base` and `--changed-files` (half of ag1 F-6, ag10 §4.1) | **[verified]** `src/review/command.ts:39–50`. What is missing is the *automatic bundle-stored base ref* — the plumbing exists and is unreachable in practice |
| `lint --remediate` | **[verified]** exists, default off; what is missing is discoverability |
| Archive-identity scope aliasing | **[verified]** `expandScopePathsForArchiveIdentity`, `src/review/core.ts:838` — active↔archive alias for the reviewed bundle's own id only |

---

## 4. Confirmed still broken at HEAD

Checked, not assumed.

1. **Multi-dependency syntax.** **[verified]** `src/artifact/grammar.ts:2005` takes the
   `DependsOn` text node as one token; `:2018` reports `change.task-invalid-dependency`
   asserting the value "must be a canonical T-NNN identifier" — misleading, since `T-001`
   *is* canonical and the comma is the problem.
2. **Silent token drop in `LINKS` / `DEPENDS`.** **[verified]** `splitList`
   (`src/project-utils.ts:684`) splits on `,` only; `parseGovernedFile` (`:503–509`) then
   `.filter()`s tokens against `ANCHOR_PATTERNS` and raises nothing for the rest. `LINKS:
   M-A M-B` yields zero linked modules, the module reports IMPL=0 and goes `blocked`, and
   lint is green.
3. **Non-numeric epoch bounds.** **[verified]** `src/grace-cursor.ts:2622` —
   `context.args.from ? Number(context.args.from) : undefined`, no validation.
   `--from T-001` writes `<Allocation from="NaN">`; `fold` then fails with "no Allocation
   found" and the corpus's recorded remedy is `rm -r run/` — deleting the audit trail to
   satisfy the audit gate.
4. **Fold dead-end.** **[verified]** `src/grace-cursor.ts` `foldEpoch` requires an `opened`
   event with an `Allocation`; no auto-open, no recovery path.
5. **Scope audit has no lifecycle exclusion.** **[verified]** `auditScopeOutsideWriteScope`
   (`src/review/core.ts:860`) compares the full changed-file set against OWS; only the
   archive-identity alias exists.
6. **Two divergent glob matchers.** **[verified]** The product contradicts itself on the
   same plan and file:

   ```
   scope   web/js/**/*.js        file   web/js/app.js
     src/artifact/scope.ts   observedWriteScopeContains   =>  true
     src/review/core.ts:889  matchSimpleGlob              =>  false
   ```

   Consumer trace:

   | Consumer | Matcher | Verdict on `web/js/app.js` |
   |---|---|---|
   | `grace-status.ts:527` drift detector | `observedWriteScopeContains` | explained by `C-X` |
   | `grace-cursor.ts:1039` parallel safety | `observedWriteScopeContains` | in scope |
   | `review/core.ts:872` scope audit | `matchSimpleGlob` | **outside ObservedWriteScope** |

   `ngrace status` calls the write explained; `ngrace review` calls the same write
   undeclared. `scope.ts`'s reading (zero-or-more segments) is what git, bash globstar, and
   minimatch all do. Cost agent-3 a full residual change bundle, diagnosed there as a
   grammar/DX tradeoff; the grammar was never involved.
7. **`lint --explain` never reads the review or gate catalogs.** **[verified]**
   `lint --explain review.scope-outside-write-scope` — the highest-volume finding code in
   the corpus — returns *"does not yet have a dedicated lint --explain entry. See the review
   catalog (src/review/catalog.ts)"*, while a complete entry with title, explanation and two
   remediation lines sits at `src/review/catalog.ts:128`. `src/lint/catalog.ts:25` already
   imports `isReviewIssueCode` from that file and never reads the guide objects. 76 exact
   guides exist; review and gate surfaces fall through to generic prefix text.
8. **No gate-stored base ref.** **[verified]** Gates never author state (§6.3); nothing
   records a base commit at approve time, so no audit default can use `--base`.
9. **`moduleHealthLoadError` surfaces the raw error.** **[verified]**
   `src/grace-status.ts:369` assigns `error.message`; `:468` prints `- unavailable: <msg>`
   with no remediation.
10. **Verdict write-then-read.** **[reported]** (ag7 §3.7). Not reproduced. The apply gate
    reads the ledger synchronously from disk (`src/gates/core.ts:271`), which makes a
    genuine race unlikely; the likelier defect is the message — `"no Verdicts section entry"`
    states neither where it looked nor what it found. Treated as a diagnostics item, not a
    concurrency fix, pending reproduction.

### 4.1 One review premise corrected

**F-4's blocker is a report, not a gate. [verified]** `health.required-log-marker-not-found`
is raised in `src/query/health.ts:110` into `blockers`, whose only effects are
`state = "blocked"` and `autonomyReady = false` (`:121`, `:139`). Consumers are
`grace-module.ts`, `grace-status.ts`, and `review/scorer.ts`. **No gate and no lint consumes
module health.** A comment-only governance change was therefore never blocked from landing;
health truthfully reported those modules as not yet autonomy-ready.

The corpus shows where the pressure actually came from: `gemini-flash-ngrace-prompt.md` sets
*"blockedModules == 0, every module autonomy-ready with zero deferred gaps"* as the standing
objective. The operator's prompt made health a gate. The tool never did.

This is load-bearing for §8 R2 and P4.4: it is why the answer to F-4 is a health *reporting*
refinement and not a suppression mechanism at project, bundle, or gate level.

---

## 5. The roadmap

Baseline `6.1.1`. Targets are provisional per `docs/plans/README.md` rule 7: **P0–P2 carry
step detail** because their evidence exists at HEAD; **P3–P4 are objectives, decisions, and
gates** — their steps are written when P0–P2 land and produce the measurements they assume.

### P0 — Reject, don't filter: the integrity cluster → target 6.2.0

**Objective.** Every unrecognized authored token becomes an error. No silent drops, no
`NaN`, no discarded intent.

This phase is framed as a **class fix, not three incident fixes**. RC-1's instances were
reported; the sweep finds the ones nobody hit yet.

1. **The `.filter()` sweep.** Inventory every `.filter()` applied to authored input across
   `src/artifact/` and `src/project-utils.ts`. Each site is classified in the change bundle
   as *paired-with-an-error-path* (justified) or *silent discard* (converted). The inventory
   is a required deliverable, not a byproduct — it is what makes this a class fix.
2. **`LINKS` / `DEPENDS` multi-value.** Accept `[,\s]+` as separator so `LINKS: M-A M-B`
   works; emit `markup.unparsed-link-token` (error) for any token matching no
   `ANCHOR_PATTERNS` family, naming the token and the accepted families. The silent
   "Linked Modules: none" is the defect, not the separator.
3. **`<DependsOn>` multi-value** (ag1 F-1). Split the text node on `[,\s]+` before per-token
   canonical-T validation; `<Task>` children remain the explicit form. Rewrite
   `change.task-invalid-dependency` to name both accepted shapes.
4. **Numeric epoch bounds.** Validate `--from` / `--to` before `Number()`. The message names
   the accepted form and states that task ids are not event ids — the corpus shows
   `--from T-001` is the intuitive first guess.
5. **`<Owns>` text-vs-tag diagnosis.** When a `GD-*` / `VD-*` `<Owns>` section contains text
   where self-closing tags belong, say so directly instead of routing to
   `projection.graph.unlisted-anchor`, whose remediation ("synchronize GD-*/VD-* index
   ownership") is technically correct and useless here. Cost ag8 twenty minutes.
6. **Cursor recovery.**
   - *Auto-open for single-controller runs* (ag1 F-3, with its own condition): `advance` /
     `attempt` / `fold` with loose events, no open epoch, and **no `--worker` ever recorded
     for this change** synthesizes a retroactive `opened` event spanning the loose ids. If
     any explicit `--worker` appears in the ledger, refuse and demand the explicit epoch —
     multi-worker range assertions must never be silently fabricated.
   - *`cursor recover --change C-ID`*: diagnose loose events, unterminated ranges,
     out-of-allocation events; `--fix extend-allocation` performs a recorded, ledger-visible
     repair. Deleting `run/` stops being the documented recovery.
7. **Verdict diagnostics** (§4.10). Reproduce first. If the race is real, flush before
   return; if not — the likely case — rewrite `gate.apply.no-verdict` to report where it
   looked, how many entries it found, and why the newest did not qualify.
8. **Calibration backfill** (ag3 §3.10). Doctor must not report archived epochs as pending
   `MustPassCommand` adjudication after a final `--run-commands` succeeded; re-derive
   adjudication from the ledger instead of snapshotting it.
9. **Mode-aware lint summary** (ag3 §3.7). When an active change has baseline assertions,
   default text output leads with one line — *"N baseline expectations (expected while C-* is
   in progress)"* — instead of presenting `MustNotExist` failures as generic breakage.

**Verification.** Each item lands with a regression test replaying the corpus transcript that
reported it (the reviews supply them verbatim: F-1's comma input, ag8's NaN sequence,
mistakes #7's fold sequence). A silently-dropped token must fail a test. Plus
`bun run validate:cli` and the dogfooding lint green.

### P1 — The authoring surface: diagnostics, then generators, then skills → target 6.3.0

**Objective.** An agent can author a valid artifact without having read the TypeScript source
or the polyglot example — and when it gets something wrong, learns the fix from the error.

Ordering matters and is deliberate: **wire what exists, measure the gap, then author the
delta.** The alternative — a blind catalog pass over 76 existing guides — does work already
done.

1. **Wire the review and gate catalogs into `lint --explain`** (§4.7). `src/lint/catalog.ts`
   already imports from `src/review/catalog.ts`; consult the guide objects rather than
   falling through to prefix text. Add a **coverage test asserting every emittable code
   resolves to a surface-specific guide**, so this cannot regress.
2. **Author only the delta the coverage test exposes.** Each remaining code gets a fix-shape
   explanation — not "must be canonical" but "use `<Task>` children or comma/space-separated
   T-NNN ids." Priority order is the codes the corpus actually hit (§4).
3. **Point at `--explain` in default output.** Text lint appends `(ngrace lint --explain
   <code>)` once per distinct code on errors. Suppressed in `--format json`.
4. **Schema reference, generated from the grammar.** Do **not** hand-write it — a
   hand-written schema doc becomes a second grammar that drifts. Generate
   `docs/schema-reference.md` from `src/artifact/grammar.ts` structure in a script, run in
   CI; extend `--explain` to shapes (`--explain graph-module`, `--explain module-contract`)
   backed by the same source, so there is exactly one truth. Must document zero-depth `**`
   explicitly (see P2.1).
5. **Generators.** `ngrace spec new C-SLUG` and `ngrace plan new C-SLUG` write
   **valid-by-construction** skeletons — every mandatory section, canonical empty markers
   (`<None />`) where a section may legitimately be empty. `ngrace scaffold --module M-X`
   emits the exact `MODULE_CONTRACT` / `MODULE_MAP` block for the module's declared Path
   with correct ROLE / MAP_MODE / LINKS. **Acceptance test: generated output passes lint
   when committed unmodified.** That is what kills the discovery problem.
6. **`ngrace lint --as <state>`.** Evaluate a draft artifact under the rules that will fire
   at approve / target / final. Generators cover write-time; `--as` covers evolution-time of
   hand-edited artifacts. Non-overlapping, both needed.

   **Purity bound (normative).** `--as` may evaluate only rules that are pure functions of
   the artifact — grammar, shape, class-of-lint. Gate-time checks entangled with ledger or
   verification runtime context cannot be previewed honestly, and an approximate `--as`
   would be its own lie: an authored claim of doneness outrunning its evidence, which is the
   failure the product exists to prevent. This is the permanent shape, not a v1 compromise.

   **Absence reporting (normative).** Silence must not read as "will pass." Output reports
   *"evaluated N rule classes; M classes not evaluable at this state (ledger-dependent,
   verification-runtime)"* using D5's typed-absence idiom — the tool's own coverage held to
   the rule it applies to everyone else.
7. **Adapter export view.** `ngrace file exports --module M-X` prints exactly what the
   adapter considers exports — **read-only**. The two-iteration `MODULE_MAP` dance dies
   here. Auto-rewrite is deliberately deferred (§7 D3).
8. **No-adapter preflight warning.** When a graph module's `<Path>` has no adapter, lint
   emits a **warning** naming the consequence (contracts and health work; `MODULE_MAP`
   parity unverified) instead of today's delayed IMPL=0 mystery. Not an error: tier-1
   governance is a legitimate state per `RM-LANGUAGE-EXTENSIBILITY`.
9. **Optional-context DurableScope consistency** (ag3 §3.4). Allow `design-system.xml` /
   `invariants.xml` via a dedicated `<OptionalContext>` bucket — preferred over widening
   `<ContextArtifact>`, which keeps required-vs-optional semantics distinct. Flag for
   grammar-impact review.
10. **Skill emphasis inversion** (ag1 meta). Skills stop restating formats; each names its
    canonical shape sources (schema reference, `--explain`, polyglot) and spends its words on
    workflow. Add the **approval lexicon** (ag2 §4.10): exact approving phrases, and named
    non-approvals — "looks good", "continue", and questions are **not** approvals. Add the
    evidence doctrine to `ngrace-verification`: **TraceAssertion + tests is the default;
    Marker is for runtime trajectory only.**
11. **Polyglot rebalanced and enforced.** `examples/polyglot` currently teaches `Marker` by
    example, which is the rarer and harder evidence type; copying it verbatim makes every
    `V-M-*` permanently `blocked` (ag9 §2, mistakes #8). Rebalance so `TraceAssertion` reads
    as the default. Keep the example linted in CI and add a check that skills' claimed shapes
    resolve against it.

**Verification.** Golden-file tests per generator (generate → lint → green); a review-replay
fixture running each corpus authoring failure against the new messages, asserting the fix
shape appears; a skills audit confirming no skill restates a format the schema reference owns.

### P2 — Review honesty: one glob language, one audit universe → target 6.3.0

Highest value relative to size (E1: 8/10). Review is the product's honesty surface; today it
cries wolf 14 times out of 19 and teaches every agent to verdict `pass` with a justification
paragraph. **The cure is attribution, not suppression.**

1. **Delete the duplicate glob matcher** (§4.6). Remove `matchSimpleGlob`; route the scope
   audit through `src/artifact/scope.ts`. One glob language, one implementation.

   **Direction constraint (normative).** The dedup runs **review → `scope.ts`**, never
   `scope.ts` → `matchSimpleGlob`. The reverse would be a genuine retroactive break:
   previously-explained drift becomes unexplained and preflight verdicts flip. In the
   permitted direction the change can only *widen* what review accepts, so it cannot make an
   approved plan permit less or create a new violation.

   **Release note.** An author who wrote `web/js/**/*.js` intending "subdirectories only"
   loses the one surface that ever flagged the mismatch — that intent was unenforced
   everywhere else, so the fix stands, but the CHANGELOG must say: *"review may report fewer
   findings for `**` patterns adjacent to top-level files; this is deduplication toward
   git/minimatch semantics."* The schema reference (P1.4) states zero-depth `**` explicitly.

   **Pinned test.** `web/js/**/*.js` × `web/js/app.js` asserted at both call sites. This is
   also the merged plan's first conformance test and the falsifier for §4.6's trace.
2. **Exclude CLI-authored lifecycle files.** `run-ledger.xml`, `run.xml`, `run/*.xml` of the
   *reviewed* change are never "outside write scope" — the CLI wrote them, and auditing the
   CLI's own writes against the agent's declared scope is a category error. Scope the
   exclusion to exactly the reviewed bundle. `.ngrace/graph`, `.ngrace/verification`,
   `.ngrace/context` writes **stay audited** (ag1 F-2's own condition): those are real
   durable writes that must be declared.
3. **Bundle-stored base ref.** At `gate approve`, record `BaseCommit` into the change's
   run-ledger — a recorded fact, not authored plan state, consistent with §6.3.
   `ngrace review --change C-ID` then defaults its universe to `base..working-tree`
   name-only instead of raw porcelain: pre-existing dirt never enters the audit. No-git
   fallback keeps porcelain **and prints the explicit caveat** ("no base commit — cannot
   attribute pre-existing changes"), so the weaker audit is never silent. Existing
   `--base` / `--changed-files` remain as overrides.
4. **Drift credit from applied bundles** (ag9 #4/#10). `status`'s unexplained-drift detector
   consults **applied** bundles' `ObservedWriteScope`s before declaring drift unexplained: a
   file matching an applied bundle's scope is "explained by C-*", not drift. Removes the
   permanent post-bootstrap refresh nag without weakening detection — the credit is only as
   broad as scopes a human approved.
5. **Finding severities.** Findings gain `error | warning | info`; `--severity` filters
   output. Named profiles ("land", "hotfix") are rejected — severity is model-honest,
   profiles are taste. After items 1–4, remaining low-value findings (change-meta notes) are
   demoted to `info` so the default view is signal.
6. **Honest nextAction** (ag2 §4.3, cheap half). `status` nextAction for unexplained drift
   never recommends committing; it recommends refresh/ratify. The full process grade is
   deferred (§7 D1).

**Verification.** Fixtures reproducing each corpus audit (ag1's 14/19, ag10's 45-flagged)
must come out clean; a fixture with genuine undeclared source writes must still fail; a
no-git fixture must print the caveat.
**Success metric, stated up front: on the corpus's own transcripts, scope findings drop ≥80%
while every planted real violation is still caught.**

### P3 — Lifecycle mechanics and evidence honesty → objectives; detail when P0–P2 land

**Objective.** No step of the change lifecycle exists only as folklore, and "documented
verification" can no longer drift from "executed verification" undetected.

1. **`ngrace lifecycle finish --change C-ID`.** One operation that, after a permitting
   `gate apply`: folds any loose epoch (via P0.6), sets `status="applied"` on spec and plan,
   moves the bundle to `archive/`, and records each action in the run-ledger. `--dry-run`
   prints the full mutation list and is the default in any ambiguous state. Gate output
   learns to print `next: ngrace lifecycle finish --change C-ID`.

   **Why a separate command and not a gate flag.** A29.2 (`RM-AGENT-RELIABILITY/plan.md:4580`,
   "Correction 49") is ratified and explicit — *"This is a correction, not a design
   question… The gate does not itself set `status` or `git mv` the bundle… The agent still
   performs the authored write after a permitting decision."* It is cited at
   `src/gates/command.ts:15`, in the CLI help, and in shipped `ngrace-execute` skill text.
   A29.2 constrains **the gate**; it is silent on a separate verb. `lifecycle finish` follows
   the `graph split --apply` precedent that invariant 8 / F1 was restated from: explicit
   verb, explicit apply, dry-run default, fail-closed.

   **This depends on open question Q1 (§10).** F1 permits the binary to write structural
   state it can derive **or is explicitly given**. Whether `approved → applied` is *authored
   content* (forbidden) or *explicitly given* (permitted by the operator's invocation)
   determines whether this command may write `status` at all, or may only perform the move
   and print the two-line edit. Do not build past that answer.
2. **`ngrace plan amend`.** Whitelist: additive `ObservedWriteScope` entries, additive
   `<Satisfies>` mappings, task `Title` text. Forbidden: assertions, `DurableScope`, task
   structure — supersede-only. Every amendment is a ledger event with `--reason`, and
   `review` / `gate apply` **surface the amendment list prominently**. Amendments thereby
   become *more* auditable than a supersede that buries the old plan, and remove the
   incentive that produced mistakes #9 and #11 (editing approved artifacts in place).
3. **MustPass coverage check** (ag3 §4.1 — the auth-e2e failure class, E3). Plan lint: every
   `V-M-*` Command referenced by the change's MustVerify set that is not ⊆ the plan's
   `MustPassCommand` / task Verification set is an error — with an explicit
   `<EvidenceWaived>V-M-*</EvidenceWaived>` opt-out so deliberate deferral is a recorded
   decision, never silence.

   **Binding, normative.** `<EvidenceWaived>` waives **command execution mirroring only**.
   It does **not** extend to marker emission or any other health signal — see P3.4 and §8 R2.
   Widening it would let a change-bundle artifact author the durable readiness picture,
   crossing the lint/health wall in its least visible direction.
4. **Marker discipline, split correctly by surface.**
   - *Author-time anchor check (lint surface).* At plan/verification lint, a declared
     `<Marker>` requires a resolvable `START_BLOCK_*` anchor in a linked runtime file. Moves
     the mistakes-#8 failure from module-health time (post-execute, both artifacts immutable)
     to authoring. Extends 6.1.0's near-miss warnings.
   - *Deferred emission (health surface).* Per §4.1, emission absence is a **report**, not a
     gate. Add `<MarkerPending>` as a sibling in the verification entry — agent-1's own
     parenthetical, which both source plans dropped in favour of a knob. The marker stays
     declared; health reports *"declared, emission deferred"* as a named state instead of
     collapsing it to `blocked`; `autonomyReady` stays honest (still not ready — which is
     true). Nothing is suppressed at project, bundle, or gate level, and the deferral lives
     where the marker lives.
5. **`ngrace verification --run`** (ag8 suggestion 2). Executes every `<Command>` (or
   `--module M-X` subset); prints pass/fail/duration; **advisory only, never gate-consumed** —
   the same discipline doctor already applies to calibration. This is the agent's pre-flight
   before `--assertions final --run-commands`, not a parallel evidence system.
6. **Verdict `--dry-run`** (ag9 #7). Prints exactly what would be recorded.

**Gate to write P3's step detail.** P0–P2 shipped; the author re-runs one brownfield
transcript end-to-end and counts remaining folklore steps. Targets from ag10's accounting:
bundles for a bootstrap ≤ 3, manual post-gate steps = 0. **Q1 answered.**

### P4 — The adoption path: brownfield as a first-class honest shape → objectives only

**Objective.** Resolve E4/RC-6. The current trap — init skeleton → pressure to land →
freestyle → retroactive-C-* ban → "commit and live with no lifecycle history" — is the
largest process failure in the corpus and the reason ten guides exist.

Three layers, deliberately minimal and complementary:

1. **`ngrace graph scan --draft`** (convergent: ag5 P1, ag6 idea 1, ag8 suggestion 1,
   ag10 §4.5). Adapter-driven inventory — packages, entry points, existing test commands —
   emitting **draft** graph/verification artifacts marked draft, never durable truth. The
   human edits; nothing scans its way into the model unreviewed. Scaffolding, not bypass:
   it feeds layer 2.
2. **Adoption boundary record.** A recorded adoption point — a commit ref plus a declaration
   that everything preceding it is out of scope *by construction*. This is not a retroactive
   `C-*`: it makes no claim that prior work was specified, reviewed, or approved. It states a
   boundary. One primitive resolves four symptoms: the permanent unexplained-drift
   recommendation, review noise from pre-existing files, the first change's unsatisfiable
   clean baseline, and the freestyle-land dead end.
3. **Adoption change kind, with ratify semantics** (ag2 §4.2, ag10 §4.14). A spec whose
   `<Problem>` is "the repository's current state is unmodelled", whose baseline assertions
   are an **inventory** (record what *is*, not what should be), and whose apply semantics are
   **ratify**: these files *are* current state; a human accepts; archive without pretending
   the work was planned.

**Open decisions, written after P1–P3 measurements:** whether layer 3 is a grammar addition
(`kind="adoption"` → `graceVersion` decision) or a spec convention plus review profile; how
ag2 §4.6's phased land templates become the *doctrine* for splitting adoption into reviewable
waves rather than product machinery; how layers 2 and 3 interact with P2.4's drift credit;
and Q2 (§10) — whether the boundary record supports non-git projects.

4. **Guide collapse.** The corpus's brownfield guides reduce to one canonical in-repo document
   carrying only what the product genuinely cannot: human approval discipline and host
   differences. Everything else must have been absorbed into P0–P4 machinery. **This is the
   phase's acceptance test.**

**Explicit boundary.** HTML/CSS/shell **adapters** (ag2 §4.9, ag3 §3.8, ag9 #4/#5) belong to
`RM-LANGUAGE-EXTENSIBILITY`, not this track. This track ships only P1.8's preflight warning
and — if evidence warrants — a link-or-exempt health surface so unmarked non-test files in
governed packages become a *named* state rather than a silent one, as doctor/health
information first, never a lint error.

---

## 6. Load-bearing walls — do not touch

The corpus overwhelmingly agrees these are correct (ag1 "what I would not change", ag2, ag6
§5, ag9). Every accepted item was chosen to preserve them.

1. **Lint/health separation** — structural integrity gates; autonomy-readiness informs. §4.1
   shows how easily this is misread; P3.4 and §8 R2 are shaped by it.
2. **`MODULE_MAP` parity enforcement** — the feature everything else proves. See §8 R1 and
   §7 D3 for why the two proposals to soften it are refused.
3. **Gate purity: evaluate and record, never author status** (A29.2 / A31.1). Hence
   lifecycle completion is a separate command, not `gate --execute`.
4. **Immutable approved plans; supersede for substantive change.** Hence `amend` is
   whitelisted, ledger-recorded, and review-surfaced.
5. **XML tags as semantic anchors** — grep-stability is the navigation model.
6. **`gateFailOn: errors` default and the D11 honesty gate.**
7. **`refresh` is report-only.** It does not freestyle-mutate the durable model; ag3 §2.7
   names this as correct and it is easy to erode while building P4.
8. **No retroactive change bundles for applied work.** P4's adoption kind is not a hole in
   this rule — it is the rule's missing complement: an honest terminal state for work that
   predates governance, ratified by a human, recorded forever, and explicitly labelled
   adoption rather than planned change.

---

## 7. Deferred, with reasons and re-entry conditions

| # | Suggestion | Why deferred | Re-entry condition |
|---|---|---|---|
| D1 | Full "process grade" beside module health; CLI-level commit enforcement (ag2 §4.3/4.4, ag9 #10-lite) | The cheap honest half ships as P2.6. A grade that folds host git state into the durable model needs design evidence, not enthusiasm | After P2/P4, measure whether drift + adoption output is still ambiguous in practice |
| D2 | Fail-closed detached review; `doctor --host` capability matrix (ag2 §4.5, ag3 §3.6, ag9 #5/#8) | 6.1.0 shipped honest verdicts; hard fail-closed would break hosts legitimately lacking subagents. The cheap half — surfacing `review: degraded` in status — belongs with D1's grade rather than shipping alone | When host-capability detection has real implementations to key on |
| D3 | `lint --fix` auto-rewrite of `MODULE_MAP` (ag5 P2) | Parity friction is the *point*: an auto-fixer converts "a human looks at API drift" into "the agent regenerates and moves on," and the map could then never contradict the code. P1.7's read-only view removes most of the pain without the hazard | Only with a designed-in show-the-diff-and-acknowledge flow, and evidence the read-only view is insufficient |
| D4 | Tamper-evident / signed status transitions (ag9 #9) | Real threat model, wrong phase — and the party who would forge a signature is the agent holding the key. The run-ledger plus signed git commits is the honest record today; PKI adds key management to a small CLI | Standalone exploration, modelled on `RM-LANGUAGE-EXTENSIBILITY`'s review-only pattern |
| D5 | Evidence-strength tiers L0–L3 in doctor (ag2 §4.7) | Goodhart risk: graded evidence invites optimizing the grade. 6.1.0's `claimedConfidence` is deliberately not gate-consumed | Revisit as calibration *information* only, never a gate |
| D6 | Guided baseline revert, batch gate ops, supersede dry-run preview, `status --visual`, spec/plan show subcommands (ag7 §4.6/4.10, ag10 §4.8/4.11/4.12) | Bundle sprawl and revert confusion are symptoms P0/P3/P4 treat at the cause; these treat them at the keyboard | Re-propose only what still hurts after P3 |

---

## 8. Rejected, with reasons

| # | Suggestion | Why rejected |
|---|---|---|
| R1 | **YAML/TOML dual authoring format projecting to XML** (ag4, ag5 P4) | Two representations of one truth is a drift machine — the authored file and the projection *will* disagree, and the projection is what lint trusts. It breaks wall §6.5: tags are the anchors, and YAML has no grep-stable tag identity. The pain it treats (escaping, verbosity, authoring from memory) is fully treated by P1's generators, schema reference, and prescriptive errors. Note that the reviews calling XML brittle are the same ones naming grep-stable `<M-API />` the best decision in the product — they describe an authoring-tool gap, not a format problem. Highest second-order cost of any suggestion in the corpus |
| R2 | **`markerEmission: required \| deferred-allowed \| off` policy knob** (ag1 F-4) | Two independent reasons. First: a project-wide knob that downgrades a blocking signal will be set to silence it — ag1's own stated risk, and F-4 is the one item its author flagged as adding a state rather than removing friction. Second, and decisive: §4.1 shows the signal is **not a gate** — no gate or lint consumes module health — so the knob would suppress an honest *report* while the thing it claims to unblock was never blocked. The underlying need (deliberate deferral must be recorded, not silent) is met by P3.4's `<MarkerPending>` in the verification entry, where the marker already lives. Default stays strict; nothing becomes project-wide invisible |
| R3 | **Sandboxed `gate enforce` blocking workspace edits** (ag5 P3) | Sandboxing is host territory; a CLI that refuses file writes is one shell alias from being bypassed and creates a false sense of a hard guarantee. neo-grace's real answer to skipped approvals already works: every transition leaves a durable record, and status/doctor surface its absence. Ship the sample pre-commit hook (`ngrace status --fail-on drift`) as documentation, not machinery |
| R4 | **Fast-track / patch bundles bypassing the lifecycle** (ag4 suggestion 4) | Directly contradicts the strongest cross-review finding (ag2 §3.2/3.3: leaving the rails is already too easy; green lint with no `C-*` is the failure mode). T0–T3 already modulate depth. Ceremony is also not what the corpus shows hurting — ag1 excluded it explicitly, ag3/ag8/ag9 judged it worth paying; the pain is *rework*. The correct cure is P0+P1+P3 making the governed path mechanically cheap enough that bypass pressure disappears |
| R5 | **Grace period: relaxed review rules for young projects** (ag10 §4.15) | Maturity-based two-rule systems are gameable in both directions, make the least-understood phase the least checked, and contradict E4's actual fix — P4 makes young projects *honest*, not *lenient* |
| R6 | **Leave the two glob matchers as they are; hint and document only** | Withdrawn by its author on evidence. It assumed one grammar whose semantics needed protecting; §4.6 shows there are two, that the binary already contradicts itself on the same plan and file, and that no enforcement surface ever honoured the strict reading — drift detection and parallel preflight both already use the wide one. The feared retroactive permission change is phantom in the permitted direction. What survives is P2.1's **direction constraint** and release note, not the rejection |

---

## 9. Cross-cutting verification strategy

1. **Review-replay fixtures.** P0–P2 each carry fixtures replaying the corpus's actual
   failing transcripts — F-1's comma input, ag8's NaN sequence, ag10's 45-file audit,
   mistakes #7's fold sequence. **The plan fails its own standard if any of those still
   reproduces.**
2. **The falsifier for §4.6.** `rg -n 'matchSimpleGlob|observedWriteScopeContains' src/ | rg -v test`
   returns three consumer sites and one divergent matcher; the behavioural repro compares
   `observedWriteScopeContains({files:[],globs:['web/js/**/*.js']}, 'web/js/app.js')` against
   the inlined regex at `review/core.ts:889`. P2.1's pinned test is that comparison. If the
   trace is wrong the test catches it before any code is deleted.
3. **Bootstrap session benchmark.** After P3, and again after P4: one fresh agent session
   performing a full brownfield land on a fixture repo. Metrics borrowed from ag10's honest
   accounting — mistake count, bundle count, manual post-gate steps, minutes-to-first-green-
   review. Baseline from the corpus: 13 / 8 / 3+. **P3 gate: ≤3 bundles, 0 folklore steps.
   P4 acceptance: no companion guide required.**
4. **Noise floor.** P2 must demonstrably preserve detection: fixtures with planted real
   violations — undeclared source write, scope creep across modules — still produce errors at
   the pre-P2 rate.
5. **Repo hygiene per the host repo's own rules.** Canonical skills and packaged mirrors
   change in lockstep; versions synchronized across the four release surfaces;
   `scripts/validate-marketplace.ts` and `validate:cli` green; this document splits into
   `review.md` / `plan.md` under `docs/plans/active/RM-GOVERNED-PATH/` with the index updated
   in the same commit.

---

## 10. Open questions for the maintainer

These are not rhetorical. Each blocks step detail somewhere downstream.

**Q1 — Is `approved → applied` authored content, or structural state explicitly given?**
Blocks P3.1. F1 (`RM-AGENT-RELIABILITY/decisions.md:67`) permits the binary to write
structural state it can derive **or is explicitly given**, never authored content. A29.2
calls transitions authored acts, but its worked example is `draft → approved` — a human
judgment with no machine precondition. `approved → applied` follows a permitting gate plus an
explicit confirmation, which may make it "explicitly given" in F1's sense where approval
never is. If authored: `lifecycle finish` may perform the fold and the move and must print
the two-line status edit for the agent. If given: it may write status behind its explicit
apply, exactly as `graph split --apply` writes index structure. **Neither source plan asked
this; both assumed an answer.**

**Q2 — Does the adoption boundary record support non-git projects?** Blocks P4.2's design.
The no-git fallback shapes the whole primitive: a commit ref is unavailable, so the boundary
must be either a recorded manifest snapshot or an explicit "unattributable before this point"
declaration. Choosing late means rebuilding.

**Q3 — Where does the base ref live?** Blocks P2.3. `run-ledger.xml` is the natural home (a
recorded fact, gate-authored, consistent with §6.3), but it is bundle-scoped while the
attribution question is repository-scoped. Alternative: a bundle-level file beside
`plan.xml`.

**Q4 — Is the guide-intersection work (P4.4) a `C-*` in this repo, or a docs track?** It is
skill-text change, which `CLAUDE.md` classifies as a product change — but it is also the one
deliverable measured by an external artifact (the guides shrinking).

---

## 11. Summary

**Accept as-is.** ag1 F-1, F-2 (hardened per its own condition), F-5, F-6, meta-inversion;
generators and schema reference; prescriptive errors and `--explain` surfacing; bundle
exclusion, base-ref attribution, drift credit; MustPass coverage with a waiver element;
author-time marker anchor check; `verification --run`; verdict `--dry-run`; cursor auto-open
(guarded) and `recover`; NaN fix; mode-aware lint; finding severities; approval lexicon;
`graph scan --draft`; adoption boundary and change kind; guide collapse.

**Accept modified.** Lifecycle finish as a separate command, pending Q1; `plan amend`
whitelisted, ledger-recorded, review-surfaced; adapter export view read-only; no-adapter
preflight as warning; severities instead of profiles; governed-path cheapening instead of
fast-track bundles; the reject-don't-filter sweep instead of three incident fixes;
`--explain` wiring before catalog authoring; `lint --as` bounded to state-pure rules with
absence reporting; F-4 answered by `<MarkerPending>` health reporting rather than a knob or a
widened waiver.

**Defer.** Process grade and commit enforcement; fail-closed detached review; `MODULE_MAP`
auto-rewrite; signed transitions; evidence tiers; guided revert, batch ops, preview
conveniences.

**Reject.** YAML/TOML dual format; `markerEmission` knob; sandboxed gate enforce;
lifecycle-bypass patch bundles; young-project grace period. R6 (leave the glob matchers
alone) withdrawn on evidence.

The through-line is ag1's closing sentence, which all ten reviews converge on: the
load-bearing walls are right; everything here is drywall and signage — plus one missing door,
the adoption path, that keeps getting mistaken for a wall agents have to climb over.

---

## 12. Merge record

Kept so the reasoning survives, per this repo's supersede-don't-rewrite discipline. "A" is
`RM-ADOPTION-INTEGRITY`, "K" is the original `RM-GOVERNED-PATH`.

| # | Contested point | Resolution | Basis |
|---|---|---|---|
| 1 | Gate executes vs separate verb | **K.** A's `gate apply\|archive --execute` withdrawn; A29.2 is ratified, cited in `src/gates/command.ts:15`, the CLI help, and shipped skill text, and forbids exactly that. A's "open question to the maintainer" framing also withdrawn — re-litigating a ratified decision is an explicit act, not a question in a new plan | A29.2 text |
| 2 | `markerEmission` knob vs `<EvidenceWaived>` | **Neither.** A conceded the knob to K's waiver; K then identified that the waiver as specified binds to MustPass mirroring while F-4's blocker is the marker↔emission health check. Verification showed that check is consumed by no gate and no lint (§4.1), so both mechanisms would suppress an honest report. Resolved as `<MarkerPending>` health reporting (P3.4) — ag1's own dropped parenthetical. R2's rejection stands and strengthens; `<EvidenceWaived>` stays scoped to command mirroring | §4.1 trace |
| 3 | Glob semantics | **A**, and K withdrew R6 fully rather than narrowly. The consumer trace defeated even the narrowed form: two matchers, self-contradiction on the same plan and file, and no surface ever enforcing the strict reading. K's surviving contributions: the direction constraint and the release note, both normative in P2.1 | §4.6 trace |
| 4 | Adoption primitive shape | **Both.** A's minimal boundary record and K's `graph scan --draft` + ratify semantics are complementary layers, not alternatives: scan supplies inventory, the boundary does attribution, ratify is the terminal semantics | — |
| 5 | Scaffolding vs diagnostics | **Both.** Generators cover write-time; `lint --as` covers evolution-time of hand-edited artifacts. K added the purity bound; A added absence reporting | — |
| 6 | Verdict write-then-read race | **Neither asserted it.** Both marked it unverified; reframed as a diagnostics item (§4.10) after tracing a synchronous ledger read | `gates/core.ts:271` |
| 7 | Structure | **K's skeleton**, plus A's root-cause layer with an E→RC mapping (§2), A's open-questions section (§10), and `refresh` restored to the walls (§6.7) | — |

Both passes independently reached the same walls, the same rejections, and the same success
criterion. The contested set closed at zero.
