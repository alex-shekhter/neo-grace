---
id: RM-GOVERNED-PATH
kind: plan
status: approved
supersededBy: null
created: 2026-08-09
updated: 2026-08-09
approved: 2026-08-09
baseline: 6.1.1
targets: [6.2.0, 6.3.0, 6.4.0]
context: ./decisions.md
---

# Governed path: make the checked route the cheap route

**Target repository:** `neo-grace` (`@neograce/cli`, 6.1.1 at `f340a98`)
**Audience:** the maintainer deciding whether to schedule this, then an executor coding agent
**Authority:** [decisions.md](./decisions.md) records seven ratified decisions (D1–D7) and five
findings (F1–F5); [review.md](./review.md) carries the evidence, the root-cause analysis, and the
merge record of the two source consolidations. `review.md` frames the questions, `decisions.md`
answers them, this plan orders and specifies the work. Where this plan and either companion
disagree, **this plan wins.**
**Plan version:** 1.4 · 2026-08-09 (converted from
[sources/RM-GOVERNED-PATH-merged.md](./sources/RM-GOVERNED-PATH-merged.md); D1–D5 ratified; D6–D7 added during P0
execution)

> ## Approved for execution — 2026-08-09.
>
> Approved by the maintainer. All decisions are ratified (D1–D7,
> [decisions.md](./decisions.md)) and no question is open.
>
> **What the approval clears.** The objectives, the phase order, the sequencing rules in §1, the
> decisions, and the deferral/rejection lists (§4, §5). Work may begin.
>
> **What it does not clear.** The `targets` above remain **provisional** — a release commitment is a
> separate act per phase. Approval is not a licence to skip the derivation below: P0–P2's steps were
> written against HEAD, not against a files-touched analysis, and P3–P4 have no steps at all.
>
> **Execution model.** Phases become GRACE change bundles under `.ngrace/changes/`, per
> [../../README.md](../../README.md). A `C-*` spec names the roadmap plan and phase it implements.
> Each phase's execution detail is derived at its start (see the box below) and recorded before any
> bundle is authored.

> ## What this plan deliberately does not carry — and what must happen before each phase
>
> Per `docs/plans/README.md` rule 7, and the split that rule was written from:
>
> - **P0–P2 carry step detail** because the evidence for every step exists at HEAD and was
>   reproduced (`review.md` §4, §6).
> - **P3–P4 are objectives, decisions, and gates only.** Their steps are written when P0–P2 land
>   and produce the measurements they assume.
> - **No phase carries a *Files touched* table, a *Rollback* section, or step-level verify
>   commands.** Writing them before the phase starts would make speculation read as specification,
>   which is the exact failure the rule exists to prevent.
>
> **Therefore every phase begins with a derivation pass, before any bundle is authored:** fetch and
> confirm the baseline (`RM-AGENT-RELIABILITY` §0.4.1), re-derive the phase's steps against the tree
> as it then stands, produce the files-touched analysis, record every contradiction between the plan
> and the code, and propose the bundle split. **A step that reading contradicts is reported, not
> improvised around.** `RM-AGENT-RELIABILITY` §0 is the operating-contract precedent to instantiate
> at that point.

---

## 1. Phase status board

Keep this table current. It is the single source of truth for progress.

| # | Phase | Root causes addressed | Target (provisional) | Detail | Status |
|---|---|---|---|---|---|
| P0 | Reject, don't filter: the integrity cluster | RC-1 | 6.2.0 | steps | `DERIVED` — [p0-derivation.md](./p0-derivation.md) |
| P1 | The authoring surface: diagnostics, generators, skills | RC-4, RC-7 | 6.3.0 | steps | `NOT STARTED` |
| P2 | Review honesty: one glob language, one audit universe | RC-2 | 6.3.0 | steps | `NOT STARTED` |
| P3 | Lifecycle mechanics and evidence honesty | RC-3, RC-5, RC-7 | 6.4.0 | objectives | `NOT STARTED` |
| P4 | The adoption path: brownfield as a first-class honest shape | RC-6 | 6.4.0 | objectives | `NOT STARTED` |

**Hard sequencing rules** — dependencies, not preferences:

1. **P0 → P3.1.** `lifecycle finish` folds loose epochs via P0.6. Without cursor recovery it
   inherits the dead-end it exists to remove.
2. **P0.6 → P3.1.** Stated separately because it is the specific item, not the whole phase.
3. **P1.1 → P1.2.** Wire the existing catalogs, let the coverage test report the real gap, then
   author only the delta. Authoring first re-does work already done in 76 existing guides.
4. **P1.4 → P2.1's release note.** The schema reference must state zero-depth `**` before review
   changes what it accepts, or the CHANGELOG note points at documentation that does not exist.
5. **P2.3 → P3.7.** The approve-event base ref (D3) is the same ledger record D1's detection rule
   keys on. The record must exist before anything reports on its absence.
6. **P3.1 → P3.7, and P3.7 → nothing.** The finding is inert until `lifecycle finish` writes the
   record, and it must never fire on bundles predating it (D1.4, F1).
7. **P0–P2 → P3's step detail.** The gate to write those steps is stated at the end of §2 P3.
8. **P1–P3 measurements → P4's open decisions.** Listed in P4.

P1 and P2 may run in either order or concurrently; they touch disjoint surfaces (authoring
diagnostics vs the review audit) and share only the schema-reference dependency in rule 4.

---

## 2. The roadmap

Baseline `6.1.1`.

### P0 — Reject, don't filter: the integrity cluster → target 6.2.0

**Objective.** Every unrecognized authored token becomes an error. No silent drops, no
`NaN`, no discarded intent.

This phase is framed as a **class fix, not three incident fixes**. RC-1's instances were
reported; the sweep finds the ones nobody hit yet.

**Steps.**

1. **The `.filter()` sweep.** Inventory every `.filter()` applied to authored input across
   `src/artifact/` and `src/project-utils.ts`. Each site is classified in the change bundle
   as *paired-with-an-error-path* (justified) or *silent discard* (converted). The inventory
   is a required deliverable, not a byproduct — it is what makes this a class fix.

   **Delivered by the derivation pass** ([p0-derivation.md](./p0-derivation.md)): 8 paired, 10
   silent discards, 1 partition companion. Seven of the ten were unknown before the sweep —
   `<Owns>` children, the `GD-*` and `VD-*` index lists, `parseAllocation` / `parseLedgerEvent`
   null drops, empty `<EscalatedTask>`, and non-task children under `ImplementationPlan`.

   **Site 11 was found afterwards, in review of the first bundle** — `<DependsOn>`'s anchor-child
   form (D7 / F5), which the sweep had classified as justified. **Eleven convert.** That the sweep
   itself missed one is the argument for its own review gate, not against it: the inventory is
   reviewed as a document precisely because a classification can be wrong.

   **All eleven convert in P0. There is no "leave it silent for now" outcome.** The two
   classifications are *already raises* and *must be made to raise* — "justified" means a paired
   error path exists, never that a silent discard is acceptable pending a later phase. A site may
   only leave the conversion list by being **reclassified on evidence** as already paired, with the
   raising code named. Deferring a detected silent discard would rebuild, inside the phase that
   exists to end silent discards, the exact thing it exists to end.
2. **`LINKS` / `DEPENDS` multi-value.** Accept **`[,;\s]+`** as separator (D5.1 — comma, semicolon,
   whitespace; **the colon is deliberately excluded**) so `LINKS: M-A M-B` works; emit
   `markup.unparsed-link-token` (error) for any token matching no `ANCHOR_PATTERNS` family, naming
   the token, the accepted separators, and the accepted families. The silent "Linked Modules: none"
   is the defect, not the separator.

   Preserve the existing `[...]` stripping and `none` handling (F3). `splitList` has exactly two
   callers, both in `parseGovernedFile`, so the widening cannot reach another field.

   **Why not the colon.** `LINKS: M-A: M-B` then yields the token `M-A:`, which matches no family
   and produces exactly this step's error — one edit to fix. Accepting the colon would make that
   slip silently work, which is filtering in the phase built to end filtering. See D5.1.
3. **`<DependsOn>` multi-value** (ag1 F-1). Split the text node on the same `[,;\s]+` set before
   per-token canonical-T validation; `<Task>` children remain the explicit form. Rewrite
   `change.task-invalid-dependency` to name **all three** accepted shapes.

   **Extended by D7 — site 11.** `readTaskDependencies` reads child *text* only, so
   `<DependsOn><T-001 /></DependsOn>` — the anchor form `Satisfies`, `DurableScope` and
   `AffectedAreas` all use, and which the shipped plan template sits directly above — **parses to
   nothing, silently.** It is live in archived `C-GATE-RECORD-ABSENCE`, whose `T-002` has never
   actually depended on `T-001`. The fix **reads the tag**; it does not raise. That makes it a
   repair under D5.3: the archived bundle gains the dependency it always claimed instead of turning
   red. The sweep classified this site as justified "empty cleanup"; **that classification is
   corrected to silent discard.**

   **F5.1 — the blast radius is three rules, not one declaration.** The empty set makes
   `change.task-unknown-dependency`, `change.task-self-dependency`, and cycle detection all pass
   vacuously (`grammar.ts:2031–2078`). Probed: `<DependsOn><T-999 /></DependsOn>` raises **nothing**,
   while `<DependsOn><Task>T-999</Task></DependsOn>` raises `change.task-unknown-dependency`. A plan
   may depend on a nonexistent task, or on itself, and lint stays green — if the author used the
   idiomatic shape. **The regression test must assert through the lint surface**, not an internal
   dependency set: `readTaskDependencies` is unexported, and the issue codes prove more.
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
7. **Verdict diagnostics** (`review.md` §4.10). Reproduce first. If the race is real, flush
   before return; if not — the likely case — rewrite `gate.apply.no-verdict` to report where it
   looked, how many entries it found, and why the newest did not qualify.
8. **Calibration backfill** (ag3 §3.10). Doctor must not report archived epochs as pending
   `MustPassCommand` adjudication after a final `--run-commands` succeeded; re-derive
   adjudication from the ledger instead of snapshotting it.

   **Bound by D6 — read it before designing this step.** Taken literally this wording would break
   ratified Correction 156 (labels are stored at fold, never recomputed at report time; *"a corpus
   whose labels move is not a corpus"*). D6 corrects the reading: derive the snapshot from **recorded
   command evidence**, never from a live tree query, and use the existing `CalibrationRestatement` +
   `backfilled` bucket when evidence lands after fold. **No report-time call to
   `evaluateTargetComplete` may be introduced.** If the step cannot be built inside that constraint,
   stop and report — corr 156 is a wall, not a tradeoff.
9. **Mode-aware lint summary** (ag3 §3.7). When an active change has baseline assertions,
   default text output leads with one line — *"N baseline expectations (expected while C-* is
   in progress)"* — instead of presenting `MustNotExist` failures as generic breakage.

**Verification.** Each item lands with a regression test replaying the corpus transcript that
reported it (the reviews supply them verbatim: F-1's comma input, ag8's NaN sequence,
mistakes #7's fold sequence). A silently-dropped token must fail a test. Plus
`bun run validate:cli` and the dogfooding lint green.

**Release surface (D5.4).** Not a break is not the same as not visible: a project with a typo'd
`LINKS` has green lint today and red lint after. P0 therefore ships with a CHANGELOG entry listing
every newly-erroring code, and `lint --remediate` coverage wherever the fix is mechanical. Per D5.2
and D5.3 there is **no `NGRACE_ARTIFACT_VERSION` bump** — every conversion in this phase makes an
existing silent failure loud, and none turns a working state into an error.

**Review gate.** The `.filter()` inventory (step 1) is reviewed as a document, not just as a
diff: every site classified, every *silent discard* either converted or carrying a written
reason. A sweep that only fixed the three reported instances has not delivered this phase.

---

### P1 — The authoring surface: diagnostics, then generators, then skills → target 6.3.0

**Objective.** An agent can author a valid artifact without having read the TypeScript source
or the polyglot example — and when it gets something wrong, learns the fix from the error.

Ordering matters and is deliberate: **wire what exists, measure the gap, then author the
delta.** The alternative — a blind catalog pass over 76 existing guides — does work already
done.

**Steps.**

1. **Wire the review and gate catalogs into `lint --explain`** (`review.md` §4.7).
   `src/lint/catalog.ts` already imports from `src/review/catalog.ts`; consult the guide objects
   rather than falling through to prefix text. Add a **coverage test asserting every emittable
   code resolves to a surface-specific guide**, so this cannot regress.
2. **Author only the delta the coverage test exposes.** Each remaining code gets a fix-shape
   explanation — not "must be canonical" but "use `<Task>` children or comma/space-separated
   T-NNN ids." Priority order is the codes the corpus actually hit (`review.md` §4).
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
   here. Auto-rewrite is deliberately deferred (§4 D3).
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

**Repo hygiene.** Steps 10 and 11 are skill-text and example changes: canonical
`skills/ngrace/*` and the packaged mirror `plugins/ngrace/skills/ngrace/*` change in the same
commit, and `bun run validate:marketplace` must be green.

---

### P2 — Review honesty: one glob language, one audit universe → target 6.3.0

Highest value relative to size (E1: 8/10). Review is the product's honesty surface; today it
cries wolf 14 times out of 19 and teaches every agent to verdict `pass` with a justification
paragraph. **The cure is attribution, not suppression.**

**Steps.**

1. **Delete the duplicate glob matcher** (`review.md` §4.6). Remove `matchSimpleGlob`; route
   the scope audit through `src/artifact/scope.ts`. One glob language, one implementation.

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
   also this plan's first conformance test and the falsifier for `review.md` §4.6's trace.
2. **Exclude CLI-authored lifecycle files.** `run-ledger.xml`, `run.xml`, `run/*.xml` of the
   *reviewed* change are never "outside write scope" — the CLI wrote them, and auditing the
   CLI's own writes against the agent's declared scope is a category error. Scope the
   exclusion to exactly the reviewed bundle. `.ngrace/graph`, `.ngrace/verification`,
   `.ngrace/context` writes **stay audited** (ag1 F-2's own condition): those are real
   durable writes that must be declared.
3. **Bundle-stored base ref.** At `gate approve`, record `BaseCommit` into the change's
   run-ledger — a recorded fact, not authored plan state, consistent with §3.3.
   `ngrace review --change C-ID` then defaults its universe to `base..working-tree`
   name-only instead of raw porcelain: pre-existing dirt never enters the audit. No-git
   fallback keeps porcelain **and prints the explicit caveat** ("no base commit — cannot
   attribute pre-existing changes"), so the weaker audit is never silent. Existing
   `--base` / `--changed-files` remain as overrides.

   **Settled by D3.** The ref lives in the change's `run-ledger.xml`, written by `gate approve` as
   part of the approve event. The repository-scoped half of the question belongs to P4.2's adoption
   boundary, not here. This is also the record D1's detection rule keys on (P3.7), so its shape is
   load-bearing beyond this step.
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
   deferred (§4 D1).

**Verification.** Fixtures reproducing each corpus audit (ag1's 14/19, ag10's 45-flagged)
must come out clean; a fixture with genuine undeclared source writes must still fail; a
no-git fixture must print the caveat.

**Success metric, stated up front: on the corpus's own transcripts, scope findings drop ≥80%
while every planted real violation is still caught.**

---

### P3 — Lifecycle mechanics and evidence honesty → objectives; detail when P0–P2 land

> **Objectives, decisions, and gates only.** The numbered items below are *what this phase
> delivers*, not *how*. Their steps are written after the gate at the end of this section.

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

   **Settled by D1 — and settled harder than this step assumed.** `approved → applied` is
   structural state *explicitly given*, so this command writes `status`. Beyond that, it becomes
   the **only sanctioned writer** of that transition: a hand-written `applied` is a reportable
   defect (P3.7). `draft → approved` is untouched and stays authored.

   The line between them is that apply has a machine-evaluable precondition — the gate — and
   approve has none. **Record that reason wherever this is implemented**, or a later reader
   "fixes" the asymmetry in the wrong direction.

   **D1.5 — the forced apply is not optional.** `--force` writes a ledger event naming the apply as
   forced with an operator-supplied reason. Without it, a gate that refuses for a bad reason leaves
   no sanctioned exit, people hand-write anyway, and the record becomes *worse* than before D1: the
   same write, no longer distinguishable from a tooling gap. Ship it with the command, not after.
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
   It does **not** extend to marker emission or any other health signal — see P3.4 and
   §5 R2. Widening it would let a change-bundle artifact author the durable readiness
   picture, crossing the lint/health wall in its least visible direction.
4. **Marker discipline, split correctly by surface.**
   - *Author-time anchor check (lint surface).* At plan/verification lint, a declared
     `<Marker>` requires a resolvable `START_BLOCK_*` anchor in a linked runtime file. Moves
     the mistakes-#8 failure from module-health time (post-execute, both artifacts immutable)
     to authoring. Extends 6.1.0's near-miss warnings.
   - *Deferred emission (health surface).* Per `review.md` §4.1, emission absence is a
     **report**, not a gate. Add `<MarkerPending>` as a sibling in the verification entry —
     agent-1's own parenthetical, which both source plans dropped in favour of a knob. The
     marker stays declared; health reports *"declared, emission deferred"* as a named state
     instead of collapsing it to `blocked`; `autonomyReady` stays honest (still not ready —
     which is true). Nothing is suppressed at project, bundle, or gate level, and the
     deferral lives where the marker lives.
5. **`ngrace verification --run`** (ag8 suggestion 2). Executes every `<Command>` (or
   `--module M-X` subset); prints pass/fail/duration; **advisory only, never gate-consumed** —
   the same discipline doctor already applies to calibration. This is the agent's pre-flight
   before `--assertions final --run-commands`, not a parallel evidence system.
6. **Verdict `--dry-run`** (ag9 #7). Prints exactly what would be recorded.
7. **Hand-written status detection** (new, required by D1.3). Review gains a finding for an
   `applied` status with no corresponding ledger record. **Without this, D1 is inert** — nothing
   anywhere observes the difference between a permitted apply and a word typed into a file, which is
   the entire value D1 claims.

   **Not retroactive (D1.4, F1).** The finding fires only where the ledger carries an approve event
   from the gate surface. Measured 2026-08-09: **all sixteen** archived bundles in this repository
   are hand-written `applied`, and three carry no ledger at all. A naive rule reports sixteen
   violations against its own history on the day it ships.

   **Detection, not prevention (F2).** Nothing stops an agent writing seven characters into an XML
   file, and this repository already refused the posture that pretends otherwise (§5 R3). This
   finding makes a dishonest apply *visible afterwards*; it does not make one unavailable.

**Gate to write P3's step detail.** P0–P2 shipped; the author re-runs one brownfield
transcript end-to-end and counts remaining folklore steps. Targets from ag10's accounting:
bundles for a bootstrap ≤ 3, manual post-gate steps = 0. *(The design question that also gated this
detail is answered — D1.)*

---

### P4 — The adoption path: brownfield as a first-class honest shape → objectives only

> **Objectives and open decisions only.** No step detail is written, and none should be until
> the P1–P3 measurements this phase's decisions depend on exist.

**Objective.** Resolve E4/RC-6. The current trap — init skeleton → pressure to land →
freestyle → retroactive-C-* ban → "commit and live with no lifecycle history" — is the
largest process failure in the corpus and the reason ten guides exist.

Three layers, deliberately minimal and complementary:

1. **`ngrace graph scan --draft`** (convergent: ag5 P1, ag6 idea 1, ag8 suggestion 1,
   ag10 §4.5). Adapter-driven inventory — packages, entry points, existing test commands —
   emitting **draft** graph/verification artifacts marked draft, never durable truth. The
   human edits; nothing scans its way into the model unreviewed. Scaffolding, not bypass:
   it feeds layer 2.
2. **Adoption boundary record.** A recorded adoption point declaring that everything preceding it
   is out of scope *by construction*. This is not a retroactive `C-*`: it makes no claim that prior
   work was specified, reviewed, or approved. It states a boundary. One primitive resolves four
   symptoms: the permanent unexplained-drift recommendation, review noise from pre-existing files,
   the first change's unsatisfiable clean baseline, and the freestyle-land dead end.

   **Shaped by D2.** The primitive is a **declaration plus a path inventory**; where git exists a
   commit ref is a cheaper, stronger expression of the same thing and is used. **The design order is
   the decision** — build the ref as the primary shape and the first non-git project forces a
   rebuild, which is what asking the question was meant to avoid. Contents at the boundary are not
   needed: all four symptoms turn on *which paths* predate adoption, and hashes would buy only the
   tamper detection deferred at §4 D4.

   **D2.1 — an unresolvable ref is a named absence.** Rebase, squash-merge, force-push and shallow
   clones all break a ref, and this record is permanent, so that is ordinary rather than exotic. Use
   the shipped absence vocabulary; **never** fall back silently to treating everything as drift,
   which would restore the exact nag this primitive exists to remove. Record the inventory alongside
   the ref even where git is present.
3. **Adoption change kind, with ratify semantics** (ag2 §4.2, ag10 §4.14). A spec whose
   `<Problem>` is "the repository's current state is unmodelled", whose baseline assertions
   are an **inventory** (record what *is*, not what should be), and whose apply semantics are
   **ratify**: these files *are* current state; a human accepts; archive without pretending
   the work was planned.
4. **Guide collapse.** The corpus's brownfield guides reduce to one canonical in-repo document
   carrying only what the product genuinely cannot: human approval discipline and host
   differences. Everything else must have been absorbed into P0–P4 machinery.

   **Settled by D4: this is a `C-*` bundle in this repository, and the acceptance test is the
   bootstrap benchmark (§6), not the external guide count.** The guides are files in another
   directory owned by other people; a bundle asserting they shrank carries a claim it can never
   honestly verify — the documented-but-not-executed failure this plan exists to fix, committed by
   the plan itself. Guide count is demoted to an observation recorded afterwards. The benchmark is
   also the better test of the same claim: guides shrinking is a lagging indicator of an adopter not
   needing one.

**Open decisions, written after P1–P3 measurements:** whether layer 3 is a grammar addition
(`kind="adoption"` → `graceVersion` decision) or a spec convention plus review profile; how
ag2 §4.6's phased land templates become the *doctrine* for splitting adoption into reviewable
waves rather than product machinery; and how layers 2 and 3 interact with P2.4's drift credit.
*(The non-git question that sat here is answered — D2.)*

**Explicit boundary.** HTML/CSS/shell **adapters** (ag2 §4.9, ag3 §3.8, ag9 #4/#5) belong to
[`RM-LANGUAGE-EXTENSIBILITY`](../RM-LANGUAGE-EXTENSIBILITY/review.md), not this track. This
track ships only P1.8's preflight warning and — if evidence warrants — a link-or-exempt health
surface so unmarked non-test files in governed packages become a *named* state rather than a
silent one, as doctor/health information first, never a lint error.

---

## 3. Load-bearing walls — do not touch

The corpus overwhelmingly agrees these are correct (ag1 "what I would not change", ag2, ag6
§5, ag9). Every accepted item was chosen to preserve them.

1. **Lint/health separation** — structural integrity gates; autonomy-readiness informs.
   `review.md` §4.1 shows how easily this is misread; P3.4 and §5 R2 are shaped by it.
2. **`MODULE_MAP` parity enforcement** — the feature everything else proves. See §5 R1 and
   §4 D3 for why the two proposals to soften it are refused.
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

## 4. Deferred, with reasons and re-entry conditions

| # | Suggestion | Why deferred | Re-entry condition |
|---|---|---|---|
| D1 | Full "process grade" beside module health; CLI-level commit enforcement (ag2 §4.3/4.4, ag9 #10-lite) | The cheap honest half ships as P2.6. A grade that folds host git state into the durable model needs design evidence, not enthusiasm | After P2/P4, measure whether drift + adoption output is still ambiguous in practice |
| D2 | Fail-closed detached review; `doctor --host` capability matrix (ag2 §4.5, ag3 §3.6, ag9 #5/#8) | 6.1.0 shipped honest verdicts; hard fail-closed would break hosts legitimately lacking subagents. The cheap half — surfacing `review: degraded` in status — belongs with D1's grade rather than shipping alone | When host-capability detection has real implementations to key on |
| D3 | `lint --fix` auto-rewrite of `MODULE_MAP` (ag5 P2) | Parity friction is the *point*: an auto-fixer converts "a human looks at API drift" into "the agent regenerates and moves on," and the map could then never contradict the code. P1.7's read-only view removes most of the pain without the hazard | Only with a designed-in show-the-diff-and-acknowledge flow, and evidence the read-only view is insufficient |
| D4 | Tamper-evident / signed status transitions (ag9 #9) | Real threat model, wrong phase — and the party who would forge a signature is the agent holding the key. The run-ledger plus signed git commits is the honest record today; PKI adds key management to a small CLI | Standalone exploration, modelled on `RM-LANGUAGE-EXTENSIBILITY`'s review-only pattern |
| D5 | Evidence-strength tiers L0–L3 in doctor (ag2 §4.7) | Goodhart risk: graded evidence invites optimizing the grade. 6.1.0's `claimedConfidence` is deliberately not gate-consumed | Revisit as calibration *information* only, never a gate |
| D6 | Guided baseline revert, batch gate ops, supersede dry-run preview, `status --visual`, spec/plan show subcommands (ag7 §4.6/4.10, ag10 §4.8/4.11/4.12) | Bundle sprawl and revert confusion are symptoms P0/P3/P4 treat at the cause; these treat them at the keyboard | Re-propose only what still hurts after P3 |

---

## 5. Rejected, with reasons

| # | Suggestion | Why rejected |
|---|---|---|
| R1 | **YAML/TOML dual authoring format projecting to XML** (ag4, ag5 P4) | Two representations of one truth is a drift machine — the authored file and the projection *will* disagree, and the projection is what lint trusts. It breaks wall §3.5: tags are the anchors, and YAML has no grep-stable tag identity. The pain it treats (escaping, verbosity, authoring from memory) is fully treated by P1's generators, schema reference, and prescriptive errors. Note that the reviews calling XML brittle are the same ones naming grep-stable `<M-API />` the best decision in the product — they describe an authoring-tool gap, not a format problem. Highest second-order cost of any suggestion in the corpus |
| R2 | **`markerEmission: required \| deferred-allowed \| off` policy knob** (ag1 F-4) | Two independent reasons. First: a project-wide knob that downgrades a blocking signal will be set to silence it — ag1's own stated risk, and F-4 is the one item its author flagged as adding a state rather than removing friction. Second, and decisive: `review.md` §4.1 shows the signal is **not a gate** — no gate or lint consumes module health — so the knob would suppress an honest *report* while the thing it claims to unblock was never blocked. The underlying need (deliberate deferral must be recorded, not silent) is met by P3.4's `<MarkerPending>` in the verification entry, where the marker already lives. Default stays strict; nothing becomes project-wide invisible |
| R3 | **Sandboxed `gate enforce` blocking workspace edits** (ag5 P3) | Sandboxing is host territory; a CLI that refuses file writes is one shell alias from being bypassed and creates a false sense of a hard guarantee. neo-grace's real answer to skipped approvals already works: every transition leaves a durable record, and status/doctor surface its absence. Ship the sample pre-commit hook (`ngrace status --fail-on drift`) as documentation, not machinery |
| R4 | **Fast-track / patch bundles bypassing the lifecycle** (ag4 suggestion 4) | Directly contradicts the strongest cross-review finding (ag2 §3.2/3.3: leaving the rails is already too easy; green lint with no `C-*` is the failure mode). T0–T3 already modulate depth. Ceremony is also not what the corpus shows hurting — ag1 excluded it explicitly, ag3/ag8/ag9 judged it worth paying; the pain is *rework*. The correct cure is P0+P1+P3 making the governed path mechanically cheap enough that bypass pressure disappears |
| R5 | **Grace period: relaxed review rules for young projects** (ag10 §4.15) | Maturity-based two-rule systems are gameable in both directions, make the least-understood phase the least checked, and contradict E4's actual fix — P4 makes young projects *honest*, not *lenient* |
| R6 | **Leave the two glob matchers as they are; hint and document only** | Withdrawn by its author on evidence. It assumed one grammar whose semantics needed protecting; `review.md` §4.6 shows there are two, that the binary already contradicts itself on the same plan and file, and that no enforcement surface ever honoured the strict reading — drift detection and parallel preflight both already use the wide one. The feared retroactive permission change is phantom in the permitted direction. What survives is P2.1's **direction constraint** and release note, not the rejection |

---

## 6. Cross-cutting verification strategy

1. **Review-replay fixtures.** P0–P2 each carry fixtures replaying the corpus's actual
   failing transcripts — F-1's comma input, ag8's NaN sequence, ag10's 45-file audit,
   mistakes #7's fold sequence. **The plan fails its own standard if any of those still
   reproduces.**
2. **The falsifier for `review.md` §4.6.**
   `rg -n 'matchSimpleGlob|observedWriteScopeContains' src/ | rg -v test`
   returns three consumer sites and one divergent matcher; the behavioural repro compares
   `observedWriteScopeContains({files:[],globs:['web/js/**/*.js']}, 'web/js/app.js')` against
   the inlined regex at `review/core.ts:889`. P2.1's pinned test is that comparison. If the
   trace is wrong the test catches it before any code is deleted. *(Both halves re-run at
   conversion time on 2026-08-09 and held — `review.md` §6.)*
3. **Bootstrap session benchmark.** After P3, and again after P4: one fresh agent session
   performing a full brownfield land on a fixture repo. Metrics borrowed from ag10's honest
   accounting — mistake count, bundle count, manual post-gate steps, minutes-to-first-green-
   review. Baseline from the corpus: 13 / 8 / 3+. **P3 gate: ≤3 bundles, 0 folklore steps.
   P4 acceptance: no companion guide required.**

   **Per D4 this is also P4.4's acceptance test**, replacing the external guide count. It is the one
   measurement in this track that is both in-repo and repeatable on demand, which is why the phase
   with the least machine-checkable deliverable is pinned to it.
4. **Noise floor.** P2 must demonstrably preserve detection: fixtures with planted real
   violations — undeclared source write, scope creep across modules — still produce errors at
   the pre-P2 rate.
5. **Repo hygiene per this repository's own rules.** Canonical skills and packaged mirrors
   change in lockstep; versions synchronized across the four release surfaces;
   `scripts/validate-marketplace.ts` and `validate:cli` green; this index row in
   [../../README.md](../../README.md) updated in the same commit as any status change here.

---

## 7. Decisions

Every question this plan opened was **ratified 2026-08-09** and moved to
[decisions.md](./decisions.md), which carries the reasoning. Summarized here so this section
remains readable alone:

| Decision | Answer | Threaded into |
|---|---|---|
| **D1** | `approved → applied` is structural state *explicitly given*. The tool writes it, and is the **only sanctioned writer**; a hand-written `applied` is a reportable defect. `draft → approved` stays authored. The line is the machine-evaluable precondition. Requires a recorded forced apply (D1.5) and a non-retroactive detection rule (D1.3, D1.4) | P3.1, P3.7 |
| **D2** | The adoption boundary is a **declaration plus a path inventory**; a commit ref is a compression of it where git exists. An unresolvable ref is a named absence, never a silent fallback to drift | P4.2 |
| **D3** | The base commit lives in the change's `run-ledger.xml`, written by `gate approve`. The repository-scoped half of that question belongs to the adoption boundary | P2.3 |
| **D4** | Guide collapse is a `C-*` here, and its acceptance test is the bootstrap benchmark — **not** the external guide count | P4.4, §6 |
| **D5** | `LINKS` / `DEPENDS` split on `[,;\s]+`, colon excluded; unrecognized tokens are errors naming token, separators and families. Plus a standing rule: **making a silent failure loud is not a compatibility break; turning a working state into an error is.** No artifact version bump; P0 stays a minor release | P0.2, P0.3, and the whole track |
| **D6** | P0.8 derives adjudication from **recorded evidence**, never a current-tree query. Fold-time storage of `CalibrationAdjudication` stays; no report-time `evaluateTargetComplete`. Late evidence uses `CalibrationRestatement` + the `backfilled` bucket. Corrects P0.8's wording, which taken literally would break ratified Correction 156 | P0.8 |

D1 widens the reach of the reliability track's F1 and is recorded as its own decision for that
reason. It does **not** overturn A29.2, which constrains the gate and is silent on a separate verb —
see D1.1.

D5.3 classifies every planned conversion against the standing rule. Five need nothing; the sixth —
D1.4's hand-written `applied` — is the one real break, and already carries its own non-retroactive
guard. **Any new check added to this track must be classified the same way before it ships.**

---

## 8. Summary of dispositions

**Accept as-is.** ag1 F-1, F-2 (hardened per its own condition), F-5, F-6, meta-inversion;
generators and schema reference; prescriptive errors and `--explain` surfacing; bundle
exclusion, base-ref attribution, drift credit; MustPass coverage with a waiver element;
author-time marker anchor check; `verification --run`; verdict `--dry-run`; cursor auto-open
(guarded) and `recover`; NaN fix; mode-aware lint; finding severities; approval lexicon;
`graph scan --draft`; adoption boundary and change kind; guide collapse.

**Accept modified.** Lifecycle finish as a separate command and, per D1, the only sanctioned writer
of `applied` — with a recorded forced apply and a non-retroactive detection rule; `plan amend`
whitelisted, ledger-recorded, review-surfaced; adapter export view read-only; no-adapter
preflight as warning; severities instead of profiles; governed-path cheapening instead of
fast-track bundles; the reject-don't-filter sweep instead of three incident fixes;
`--explain` wiring before catalog authoring; `lint --as` bounded to state-pure rules with
absence reporting; F-4 answered by `<MarkerPending>` health reporting rather than a knob or a
widened waiver.

**Defer (§4).** Process grade and commit enforcement; fail-closed detached review;
`MODULE_MAP` auto-rewrite; signed transitions; evidence tiers; guided revert, batch ops,
preview conveniences.

**Reject (§5).** YAML/TOML dual format; `markerEmission` knob; sandboxed gate enforce;
lifecycle-bypass patch bundles; young-project grace period. R6 (leave the glob matchers
alone) withdrawn on evidence.

The through-line is ag1's closing sentence, which all ten reviews converge on: the
load-bearing walls are right; everything here is drywall and signage — plus one missing door,
the adoption path, that keeps getting mistaken for a wall agents have to climb over.
