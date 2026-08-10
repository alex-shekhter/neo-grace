---
id: RM-GOVERNED-PATH
kind: context
status: draft
supersededBy: null
created: 2026-08-09
updated: 2026-08-09
baseline: 6.1.1
targets: []
normative: false
plan: ./plan.md
---

# The governed path: friction, late feedback, and the missing adoption door

> **Non-normative.** This document records the evidence and reasoning. The commitments live in
> [plan.md](./plan.md), which is `draft` and **not approved for execution**. Where this document
> and the plan disagree, the plan wins.
>
> Section numbers here are cited from the plan as `review.md §N`. The reverse direction — the
> plan's own sections — are cited here as `plan.md §N`.

## 0. Provenance and epistemics

**Baseline:** `ngrace` v6.1.1 (`f340a98`).

**Provenance.** This document merges two independently produced consolidations of the same
corpus — `consolidated-improvement-plan-kimi.md` (RM-GOVERNED-PATH) and
`RM-ADOPTION-INTEGRITY-plan.md` — after a three-round adversarial review between their
authors. Both passes read the same ten agent reviews, ten brownfield guides, and the
mistakes log; both verified claims against the working tree rather than trusting the
reviews. The disagreement set closed at zero contested items. Where the two passes
disagreed, §5 records who conceded what and why, so the reasoning survives the merge.

The merged source document, as received, is preserved verbatim at
[sources/RM-GOVERNED-PATH-merged.md](./sources/RM-GOVERNED-PATH-merged.md). This file and
`plan.md` are its split into this repository's `docs/plans/` convention; nothing was added to
its claims in the split, and its own section numbers map as:

| Source § | Lands in |
|---|---|
| Preamble, §1–§4 | `review.md` §0–§4 |
| §12 merge record | `review.md` §5 |
| §5 roadmap | `plan.md` §2 |
| §6 walls · §7 deferred · §8 rejected | `plan.md` §3 · §4 · §5 |
| §9 verification · §10 questions · §11 summary | `plan.md` §6 · §7 · §8 |

**Epistemics.** Every claim carries **[verified]** (reproduced against `f340a98` during a
merge pass, with the reproduction recorded) or **[reported]** (from the corpus, not
reproduced — carried as investigation, never as a premise). No phase depends on a
`[reported]` claim being true.

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

Every accepted item in the plan is one of five moves:

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

The plan also **rejects or defers** a significant minority of the corpus's suggestions
(`plan.md` §4, §5). Several proposed cures would damage load-bearing parts of the model — gate
purity, anchor grep-stability, the lint/health split — to treat symptoms with cheaper, better
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
| E8 | **XML is verbose/hostile to author** — escaping, brittleness | 3/10 (ag4, ag5, ag6) | Symptom of E2, not a format problem | `plan.md` §5 R1 |
| E9 | **Ceremony too heavy for small changes** | 2/10 explicit (ag4, ag7); ag1 declared out of scope | Reject the bypass; cut mechanical cost instead | `plan.md` §5 R4 |
| E10 | **Process health conflated with model health; git commit outside the model** | 2/10 (ag2, ag9) | Partially real; cheap half accepted | `plan.md` §4 D1 |
| E11 | **No-adapter file types are silent traps** (CSS/HTML entry points, `.sh`) | 4/10 (ag2 §4.9, ag3 §3.8, ag6, ag9 #4/#5) | Real but bounded by `RM-LANGUAGE-EXTENSIBILITY` | P1.8 + defer |
| E12 | **Detached review degrades silently on hosts without subagents** | 3/10 (ag2, ag3 §3.6, ag9 #5/#8) | Half-fixed in 6.1.0 | `plan.md` §4 D2 |

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

**The plan's success criterion:** the guides collapse to one short canonical in-repo
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
   `--from T-001` writes `<Allocation from="NaN">`, and the corpus's recorded remedy is
   `rm -r run/` — deleting the audit trail to satisfy the audit gate.

   > **Correction, and a correction to that correction — 2026-08-09.**
   >
   > The P0 derivation pass ([p0-derivation.md](./p0-derivation.md), contradiction 1) reported that
   > fold fails with *"No loose run/ events to fold for C-*"* rather than the *"no Allocation found"*
   > this entry originally claimed, and that correction was accepted. **It was accepted too
   > broadly.** Live reproduction during T-001 execution shows the original text was right for the
   > path that matters:
   >
   > | State when `fold` runs | Message |
   > |---|---|
   > | Only the `NaN`-id opened event exists (open, then fold immediately) | *"No loose run/ events to fold"* |
   > | Valid loose events exist alongside it (open, **do work**, fold) | *"no Allocation found"* |
   >
   > Both are real. `listLooseEvents` (`:470`) drops the non-integer id, so the opened event is
   > invisible; whether you then hit "nothing to fold" or "no Allocation" depends only on whether
   > any work happened in between. The derivation's repro was the degenerate case; the realistic
   > sequence — which is what an executor actually does — produces the original message.
   >
   > Recorded rather than silently re-edited: a reproduction that omits the work step is not a
   > reproduction of the workflow, and the authority accepted it without noticing. See F8.
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
8. **No gate-stored base ref.** **[verified]** Gates never author state (`plan.md` §3.3);
   nothing records a base commit at approve time, so no audit default can use `--base`.
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

This is load-bearing for `plan.md` §5 R2 and P3.4: it is why the answer to F-4 is a health
*reporting* refinement and not a suppression mechanism at project, bundle, or gate level.

---

## 5. Merge record

Kept so the reasoning survives, per this repo's supersede-don't-rewrite discipline. "A" is
`RM-ADOPTION-INTEGRITY`, "K" is the original `RM-GOVERNED-PATH`.

| # | Contested point | Resolution | Basis |
|---|---|---|---|
| 1 | Gate executes vs separate verb | **K.** A's `gate apply\|archive --execute` withdrawn; A29.2 is ratified, cited in `src/gates/command.ts:15`, the CLI help, and shipped skill text, and forbids exactly that. A's "open question to the maintainer" framing also withdrawn — re-litigating a ratified decision is an explicit act, not a question in a new plan | A29.2 text |
| 2 | `markerEmission` knob vs `<EvidenceWaived>` | **Neither.** A conceded the knob to K's waiver; K then identified that the waiver as specified binds to MustPass mirroring while F-4's blocker is the marker↔emission health check. Verification showed that check is consumed by no gate and no lint (§4.1), so both mechanisms would suppress an honest report. Resolved as `<MarkerPending>` health reporting (`plan.md` P3.4) — ag1's own dropped parenthetical. R2's rejection stands and strengthens; `<EvidenceWaived>` stays scoped to command mirroring | §4.1 trace |
| 3 | Glob semantics | **A**, and K withdrew R6 fully rather than narrowly. The consumer trace defeated even the narrowed form: two matchers, self-contradiction on the same plan and file, and no surface ever enforcing the strict reading. K's surviving contributions: the direction constraint and the release note, both normative in `plan.md` P2.1 | §4.6 trace |
| 4 | Adoption primitive shape | **Both.** A's minimal boundary record and K's `graph scan --draft` + ratify semantics are complementary layers, not alternatives: scan supplies inventory, the boundary does attribution, ratify is the terminal semantics | — |
| 5 | Scaffolding vs diagnostics | **Both.** Generators cover write-time; `lint --as` covers evolution-time of hand-edited artifacts. K added the purity bound; A added absence reporting | — |
| 6 | Verdict write-then-read race | **Neither asserted it.** Both marked it unverified; reframed as a diagnostics item (§4.10) after tracing a synchronous ledger read | `gates/core.ts:271` |
| 7 | Structure | **K's skeleton**, plus A's root-cause layer with an E→RC mapping (§2), A's open-questions section (`plan.md` §7), and `refresh` restored to the walls (`plan.md` §3.7) | — |

Both passes independently reached the same walls, the same rejections, and the same success
criterion. The contested set closed at zero.

---

## 6. Split verification — claims re-checked at conversion time

Six load-bearing **[verified]** claims were re-reproduced against the working tree on
2026-08-09, when this document was split into the repository's plan convention. All six held
exactly as written. Recorded here so the next reader does not have to re-derive them, and so a
future drift is visible as a diff against a stated result.

| Claim | Reproduction | Result |
|---|---|---|
| §4.6 glob divergence | `observedWriteScopeContains({files:[],globs:["web/js/**/*.js"]}, "web/js/app.js")` | `true` — diverges from `matchSimpleGlob`, whose regex requires an intervening `/` |
| §4.6 second matcher exists | `rg -n 'matchSimpleGlob\|observedWriteScopeContains' src/` minus tests | 3 consumer sites + `matchSimpleGlob` at `src/review/core.ts:889` — the trace's exact shape |
| §4.7 `--explain` fallthrough | `bun run ngrace lint --explain review.scope-outside-write-scope` | `Classification: emittable-uncatalogued`, generic "does not yet have a dedicated entry" text |
| §4.7 the real guide exists | `src/review/catalog.ts:128` | Full entry: title, explanation, two remediation lines, `severity: "error"` |
| §4.3 unguarded `Number()` | `src/grace-cursor.ts:2622` | `from: context.args.from ? Number(context.args.from) : undefined` — no validation |
| §5 merge-record basis (A29.2 citation) | `src/gates/command.ts:15` | `evaluate/record; never author status (A29.2, A31.1)` |
