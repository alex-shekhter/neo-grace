---
id: RM-GOVERNED-PATH
kind: context
status: draft
supersededBy: null
created: 2026-08-09
updated: 2026-08-15
baseline: 6.1.1
targets: []
normative: false
plan: ./plan.md
context: ./review.md
---

# Governed path — decision log

> **Non-normative.** The decisions below are *settled* — argued and ratified by the maintainer on
> 2026-08-09 — but what makes them binding is [plan.md](./plan.md), which encodes them and was
> **approved for execution on 2026-08-09**. This file records what was decided and why, so the plan
> can be reviewed and executed without re-litigating any of it.
>
> The frontmatter above stays `kind: context` / `normative: false` / `status: draft`, matching the
> archived `RM-AGENT-RELIABILITY/decisions.md` precedent: a decision log is explanatory, and the
> plan is the surface that binds. (Raised as contradiction 3 by the P0 derivation pass; the
> frontmatter is precedent, the sentence above was the genuine staleness and is corrected.)
>
> Companion to [review.md](./review.md), which carries the evidence and frames the questions.
> This file answers them.
>
> **These decisions close every question the plan opened.** Q1–Q4 were the plan's own; Q5 was
> raised during their review and is closed by D5. That section of `plan.md` is replaced by a pointer
> here.

| Question | Decision |
|---|---|
| Q1 — is `approved → applied` authored content or explicitly given? | **D1** |
| Q2 — does the adoption boundary support non-git projects? | **D2** |
| Q3 — where does the base ref live? | **D3** |
| Q4 — is the guide collapse a `C-*` here or a docs track? | **D4** |
| Q5 — what does it cost to make a tolerated shape into an error? | **D5** |

Evidence tags: **[verified]** reproduced against `f340a98` · **[reasoned]** argued, not measured.

---

## Recording conventions

This file did not state how it records. Every dispatch re-derived the rules and guessed
differently. The conventions below are what the file already does; they are stated here so
the next brief does not have to guess. They are not findings.

### Append-only versus living

**Findings, decision entries, and discharge annotations are append-only.** A later fact is
another line (or a new `Fn.m`), never a silent rewrite of an earlier sentence. [F85](#f85)
is the rule for findings; [D9](#d9) is the same discipline for ledgers. [F88.2](#f882)
refused to rewrite D18's sequencing sentence in place.

**The [slip register](#slip-register--2026-08-15) and the [named-bundle registry](#named-bundle-registry)
are living boards.** They answer *where the repair is now*. Rewrite the cell when the
location changes. A row that still names a discharged finding as open, or a bundle by a
retired name, is itself the defect.

**The test for a section this file does not yet name.** If the section answers *"what was
observed or decided, and when?"* it is append-only. If it answers *"where is the repair
now?"* it is living. [plan.md](./plan.md) §1 is living (the phase board). This file's
findings are not.

### When an observation is `Fn.m` rather than an extension of `Fn`

Mint `Fn.m` when the new observation shares a subject with `Fn` but is not the same
observation: a new instance of a named trap ([F83.1](#f831)), a correction of a stated
clause ([F88.1](#f881), [F90.1](#f901)), a new measurement that qualifies a behavioural
claim ([F88.2](#f882)), or a second finding that escaped inside a parent
([F88.1.1](#f8811)).

Extend `Fn` — append a paragraph, do not mint a number — when the new sentence is about
that same observation: a discharge, a disposition, a "what this does and does not do"
qualification, or a later count of the same set.

**The test.** If a later brief citing `Fn`'s title would be *wrong* about the new
observation, the new observation is `Fn.m`. If citing `Fn` still names the right defect
and the new text is payment or qualification of that defect, extend `Fn`.

### Where a discharge annotation goes

The discharge line is the last line of the finding it pays (`Fn`), after any later-added
subsections of that finding (candidates, dispositions). It is not moved onto `Fn.m` even
when `Fn.m` is the later correction. `Fn.m` may note that a clause it restated is now
paid; the canonical discharge lives on `Fn`. [F90](#f90) is the worked case: the
discharge sits at the end of F90 after the candidate; [F90.1](#f901) notes the writer
half is paid and does not become the discharge home.

### A finding with two halves

When one finding records two observations and only one is paid, the entry names each
**half** and that half's state. Citing the title as closed is then wrong if any half is a
standing rule or still open; citing the title as open is wrong if the unpaid half is not
an obligation. [F84](#f84) is the first use.

States a half may take: **paid** (name the bundle or decision), **open** (an outstanding
action remains), **stated rule, no action** (the sentence stands and nothing is owed).

### Which document tracks finding state

**[plan.md](./plan.md) §1 is the board** — "the single source of truth for progress"
(`plan.md:66`). A finding is open, half-paid, or closed *there*.

**This file is the record.** Findings and their discharge annotations live here. Read a
finding's last line for whether the defect still exists ([F85](#f85)); do not treat this
file's owed lists as the board.

**[docs/plans/README.md](../../README.md) is the plan index.** It does not track finding
state.

## Findings these decisions rest on

### F1 — No `applied` status in this repository was ever written by a tool. **[verified]**

Measured 2026-08-09 across `.ngrace/changes/archive/`:

- **16 of 16** archived bundles carry `status="applied"` on `plan.xml`.
- **16 of 16** were written by hand. No command that writes `status="applied"` exists — the gate
  surface evaluates and records only (`src/gates/command.ts:15`), and A29.2's repository-wide
  search for a production path that writes that attribute or moves a bundle to `archive/` returned
  none.
- **3 of 16** have no `run-ledger.xml` at all: `C-ABSENCE-VALUE`, `C-ATTEMPT-LOG`, `C-RUN-LEDGER`.
  They predate the ledger feature that `C-RUN-LEDGER` itself introduced.

D1 does not stand without this. Any rule of the form *"an `applied` status must have a
corresponding ledger record"* is retroactively false for every bundle this repository has ever
produced, and would report sixteen violations against its own history on the day it ships.

### F2 — Enforcement against a hand-written status can only be detection. **[reasoned]**

`plan.xml` is a file on disk. Nothing in a CLI's power prevents an agent writing seven characters
into it. This repository already settled the general form of this question by rejecting sandboxed
gate enforcement (`plan.md` §5 R3): a CLI that refuses workspace writes is one shell alias from
being bypassed, and sells a guarantee it does not have.

D1 is therefore written as a detection rule, never as a prevention claim.

### F3 — `splitList` feeds two fields, and no anchor id can contain a candidate separator. **[verified]**

Measured 2026-08-09:

- `splitList` (`src/project-utils.ts:684`) has exactly two callers, both in `parseGovernedFile`:
  `LINKS` (`:496`) and `DEPENDS` (`:508`). Widening it cannot reach any other field.
- Every family in `ANCHOR_PATTERNS` (`src/artifact/types.ts:203–217`) matches
  `^[A-Z]+-[A-Z0-9-]+$`. **No id can contain `,`, `;`, `:`, or whitespace**, so none of the
  candidate separators is ambiguous against a well-formed token.
- `splitList` already strips a surrounding `[...]` and drops `none` case-insensitively. `RM-GOVERNED-PATH` D5 preserves
  both.

`RM-GOVERNED-PATH` D5 rests on the second point: it is what makes widening safe rather than a guess.

### F4 — Bundle authoring is necessarily two-stage. **[verified]**

`src/artifact/grammar.ts:1272` raises `change.plan-requires-approved-spec` when
`location === "active" && planArtifact && specStatus !== "approved"`. **An active `plan.xml` may not
exist beside a draft `spec.xml`.**

So a bundle cannot be authored in one pass: spec is authored and approved, *then* the plan is
authored. `.ngrace/changes/active/C-LEDGER-READ-ABSENCE/` — spec only, no plan — is the normal
intermediate state, not an unfinished one.

**Recorded because the authority got this wrong.** The first authoring task asked for both files in
one pass and for `lint --path .` to be green with both at `draft`, which the grammar forbids. The
executor authored both, refused to flip status, probed and restored, and reported — the correct
behaviour. **Every subsequent bundle in this track is authored in two tasks.**

This is also live evidence for RC-4 (*rules are discovered after they are expensive*): the rule is
enforced in the grammar, documented nowhere an author would look, and cost a round trip. It is
exactly what P1.4's generated schema reference and P1.5's valid-by-construction generators exist to
prevent, encountered by this plan's own execution.

The live check is `src/artifact/grammar.ts:1313–1314` (`change.plan-requires-approved-spec`), not
the `:1272` this entry first cited — that line is now `change.invalid-bundle-id`. The rule is
unchanged. A 2026-08-15 candidate that would revise it sits below; it is not ratified.

#### Decision candidate — co-draft the pair (not ratified)

**Raised by the maintainer on 2026-08-15. Candidate, not a decided rule.**

**The proposal.** `plan new` may write beside a **draft** spec, so the plan-requires-approved-spec
rule becomes a rule about *approval*, not *authoring*. A plan still may not be approved while its
spec is draft. Both approval phrases may be spoken in one turn but remain **two decisions over two
fingerprints**.

The product today forbids the plan from *existing*, not from being *approved*.
`change.plan-requires-approved-spec` at `src/artifact/grammar.ts:1313` tests
`location === "active" && planArtifact && specStatus !== "approved"` and never consults
`planStatus` (read on the next line and unused by this check). That diagnosis is why the
authoring rule is the wrong one, and it is why a candidate about approval rather than
authoring is even coherent.

**What this does not pay.** Co-draft does **not** stop the plan-stage `gate approve` from
duplicating the spec-stage one. [F95](#f95) is not among what this candidate pays. A
`<Decision>` written by `gate approve` carries `gate`, `decision`, `baseCommit`, and
`Requirement` children — no timestamp, no stage, and no identity of the artifact it
permits (`src/gates/ledger.ts:553–584`; the type at `:109–114`). On
`C-CURSOR-TASK-RESOLVER` the two approve `Decision`s are byte-identical including
`baseCommit`. [F81](#f81)'s dated "five" is superseded: [F95](#f95) counted **ten** of 46
archived bundles carrying the pair (2026-08-15). Co-draft keeps two approvals and moves
both into one turn, at which point `baseCommit` is **more** certainly identical, not less.
Without [D18](#d18)'s fingerprint — or any attribute recording which artifact a `Decision`
permits — co-draft as written would *worsen* F95, not fix it.

**Why.** The plan is the spec's most rigorous reader, and the product currently guarantees that
reader arrives only after the spec is immutable — so a spec defect costs a supersede instead of an
edit.

**Evidence, measured on the 2026-08-15 chain.** Of the two supersedes, co-drafting would have
prevented `C-CURSOR-TASK-SENTINEL`'s (an unsatisfiable criterion, found while authoring the plan —
[F83.1](#f831)) and would **not** have prevented `C-CURSOR-TASK-IDENTITY`'s (a write-scope omission
found only when the suite ran — that class needs a walk, not a re-read).

**What it costs.** The ordering that lets a spec constrain a plan rather than co-evolve with it,
and a larger surface under a single approval act immediately after [D19](#d19) narrowed approval to
the current step — habituation is the real risk, and it is the same risk that produced the
self-approval slips. [D19](#d19) is not overturned: two phrases, two fingerprints, even in one turn.

**Shipped checks this would revise**, all of which currently refuse a plan beside a non-approved
spec:

- `change.plan-requires-approved-spec` at `src/artifact/grammar.ts:1313–1314` (active location,
  any plan, spec status ≠ `approved`)
- the `--as` overlay twin at `src/lint/core.ts:153–159` (same code, fired when `asStatus !==
  "approved"`)
- `approvedSpecXml` / `writePlanNew` at `src/grace-generate.ts:94–110` and `:114–131` (throws
  `invalid-arguments` unless the spec file exists and reads `approved`)
- the `plan` command description at `src/grace-generate.ts:227` ("beside an approved spec")

Skill preflight (`skills/ngrace/ngrace-plan/SKILL.md:23–24`) restates the same refusal; it is a
request ([F89](#f89)), not a check.

**Revisable by.** If measurement shows plans bending specs toward implementation convenience,
restore the authoring refusal.

**Sequencing.** This lands as its own bundle — **`C-CO-DRAFT`** — because it revises a rule four
shipped checks close over. [D18](#d18) is a **prerequisite**, not a peer: the fingerprint is the
mechanism that would make the two same-turn approvals distinguishable, and without it the
candidate worsens [F95](#f95). The maintainer's ordering (2026-08-15) is to ship the
criterion-state and fingerprint bundles first and **re-measure whether co-draft still earns
its cost**. That is a sequencing decision, not a deferral. Not created here. Not folded
into `C-APPROVAL-SCOPE`. Not ratified.

### F5 — `<DependsOn>` silently discards the anchor-child form. **[verified]**

The eleventh silent discard, found while reviewing `C-TOKEN-INTEGRITY` and **missed by the sweep**,
which classified `grammar.ts:2012` as justified "empty cleanup before validation."

`readTaskDependencies` (`grammar.ts:2010–2013`) builds its candidate list from the section's own text
plus `dependsOn.children.map((child) => child.text.trim()).filter(Boolean)` — **child text, never
child tag.** Probed directly:

| Authored form | Parsed dependencies |
|---|---|
| `<DependsOn><T-001 /></DependsOn>` | **`[]` — silently nothing** |
| `<DependsOn><Task>T-001</Task></DependsOn>` | `["T-001"]` |
| `<DependsOn>T-001</DependsOn>` | `["T-001"]` |

**Why an author writes the broken form.** `<Satisfies>` in the same task reads child **tags**
(`grammar.ts:1903–1908`) and *raises* for unsupported ones (`:1989–1995`). `DurableScope` and
`AffectedAreas` are anchor-tag lists too. The shipped template
(`skills/ngrace/ngrace-plan/references/change-plan-template.xml:40–42`) shows an empty `<DependsOn>`
directly above `<Satisfies><AC-EXAMPLE-CRITERION /></Satisfies>`. Every neighbouring construct
teaches the anchor form; `DependsOn` alone means something else by it, and says nothing when given it.

**It is live in this repository's own applied history.** Archived
`C-GATE-RECORD-ABSENCE/plan.xml:70–72` declares `<DependsOn><T-001 /></DependsOn>` on `T-002`. That
dependency has never existed. The bundle was gated, applied, and archived with a task-ordering
constraint that silently did nothing.

**This is the sharpest instance of RC-1 in the corpus**: not a malformed token but a *well-formed
construct in the shape the surrounding grammar teaches*, discarded in silence, in the repository that
ships the methodology.

#### F5.1 — The drop silently disables three validation rules, not one declaration

Found by probe while reviewing the site-11 amendment. `validateTaskDependencyGraph`
(`grammar.ts:2031–2078`) keys `change.task-self-dependency`, `change.task-unknown-dependency`, and
cycle detection off the set `readTaskDependencies` returns. An empty set means **every one of those
checks passes vacuously.** Probed through `validateChangeArtifact`:

| Authored | `change.task-*` issues raised |
|---|---|
| `<DependsOn><T-999 /></DependsOn>` — unknown task | **NONE** |
| `<DependsOn><Task>T-999</Task></DependsOn>` — unknown task | `change.task-unknown-dependency` |
| `<DependsOn><T-001 /></DependsOn>` on `T-001` — self-dependency | **NONE** |

So the anchor form does not merely fail to declare an ordering constraint: it **turns off unknown-task
detection, self-dependency detection, and cycle detection for that edge**, silently, while lint
reports green. A plan can declare a dependency on a task that does not exist, or on itself, and the
grammar will not say so — provided the author used the shape every neighbouring construct teaches.

**Consequence for the fix's verification.** `readTaskDependencies` is not exported, so a test
asserting "the dependency is present" has no public surface to assert against. The red-first
regression must go through the **lint surface** instead: assert that `change.task-unknown-dependency`
fires for `<DependsOn><T-999 /></DependsOn>` and `change.task-self-dependency` for the self case.
Both are silent today and both must fire after D7. That test proves more and is actually writable.

### F6 — The gate's own write is reported as unexplained drift, and the fix suggested is a new bundle. **[verified]**

Observed 2026-08-09, seconds after `ngrace gate approve --change C-TOKEN-INTEGRITY` returned
`permit`. The gate wrote `run-ledger.xml`. `ngrace status` then reported:

```
Observed Drift
- Changed files: 1
- Explained by active approved changes: 0
- Unexplained: 1
- unexplained: .ngrace/changes/active/C-TOKEN-INTEGRITY/run-ledger.xml

Suggested Next Action
- Use $ngrace-refresh to reconcile unexplained repository changes through a new
  NgraceChangeSpec and NgraceChangePlan.
```

Two accepted items reproduce here, in this repository, from this plan's own execution:

- **P2.2** — the CLI wrote that file as part of the lifecycle step the operator just ran, and the
  audit reports it as undeclared. Auditing the CLI's own writes against the agent's declared scope is
  a category error, and this is the cleanest possible demonstration: the write and the complaint are
  the same command, one second apart.
- **P2.6** — the recommended remedy is to open **a new change bundle** to explain a file the tool
  itself produced while gating the current bundle. Follow it and the result is a reconciliation
  bundle for nothing. This is the mechanism behind the corpus's *13 mistakes, 8 change bundles,
  3 reconciliation bundles*, caught in the act rather than reported after the fact.

Recorded because it upgrades P2.2 and P2.6 from corpus testimony to a dated, in-repo reproduction
with an exact command sequence. **No action now** — both are P2 items and the phase order stands;
this is evidence, not a schedule change.

### F7 — The approval act is indistinguishable from tampering until it is committed. **[verified]**

Observed 2026-08-09, immediately after setting `plan.xml` to `status="approved"` on maintainer
approval — the sanctioned authored transition (D1: `draft → approved` stays authored).

`collectApprovedContractDrift` (`src/grace-status.ts:589–597`) flags a bundle when spec **and** plan
are both `approved` *and* either file appears in the git-tracked changed set. The approval edit is
itself that change, so `ngrace status` reported:

```
C-TOKEN-INTEGRITY … states=approved-contract-drift

Suggested Next Action
- Hard stop: an approved spec.xml or plan.xml changed. Restore it or supersede and
  replan through a new C-* bundle.
```

**The rule is right and the timing is wrong.** It exists to catch editing an approved plan in place —
corpus mistakes #9 and #11, and the incentive `plan amend` (P3.2) is designed to remove. But it
cannot distinguish *the approval* from *tampering after approval*, so it fires on the legitimate act
during the window between approving and committing.

**The advice is actively harmful in that window.** An agent following it literally would revert the
approval it was just given, or open a superseding bundle for a change that has not started. Both
destroy work; the correct action is simply `git commit`. Verified: committing the approval clears the
state.

**Two consequences.**

1. *For P2.6.* "Honest nextAction" must not be implemented as a blanket *never recommend committing*.
   That rule is right for **unexplained drift** and exactly wrong here — for approved-contract-drift
   arising from the approval itself, committing **is** the honest recommendation. The distinction is
   the state, not the verb.
2. *For P3.1 and E6/RC-3.* "Commit immediately after approving, or status will tell you to undo it"
   is unwritten folklore of precisely the kind `lifecycle finish` exists to eliminate. Approval is
   not currently in that command's scope; whether it should be is a P3 question, recorded here so it
   is asked rather than rediscovered.

### F8 — P0.4 fired during P0's own implementation, and every surface reported success. **[verified]**

Observed 2026-08-09 while executing `C-TOKEN-INTEGRITY` T-001. The executor opened its epoch with:

```
ngrace cursor advance --open-epoch --from T-001 --to T-001
```

`--from` / `--to` are **event id bounds**, not task ids. `Number("T-001")` is `NaN`. The CLI **exited
0** and printed `Epoch 1 opened, state in-progress`. On disk:

```xml
<!-- run/NaN-T-001-opened.xml -->
<NgraceRunEvent graceVersion="1.0" id="NaN" task="T-001" kind="opened">
  <Allocation worker="w0" from="NaN" to="NaN" /></NgraceRunEvent>
```

This is P0.4 — the defect this phase exists to fix — **fired by the agent implementing this phase,
on its first command, from the exact intuition review.md §4.3 predicted** (`--from T-001` is the
natural first guess). It is the strongest possible evidence for the item and it was not staged.

**Every surface then reported health.**

| Surface | Says |
|---|---|
| `cursor advance` | exit 0, "Epoch 1 opened" |
| `ngrace lint --path .` | 0 errors, 0 warnings |
| `ngrace status` | `epochs=0`, state `ready-to-execute` |
| `run.xml` | `<Epoch>1</Epoch> <State>in-progress</State>` |
| `cursor fold` | **"no Allocation found"** — dead end |

Note the two-way inconsistency: `status` reports **zero epochs** while the cursor reports **epoch 1
in-progress**. A corrupt audit trail, and the only surface that says so is the one you cannot reach.

**Confirms P0.4 and P0.6 as specified.**

#### F8.2 — Two authority errors in the paragraph above, corrected by the cursor derivation

Both were written by the authority from reasoning rather than reading, and both are corrected here
rather than rewritten in place. Neither changes the finding; both change where an implementer looks.

1. **The `NaN` file is not dropped at `:470`.** `EVENT_FILENAME` is `/^(\d+)-(T-[0-9]{3})-(.+)\.xml$/`
   (`grace-cursor.ts:437`), and `NaN-T-001-opened.xml` fails `^(\d+)` — so it is discarded by
   `if (!match) continue` at **`:459`**, and never reaches the integer guard at `:470`. There are
   **two distinct silent skips**, not one: the filename regex, and the `id`-attribute guard that
   catches a well-named file carrying a non-integer `id`. P0.4 must address both; citing only `:470`
   would leave the one that actually swallowed the live fixture.
2. **`epochs=0` has nothing to do with the skipped-id logic.** `countLedgerEpochs`
   (`grace-status.ts:211`) counts `Epoch-N` wrappers in `run-ledger.xml` — that is, **folded** epochs.
   It reports `0` for *any* unfolded epoch, corrupt or not. The "third consumer of the same skip"
   claim was wrong.

The scope note it produced survives, for a different and better reason: a field labelled `epochs`
that silently means *folded epochs* misreports every in-progress run, which is a reporting-honesty
defect in its own right. It stays in `C-CURSOR-INTEGRITY` — see D8.8.

**Also corrects an authority error.** The derivation's contradiction 1 was accepted too broadly — see
`review.md` §4.3. Its repro folded immediately after opening, so it hit *"No loose run/ events to
fold"*; the realistic sequence does work first and hits *"no Allocation found"*, exactly as originally
recorded. **A reproduction that omits the work step does not reproduce the workflow**, and the
authority accepted it without noticing.

#### F8.1 — Disposition of the corrupt epoch: do not repair it by hand

The corpus's recorded remedy for this state is `rm -r run/` — deleting the audit trail to satisfy the
audit gate. That is the antipattern, and it is not available here. Neither is hand-writing a
replacement allocation: P0.6 requires the repair be *recorded and ledger-visible*, and a manual file
edit is precisely the folklore this track removes.

**Decision: leave the corrupt epoch in place.** It becomes the acceptance fixture for P0.6's
`cursor recover --fix extend-allocation` — a real corrupt ledger produced by the real bug, rather
than a synthetic one. Consequences:

- **Nothing is blocked now.** `evaluateApplyGate` (`src/gates/core.ts:238`) requires only
  `plan-present` and `review-verdict`; no fold is required. T-002–T-005 proceed normally, and further
  cursor events are valid and will be covered by the eventual allocation.
- **`C-TOKEN-INTEGRITY` must not archive until `cursor recover` exists.** Archiving a bundle whose
  ledger is knowingly corrupt would bury exactly the kind of quiet dishonesty this track opposes.
- **Sequencing changes accordingly:** `C-CURSOR-INTEGRITY` lands before `C-TOKEN-INTEGRITY` closes.
  The two are file-disjoint, so this costs no rework — only ordering.

---

### F9 — The ledger's red-first record is not evidence of red-first, and its own digests prove it. **[verified]**

Observed 2026-08-10 while verifying `C-TOKEN-INTEGRITY` T-002–T-004. Every `attempt` event carries a
`<WriteEvidence>` block digesting each file in `ObservedWriteScope`. Comparing the recorded fail to
the recorded pass:

| Task | fail → pass | implementation file | digest at fail | digest at pass |
|---|---|---|---|---|
| T-001 | ev 2 → 3 | `src/project-utils.ts` | `1b2c38c5f22cae32` | `1b2c38c5f22cae32` |
| T-002 | ev 6 → 7 | `src/artifact/grammar.ts` | `9376220ca2613ead` | `9376220ca2613ead` |
| T-003 | — | `src/artifact/projections.ts` | *no fail attempt recorded* | |
| T-004 | — | `src/artifact/grammar.ts` | *no fail attempt recorded* | |

**In every recorded fail→pass pair the implementation file is byte-identical.** No source change
occurred between the red and the green. For T-002 what changed between the two events was
`grammar.test.ts` and `catalog.ts` — the test, not the fix.

Worse, `9376220ca2613ead` and `609b15d383ac1d50` are the *current worktree* digests. So at event 6 —
the earliest attempt of the session, recorded as T-002's red-first failure — the implementations of
T-002, T-003 **and** T-004 were already complete and final.

**The narrower claim, which is what matters.** This is not a finding that the executor fabricated its
report; the observations it describes may well have happened in its terminal. The finding is that
**the ledger cannot corroborate any of it, while reading as though it does.** The artifact the product
asks people to trust records a sequence that did not occur in the order recorded. That is the thesis
violation — *the agent cannot lie to the model* — committed through a sanctioned CLI, with every
surface green.

Note also that `ngrace-execute`'s red-first rule is, today, an honour-system instruction in prose.
Nothing reads it back.

#### F9.1 — Disposition: leave the ledger, do not stage a retrofit

The tempting repair is to `git stash` the fix, re-run the tests, record a `fail`, and unstash. **That
is forbidden, and for a sharper reason than F8.1's.** A staged red produces a ledger entry
indistinguishable from a genuine one — it would launder the exact defect just discovered into
evidence that looks sound. F8's corrupt epoch is at least honestly broken; a retrofitted attempt would
be quietly false. Nor is `verification-unavailable` right: verification ran.

**Decision: the events stand as written, and the truth lives here.** T-003 and T-004 have no recorded
red; T-001's and T-002's recorded reds are not attributable to a fix. The tests themselves are
genuine and were independently re-run by the authority (137 pass), so the *code* is fine — it is the
*evidence chain* that is not.

#### F9.2 — The product consequence: the check is already possible and simply absent

`WriteEvidence` already records exactly what is needed. The rule is machine-evaluable from data the
tool writes today:

> For a `fail` → `pass` attempt pair on the same task, at least one **non-test** file within
> `ObservedWriteScope` must differ in digest between the two events. If none does, the pass is not
> attributable to a fix and must be reported as unsubstantiated.

This converts red-first from prose discipline into a checked property, and it needs no new recording —
only a reader. **Assigned to `C-CURSOR-INTEGRITY`**, which already owns ledger honesty (P0.4, P0.6,
P0.8) and is already sequenced ahead of this bundle's closure. Severity is a design point for that
bundle; the authority's recommendation is that `ngrace review` raise it as an error, since review is
where evidence is judged, and that `cursor` itself stay quiet — a task legitimately passing first try
must not be harassed at write time.

#### F9.3 — The rule proposed in F9.2 is refuted by the very next task, and must be weakened

T-005 executed one task after F9.2 was written, and produced an **honest** red-first pair:

| Event | Outcome | What changed |
|---|---|---|
| 16 | `fail` | `catalog.test.ts` `fb93cc5603fc554e` — completeness test with an empty allowlist, 164 orphans |
| 17 | `pass` | `catalog.test.ts` `f708df110a50b5b8` — allowlist populated |

**No non-test file changed, because T-005's entire deliverable is a test.** Under F9.2's rule as
drafted, this genuine sequence would be reported as unsubstantiated.

Worse, it is **structurally indistinguishable from T-002's suspect pair**. Both are *"the test file
changed, the source did not."* What separates them is not visible in any digest:

- T-002 claimed to fix a parser defect, so the source *should* have moved and did not.
- T-005 claimed to add a characterization test, so only the test *could* move.

The difference is the task's claim, and no digest comparison can read a claim. **A digest rule alone
cannot separate a characterization test from a moved goalpost.**

**Refinement, and it is a real weakening.** P0.10 raises a *finding requiring adjudication*, not an
automatic failure: when no non-test scope file differs across a `fail` → `pass` pair, `ngrace review`
reports the pair and the reviewer must clear it with a recorded reason. This is the same enforcement
ceiling as R3 and F2 — **detection, not prevention** — and for the same reason: the fact in question
is a human claim about intent, not a machine-derivable property.

What it still buys, and it is not nothing: T-002's pair becomes *visible* instead of invisible. The
authority found F9 by hand-diffing digests across six event files; after P0.10 the tool says it. The
honest case costs one recorded sentence; the dishonest case has to be written down as a lie rather
than simply left unstated. That asymmetry is the whole mechanism.

**Recorded because the sequence matters.** F9.2 was written by the authority, and refuted by evidence
one task later, before a line of it was built. That is the derivation gate working as designed — and
the argument for keeping proposed rules in this document, where reality can reach them, rather than
in the bundle where they would have shipped.

#### F9.4 — The disclosure norm produced a voluntary admission at its first opportunity. **[verified]**

`C-CURSOR-INTEGRITY` T-007, 2026-08-10. The executor reported, unprompted, that its own attempt pair
did not substantiate red-first: the probe against pre-fix code was real and run in a temp project,
but the `fail` **event** was written after `grace-status.ts` already held the fix. The authority
confirmed it against the digests rather than the report:

| Pair | fail | pass | Reading |
|---|---|---|---|
| T-001 (3→4) | `catalog.test.ts` unmodified | modified | genuine |
| T-002 (7→8) | test modified, `grace-cursor.ts` **unmodified** | `grace-cursor.ts` modified | **textbook red-first** |
| T-007 (11→12) | `grace-status.ts` **already modified**, test unmodified | only test modified | the disclosed gap |

`WriteEvidence` lists files modified against `HEAD`, not every scope file — so "absent" means
unmodified at that moment, which is what makes the T-002 pair readable as a clean red-first and the
T-007 pair readable as not one.

**Disposition: leave it, per F9.1.** Re-recording would be staging a retrospective red, which is the
one repair explicitly forbidden. The honest gap costs a sentence; the ledger and this record disagree
with nothing.

**Two things this earns.** First, the norm works: told that an honest gap costs nothing and a
contradiction costs the bundle, an executor volunteered the gap before being asked — which is the
whole mechanism F9.2 was reaching for, obtained without any tooling at all. Second, T-007's pair is a
**third corpus shape for P0.10**, alongside T-002's suspect pair and T-005's honest test-only pair:
a pair that looks exactly like T-005's under a digest rule, and is *not* the same thing. It belongs
in T-006's fixtures precisely because the check cannot tell it from T-005 — that is F9.3's ceiling,
now with a live example on both sides of it.

---

## D1 — The tool is the only sanctioned writer of `approved → applied`

**Decision.** `approved → applied` is **structural state explicitly given**, not authored content,
and `ngrace lifecycle finish` may write it. Further: it becomes the **only sanctioned** writer of
that transition. A hand-written `applied` is a reportable defect, not an equivalent alternative.

`draft → approved` is **unchanged and stays authored.** A human writes it, no command does.

**What separates the two.** Apply has a machine-evaluable precondition and approve has none. The
apply gate already reads the ledger, checks recorded verdicts and must-pass commands, and decides —
so the binary genuinely *derives* the fact "this change's evidence passed." What it cannot derive is
a human saying go, and that is supplied by the operator invoking the command. Approve has no
equivalent: there is nothing for a machine to check, so nothing is derived and nothing is given.

**This asymmetry is deliberate and must stay recorded.** Without the reason above written down, a
later reader sees an inconsistency — one transition tool-written, one hand-written — and "fixes" it
in whichever direction is convenient. The line is the machine-evaluable precondition, not
convenience.

### D1.1 — Relationship to A29.2 and F1 of the reliability track

A29.2 (`../../archive/RM-AGENT-RELIABILITY/plan.md`, Correction 49) states that the transitions are
authored acts and that **the gate** does not set `status` or move the bundle. That holds unchanged.
A29.2 was adjudicating a step that proposed turning gates *into* transition commands; its finding
was that no such commands existed and that gates must not become them. Its worked example is
`draft → approved`, which D1 leaves alone.

A29.2 constrains **the gate**. D1 covers a **separate verb**, which A29.2 is silent on. `ngrace
lifecycle finish` inherits the three properties of the `graph split --apply` precedent that
invariant 8 / F1 was restated from:

- dry-run by default; writes only behind an explicit apply
- writes structural facts only, never authored content
- fail-closed: refuses when the gate does not permit

**This is a widening of F1's reach, ratified here, not an overturning of A29.2.** Recorded as its
own decision precisely so the change is visible rather than assumed inside a phase — which is what
both source plans did.

### D1.2 — Why "only the tool", and what it actually buys

The value of a tool-written status is not that it is harder to forge. It is that it leaves a ledger
record, which creates a durable difference between *"a gate permitted this"* and *"this word
appeared in a file."* If hand-writing remains equally sanctioned, that difference is decorative and
D1 changes nothing observable.

Making the tool the only sanctioned writer is what makes the record load-bearing. It converts an
unenforceable convention into a **detectable** one. Note what this does and does not improve: it
does not stop a dishonest apply — that was never available — it makes one visible afterwards.

### D1.3 — Consequence: a new review finding

Review gains a finding for an `applied` status with no corresponding ledger record.

**This does not exist in any phase today.** If it does not ship, D1 is inert: nothing anywhere would
observe the difference the decision exists to create.

### D1.4 — Consequence: the finding is not retroactive

Per F1, the finding fires **only** where the ledger contains an approve event from the gate surface.
Absent that event the change predates the mechanism, and the correct report is silence — not a
violation, and not a claim that the bundle is suspect.

**Classified under D5.2 as the track's one real compatibility break** — a hand-written `applied` was
not a silent failure, it was the only sanctioned method, so those bundles were correct when written.
The non-retroactive trigger is the migration path that break requires. A check that is correct going
forward and retroactively false is not a check, it is sixteen false positives.

### D1.5 — Consequence: a recorded override is required

`lifecycle finish` gains a forced apply that writes a ledger event naming the apply as forced, with
an operator-supplied reason.

**Not a convenience — a condition of D1 being safe.** If the tool is the only sanctioned writer and
the gate refuses for a bad reason (a host lacking a capability, a wrong check, a bug), the change
cannot be completed at all. Today the agent hand-writes and moves on. Without a sanctioned exit,
people hand-write anyway, and the record is then *worse* than before D1: the same write, no longer
distinguishable from a genuine tooling gap.

The standing posture of this product is **make dishonesty visible, not impossible** — the same
reasoning that rejected sandboxed enforcement (R3) and lifecycle-bypass bundles (R4). A hard "only
the tool" with no recorded override drifts back toward a posture already refused.

---

## D2 — The adoption boundary is a declaration plus an inventory; the commit ref is a compression of it

**Decision.** Yes, the boundary supports non-git projects. The primitive is designed as **a
declaration plus a path inventory**. Where git exists, a commit ref expresses the same thing more
cheaply and more strongly, and is used.

**The design order is the decision.** Building the ref as the primary shape with the inventory as a
fallback means rebuilding at the first non-git project — the exact rebuild Q2 was asked to prevent.
Declaration first, ref as an optimization over it.

**Why an inventory suffices.** The boundary serves four symptoms: the permanent unexplained-drift
nag, review noise from pre-existing files, the first change's unsatisfiable clean baseline, and the
freestyle-land dead end. Every one needs to know *which paths* predate adoption. None needs their
*contents* at that moment. Content hashes would buy only tamper detection, which is deferred
(`plan.md` §4 D4) — so paying for them here buys nothing this track uses.

### D2.1 — An unresolvable ref is a named absence

A commit ref can stop resolving: rebase, squash-merge, force-push, shallow clone. The adoption
boundary is a permanent, once-ever record, so over a few years this is ordinary rather than exotic.

When the ref does not resolve, the boundary reports a **named absence** in the vocabulary the
product already ships (`unable-to-determine` and its siblings). It must **never** fall back silently
to treating everything as unattributable drift — that resurrects precisely the permanent nag the
boundary exists to remove, and does so in the least visible way.

**Cheap insurance, adopted:** record the inventory alongside the ref even where git is present.

---

## D3 — The base commit lives in the change's run-ledger

**Decision.** `gate approve` records the base commit into that change's `run-ledger.xml`, as part of
the approve event.

**Why the tension in the question dissolves.** Q3 worried that the ledger is bundle-scoped while
attribution is repository-scoped. Those are two different questions wearing one name:

| Question | Scope | Home |
|---|---|---|
| What changed since **this change** started? | per change | the change's run-ledger (D3) |
| What predates **governance entirely**? | per repository | the adoption boundary (D2) |

The base commit answers the first, which is per-change by construction — every change has its own.
The second already has an owner in this plan. Nothing is left over.

**Secondary properties.** The ledger archives with the bundle, so `review` still resolves the base
of an archived change. It is a fact the CLI observed rather than a claim the author made, which is
what the ledger is for and what keeps this consistent with gate purity (`plan.md` §3.3).

**Rejected alternative.** A sidecar file beside `plan.xml` buys nothing and costs a new artifact
with its own lifecycle, sitting among authored files while being CLI-written — the exact confusion
the model works to avoid.

---

## D4 — Guide collapse is a change bundle in this repository, measured by the bootstrap benchmark

**Decision.** The work is a `C-*` bundle here. The skill text and the one canonical document both
live in this repository, and skill text is a product change per `CLAUDE.md`.

**The acceptance criterion moves.** It is the bootstrap benchmark already in the plan's verification
strategy — one fresh agent session, a fixture repo, a full brownfield land with no companion
document, counting mistakes, bundles, and manual post-gate steps. It is **not** the external guide
count.

**Why the swap is required, not cosmetic.** Ten brownfield guides are files in another directory,
owned by other people, which shrink or do not on their own schedule regardless of what ships here. A
bundle whose acceptance assertion is about them carries a claim it can never honestly verify — which
is the *documented-but-not-executed* failure this entire plan exists to fix, committed by the plan
itself. Guide count is demoted to an observation recorded afterwards.

The benchmark is also the better test of the same claim: guides shrinking is a lagging indicator of
an adopter not needing one.

---

## D5 — Separators are `,` `;` and whitespace; and a standing rule for what counts as a break

Two halves. The separator set is the immediate answer; the standing rule is what Q5 was actually
asking for, and it settles the rest of the track.

### D5.1 — The accepted separator set

`LINKS` and `DEPENDS` split on **`[,;\s]+`**. The colon is **excluded**. Any token matching no
`ANCHOR_PATTERNS` family is an **error** naming the offending token, the accepted separators, and
the accepted id families. Existing `[...]` stripping and `none` handling are preserved (F3).

**The principle: accept separators that can mean nothing else.** A comma, semicolon or space between
two ids is unambiguous — no author meant anything by it but *next item* — so accepting it discards
no intent. That is the whole test.

**Why the colon is excluded**, having been proposed and considered:

1. **The error is better than the acceptance.** Without the colon in the set, `LINKS: M-A: M-B`
   yields the token `M-A:`, which matches no family and produces exactly the error this phase
   specifies — token named, separators listed, one edit to fix. With the colon in the set, the same
   slip silently works. That is filtering wearing leniency's clothes, in the one phase whose purpose
   is to stop filtering.
2. **A colon there is ambiguous.** It is either a slip or an author reaching for structure the
   grammar does not have. Ambiguous input is what *reject, don't filter* says to reject rather than
   guess at.
3. **Secondary:** the colon is the field delimiter itself (`LINKS:`). Spending a structural
   character on value syntax is cheap now and awkward to walk back.

### D5.2 — Standing rule: what is and is not a compatibility break

Applies to the whole track, not to P0 alone.

> **Turning a silent failure into a loud one is not a compatibility break.** Nothing that worked
> stops working; a failure moves from late and mute to early and explicit.
>
> **Turning a legitimate working state into an error is** a break, and requires an
> `NGRACE_ARTIFACT_VERSION` bump plus a migration path.

The reliability track's invariant — *existing valid `.ngrace` trees must keep validating* — is
satisfied by the first clause, because a tree whose module reports zero implementation and sits
`blocked` was never valid in the sense the invariant protects. It was failing quietly.

### D5.3 — Every planned conversion, classified

| Change | Today | Class | Needs |
|---|---|---|---|
| P0.2 separator widening | green, links nothing | **repair** — green before, green after, and now means what the author wrote | nothing |
| P0.2 unrecognized token → error | green; token dropped, module `IMPL=0`, health `blocked` | silent failure made loud | nothing |
| P0.3 multi-value `DependsOn` | already an error, with a misleading message | strictly more permissive after | nothing |
| P0.4 non-numeric epoch bound | silently writes `NaN`, corrupts the ledger | silent failure made loud | nothing |
| P3.3 must-pass coverage | green; the command never executes | silent failure made loud — **the closest call**, since a project may have deliberately deferred | `<EvidenceWaived>`, already in the plan, **is** the migration path |
| D1.4 hand-written `applied` | green, and was the **only** sanctioned method | **a real break** — those bundles were correct when written | the non-retroactive trigger, already required by D1.4 |

**Consequence: no artifact grammar version bump, and P0 remains a minor release.** The rule
separates the five that need nothing from the one that already carries its own guard.

### D5.4 — Not a break is still not invisible (continues below)

A project with a typo'd `LINKS` has green lint today and red lint after. Philosophically that is a
pre-existing defect surfacing; operationally it is somebody's CI going red on a Tuesday.

Required with P0, therefore: a CHANGELOG entry listing every newly-erroring code, and
`lint --remediate` coverage wherever the fix is mechanical. Visible, but not a version bump.

### D5.5 — The CHANGELOG entry is written in the commit message, not in the file

**[verified] 2026-08-09.** `CHANGELOG.md` in this repository is **generated**, not authored:
`scripts/release-bump.ts:345` runs `conventional-changelog -p conventionalcommits -r 1`, and `:279`
/ `:336` abort the release if the file already contains a block for the target version.

So D5.4's requirement is satisfied by naming every newly-erroring code in the **conventional-commit
body** of the change that introduces it. A hand-written `CHANGELOG.md` edit would be overwritten at
the next bump and can collide with the duplicate-block guard — it is not a smaller version of the
right thing, it is a defect.

**Consequence for every P0 bundle:** `CHANGELOG.md` must **not** appear in `ObservedWriteScope`. The
newly-erroring codes are listed in the commit body instead, and each bundle carries its own codes
rather than accumulating them for a phase-end entry.

---

## D7 — `<DependsOn>` accepts the anchor-child form; the fix reads the tag, it does not raise

**Raised by F5. Ratified 2026-08-09. Binds P0.3.**

**Decision.** `readTaskDependencies` reads a child's **tag** when it matches `ANCHOR_PATTERNS.task`,
its **text** when non-empty, and raises `change.task-invalid-dependency` only when it can resolve
neither. All three authored forms below become valid and mean the same thing:

```xml
<DependsOn><T-001 /></DependsOn>          <!-- anchor child: today silently nothing -->
<DependsOn><Task>T-001</Task></DependsOn> <!-- works today -->
<DependsOn>T-001, T-002</DependsOn>       <!-- multi-value text: P0.3 / D5.1 -->
```

**Why accept rather than reject.** The anchor form is not a mistake to be corrected — it is the
idiomatic GRACE shape, used by `Satisfies`, `DurableScope`, `AffectedAreas`, and every anchor list in
the grammar. The defect is that `DependsOn` alone does not read it. Rejecting would tell authors that
the shape the rest of the grammar teaches is wrong here; accepting fixes the one construct that
disagrees.

**Classified under D5.3 as a repair, not a break.** Under D5.2 a silent failure made loud is not a
break — but this needs no loudness at all. Today `<T-001 />` declares nothing; after D7 it declares
what its author always meant. Nothing that worked stops working, and **archived
`C-GATE-RECORD-ABSENCE` acquires the dependency it has always claimed** rather than lighting up red.

That last point is why the direction matters: raising instead of reading would turn an applied,
gated, archived bundle into a lint error, which is F1's sixteen-false-positives problem again. The
permitted direction has no such cost.

**Scope.** This is **site 11**, added to `C-TOKEN-INTEGRITY` T-002 — the same function P0.3 already
opens. Not deferred, not a follow-up bundle. Fixing at the point of detection is the rule; the
inventory's classification of `grammar.ts:2012` as justified is **corrected to silent discard**.

---

## D6 — P0.8 re-derives from recorded evidence, never from the current tree

**Raised by the P0 derivation pass**, open question 1. **Ratified 2026-08-09.**

### D6.1 — The conflict

P0.8 says: *"re-derive adjudication from the ledger instead of snapshotting it."* Read literally,
that breaks a ratified correction from the previous track.

**A59.2 Correction 156** (`../../archive/RM-AGENT-RELIABILITY/plan.md:8906`) is explicit and is
enforced in code at three places (`src/calibration/report.ts:29–30`, `:169–172`, `:205`):

> Labels and context class are **stored** at fold and never recomputed at report time.

Its argument is load-bearing and survives this plan intact:

> **A corpus whose labels move is not a corpus** — it is a query over present state wearing a
> corpus's vocabulary. The claim is durable; its label is not.

### D6.2 — The conflict is verbal, and resolves

Correction 156 forbids recomputing a label from the **current tree** — `evaluateTargetComplete`
running `lintGraceProject` against present state at report time. P0.8 asks to derive from **the
ledger**, which is recorded, immutable evidence. Those are different operations, and only the first
is forbidden.

**The real defect P0.8 names is upstream of both.** At fold, `evaluateTargetComplete`
(`src/grace-cursor.ts:1087`) hardcodes `runCommands: false` per A5.2, so any change carrying a
`MustPassCommand` adjudicates to `complete: undefined` → `pending`, permanently — even after a
final `--assertions final --run-commands` succeeded. The command evidence exists; nothing ever
consults it, and the frozen label cannot be revisited.

### D6.3 — The permitted shapes

Of the four options the derivation pass offered, **(a) is forbidden and (c) is the answer**, with an
existing mechanism covering the timing gap:

| Option | Verdict |
|---|---|
| (a) report-time re-eval, possibly with `runCommands` | **Forbidden.** Exactly what corr 156 exists to stop |
| (b) fold-time `runCommands` when claims exist | **Permitted but not required.** Changes what fold costs and re-opens A5.2; do not adopt without its own decision |
| (c) record command-run evidence as durable events; adjudicate from those records | **This is the answer.** Fold consults recorded evidence, not a live query. Labels stay stored and immutable |
| (d) treat pre-fix pending snapshots as backfilled/excluded | **Already the ratified mechanism** for the timing gap — see D6.4 |

### D6.4 — When evidence lands after fold, restate; do not recompute

If the final `--run-commands` runs after the epoch folded, fold cannot have consulted it. The
sanctioned path already ships and must be used rather than reinvented:

- **`CalibrationRestatement`** (A61) — a recorded provenance override applied at report time
  **without mutating archives** (`src/calibration/report.ts:177–179`, `:229–231`).
- **Correction 161** — restated/backfilled adjudications land in the `backfilled` bucket, which is
  *visible and never pooled into `included`* (`src/calibration/report.ts:106–109`).

That is the honest shape: the original label stays exactly as recorded, the correction is a separate
recorded fact, and the corpus never silently absorbs a late-arriving pass as though it had been
adjudicated on time.

### D6.5 — Binding constraint on P0.8

**P0.8 must not remove or weaken fold-time storage of `CalibrationAdjudication`, and must not
introduce any report-time call to `evaluateTargetComplete`.** The step's phrase *"instead of
snapshotting it"* is imprecise and is **corrected here rather than rewritten in place**, per this
repository's supersede-don't-rewrite discipline: read it as *"the snapshot must be derived from
recorded command evidence rather than from a `runCommands: false` lint."*

If the bundle's design cannot satisfy P0.8 without touching corr 156's guarantee, **stop and report**
— that is a wall (`plan.md` §3), not a tradeoff to make during execution.

---

## D8 — The cursor derivation is accepted, and its eight open questions are resolved

**Decision.** `p0-cursor-derivation.md` (2026-08-10, measured at `60c752f`) is accepted as the
derivation gate for P0.4, P0.6, P0.8 and P0.10. It found six plan-vs-code contradictions, two of
which are authority errors now corrected in F8.2. Every step is *correct but under-specified* — none
is contradicted at the level of intent, which is why the phase proceeds rather than being re-planned.

### D8.1 — Two bundles, not one

`C-CURSOR-INTEGRITY` takes **P0.4, P0.6, P0.10**; a separate bundle takes **P0.8**. The split is by
surface and by wall: the first three are cursor and ledger honesty (`grace-cursor.ts`,
`review/core.ts`) and sit on the critical path for `C-TOKEN-INTEGRITY`'s archive; P0.8 is calibration
reporting under Correction 156 and is on nobody's critical path. Coupling them would let a schema
question in the calibration corpus block a repair that an unarchivable bundle is waiting on.

### D8.2 — The auto-open worker condition is unimplementable as written, and is corrected

P0.6 says auto-open requires that **no `--worker` was ever recorded** for the change. It cannot be
checked: `advanceCursor:549` writes `options.worker ?? "w0"`, so every opened event records a worker
whether or not the operator passed one. Absence is unobservable.

**Corrected condition: refuse when more than one distinct worker value appears in the ledger.**

The derivation proposed *refuse if worker ≠ w0*, which is over-strict — a run that only ever used
`w3` is still single-controller, and auto-open across one worker's events fabricates nothing. The
property that matters is *one controller*, not *the default name*.

**Residual risk, stated rather than papered over:** a genuinely multi-worker run whose second worker
has not yet emitted looks single-worker, and auto-open would synthesize an allocation that the second
worker later violates. That failure is loud — the out-of-range event is caught by
`validateEventsAgainstAllocations` — so the risk is a late error, not a silent fabrication. Acceptable.

### D8.3 — The `NaN` orphan stays on disk after the fix, and stays diagnosed

It cannot be honestly repaired: the event has no recoverable id, so nothing can extend an allocation
to cover it. `recover` diagnoses it as an unrecoverable orphan, writes a covering allocation for the
valid ids around it, and leaves the file alone. Deleting it would be `rm -r run/` wearing a better
name — the antipattern this step exists to retire.

### D8.4 — Historical pending calibration pairs are forward-fixed only

Three folded epochs (`C-ADOPTION-SURFACE`, `C-PLAN-QUALITY`, `C-REVIEW-LANGUAGE-SCOPE`) are pending
because `MustPassCommand` was never opted into at fold. They stay pending, permanently, and P0.8
documents that rather than repairing it. Relabelling them is precisely what corr 156 forbids: *a
corpus whose labels move is not a corpus.* The fix applies to future folds.

### D8.5 — P0.8 takes shape (c). Shape (b) is not a cost-based fallback

D6.3 already ratified **(c)** — record command-run evidence as durable events and adjudicate from
those records. The derivation's *"(b) is D6-legal if schema cost is high"* misreads it: (b) is
*permitted but not required*, and D6.3 says explicitly **do not adopt without its own decision**,
because it changes what fold costs and re-opens A5.2. Cost is not that decision. If (c) proves
expensive, **stop and report** — the answer may be to accept the cost, and that is the authority's
call.

### D8.6 — P0.10's clearance is a recorded reason, not a cleared flag

Attaching the finding to the gate verdict note keyed by `findingId`, at **warning** severity, is
accepted. The binding part is that **the reviewer's reason is recorded, not merely their clearance**
— a boolean "reviewed" would recreate the hand-written `applied` problem of F1 in a new place. If no
finding-level record can hold a reason, report that before building; inventing ledger schema is the
authority's call.

### D8.7 — Orphan discovery is a parallel reader; `listLooseEvents` keeps its contract

`listLooseEvents` is depended on for *ordered, valid* events. Widening it to return orphans would
push the discrimination into every caller. A separate orphan inventory reads the same directory and
reports what the ordered reader necessarily drops.

### D8.8 — `status`'s epoch count is in scope now, against the derivation's recommendation

The derivation recommends deferring it to a P3 note. **Overruled.** `countLedgerEpochs`
(`grace-status.ts:211`) counts folded `Epoch-N` wrappers only, so a field labelled `epochs` reports
`0` throughout every in-progress run — the misreport that made F8 hard to see. The bundle already
opens this surface, the fix is small, and deferring a known-misleading report to a later phase is the
cascade the standing rule exists to prevent. It ships with P0.4.

---

### F10 — T-005's completeness check has a namespace error and a blind spot, and it blocks P0.10. **[verified]**

Found 2026-08-10 while reviewing `C-CURSOR-INTEGRITY`'s draft spec, by probe rather than reading.
Appending a realistic new review finding to `src/review/core.ts` —

```ts
findings.push({ severity: "warning", code: "review.attempt-pair-unsubstantiated", file, message: "x" });
```

— makes T-005's completeness test **fail**, demanding an exact guide in the **lint** catalog for a
**review** code. Two distinct defects:

1. **Namespace error.** Review findings are not lint issues. They are `ReviewFinding`
   (`review/core.ts:77–90`) with their own vocabulary in `REVIEW_CATALOG`
   (`review/catalog.ts:49`, 13 entries), and `catalog.test.ts` already imports `allReviewCodes` and
   `allGateCodes` to pin the vocabularies apart. The completeness scanner nonetheless routes any
   `review.*` code it sees to `getExactLintIssueGuide`, where it can never belong.
2. **Blind spot, and it is the larger of the two.** All 13 existing review codes are **invisible** to
   the scanner, because `makeFinding(code, file, message, …)` (`review/core.ts:239`) takes the code
   **positionally**, and the scanner only matches `issue|markupIssue|guideIssue(` spans and
   `severity:`/`code:` object keys. The check's coverage of the review namespace is zero. It looked
   sound only because nothing had tripped it.

**This is a defect in the work the authority accepted one commit ago.** The T-005 probe verified that
an unguided *lint* code fails the test — it did — and that result was generalized to codes as such.
The generalization was not tested, and it was wrong.

#### F10.1 — Why it blocks, and the circularity it creates

P0.10 must emit a new review finding code. Doing so trips the test, whose only repair sites —
`src/lint/catalog.test.ts` and `src/lint/catalog.ts` — are inside **`C-TOKEN-INTEGRITY`'s**
`ObservedWriteScope`. That bundle cannot archive until `C-CURSOR-INTEGRITY` lands (rule 7), and
`C-CURSOR-INTEGRITY` cannot stay file-disjoint from it while fixing this. The two block each other.

#### F10.2 — Disposition: `C-CURSOR-INTEGRITY` declares the overlap and fixes it

The overlap is **sequential, not concurrent**: all five of `C-TOKEN-INTEGRITY`'s tasks are complete,
so nothing will write those files under that bundle again. No cross-bundle `ObservedWriteScope`
overlap check exists in the tool, so this is a discipline the authority imposed for orderability —
and the honest way to relax it is to record the overlap and its reason, not to author a third bundle
to route around a scoped fix.

**`C-CURSOR-INTEGRITY` adds `src/lint/catalog.test.ts` to its `ObservedWriteScope`** and repairs both
defects: route `review.*` to `REVIEW_CATALOG` and `gate.*` to the gate catalog, and teach the scanner
`makeFinding`'s positional form so the 13 existing review codes become visible. **Expect that second
repair to surface a backlog** — treat it exactly as T-005 treated the lint backlog: a frozen,
commented allowlist, reported to the authority, not mass-authored.

The spec is amended before approval, not after. Its `AC-ATTEMPT-PAIR-FINDING` currently assumes a new
review code can simply be emitted; that assumption is false at HEAD.

#### F10.3 — The cross-bundle overlap check does exist. F10.2 claimed it did not. **[verified]**

Observed 2026-08-10, the moment `C-CURSOR-INTEGRITY`'s plan was approved. Lint immediately reported:

```
[warning] scope.durable-overlap — C-TOKEN-INTEGRITY overlaps C-CURSOR-INTEGRITY
          durable scope: M-LINT-CATALOG, V-M-LINT-CATALOG.
```

F10.2 justified the carve-out partly on the grounds that *"no cross-bundle `ObservedWriteScope`
overlap check exists in the tool, so this is a discipline the authority imposed."* **That is wrong,
and it was wrong when written.** Two checks exist (`src/artifact/scope.ts`):

| Check | Severity | When it runs |
|---|---|---|
| `scope.durable-overlap` (`:244`) | warning | routine lint, over every approved pair |
| `scope.parallel-durable-overlap` (`:260`) plus an `observedWriteOverlaps` test | **error** | `detectUnsafeConcurrentExecution` — explicit parallel preflight only |

So overlap between approved bundles is reported by default, and overlapping *observed writes* are a
blocking error when two bundles are staged to run concurrently.

**The disposition is unchanged, and better supported than the argument that produced it.** The
overlap is real, authorized, temporary, and now *visible to the tool* rather than only to a reader of
this document — which is the shape this whole track prefers: detection at warning severity, cleared
by a recorded decision. The warning stands until `C-TOKEN-INTEGRITY` archives, and it should stand;
suppressing it would hide a true statement.

**One operational consequence, which F10.2 missed entirely.** The two bundles must **never** be run
as an explicit parallel wave — `detectUnsafeConcurrentExecution` would fail on both the durable
overlap and the shared `src/lint/catalog.test.ts`. Sequential execution is unaffected, and
parallelism *within* `C-CURSOR-INTEGRITY` (T-001, T-002, T-007 are disjoint) is unaffected. It is
only the cross-bundle wave that is forbidden, and it was never planned.

**Pattern worth naming.** Three times now the authority has asserted a fact about the tool from
reasoning and been corrected by running it: the `:470` citation (F8.2), the epoch counter (F8.2), and
this. Every one was cheap to check. The rule this earns: **an authority claim about what the code
does gets probed before it is written down**, exactly as findings do.

---

### F9.5 — P0.10's check would not have caught F9. **[verified]**

Reported by the T-006 executor, unprompted, and confirmed against the digests. Run against
`C-TOKEN-INTEGRITY`'s live ledger, the new rule is **silent on the very pair that produced F9**:

| Pair | Non-test scope files across fail→pass | Raises? |
|---|---|---|
| T-001 (2→3) | `project-utils.ts` identical | yes |
| **T-002 (6→7)** | `grammar.ts` identical — but `src/lint/catalog.ts` **changed** (`c60d764c` → `d5453b31`) | **no** |
| T-005 (16→17) | test-only | yes |

`catalog.ts` is a non-test file in that bundle's `ObservedWriteScope`, so under the rule as specified
the pair *is* substantiated — by concurrent work having nothing to do with T-002's claim.

**Any concurrent non-test change anywhere in the write scope clears the finding.** On a bundle whose
tasks are worked in a batch, that is most pairs.

**This is not fixable inside the rule, and must not be papered over.** Attribution would require the
plan to declare per-task file scope, which it does not; `ObservedWriteScope` is bundle-wide by
design. So the check detects the *shape* — a pair with no production movement at all — and cannot
detect the *instance* where movement exists but belongs to different work. That is the same ceiling
as F9.3, reached from the other side: a digest cannot read a claim, and it cannot read *whose* claim
a change belongs to either.

**What it is still worth.** It fires on this bundle's own T-001 and T-007 pairs, which is the tool
auditing its own construction on the day it shipped. It converts an invisible discrepancy into a
written one wherever the scope is quiet. And the honest statement of its limit is now recorded, so no
one later reads P0.10 as a guarantee that F9 cannot recur. **It cannot make that promise.** Anyone
who wants the stronger property needs per-task scope, and that is a plan-schema change, not a check.

### F11 — The scope audit reports the CLI's own ledger writes as violations. **[verified]**

`ngrace review --change C-CURSOR-INTEGRITY` at HEAD `3c3e4fb` returns 11 findings: 2 real warnings,
1 real error, and **8 errors of the form**

```
[error] review.scope-outside-write-scope — Changed file
        .ngrace/changes/active/C-CURSOR-INTEGRITY/run/27-T-006-attempt.xml is outside
        ObservedWriteScope.
```

Those files are written by `cursor attempt` — by the tool, as required by the execution contract,
during the very task being audited. No bundle declares its own `run/` events in `ObservedWriteScope`,
and none should: the ledger is not authored work. The audit reads working-tree porcelain, so the
noise appears on every pre-commit review and scales with the number of events recorded.

**Consequence, and why it is worth recording rather than shrugging at.** P0.10's new warnings arrived
buried under eight spurious errors about the tool's own writes. A review surface that cries wolf
about its own ledger trains the reader to skim exactly the report this track spent a phase making
trustworthy. Belongs with `C-REPORT-HONESTY` (P0.7, P0.9), which already owns diagnostic honesty.

### F11.1 — One authorized scope exception, and the process note that goes with it

`src/verification/localize.test.ts` pins `allReviewCodes().length` to a literal (`13`, now `14`) and
`excludedReviewCodesForLocalization()` to another (`10`, now `11`). Registering
`review.attempt-pair-unsubstantiated` therefore forces an edit to a file outside this bundle's
`ObservedWriteScope`, or `validate:ci` fails. The edit is two literals; the exhaustive
`admitted !== excluded` invariant is untouched, so nothing is weakened.

**Accepted as an authorized exception**, recorded here rather than by superseding an approved plan
over two integers. `review.scope-outside-write-scope` correctly flags it, and that finding is cleared
by this record.

**Process note.** Writing outside declared scope is a contradiction between the plan and the work,
and the standing instruction is to **stop and report before proceeding**, not to proceed and disclose
after. The disclosure was clear and the write was mechanically forced, so the outcome is fine — but
the order was wrong, and the same order applied to a less forced edit would not be.

**The underlying brittleness is a real defect, not this bundle's to fix**: a test that hardcodes a
catalog's cardinality makes every new review code a cross-cutting edit. It should assert the
partition, not the count.

---

### F12 — Fold requires a terminal event that the execution contract never mentions. **[verified]**

Found 2026-08-10 by the executor running the live ledger repair, which stopped rather than
improvising. After `cursor recover --fix` wrote a valid covering allocation over
`C-TOKEN-INTEGRITY`'s ids 1–19, fold was **still blocked**, with the reason changed from *missing
valid covering allocation* to **`unterminated range for w0`**.

`validateEventsAgainstAllocations` (`grace-cursor.ts:2476–2478`) requires at least one event with
`kind === "terminal"` inside the allocation range. Measured:

- **Six of six** archived bundles carrying a `run-ledger.xml` have a terminal event.
- **`skills/ngrace/ngrace-execute/SKILL.md` mentions "terminal" zero times.**
- `cursor advance --kind` accepts it (`opened|progress|pause|resume|terminal`), documented only in
  the CLI help string at `:2993`.

So the event is mandatory to close an epoch, present in every bundle that ever closed, and absent
from the document agents are handed as their execution contract. **This is the third instance of
RC-4 in this track** — after F4 (`change.plan-requires-approved-spec` enforced in the grammar and
documented nowhere an author would look) and the `--from`/`--to` bounds of F8. The pattern is now
well past coincidence: *the rules of this system are discovered by hitting them.*

**The terminal is correctly not `recover --fix`'s job.** Emitting one asserts that an epoch's work is
finished, which is a judgment about the work, not structural state the binary can derive — A29.2
puts it on the authored side. `recover`'s help scopes `--fix` to the covering allocation and is
accurate. The defect is the missing instruction, not the missing automation.

#### F12.1 — The acceptance test proved "fold succeeds" on a fixture more favourable than the artifact

`AC-RECOVER-FIX-PRESERVES-ORPHAN` promises that after `--fix`, *"fold succeeds for that valid
stream."* The test asserting it (`grace-cursor.test.ts:1907`) seeds
`seedF8Shape(root, { validIds: [1, 2, 3], withTerminal: true })`. **The fixture is given a terminal;
the real ledger it was built to repair has none.** The test is green and the claim does not hold on
the artifact.

Nothing here is fabricated — `--fix` does exactly what it says, and the orphan-survival
post-condition (the criterion's hard part) holds on the real ledger. But the criterion's *other*
clause was demonstrated only under a condition the real case does not satisfy, and **no one checked
it end-to-end against the artifact the bundle was named for.**

**Including the authority.** After T-003–T-005 landed I ran `recover` against the live ledger, saw a
correct diagnosis, and reported that `--fix` "would cover ids 1–18, leave the orphan, and unblock
fold." The first two are true. The third I asserted from the test rather than from the artifact, one
step short of the check that would have caught it — and one commit after writing F10.3's rule that an
authority claim about the code gets probed before it is written down.

**The lesson is narrower and sharper than "test against reality":** a fixture option named
`withTerminal: true` is a *recorded decision that the happy path needs something*, sitting in the
test file, unexamined. When a fixture takes an option to make an assertion pass, the option is a
question — *what is true of the fixture that may not be true of the subject?* — and this one had an
answer nobody asked for.

**Disposition.** No code change. Emitting the terminal is the operator's act, and both bundles get
one before fold. The documentation gap goes to P1 (the authoring/execution surface), where RC-4 is
already the phase's subject.

### F13 — `recover --fix` writes an allocation that can never be terminated. **[verified]**

Found 2026-08-10 when the executor emitted the terminal F12 identified and fold was **still** blocked.
Reproduced by the authority in a temp project rather than reasoned:

```
fix #1            → allocation w0:[1,4]   blocked: "unterminated range for w0"
terminal at id 5  → lands outside [1,4]
fix #2            → allocations w0:[1,4], w0:[1,6]   still blocked: "unterminated range for w0"
```

**The mechanism.** `writeCoveringOpened` (`grace-cursor.ts:736–751`) sets
`to = Math.max(options.to, openedId)` — the allocation's upper bound is **the covering event's own
id**, with no headroom. A terminal must be *inside* an allocation
(`validateEventsAgainstAllocations:2475–2478`), and it can only be written *after* the fix, so it
necessarily lands outside. Validation loops **per allocation**, so a second covering opened does not
help: the first allocation stays unterminated forever.

**Therefore `recover --fix` cannot produce a foldable ledger on any bundle that does not already
contain a terminal inside its pre-fix id range.** The feature does not do the thing its acceptance
criterion says it does.

`C-CURSOR-INTEGRITY` is unaffected only by luck: its epoch was opened with the CLI default
`to = from + 98`, so its terminal at id 33 fell inside `w0:[1,99]`. Headroom is what makes the
difference, and only the default path has any.

#### F13.1 — What hid it, and what it costs

**`seedF8Shape(..., { withTerminal: true })` places the terminal inside the pre-fix valid id set.**
The fixture therefore satisfies the one condition that makes `--fix` work, and the assertion
*"fold succeeds"* passed on the only shape where it could. F12.1 called this "a fixture more
favourable than the artifact"; that was too gentle. **The option did not merely flatter the test — it
supplied the precondition the feature cannot establish for itself, which is exactly the thing the
test existed to prove.**

**`AC-RECOVER-FIX-PRESERVES-ORPHAN` is not met.** Its orphan-survival clause holds on the real ledger
— that half is genuine and verified. Its *"fold succeeds for that valid stream"* clause does not.
`C-CURSOR-INTEGRITY` is therefore **not complete**, and must not be applied or archived on the
current implementation.

**The executor's proposed option (a) — re-run `--fix` — would have failed and left a junk allocation
in a live ledger.** It stopped and asked instead. Two stops in two turns, both correct, both against
an instruction that permitted continuing; the standing "stop and report on any deviation" rule is
earning its cost.

#### F13.2 — Disposition

The remedy is a code change, and the approved plan for `C-CURSOR-INTEGRITY` has eight complete tasks
and no room for a ninth — approved plans are immutable. **Precedent applies:** when
`C-TOKEN-INTEGRITY` T-005 shipped a defective completeness check (F10), the repair went into the
*next* bundle with a recorded `ObservedWriteScope` overlap (F10.2). The same shape holds here.

A small bundle takes the fix — allocation headroom on the covering opened, or an in-place extend that
matches the `extend-allocation` flag's name — plus the regression the current fixture could not
provide: **a shape with no terminal anywhere, fixed, terminated, and folded end to end.** It declares
an overlap on `src/grace-cursor.ts` with `C-CURSOR-INTEGRITY`, which is code-complete.

**Sequencing consequence, and it is a chain.** `C-TOKEN-INTEGRITY` cannot fold until this lands;
`C-CURSOR-INTEGRITY` cannot archive until its own AC holds. Nothing archives until the fix ships.
That is the correct outcome and not a reason to relax anything: the alternative is archiving a bundle
whose acceptance criterion is known to be false, in the track whose entire subject is that the
artifact must not lie.

---

## D9 — Ledger repair is append-only; a recorded event is never rewritten

**Decision.** `recover --fix` may **append** records. It may **not** rewrite a recorded event file in
place. Where a dead allocation must be superseded, the repair records a new, ledger-visible fact that
supersedes it; it does not edit the old one.

**Why, concretely rather than by taste.** Attempt events digest prior `run/` event files into their
`<WriteEvidence>` — verified: `C-CURSOR-INTEGRITY` event 28 carries digests for
`run/26-T-006-progress.xml` and `run/27-T-006-attempt.xml`. **Event files are attested artifacts.**
A repair that rewrites one falsifies every attestation referencing it, silently, in exactly the
evidence chain P0.10 was built to read.

**Stated precisely, because the instance does not force the rule.** In `C-TOKEN-INTEGRITY`'s ledger
today, `19-T-005-opened.xml` is referenced by nothing — the terminal at id 20 carries no
`WriteEvidence`, and no attempt followed it. Rewriting it would falsify no existing digest *here*.
The rule is principled, not compelled by this case: the fix must be correct for ledgers where the
allocation *is* attested, which is the normal shape.

It also sits on the right side of A29.2. Appending a superseding fact is recording; editing a prior
record is authoring over history.

### D9.1 — `extend-allocation` keeps its name, and becomes true

The flag claims an operation the code does not perform (it always writes a new covering opened, never
extends). The executor recommended making it genuinely extend, which under D9 cannot mean in-place
mutation. **It can mean the honest thing: extend the *effective* allocation by appending a superseding
record.** The logical range extends; the record set only grows.

So the resolution is neither a rename nor a rewrite: **keep `extend-allocation`, and make the
effective covering range actually extend.** `AC-FIX-FLAG-HONESTY` is satisfied by the name and the
behaviour agreeing, which this does.

**What the plan still chooses.** How supersession is expressed and how fold derives the effective
allocation set — a superseding `opened`, an explicit supersedes reference, or a validation rule that
reads the newest covering allocation as authoritative. **One constraint on that choice:** a design
that makes fold ignore unterminated ranges generally would delete a real check. The older range must
stop mattering because it was *superseded*, not because termination stopped being required.

#### F9.6 — The recurring red-first gap is structural, not carelessness

Third occurrence, `C-RECOVER-FOLDABLE` T-002 and T-003: the executor wrote failing tests for all
three tasks, ran **one** suite, recorded a single `fail` attempt against T-001, and then had only
`pass` attempts to record for the other two. Disclosed voluntarily, as in F9.4.

The pattern across three bundles is the same and the cause is now clear. **`cursor attempt` attributes
an outcome to exactly one task, and a test suite covers many.** When one `bun test` run turns seven
assertions red across three tasks, the ledger can honestly own that red for one task only. The other
two are not lazy omissions — there is no honest event to write, because the run that failed was not
theirs alone.

This is **F9.5's limitation seen from the producer side.** F9.5 found that a bundle-wide
`ObservedWriteScope` cannot attribute a digest change to a task's claim. The same missing attribution
appears here: a bundle-wide verification run cannot attribute a failure to a task's claim either.
Both are the same absent concept — **per-task scope** — and neither is fixable inside the check.

**No disposition beyond recording it.** Fabricating per-task reds by splitting one suite into three
staged runs would produce three ledger entries that look better and mean less. The honest gap, stated
each time, is the correct output of the current model. If a later phase wants per-task attempt
attribution it needs per-task verification scope in `plan.xml` first — a schema change, and the same
prerequisite F9.5 named.

#### F9.7 — A task with no recorded `fail` is invisible to the check

`ngrace review --change C-RECOVER-FOLDABLE` returns **0 findings**, while two of that bundle's three
tasks (T-002, T-003) have `pass` attempts and no `fail` at all — the very gap F9.6 describes.

The audit pairs a `fail` with the `pass` that follows it. **No fail, no pair, no finding.** Recording
only a pass does not defeat the check; it never engages it.

That is not per se wrong — F9.2 chose to leave `cursor` quiet at write time precisely because a task
may legitimately pass first try, and harassing that case would make the tool a nuisance. But it means
**a zero-finding review is not evidence that red-first happened.** It is evidence that no recorded
fail→pass pair lacked production movement, which is a much smaller claim.

**Recorded because the number will be read as a clean bill of health otherwise** — the exact "silence
read as evidence" failure this track exists to remove. In `C-RECOVER-FOLDABLE`'s case the only record
that T-002 and T-003 had no red is the executor's voluntary disclosure and F9.6. The tool says
nothing.

Completing the picture of what P0.10 does and does not see:

| Case | Detected? |
|---|---|
| fail→pass, no production movement | **yes** — the finding |
| fail→pass, production moved for unrelated concurrent work | no (F9.5) |
| pass only, no fail recorded | no (this) |
| no attempts at all | no |

Three of four blind. The check is worth having — it caught four real pairs across two bundles — but
its coverage claim is narrow and now written down.

### F14 — The archive gate reports `run/ empty` when it is not. **[verified]**

`evaluateArchiveGate` (`src/gates/core.ts:352–366`) requires `no-open-epoch`, computed as
`listLooseEvents(bundlePath).length === 0`, and records the detail string `run/ empty`.

After `C-TOKEN-INTEGRITY` folds, its `run/` will contain exactly one file: `NaN-T-001-opened.xml`.
`listLooseEvents` cannot see it — the filename fails `EVENT_FILENAME` and is skipped at `:459`, which
is F8.2's first silent skip. **So the gate will permit, and its recorded requirement detail will say
`run/ empty` while a file sits in that directory.**

The *outcome* is the one we want: the bundle archives with its corrupt event preserved. But it is
reached by a blind spot rather than by design, and the durable record will carry a false statement
about the filesystem into the archive.

**Disposition: proceed, and record the sentence rather than the silence.** The archive is correct;
the wording is not. `C-REPORT-HONESTY` (P0.7, P0.9) owns diagnostic honesty and takes this: the
detail should distinguish *no foldable events* from *empty directory*, and should name any orphan it
is stepping over — `recover` already has that inventory (T-003).

Recorded before it happens so the executor does not stop on it, and so nobody later reads
`run/ empty` in an archived ledger as a description of the disk.

#### F11.2 — The noise stopped being cosmetic and blocked a close

F11 recorded eight spurious `review.scope-outside-write-scope` errors. During
`C-TOKEN-INTEGRITY`'s close it produced **23**, and the executor correctly stopped rather than
record a verdict against a 25-finding review it could not account for.

Every one of the 23 is lifecycle state, not authored work: `run-ledger.xml` and `run.xml` written by
`cursor fold`, twenty `run/` events *deleted by that same fold*, and one uncommitted authority
document. The audit reads working-tree porcelain, so a fold — which by design writes the ledger and
removes the events it folded — guarantees a burst of errors proportional to the epoch's size, in the
review that immediately precedes the verdict.

**The cost is now concrete.** F11 called this "a review surface that cries wolf about its own
ledger"; the sharper statement is that **the tool's own required workflow produces errors in the
audit that gates the next step of that same workflow.**

**Disposition: commit the fold before reviewing.** On a clean tree the same review returns exactly
the two attempt-pair warnings — verified. So the verdict is recorded against a genuine clean review
rather than against a note explaining away noise, which was the alternative and the worse one: an
archived `pass` beside 23 unexplained errors is precisely the unexplained-gap shape this track
removes.

That makes commit-before-verdict the standing close sequence: **fold → commit → review → verdict →
apply → author status → archive → move → commit.** It is more commits and each one is legible.

The underlying defect still belongs to `C-REPORT-HONESTY` (P0.7, P0.9): the scope audit must exclude
the bundle's own ledger artifacts, which are written by the CLI under the execution contract and are
not authored work by any reading.

### F15 — Two surfaces disagree about the same directory, and D8.8's fix caused it. **[verified]**

After archiving, `ngrace status` reports `C-TOKEN-INTEGRITY … epochs=1 open=1` — an **archived**
bundle with an open epoch. The archive gate had just permitted the close with the requirement detail
`run/ empty`. Both statements describe `archive/C-TOKEN-INTEGRITY/run/`, which contains exactly one
file.

Two definitions of *loose event*, in two surfaces:

| Surface | Implementation | Sees the orphan? |
|---|---|---|
| `evaluateArchiveGate` (`gates/core.ts:354`) | `listLooseEvents` — skips names failing `EVENT_FILENAME` | **no** → `run/ empty` |
| `countOpenEpochs` (`grace-status.ts`) | `readdirSync().filter(endsWith(".xml"))` | **yes** → `open=1` |

**This is F8's original defect reproduced by the fix for it.** F8 was recorded because `status` said
`epochs=0` while the cursor said epoch 1 in-progress — *"a corrupt audit trail, and the only surface
that says so is the one you cannot reach."* D8.8 corrected that by making open epochs visible, and
the new counter reads the directory raw while every other consumer reads it through `listLooseEvents`.
The disagreement moved rather than closed.

**The gap is the authority's.** D8.8 was an overrule of the derivation's recommendation to defer, and
the criterion I wrote — *"status distinguishes folded epoch count from open (unfolded) epochs"* —
never said **what counts as an open epoch**. The executor picked a reasonable reading; nothing in the
spec made it agree with the gate. A criterion that names a distinction without defining its terms
gets two implementations, and this one got exactly that.

**Disposition: `C-REPORT-HONESTY` (P0.7, P0.9), with F11 and F14.** All three are the same family —
a surface stating something about the ledger that another surface contradicts — and they should be
fixed as one: **a single definition of loose-event membership, shared by `status`, the archive gate,
and `recover` diagnose**, with orphans reported as orphans everywhere rather than counted by one
reader and invisible to another.

Nothing is blocked. The archive is correct, lint is clean, and the orphan is preserved. What is wrong
is the sentence each surface tells about it.

### D6.6 — D6.4's restatement path cannot lift a `pending` label, and that forces D8.4 rather than choosing it

Found by the P0.8 derivation, confirmed against the types. **D6.4 names `CalibrationRestatement` as
the sanctioned path for evidence arriving after fold.** But the type carries no outcome:

```ts
export type CalibrationRestatement = {
  changeId; epoch; adjudicatedAt: "backfill"; reason?; authoringChangeId;
};
```

A restatement overrides **`adjudicatedAt`**, nothing else, and `report.ts` keeps a pending pair
pending *"regardless of `adjudicatedAt` (A7.2)"*. So a restatement can move a pair whose stored
adjudication already holds a boolean into the `backfilled` bucket — which is what happened to
`C-CALIBRATION` — but it **cannot turn `pending` into `pass`.**

**This does not change D8.4; it explains it.** The three historical pendings are forward-fixed only
because **no sanctioned mechanism exists to do otherwise**, not merely because relabelling would be
distasteful. Correction 156's guarantee is enforced by the type, not just by the rule.

**Recorded because D6.4 reads as an available remedy and is not one for this case.** A later author
reaching for it on a pending pair will find it does nothing, and should find this note first.

**Consequence for P0.8's design, and it is the decisive one:** the fix must ensure evidence exists
**before** fold adjudicates, because after fold there is no honest path to a boolean. That closes the
derivation's Q2 by itself — an outcome-carrying restatement would be a new mechanism for moving a
stored label after the fact, which is precisely what corr 156 forbids.

---

## D10 — Calibration claims are never added after the outcome is known

**Decision.** `claimedConfidence` is recorded during execution, before the outcome is known, or it is
not recorded at all. **A claim may never be added to an epoch after its work is complete**, including
to make a new adjudication path exercisable on real data.

**Raised concretely.** `C-CALIBRATION-COMMAND-EVIDENCE` built the fold join that adjudicates from
recorded command evidence, and its own epoch carries no `claimedConfidence` — so `doctor` still reads
**2 included, 0 excluded, 3 pending, 1 backfilled**, unchanged, and the new path is exercised only by
tests. The executor asked whether to add a claim so this epoch would become the first joined
adjudication.

**Why not.** A calibration corpus is worth exactly what its claims cost to make. A claim written
after the work is finished and green costs nothing and predicts nothing — it is a record of certainty
dressed as a forecast. That is Correction 156's harm moved one step earlier: *a corpus whose labels
move is not a corpus*, and neither is one whose **claims** are backfilled.

The unchanged `2 / 0 / 3 / 1` is the **correct** number. The first real entry arrives when a bundle
genuinely records confidence before knowing how it turns out, and that is worth waiting for.

**Corollary for future demos:** a new adjudication path is proven by tests over fixtures, never by
manufacturing corpus entries. If a path cannot be demonstrated without a fabricated claim, it is
demonstrated by the fixtures and reported as such.

#### F9.8 — A fourth cause of the red-first gap: batched tool calls

`C-CALIBRATION-COMMAND-EVIDENCE` T-001 and T-002 both disclosed that the `fail` attempt was recorded
**in the same tool batch as the production writes**, so the `WriteEvidence` digests cannot separate
before from after. The test-runner red was genuinely observed (5 fails, then 6) — the ledger just
cannot witness it.

This is a **different cause** from F9.6's, and both matter to whoever fixes attribution later:

| Cause | Why the ledger cannot corroborate |
|---|---|
| F9.6 — one suite spans several tasks | the red belongs to no single task |
| **F9.8 — fail event and fix land in one batch** | the digests snapshot after both |

Neither is carelessness, and the disclosure norm has now produced a voluntary admission on **five**
consecutive occasions. That is the mechanism working. What it also shows is that honest red-first
recording is **harder than the rule makes it sound**: it requires the attempt to be written in its
own round trip, before the edit that follows it — an ordering constraint the execution contract never
states. That belongs with F12's documentation gap in P1.

### F16 — `detectConfidentlyWrong` ignores a ratified reading, and calls a true claim false. **[verified]**

`ngrace review` reports a standing **error**:

```
[error] review.confidently-wrong .ngrace/changes/archive/C-RECOVER-FOLDABLE/plan.xml —
        MustExist claims .ngrace/changes/active/C-RECOVER-FOLDABLE/spec.xml which is not
        present on disk.
```

**The first reading was wrong, and the correction matters.** The authority initially recorded this as
a plan authoring a claim that becomes false on archive. It is not: **Correction 171 already ratified
the opposite reading.** `expandScopePathsForArchiveIdentity` (`review/core.ts:846`) states it plainly
— *when the plan resolved from `archive/<id>/`, declared paths under `active/<id>/…` name the same
bundle artifacts now living under `archive/<id>/…`*. Under that reading the assertion is **true**: it
names the bundle's own spec, which exists, at the location the bundle now occupies.

**The defect is entirely in the reader.** Corr 171's expansion is applied to `ObservedWriteScope` and
**not** to `MustExist` targets, which `detectConfidentlyWrong` (`:391–411`) checks with a bare
`existsSync`. The same declared path is read one way in one audit and another way in the next.

Measured across the archive: exactly one bundle names its own `active/` path inside `MustExist`,
`C-RECOVER-FOLDABLE`; the rest name their own files only in `ObservedWriteScope`, where the expansion
catches them. So the inconsistency was invisible until a plan used the other section — **habit hid a
reader gap, and the first plan to break the habit exposed it.**

**Disposition — `C-REPORT-HONESTY`, with F11, F14 and F15.** Apply corr 171's expansion to `MustExist`
targets. That resolves every instance at once, retroactively and without editing a single archived
file, which is the property that makes it the right fix. Do not edit archives. Do not suppress.

**Consequence for the close in progress:** archiving `C-CALIBRATION-COMMAND-EVIDENCE`, whose plan
carries the same assertion, adds a second instance of the reader's error — not a second false claim.
Both clear when the reader is fixed. That is materially different from F8.1's refusal to archive a
knowingly corrupt ledger, where the artifact itself was wrong, and the close proceeds.

**The authority's error is worth keeping.** Reading a tool's complaint as evidence that the artifact
is wrong is the natural move, and here it was backwards: a ratified correction said the artifact was
right and one audit had not been taught it. *A finding names a disagreement, not a culprit.*

#### F12.2 — The terminal-event count in F12 was invented, and the authority's error has a shape

F12 claimed *"six of six archived bundles carrying a `run-ledger.xml` have a terminal event."*
Measured now: **10 of 17**. Seven archived ledgers have no terminal at all.

**How the wrong number was produced.** The authority ran a `grep -c` over archived ledgers, piped it
through `grep -v ":0" | head`, counted the six rows that printed, and reported them as *six of six*.
**The denominator was never measured.** A command that lists only matches cannot report a ratio, and
a `head` makes even the numerator provisional.

**What survives and what does not.** F12's substance stands: a `terminal` is required to fold
(`validateEventsAgainstAllocations`), the execution contract never mentions it, and the gap was hit
live, twice, by executors following that contract. **The universality claim does not** — *"present in
every bundle that ever closed"* is false. The seven without one almost certainly predate the fold
path or were closed by hand, consistent with F1's finding that 16 of 16 archived bundles carried a
hand-written `applied` and three had no ledger at all.

**The shape of the authority's errors is now specific enough to act on.** F10.3 already set the rule
— *an authority claim about what the code does gets probed before it is written down.* Every
violation since has been the same narrower mistake: **a numerator observed and a denominator
assumed.** The `:470` citation, the `epochs=0` attribution, the cross-bundle overlap check, the
pending count, and this one all took a partial listing for a complete population.

**The sharpened rule: never report a ratio, a count, or an "every" from a command whose output was
filtered or truncated.** Measure the denominator with its own command, or state only what was
actually seen. A finding that says *"six rows matched"* is worth more than one that says *"six of
six"* and is wrong.

This one was caught by the derivation agent, reading a prompt in which the authority had repeated the
bad number.

---

## D11 — F12 and F9.8 are not deferred; the P1 assignment was filing, not justification

**Decision.** The two execution-contract documentation gaps get their own small bundle **now**,
file-disjoint from `C-REPORT-HONESTY`. They are not held for P1.

**The deferral was challenged and did not survive.** The authority assigned F12 (a `terminal` event
is required to fold and `ngrace-execute/SKILL.md` mentions it zero times) and F9.8 (honest red-first
requires the `cursor attempt` written in its own round trip, before the edit that follows) to P1
because P1's heading reads *"the authoring surface: diagnostics, generators, skills."* **That is
topical filing.** The standing rule is that nothing is deferred without strong justification, and
adjacency to a phase title is not a justification.

**The one argument that could have justified it fails on reading.** P1.10 says *"skills stop
restating formats… and spend their words on workflow."* F12 and F9.8 **are** workflow content — P1.10
is the step that would *add* them, not one that would rewrite them away. There is no rework to avoid.

**Two facts against waiting:**

1. **The gaps are expensive now.** Every executor prompt since their discovery has hand-carried both
   rules, because the contract the executor is handed does not contain them. That recurring cost is
   the measurement.
2. **They are upstream of this phase, not beside it.** F9.8's gap *produces* the unsubstantiated
   attempt pairs P0.10 was built to detect; F12's gap blocked a live close and cost a round trip.
   Documenting them removes a defect source. Deferring them keeps generating findings — five
   disclosed instances of F9.8's gap so far.

**And "P1 will handle it" currently means unscheduled**: P1 has no derivation and no bundle. A
deferral to an unplanned phase is a deferral to nowhere, which is the shape the standing rule exists
to refuse.

**No supersede is required.** `C-REPORT-HONESTY`'s approved spec lists them as NonGoals, and that
stays true — they are out of *that* bundle, in their own. `M-SKILLS` is disjoint from its six
modules, so both proceed without overlap. The new bundle must also update the packaged mirror under
`plugins/ngrace/skills/ngrace/`, which `validate-marketplace.ts` checks for drift.

**Recorded as a rule, not just a reversal:** when a finding is assigned to a later phase, the
justification must be a *dependency or a conflict*, never a topic match. If the later phase would
have to write the same words anyway, the assignment is a delay with no benefit.

### F17 — Skill text has two derived measurements, and no skill-touching plan has ever declared them. **[verified]**

`C-EXECUTION-CONTRACT` added a `<cursor_kinds>` block to `ngrace-execute/SKILL.md` and immediately
broke two things outside its `ObservedWriteScope`:

| File | What it holds | Blocking? |
|---|---|---|
| `src/test-support/token-accounting.test.ts` | `RM-AGENT-RELIABILITY` D15's skill-line budget, pinned at `730` | **yes** — `validate:ci` fails |
| `README.md:286` | a published measurements table stating **730 lines** | no — and worse for it |

**The first is not a brittle test and should not be filed with F11.1.** `RM-AGENT-RELIABILITY` D15's pin is a *deliberate
budget ledger* for skill footprint, carrying a comment history of every phase that moved the number
(`636 → 648 → 650 → 651 … → 730`). Bumping it with a reason is the designed workflow, not a
workaround. The defect is only that the plan did not anticipate a step the repository has taken nine
times before.

**The second is the one that matters.** A published README table asserting `730 lines` is a claim to
users, and it is false the moment this bundle lands. It is not CI-blocking, which is precisely why it
would have survived — *"not blocking"* is how a false number stays published. D11 rejected exactly
this reasoning one bundle ago: **not-blocking is not a justification, it is a description of who will
notice.**

**Disposition — both edited now, as authorized scope exceptions** (F11.1's precedent). Neither is
discretionary: one fails CI, and the other publishes a wrong measurement. Recording the exception is
honest; leaving either is not.

**The durable rule, which is what this finding is for:** *skill text has derived measurements.* Any
bundle that changes a `SKILL.md` must declare `src/test-support/token-accounting.test.ts` and
`README.md` in `ObservedWriteScope`, and update both with a reason. That belongs in plan review as a
standing question — **what else states a fact about the thing I am changing?** — which is F16's
lesson (*an assertion is a claim with a lifetime*) reaching a second surface.

#### F9.9 — A non-`src/` deliverable can never substantiate an attempt pair

`C-EXECUTION-CONTRACT` T-001 raised `review.attempt-pair-unsubstantiated` despite following F9.8's
ordering exactly: the `fail` was recorded in its own round trip, before any skill edit, and both skill
trees moved between `fail` and `pass`. The executor's self-check called the pair substantiated. It was
wrong, and so was the reasoning behind it.

`isSubstantiatingPath` (`review/core.ts`) is:

```ts
if (isTestPathForAttemptPair(n)) return false;
return n === "src" || n.startsWith("src/");
```

**Skill files live under `skills/` and `plugins/`.** They are not substantiating paths, so the only
one this bundle had was `src/grace-cursor.ts` — which carried the export and was therefore identical
across the pair, exactly as red-first requires.

**So a bundle whose deliverable is documentation is structurally unsubstantiable**, no matter how
correctly it is executed. This bundle did everything right and the check still fired.

Fourth blind spot in the same rule, and the enumeration is now complete enough to be useful:

| Case | Detected? |
|---|---|
| fail→pass, no production movement | **yes** — the finding works |
| production moved for unrelated concurrent work | no (F9.5) |
| pass only, no fail recorded | no (F9.7) |
| **deliverable outside `src/`** | **false positive** (this) |

The first three are misses. **This one is different in kind: the rule reports a defect that is not
there.** A miss costs a finding nobody sees; a false positive costs a reviewer's attention and
teaches them the warning is noise — which is F11's harm arriving by a different road.

**Disposition: clear it as a structural exemption, and do not widen the path rule to chase it.**
Adding `skills/` would invite `docs/`, and a documentation change moving a documentation file
substantiates nothing about red-first; it is the same edit either way. The honest fix is for the
finding's message to say *"no substantiating path exists in this bundle's scope"* rather than implying
the author skipped a step — a wording change, and it belongs with `C-REPORT-HONESTY`'s family.

### F18 — `--record false` does not stop the gate recording, and it wrote into an archive. **[verified]**

While authoring `C-REPORT-HONESTY`'s plan, the executor ran the command the approved spec itself
names:

```
bun run ngrace gate archive --change C-TOKEN-INTEGRITY --record false --path .
```

It appended a fourth `<Decision gate="archive">` to
`.ngrace/changes/archive/C-TOKEN-INTEGRITY/run-ledger.xml` — **an archived, applied bundle.** The
executor reported the tree as *"archive ledger restored after a transient dirty; only plan.xml
remains"*. It was not restored; `git status` showed the modification, and the authority restored it
from HEAD.

**Root cause, proved rather than inferred.** `record` is declared `type: "boolean", default: true`
(`gates/command.ts:126`), and citty parses boolean flags positionally-blind. Measured with a probe
replicating the exact arg definition:

| Form | `args.record` | `record !== false` | positionals |
|---|---|---|---|
| `--record false` | `true` | **records** | `["false"]` |
| `--record=false` | `false` | does not record | `[]` |
| `--no-record` | `false` | does not record | `[]` |

The space form is **silently ignored** and its value swallowed as a discarded positional. An operator
who asks for a read-only evaluation gets a write, with no diagnostic.

**Three consequences, in ascending order of seriousness.**

1. The `C-REPORT-HONESTY` spec's own `AC-TOKEN-ORPHAN-TRIPLE` and `AC-APPLY-VERDICT-DIAGNOSTICS`
   name `gate archive --record false` and `gate apply --record false`. **Executing the approved spec
   verbatim writes into the archive every time.** The plan must use `--record=false`; the criterion
   names the flag, not the shell tokenization, so this satisfies the spec rather than departing from
   it.
2. The spec's Constraint *"gate `--dry-run` is out of band (`--record false` covers read-only
   evaluation)"* is **false as written** for the form a human will type first.
3. This is the same defect family the bundle exists to close, one level up: a surface accepted an
   instruction, reported success, and did the opposite. F14 is a sentence that is false about the
   ledger; this is a *flag* that is false about itself.

**Disposition.** Not repaired here. `C-REPORT-HONESTY`'s spec is approved and its NonGoals exclude
*"rejecting unknown gate flags"*, which is the adjacent surface; and the repair lives in
`src/gates/command.ts`, a file no bundle currently claims. **Its own bundle**, authored after
`C-REPORT-HONESTY` archives — joining F9.9 in the follow-on queue. Until then, `--record=false` or
`--no-record` is the only correct form, and it belongs in the execution contract's next revision.

**Verification note for the authority.** The executor's report asserted a clean tree. It was not
clean. `git status --short` after every executor pass is not ceremony.

### D12 — The shared membership definition gets its own file, and the lint window is accepted

The draft plan hosts `listLooseEvents` / `listRunOrphans` in `src/artifact/paths.ts`. The stated
reason was mechanical, and it is a real constraint — measured, not assumed: adding a not-yet-created
path to `ObservedWriteScope` raises `change.graph-anchors-miss-write-scope`
(`lint/core.ts:496–530`), because `linksByPath` is built from files that exist. Tested by
substituting `src/artifact/run-membership.ts` into the draft's scope: **1 error**, restored to 0/0.

**The constraint is real; the conclusion drawn from it is wrong.** `paths.ts` declares
`SCOPE: Root tags, companions, anchor patterns, ARTIFACT_DIR` and `DEPENDS: none`, and imports only
`node:fs` and `node:path`. `listLooseEvents` (`grace-cursor.ts:476`) reads and parses XML through
`readGraceXmlArtifact`, clones nodes, and parses `Allocation` children into `RangeAllocation`.
Hosting it there falsifies both the SCOPE line and `DEPENDS`, and the repair is to rewrite the module
contract so it describes whatever landed. **That is the defect this bundle exists to fix, committed
in its own first task.**

**Decision: a new `src/artifact/run-membership.ts`, `LINKS M-ARTIFACT-TYPES`,** created as T-001's
first act. No seventh module, no rewritten contract, and the file's own contract is true from birth.

**The lint window is authorized and must be recorded, not avoided.** Between the plan declaring the
path and T-001 creating the file, `ngrace lint` reports exactly one
`change.graph-anchors-miss-write-scope`. `gate approve` does not evaluate lint
(`evaluateApproveGate`, `gates/core.ts:196–236`), so approval is unaffected. The error is predicted
by the plan, lives inside a single task, and `AC-SUITE-AND-LINT` requires 0/0 at close, not
throughout. **An expected error that the plan named in advance is not the same object as a
surprise**, which is the distinction P0.9 exists to make legible.

**One under-scoped detail the plan must settle before approval.** Membership is not filename-only:
`listLooseEvents` prefers the XML `id` attribute over the filename and drops non-positive-integer
ids — which is exactly the class the `NaN` orphan belongs to. A filename-only predicate would
therefore be a *second, disagreeing* definition, reintroducing F15 under a new name. The extraction
must move the XML-reading body, and `RangeAllocation` / `parseAllocationNode` travel with it; the
draft names only `LooseEvent`, `RunOrphan`, `OrphanSkipClass`.

### D13 — P0.9's count is core-private state, not an undeclared field on a versioned surface

The draft's mechanism (D3) attaches the count by cast:
`(result as LintResult & { baselineExpectationCount?: number }).baselineExpectationCount = N`.

**Rejected.** `grace-lint.ts:53` and `:191` emit `JSON.stringify(result, null, 2)` wholesale, so the
property lands in a `schemaVersion`-bearing machine-readable surface **while being absent from
`LintResult`**. A report that emits a field its contract does not declare is this bundle's own thesis
failing on itself, and it would be the second time the count was chosen for convenience rather than
truth.

The call-site binding is right and survives: N counted at the `BaselineAssertions` `evaluateSection`
call with `evaluateSemantically === true` is correct by construction, and the prefix heuristic the
executor rejected would indeed over-count `TargetAssertions` extraction issues (`lint/core.ts:299`).

**Decision: a module-private `WeakMap<LintResult, number>` in `src/lint/core.ts`.** It typechecks,
stays inside `M-LINT-CORE`, is keyed per result so concurrent in-process lint runs cannot cross-talk,
and — the point — **cannot leak into JSON output**. It is presentation state for
`formatTextReport`, and modelling it as such is the honest shape, not a workaround.

**Counterweight, required in T-006:** a test asserting the `--format json` output shape gains **no**
new key. That test fails under the cast approach and passes under the WeakMap, which is what makes
this a criterion rather than a preference.

`M-LINT-TYPES` stays out of `AffectedAreas`. Declaring the field on `LintResult` would be the better
design in a world where the spec allowed it; it does not, and superseding an approved spec to add one
optional number is not a trade worth making.

### F19 — Approving a plan makes it look like drift, so approval must be committed immediately. **[verified]**

Authoring `status="approved"` on `C-REPORT-HONESTY/plan.xml` — the approval act itself — put the
bundle into `states=integrity-issues,approved-contract-drift`, and `ngrace status` printed:

> Hard stop: an approved spec.xml or plan.xml changed. Restore it or supersede and replan through a
> new C-* bundle.

`collectApprovedContractDrift` (`grace-status.ts:371`) keys on `trackedChangedFiles` from git
porcelain. `plan.xml` was committed as a draft at `7a59f27`, so writing `approved` into it makes it a
tracked-modified approved artifact — indistinguishable, to the check, from someone editing an
approved plan after the fact. The state also strips `ready-to-execute`.

**Not a product defect.** The check cannot observe approval time, and its false window is exactly
"between authoring the status and committing it" — narrow and self-clearing. Widening it to guess
intent would weaken the real protection: an approved contract silently edited mid-execution is the
thing it exists to catch, and that is worth a transient.

**It is a sequencing rule, and it overrides the authority's earlier plan.** The authority had decided
to hold the approval commit until T-001 created `src/artifact/run-membership.ts`, so that no commit
in history carried `RM-GOVERNED-PATH` D12's predicted lint error. That plan is wrong: it leaves the executor working
inside a bundle whose own status says *stop*, and telling an executor to disregard a hard stop is how
a check is taught to be noise — the harm F9.9 named, arriving by a different road.

**Rule: commit the approval immediately after authoring it.** Where that collides with a predicted
lint error, the error is carried in the commit and named in the commit body. **A documented expected
error costs less than a live false hard stop**, because the first is a sentence a reader can check
and the second is an instruction a reader may obey.

### D12.1 — Two corrections to D12, neither of which changes the decision

**`DEPENDS` was cited wrongly.** `RM-GOVERNED-PATH` D12 said hosting the membership body in `paths.ts` would falsify
*"both the SCOPE line and `DEPENDS`"*. `DEPENDS` does not describe file imports: it lists **M-\***
graph anchors (`lint/catalog.ts:113` — *"LINKS accepts M-\*, DF-\*, and V-M-\*; DEPENDS accepts M-\*
only"*), and `src/gates/core.ts` declares `DEPENDS: none` while importing widely. Adding an
`./artifact/xml` import to `paths.ts` would not have falsified it.

**The SCOPE argument stands alone and is sufficient.** `paths.ts` declares
`SCOPE: Root tags, companions, anchor patterns, ARTIFACT_DIR`; an XML-reading `run/` inventory is not
that, and accommodating it means editing the SCOPE line to describe whatever landed. The decision is
unchanged — `src/artifact/run-membership.ts` — on one true reason instead of one true and one
invented.

**The out-of-scope importer list was short by one.** `RM-GOVERNED-PATH` D12 and the plan name
`src/calibration/report.ts` (M-CALIBRATION) as the consumer the re-export protects. Measured, four
production files import from `grace-cursor`: `gates/core.ts:39`, `review/core.ts:68`,
`calibration/report.ts:53`, and **`verification/localize.ts:73` (M-LOCALIZE)** — also outside
`AffectedAreas`. The re-export covers both, and it must carry the **types** (`LooseEvent`,
`RunOrphan`, `OrphanSkipClass`, `RangeAllocation`), not only the functions, or the out-of-scope
importers break.

### F20 — `cloneXmlNode` is duplicated by the extraction, and the honest home is out of scope. **[verified]**

`C-REPORT-HONESTY` T-001 moved the membership body into `src/artifact/run-membership.ts`. The moved
code calls `cloneXmlNode`, which the authority's prompt asserted was importable from
`./artifact/xml`. **That assertion was false** — it has always been a private helper at
`grace-cursor.ts:2730` and appears nowhere in `artifact/xml.ts`. The executor hit the error, chose
the option that does not create a cycle, and disclosed it. There are now two seven-line copies:
`grace-cursor.ts:2730` and `run-membership.ts:51`.

**Accepted, deliberately, in the bundle whose spine is single-definition.** The reasoning matters
because it looks inconsistent and is not:

- Its true home is `src/artifact/xml.ts`, which owns `GraceXmlNode`. `xml.ts` is **not** in the
  approved `ObservedWriteScope`, and the plan is immutable.
- The in-scope alternative — export it from `run-membership.ts` for the cursor to import — puts a
  generic XML utility on the public surface of a module whose declared `SCOPE` is `run/` membership.
  That falsifies a module contract **`RM-GOVERNED-PATH` D12 had just insisted must be true on the day it is written**,
  and it is the same objection that disqualified `paths.ts` as the host.
- `AC-MEMBERSHIP-ONE-DEFINITION` governs *membership*, not every helper the membership body calls.
  Two copies of a pure structural clone can drift; a module contract that lies is read by every
  future agent.

**Trading a true module contract for a deduplicated seven-line helper is the wrong trade.**
Disposition: follow-on bundle, with `src/artifact/xml.ts` in scope. Joins F9.9 and F18 in the queue.

### F21 — The fix budget counts attempts; the execution contract says it counts failures. **[verified]**

`countTaskAttemptEvents` (`grace-cursor.ts:1563`) filters `kind === "attempt"` with **no outcome
condition** — the code says so deliberately (*"Counter itself has no outcome/signature condition
(A19.1)"*). Escalation fires at `grace-cursor.ts:1737`:

```ts
if (options.outcome === "fail" && attemptCount >= FIX_ATTEMPT_BUDGET)   // FIX_ATTEMPT_BUDGET = 2
```

So the rule is: *a fail that is the second-or-later **attempt** of any outcome in the window.*

`skills/ngrace/ngrace-execute/SKILL.md` says **"two failed attempts"** in four places — rule 5
(`:38`), the `attempt` kind (`:65`), and the `escalation` kind (`:90`, `:92`). **Those are different
rules**, and the contract's version is the one every executor is handed.

**The divergence is latent, not what happened here.** Measured from this epoch's ledger, T-001's
attempts ran `fail`(2) → `pass`(3) → `fail`(5) → escalation(6) → resume(7) → `pass`(8): two real
failures, so both rules agree that event 5 escalates. The divergence bites on a **pass-first**
sequence — `pass, fail` reaches `attemptCount = 2` and escalates on the *first* failure, which the
contract says should not happen. Under red-first discipline that sequence is ordinary: a task whose
first cycle needs no red, then a genuine red for a later criterion.

The escalation message compounds it — `grace-cursor.ts:2320` renders *"Budget exhausted for T-001
after 3 attempts"*, reporting a count of attempts under a name ("budget exhausted") the contract
defines in failures. The executor read it as a second failure and was right by accident.

**This is F12's class exactly: the contract does not describe the protocol the CLI enforces** —
found again in the very skill file `C-EXECUTION-CONTRACT` was written to make complete. That bundle
documented the *kinds*; it did not verify the *thresholds* the prose asserts. **A completeness check
over the kind set does not check the sentences around it.**

Disposition: follow-on queue. Which side moves — code to match "two failures", or contract to match
"second attempt" — is a real design question and is **not** settled here. The authority's leaning is
that the code is right and the prose is wrong: an agent that has already burned two verification
cycles on one task is worth a checkpoint whatever the outcomes were. But that is a preference, and
this is a finding, not a decision.

### F22 — `paused-pending-approval` is cleared by the agent that caused it, with no approval. **[verified]**

The escalation state is named `paused-pending-approval` and its message says *"replan decision owed;
task has not failed"* (`grace-cursor.ts:2320`). Nothing checks that any approval occurred:
`cursor resume` is a designed resolver (`grace-cursor.ts:294`), takes no reason, no approver, and no
authority token, and clears the task from the unresolved-escalation set on its own.

Observed here: the executor hit the budget, ran `cursor resume`, and continued — events 6, 7, 8 of
this epoch. **This was not a violation.** The contract says only *"clear later with a deliberate
`resume` for that task after the replan path allows continuation"* (`SKILL.md:92`) and names no
actor, and in substance the continuation *was* authorized — the authority had written the correction
that produced the red. The executor also disclosed it unprompted.

**The defect is in the name, not the conduct.** A state that says it is pending approval, in a tool
whose thesis is that the agent cannot lie to the model, should not be clearable by the agent with no
record of an approval. Today the audit trail holds the escalation and the resume, but not the
decision between them — so the ledger can show that work stopped and restarted while saying nothing
about who allowed it.

Cheapest honest repair, for the follow-on to weigh: require a reason on a resume that resolves an
escalation, the way `verification-unavailable --reason` already works. That turns the replan decision
into a recorded artifact instead of an implied one, without inventing an approval mechanism the tool
has no way to enforce. The alternative — renaming the state to match what is enforced — is honest but
gives up the checkpoint.

Disposition: follow-on queue, adjacent to F21 (same surface, same contract paragraph).

---

### F23 — A lower bound is not a count: the assertion was weaker than the claim under test. **[verified]**

T-006's tests all pinned N with `toBeGreaterThanOrEqual` — `>= 1` for one failing baseline
assertion, `>= 2` for two, `>= shapeIssues.length` for the malformed section. Every one passed, and
every one would still have passed under an implementation that **doubled** the count: the lead line
would have printed `Baseline expectations: 2` for a single failing assertion and no test would have
noticed. Confirmed empirically — with `+ delta * 2` in place, the loose assertions stayed green and
only the tightened ones failed.

That matters because `AC-BASELINE-LINT-FRAMING`'s stated failure condition is printing the line
*"without correctly counting baseline-sourced issues"*, and the line reports a specific number to a
reader who has no independent way to check it. A test that admits any number ≥ the right one does not
verify the only thing the surface claims.

**This is the second distinct test-weakness class in this bundle, and it is not the F10 shape.** F10
is a test whose *name* claims more than its body checks (T-004's "grammar.ts is not modified", deleted;
T-006's "byte-identical" report test, renamed). F23 is a test whose name and body agree, but whose
*assertion* is weaker than the property the criterion names. F10 is caught by reading the name against
the body; F23 is caught only by asking what a wrong implementation would do and checking that the test
would fail.

**Standing rule:** when a surface reports a number, a criterion about that number is verified by
`toBe`, never by a bound — and where the exact value is not obvious, measure it against the fixture
before writing the assertion rather than reaching for `>=`. Where wording encodes the value (here the
singular branch is reachable only at exactly 1), assert the wording too; it is a second independent
pin on the same fact.

The general form, which cost nothing both times it was applied here: **a test that passes under the
correct implementation proves nothing on its own.** Both of T-006's real proofs came from temporarily
breaking the implementation and recording what failed — the D13 cast probe, which surfaced
`baselineExpectationCount` on the JSON contract exactly as predicted, and the double-count probe above.
Confirming a probe reverted cleanly with `git status --short` is the whole cost.

**Recurrence in `C-LEGIBLE-FAILURE` T-002 — the class widens past numbers.** The `AC-THREE-EXITS`
matrix asserted the unparseable-ledger code with `expect(w.code).toMatch(/xml\.parse|parse/i)` where
the plan asks for *"exact codes/details where stable"* and its DESIGN comment names `xml.parse` as one
of the three discriminating codes. Measured: the value is exactly `xml.parse`, so the exactness was
available and was not taken. The regex accepts any string containing `parse` in any case.

Confirmed empirically the same way as the double-count probe: with the production code mutated to emit
`ledger.parse-failed`, the loose assertion stayed green (`0 fail`); after tightening to
`toBe("xml.parse")` the identical mutation reddened it (`1 fail`); reverting restored green and the
production digest. So the assertion could not have caught the drift it existed to catch.

**F23 therefore is not only about counts.** The general form is: *the assertion is weaker than the
value the criterion names* — a bound where a number is claimed, a family regex where a contract code is
claimed. The tell is the same in both cases: name a wrong implementation, and ask whether the test
would notice.

The counterweight to over-applying this: an adjacent assertion in the same block,
`expect(w.detail.length).toBeGreaterThan(0)`, was **left loose deliberately**. The `code` is a contract
value the plan names; the `detail` is passthrough text from the XML parser (`char 'n' is not
expected.`). Pinning the code is a contract; pinning the parser's wording is coupling to a dependency's
prose. F23 asks whether the criterion names the value — not whether an assertion could be tighter.

Disposition: applied in T-006 (committed `74ed4a9`); recurrence corrected in `C-LEGIBLE-FAILURE` T-002
(committed `9181dda`). Carried as a review habit, not a follow-on bundle.

---

### F19.1 — The close window raises three errors, and not the ones F19 predicted. **[verified]**

F19 recorded that authoring a status attribute on a committed governed artifact leaves the tree in a
state the checks reject until the change is committed, and drew the rule: **commit the status
authoring immediately.** That rule held at the close of `C-REPORT-HONESTY`. The *diagnosis* did not.

I predicted `approved-contract-drift` in the close instructions. What actually fired between authoring
`status="applied"` and the archive commit was a different family — three errors:

```
change.plan-requires-approved-spec   An active plan may exist only beside an approved spec.
change.invalid-active-status         Active change artifacts cannot use status 'applied'.  (plan)
change.invalid-active-status         Active change artifacts cannot use status 'applied'.  (spec)
```

The mechanism is the mirror image of F19's. `approved-contract-drift` fires when an artifact that is
*still approved* changes after its approval was recorded. Here the artifacts **leave** `approved`, so
that check goes quiet and the active-directory status validator speaks instead: `applied` is not a
legal status under `active/`, and a plan beside a non-approved spec is not a legal pair. Same class,
opposite trigger.

**The underlying fact is that the honest intermediate state is unrepresentable.** Between step 7
(author `applied`) and step 9 (`git mv` to `archive/`) the bundle genuinely *is* applied and genuinely
*is* still under `active/`, and the artifact grammar has no way to say so. The errors are the tree
correctly reporting a state that should not persist — they are the checks working, not failing.

**This is recorded, not scheduled, and that is deliberate rather than a deferral (D11).** The window
is two commands wide and closes on the commit. The only repairs available are worse than the
symptom: teaching the gate to move the bundle would break the invariant that **the gate never authors
status and never moves bundles**, which is load-bearing precisely because it keeps the tool from
laundering a decision it did not make. A tolerated three-error window inside a documented sequence
costs less than a gate that mutates the tree.

**Operational rule, unchanged from F19 and now correctly grounded:** run steps 7–10 straight through
to the commit, expect these three, and report them rather than repairing them. The close prompt should
name these codes so an executor meeting them does not mistake an expected state for a broken one — an
undocumented expected error is the thing that teaches a reader to ignore errors generally, which is
F11's harm arriving by another road.

---

### F18.1 — The swallowed token is not discarded; it binds to a positional and answers wrongly. **[verified]**

F18 recorded that `--record false` parses as `record: true` with `false` *"swallowed as a positional"*.
That description is right about the flag and wrong about the token's fate on any command that
**declares** a positional. Measured at HEAD `3f3547c`:

```
$ ngrace module find --json true
[]                                  exit 0
$ ngrace module find --json M-QUERY
[ { "module": { "id": "M-QUERY", …   exit 0
```

The bare `true` did not vanish. It **bound to the `query` positional**, so the command searched the
module graph for the string `"true"`, found nothing, and reported an empty result with exit 0. The
operator asked for JSON output and got a confident, well-formed, *wrong* answer.

Seven positional declarations are exposed to this (module find/show/health, verification
find/show/localize, file show), and all seven take free-form values, so none of them can reject
`"true"` as obviously-not-a-query.

**This is a worse failure than the one F18 named.** F18's shape is *the flag was ignored* — bad, but
the command still did its declared job. F18.1's shape is *the flag was ignored and the query was
silently replaced*, which produces a wrong answer wearing the exact costume of a right one. An empty
result is indistinguishable from a real negative.

**It also settles a design question the spec would otherwise have to argue.** `C-FLAG-HONESTY` rejects
`--flag true` as well as `--flag false`, which by the letter of `RM-GOVERNED-PATH` D5's standing rule — *"making a silent
failure loud is not a compatibility break; turning a working state into an error is"* — looks like it
converts a working state into an error, since `--json true` happens to produce `json: true`. The probe
shows it is not a working state. The flag lands correctly **by coincidence** while the positional is
silently corrupted, and the coincidence does not hold for the seven commands that read one. Rejecting
both spellings is the honest reading of `RM-GOVERNED-PATH` D5, not an exception to it.

Disposition: evidence for `C-FLAG-HONESTY` (spec `3f3547c`). Recorded during authority review of the
spec, before approval, so the criteria could rest on a measurement rather than on my prediction.

---

### F24 — M-QUERY has quietly become the CLI-infrastructure module. **[verified]**

`M-QUERY`'s graph entry summarises it as *"Artifact query and navigation: module, file, graph, and
verification resolution"* (`.ngrace/graph/main.xml`), and `src/query/errors.ts` repeats that as its
file-local `SCOPE`. Neither describes what the module actually holds.

`runGraceCommand` and `GraceCommandError` live in `query/errors.ts`, and thirteen files import from
it — `gates/command.ts`, `gates/ledger.ts`, `review/command.ts`, `grace-cursor.ts`, `grace-status.ts`,
`grace-lint.ts`, `grace-context.ts`, `grace-doctor.ts` among them. None of those are module, file,
graph or verification resolution. The error envelope, the exit-code channel and the command wrapper
are **CLI-wide infrastructure** sitting inside a module whose contract says it resolves queries.

Nothing here is broken at runtime. What is wrong is that two contracts describe a module that no
longer matches them, so a reader deciding where a new cross-cutting CLI concern belongs gets no honest
answer — and the answer they will reach by imitation is "put it in query", which deepens the drift.
`C-FLAG-HONESTY` reached exactly that point: its `defineGraceCommand` wrapper is CLI-wide, and
`M-QUERY` is the only host the approved `AffectedAreas` allows.

**Deferred, with the justification D11 requires — a conflict, not a topic match.** The honest repair is
a CLI-infrastructure module (`M-CLI-INFRA` or widening `M-QUERY`'s summary to match), and both are
graph changes: the first needs an anchor the approved `C-FLAG-HONESTY` spec does not grant, and
re-speccing mid-plan to repair a drift that bundle did not cause is disproportionate. It is also not
`M-CLI` — that anchor belongs to `src/grace.ts`, the dispatch root, and hosting a guard file under
`src/query/` against it would put the file and its module in different places.

So `C-FLAG-HONESTY` proceeds on `M-QUERY` and **records in its DESIGN comment that M-QUERY is the best
host the approved scope allows, not a natural one** — the deepening is disclosed rather than silent.

Disposition: follow-on queue, alongside F9.9 / F20 / F21 / F22. The repair is a graph edit plus two
contract rewrites, and it should be weighed together with whatever the next bundle needs from the CLI
surface rather than done on its own.

---

### F25 — The refusal is correct and lands outside the CLI's own error rendering. **[verified]**

`defineGraceCommand` calls `refuseBooleanSpaceForm` **before** the original `run`, which is what makes
it safe — the write never happens. But `gates/command.ts` wraps its body in `runGraceCommand`, so a
throw from the guard escapes *outside* that try/catch and is handled by citty's `runMain` instead of
this repository's error renderer. Measured after T-002, on a temp fixture:

```
$ ngrace gate approve --change C-PROBE --path <fixture> --record false
exit 1 ; no run-ledger.xml created
stderr: a source excerpt and stack frame, then
  GraceCommandError: Boolean flag `--record` does not accept a space-separated value
  (`--record false`). Use the equals form … or the citty forms …
```

**The criterion is met and the defect is fixed.** `AC-SPACE-FORM-FAILS-LOUD` asks for a non-zero exit,
a message naming both working forms, and no flagged side effect; all three hold, and the ledger is not
merely unmodified but never created. What remains is presentation, and it has two parts:

1. **The message arrives wearing a stack trace.** Legible, complete, and noisy for what is a usage
   error.
2. **`--format json` emits no JSON.** `runGraceCommand` renders a `GraceCommandErrorEnvelope` on
   failure; a throw that never reaches it produces empty stdout and unparseable stderr. A machine
   consumer of `gate apply --format json` gets exit 1 and nothing to parse.

**Point 2 was first recorded here as defensible, on the grounds that a malformed argument is a usage
error and plenty of CLIs answer those on stderr regardless of `--format`. That was too generous, and
the maintainer was right to push back.** Revised, with the stronger reading:

This is not a surface that lacks an error contract. It **has** one — `GraceCommandErrorEnvelope`, with
`schemaVersion`, `ok: false`, and a coded `error` object — and `runQueryCommand`'s own doc comment
says it *"renders stable text or JSON failures **without stack traces**."* So the defect is not a
missing convention; it is a **declared contract with a reachable hole**, which is a strictly worse
thing to ship and exactly the class `D13` refused when it kept an undeclared key off the lint result:
a `schemaVersion`-bearing surface must not emit something its schema does not describe.

Three points settle it:

- **The "usage error, raised before the command runs" distinction is an implementation artifact.** From
  the caller's side `ngrace gate apply --format json --record false` is one invocation. Making the
  output *shape* depend on how far execution got before failing leaks internal timing through a
  contract whose purpose is to hide it.
- **The consumers of this CLI are coding agents.** An unparseable error is a surface the model cannot
  read at all — in a tool whose thesis is that the agent cannot lie to the model, that is arguably
  worse than a wrong-but-structured answer, because the reader has nothing to check and may retry or
  paraphrase instead of reporting.
- **`--format` is knowable at guard time**, so the usual bootstrap objection does not apply here. There
  is a genuine residue — a failure while parsing `--format` itself, or a crash, will always escape —
  but that argues for making the *reachable* errors conform, not for leaving a reachable one outside.

**A third part, latent today:** `runGraceCommand` sets `process.exitCode = commandError.exitCode`, so
the repository's contract is that the exit code comes from the error object. The guard path never
reaches that line and takes citty's default instead. Both are `1` today — `GraceCommandError` defaults
`exitCode` to 1 and no production error sets another value — so the divergence is invisible. It stops
being invisible the first time an error wants a different code, and nothing currently pins it.

**A clean in-scope repair exists and was deliberately not taken.** The wrapper could route the refusal
through `runGraceCommand` using the already-exported symbol, reading `context.args.format`, giving
clean stderr text or a proper envelope without editing `errors.ts` at all. The obstacle is not
capability: the approved plan assigns `src/query/command.ts` to **T-001 only**, and T-002's criterion
states its production scope is `gates/command.ts`. Editing the wrapper in T-002 or T-003 contradicts an
approved plan, and amending one means superseding it.

**Deferred, with the conflict D11 requires.** Superseding an approved plan mid-execution to improve the
presentation of a refusal that already prevents the write is disproportionate — and the alternative,
quietly widening a task's scope because the fix is small, is the failure mode the plan contract exists
to prevent. The executor did the right thing: it reported the cost and did not patch across the
boundary.

Worth noting for the follow-on: fixing it in the wrapper fixes all 24 sites at once, and T-003 wires
the remaining eight files on this same channel, so the cost of waiting is breadth rather than depth.

Disposition: **first item of the follow-on queue**, ahead of F9.9 / F20 / F21 / F22, and a natural
companion to F24 — both are repairs to the same CLI-infrastructure seam. Reframing this from
presentation to a contract hole raises its priority but does **not** change the decision to finish
`C-FLAG-HONESTY` as approved first: the repair needs `src/query/command.ts`, which the plan assigns to
T-001, and superseding an approved plan mid-execution when a clean successor bundle is two tasks away
trades a small delay for the precedent that scope may be widened whenever the fix looks small.

What the successor owes, so the reasoning is not re-derived: route the refusal through
`runGraceCommand` with `format` read from `context.args`, so the envelope and the error-supplied exit
code both apply; and pin the exit code explicitly, since today's agreement at `1` is a coincidence
rather than a guarantee.

---

### F25.1 — Routing everything through the renderer erased every unexpected cause. **[verified]**

The successor did exactly what F25 asked, and the repair had a consequence F25 did not anticipate.
`runGraceCommand` converts anything that is not already a `GraceCommandError` into
`new GraceCommandError("invalid-project", fallbackMessage)`, **discarding the original message and
stack**. That was contained while it wrapped individual leaf bodies. T-003 put it around every
command's entire `run`, so the conversion became universal.

Measured on the wrapper directly, before and after the repair, with a `TypeError` thrown from
`originalRun`:

| | before | after |
|---|---|---|
| text | `TypeError: cannot read property 'wrapper' of null` + stack at the throw site | `Unable to complete the GRACE command.` |
| json | no envelope at all | envelope whose `message` is `Unable to complete the GRACE command.` |

The envelope is the win. The erasure is not: every unexpected failure anywhere in the CLI would have
reached the operator as one fixed sentence with no message, no file, and no line.

**The general form is worth carrying past this bundle: a fallback message is not an error report.**
Wrapping a broad surface in a narrow renderer converts *coverage* into *uniformity*, and uniformity
reads as success at the reporting layer — the contract is satisfied, `ok: false` is honest, the exit
code is right, and the one thing a reader needs is gone. It is the same shape as F10 one level up: the
envelope's *name* promises an error report while its *body* carries a constant.

**Repaired inside T-003**, in `src/query/command.ts` alone. A `GraceCommandError` rethrows untouched;
anything else is converted to one **carrying the original message**, with the original stack written to
stderr. Stdout stays pure envelope — the spec requires the entire stdout to parse — so in JSON mode the
machine gets the contract on stdout and the human gets the stack on stderr. That split is the one the
maintainer named when rejecting the original "defensible" framing: parsable structure first, stderr as
the diagnostic channel beside it, not instead of it.

**Why this was fixed in-task rather than deferred (D11).** The task created the regression; the repair
sits inside the task's own declared `ObservedWriteScope`; and no NonGoal covers it — the nearest,
*"rewriting `runGraceCommand`'s success path"*, is untouched, and `errors.ts` was never edited.
Deferring would have shipped a legibility regression inside the bundle named `C-LEGIBLE-FAILURE`.

**Residue, recorded rather than scheduled.** Errors thrown outside the operation callback —
`collectBooleanFlagNames`, or citty's own argument parsing — still escape raw, exactly as before. That
is the genuine bootstrap residue F25 already named, and it argues for making reachable errors conform,
not for chasing the unreachable ones.

Disposition: applied in `C-LEGIBLE-FAILURE` T-003. Carried as a design rule for any future shared
renderer: **preserve the cause, or you have built a uniform way of saying nothing.**

---

### F26 — A plan restated a spec criterion and dropped the two words that made it satisfiable. **[verified]**

`C-LEGIBLE-FAILURE`'s spec says:

> `bun run ngrace lint --path .` is 0 errors and 0 warnings **at close**

The plan's T-004 criterion restates it as:

> `bun run ngrace lint --path .` is 0 errors and 0 warnings

`at close` is doing real work. The five outstanding errors are the plan's own `BaselineAssertions` —
recorded statements about the pre-change world that this change deliberately falsified. They cannot
return to green while the bundle sits in `active/`; they stop being evaluated when it is archived. So
as a task-time condition the restatement is **unsatisfiable**, and the only ways to "meet" it are the
two the plan itself forbids: weakening the baselines, or deleting them.

**The plan contradicts itself, which is what makes this a finding rather than a wording preference.**
Its own DESIGN comment says of exactly these assertions: *"P0.9's framing line reports the baseline
delta — do not weaken BaselineAssertions to silence it."* A criterion that can only be satisfied by
doing the thing the same document prohibits is a defect in the artifact, not a hard task.

**Resolved without amending anything.** The spec governs and is satisfiable as written: T-004 verifies
the suite, `validate:ci`, review, and the counterweights, and reports lint as baseline-only; the 0/0
check belongs to the close, after `gate archive` and the `git mv`, which is the authority's step and
not the executor's. Nothing was rewritten — an approved artifact stays approved, and the reading that
reconciles them is recorded here instead.

**The class, which is the part worth carrying.** A plan that restates a spec criterion instead of
referencing it can silently narrow it, and a dropped qualifier is the easiest thing to lose because the
sentence still reads as true. This is the same failure as F10 (a name claiming more than the body) and
F23 (an assertion weaker than the criterion), moved up a level: **a restatement that is not equivalent
to what it restates.** The tell is a restatement that reads as complete on its own.

Two notes on where this does *not* apply. A plan is allowed to be **stricter** than its spec — that is
ordinary and good. The defect here is strictness that is unachievable, which converts into pressure to
falsify. And a plan is allowed to **paraphrase** for readability; the requirement is equivalence, not
identity of wording.

Disposition: recorded, not scheduled. No artifact is amended and no bundle is opened. Carried as
authoring guidance: when a plan restates a spec criterion, quote the qualifiers verbatim or reference
the criterion by name rather than paraphrasing it into a task.

---

### D14 — Error reporting invariant: fail fast **with** context, and preserve the cause as an object

Raised by the maintainer from [F25.1](#f251), which recorded the erasure the F25 repair introduced.
F25.1 is the observation; this is the rule that binds future work. Scope: **this repository's CLI and
internal surfaces.** It is deliberately *not* GRACE skill text — the principle is general software
engineering rather than contract-first methodology, and shipping it as product would widen the
methodology's remit without argument. Revisit that if the skills ever grow an observability section.

**Principle.** A fallback message is not an error report. Broad execution surfaces must fail fast *with
full diagnostic context*. Catch-all wrappers that flatten distinct error states into uniform strings
are prohibited.

#### 1. Preserve the cause as an object, not as a copied string

When a boundary converts an unexpected error into a declared error type, it must **attach the original
error** (ES2022 `cause`), not merely copy its message. A copied string loses the original's type
identity, its custom properties, and any nested causes, and the new error's `.stack` then points at the
conversion site rather than the throw site — a stack that is confidently wrong about where the failure
came from.

**Channel split, which is the part that keeps this compatible with a machine contract.** Stdout is the
machine contract; stderr is the human diagnostic. The stack goes to stderr in *both* text and JSON
mode, because a JSON surface's entire stdout must parse. Putting a stack *inside* the envelope is a
different proposal — it is a `schemaVersion` change to `GraceCommandErrorEnvelope` and must be decided
deliberately, never implied by this rule.

Note the existing tension this rule does **not** silently override: `runQueryCommand`'s doc comment
promises failures rendered *"without stack traces."* That sentence is about **stdout**, and stays true
under the split above. Any future reading that puts stacks on stdout contradicts it and needs its own
decision.

Deliberately **not** adopted: the maintainer's original wording said *unredacted*. Rejected as an
absolute — error messages can carry tokens or credentials lifted from a URL or environment variable,
and a rule that forbids ever redacting one is a hostage to fortune. The requirement is that context is
**unsummarized**, which is what the clause is actually protecting.

#### 2. Anti-flattening

A catch-all handler must never map heterogeneous failures onto a static string literal (`"Unable to
complete the GRACE command."` was the live instance). Converting varied failure modes into uniform
output sanitizes the reporting layer and manufactures an illusion of controlled execution while
destroying observability. `ok: false` is honest, the exit code is right, and the one thing the reader
needs is gone.

**One carve-out, because the code already reaches it:** when the thrown value genuinely carries no
information (`throw undefined`, a non-`Error` rejection), a synthesized message is permitted — and must
be **distinguishable** from a real one, so the carve-out cannot quietly become the rule again.

#### 3. Fail fast means halt the work, not bubble the exception

The maintainer's original third clause required unexpected failures to *"halt immediately and bubble up
the unredacted context, rather than swallowing the state."* **Adopted in substance, rewritten in
mechanism, because as literally worded it re-opens F25.** `runGraceCommand` deliberately catches,
renders, and sets `process.exitCode` instead of letting the exception escape; that is exactly what
produces the parsable envelope and the error-supplied exit code. Bubbling instead means citty prints a
stack and a `--format json` consumer gets nothing to parse — the defect `C-LEGIBLE-FAILURE` closed.

Two things were being conflated:

- **Halting the work** — no continuation, no inferred intent, no partial write. **Mandatory.**
- **Letting the exception cross the process boundary unrendered** — **not** required, and at the
  outermost boundary not permitted.

Restated: *halt immediately; never continue, infer, or perform partial work. The outermost boundary may
convert the exception into the declared error contract, provided it preserves the cause per clause 1.*
An error boundary exists to turn an exception into a contract; forbidding that forbids having an error
contract at all.

#### 4. Unwinding, which is where the mechanism gets subtle

- **`finally` still runs.** Catching at a boundary does not skip intermediate cleanup — the engine
  unwinds through `finally` on the way to the catch. Arguments for propagation based on resource safety
  do not apply.
- **Unwinding stops at the innermost boundary, and there are now two.** Leaf commands wrap their own
  bodies in `runGraceCommand`; `C-LEGIBLE-FAILURE` T-003 added an outer wrap around the whole run. When
  a leaf catches internally it renders and returns *normally*, so the outer boundary sees no exception
  and cannot distinguish success from already-reported failure. The only available signal is
  `process.exitCode`, which the plan forbade polling for good reason. Benign today because the inner
  boundary consumes the error and nothing double-renders; **not** benign the moment an outer boundary
  needs to act conditionally on failure. Nested boundaries need a protocol, and there is none.
- **Async stacks truncate.** Across `await` the captured stack frequently omits the logical caller
  chain, so "capture the stack" delivers less than the phrase promises — a further reason clause 1
  requires an object chain rather than a string.
- **Unawaited rejections escape every boundary.** `await originalRun(context)` catches rejections of the
  awaited promise. A promise created inside a leaf and never awaited rejects *after* the boundary has
  returned. Verified at `cae1e61`: there is no `unhandledRejection` or `uncaughtException` handler
  anywhere in `src/`. So the process can exit **0** with an error that was never reported — the loudest
  form of the failure this rule exists to prevent, caught by neither the envelope nor the exit code.

#### Compliance: the rule ships with its own repairs scheduled

The rule is not retroactively satisfied. Two gaps are measured, not speculative, and both sit on the
same seam (`src/query/errors.ts` plus the process entry point), so they are **one bundle**:

1. `GraceCommandError`'s constructor takes `{ exitCode?, issues? }` and has **no `cause`**. Clause 1 is
   therefore currently unsatisfiable by construction; `C-LEGIBLE-FAILURE` T-003 copies the message
   because attaching the cause was not available to it.
2. No `unhandledRejection` / `uncaughtException` handler exists, per clause 4.

Sequenced **after** Bundle B (`C-ESCALATION-HONESTY`), which is in flight — not displacing it. Recorded
here rather than as an aspiration so the rule arrives with its compliance already owed, which is the
same standard [F25.1](#f251) applied to the repair that raised it.

---

### F27 — `ObservedWriteScope` is declared and digested, but never compared. **[verified]**

Found during `C-ESCALATION-HONESTY` T-001. The task edited `src/gates/core.test.ts`, which is **not**
in the plan's `ObservedWriteScope`:

```xml
<ObservedWriteScope>
  <File>src/grace-cursor.ts</File>            <File>src/grace-cursor.test.ts</File>
  <File>skills/ngrace/ngrace-execute/SKILL.md</File>
  <File>plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md</File>
  <File>src/test-support/token-accounting.test.ts</File>
  <File>.ngrace/changes/active/C-ESCALATION-HONESTY/plan.xml</File>
</ObservedWriteScope>
```

The cursor's `WriteEvidence` for the passing attempt digested it anyway, correctly and without
complaint. `ngrace lint` reported only the two expected `assertion.*` baselines; `ngrace review`
reported 0 findings. **Every automated surface was silent, and the only reason the divergence is on the
record is that the executor disclosed it.**

**The gap is directional.** The `scope.*` checks in `src/artifact/scope.ts` validate the *shape* of the
declaration (`scope.invalid-durable-shape`, `scope.empty-observed-n`, `scope.none-with-entries`) and
*overlap between changes running in parallel* (`scope.observed-write-overlap`,
`scope.parallel-durable-overlap`). `change.graph-anchors-miss-write-scope` checks declared paths
against graph anchors. All of them read the declaration. **None compares the declaration to what was
actually written**, though the ledger holds exactly that list, per file, per attempt, already digested.

That is what makes this worth recording rather than shrugging at: the data required for the check is
**already collected and already trustworthy**. `WriteEvidence` is generated by the tool, not asserted
by the agent. A comparison of the digested file list against `ObservedWriteScope` is a pure function of
two things the bundle already contains. The plan contract's central safety property — *this task writes
these files and no others* — is stated, is checkable, and is unchecked.

#### The immediate case, and why it was accepted

The change is one line of fixture data:

```diff
-      signature: { kind: "test", key: "b" },
+      signature: { kind: "test", key: "a" }, // R: same signature (C-ESCALATION-HONESTY)
```

The assertion it feeds (`escalatedTasks` contains `T-001`) is unchanged. Under the approved rule two
*different* signatures no longer escalate, so a fixture that reached the escalated state via `a, b` no
longer reaches it at all. `M-GATES`' behaviour, contract, and surface are untouched; what moved is a
test's input.

**Accepted, with the reasoning stated so it does not become a precedent by silence.** Superseding an
approved spec *and* plan over one line of fixture data — forced by the approved rule, in a test file,
disclosed before any commit — is disproportionate. That is [F25](#f25)'s proportionality argument
applied in the other direction: there it was disproportionate to supersede a plan to *improve* a
refusal's presentation; here it is disproportionate to supersede two artifacts to *relabel* a
consequence everyone agrees follows.

The boundary, so the exception stays narrow: this is acceptable because it is **test fixture data,
forced by the approved rule, in a file whose module contract is unaffected, disclosed before commit**.
A production edit outside `ObservedWriteScope` remains a stop-and-report.

**The plan is the defective artifact here, not the executor's judgement.** A complete
`ObservedWriteScope` was the plan's job and it missed a file that the rule change necessarily breaks.
**The authority approved that plan and missed it too** — I reviewed the scope section and did not ask
which other suites construct escalations. The executor's conduct was sound: it disclosed the edit,
named the file, explained the necessity, and asked rather than assuming. The only refinement worth
noting is order — reporting before patching would have been better than patching and then reporting,
though the patch was uncommitted and reversible throughout.

#### Why the honest ledger is the reason this is visible at all

Worth stating plainly, because it cuts both ways. The ledger did not hide the excess: it digested
`src/gates/core.test.ts` because that file changed, exactly as designed. The system told the truth. But
truth-telling without comparison only helps a reader who already suspects something — and the whole
point of this roadmap is that correctness should not depend on someone thinking to look.

Disposition: **follow-on queue.** A `scope.observed-write-undeclared` check comparing `WriteEvidence`
digests against `ObservedWriteScope`, at the same severity as the existing `scope.*` errors, with the
open question of whether it fires per attempt or only at fold. Natural companion to the D14 repairs
(`cause` support and the unhandled-rejection handler) — both are gaps between a declared contract and
what is actually enforced, which is this roadmap's whole subject.

---

### F28 — The agreement test's positive clause asserts a string that was already true. **[verified]**

`C-ESCALATION-HONESTY` T-003 added a second agreement test titled *"both skill trees document
escalation-clearing resume requires `--reason`; ordinary resume does not."* Its body:

```ts
expect(text).toContain("cursor resume");
expect(text).toContain("--reason");
expect(text).toMatch(/ordinary resume|does not clear an escalation/i);
expect(text).toMatch(/without `--reason`|without --reason/i);
```

`--reason` was **already present at HEAD**, twice, on an unrelated command: rule 5 and the
`verification-unavailable` kind both read `ngrace cursor verification-unavailable … --reason …`. So the
assertion carrying the test's positive claim is information-free — it passes on the file the test exists
to change. Only the two carve-out matchers discriminate, and they discriminate by accident of phrasing:
they happen to live in the same sentence as the command form.

**Probed rather than argued.** Stripping ` --reason "…"` from both command forms in **both** skill trees,
leaving every explanatory sentence intact:

```
bun test src/grace-cursor.test.ts -t "fix-budget skill prose agrees"
→ 3 pass, 0 fail
```

Reverted; digests back to `9c552269…` on both paths, matching the ledger's recorded pass attempt.

So the skill can ship

    `ngrace cursor resume --change C-ID --task T-NNN`

— the exact form T-002 now refuses — while still explaining, one clause later, that a reason is required.
The prose would contradict the command printed beside it, and the suite would be green.

This is [F23](#f23) in its widened form: the assertion is weaker than the value the criterion names. The
criterion names *"clearing an escalation requires a recorded reason"*; the test measures whether the
seven characters `--reason` occur anywhere in an eleven-thousand-character file. It is also the failure
this bundle exists to remove, reproduced inside the bundle's own enforcement — contract text with no
check binding it.

**What makes the difference discriminating:** the claim is a **co-occurrence**, so the assertion must be
one. Both documented entry paths (`cursor resume` and `cursor advance --kind resume`) carry `--reason` in
the command form itself. Pinning co-occurrence rather than the full literal keeps the test alive across
placeholder renames while still reddening under the probe above.

Disposition: **fixed in T-003**, which is still open — no `terminal`, no commit. Not a spec or plan
defect: the approved AC requires the resume kind to *document* the reason, and the skill does. The
defect is enforcement strength, and the file is in `ObservedWriteScope`.

---

### F29 — The footprint metric counts lines, so the text agents load grew 9% and it read zero. **[verified]**

`src/test-support/token-accounting.test.ts` pins `skillTextLines().total` with `toBe(779)`, described in
the module contract as *token-accounting helpers* and in the code comment as *the D15 baseline number*.
`skillTextLines` sums `wc -l` over `skills/ngrace/*/SKILL.md`.

T-003 rewrote four budget sites and the resume kind in `ngrace-execute`:

```
HEAD  10890 bytes / 103 lines
now   11852 bytes / 103 lines      (+962 bytes, +8.8%)
```

Unit corrected after the fact: these are `wc -c` output, which is **UTF-8 bytes**, not characters. JS
string length over the same two revisions is 10860 → 11806 (+946). The conclusion is unchanged and the
distinction is small, but labelling bytes as characters is the same imprecision this roadmap keeps
finding in assertions ([F23](#f23)) — a value reported under a name defined differently.

The pin did not move, because in a file whose kind entries are one line per field, a rewrite that doubles
a sentence's length is line-neutral by construction. The metric is insensitive along the only axis that
was changed.

Two consequences, and the second is the worse one. First, `779` gives false assurance: a reader checking
whether the skill grew sees an unchanged number against a 9% increase in what every executing agent
actually loads. Second — and this landed on me — I wrote T-003's prompt instructing the executor *"do not
compress a sentence to keep 779 green,"* framing the pin as a real constraint on prose. It was not one;
the discipline was sound and vacuous. The plan's own criterion said *"do not compress sentences to
preserve a line count"* and was more accurate than my restatement of it.

[F10](#f10) class: the name claims more than the body measures. `skillTextLines` is honestly named; the
module `token-accounting` and the phrase *baseline* are not, and the pin is consumed as a footprint
figure in phase reports.

Disposition: **follow-on queue**, with the D14 repairs and [F27](#f27)'s `scope.observed-write-undeclared`
check. Not folded into `C-ESCALATION-HONESTY`: the fix changes `skillTextLines`'s measurement semantics,
which the module comment says *"do not change … without updating every phase report that cites them"* —
that is a real dependency on a survey this bundle has no mandate to run, which is the kind of
justification [D11](#d11) asks for before anything is deferred. The likely shape is a character or
token-estimate field reported alongside lines, not in place of them, so existing citations stay readable.

---

### F30 — A commit-body criterion is unsatisfiable by the first commit in a multi-task change. **[verified]**

`C-ESCALATION-HONESTY`'s `AC-COMMIT-BODY-PROTOCOL` says:

> every git commit that introduces the skill and/or CLI protocol change (paths include
> `skills/ngrace/ngrace-execute/SKILL.md` and/or `src/grace-cursor.ts` in that commit's diff) has a
> **commit message body** … that names both thresholds by value — same-signature repeat **2** and
> distinct-signature backstop **4** — and the resume-reason requirement for escalation clear.

The trigger is path inclusion and the obligation is distributive: **every** such commit. Three commits
qualify, and as originally written two failed.

| commit | 2 | 4 | resume reason |
| --- | --- | --- | --- |
| `338047b` T-001 | absent | "four", spelled | **absent** |
| `25f1a46` T-002 | absent | absent | present |
| `711987c` T-003 | present | present | present |

The executor's T-004 check read the same three bodies independently and reached the same table, which is
why this is recorded as measured rather than argued.

**Citation correction ([F37](#f37)).** The three hashes above are **pre-amend** and resolve from no ref.
Amending `338047b` rewrote every descendant, including `711987c`, which was never itself amended. The
surviving, reachable commits are:

| as cited above (pre-amend, unreachable) | surviving |
| --- | --- |
| `338047b` | `f599ee7` |
| `25f1a46` | `f0b999b` |
| `711987c` | `86583b6` |

`86583b6` is the same commit [F29](#f29) already cites correctly — decisions.md named one commit by two
hashes, one of which had ceased to exist.

**The thresholds were repairable. The resume-reason clause at T-001 was not.** At `338047b` that
requirement did not exist in the tree — T-002 introduced it. Satisfying the clause there means one of:

- **squashing** the three task commits, which destroys the per-task granularity the run ledger's events
  are written against; or
- **writing into T-001's body a claim about behaviour the code did not yet have** — which is precisely
  [F21](#f21), the defect this bundle exists to remove, committed into the audit record that is supposed
  to be the defence against it.

A criterion satisfiable only by the act it condemns is defective, in the same family as [F26](#f26): a
statement that reads as complete and is unachievable as written.

**Disposition: partial compliance, disclosed.** The first two commits were amended — nothing was
pushed, so this is local — to name **2** and **4** by value, which is honest at both since the constants
land in T-001. The T-001 commit (now `f599ee7`) still carries no resume-reason clause, and now says so in
its own body with the reason. The gate verdict records the residual rather than the history being quietly reshaped to look
compliant. The alternative — squashing — was declined by the maintainer and by me for the same reason.

**Carried as authoring guidance, which is the reusable part.** A commit-body criterion in a multi-task
change must scope its clauses to the commits that can honestly carry them: *"the commit introducing the
resume-reason requirement states it; the commits introducing the thresholds state them by value."* A
flat "every commit states everything" is unachievable the moment the change has more than one task, and
its failure mode is pressure to backdate a claim.

---

#### F9.10 — The attempt-pair rule has never once fired on a real defect. **[verified]**

[F9.9](#f99) enumerated four blind spots and called the list *"complete enough to be useful."* It was
not, and the correction is not another row — it is a measurement that changes what the rule is.

Running the change-scoped review over **all 26 archived bundles**:

```
bun run ngrace review --path . --change <C-ID>     # for each bundle
```

| | |
|---|---|
| bundles scanned | 26 |
| bundles raising `review.attempt-pair-unsubstantiated` | 6 |
| findings raised | 8 |
| findings that are real red-first violations | **0** |

Every one of the eight was classified from the ledger's own `WriteEvidence`, comparing the fail event's
digests against the pass event's:

| bundle / task | what moved between fail and pass |
| --- | --- |
| `C-CALIBRATION-COMMAND-EVIDENCE` T-002 | `grace-cursor.test.ts` only |
| `C-CURSOR-INTEGRITY` T-001 | `lint/catalog.test.ts` only |
| `C-CURSOR-INTEGRITY` T-007 | `grace-status.test.ts` only |
| `C-ESCALATION-HONESTY` T-003 | both `SKILL.md` trees + `token-accounting.test.ts` |
| `C-EXECUTION-CONTRACT` T-001 | both `SKILL.md` trees only |
| `C-LEGIBLE-FAILURE` T-002 | `gates/core.test.ts` only |
| `C-TOKEN-INTEGRITY` T-001 | `lint/catalog.test.ts`, `project-utils.test.ts` |
| `C-TOKEN-INTEGRITY` T-005 | `lint/catalog.test.ts` + `docs/plans/.../plan.md` |

**In all eight, no non-test file under `src/` changed — and in all eight it should not have.** The
failure signatures say so in the agents' own words: `loose-assertion`,
`T-005-red-first-catalog-completeness`, `T-001-red-first-unparsed-link-token`, `catalog-f10-namespace`.
These are tasks whose *deliverable is a test or a document*. `C-LEGIBLE-FAILURE` T-002 is the sharpest:
the production digest `af58dfca…` is byte-identical across the pair **because the defect was that the
assertion was too weak** — the production code was already correct. Production moving would have been
the bug.

So the fifth blind spot is **a task whose deliverable is a strengthened assertion**, and it is
structurally unfixable by widening the path rule: test paths are excluded from the substantiating set
*by design* (F9.3), so the correct fix for a weak-assertion task can never substantiate its own pair.

**The rule's premise is that the deliverable is production code.** That premise is false for at least
three legitimate task classes — documentation/skills, test strengthening, and roadmap prose — and the
corpus says those classes are not the exception. Six of twenty-six bundles, eight of eight findings.

**A warning with a 100% false-positive rate over its entire operating history is not a check. It is a
budget on the reviewer's attention with nothing purchased.** That is precisely the harm F9.9 predicted
and could not yet measure.

**This supersedes F9.9's disposition.** F9.9 said the honest fix is a wording change — say *"no
substantiating path exists in this bundle's scope"* rather than implying a skipped step. The
measurement says wording is not enough: a reworded warning that fires on every documentation and
test-strengthening task is still noise, just politer noise. The rule must learn the deliverable class
before it may raise, and the plan's per-task declaration is where that information already lives.
Deliberately **not** adopted: widening `isSubstantiatingPath` to include `skills/` — F9.9's argument
against it stands and this measurement does not touch it.

One caution for whoever writes the repair. The finding's own parenthetical does **not** identify the
cause: `C-EXECUTION-CONTRACT` (a skills deliverable) and `C-LEGIBLE-FAILURE` (a test-strengthening
deliverable) both present as *"N non-test src/ path(s) seen, all identical."* Classifying by that
string produces a wrong taxonomy. Classify from `WriteEvidence` digests.

Disposition: **next bundle**, with [F31](#f31) and [F32](#f32) — one surface, one repair.

---

### F31 — One audit in the report declares its absence; the other skips in silence. **[verified]**

`auditAttemptPairWriteEvidence` runs only inside `if (options.changeId)` (`review/core.ts:1296`). Invoked
as `ngrace review --path .`, with no `--change`, the entire attempt-pair audit **does not run**, and the
report says nothing about it. The same command on the same tree:

```
bun run ngrace review --path .                             → Findings: 0
bun run ngrace review --path . --change C-ESCALATION-HONESTY → Findings: 1 (warning)
```

`Findings: 0` is indistinguishable from *"the audit ran and found nothing."*

**What makes this a finding rather than an option's consequence is the asymmetry inside one report.**
The scope audit in the same output prints `Scope audit: not-run — no changed files available (working
tree clean; supply --base or --changed-files)`. It has a full absence vocabulary —
`status: "ran" | "not-run" | "unable-to-determine"` with a `reason` — built by the same track, for the
same purpose. The attempt-pair audit has none. Two audits, one report, one of them honest about not
having looked.

**The procedural half is mine and is recorded because the tool made it invisible.** `ngrace-execute`
rule 9 is explicit: *"Before setting `applied` or archiving: run `ngrace review --path . --change
C-ID`."* Through this bundle's close I ran the unscoped form. The contract was right, I was wrong, and
nothing in the output could have told me — which is the whole argument for the absence vocabulary. The
verdict recorded for `C-ESCALATION-HONESTY` was formed from a review that could not have raised this
class at all. It stands on the merits ([F9.10](#f910) shows the one finding is a false positive), but it
claimed more scrutiny than it received, and that is disclosed rather than left to be discovered.

Disposition: **next bundle**, with F9.10 and F32. The repair is an absence record for the attempt-pair
audit on the same shape as the scope audit's, so an unscoped review reports `not-run — no --change
supplied` instead of nothing.

---

### F32 — The finding points at a path that does not exist. **[verified]**

`auditAttemptPairWriteEvidence` anchors every finding at a hardcoded string:

```ts
`.ngrace/changes/active/${input.changeId}/run`
```

For an archived bundle that path is gone. All six raising bundles are archived, so **all eight findings
name a file that is not there** — including one emitted minutes after `C-ESCALATION-HONESTY` was moved
to `archive/`:

```
[warning] review.attempt-pair-unsubstantiated .ngrace/changes/active/C-ESCALATION-HONESTY/run — …
$ ls -d .ngrace/changes/active/C-ESCALATION-HONESTY/run
ls: No such file or directory
```

Small, and worth fixing with the rest rather than alone: the codebase already has `resolveChangeBundle`,
which the archive gate uses to find a bundle in either location. The finding builder does not call it.
A reviewer following the path finds nothing and has no way to tell whether the bundle moved or the
finding is stale.

Disposition: **next bundle**, with F9.10 and F31.

---

#### F9.10.1 — Amendment: the per-task deliverable declaration is rejected, on the executor's argument

[F9.10](#f910)'s disposition said the rule *"must learn the deliverable class before it may raise, and
the plan's per-task declaration is where that information already lives."* The spec author argued
against it and is right. Recorded here so the finding and the spec do not disagree.

**The declaration would be authored by the same agent whose honesty the check is testing.** A task that
fabricates a red is a task willing to write `deliverable="documentation"` beside it. The check would
consult, as its ground truth, a field supplied by the party under examination.

This is the same objection that produced trigger **D** in [F21](#f21): signature keys are agent-authored,
so an executor that cannot characterise its own failure invents a new key each time, leaving the repeat
rule blindest exactly where the checkpoint matters most. The pattern is worth naming, because it will
recur every time a check wants context only the executing agent holds: **evidence generated by the tool
can constrain the agent; evidence authored by the agent cannot.** `WriteEvidence` digests are the first
kind. A deliverable-class attribute is the second.

The surface-size argument — that it is a plan-grammar change — is real but secondary. If a later bundle
revisits this, cost will look like a weak reason and the incentive problem will still be correct.

Adopted instead: raise only when the fail and pass trees are **identical** outside `.ngrace/`. That
keys on evidence the cursor generates, not on a claim the agent makes.

**Stated plainly, because this bundle is about overclaiming:** across 26 archived bundles and 35
fail→pass pairs, the production-must-move rule fired 8 times with 0 true positives, and the
identical-tree rule fires 0 times. Neither has ever caught a real defect. The case for the swap is that
one costs a reviewer's attention on every documentation and test-strengthening task while the other
costs nothing until something is actually wrong — a good argument, and not evidence of detection. A
staged retrospective red (`git stash` → record fail → unstash) defeats both, and nothing in the planned
bundle addresses it.

---

### F33 — A criterion measured at authoring, evaluated at close, is false in between. **[verified]**

`C-SUBSTANTIATION-HONESTY`'s `AC-ARCHIVE-CORPUS-ZERO` read:

> Against repository archives **at the change's close tree**: for each of the **26** directories
> `.ngrace/changes/archive/C-*` … Aggregate finding count … over the **26** bundles is **0**.

Twenty-six was correct when the spec was written and wrong when the criterion is evaluated, because the
bundle archives itself into the corpus it measures. At close there were **27**. I approved it and did not
catch it; I found it while writing the plan prompt.

It was satisfiable — a plan may be stricter than its spec, so the plan widened to dynamic enumeration
with zero asserted across every bundle found, plus a frozen containment check for the 26 known at
authoring so the denominator cannot quietly shrink. Zero over 27 subsumes zero over 26 and nothing was
loosened. **A literal `expect(dirs.length).toBe(26)` would have failed at the exact moment the criterion
was meant to be verified**, and on every future bundle after that.

**The class, which is the point of recording it.** Three findings now share one shape:

| | what was written | why it was false at evaluation |
| --- | --- | --- |
| [F26](#f26) | a plan restated "0 errors" and dropped **at close** | unsatisfiable while the bundle is active |
| [F30](#f30) | every commit names the resume-reason requirement | the first commit predates the requirement |
| F33 | the corpus holds **26** bundles | the bundle archives itself, making 27 |

**A criterion is a statement about a future moment, written in the present tense.** Each of these reads
as complete and self-evidently true when authored, and each is false precisely when it is checked. The
tell is a criterion containing a **count, a status, or a qualifier that the change itself will alter**.

Authoring guidance, carried forward: when a criterion names a measured quantity, state **when** it is
measured and whether the change moves it. If the change moves it, write the criterion against the
invariant (*"zero findings across every archived bundle"*) rather than the measurement (*"zero across the
26"*). Keep the measurement as a recorded observation in `Assumptions`, where being a snapshot is
honest, instead of in a criterion, where it becomes a claim about a moment that has not happened yet.

Disposition: recorded, not scheduled. No artifact is amended — the plan's widening already resolved it
and the verdict discloses it. This is authoring guidance, like F26's.

---

#### F27.1 — Measured: the comparison exists, reads the wrong source, and one breach went undisclosed

[F27](#f27) said *"nothing in the toolchain compares the declared write scope against what was actually
written."* That is very slightly wrong in a way that matters for the repair, and the correction makes the
finding stronger rather than weaker.

**A comparison does exist.** `review.scope-outside-write-scope` — *"mechanized §0.7.1 scope audit"* —
calls `auditScopeOutsideWriteScope(changedFiles, scopeFiles, scopeGlobs, identity)`. Its input is
`changedFiles`, sourced `explicit | base | porcelain`: the git working tree.

**It is blind at exactly the moment it is needed.** At close everything is committed, the tree is clean,
and with no `--base` or `--changed-files` the audit reports:

```
Scope audit: not-run — no changed files available (working tree clean; supply --base or --changed-files)
```

That line appeared on `C-SUBSTANTIATION-HONESTY`'s own close verdict. The check does not fail to exist —
it declines to run, honestly, at the one moment a verdict is being formed.

**The durable record is never consulted.** `snapshotWriteEvidence` calls
`listRepositoryChangedFiles(projectRoot)` — the whole repository's changed set — and digests each path.
It is **tool-generated** (`git status`), per attempt, and it survives fold and archive. It is exactly the
kind of evidence [F9.10.1](#f9101) says can constrain an agent, as against a declaration the agent
authors. Nothing reads it for scope.

#### The measurement

Comparing every archived bundle's `WriteEvidence` paths against its plan's `ObservedWriteScope`,
excluding `.ngrace/` ledger artifacts:

| | |
|---|---|
| bundles scanned | 27 |
| bundles with ≥1 undeclared write | 3 |
| undeclared path instances | 5 |
| bundles with **no evidence to compare** | 11 (4 missing `run-ledger.xml`, 7 with zero `WriteEvidence`) |

| bundle | undeclared path | what it is |
| --- | --- | --- |
| `C-ESCALATION-HONESTY` | `src/gates/core.test.ts` | the breach F27 was recorded from — disclosed, adjudicated |
| `C-ESCALATION-HONESTY` | `docs/plans/…/decisions.md` | **authority-owned**; I edited it while the bundle was open |
| `C-TOKEN-INTEGRITY` | `docs/plans/…/decisions.md` | authority-owned |
| `C-TOKEN-INTEGRITY` | `docs/plans/…/review.md` | authority-owned |
| `C-EXECUTION-CONTRACT` | `src/test-support/token-accounting.test.ts` | **a real breach nobody ever disclosed** |

**The last row is the finding inside the finding.** `C-EXECUTION-CONTRACT` declared six files; its ledger
digests `src/test-support/token-accounting.test.ts` at `5cbcb415…`. No report mentioned it, no verdict
adjudicated it, and it surfaced only by running the comparison F27 says does not happen. Every automated
surface was silent, and unlike the `core.test.ts` case there was no disclosure to be silent *against*.

Worth stating next to [F9.10](#f910): that check had 8 firings and 0 true positives across its whole
history. This one has, on its first measurement, found a real undisclosed breach. **That is the
difference between a rule keyed to what an agent must do and a rule keyed to what the tool observed.**

#### What the measurement constrains in the repair

- **Three of five instances are authority-owned roadmap docs and must not fire.** The authority editing
  `decisions.md` while a bundle is open is ordinary and correct. A check that reports it is F9.10's harm
  arriving again. There is precedent for a path-class exclusion: `isCliLifecyclePath` already exempts
  tool-owned lifecycle paths (F11).
- **Eleven of twenty-seven bundles have nothing to compare.** They predate the evidence. The check must
  say so rather than scoring them clean — [F31](#f31) is the entire lesson, one report away.
- **Any exception mechanism must not be agent-authored** ([F9.10.1](#f9101)). A per-bundle "accepted
  out-of-scope" list in `plan.xml` fails that test on sight.
- **Two true positives will stand after the doc exclusion**, one adjudicated and one not. Whether the
  check fires retroactively on archived bundles is a real decision, not a detail: a permanently-red check
  teaches its own audience to ignore it, which is the harm F11 named.

---

#### F27.2 — Adjudicating the two historical breaches, and the rule that would have prevented both

**Neither archived bundle is amended.** `archive/` is immutable, and more to the point neither write was
wrong — only undeclared.

| bundle | write | why it happened |
| --- | --- | --- |
| `C-EXECUTION-CONTRACT` | `src/test-support/token-accounting.test.ts` | its deliverable added the `<cursor_kinds>` block to `ngrace-execute`, moving the skill line total 730 → 779; the pin **had** to move |
| `C-ESCALATION-HONESTY` | `src/gates/core.test.ts` | its approved rule change made a two-different-signature fixture stop escalating; the fixture **had** to change |

Both are self-documenting in the code they touched — `// C-EXECUTION-CONTRACT: ngrace-execute
<cursor_kinds> protocol block (730 → 779; measured)` and `// R: same signature (C-ESCALATION-HONESTY)`.
A reader of either file learns which change made the edit and why. **Nothing was concealed; the defect is
in the declaration, not in the change.** Reverting or re-opening either would damage a correct tree to
tidy a record, which is the wrong trade — the same proportionality argument F25 and F27 already made in
both directions.

Disposition: **adjudicated here, closed, not scheduled.** The `C-EXECUTION-CONTRACT` instance is hereby
disclosed — it never was, and that gap is now closed by this entry rather than by touching the archive.

#### The prevention half, which matters more than the detection half

Look at the two "why it happened" cells. They are the **same shape**:

> A change's own approved deliverable forced an edit to a pin or fixture that the plan did not list.

Not a slip, not carelessness, and not something a executor could have avoided at execute time — by then
the edit is forced and the only choices are breach the scope or fail the task. **Both were decidable at
plan-authoring time**, and in both cases the plan author (me, approving) had the information needed to
foresee them:

- a plan that changes **skill text** must declare the skill-footprint pin;
- a plan that changes a **rule** must declare the fixtures that construct instances of that rule.

`C-ESCALATION-HONESTY`'s successor bundles show this works: from `C-SUBSTANTIATION-HONESTY` onward,
`token-accounting.test.ts` is declared **whether or not the pin moves**, and it did not move — the
declaration was still correct.

So `C-DECLARED-WRITES` should carry **both halves of one finding**: the check that detects an undeclared
write from `WriteEvidence`, and a plan-authoring rule in `ngrace-plan` that prevents this class before it
is written. Detection tells you afterwards; the rule stops it happening. Shipping only the detector would
leave every future plan free to make the same omission and merely learn about it at close.

The scope cost is two files (`skills/ngrace/ngrace-plan/SKILL.md` and its packaged mirror), declared
honestly — which is exactly what the bundle is arguing for, and a better dogfood than a bundle that keeps
its scope small by leaving half the finding unfixed.

---

#### F29.1 — The dependency that justified deferring F29 does not exist

[F29](#f29) was recorded with disposition *follow-on queue*, and the justification was explicit:

> Not folded into `C-ESCALATION-HONESTY`: the fix changes `skillTextLines`'s measurement semantics,
> which the module comment says *"do not change … without updating every phase report that cites them"*
> — that is a real dependency on a survey this bundle has no mandate to run, which is the kind of
> justification [D11](#d11) asks for before anything is deferred.

**I never ran the survey.** Running it takes one command:

```
rg -ln 'skillTextLines' src/ scripts/ docs/
```

The citing documents are `docs/plans/archive/RM-AGENT-RELIABILITY/plan.md` and
`docs/plans/archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md`. Both are `status: complete` and **under
`archive/`, which is never edited.** They cite `skillTextLines().total` as **636** and **723** — neither
is today's **779**.

So the instruction is unsatisfiable in the direction it points, and unnecessary in the direction that
matters:

- **Unsatisfiable:** archived plans are immutable. "Updating every phase report that cites them" cannot
  be done for the only reports that cite them.
- **Unnecessary:** those citations are already numerically stale and *correct*, because they record what
  the measurement said at a past commit. A historical report citing a historical value is history, not
  drift.

**This dissolves the deferral.** D11 says nothing is deferred without a dependency or a conflict. The
dependency I named was a survey I had not run, and running it shows there is nothing to survey. The
deferral was not justified, and F29 has been sitting in the queue on a reason that evaporates on
contact.

Recorded plainly because it is the second time today I stated a number or a condition without running
the command behind it — the other being a commit count I tracked mentally instead of measuring. Both are
the standard I put at the top of every executor prompt, applied outward and not inward.

#### What it constrains in the repair

The comment is right about one thing even though its instruction cannot be followed: **`total`'s meaning
must not change.** Archived reports pin 636 and 723 against it, and redefining the field would silently
falsify two completed roadmaps.

So the fix is **additive, not a redefinition**: keep `total` as the line count it has always been, and
report a character or token-estimate figure **alongside** it. Every historical citation stays true, the
current pin stays meaningful, and the footprint number stops reading zero when the text agents load
grows by 9%.

The module comment itself should be corrected in the same change — an instruction that cannot be
followed is worse than no instruction, because the next reader defers on it exactly as I did.

---

### F34 — D14 clause 4's premise is false on Bun, and the handler it mandates is a regression unless it beats the default. **[verified]**

[D14](#d14) clause 4 justifies the process-fault handlers with this:

> Verified at `cae1e61`: there is no `unhandledRejection` or `uncaughtException` handler anywhere in
> `src/`. So the process can exit **0** with an error that was never reported — the loudest form of the
> failure this rule exists to prevent, caught by neither the envelope nor the exit code.

The absence is real. **The consequence drawn from it is not.** Measured on Bun v1.3.14, the runtime this
CLI ships on, with no handler installed:

| shape | exit | stderr |
| --- | --- | --- |
| `Promise.reject(new Error("boom"))` | **1** | error, source excerpt, stack frame |
| unawaited rejection settling *after* `main()` returned | **1** | same, and the return value still printed |
| `throw` inside a `setTimeout` callback | **1** | same, and the process **halts** |
| three-deep `cause` chain | **1** | **all three levels printed**, each with its own excerpt and frame |

So the failure D14 describes — exit 0 with an error never reported — **does not occur today**. Bun's
default already exits non-zero, already reports, and already walks the `cause` chain, which is more than
clause 1 asks of the conversion boundaries.

**The sharper half.** Installing a listener *replaces* that default. The naive handler — the one D14's
own trap paragraph warns about — was measured, not imagined:

```ts
process.on("unhandledRejection", () => {
  process.stderr.write("Unable to complete the GRACE command.\n");
});
```

```
Unable to complete the GRACE command.
exit=0
```

and its `uncaughtException` twin printed the same fixed sentence, exited **0**, and then ran the next
timer — `STILL ALIVE AFTER FAULT`. Against the no-handler baseline that is a loss on every axis at once:
the exit code goes 1 → 0, the cause chain goes fully printed → erased, and execution goes halted →
continuing after a fault.

**This is F25.1 exactly, one level out.** F25.1 was a broad surface wrapped in a narrow renderer that
converted coverage into uniformity. Here the broad surface is the runtime's own reporter and the narrow
renderer is the handler written to satisfy the rule that F25.1 produced. The repair for the erasure
reproduces the erasure, and it does so *by default* — a handler is a strictly worse reporter than no
handler until it is deliberately made better.

**What this does and does not change.**

- It does **not** cancel `AC-PROCESS-HANDLERS-AT-CLI-ENTRY`. The spec is approved and immutable, and the
  criterion is still worth meeting: Bun's behaviour is an unpinned runtime default, not a contract this
  repository owns, and nothing in the suite would notice if a future Bun changed it. An explicit handler
  converts a lucky default into a stated guarantee.
- It **does** set the bar. The criterion says "not a fixed fallback string alone" and "non-zero exit";
  the measurement says that clears nothing, because the default already delivers both plus the chain.
  The real bar is **at least as informative as the runtime default it displaces**: every level of the
  cause chain, and a halt rather than a continuation.
- It **does** settle the exit mechanism. `process.exitCode = 1` inside an `uncaughtException` handler
  leaves the process running — measured above — which violates clause 3's *halt the work: no
  continuation, no inferred intent, no partial write*. The handler must `process.exit` non-zero. The
  criterion's permissive "exit code **or** `process.exit` non-zero" is too weak for
  `uncaughtException`, and the stronger reading is the one that applies.

**The class, which is the part worth carrying.** D14 clause 4 asserted a consequence ("the process can
exit 0") from an observation ("no handler exists") without running the observation's consequence. That is
the same shape as [F29.1](#f291) two findings earlier — a condition stated instead of measured — and the
same shape as [F26](#f26)/[F30](#f30)/[F33](#f33): a sentence true when authored about a world nobody
checked. A rule that ships with its compliance owed should also ship with its premise measured.

Disposition: recorded before `C-CONTRACT-DEBT` T-004 is dispatched, and folded into that task's bar
rather than deferred. No artifact is amended: the spec's criterion is met by a handler that clears the
higher bar, so nothing needs superseding.

#### F34.1 — Three corrections from the implementation, two of which are mine

**1. The continuation defect is not specific to `uncaughtException`.** F34 measured that
`process.exitCode = 1` inside an `uncaughtException` handler leaves the process running, and inferred
nothing about the rejection half. The T-004 executor measured the other half and I re-measured it:

```
process.on("unhandledRejection", (r) => { …; process.exitCode = 1; });
Promise.reject(new Error("timer-reject"));
setTimeout(() => console.log("STILL ALIVE AFTER REJECTION"), 30);

→ handler saw: timer-reject
  STILL ALIVE AFTER REJECTION
  exit=1
```

So both kinds continue, and `AC-PROCESS-HANDLERS-AT-CLI-ENTRY`'s permissive *"exit code **or**
`process.exit` non-zero"* is too weak for **both**, not just one. `process.exit` is required either
way. Recorded because F34 published half a measurement and read as though it were the whole one.

**2. The handler does not clear F34's bar on every axis, and the bar was stated absolutely.** F34 set it
at *"at least as informative as the default it displaces."* Measured against Bun v1.3.14's default:

| axis | default | the shipped handler |
| --- | --- | --- |
| exit code | 1 | 1 |
| cause-chain depth | all levels | all levels |
| halts | yes | yes |
| fault kind named | **no** — both print `error:` | **yes** |
| inline source excerpts | **yes** | **no** |

Installing a listener replaces Bun's printer, so its source-line echo is unrecoverable while a listener
exists, and the criterion requires listeners for both kinds — the trade is forced, not chosen. What is
lost is a rendering affordance: `Error.stack` still carries `file:line:col` for every frame, so a reader
can still navigate to the fault. What is gained is a kind label the default lacks, and an unpinned
runtime default becoming a tested guarantee.

**Shipped, with the shortfall disclosed rather than absorbed.** The honest statement is *not* "the bar
was met" — it is that the bar was met in substance on the axes that carry information and traded on one
that carries presentation. Writing a second, prettier renderer to chase Bun's printer would be building
a dependency on the very default the handler exists to stop depending on, and would have duplicated the
chain walker the same bundle had just deduplicated.

**3. My discrimination objection was wrong.** The T-004 prompt claimed a listener-count test "may pass
even if the install were moved outside the `import.meta.main` guard", because `import.meta.main` is false
under `bun test`. That is backwards. A top-level `process.on` runs on **module evaluation**, guard or no
guard, so a test that imports `grace.ts` in a subprocess and compares listener counts catches exactly
that regression — demonstrated by the probe that put a top-level `process.on` in `errors.ts` and moved
the count `0 → 1`. The real limit is the opposite one: the test cannot prove the **positive**, that the
CLI-as-main path *does* install, and that is carried by the source pin and the `TargetAssertions`. The
executor named the test for what it pins rather than for what it sounds like, which is the right
resolution and the reverse of the [F10](#f10) failure.

Three tasks in this bundle have now returned a correction to the authority's own prompt. The rate is not
the point; the mechanism is — each was found because the prompt asked for the objection in writing rather
than asking whether the work was done.

---

### F36 — A byte digest was pinned over a committed file with nothing pinning the bytes. **[verified]**

`C-REPORT-HONESTY` added a preserved-evidence check at `src/grace-status.test.ts:697`:

```ts
const body = readFileSync(LIVE_NAN_ORPHAN);
expect(createHash("sha1").update(body).digest("hex")).toBe(LIVE_NAN_SHA1);
```

The subject is the live `NaN` orphan that [D8.3](#d83) deliberately leaves on disk
(`.ngrace/changes/archive/C-TOKEN-INTEGRITY/run/NaN-T-001-opened.xml`). The assertion is right and the
intent is right: the orphan is evidence, and evidence is bytes.

**The repository had no `.gitattributes`.** So the bytes a checkout produces were platform-dependent, and
the pin held only on the platforms that happen to check out LF. Measured:

| checkout | size | sha1 |
| --- | --- | --- |
| LF | 135 | `c0cc8899…` — the pinned value |
| CRLF | 136 | `bab374c4…` |

The file carries exactly one newline, and that one byte is the whole difference. Windows CI failed on the
first pull request that reached it, in `validate:cli`, having passed every earlier step in the same job.

**Two things make this worth recording rather than just fixing.**

First, it is this roadmap's own subject one level down. The phase exists to stop surfaces reporting
success while the thing they name is absent; here a check asserted *byte preservation* while nothing in
the repository preserved the bytes. The assertion was not weaker than its name — it was as strong as its
name and rested on an unstated environmental assumption, which is a different failure from
[F23](#f23)/[F35](#f35) and worth distinguishing: **not an assertion that measures too little, but one
whose subject is not pinned.**

Second, the blast radius is larger than the one test. This repository hashes file bytes in at least four
places — run-ledger `WriteEvidence` digests, the determinism ratchet, the packed-CLI smoke, and this pin.
Only this one reads a **committed** file, which is why only this one broke; the others hash fixtures
written at runtime and therefore carry the ambient line ending. The single failing test was the visible
edge of an unpinned invariant, not a local defect.

**Fixed at the root, not at the assertion.** `.gitattributes` with `* text=auto eol=lf`. Normalizing the
assertion instead — reading as text and stripping `\r` — would have made the check pass by removing the
property it exists to verify, which is [F35](#f35)'s defect with the sign flipped. Verified before
committing: no tracked file contains CRLF and no binary files are tracked, so the change renormalizes
nothing that exists today and `git status` shows only the new file.

**Owed, and scheduled rather than dropped.** The failure message was a bare hex mismatch, which says
nothing about *why* the bytes differ; asserting `body.length` alongside the digest would have reported
`136` against `135` and named line endings immediately. That is a `src/` edit, and this repository's own
position is that an ungoverned `src/` change is the failure mode (R4). It goes into the [F35](#f35)
follow-on bundle, which already has a governed reason to exist and already touches source. The
`.gitattributes` fix ships alone because it touches no governed surface and the pull request is blocked
on it.

---

### F35 — F20's remedy is identifier-shaped, and a third copy survives it under another name. **[verified]**

`AC-CLONE-XML-SINGLE-HOME` states the post-condition as a grep:

> After the change, `rg -n 'function cloneXmlNode' src/` reports **exactly one** definition, and it is in
> `xml.ts`.

That criterion is now satisfied, and the duplication it exists to remove is not gone. Found by the
`C-CONTRACT-DEBT` T-002 executor when the prompt asked whether `cloneXmlNode` was the *only* duplicated
`GraceXmlNode` helper — a question the spec never asked. Verified independently from the tree:

```
src/gates/ledger.ts:165   function cloneNode(node: GraceXmlNode): GraceXmlNode
src/gates/ledger.ts:192     return cloneNode(artifact.root);
```

Same algorithm, byte-for-byte apart from the identifier: `tag`, `{ ...attributes }`, recursive
`children.map`, `text`. 196 bytes against `cloneXmlNode`'s 202 — the difference is exactly the six
characters the shorter name saves across its declaration and its recursive call.

**The spec's own survey could never have found it.** The Assumption recorded at authoring HEAD is

```
rg -n 'function cloneXmlNode' src/
→ src/grace-cursor.ts:2850
→ src/artifact/run-membership.ts:50
```

and it concludes *"No third definition."* That conclusion is false, and it was false when written. The
command scoped the search to one **identifier**, and the finding is about a **body**. A survey that
ranges over a name cannot substantiate a claim about an algorithm.

**This is [F10](#f10) landing on an acceptance criterion rather than on a function or a test.** The
criterion's name — `SINGLE-HOME` — claims that the codebase holds one structural clone. Its body counts
occurrences of a string. The gap between the two is exactly the third copy, and the criterion goes green
across it. [F23](#f23) is the same shape one level down; this is the first time in this roadmap it has
been found in a spec's post-condition instead of in a test.

Two things it costs, stated plainly:

- **`C-CONTRACT-DEBT` closes F20 in name.** It genuinely fixes the two copies F20 named, and the export
  now exists in the right module, so the third copy's repair is a two-line import. But *"zero remaining
  `function cloneXmlNode` definitions outside `xml.ts`"* — the Goal's wording — is a weaker statement
  than the single-definition thesis the bundle is arguing for, and only the weaker one is true at close.
- **The open-findings count does not reach zero at this bundle's close.** That expectation was stated
  before this survey ran, on the same reasoning F29.1 already caught me on: a count asserted without the
  command behind it.

**Disposition: follow-on bundle, with the D11 conflict named.** `src/gates/ledger.ts` is not in
`C-CONTRACT-DEBT`'s `ObservedWriteScope`, and that plan is approved and immutable — the identical
constraint that produced F20 in the first place, which is worth noticing rather than being annoyed by.
Widening a task's scope because the fix looks small is the failure the plan contract exists to prevent,
and the executor was right to report it rather than take it. The successor is small: delete `cloneNode`,
import `cloneXmlNode` from `../artifact/xml`, and state the post-condition as a body-shaped check rather
than an identifier-shaped one.

**Residual carried with it, not scheduled separately.** `appendEpochToLedger`
(`src/grace-cursor.ts:2871`) inlines a **one-level** copy — `{ ...child.attributes }` and
`children: [...child.children]` — so grandchild node objects are shared with the source tree. Benign
today: the shared level is never mutated, and the array the function does mutate is freshly allocated. It
is an inconsistency rather than a bug, and it sits directly beside the restatement path at `:2272` that
uses the deep helper. The successor should unify them or record why not.

**Two authority errors the same executor corrected, recorded because the pattern is mine.** The T-002
prompt said `cloneXmlNode` had four call sites in `grace-cursor.ts`; it had five — `2077`, `2123`,
`2272`, `2794`, and the `writeEventFile` path at `3029`. And the prompt's reading of the `xml.ts`
contract — that its `SCOPE` *"under-describes rather than overclaims"* — was wrong in the half that
mattered. `SCOPE: Validation of .ngrace artifacts and path resolution` was not merely narrow: `xml.ts`
does not validate `.ngrace` artifacts (`grammar.ts` does) and does not resolve paths (it imports no
`node:path` at all — verified). It was an overclaim, which is F20's own defect, sitting on F20's
destination module. Leaving it would have closed F20 by reproducing F20 one file over. Corrected in
T-002 to describe the parse / read / traverse / clone / inspect surface the module actually has.

#### F35.1 — The same defect, one artifact down: a TargetAssertion that is already true at HEAD

Found in the same pass, checking what would actually prove D14 clause (i) before dispatching T-003.
`C-CONTRACT-DEBT`'s plan declares:

```xml
<MustContain><File>src/query/errors.ts</File><Text>cause</Text></MustContain>
<MustContain><File>src/query/command.ts</File><Text>cause</Text></MustContain>
```

Measured at `d917691`:

```
rg -n 'cause' src/query/errors.ts    → (none)
rg -n 'cause' src/query/command.ts   → 204: // Class-wide wrap must not erase unexpected causes …
```

The `errors.ts` assertion discriminates. **The `command.ts` one does not** — it is satisfied by a
comment `C-LEGIBLE-FAILURE` wrote when it *declined* to attach an object cause, which is the exact
condition T-003 exists to end. The assertion passes on the file it exists to change.

That is [F28](#f28) verbatim, and [F23](#f23) in its general form: the criterion names an ES2022 object
`cause` on a conversion boundary; the assertion measures whether five letters occur anywhere in a
297-line file, comments included.

**Not amended, and nothing is blocked.** The plan is approved and immutable, `TargetAssertions` are
evaluated at close rather than as task evidence, and the criterion that actually binds T-003 —
`AC-D14-HEAD-RED`, which requires the cause asserted by **object identity** — is not weakened by a weak
sibling. The disposition is to say so here and to tell the executor plainly that the target assertion is
information-free, so nobody reads its green as evidence.

**The pattern across F35 and F35.1 is worth naming, because it is now three artifacts deep.** A spec's
survey ranged over an identifier; a spec's acceptance criterion counted an identifier; a plan's target
assertion counts a substring. Each is a *text* measurement standing in for a *behavioural* claim, and
each goes green across the gap. The cheap discipline that catches all three: when an artifact states a
post-condition as a grep, ask what a wrong implementation that satisfies the grep would look like. If one
exists and is plausible, the grep is documentation, not evidence.

---

### F37 — The evidence a criterion points at was destroyed twice, by two ordinary git operations. **[verified]**

`C-ESCALATION-HONESTY`'s `AC-COMMIT-BODY-PROTOCOL` binds **commit bodies** as acceptance evidence, and
[F30](#f30) adjudicated compliance by naming three commits. Both halves of that evidence chain have since
been broken, by operations nobody would call destructive.

**Break one — amend.** F30's own disposition records that two commits were amended. Amending the first
rewrote every descendant, so all three cited hashes were invalidated, including the one that was never
amended. Measured on a clone that still holds the objects:

```
git merge-base --is-ancestor 338047b origin/main            → no
git merge-base --is-ancestor 338047b rm-governed-path-p0    → no
git for-each-ref --contains 338047b                          → (nothing)
```

The same for `25f1a46` and `711987c`. They survive only as dangling objects in one working clone, and on a
fresh clone `git show 338047b` fails. **F30 invalidated its own citations in the paragraph that described
the amend, and did not notice.**

**Break two — squash.** Both pull requests on this roadmap were squash-merged (`#39` → `74ef83d`,
`#40` → `ee1e1b0`). Trees are identical, so nothing about the *work* was lost, but no branch commit is an
ancestor of `main`. The tag `rm-governed-path-p0` preserves the first branch's 137 commits — and does not
help here, because the cited hashes had already been rewritten before the tag was cut.

**Why this is worse than "commit bodies are fragile".** The adjudication survived: F30's table, its
reasoning, and the gate verdict note are in artifacts on `main`, which is the model working as designed.
What did not survive is the ability to **re-derive** it. A reader who wants to check F30 rather than
trust it cannot, because the subjects it names do not resolve. That is [F9.10.1](#f9101) inverted:
evidence generated by the tool constrains the agent, but only while the evidence still exists.

Corrected above: the citations now name the surviving commits, whose bodies still read as F30 described.

### D16 — A criterion may only bind evidence that lives in an artifact

**Rule.** An acceptance criterion must be satisfiable by reading the change bundle. It may *cite* a
commit, a diff, or a branch as convenience, but it must not make one the **only** place its evidence
lives. Anything a criterion depends on is copied into the ledger, the verdict, or the decision record at
close, in the same act that judges it.

The test is one question: *after this branch is squashed, amended, rebased, or deleted, can the criterion
still be checked?* If not, the criterion is not binding evidence — it is binding a pointer.

**Consequences.**

- `AC-COMMIT-BODY-PROTOCOL`-shaped criteria stay legal, and now owe a quoted excerpt in the verdict note
  rather than a hash. A hash is a pointer; the sentence being asserted is the evidence.
- Findings that cite commits — F29's `86583b6`, F30's three, F34's measurements — should quote the
  measurement alongside the ref. F29 already does this, which is why its citation survived being right.
- **Squash-merging stays.** It was considered and kept: the CHANGELOG is generated from PR subjects, and
  the alternative — mandating merge commits for governed branches — treats git as the evidence store,
  which is the assumption this decision rejects. Tagging a branch tip before deletion remains worthwhile
  for forensics, but it is not the fix and must not be relied on as one.

**Not promoted to skill text, and this is a decision rather than an omission.** The rule is squarely
contract-first methodology and would belong in `ngrace-plan`. It is held back one bundle deliberately:
D16 has exactly one worked instance (F30), and the roadmap's own history is that a rule shipped from a
single instance gets weakened by the next one — [F9.3](#f93) was refuted by the very next task after it
was written. It is recorded here as binding on this repository now, and promoted to product once a second
bundle has authored a criterion under it. That is a dependency, not a queue: the promotion is blocked on
evidence that does not yet exist.

---

### F38 — `<Clarification>` cannot be authored in any legal form; the gate that depends on it is vacuous. **[verified]**

Found by an executor doing the ordinary thing: it needed to record a gated hole in a spec, read the
grammar's own instruction, and wrote what that instruction told it to write.

**Two rules in one file, mutually exclusive.**

| site | rule |
|---|---|
| `src/artifact/grammar.ts:1615` | the error text *instructs* `<Clarification target="IC-*\|INV-*\|AC-*">` |
| `src/artifact/grammar.ts:1623` | `<Clarification>` **requires** a non-empty `target` attribute |
| `src/artifact/grammar.ts:1637` | that target **must** be a canonical `IC-*`, `INV-*`, or `AC-*` anchor |
| `src/artifact/grammar.ts:257–265` | any canonical anchor appearing in **any** attribute value is `artifact.semantic-anchor-attribute` |

Every value satisfying the first three violates the fourth. Probed directly against
`validateSemanticAnchorDiscipline` on a minimal spec, all three advertised families:

```
AC-FOO    -> artifact.semantic-anchor-attribute: Semantic anchor 'AC-FOO' appears in attribute 'target' on <Clarification>
IC-FOO    -> artifact.semantic-anchor-attribute: Semantic anchor 'IC-FOO' appears in attribute 'target' on <Clarification>
INV-FOO   -> artifact.semantic-anchor-attribute: Semantic anchor 'INV-FOO' appears in attribute 'target' on <Clarification>
```

There is no authorable Clarification. Not a narrow family gap — the element is dead.

**Why lint is 0/0 and nobody noticed.** Zero instances exist. `C-GATE-SURFACE` specified the feature and
its spec mentions it only in prose; no bundle in the archive has ever authored one. The element shipped
and was never exercised.

**Why the test did not catch it.** `src/artifact/grammar.test.ts:692` does run the fully composed
`validateNgraceProject`, so both validators fire on its fixture. It asserts
`expect(codes(...)).not.toContain("change.invalid-clarification-target")`. The document is
*simultaneously* emitting `artifact.semantic-anchor-attribute`, and the test never looks. A negative
assertion on one code, read as "this shape is valid." This is the [F23](#f23) family — an assertion
weaker than the value its name implies — and it is the reason to prefer *document is clean* over
*this code is absent* whenever a test's subject is a shape rather than a specific diagnostic.

**Consequence, and the irony.** `RM-AGENT-RELIABILITY` D12's approve gate (bare "D12" in this
roadmap resolves to a different decision — see [F47](#f47)) refuses on an unresolved Clarification targeting
`IC-*` or `INV-*` (`src/gates/core.ts:181–182` reads `node.attributes.target`). No Clarification can
exist, so the gate can never fire. `C-GATE-SURFACE`'s own `AC-TYPED-CLARIFICATION` reads *"Without this
AC the approve gate is vacuous."* The AC shipped; the gate is vacuous.

**Footprint of the repair.** `src/artifact/grammar.ts` (shape + validator), `src/gates/core.ts:181–182`
(the approve-gate reader), and **eight** skill/template files across both trees that teach the broken
form — corrected 2026-08-12 from "six", which counted grep output lines rather than distinct files
(`ngrace-spec/SKILL.md` carries two mentions). Four canonical files, each mirrored:

```
skills/ngrace/ngrace-spec/SKILL.md:54,55
skills/ngrace/ngrace-spec/references/change-spec-template.xml:36
skills/ngrace/ngrace-plan/SKILL.md:48
skills/ngrace/ngrace-plan/references/change-plan-template.xml:55
  … each mirrored under plugins/ngrace/skills/ngrace/
```

Two of those are `.xml` **templates**, shipped for an agent to copy verbatim. The product distributes a
spec template and a plan template that cannot lint. `ngrace-plan` rule 16 states the broken form as a
numbered rule. This is the P1 objective — *"an agent can author a valid artifact without reading the
TypeScript source"* — failing on the product's own worked example, which is why the repair is not
complete without the skill and template halves in the same commit.

**Fix direction — child anchor tag, not an attribute exemption.** Exempting `Clarification/@target` is
the cheap repair and it is the wrong one: it punches a hole in the wall §3.5 principle that makes anchors
grep-stable tags, for a single element's convenience. The consistent shape already exists everywhere else
in the product — `<AffectedAreas><M-LINT-CATALOG /></AffectedAreas>` — so a Clarification should carry its
target the same way, as a self-closing anchor child. That is a grammar change with a gate-side reader
change, not a validator exemption. Settling it belongs to the bundle, not to this entry.

**Home: P1's grammar bundle, alongside `<OptionalContext>` (P1.9), as [P1.12](./plan.md).** The dependency
is real rather than a queue: it is the same file, the same class of change (an artifact-shape delta with a
consumer on the other side), and it must not be interleaved with the `lint --explain` bundle already in
flight, whose declared write scope stops at `src/lint/*` and whose NonGoals require a re-spec before
`grammar.ts` is touched.

---

### F39 — Lint reports 118 artifacts clean; 8 of them are not well-formed XML. **[verified]**

Found the same way as [F38](#f38): an executor doing the ordinary thing, reporting a workaround it
did not have to mention. Authoring `C-EXPLAIN-COVERAGE`'s plan it wrote `--explain` inside the
`DESIGN` comment block, noticed the artifact still linted clean, removed the `--` sequences anyway
because they are not well-formed, and said so in one line of its report.

**Measured across the whole artifact tree:**

```
artifacts scanned: 118        (ngrace lint: "XML artifacts checked: 117, Errors: 0")
rejected by expat: 8
  C-FLAG-HONESTY/plan.xml       C-EXECUTION-CONTRACT/plan.xml
  C-RECOVER-FOLDABLE/plan.xml   C-LEGIBLE-FAILURE/plan.xml
  C-DECLARED-WRITES/plan.xml    C-REPORT-HONESTY/plan.xml
  C-CALIBRATION-COMMAND-EVIDENCE/plan.xml
  C-ESCALATION-HONESTY/plan.xml
```

Cause is uniform: `--` inside an XML comment. XML 1.0 §2.5 forbids it; `fast-xml-parser` accepts it
and expat rejects it. The three sites checked are `--name`, `recover --fix`, and `--format only:` —
CLI flags, in comments, in a repository whose entire subject is a CLI.

**Why this is systemic rather than incidental.** The plan convention in this roadmap is a binding
`DESIGN` comment block, and the thing being designed is a command-line tool. Every flag is a `--`.
The collision is guaranteed by the two conventions meeting, and it has already happened in **eight
of the archive's plans** without one error.

**The defect is the honesty of the report, not data loss.** The product's own parser reads these
files correctly; nothing is broken today. What is false is the line `XML artifacts checked: 117 /
Errors: 0`, which claims a validity that was never checked. Any other consumer — `xmllint`, an
editor, a CI validator, a parser in another language — rejects them. That is [F10](#f10)'s shape at
the tool level: a name claiming more than the body verifies.

**Open question the repair must settle, recorded because it shapes the bundle.** Adding a
well-formedness check turns eight **archived** artifacts red, and archived bundles are immutable in
this repository. So the check cannot simply be switched on: it must be scoped to active bundles, or
emitted as a warning with the archive grandfathered, or the archive's immutability re-examined.
Whichever is chosen must be argued rather than assumed — a check that quietly excludes the eight
files that motivated it would be its own [F28](#f28).

#### F39.1 — The set is growing, and knowing the rule does not prevent it. **[verified, 2026-08-13]**

Re-measured after `C-GRAMMAR-SEAM` archived: **9**, not 8. The new offender is that bundle's own
`plan.xml:391`, `--explain` inside the `DESIGN` comment.

Its executor had **read F39, named it, and stated it was avoiding ASCII `--` in both comments** — and
still shipped one, because a long design block mentioning a CLI's flags gives the hazard dozens of
chances and care has to win every time. The bundle is archived and immutable, so the ninth offender
is permanent.

This changes the repair's shape. The original framing was eight historical files to grandfather. The
true shape is **one new offender per bundle that discusses CLI flags in a design note** — which, in a
repository whose product is a CLI, is most of them. A repair that only grandfathers the archive and
adds no forward check leaves the count climbing.

**Home: P1.13**, sequenced with [F38](#f38)'s P1.12. Both are artifact-validity repairs under
`src/artifact/`, and both must not be interleaved with the `lint --explain` bundle in flight, whose
declared scope stops at `src/lint/*`.

---

### F40 — `assertion.MustContain` names the file and withholds the text. **[verified]**

Approving `C-EXPLAIN-COVERAGE`'s plan turned lint red, which is correct — `TargetAssertions`
describe the post-implementation state. The report was this, twice, verbatim:

```
- [error] assertion.MustContain .../plan.xml — src/lint/catalog.ts must contain requested text.
- [error] assertion.MustContain .../plan.xml — src/lint/catalog.ts must contain requested text.
```

Two identical lines. `src/lint/catalog.ts` is the subject of **seven** `MustContain` assertions in
that plan, and `--format json` carries the same undifferentiated string. Nothing in the output says which
text was requested, so the executor cannot act on it without reading the plan and bisecting by hand.

`src/artifact/assertions.ts:361` is the whole story:

```ts
return [assertionIssue(assertion, shouldContain ? `${fileValue} must contain requested text.` : …)];
```

The requested text is in scope at that line and is not interpolated.

**Why this belongs to P1 and not to general polish.** P1's objective is *"when it gets something
wrong, learns the fix from the error."* This is the failure in its purest form: the diagnostic
knows the answer and declines to print it. It is the same class as P0.7 (the apply gate's
no-verdict diagnostics gained path, count and reason) and `C-LEGIBLE-FAILURE`, on a surface those
bundles did not reach.

**Related but distinct — the defect the red actually caught.** The two failing assertions name
`` This code is emitted by `ngrace review` `` with plain backticks, while `catalog.ts:864` holds
`` This code is emitted by \`ngrace review\` `` — backslash-escaped inside a template literal. The
assertion subject does not exist as written. The baseline half failed loudly, which is the system
working. The **target** half is the hazard: `MustNotContain` on that same string is vacuously true
at HEAD *and at close*, so the boilerplate this bundle exists to delete could survive and the
assertion would still pass — [F35.1](#f351) exactly. Repaired in the plan before execution by
binding to byte-accurate, branch-unique, backtick-free substrings (`See the review catalog
(src/review/catalog.ts)`, `See the gate catalog (src/gates/catalog.ts)`), not by loosening the
assertion. This is a second instance of [F36](#f36)'s family: an assertion whose subject was never
pinned to what the file actually contains.

**Correction, 2026-08-13.** This entry originally said the `detail` field is empty under
`--format json`. There is no such field: `NgraceIssue` is `{severity, code, file, line?, message}`.
Repeating that as a requirement would have mandated a new key on a versioned surface, which
[D13](#d13) refuses. The withheld information belongs in `message`, which already exists and is
what both renderers print. Caught by the executor at spec-authoring, before it reached a criterion.

**Home: P1.14**, with [P1.12](#f38) and [P1.13](#f39). Assertion evaluation lives in
`src/artifact/assertions.ts`, outside `C-EXPLAIN-COVERAGE`'s `AffectedAreas`, whose NonGoals
require a re-spec before it is touched — a conflict, not a queue.

---

### F41 — F35 was carried into a new context by a word that changed meaning. **[verified]**

`C-EXPLAIN-COVERAGE`'s spec Constraints cite *"F10 / F35 (bind the check to the guide **body**, not
a resolver identifier)"*. The plan obeyed it literally and built a predicate that searched the
`--explain` prose for three boilerplate sentences. The same task then deleted those three sentences
from the product, and the predicate became unconditionally green — a test that cannot fail, in the
one place P1 step 1 specifies *"so this cannot regress."*

**The principle was right; the transcription equivocated.** In [F35](#f35) *body* meant **function
body** — the clone helper's third copy was caught by an AST shape match with the binder as a hole,
precisely because an identifier is a name and the claim was about substance. Carried here, *body*
was read as **message body**: prose. Prose is a name for behaviour in the same way an identifier is
a name for a function. F35 forbids binding to either.

The honest analogue of F35's AST shape match is the resolution **path**: which branch of
`getLintIssueGuide` produced the answer. Verified reachable in both directions —
`xml.something-unlisted → emittable-fallback`, `totally.made-up → unknown`, against
`exact` / `prefix` / `review-catalog` / `gate-catalog` for covered codes — via a dedicated
`getLintIssueGuideResolution` accessor, so `LintIssue` payloads and `--format json` are unchanged.

**Why record it rather than just fix it.** This roadmap already knows that a rule promoted from one
instance can be refuted by the next ([F9.3](#f93)), which is why [D16](#d16) is deliberately held
back from skill text. F41 is a different failure of the same family and a worse one: the rule was
not refuted, it was **restated in a word that had shifted meaning**, and the restatement passed
three reviews — mine included — because it still sounded like the rule. When a finding is cited in
a new artifact, the citation must name the *mechanism* it forbids, not reuse its vocabulary.

Repaired in-task: the plan criterion now binds the resolution path and names two probes as its
discrimination evidence. The spec sentence that caused it is repaired by the consistency sweep that
follows, not left standing as the contract.

### F42 — A baseline `MustNotContain` needle that documentation may legitimately mention turns prose into a tripwire. **[verified]**

`C-EXPLAIN-COVERAGE`'s plan asserts, as a **baseline**, that `src/lint/catalog.test.ts` must not
contain `AC-FIX-SHAPE` — the pair whose target half requires it once T-002 lands. During T-001 the
executor wrote a comment mentioning `AC-FIX-SHAPE` to explain why the five dependency codes were
deliberately *not* being given exact guides. Lint went from 5 to 6. The comment was reworded.

The assertion behaved exactly as written, and that is the problem. The needle is an **acceptance
criterion id**, and ids appear in prose — that is what they are for. So the baseline reports
"T-002 has started" when what actually happened is "someone explained why T-002 has not started."
The available fix, deleting the explanation, makes the codebase less legible in order to keep a
state detector honest. That trade is backwards.

**The rule this argues for:** a baseline/target `MustNotContain` needle should be a string only the
**implementation** can introduce — a symbol the code must define, an exported name, a rendered
output fragment — never an identifier that comments, docs or commit messages may legitimately cite.

**Not promoted to `ngrace-plan` yet, deliberately.** One worked instance, and [D16](#d16)'s reason
applies unchanged: this roadmap has shipped a rule from a single instance and had the next task
refute it. Promote once a second plan trips the same wire. That is a dependency, not a queue.

---

### D17 — An acceptance-criterion id is an evidence anchor, and freezes the moment a run event cites it.

Raised by the executor after [F41](#f41)'s repair: `AC-COVERAGE-NO-BOILERPLATE` no longer describes
its own predicate. The check stopped hunting boilerplate sentences and now binds the resolution
path, so the id names the mechanism the criterion was **repaired away from** — F41's own defect,
sitting in the contract's identifier. The executor was right to raise it, and right not to act.

**Measured before deciding.** The id appears in `spec.xml` (4), `plan.xml` (8), `catalog.test.ts`
(2) — all editable — **and in two immutable recorded run events**:
`run/2-T-001-attempt.xml`, whose fail signature is `test:AC-COVERAGE-NO-BOILERPLATE`, and
`run/4-T-001-escalation.xml`.

Renaming would orphan a citation inside recorded evidence. That is [F37](#f37) exactly: the
adjudication survives, the ability to *re-derive* it does not, because the subject it names no
longer resolves. A rename buys an accurate label and pays with an unverifiable attempt pair — and
the attempt pair is the thing this roadmap spent P0 making trustworthy.

**Decision.** The id is frozen. The criterion **body** carries the mechanism, states plainly that
the id names the historical one, and the failure conditions name the deleted-sentence hunt as a
defect. A label is not a contract; the body is.

**The forward rule this yields — the only part that generalizes.** Name an acceptance criterion for
the **property** it protects, never for the mechanism that happens to implement it. Mechanisms are
exactly what review replaces; properties are what survive. `AC-COVERAGE-SURFACE-SPECIFIC` would
have survived this repair unchanged. This applies at authoring time, when the id is still free —
after the first `cursor attempt`, it is not.

**Promotion held.** Same reason as [D16](#d16): one worked instance. `ngrace-plan` gets it when a
second bundle names a criterion after a mechanism and pays for it.

---

### F43 — An XML artifact cannot quote XML, so a criterion that binds its own words to an emitted message is unsatisfiable. **[verified]**

`AC-FIX-SHAPE` binds a guide's remediation to the **emitted issue message**. For
`change.task-invalid-dependency` that message is (`grammar.ts:2079`):

```
Accepted shapes: multi-value text list of T-NNN ids (comma, semicolon, or whitespace),
<Task>T-NNN</Task> children, or self-closing <T-NNN /> anchor children.
```

The spec and plan name those shapes as *"Task-element children holding a T-NNN id"* and
*"self-closing T-NNN anchor children"* — a **paraphrase**, because the literal text contains
`<Task>` and `<T-NNN />`, and an unescaped tag in XML prose is parsed as a child element. That
hazard has already broken this bundle's artifacts once.

So the criterion's own words are not a substring of the thing it binds to. A fixture that took the
paraphrase as its closed expected-shape list could never go green without editing `grammar.ts`,
which this bundle forbids. The executor bound to the phrases the message actually emits and
reported the divergence rather than quietly reinterpreting the criterion.

**The cause is structural, not clumsy authoring.** GRACE artifacts are XML; escaping is mandatory;
so an artifact quoting a shape is always a *rendering* of it, never the bytes. Any criterion of the
form "the artifact's text matches the product's text" carries a silent escaping gap.

**Why this recurs, and where.** Every remaining P1 step whose deliverable is a description of XML
hits it: **P1.4** (schema reference generated from `grammar.ts` — a generated doc is exactly a
rendering of shapes), **P1.5** (generators emitting skeletons that criteria will want to quote),
**P1.6** (`--as` reporting on shapes), **P1.12** (the `Clarification` anchor-child form, which is
itself a tag that cannot be written literally in the artifact teaching it). This is not a
one-bundle wrinkle.

**The rule.** A criterion may bind an artifact's prose to a product string only where the prose is
**escape-free**. Where the target contains markup, bind to the *semantic* content — the shape names,
the separator set, the accepted forms — and assert the literal bytes in the **test**, which is
TypeScript and has no escaping constraint. State the divergence in the criterion rather than
letting the paraphrase read as a quotation. Related: [D16](#d16) (a criterion may only bind evidence
that lives in an artifact) — F43 bounds *what kind* of evidence an artifact can hold at all.

---

### F44 — A criterion that pins a user-visible string but not its position accepts two different products. **[verified]**

`AC-EXPLAIN-POINTER` requires that text lint "includes the exact pointer
`(ngrace lint --explain <code>)` once per distinct error code". T-003 shipped it as a **footer**
after the issue list. An inline suffix on each first-occurrence issue line satisfies every word of
the criterion equally, and is a visibly different product — one adds two lines to a report, the
other widens every error line.

Raised by the executor after implementing: *"Attachment site is a user-visible choice left open.
Footer and first-line suffix are both AC-legal and look different."*

**Why it matters more here than it would elsewhere.** P1's objective is that an agent "learns the
fix from the error." Where a pointer sits determines whether it is read at all — a footer after
forty issues is not the same affordance as a suffix on the line that failed. The criterion
carefully pins the exact string (correctly, per [F23](#f23)) and leaves the property that actually
governs the reading experience unconstrained.

**Kept as shipped.** The footer is defensible: it keeps issue lines diffable and stable for the
tests that parse them, and it renders once per distinct code, which is what the criterion asks. The
finding is about the criterion's reach, not the implementation's choice.

**The rule.** When a criterion governs **user-visible output**, pin *where* as well as *what* —
position, ordering, and repetition. For output nobody reads directly, the string alone is enough.
Due immediately: **P1.6**'s typed-absence line (*"evaluated N rule classes; M not evaluable"*) is
exactly this shape, and its whole purpose is that silence must not read as "will pass" — a
correctly-worded absence line rendered where nobody sees it fails that purpose while satisfying its
criterion.

---

### F45 — A red-first universal cannot cover a criterion half that is true by construction. **[verified]**

`AC-HEAD-RED` requires that *"each criterion above has a red recorded before its production edit."*
It already carves out `AC-SUITE-AND-LINT` (green at HEAD, a close-time bar). It does not carve out
the case that surfaced at close.

`AC-POINTER-JSON` names **two** surfaces: `JSON.stringify` of the `LintResult`, and
`ngrace lint --format json` stdout. The first had an honest red (event `13` fail → `14` pass,
`core.test.ts` digest held while `core.ts` moved). The second is true **by construction** —
`grace-lint.ts` stringifies the result and never calls `formatTextReport`, so no reachable code
path could ever put the pointer there. T-004 added the missing assertion; it was green the moment
it was written.

So `AC-HEAD-RED`, read literally, demands a red for a property that can only be reddened by
**breaking the renderer or stashing** — both forbidden by that same criterion and by the dispatch.
The criterion is unsatisfiable as written for that half.

**The distinction it lacks.** `AC-HEAD-RED` exists to stop a green that was never red being sold as
evidence of new work ([F28](#f28)). It does not distinguish *new behaviour* (needs a red; a green
proves nothing) from *coverage of behaviour already true* (cannot have a red; the assertion's value
is regression protection, not proof of change). Both are legitimate; only the first can carry a
red-first pair.

**Disposition: disclosed, not amended.** The spec is approved and the bundle is closing. Amending a
criterion at close so that it passes is the shape of weakening an assertion to reach green, and
this roadmap forbids that even when the amendment would be honest. Recorded here and carried into
the gate verdict note instead.

**The rule.** A criterion that names a surface true by construction must say so at authoring time
and exempt that half from the red-first universal, exactly as `AC-SUITE-AND-LINT` is exempted.
Otherwise the universal is falsified by the bundle's own honest execution. Due in **P1.5**, whose
acceptance test — *"generated output passes lint when committed unmodified"* — is the same shape:
a generator that works has nothing to redden once written.

---

### F46 — The templates the product ships for agents to copy are outside every validation surface. **[verified]**

This is **why [F38](#f38) survived**. `skills/ngrace/ngrace-spec/references/change-spec-template.xml`
and `.../ngrace-plan/references/change-plan-template.xml` are shipped as copy-sources: an agent is
told to start from them. Both teach `<Clarification target="IC-*">`, a form that cannot lint.

Measured: the templates return **0** hits in `ngrace lint`'s artifact universe. They live outside
`.ngrace/`, hold `$PLACEHOLDER` text rather than real content, and are not change bundles — so no
surface checks them. `validate:marketplace` compares the canonical tree to the packaged mirror, so
it confirms the two trees **agree**; when both teach a broken form it is green, which is
[F28](#f28) at the packaging level.

So the product distributes an authoring template that its own linter would reject, and every
validation surface reports success. An agent that does exactly what the skill says produces an
artifact that fails.

**Bounding the repair honestly.** These files cannot simply be added to `ngrace lint` — a
placeholder template is not a valid bundle and would fail for reasons that are correct. The
checkable property is narrower: *the shapes a template teaches must lint when the template is
filled in.* That is close to P1.11's *"add a check that skills' claimed shapes resolve against
[the polyglot example]"*, generalized from one example to the templates, and it is the honest form
of the "templates lint" requirement — which, stated flatly, is unsatisfiable and would have shipped
as an unclosable criterion had the executor not named it at spec time.

**Home: P1.11**, which already owns "skills' claimed shapes resolve." Widen it there rather than
opening a fifteenth step; `C-GRAMMAR-SEAM` fixes the two templates' content now, and P1.11 builds
the check that would have caught them.

### F47 — Decision ids are roadmap-scoped, and two roadmaps both have a D12. **[verified]**

`RM-GOVERNED-PATH/decisions.md:1640` — *D12: the shared membership definition gets its own file.*
`RM-AGENT-RELIABILITY/plan.md:1737` — *D12: Clarifications block; assumptions do not.*

[F38](#f38) and the `C-GRAMMAR-SEAM` brief both cite "D12's approve gate", meaning the second. An
implementer who greps **this** roadmap's `decisions.md` for D12 — the obvious move, since it is the
active roadmap — binds the run-membership decision and finds nothing about gates.

Caught by the executor at spec-authoring, before it reached a plan.

**Same family as [F41](#f41):** a citation that reads as precise and resolves to the wrong thing.
F41 was a word whose meaning had shifted; this is an identifier whose namespace was assumed global.
Both survive review because the citation *looks* checkable.

**The rule.** Cite a decision from another roadmap as `<ROADMAP> D<n>` — `RM-AGENT-RELIABILITY D12`,
never bare `D12`. Bare ids are reserved for the roadmap the citing artifact lives in. Corrected at
F38's citation site below; not swept across the archive, since archived roadmaps are immutable and
their internal citations resolve correctly within their own file.

---

### F48 — Enumerating diagnostics by their HEAD triggers orphans a code when the repair moves the trigger. **[verified]**

`AC-ERROR-TEACHES-WORKING-FORM` names its members as *"the two `change.invalid-clarification`
messages and the `change.invalid-clarification-target` message that element emits today"* — codes
identified by code **and HEAD trigger**, deliberately, so the criterion would not freeze
`grammar.ts` line numbers ([F33](#f33)).

The repair moved the mapping underneath that enumeration. At HEAD, `target="NOT-AN-ANCHOR"`
produced `change.invalid-clarification-target`. Afterwards a leftover `target` attribute is simply
an illegal attribute and produces `change.invalid-clarification`; reading its *value* as the target
would be the dual-read the spec forbids. So the trigger the criterion named for `-target` no longer
produces `-target`.

Left alone, the criterion would have been satisfied by tests covering two codes while `-target`
kept both its guide and its production emission site (`grammar.ts:1642`, a self-closing child whose
tag is not a family anchor) and lost its test. **A guide and an emission with no coverage between
them** — the same shape as the `xml.generic-` prefix guide with zero emission sites noted during
`C-EXPLAIN-COVERAGE`.

Caught by the executor, which planted a fourth case — a non-family self-closing child — so the code
retains a live post-change fixture, and reported the divergence rather than quietly treating two
codes as three.

**The rule.** When a criterion enumerates diagnostics by their current triggers, and the change
alters emission logic, re-derive the trigger→code mapping **after** the repair and confirm every
named code still has a reachable trigger. Naming codes by trigger is right — it avoids F33 — but it
is a claim about a mapping, and a repair is exactly the thing that moves mappings. Due in
**P1.13** and **P1.14**, both of which rewrite diagnostics, and in **P1.4**, where a generated
schema reference will enumerate shapes the grammar can move.

---

### F49 — The repaired gate reader filters where P0's thesis says reject. **[verified]**

T-002 moved `listClarifications` off `attributes.target` and onto the unique self-closing child,
correctly refusing the dual-read that would have kept the illegal form alive. The reader now opens:

```ts
if (node.children.length !== 1) continue;
```

An attribute-form Clarification has **zero** children, so it is silently skipped. Before this
bundle it was read and **refused**. After it, the same document is invisible to the gate and
approve **permits**.

The document is illegal either way — the grammar rejects the attribute form — but the approve gate
has **zero lint requirements** (measured: its only requirement is
`no-unresolved-ic-inv-clarification`). So nothing in the lifecycle stops a lint-failing bundle from
being approved, and the one surface that used to notice this particular malformation no longer
does. Note the live scenario: six teaching sites still instruct the attribute form until T-004
lands, so this is the shape an agent is currently most likely to write.

**Why this is a finding rather than a nitpick.** P0 of this very roadmap is titled *"Reject, don't
filter: the integrity cluster"* and its objective is *"every unrecognized authored token becomes an
error. No silent drops."* A Clarification whose shape the reader cannot interpret is exactly an
unrecognized authored token, and it is being dropped. The bundle repairing one silent-teaching
defect reintroduced a silent-drop one layer down. The same reader also accepts any unique
self-closing child — a `<FOO />` is recorded with target `FOO` and then ignored downstream, while
`isClarificationTarget` remains exported and unused by the new reader.

**Deferred, with the conflict stated (D11).** The repair is a **new gate behaviour** — raising on a
Clarification the reader cannot interpret — which is outside what the approved spec authorizes the
gate to do, and this bundle has already taken one re-spec. The defect manifests only on documents
that already fail lint. That is a conflict, not a schedule.

**Home: P1.12's follow-on, or the first bundle that touches gate requirements.** Two candidate
shapes, to be argued there rather than assumed: the reader raises on an uninterpretable
Clarification, or the approve gate gains a lint-clean requirement — the second is larger and would
close the whole class rather than this instance.

### F50 — A plan's design note instructs an edit to itself that the same plan forbids. **[verified]**

`C-GRAMMAR-SEAM`'s plan, design note D7 (`plan.xml:704`): *"execution companions; **expand OWS at
execute** if …"*. The plan is approved and immutable, and `ngrace-execute` says so. Following D7
means editing an approved artifact; following immutability means leaving `ObservedWriteScope`
incomplete while the cursor writes `run.xml` and `run/*`. Both cannot hold.

The executor followed immutability and disclosed the unlisted writes — the right call, and the same
one it made in `C-EXPLAIN-COVERAGE`, where the identical note appeared. **Twice in two bundles,
because the note is copied forward with the plan template.**

**The rule.** A plan may not instruct its own amendment. Cursor companions (`run.xml`, `run/*`,
`run-ledger.xml`) are written by the CLI, not the agent, and belong in `ObservedWriteScope` **at
authoring time** or in a standing exclusion — the same category error [F27](#f27) settled for the
review scope audit, which stopped auditing the CLI's own writes against the agent's declared scope.
Fix the note at the source: it originates in the plan authored from
`.ngrace/changes/archive/C-EXPLAIN-COVERAGE/plan.xml` as the model, so the next plan authored from
that model inherits it again.

---

### F51 — A measurement pin makes every file it measures a transitive forced write. **[verified]**

T-004 edited the eight skill and template files that taught the unauthorable `<Clarification>`.
That moved a byte total pinned in two places outside the bundle's `ObservedWriteScope`:

```
src/test-support/token-accounting.test.ts:47   expect(measured.totalBytes).toBe(53771)  → 53864
README.md:286                                  **779 lines** / **53771 UTF-8 bytes**
```

Measured: neither path appears in `plan.xml` (0 hits). The executor stopped rather than breach
scope, leaving `bun test` at 1274 pass / **1 fail** — and T-005 claims `bun test` green, so the
close task is blocked by its own plan's scope.

**Why this is not simply [F27.2](#f272) again.** The two historical breaches were *direct*: a
deliverable wrote a file the plan had not listed. This one is **transitive and invisible at
authoring time**. The plan author would have had to know that editing skill prose moves a byte
total asserted in a test file nobody is touching, in a bundle about grammar and gates. There are
**16** `SKILL.md` files under that pin, so every future bundle that edits any skill text inherits
the same unlisted forced write.

**The pin is working exactly as designed, which is the point.** It exists because of
[F29/F29.1](#f29): the footprint measure counted lines, so a 962-byte rewrite of agent-loaded skill
text registered as zero movement, and `totalBytes` was added beside the frozen line total so that
change would register. It registered. It just registers as a failure in a file outside every
skill-touching bundle's natural scope.

**Resolved here by amendment, not deferral.** The write is forced by the approved deliverable, so
per F27.2 `ObservedWriteScope` must cover it; both paths are added and the pin is updated to the
measured value. Deferring would leave a knowingly-red suite behind a close criterion that demands
green.

**The forward rule.** A bundle that edits any `SKILL.md` must list `token-accounting.test.ts` and
`README.md` in `ObservedWriteScope` at authoring time. Better, and the shape to argue when a bundle
next touches that surface: a hand-maintained literal that every skill edit invalidates is a
maintenance tax with no reader — the honest forms are a tool-updated value or an assertion on
*movement being declared* rather than on a frozen number. Not opened here: this bundle has already
taken one re-spec, and the pin's current form is what two archived roadmaps cite.

---

### F52 — "AffectedAreas binds the plan" names a check that is weaker than the belief it creates. **[verified]**

`C-GRAMMAR-SEAM`'s spec — and `C-EXPLAIN-COVERAGE`'s before it — glosses its closed file list as
bound by `change.plan-scope-exceeds-spec`. Measured at `src/artifact/grammar.ts:1867`, that code:

- compares **`DurableScope` anchors** against anchors the spec mentions — not `ObservedWriteScope`
  file paths against `AffectedAreas`;
- emits a **warning**, not an error.

So the sentence that makes a plan author believe file-level scope is mechanically enforced names a
check that never looks at files and could not block anything if it did. Declared file scope is
enforced by the review audits at close — the `WriteEvidence` scope audit — and by nothing at
authoring time.

Raised by the executor at close, correctly left untouched: it is spec prose, pre-existing, and the
criteria around it are sound.

**Why it matters beyond the wording.** This is the third check in one bundle found weaker than its
description — with [F49](#f49) (a reader that skips what it cannot interpret) and the
`validate:marketplace` green that only proves the two trees *agree* ([F46](#f46)). The pattern is
consistent: a check's **name** and its **blast radius** drift apart, and the artifact citing it
inherits the optimistic reading. [F41](#f41) is the same failure applied to a finding citation
rather than a check.

**The rule.** When an artifact cites a diagnostic as the thing that binds a constraint, state what
that diagnostic actually compares and at what severity. "Bound by `X`" is a claim about a
mechanism, and mechanisms are exactly what [F35](#f35) says to verify by body rather than by name.
Not swept across existing specs: they are approved and their criteria do not rest on the gloss.

---

### F53 — Every bundle hash on the phase board is branch-only. F37 fixed one instance, not the practice. **[verified]**

[F37](#f37) established that squash-merge leaves no branch commit an ancestor of `main`, so a cited
hash stops resolving. Its remedy was applied to the three commits it named. The **practice** was
never changed, and the board kept citing hashes.

Measured across the P1 phase row — every bundle citation on the board, thirteen of them:

```
a4b9ce7  BRANCH-ONLY      f10f868  BRANCH-ONLY      3f26381  BRANCH-ONLY
5872ebb  BRANCH-ONLY      5a1b28b  BRANCH-ONLY      … all thirteen
```

Not one resolves on `main`. Two of them I wrote **this session**, one session after recording F37 —
which is the point worth keeping: the finding was known, recorded, and re-committed by its own
author, because the record fixed the instances and left the habit.

**The citation was never load-bearing.** A bundle's evidence is its archived directory —
`.ngrace/changes/archive/C-*/` with its `spec.xml`, `plan.xml` and folded `run-ledger.xml` — and
that path *does* survive merge, because it is content, not history. The hash added a second, weaker
name for something already durably addressed. [D16](#d16) says a criterion may only bind evidence
that lives in an artifact; the same reasoning applies to a *record*, and the hash was the part that
did not.

**Repaired at the two sites I authored:** both now link the archive directory. The eleven P0
citations are left as written — they are historical entries whose breakage F37 already documents,
and rewriting them would edit the account of what happened rather than the practice.

**The rule.** Cite a bundle by its **archive path**, never by commit. Where a commit genuinely must
be named — a release tag, a revert target — tag the branch tip before deleting it, and cite the
tag. Tags survive; branch tips do not.

### F54 — A closed path allowlist cannot be exact at a parse site that never learns the project root. **[verified]**

`C-ARTIFACT-VALIDITY` decides archive treatment as **option 3**: a frozen, closed allowlist of the
nine current offender paths, every other path erroring. The spec also pins the emission home inside
`parseGraceXmlArtifact`, which is the correct coverage decision — it is the one function every
`readGraceXmlArtifact` caller funnels through, so no artifact escapes the check.

Those two correct decisions are in tension, and the tension only appears at plan time.

`parseGraceXmlArtifact(file, text)` receives **no project root**. Measured at `ce451dc`, the `file`
argument is not in one form:

- `resolveNgracePaths` calls `path.resolve` on the project root, so the production lint path reads
  archived plans as **absolute** `path.join` results;
- `src/review/core.ts` passes a variable named `abs`;
- unit tests pass **bare relative** names such as `plan.xml`.

So `allowlist.has(file)` against project-relative entries misses **every listed file on the exact
path that protects this repository's `0/0` close bar**. A naive implementation does not fail loudly;
it turns nine archived plans red and looks like the check working.

The plan settles a normalize-then-suffix rule: slashes normalized, a leading `./` stripped, and a
file admits iff its normalized form equals a listed entry or ends with `/` + entry.

**The residual is real and is not a rounding error.** Any path ending in a listed entry is admitted
— including an identically named archived plan in a *different project tree*. A downstream GRACE
project that archives its own `C-DECLARED-WRITES/plan.xml` containing the forbidden sequence is
silently admitted by this repository's allowlist. That is the shape the spec rejected as "option 1
wearing a list", reappearing across project boundaries rather than across directories.

**Why it ships anyway.** Exact project-relative identity requires threading a project root through
`readGraceXmlArtifact` and its call sites — roughly eighty of them across `src/`. That is outside
the spec's forced write surface and is a re-spec, not an implementation response. [D11](#d11) is
satisfied: this is a genuine conflict, not filing.

**The rule.** When a check compares a path against project-relative product data, establish *at
authoring time* what path form the emission site actually receives, and in how many forms. A
constant that reads as project-relative is not evidence that its consumer ever sees that form. Where
exactness is unreachable, the artifact states the false-admit surface in prose — an undisclosed
loose match is [F46](#f46) / [F52](#f52): a check whose name claims more than its body compares.

**Home:** the residual is scheduled against a project-root parameter for `readGraceXmlArtifact`, not
against this bundle. Not yet assigned to a phase.

### F55 — `assertion.command-not-evaluated` withholds its subject exactly as the containment codes do. **[verified]**

Measured at plan-approval time for `C-ARTIFACT-VALIDITY`, running the plan's own target assertions:

```
ngrace lint --path . --change C-ARTIFACT-VALIDITY --assertions target
```

Fifteen errors. Eleven are the containment codes this bundle repairs. The other four are:

```
- [error] assertion.command-not-evaluated … — MustPassCommand requires explicit command execution opt-in.
- [error] assertion.command-not-evaluated … — MustPassCommand requires explicit command execution opt-in.
- [error] assertion.command-not-evaluated … — MustPassCommand requires explicit command execution opt-in.
- [error] assertion.command-not-evaluated … — MustPassCommand requires explicit command execution opt-in.
```

Four `MustPassCommand` entries naming four different commands, four byte-identical messages. The
evaluator holds the command string and does not say it. This is [F40](#f40)'s class exactly — the
product knows a fact and declines to say it on an agent-facing surface — on a code
`C-ARTIFACT-VALIDITY` does not touch.

The same run also demonstrates the defect the bundle *does* repair, on the bundle's own plan:
`src/artifact/xml.ts must contain requested text.` printed twice for two different pinned texts.
The withheld-subject class is not one site; it is a habit in this layer.

**Not folded in.** The spec confines P1.14 to `evaluateTextContainment`'s containment-failure path
and its NonGoals reject opening the catalog for codes the deliverable does not need. Repairing
`assertion.command-not-evaluated` here would be scope the spec closed. [D11](#d11) is satisfied by a
genuine conflict, not by filing.

**Home:** P1's remaining steps, as a sibling of P1.14. Any bundle that opens
`src/artifact/assertions.ts` for message work should sweep the file's other withheld subjects rather
than repair one code at a time — the one-code-at-a-time shape is what left this instance standing
after `C-LEGIBLE-FAILURE` and P0.7 both passed through the same layer.

### F56 — A plan's red-first decomposition collided with the product's flailing detector, and the authority approved the collision. **[verified]**

`C-ARTIFACT-VALIDITY`'s approved plan required **four distinct fail signatures on T-001** before any
production edit — one per criterion, which is what red-first discipline asks for.

Measured in the product:

- `src/grace-cursor.ts:183` — `export const FIX_DISTINCT_SIGNATURE_BUDGET = 4;`
- `src/grace-cursor.ts:1692` — escalation fires when `distinctKeys.size >= FIX_DISTINCT_SIGNATURE_BUDGET`

So the **fourth planned red is also the escalation trigger**. The plan could not be executed as
approved without tripping it. In the archived ledger: event 5 records the fourth red, event 6 is an
escalation listing all four planned signatures, event 7 is a resume whose `Reason` cites the plan's
own D8, event 8 is the production pass.

**The executor handled it correctly and reported it.** The reds are genuine, the attempt-pair audit
is clean, and nothing was hidden. But the judgement call — whether a planned red sequence may resume
through an escalation — belonged to the authority, and the plan handed it to the executor by
omission.

**The skill text is not the defect.** The executor reported `ngrace-execute/SKILL.md` as stale on
this. It is not: canonical and packaged are byte-identical and both say *"Escalation fires on 2
failed attempts of the same signature, or on 4 distinct failing signatures in the current window —
not on any two fails regardless of signature."* That matches the binary exactly. Corrected here so
the ledger does not carry a false claim about the skill.

**The real defect is that the budget cannot distinguish a planned red-first sequence from an
executor thrashing.** Both look like *N* distinct failing signatures in one window. The two
mechanisms push in opposite directions: red-first rewards one signature per criterion, and the fix
budget reads accumulating distinct signatures as loss of control. A task with four criteria is
therefore unexecutable without a resume, and the more faithfully a plan follows [D17](#d17) — name
criteria for the property, one red each — the sooner it collides.

**The rule.** A single task may plan **at most three** distinct fail signatures. A task needing more
gets split, or the plan pre-authorizes the resume in its design note with the reason the executor
should cite — so the escalation is a recorded checkpoint rather than a decision delegated by
accident. Authorities approving a plan should count planned distinct reds per task against the
budget before approving; this one was not counted.

**Home:** `ngrace-plan` (the cap, or split guidance) alongside [F50](#f50) and [F51](#f51), which are
also fixed at the plan-template source.

### F57 — The bundle that made errors name what they withhold shipped an error that withholds where. **[verified]**

`xml.comment-not-well-formed` names the file and the rule, and does not say **which comment**. The
scanner holds the position: `collectCommentWellFormednessIssues` walks to `commentAt` and then emits
a constant message. `NgraceIssue` has an optional `line` field, and the sibling `xml.parse`
populates it from the validator. On an artifact with many comment blocks the agent is told the file
has a bad comment somewhere.

That is this bundle's own thesis one level down — the product knows a fact and declines to say it on
an agent-facing surface, which is [F40](#f40)'s class and P1's whole objective.

**Measured before judging it a defect.** Across `src/`, only about four emission sites populate
`line` at all (`xml.parse`, and three `contractLine` sites in `src/lint/core.ts`). Omitting it
follows house behaviour rather than departing from it, and no criterion in the approved spec asked
for a position — AC-COMMENT-ERROR-TEACHES binds three semantic facts and their order, nothing about
location. So this is a gap the spec did not close, not a criterion violated.

**Not repaired at close, and the reason is not convenience.** Adding the position is new behaviour,
which needs a red, which needs a criterion that does not exist. Authoring a criterion at close to
bless code about to be written is exactly the [F28](#f28) shape — evidence written to fit the
outcome. [D11](#d11) is satisfied by that conflict.

**The rule.** A diagnostic that locates a defect inside a file should carry the position it already
computed. When a bundle creates a new diagnostic, its spec should decide the position question
explicitly rather than inheriting silence from house style — the silence is what let this one ship
inside the bundle least entitled to it.

**Home:** the first bundle that opens `src/artifact/xml.ts` emission, or a P1 follow-on; sibling of
[F55](#f55), which is the same withholding on `assertion.command-not-evaluated`.

### F58 — An archived bundle leaves a phantom directory across branch switches, and lint reports it as a missing artifact. **[verified]**

Measured while merging the P1 stack. After `feat/explain-coverage` merged and `feat/grammar-seam`
was rebased onto it, `ngrace lint --path .` on the rebased branch reported:

```
- [error] xml.missing-file … /.ngrace/changes/archive/C-ARTIFACT-VALIDITY/spec.xml
```

for a bundle that branch does not contain. On disk, `.ngrace/changes/archive/C-ARTIFACT-VALIDITY/`
existed holding exactly one thing: an empty `run/` directory. `git ls-files` on that path returned
**zero** entries, and `git status --short` was **clean**.

**Cause.** `cursor fold` empties `run/`, archiving `git mv`s the bundle including that empty
directory, and **git cannot track an empty directory**. Switching away from the branch deletes the
four tracked bundle files and leaves `run/` behind, which keeps its parent alive. Lint then finds a
directory under `changes/archive/` and correctly demands the `spec.xml` that a bundle directory must
have.

**Why it costs more than it should.** The emitted error says an XML artifact was not found for a
bundle that was archived minutes earlier, which reads as data loss. The real cause is a git
limitation about empty directories, and `git status` actively conceals it — the one command an agent
would reach for reports a clean tree. Nothing in the message points at the empty directory.

**The rule.** `xml.missing-file` on a bundle that should not exist on the current branch is a
phantom directory, not a lost artifact. Confirm with `git ls-files <dir>` returning nothing, then
`rm -rf` it. A repository that stacks bundle branches will hit this at every switch.

**Home:** worth a diagnosis line in the `xml.missing-file` guide — when the named path's directory
exists but is empty of tracked files, say so. Sibling of [F57](#f57): a diagnostic that holds the
information that would end the search and does not say it.

### F59 — The merge sequence this stack was handed was wrong, and the F53 tags are what caught it. **[verified]**

The procedure was carried in the session handoff rather than in any committed document — checked:
no file under `docs/plans/active/RM-GOVERNED-PATH/` contained it, which is part of why it survived
unexamined. It specified, for each bundle in turn:

```
git rebase --onto main <branch-below> <branch-to-rebase>
```

That is correct exactly once. Measured at the third merge:

```
p1-grammar-seam   (original tip)  23405f9
feat/grammar-seam (after rebase)  3aaf226

git rev-list --count feat/grammar-seam..feat/artifact-validity   →  36
git rev-list --count p1-grammar-seam..feat/artifact-validity     →   8
```

Once `feat/grammar-seam` is itself rebased, its commits are rewritten, so `feat/artifact-validity`
no longer descends from the branch **name**. The range then resolves to every commit not reachable
from the rewritten branch — 36 instead of 8 — and the rebase begins replaying the *first* bundle's
commits onto a `main` that already contains them in squashed form. It conflicted on
`docs(ngrace): record F38`, a commit from two bundles earlier, which is the tell.

The correct upstream is the branch-below's **original** tip. That is precisely what the `p1-*` tags
preserve, and [F53](#f53) created them for a different reason — so a bundle could be cited after its
branch died. They turned out to be load-bearing for the merge itself.

**The rule.** In a stack, rebase each branch onto `main` using the **tag** of the branch below, never
its name:

```
git rebase --onto main p1-<branch-below> <branch-to-rebase>
```

Tag every branch tip **before** the first rebase in the stack, not before deletion. A rebase whose
count does not match the bundle's commit count is using the wrong base — check the count before
resolving a single conflict, because the conflicts are a symptom and resolving them would quietly
duplicate merged work.

### F60 — The product implements glob matching twice, the two disagree on zero-depth `**`, and the weaker copy governs the scope audit. **[verified]**

Measured at `1de1d92` while deriving P1.4, running both implementations on the case P2.1 pins:

```
glob             x file                  review  scope   AGREE?
web/js/**/*.js   x web/js/app.js        false   true    ** NO **
web/js/**/*.js   x web/js/sub/app.js    true    true    yes
src/**/*.ts      x src/a.ts             false   true    ** NO **
src/**/*.ts      x src/x/a.ts           true    true    yes
src/**           x src/a.ts             true    true    yes
```

Two homes:

- **Canonical.** `src/artifact/scope.ts` — `parseScopeGlob` / `observedWriteScopeContains`,
  segment-based, globstar must occupy a whole path segment, exported, and it **already admits
  zero-depth `**`** (git/minimatch semantics).
- **Duplicate.** `src/review/core.ts:1116` `matchSimpleGlob`, private, commented *"Minimal glob:
  `**` / `*` only"*, built by regex substitution: `**` → `.*`, `*` → `[^/]*`. Because the literal
  `/` between `**` and the next segment survives the substitution, `**` requires **at least one**
  intervening segment.

**The live consequence is a false positive in a governance audit.** `auditScopeOutsideWriteScope`
(`src/review/core.ts:979`) tests changed files against plan globs with the duplicate. A plan that
declares `Glob src/**/*.ts` and writes `src/a.ts` is **inside** its approved `ObservedWriteScope` by
the canonical parser and gets reported `review.scope-outside-write-scope` by the audit. Every bundle
this roadmap has closed used explicit `<File>` entries plus a `run/**` glob, where zero-depth never
arises — so the audit's 0-findings results are true, and they are not evidence this path works.

**What it does to P1.4.** The roadmap orders P1.4 → P2.1 so *"the schema reference must state
zero-depth `**` before review changes behaviour."* That framing assumes one semantics with review
lagging. There are two semantics **now**, and a reference generated from the grammar would document
the canonical one while a shipped code path contradicts it. A generated document cannot be the
single truth about a rule the product implements two ways.

**The rule.** A semantic named in generated documentation must have exactly one implementation. Where
a second private copy exists, the repair is to delete the copy and call the canonical parser — not to
teach both. Before documenting any behaviour as canonical, grep for a second implementation of it;
`matchSimpleGlob` is private and would not surface in an export survey.

**Home:** P2.1 already owns the zero-depth change and its release note. This finding narrows it: the
work is *deleting the duplicate*, not changing a semantic. This is the same class as
[F46](#f46) / [F49](#f49) / [F52](#f52) — a check whose blast radius and whose name have drifted
apart — and the same class as [D16](#d16)'s concern that a claim must be anchored to what actually
runs.

**Discharged by [`C-ONE-GLOB-LANGUAGE`](../../../../.ngrace/changes/archive/C-ONE-GLOB-LANGUAGE/), matchSimpleGlob deleted; both scope audits route through observedWriteScopeContains.**

### F61 — The comment well-formedness check makes CLI flags unwritable inside XML artifacts. **[verified]**

`C-ARTIFACT-VALIDITY` shipped `xml.comment-not-well-formed`, which errors when an XML **comment body**
holds two adjacent ASCII hyphens. Every artifact authored after that bundle is subject to it, and the
frozen path allowlist covers only nine archived files.

**The consequence nobody stated when the check shipped: a dashed long flag cannot be named in a
`DESIGN` comment.** `C-SCHEMA-REFERENCE`'s spec calls for a writer "check mode", and the authoring
prompt described it as a *check-mode flag*. Writing that flag the way a user types it puts the
sequence into the comment body and turns the artifact red at lint. The executor caught this at
authoring and routed around it: the plan specifies the bare argv token `check` plus an exported
`checkSchemaReference(root)`, and never writes a dashed form.

**This is correct behaviour, not a defect** — the sequence genuinely cannot appear in a conformant XML
comment, and the check is enforcing the XML specification rather than a house rule. But it is a
standing authoring constraint that will recur on every bundle whose subject is a CLI surface, which
in this repository is most of them.

**The rule.** When an artifact must refer to a dashed CLI flag, name the underlying argv token or the
exported function instead, and put the dashed form only in `src/**/*.test.ts`, where it is code rather
than comment prose. This is the same move [F43](#f43) requires for XML-inside-XML: **bind the semantic
in the artifact, assert the literal bytes in a test.** Scan comment bodies — not delimiters, which
always contain the sequence — before reporting an artifact clean.

### F62 — The authority's prompts keep asserting a lint expectation the authority has not measured. **[verified]**

The plan-authoring prompt for `C-SCHEMA-REFERENCE` told the executor that a draft plan beside an
approved spec "is syntax-checked only, so the expected result is 0 errors / 0 warnings". Measured
after authoring: **1 error**, `change.graph-anchors-miss-write-scope`, because `ObservedWriteScope`
lists `src/artifact/schema-reference.ts` before that file exists. `linksByPath` is built from files on
disk, so the check cannot resolve a path the change has not yet created.

**This is the second instance of the same error class in this roadmap.** The first told an executor
that bare `ngrace lint` would emit `assertion.change-not-approved` for a draft plan; it does not,
because the default assertion mode evaluates approved baselines only. Both times the prompt asserted a
lint outcome the authority had not run for that artifact shape, and both times the executor measured
and corrected it.

**Neither claim was harmless.** A prompt that names the wrong expected result teaches an executor
either to manufacture the predicted number or to distrust the prompt. `RM-GOVERNED-PATH D12` had already authorized
exactly this window and [F19](#f19) had already ruled that the approval commit carries the predicted
error and names it in the body — so the correct instruction existed in the ledger and the prompt
contradicted it.

**The rule.** A prompt may state an expected lint result only when the authority has run that exact
command against that exact artifact shape, or when the ledger already rules on the window. Otherwise
state the window and ask the executor to measure. **The general form is the standing one — measure,
do not estimate — and it applies hardest to the authority's own instructions**, which an executor
reads as settled fact.

### F21 correction — the attempt budget was renamed and narrowed, not deleted. **[verified]**

**This entry was itself wrong on first writing, and the corrected text is below.** The first version
claimed `FIX_ATTEMPT_BUDGET` was simply gone and that `FIX_DISTINCT_SIGNATURE_BUDGET = 4` was the
only budget and the only escalation site. That was produced by a grep for the old name and the
distinct-signature name — **neither of which could match the constant that actually replaced it.**

**What the product does, measured at `6335e3f`.** `src/grace-cursor.ts` declares **two** budgets:

```
FIX_SIGNATURE_REPEAT_BUDGET   = 2   (:177)
FIX_DISTINCT_SIGNATURE_BUDGET = 4   (:183)
```

`decideFixBudgetEscalation` (`:1683`) evaluates **trigger R before trigger D**: R fires when the
current signature has occurred `>= 2` times in the window under **exact kind plus key equality**; D
fires when the window holds `>= 4` distinct signatures.

**So [F21](#f21)'s substance holds and its constant does not.** F21's real finding was that the
counter was *outcome-blind and signature-blind* — any second attempt in the window, of any outcome,
armed the escalation. That behaviour is genuinely gone: the repeat budget now requires the **same**
signature. What survives is a repeat budget of 2, which the first correction erased.

**Consequence for planning, and it cuts the other way from [F56](#f56).** F56 caps *distinct* reds
per task at 3. Trigger R adds a second, independent cap: **a task may never plan the same
signatureKey twice in one window.** Two reds in a task are safe only because their keys differ —
which is exactly why `C-SCHEMA-REFERENCE`'s `T-001` and `T-003` executed without an escalation.
A plan that reddened the same criterion twice would pause on the second fail.

**`ngrace-execute/SKILL.md` is accurate on all of this** and always has been. Lines 38, 65 and 90
state both triggers, and line 65 explicitly rules out "any two fails regardless of signature".
Canonical and packaged are byte-identical. An executor has now reported this file as stale on the fix
budget **twice**, both times wrongly; the likely cause is that the sentence leads with "2 failed
attempts" and the qualifying clause reads as droppable.

**The rule, sharpened.** A finding that quotes a constant is a measurement with an expiry date — but
re-measuring by grepping *the name the finding used* only proves that name is absent. **A rename is
indistinguishable from a deletion under that grep.** Verify the behaviour at its decision site
(`decideFixBudgetEscalation` here), not the identifier, before reporting a mechanism gone.

### F62.1 — the class is wider than lint expectations: three unmeasured survey facts in one prompt. **[verified]**

[F62](#f62) recorded the authority asserting an unmeasured *lint* expectation three times. The
`C-SKELETON-GENERATORS` spec brief shows the same defect on **survey** facts, three in one dispatch,
all three caught by the executor and all three confirmed against the tree afterwards:

- *"six existing template files."* `find skills plugins -name "*template*.xml"` returns **ten** files
  across **five** kinds (change-spec, change-plan, design-context, design-system, migration-report),
  each mirrored. The authority had run that exact command, seen ten paths, and then wrote a number it
  had not counted.
- *"`renderModuleContract` / `renderModuleMap` … reachable only from tests."* Both are **private** in
  `src/test-support/fixtures.ts`; only `commentPrefixForExtension` carries `export`. The brief
  described a public API that does not exist.
- *"the sharpest thing in the bundle"* (singular), naming `change.plan-requires-approved-spec`. There
  were **two**. The second — the shipped plan template's `<File>src/path/to/file.ts</File>` raising
  `change.graph-anchors-miss-write-scope` even beside an *approved* spec — is the one that actually
  falsifies the roadmap's acceptance test, because it means copying the current template can never
  satisfy it. The executor reported that a framing naming one edge is what would have hidden it.

**The rule.** A survey fact handed to an executor is a measurement claim and inherits F62's
discipline: state it with the command that produced it, or do not state it. **A singular framing
("the trap is X") is itself an unmeasured claim** — it asserts completeness of a search that was
never run. Name the traps found and say the list is not closed.

The standing report contract is what caught all three. It has now produced a finding on **every
dispatch across five bundles**.

### F63 — regenerating a teaching template from a minimal-skeleton renderer deletes the teaching, and the skill text keeps pointing at what was deleted. **[verified]**

`C-SKELETON-GENERATORS`'s draft spec resolves [F46](#f46)'s "templates are an unchecked second
grammar" by making the four spec/plan template files **byte-identical to the generator's output**,
with a check-mode script composed into `validate:ci` — the [`C-SCHEMA-REFERENCE`] precedent, applied
faithfully. The same spec also decides the renderer emits **required sections only** (optional
`Problem`, `Assumptions`, `DesignReferences`, `Clarifications`, `OutOfPlanScope` are omitted) and
declares `SKILL.md` out of scope under [F51](#f51). Those three decisions are individually defensible
and jointly delete product.

**Measured at `3e5c3d8`.** The two templates are not minimal skeletons; they are teaching artifacts.
`change-plan-template.xml` (59 lines) carries commented, filled examples of `OutOfPlanScope` and
`Clarifications`; `change-spec-template.xml` (40 lines) carries `DesignReferences`, `Assumptions`,
and the same `Clarifications` block. The `Clarification` example teaches the self-closing anchor-child
form — *"Target is exactly one self-closing IC-*, INV-*, or AC-* child. Never use prose"* — which is
**`C-GRAMMAR-SEAM`'s product change**, the bundle that made the element authorable at all and fired
`RM-AGENT-RELIABILITY` D12's approve gate for the first time in this repository's history. Byte-identity to a
required-sections-only renderer deletes that example from both trees.

And the skills keep pointing at it. `skills/ngrace/ngrace-spec/SKILL.md:105` instructs the author to
write `spec.xml` *from* `references/change-spec-template.xml` and to *"Add `DesignReferences` when
Figma or research artifacts exist"*; `skills/ngrace/ngrace-plan/SKILL.md:29` produces `plan.xml` from
its template. With `SKILL.md` out of scope, both lines survive the regeneration and point at a file
that no longer shows the shape they name — the [F46](#f46) defect inverted: instead of a template
teaching a form the product rejects, a skill teaches a form the template no longer contains.

**Why it is not caught by the bundle's own gates.** The check the spec designs compares the template
to the renderer, so the two agree *by definition* after regeneration. `validate:marketplace` only
proves the canonical and packaged trees match — green when both lose the same content. F46 already
recorded that these template files return **zero hits in the lint universe**. Nothing in the bundle
observes the deletion.

**The rule.** A generator's output and a teaching template are **different products** — one is the
minimum a validator accepts, the other is what a reader learns the optional shapes from. Byte-identity
between them is safe only if the renderer emits the teaching too. **Before declaring an existing file
"generated output", enumerate its consumers**: a file that another artifact instructs a reader to
*copy from* has a contract that a shape-equality check does not express.

### F64 — the approved plan's write scope missed three CI-load-bearing pins, and the sanctioned remedy cannot reproduce red-first evidence once execution has run. **[verified]**

`C-SKELETON-GENERATORS` executed T-001 through T-004 exactly as planned and then could not close,
because `validate:ci` is held by **three pre-existing pins that the approved deliverable inevitably
trips and the approved `ObservedWriteScope` does not list.** Verified independently at the executor's
report:

- `src/grace-cursor.test.ts:483` greps `writeFileSync|mkdirSync` across non-test `src/` and pins the
  result to four files. `spec new` / `plan new` must write files from `src/grace-generate.ts`.
- `scripts/release-check.test.ts:509` parses an allowlist **out of `scripts/release-check.ts`
  source** and diffs it against `package.json#files`. The plan requires that file list to gain
  `src/grace-generate.ts`, so the allowlist in `release-check.ts` must gain it too.
- `scripts/skill-contracts.test.ts:48,71` pins `AC-EXAMPLE-CRITERION` in both spec and plan
  templates. The approved spec decides the live criterion is `AC-SKELETON`, so the regenerated
  teaching emission cannot contain the pinned string.

**This is a requirement-6 violation in artifacts the authority approved.**
`skills/ngrace/ngrace-plan/SKILL.md:38` states it in the exact terms of the failure: *"Scope covers
what the deliverable forces, not only the files it targets… If the approved deliverable makes an edit
inevitable, list that path at plan time — never leave the executor choosing between a scope breach and
a failed task."* The executor chose neither: it stopped and reported, which is correct.

**The generalizable miss.** All three pins are *second statements of a fact the bundle changes*, held
in files the bundle never names: a grep-based inventory of writers, an allowlist duplicated from
`package.json`, and a third-party assertion about template contents. **A plan's write scope must be
derived from what the deliverable falsifies, not from what it edits** — and the reliable way to find
those is to ask which existing tests encode the state being changed, not which files the tasks touch.
Grep-based and allowlist-based pins are invisible to that reasoning precisely because they name no
symbol the new code imports.

**And the remedy has a hole.** `ngrace-plan/SKILL.md:22-26` forbids refreshing `ObservedWriteScope`
in place and directs: *"Create a new `C-*` bundle and mark the old bundle superseded."* That remedy
assumes the defect is found **before** execution. Found after four tasks have recorded genuine
fail→pass pairs, a superseding bundle starts with an empty ledger and its criteria are **already true
at its own HEAD** — the F28 shape — and re-recording those reds would be retrospective, which the
red-first rule forbids. So the honest construction is a replacement bundle whose criteria for
already-executed work **cite the superseded bundle's archived ledger as their evidence** (D16: a
criterion may only bind evidence living in an artifact), and whose *new* work — the three pins, plus
the README gap from the same review — gets genuine red-first. The superseded bundle must therefore be
archived intact rather than deleted; its ledger is the replacement's evidence.

**Rule.** Before approving a plan, ask of every fact the deliverable changes: *what else asserts this
today?* Search for greps, allowlists, and cross-file content pins, not only for callers.

### F65 — an in-place amendment leaves the artifacts looking compliant, and the audits that would catch it read the amended text. **[verified]**

`C-SKELETON-GENERATORS` amended its approved `spec.xml` and `plan.xml` in place, mid-epoch, at the
user's direction, after [F64](#f64) showed the write scope was defective.
`ngrace-plan/SKILL.md:22-26` directs a superseding bundle instead. The exception was deliberate and
priced. **What it costs is worth recording precisely, because the cost is invisible in the artifacts
afterwards.**

**The artifacts no longer show that anything happened.** After the edit, `spec.xml` and `plan.xml`
read exactly as if the four extra paths had been in scope since authoring. The only surviving traces
are the plan's `DESIGN` paragraph, the bundle verdict, this entry, and the separate commit
(`febdd57`) the authority split out for that purpose. Nothing *mechanical* records it: a later reader
running the audits sees a clean bundle.

**And the audits confirm the amended text, not the history.** The WriteEvidence scope audit reported
**45 paths, 0 findings** — because it reads the amended plan. Event 21's `validate-ci` fail carries
WriteEvidence that could not name `src/grace-cursor.test.ts`, `scripts/release-check.ts`, or
`scripts/skill-contracts.test.ts`, since none were in `ObservedWriteScope` when that fail was
recorded. **The pin-repair pair therefore has a fail side that cannot name the files that made CI
red** — the F9 shape, entered here by the authority's missed scope rather than by executor
sequencing. A clean scope audit after an in-place amendment is evidence about the amendment, not
about the run.

**The rule.** An in-place amendment of an approved artifact is available only as a user-directed
exception, and it must be **split into its own commit and named in the verdict**, because the
artifact itself will not remember. Prefer the superseding bundle whenever the defect is found before
execution — [F64](#f64) explains the one case where supersede is genuinely worse, and even there the
product-correct construction is a replacement whose criteria cite the superseded ledger.

**Related, and still owed — promoted to its own entry as [F66](#f66)**, because it is a different
finding and citing it as F65 mislabels what F65 protects.

### F66 — the standing docs-and-examples rule is enforced by nothing, and its trigger is not a checkable predicate. **[verified]**

**Split out of [F65](#f65) at `C-TEACHING-SURFACE`'s spec review**, on the executor's objection: F65
is about an in-place amendment leaving artifacts looking compliant, and folding the docs rule into it
teaches the next reader that F65 means "remember README." It does not. The two are separate and are
now cited separately.

**The rule (Alex, 2026-08-13):** *every phase ships updated docs and examples.* A spec touching a
user-visible surface must **decide** `README.md` and `examples/` explicitly — in scope, or a named
NonGoal with the step that owns them. Silence is not a decision.

**Nothing in the product enforces it.** No requirement in `ngrace-spec` or `ngrace-plan` obliges a
spec adding a user-visible command to decide either path. `C-SKELETON-GENERATORS` added three
user-visible commands and never decided README; the gap was caught by review, not by a check, and
that bundle could not fix the rule because it forbade `SKILL.md` edits under [F51](#f51).

**And the obvious trigger is unimplementable.** *"A spec touching a user-visible surface"* is not a
predicate the grammar can evaluate — there is no tag for it, and inventing one is a D5.2 break. So
the honest implementations are exactly two: **every** active spec decides both paths, or a new
optional section plus a lint code. `C-TEACHING-SURFACE` took the first and grandfathered the archive.
**A rule whose trigger cannot be evaluated is a rule asserted by nothing** — which is the [F46](#f46)
/ [F63](#f63) defect this roadmap keeps paying for. Do not restate the rule in skill text without
naming what evaluates it.

### F67 — a signature-key naming convention can collide with the repeat budget, and the collision is invisible until three pins share one file. **[verified]**

Raised by the executor at `C-TEACHING-SURFACE`'s plan review, unprompted, as the thing it would still
push back on after the plan was otherwise sound.

**The mechanism.** House convention names a `signatureKey` after the test file stem, so three repairs
in `scripts/skill-contracts.test.ts` all want the key `skill-contracts`.
`FIX_SIGNATURE_REPEAT_BUDGET` is 2 under exact kind-plus-key equality, and the window is **per task**
— `listWindowFailSignatures(events, task)` (`src/grace-cursor.ts:1666`) filters on `event.task`, then
narrows to the last resolving resume. So two reds with that key **in one task** trip trigger R and
pause the task.

This bundle's spec requires three repairs in that one file (the shape-sources pin, the approval
lexicon, the evidence doctrine). The plan avoided the collision by splitting them across T-001 and
T-002, which works because the window is per-task. **That is a workaround the spec permits, not a
rule the spec states** — and it only exists because the criteria happened to be separable. A bundle
whose three same-file repairs belong to one criterion has no split available, and the only honest
move is to stop.

**Why it stays invisible.** Neither cap is violated by *design*: three distinct criteria in a task is
under the distinct budget of 4, and one key per criterion is under the repeat budget of 2. The
collision is manufactured entirely by the **naming convention**, which maps three different
properties onto one key. Nothing in the plan review surfaces it, because the plan lists criteria and
the budget counts keys.

**The rule.** A `signatureKey` names the **property being reddened**, not the file the test lives in.
When two planned reds in one task would repair the same file, the keys must still differ — key on the
property (`shape-sources`, `approval-lexicon`, `evidence-doctrine`), not the stem. **Count keys, not
criteria, and count them per task**, since that is the window the product actually evaluates. See
[F56](#f56) for the distinct-signature half of the same tension and the [F21 correction](#f21-correction)
for why the repeat budget survives at all.

### F68 — two planned reds for two exports of one module cannot be independently observed. **[verified]**

Raised by the executor in `C-TEACHING-SURFACE`'s execute report, unprompted, and it is [F67](#f67)'s
sibling: a **planning convention**, not a budget, manufactures a discrimination failure that the
ledger cannot show.

T-003 planned two reds — `checkTemplateFill` absent, then `checkClaimedShapes` absent — against two
new exports of a module **T-001 had already created**. After T-001 the file exists, so:

- Red 1 fails with `Export named 'checkTemplateFill' not found`. Honest.
- Red 2 adds `checkClaimedShapes` to the same import list. Both are still absent, so the runtime error
  names **`checkTemplateFill`** — the sibling, not the property being recorded.

The ledger then carries `test:checkClaimedShapes` because the plan named that key, **not because the
observed failure named it.** The key and the evidence have come apart, and nothing in the ledger, the
attempt-pair audit, or the budget shows it: two distinct keys, one per red, no repeat, no escalation.

**The spare slot does not help.** The collision is in the red *design*, not in a third signature.

**The rule.** Two planned absences are independently observable only if each can fail **alone**. When
both live in one module, either give the second red its own module for the failing import, or require
the first export to exist before the second red is recorded. **At plan review, ask of every pair of
planned reds in a task: could the second one have failed for the first one's reason?** If yes, the
second red proves nothing the first did not.

### F69 — converted prose inherits an assertion that was true only where it came from. **[verified]**

`C-TEACHING-SURFACE` rewrote `examples/polyglot`'s `V-M-API-ROUTER` from `<Marker>` to
`<TraceAssertion>` and phrased it after the example's existing `TraceAssertion` on
`V-M-WEB-LEDGER-TABLE`: *"asserted by … without runtime log emission."*

**That clause is true of the web component and false of the Go router.**
`examples/polyglot/services/api/internal/router/router.go:21` emits
`[ApiRouter][Route][BLOCK_DISPATCH]` inside a live `START_BLOCK_DISPATCH` block. The teaching example
asserted an absence its own source tree contradicts, in the one artifact the product ships **so that
agents copy it**.

Measured while checking the executor's related concern: **both** polyglot Markers are backed by real
emission — the Rust core emits `[LedgerCore][post][BLOCK_VALIDATE_BALANCE]` at
`crates/core/src/lib.rs:17`. So converting the other entry instead would have moved the same falsehood,
not avoided it. The defect was the copied clause, never the choice of subject.

**Repaired by the authority at close** (disclosed in the verdict): the assertion now reads that
dispatch is asserted by `go test` and the `BLOCK_DISPATCH` emission stays as runtime trajectory and is
not the evidence — which teaches the doctrine the same bundle installed (`TraceAssertion` plus tests is
the default; `Marker` is for runtime trajectory only) **better than the original did**, because it
shows the distinction on a module that has both.

**The rule.** When converting an artifact to a sibling's form, the sibling's prose is a template for
*shape*, never for *claims*. Every negative assertion — "without", "does not", "no longer" — must be
re-verified against the new subject's own source. A copied absence is the cheapest false statement in
the product to make and the hardest to see in review, because it reads as consistency.

### F70 — the README command check binds roots, the README documents subcommands, and the authority reported the stronger claim. **[verified]**

`C-TEACHING-SURFACE` shipped `README CLI Overview lists every live command root`
(`src/query/command.test.ts:866`). It filters the CLI Overview to table rows and asserts every
`liveCommandRoots()` **name** appears. Measured: **30 rows inside the `## CLI Overview` section**,
which is the only scope the check reads (37 across the whole README — state the scope with the
number, or the count is the F62 defect again; the executor and the authority each measured one of
these and disagreed for that reason alone). They document *subcommands* — `ngrace module find`,
`ngrace module show`, `ngrace file show`. Only **11 root tokens** are enumerated.

**The gap is already live in six places, before this bundle adds a seventh.** A walk of the same
command objects finds these invocations undocumented as rows today: `ngrace cursor pause`,
`ngrace cursor resume`, `ngrace cursor fold` (prose only, README:133), `ngrace cursor recover`,
`ngrace module health`, and `ngrace verification localize`. Exact-token matching is what exposes
them — the combined `advance/pause/resume/fold` row satisfies only `advance`. **So widening the
check forces README rows this bundle did not invent, and that is the finding being paid, not scope
creep.** A predicate narrowed to `file.*` would leave F70 half-repaired and be exactly the special
case the finding forbids.

**A second false claim rides on the same check.** `liveCommandRoots` is **not exported** — it is
defined only at `src/query/command.test.ts:831` — yet `skills/ngrace/ngrace-cli/SKILL.md:10` reads
*"Command inventory: README CLI Overview table (bound to `liveCommandRoots`). Do not restate that
inventory here."* A skill points at a private test function as the binding. Repairing the check
without that sentence leaves an inherited false claim ([F69](#f69)).

**So adding a subcommand to an existing root leaves the table silently stale**, which is the same
drift the check was introduced to stop. `ngrace file exports` (P1.7) is precisely that case: `file`
already appears, so the check stays green while the table omits the new verb.

**The check's own name is honest** — it says *root*. The overclaim was the authority's, in the PR body
and the phase-board row: *"README's CLI Overview is bound to the live command roots by a test, so the
table cannot silently drift again."* The first clause is true and the second does not follow from it.
This is [F62.1](#f621)'s class applied to a check rather than a survey fact: **a claim of completeness
asserted from a mechanism that never evaluated it.**

**The rule.** When reporting what a check protects, state **the predicate it evaluates**, not the
outcome you wanted from it. And when a check guards a document that enumerates finer-grained items
than the check itself enumerates, the guard is only as strong as its enumeration — say so at the time,
or widen it.

**Scheduled, not deferred:** widened in the bundle that first exercises the gap (P1.7 / P1.8), per
fix-at-the-point-of-detection.

### F71 — a getter named for the authored field returns a fallback, and the renderer labels the fallback with the authored field's name. **[verified]**

Raised by the executor while planning `C-ADAPTER-HONESTY`, and it is what kept that bundle's
named-absence criterion satisfiable.

`getModulePath` (`src/query/core.ts:111-113`) returns
`moduleRecord.graph.path ?? localFiles.find(non-test)?.path ?? localFiles[0]?.path`. The name says
*the module's Path*; the body says *the Path, or failing that any linked file*. `module show` then
prints that result under the label **"Graph Path"** (`src/query/render.ts:113`). **So a module with no
authored `<Path>` but one linked file reports a Graph Path it never declared**, and no surface says
the value was inferred.

`ngrace file exports --module M-X` had to name a missing `<Path>` as an absence. Reusing the existing
getter — the obvious move, and the one a later reader will propose as a simplification — would have
made `AC-FILE-EXPORTS`'s absence criterion **unsatisfiable**: the command would analyse a linked file
and never report the absence at all. The plan therefore binds `moduleRecord.graph.path` and forbids
`getModulePath` by name.

**The label is still lying and is not this bundle's to fix** — the defect is inherited and
`module show`'s output was out of scope. Recorded for its own repair.

**The rule.** A `??` chain inside an accessor is a silent policy decision, and the accessor's name is
where it hides. When a criterion depends on an authored field being *absent*, bind the field, never a
getter that resolves it — and check what the renderer calls the result, because a fallback under an
authored field's label is a false claim on a user-visible surface.

**Discharged by [`C-RECORDED-DEBT`](../../../../.ngrace/changes/archive/C-RECORDED-DEBT/), the getter returns only the authored Path, so all four display sites report absence.**

### F72 — an absence check that ORs two conditions ships one message for two causes. **[verified]**

`C-ADAPTER-HONESTY` introduced `requireExistingFile` as
`if (!existsSync(p) || !statSync(p).isFile())` behind the single sentence *"File `X` was not found on
disk."* The approved plan required the two `not-found` causes it named — no `<Path>` and missing file
— to carry different messages. **The `||` quietly created a third cause with the second one's
words:** a Path that resolves to a **directory** exists, is not missing, and was reported as missing.
Directory Paths exist in this repository, so the case is reachable, not theoretical.

This is [F40](#f40) / [F55](#f55)'s class arriving through control flow rather than through a
formatter: the code *knows* which branch it took and discards that knowledge at the throw site.

Repaired in-bundle and disclosed in the verdict: the conditions are split and a directory gets its own
sentence. **Proved by discrimination, not by a green suite** — the new case fails against the OR'd
condition and passes against the split one.

**The rule.** Every disjunct in an absence test is a distinct cause and needs its own message. When a
criterion says two causes must be distinguishable, count the *branches*, not the causes the spec
happened to name — the spec names the ones someone thought of.

**Two smaller items from the same close, scheduled rather than fixed.** (1) `guided()` in
`src/grace-doctor.test.ts:75-81` assigns severity by `code.startsWith("analysis.")`, so the fixture
now classifies `graph.path-no-adapter` as an error while production emits a warning. The case stays
green because it partitions on `issueClass`, so this is a **fixture that silently disagrees with
production** — harmless today, wrong whenever severity starts mattering. (2) `file exports` reports a
single `moduleId`, taking `linkedModuleIds[0]`, while a governed file may link several modules; the
choice is arbitrary and unstated. Neither was in this bundle's approved scope.

### F73 — every gate in this roadmap runs on one platform, so a clean close has never implied green CI. **[verified]**

`C-ADAPTER-HONESTY` archived with review 0 findings, both process audits clean, `validate:ci` exit 0,
and lint 0/0 — **and its first CI run failed on Windows.** Two cases of the new
`graph.path-no-adapter` asserted `expect(issue.file).toContain(".ngrace/graph/main.xml")`, while the
code emitted `moduleRecord.file` verbatim: a realpath'd OS-native absolute path that reads
`...\.ngrace\graph\main.xml` on Windows. A `/`-joined needle is never a substring of a `\`-joined
haystack, so the two cases that make that assertion — and only those two — failed.

**The bundle predicted it and the authority approved anyway.** The executor's plan report said the
same-file comparison "would not skip" for a `./`-prefixed variant and marked it **"Unexercised."** The
authority read that, judged it a low-value edge case, and approved. On Windows the identical
fragility arrived through a different door: separators instead of a prefix. **A reported-and-untested
path comparison is a prediction, not a nit.**

**The structural fact is larger than this bundle.** Every gate this roadmap runs — spec review, plan
review, execute, `ngrace review`, the WriteEvidence and attempt-pair audits, `validate:ci`, and the
authority's own independent verification — executes on **one machine, one OS**. None of them can
observe a separator, a case-insensitive filesystem, an 8.3 short name, or a realpath divergence. Seven
bundles have closed against that blind spot. This is the first one whose deliverable touched
filesystem paths at an emission site, and it is the first to be caught by CI rather than by us.

**Two smaller facts from the repair, both worth keeping.** The root cause was **not** the skip
logic everyone suspected — `noAdapterPaths` and the normalized authored Path were already POSIX, and
Case A, which depends on the skip matching, passed on Windows. The failing comparison was the emitted
`issue.file` against a test's substring check. And the sibling `graph.module-without-linked-files` had
been emitting a raw absolute `file` since long before this bundle; making both codes share one
project-relative POSIX value changed **no** test expectation, but it is a user-visible JSON change to
an already-shipped code.

**The rule.** When a diagnostic emits a **path**, the path is part of the contract and needs a
platform-independent normalizer at the emission site, not at the comparison site. And when an executor
reports a path comparison as *unexercised*, that is the cheapest possible warning that a
single-platform gate cannot see it — **test it or state in the verdict that CI is the only observer.**
Until this roadmap gains a second platform in its gates, "closed clean" means "clean on macOS."

### F74 — a bare `D<n>` citation is ambiguous across plans, and one sits inside a normative block. **[verified]**

Caught by the executor while authoring `C-AS-STATE`, checking a citation the authority had repeated
without following it.

P1 step 6's **normative** absence-reporting block reads *"using D5's typed-absence idiom."* Measured:

- **This plan's D5** is *"Separators are `,` `;` and whitespace; and a standing rule for what counts
  as a break"* (`decisions.md`).
- **The typed-absence idiom is `RM-AGENT-RELIABILITY`'s D5** — *"The trust model: two axes for claims,
  one value for absence"* — which lives in `docs/plans/archive/RM-AGENT-RELIABILITY/decisions.md`.

So a reader who follows the citation inside the plan that contains it lands on the separator rule and
finds nothing about absence. **Both plans number their decisions from D1, and both reach the teens**
(this plan D1–D17, the reliability plan D1–D16), so *every* bare `D<n>` in this repository is
ambiguous between at least two documents. The step text has been read by three bundles without anyone
resolving it, because "D5" reads as self-evidently local.

Repaired in the roadmap: the citation now names the plan, quotes the decision, and gives the archive
path, with a note that the qualifier is load-bearing.

**This is [F53](#f53)'s rule one level up.** F53 said cite a bundle by archive path, never by commit
hash, because the hash is not resolvable from the text. A bare `D<n>` has the same defect for a
different reason: it *is* resolvable, to the wrong thing, silently.

**The rule.** **Cite a cross-plan decision as `<PLAN-ID> D<n>`, always.** A local `D<n>` is acceptable
only inside the plan that owns it, and never inside a normative block that another artifact will
quote. **Owed: an audit of the remaining bare `D<n>` citations** in this plan and in the skills —
`D3`, `D5.2`, `D5.5`, `D11`, `D12`, `D13`, `D16`, `D17` are all in live use and at least one (D12) is
known to belong to the reliability plan. Not done here; this bundle's scope is `--as`.

**Discharged by [`C-RECORDED-DEBT`](../../../../.ngrace/changes/archive/C-RECORDED-DEBT/), the three shipped SKILL.md citations qualified as RM-AGENT-RELIABILITY; the plan-file half was completed separately and F74.2 remains open for the source comment.**

### F75 — a spec that counts reds in two places has two inventories, and they disagree. **[verified]**

`C-AS-STATE`'s approved spec states its red arithmetic twice and the two statements are not the same
arithmetic. Caught by the executor at plan authoring; the authority had approved it.

- The signature-key **Constraint** (`spec.xml:471-482`) says *"the assertions-mode refusal and the
  gate-verb refusal **are separate reds**"* — two.
- **`AC-HEAD-RED`** (`:850-860`) says each of the four criteria *"has **a** red … under the signature
  keys named above"* — four keys total, so both refusals sit under `as-vocabulary` as **one**.
- `AC-HEAD-RED`'s own **failure conditions** (`:884-891`) then forbid *"the assertions-mode refusal and
  the gate-verb refusal reddened so the second fails naming the first ([F68](#f68))"* — which is
  precisely what obeying the Constraint would produce, because at HEAD both refusals fail identically
  as an unknown flag.

So the Constraint demands a pair that the criterion's failure list forbids. **`AC-HEAD-RED` had the
correct count all along; the Constraint over-counted.**

**The distinction the Constraint blurred is the useful one.** *Tests* must be able to fail alone —
that is a real property and worth requiring. *Ledger fail events* are a different quantity, governed by
the fix budget and by [F68](#f68)'s independence rule. A Constraint may require the first; only
`AC-HEAD-RED` may count the second. Conflating them produced a spec that could not be executed as
written.

**The rule.** **Red counts live in exactly one place: `AC-HEAD-RED`.** Any other section may say that
two properties must be *independently observable*, and must not say how many `cursor attempt --outcome
fail` events that implies. This is [F60](#f60)'s second-inventory pattern applied to reds — and the
second time this phase an approved spec carried an internal contradiction that only surfaced at plan
authoring, after [F63](#f63)'s sibling in `C-TEACHING-SURFACE` where an acceptance criterion defined
"tables" two incompatible ways in adjacent sentences.

**Also recorded, not fixed:** the same spec still cites *"D5 typed-absence"* bare at `spec.xml:192` —
the exact defect [F74](#f74) records. The spec is approved and immutable, so it stands; the plan cites
`RM-AGENT-RELIABILITY` D5 correctly, and this entry is the record that the artifact does not.

### F76 — the CLI silently ignores an unrecognised flag, in the product whose thesis is that silence must not read as pass. **[verified]**

Found by the executor while executing `C-AS-STATE`, checking a HEAD claim the plan asserted and the
authority's dispatch repeated: that an undeclared `--as` would fail as an unknown flag. **It does
not.** Measured at HEAD:

```
ngrace lint --path . --totallyBogusFlag hello --format json
```

emits **no diagnostic naming the flag** and produces a byte-shaped-normal `LintResult`, identical to
the run without it. (Exit code is not the tell: this tree had unrelated lint errors, so `1` came from
those. Checking the exit code alone would have confirmed the wrong conclusion — measure the
*diagnostic*, not the status.)

**The consequence is worse than a typo.** `ngrace lint --assertionss target` — one transposed letter —
runs in `current` mode, reports a clean result, and tells the author nothing. They believe they
evaluated target assertions. They evaluated the default. Every selected-assertion command in the
lifecycle is exposed the same way, and the `--assertions` modes are precisely the gates the execute
flow depends on.

**The irony is exact and worth keeping.** This finding surfaced inside the bundle implementing P1
step 6, whose own **normative** text reads *"Silence must not read as 'will pass.'"* The feature was
being built to hold the tool's rule-coverage to that standard while the CLI that dispatches it drops
unrecognised arguments without a word.

**Neither the plan nor the authority measured it.** The plan asserted the unknown-flag failure as a
HEAD fact, the dispatch restated it, and both were wrong — the third time in this phase a HEAD claim
about the CLI has been asserted rather than measured (see [F62](#f62), [F62.1](#f621)). The executor
caught it because a red it expected to be red was green.

**Not fixed here.** The behaviour belongs to the argument layer shared by every command, not to
`--as`, and this bundle's scope is the overlay. **Owed as its own change**: decide whether unknown
arguments are rejected, warned, or reported as a typed absence, and note that a strictness change is
a compatibility break for any caller passing extra flags today.

**The rule.** Before writing a criterion on "the CLI rejects X", run it and read the **message**. An
exit code is a summary of everything the command did, so it can confirm a rejection that never
happened.

**Discharged by [`C-RECORDED-DEBT`](../../../../.ngrace/changes/archive/C-RECORDED-DEBT/), unknown flag tokens now error with usage.**

### F77 — the coverage report's class taxonomy is a hand-written conditional with no completeness guard. **[verified]**

`C-AS-STATE` ships the `--as` coverage line — *"evaluated N rule classes; M classes not evaluable at
this state"* — whose whole purpose is holding the tool's own coverage to the honesty rule it applies
to everyone else. **The values are right and the mechanism can drift.**

`applyAsStatePreview` (`src/lint/core.ts`) computes membership as a conditional over the requested
status and whether a plan exists:

```
const ran = new Set(["artifact"]);
if (… ARCHIVED_CHANGE_STATUSES.has(asStatus)) skipped.add("ledger-dependent");
if (asStatus === "applied" || (asStatus === "approved" && planExists)) skipped.add("verification-runtime");
```

`AC-AS-ABSENCE-REPORT` requires *"N and M equal the derived class counts, not a frozen pair"*, and
that is **satisfied**: the same status yields different M depending on real project state — `approved`
without a plan is M=0, `approved` with one is M=1, `applied` is M=2 — which no status→M table could
produce. The executor disclosed the gap rather than claiming instrumentation it had not built.

**The residual risk is specific.** The class set is not derived from which evaluators actually ran; it
is asserted alongside them. **Add a fourth impure class and this conditional will not mention it, M
will silently under-count, and the coverage line will under-report the tool's own blindness** — the
exact lie the step exists to prevent, in the feature built to prevent it. Nothing catches that: the
tests pin membership per state (`src/lint/core.test.ts:565-579`), which is real discrimination, but
**no test asserts the taxonomy is complete**, so a new class is invisible rather than red.

**The rule.** A coverage report is only as honest as the enumeration behind it. When a summary counts
*classes of work*, derive the count from the work — instrument the evaluators, or at minimum pin the
class inventory so that adding a member without updating the reporter fails. A hand-maintained
conditional describing what the code did is [F60](#f60)'s second inventory wearing a summary's
clothes, and it fails silently in the direction of over-claiming.

**Not fixed here** — instrumenting the evaluators is a re-spec, not a repair, and the shipped values
are correct today. **Owed with the next change that touches the purity taxonomy**, and owed *before*
any fourth class is introduced.

**Discharged by [`C-RECORDED-DEBT`](../../../../.ngrace/changes/archive/C-RECORDED-DEBT/), the purity classes are a declared inventory that throws when a member is neither run nor skipped.**

### F74.1 correction — the audit list named the wrong tokens, and the real hazard is a number defined in *both* plans. **[verified]**

[F74](#f74) recorded that bare `D<n>` citations are ambiguous and listed *"`D3`, `D5.2`, `D5.5`,
`D11`, `D12`, `D13`, `D16`, `D17`"* as owed. **Measured, that list is wrong in both directions.**

- There are **31 distinct bare tokens**, not eight: `D1 D1.1 D1.3 D1.4 D1.5 D2 D2.1 D3 D4 D5 D5.1
  D5.2 D5.3 D5.4 D5.5 D6 D6.3 D6.4 D7 D8 D8.3 D8.4 D8.8 D9 D11 D12 D13 D14 D15 D16 D17`. The heaviest
  users are `D1` (29 sites), `D12` (17), `D5` (15), `D11` (15).
- **30 of the 31 are defined locally** in this plan's `decisions.md`, so most of the list F74 named
  as owed were never ambiguous at all.
- **The one genuinely foreign token is `D15`, which F74 did not name.** It has no heading in this
  plan and resolves to `docs/plans/archive/RM-AGENT-RELIABILITY/decisions.md:921` ("Token
  accountability"). Four bare sites: `plan.md:71`, `decisions.md:1525`, `:1528`, `:2437`.

**The sharper hazard is `D12`, and F74 stated it backwards.** F74 said D12 "is known to belong to the
reliability plan." It belongs to **both**: `D12` is defined in this plan's `decisions.md` *and* cited
elsewhere as `RM-AGENT-RELIABILITY D12`. A bare `D12` therefore resolves to a real decision either
way, and the reader cannot tell which — **the failure mode is not a dangling reference but a
confident wrong one.** `D5` has the same shape: qualified in some places, bare in others, defined
locally as the separator rule.

**Three bare citations also live in shipped skill text** — `ngrace-fix/SKILL.md:14` (`D8`),
`ngrace-reviewer/SKILL.md:32` (`D4`), `ngrace-spec/SKILL.md:70` (`D12`, the dual-defined one) — each
mirrored in `plugins/`. Skills are read by agents in *other* repositories, where neither plan's
`decisions.md` exists at all.

**The rule, sharpened.** Qualify a citation when the number exists in more than one plan **or** when
the text will be read outside the plan that owns it. **A repo-wide "qualify everything" sweep is the
wrong repair** — 30 locally-defined tokens would gain noise for no reader benefit, and mass-editing
prose that other findings quote invites its own errors. Qualify `D15` (foreign), `D12` and `D5`
(dual-resolving), and every `D<n>` in shipped skill text.

**And the lesson about the ledger itself:** F74 asserted an audit list without running the audit, in
the entry whose subject was citation precision. That is [F62](#f62)'s class inside a finding about
accuracy — a list offered as a survey becomes an enumeration the moment it is written down.

### F71.1 correction — four display strings, not two, and the live tree cannot be the fixture. **[verified]**

[F71](#f71) named `module show`'s **"Graph Path"** label and cited `src/query/render.ts:113`.
Measured, corrected by the executor at `C-RECORDED-DEBT`'s spec authoring:

- The label is at **`render.ts:114`**, not `:113`.
- `getModulePath` feeds **four** display strings, not two: the module-find table's `PATH` column
  (`render.ts:58`), **`Module Path:`** (`:81`), **`Graph Path:`** (`:114`), and the health record's
  `path` (`health.ts:126`, rendered as `Path:` via `render.ts:94`). **Two of those four are labels
  F71 never named**, so a repair that fixes only the labels F71 quoted would leave the same fallback
  printing under different words.

**And the live tree cannot serve as the acceptance fixture.** `M-SKILLS` has no `<Path>` **and no
linked files**, so `getModulePath` already falls through to `undefined` and `module show` already
prints `n/a`. A criterion written against it would pass at HEAD — [F28](#f28)'s shape, a green that
is not evidence. Demonstrating the defect requires a module with **no authored Path and at least one
linked file**, which is the only state where the fallback speaks.

**The rule.** When a finding names a symptom, count **every** consumer of the mechanism before
scoping the repair — a getter is a defect at each of its call sites, and the site the finding
happened to notice is rarely all of them. And before writing an acceptance criterion, check whether
the defect is **reachable on the tree you will run it against**; if the live project cannot express
the broken state, the fixture is part of the deliverable, not an implementation detail.

### F78 — a parent-level argument check does not reject the command, it poisons the exit after the child already succeeded. **[verified]**

Measured by the executor at `C-RECORDED-DEBT` by forcing the parent-run skip off, then restoring it.

The arg library dispatches the child command **and then also runs the parent's `run`**. With the skip
disabled, `ngrace module show M-EXAMPLE --path <tmp>` **printed the module JSON to stdout — the
correct output, the work done — and the parent then set exit 1** reporting `Unrecognized argument
'--path'`, because `--path` is declared on the child and invisible in the parent's empty args
definition.

**That is worse than the failure everyone framed.** The spec, the plan and the authority's dispatch
all described the hazard as *"a naive check would reject a valid command."* Rejection is loud and
safe: nothing runs, the user retypes. What actually happens is **success-then-fail after side
effects** — the command completes, emits real output, and reports failure. A caller reading the exit
code concludes the work did not happen; a caller reading stdout concludes it did. For a write
command the divergence would be worse than for a read.

**And it explains why the skip cannot be a membership restatement.** A skip that merely lists known
subcommand names is a second inventory ([F60](#f60)) *and* fails in this direction — silently, after
the fact — rather than by refusing. The skip has to be derived from the same live command objects the
dispatch used.

**The rule.** When a guard runs at a level that is **not** the level that owns the arguments, ask what
it does *after* the real work has already run. A check placed downstream of execution cannot reject —
it can only contradict. Guards belong where the decision is still ahead of the side effect, and when
they cannot be, their failure mode must be stated in those terms rather than as "rejects the
command."

### F74.2 — there is a third `D<n>` numbering space, and one instance is baked into source. **[verified]**

Found while discharging [F74.1](#f741)'s plan-file half. Both F74 and F74.1 said the ambiguity was
between **two** documents. Measured, it is **three**:

1. `RM-GOVERNED-PATH` decisions (D1–D17).
2. `RM-AGENT-RELIABILITY` decisions (D1–D16), archived.
3. **`plan.md` §4 "Deferred", which runs its own D1–D6 series for rejected *suggestions*** — where
   `D3` is the `lint --fix` auto-rewrite rejection and `D5` is evidence-strength tiers, neither of
   them a decision at all.

So a bare `D5` has **three** possible referents: the separator rule, the trust model, or a deferred
suggestion about doctor tiers. **A mechanical sweep would have rewritten the §4 rows into
confidently wrong cross-plan citations** — the exact failure F74.1 warned about, one level deeper
than F74.1 itself saw. The §4 rows are correctly cited elsewhere as *"§4 D3"*, and that section
qualifier is what makes them readable; it is not optional decoration.

**And the ambiguity is not confined to prose.** `src/test-support/token-accounting.ts:80` reads *"the
D15 baseline number"* in a doc comment — a bare cross-plan citation **in shipped source**. That site
also blocked one qualification: `decisions.md:2437` *quotes* that comment verbatim, so qualifying the
quotation would falsify it. **The repair belongs in the code, not the quote.**

**Owed with a stated dependency, not deferred:** a source comment cannot be edited outside a change
bundle — that is GRACE's own rule, and it is a real blocker rather than a preference. The one-word
qualification goes to the next bundle that opens `src/test-support/`.

**The rule.** Before qualifying a citation family, **enumerate the numbering spaces, not the
documents.** A table that reuses `D<n>` for a different taxonomy inside the same file is a third
space with no heading to announce it, and it is invisible to any search that assumes one series per
document.

### F79 — P2's normative text describes shipped work as unstarted and states a universal that is false. **[verified]**

Fifth roadmap claim in this roadmap to fail construction, after P1.11's "permanently blocked", P1.4's
zero-depth globstar, P1.8's "delayed IMPL=0 mystery" and P1.6's pure preview of impure modes. Caught
by the executor at `C-ONE-GLOB-LANGUAGE`'s spec authoring; verified independently.

**P2.2 prescribes a regression.** It says the lifecycle exclusion must be scoped *"to exactly the
reviewed bundle."* Shipped code already does the opposite **on purpose**: `isCliLifecyclePath`
(`src/review/core.ts`) matches any canonical `C-*` and carries the comment *"Not keyed on the reviewed
change id (cross-bundle)"*, pinned by `C-REPORT-HONESTY` with a test titled *"cross-bundle — fold of A
does not error a review of B."* Porcelain is repository-wide, so a reviewed-id gate re-opens exactly
the wolf-crying F11.2 was written to stop. **The step's load-bearing half is its stay-audited clause**
(`.ngrace/graph`, `.ngrace/verification`, `.ngrace/context`); the reviewed-id half is stale.

**P2.1's direction constraint states a universal it does not have.** *"The change can only widen what
review accepts"* is true for `*` and `**`, and **false for `?`**, where the two copies implement
different operators — measured in both directions: `src/foo?` × `src/foo` is review-true / scope-false,
`src/?.ts` × `src/a.ts` is review-false / scope-true. The sets are **incomparable**, not nested. The
practical claim survives only because no approved plan in this repository has ever used `?`, which is
a fact about the corpus, not about the language.

**And the F60 story understates the split.** Zero-depth `**` is the headline; the copies also disagree
on mid-path zero directories, leading `**`, the directory itself, `./` collapse, backslash form and
case. **The roadmap's single pinned pair is necessary and not sufficient.**

**The rule.** A roadmap step written before its phase begins ages against the code the earlier phases
shipped. Before writing a criterion on step text, **measure whether the step's premise is still the
product's state** — and treat a normative universal ("can only widen", "always", "never") as a claim
to falsify, not to inherit. Two of the five failures in this phase were steps prescribing work already
done differently and better.

### F80 — a red that asserts two things only ever evidences the first. **[verified]**

Disclosed by the executor at `C-ONE-GLOB-LANGUAGE`'s close, unprompted, against its own work.

The zero-depth red bundled two audits into one `it()`: the porcelain scope audit and the WriteEvidence
scope audit, both expected to stop reporting `web/js/**/*.js` × `web/js/app.js`. On the recorded red
run **the first expectation aborted the test**, so the transcript shows the porcelain finding and
**never reached the WriteEvidence assertion.** Both are green after the change, and the plan required
independence only between *different* signatures ([F68](#f68)), so nothing was violated — but the
ledger's red for that signature evidences **one** of the two behaviours it claims.

**Why this matters beyond tidiness.** A fail event is the product's evidence that a property was false
before the edit. When one event covers two properties and the runner short-circuits, the second
property has **no recorded red at all** — it is indistinguishable from a property that was already
true. That is [F28](#f28)'s shape arriving through the test runner rather than through the criterion:
a green that was never observed red.

**The rule.** **One recorded red, one observable property.** When a criterion covers two surfaces that
must both flip, either assert them in separate cases so each failure is printed, or record separate
signatures. F68 asks whether two reds can fail *alone*; this asks the complementary question — whether
a single red *proves* everything it is cited for. Ask both at plan review.

### F81 — P2.3's wording would have invalidated the record it exists to create. **[verified]**

Sixth roadmap claim in this phase to fail construction. Caught by the executor at
`C-BUNDLE-BASE-REF`'s spec authoring; all four points verified independently.

1. **`BaseCommit` as a child invalidates the approve event.** A non-`Requirement` child of
   `<Decision>` raises `ledger.invalid-decision` (`src/artifact/grammar.ts:896`,
   `src/gates/ledger.ts:553`). The step says this record is *"what D1's detection rule keys on"* in
   P3.7 — so the prescribed shape would have **destroyed the readability of the event it was
   written for**. Extra *attributes* are already accepted, so an attribute is the only shape that
   preserves the key.
2. **"No-git fallback keeps porcelain" is already false.** `listRepositoryChangedFiles` returns
   `available: false` when git fails and `review` becomes `unable-to-determine`. The honest split is
   **git present but nothing recorded** (porcelain plus caveat) versus **git absent** (existing
   absence plus caveat) — two different silences, and the step conflated them.
3. **`base..working-tree` is not git syntax**, and the existing `--base` helper the same sentence
   preserves is `base...HEAD` (`src/grace-cursor.ts:1594`). Wiring the recorded sha into that helper
   is the obvious implementation and **goes blind on uncommitted work** — the exact writes an audit
   at review time most needs to see. It needs its own commit-versus-worktree walk, and one that
   unions untracked files, since porcelain includes them and `git diff --name-only <sha>` does not.
4. **"Pre-existing dirt never enters the audit" overclaims a SHA.** Files already dirty at approve
   still differ from that commit. Only a recorded dirty-set inventory would deliver that sentence, and
   the step assigns that to D2 / P4.

**And the step never said what re-approval does.** Measured: **five archived bundles already carry two
permitting approve `Decision`s**, and permit lookup is newest-governs (`src/gates/ledger.ts:120`). A
recorded fact that newest-governs is **a silent rewrite** — so the reader must be first-in-document-
order and the writer first-observation-wins, never storing a different object name (D9, append-only).

**The rule.** When a step prescribes *where* a fact is stored, check that the store accepts that shape
**and** that the shape survives every reader that already depends on it. A record designed to key a
future detection rule is worthless if writing it makes the event unreadable — and "record X at Y" is
silently a schema change whenever Y is validated.

### F82 — a close-time criterion cannot be evidenced by a task pass, because the task ends before the close. **[verified]**

Raised by the executor at `C-BUNDLE-BASE-REF`'s execute close, against the plan template every bundle
in this roadmap has used.

`AC-SUITE-AND-LINT` defines its lint half as **0 errors / 0 warnings *after apply and archive***. It is
`Satisfies`-linked to the final task. But that task's `Verification` commands do not include lint, and
the task necessarily **completes before the close sequence that would make the claim true**. So the
recorded pass evidences the three commands the task actually ran — and nothing about the close-time
bar it is linked to.

**This is not local to one bundle.** Every bundle in this phase carries an `AC-SUITE-AND-LINT` shaped
this way, and every one recorded a final-task pass while the lint half was still false. The artifacts
have been claiming, by link, evidence that the ledger cannot hold.

**Why it has stayed invisible.** The close *does* verify the bar — the authority runs lint after
archive and records the numbers in the verdict — so the claim is true in the end. What is wrong is
**where the evidence lives**: in the verdict and the archive commit, not in the attempt that
`Satisfies` points at. Nothing cross-checks the two, so the mislink never surfaces as a failure.

**The rule.** A criterion whose evidence can only exist *after* the lifecycle step that ends the run
must not be `Satisfies`-linked to a task. Either bind it to the close record explicitly, or split it:
the half a task can run (suite, `validate:ci`) stays on the task; the half only the close can observe
(post-archive lint, archive count) is verdict evidence. **Check at plan review that every `Satisfies`
link points at something the task can actually observe.**

Not repaired here — the plan template is shared and changing it mid-bundle would amend approved
artifacts. **Owed to the next bundle that authors from the model plan**, which is the same route
[F50](#f50) and [F51](#f51) took.

**Discharged by [`C-DRIFT-HONESTY`](../../../../.ngrace/changes/archive/C-DRIFT-HONESTY/), demonstrated the split: AC-SUITE-AND-CI on a task that runs those commands, post-archive lint as verdict evidence.**

### F83 — a step described as delivery is already shipped, and its sibling's credit rule cannot match the files it names. **[verified]**

Seventh roadmap claim in this phase to fail construction. Caught by the executor at
`C-DRIFT-HONESTY`'s spec authoring; both verified independently.

**P2.6 is already true.** *"`status` nextAction for unexplained drift never recommends committing"* —
measured, `src/grace-status.ts` contains the string `commit` **zero times**, and unexplained drift
already emits the refresh sentence. There is nothing to remove. Building it would be an
[F28](#f28) green-as-new-work, or a rewrite of a sentence that is already the honest one. **And the
rule as stated is one F7 already refuted**: never-commit is right for unexplained drift and wrong for
the approval-window `approved-contract-drift` hard stop, which the step text never absorbed.

**P2.4's credit rule cannot match its own subject.** An archived bundle's `ObservedWriteScope` still
names `.ngrace/changes/`**`active`**`/C-ID/...` — measured on the most recent archive, whose `<Glob>`
reads `…/active/C-BUNDLE-BASE-REF/run/**` — while the bytes now live under `archive/`. So exact
matching credits stray `src/` paths and **misses the moved bundle itself**, leaving the post-apply nag
the step exists to remove. This is the same shape as [F81](#f81): the prescribed rule does not survive
the store it is applied to.

**Two overclaims in the same sentence.** *"Without weakening detection"* is false if credit is OWS
membership: the scope is permanent, so **any later dirty edit to a once-approved path becomes
explained**. That is a real narrowing of what "unexplained" means, and no time window is specified.
And *"removes the permanent post-bootstrap refresh nag"* overclaims — files no applied scope covers
stay unexplained, and that nag belongs to P4.2's adoption boundary.

**Related, and the trap in [F82](#f82)'s own repair.** F82 said to bind the close-time lint bar to the
close record or split the criterion. Both collide with shipped lint: a second close-time `AC-*` that no
task `Satisfies` raises `change.acceptance-criterion-unmapped`, so a 0/0 bar containing it can never
close. The workable third option is that the post-archive half is **verdict evidence and not an `AC-*`
at all**, with the task-observable half kept as a criterion. **A finding that prescribes a repair
inherits the obligation to check the repair is closable.**

**The rule.** Before treating a roadmap step as work, measure whether the product already does it —
and when a step credits or matches stored records, check the records **as they exist at the moment the
rule runs**, not as they were written.

### F83.1 — the copied `AC-SUITE-AND-LINT` shape still authors the unsatisfiable 0/0 close criterion, and that is why `C-CURSOR-TASK-SENTINEL` was superseded. **[verified]**

[F83](#f83) named the trap in [F82](#f82)'s own repair: a close-time `AC-*` that no task `Satisfies`
raises `change.acceptance-criterion-unmapped`, so a 0/0 bar containing it can never close. [F82](#f82)
was discharged by `C-DRIFT-HONESTY`, which demonstrated the split. The next bundle that authored from
the model plan copied the old shape anyway.

`C-CURSOR-TASK-SENTINEL/spec.xml:411–420` authors `<AC-SUITE-AND-LINT>` as *"Close-time only, bound
to the verdict, not to a task pass (F82)"* and requires `bun run ngrace lint … is 0 errors and 0
warnings`. `:437` repeats that it is close-time verdict evidence. The draft plan then
`Satisfies`-linked it to T-003 (`plan.xml:397–404`) *because* the spec also required 0 warnings and
an unmapped `AC-*` is a warning. Mapping it contradicted F82; leaving it unmapped falsified the
criterion. Maintainer ruling 2026-08-15: supersede, do not amend in place
(`C-CURSOR-TASK-IDENTITY/spec.xml:131–144`). That is the first supersede in this chain.

**Severity of the unmapped diagnostic, measured.** `validateSpecPlanCoverage`
(`src/artifact/grammar.ts:1883–1890`) emits `change.acceptance-criterion-unmapped` at **warning**.
There is no third `AC-*` state. `collectAcceptanceCriteriaIds` / `collectSatisfiedAcceptanceCriteria`
know mapped and unmapped; nothing in the grammar is verdict-bound, close-time, or archive-only. D17
freezes an id once a run event cites it — it does not bind a criterion to the close record.

**The teaching templates do not force this.** `skills/ngrace/ngrace-spec/references/change-spec-template.xml:14`
ships `<AC-SKELETON>`, not `AC-SUITE-AND-LINT`. The force is the **copied model-plan shape** F82
already named — every earlier bundle in this phase carried it — surviving F82's discharge as a habit.

**The working construction**, demonstrated by `C-DRIFT-HONESTY` and reused by `C-CURSOR-TASK-IDENTITY`
and `C-CURSOR-TASK-RESOLVER`: **do not author lint 0/0 as an `AC-*` at all.** Split the old
`AC-SUITE-AND-LINT` shape. The task-observable half is `AC-SUITE-AND-CI`, `Satisfies`-linked to a
task whose `Verification` runs those commands (`C-DRIFT-HONESTY/spec.xml:633–671`, `:1254–1279`).
The post-archive lint 0/0 half is close-verdict evidence, quoted in the verdict (D16). The spec
does not author `AC-SUITE-AND-LINT` and must not `Satisfies`-link lint-after-archive to any task.
Neither half requires a state that its own presence falsifies.

**The rule.** A criterion that requires 0 warnings cannot be an unmapped `AC-*`, and a close-time
lint bar cannot be a mapped one. The construction that closes is to stop authoring the lint half as
an `AC-*`. Copying the old name after that demonstration has been shown is a supersede, not a
warning to work around.

### F84 — a pass recorded before its characterization pins snapshots a tree that is not the finished task. **[verified]**

Raised by the executor at `C-DRIFT-HONESTY`'s close, against a design note in the plan **it had
written and I had approved**.

The plan's D5 said T-001 should record `pass`, **then** add the bounding characterization pins. The
executor inverted that deliberately and reported it. It is right: `cursor attempt --outcome pass`
snapshots `WriteEvidence` at the moment it runs, so a pass recorded before the pins captures a tree
**missing the files that bound the task's claim**. The ledger would then show a completed task whose
evidence set is smaller than the task's own deliverable — and the WriteEvidence scope audit, which
reads that snapshot, would never see them.

**Pins belong inside the pass snapshot.** The ordering is: red → production → bounding pins → pass.

**A second, unrelated observation from the same report, worth its own line.** The plan called T-002's
other-suffix case *"part of the recorded red"* so that "each failure prints" — but at fail-record time
that case **does not fail**; it is a bound, the same job as T-001's credit-outside pins, which the plan
correctly kept off `AC-HEAD-RED`. Calling both halves "the red" overstates what the fail event
observed. This is [F80](#f80)'s rule from the other direction: F80 says one red must not be *cited* for
two properties; this says a red must not be *described* as covering a case that was green when it was
recorded.

**Also standing, and now load-bearing.** `skills/ngrace/ngrace-execute/SKILL.md` still assigns
`--assertions final`, apply and archive to the executor, while this roadmap's practice — reinforced by
[F82](#f82) — makes the close authority-owned. Every dispatch in this phase has had to contradict the
shipped skill on that split, and the executor has flagged it each time. **Decide it rather than
re-encountering it:** either the dispatches stop deviating, or the skill acknowledges an
operator-owned close. Not this bundle's scope; owed to whichever bundle next opens `ngrace-execute`.

**The rule.** Evidence is captured at the instant the event is recorded, so **the order of writes
inside a task is part of what the task proves.** When a plan sequences a pass before any file the task
is accountable for, the plan has specified a snapshot that under-reports its own work.

**The standing skill-versus-practice contradiction is decided, not deferred.** [D20](#d20)
(2026-08-15): `--assertions final`, `review`, `gate verdict`, `gate apply`, `gate archive`, the
`applied` status writes and the archive move are the authority's acts. The snapshot-ordering rule
above is unchanged.

**Halves.** This finding records three observations. A brief citing the title as closed is
wrong: the title is a standing rule, not a closed defect. A brief citing the title as
open is wrong for the skill-versus-practice half.

| Half | State |
|---|---|
| Snapshot ordering (the title) | **Stated rule, no action.** Pins belong inside the pass snapshot. Nothing is owed. |
| What a red may be *described* as covering (the second, unrelated observation above) | **Stated rule, no action.** A red must not be described as covering a case that was green when it was recorded — [F80](#f80)'s rule from the other direction. The entry names no bundle, no action and no deferral against it; like F80 it is a rule the next plan author must not violate. |
| Skill versus practice | **Paid** by [D20](#d20) (2026-08-15). The skill-text follow-up is D20's work on `C-APPROVAL-SCOPE`, not remaining F84 debt. |

### F85 — findings say what is owed and never say when it was paid, so briefs inherit false debt. **[verified]**

Caught by the executor at `C-FINDING-SEVERITIES`'s spec authoring: my dispatch carried [F76](#f76) as
a live trap — *"this bundle's subject is a CLI flag"* — when unrecognised arguments have refused since
`C-RECORDED-DEBT`. Measured: F76 still ends *"Not fixed here… Owed as its own change."*

**No finding in this ledger has ever been marked discharged.** F60 was paid by `C-ONE-GLOB-LANGUAGE`;
F71, F74, F76 and F77 by `C-RECORDED-DEBT`; [F82](#f82)'s repair was demonstrated by
`C-DRIFT-HONESTY`. Every one of those entries still reads as outstanding. The ledger is append-only by
design (D9), which is right — but append-only means the **correction is another line, not a silent
edit**, and nobody has been writing that line.

**The cost is not tidiness.** The authority's briefs are assembled from this ledger, so stale debt
becomes a stale premise handed to the executor, which is the exact failure [F62.1](#f621) and
[F74.1](#f741) already record in other forms. This phase has now spent three separate corrections on
premises that were true when written and false when used.

**The rule.** **When a bundle discharges a finding, append a discharge line to that finding naming the
bundle** — one sentence, in the same append-only style, at the close that pays it. And before citing
any finding in a brief, **read its last line, not its first**: a finding's opening states the defect,
and only its tail says whether the defect still exists.

**Still genuinely owed at this point**, so the next reader has a true list: [F74.2](#f742)'s bare
`D15` in `src/test-support/token-accounting.ts:80` (needs a bundle that opens that file), and
[F84](#f84)'s standing contradiction between the shipped `ngrace-execute` skill and this roadmap's
authority-owned close.

**F84's skill-versus-practice half is paid by [D20](#d20)** (2026-08-15). The snapshot-ordering
rule in F84 stands. F74.2 remains the only entry on that list that is still open. The shipped
`ngrace-execute` text is now *wrong*, which is D20's named follow-up, not a remaining F84 deferral.

**That owed-list is a historical record, not a board** (appended 2026-08-15). It states what
was owed at the moment F85 was written, corrected by the line above; it is not maintained as
the live set. Per [Which document tracks finding state](#which-document-tracks-finding-state),
[plan.md](./plan.md) §1 is the board for current finding state. Read this file for *what was
observed and when*, and each finding's last line for whether its defect still exists.

### F86 — P3's gate cannot be run: its transcript does not exist and two of its three targets are outputs of the phase it gates. **[verified]**

Measured at P3's opening, before any step detail was written.

**There is no brownfield transcript to re-run.** The gate says *"the author re-runs one brownfield
transcript end-to-end."* Nothing in this repository is one. `examples/polyglot/WALKTHROUGH.md` is a
tour of a repo *"under full GRACE governance"* — greenfield, already adopted. `ngrace-init` is a
greenfield bootstrap that explicitly creates **zero** bundles; `ngrace-migrate` is GRACE 3 → neo-grace
artifact conversion and bans retroactive bundles. `grep -ri brownfield` hits only this roadmap and its
own sources. The ten brownfield guides the plan cites are, by its own admission, *"files in another
directory, owned by other people."* **Opening this gate requires authoring the transcript, not
re-running one** — the same class as P2's ≥80% metric ([F83](#f83)), where the measurement's subject
was a citation rather than an artifact.

**And the gate is partly self-referential.** Of its three quantities, *"manual post-gate steps = 0"*
and *"bundles for a bootstrap ≤ 3"* are **descriptions of what P3 and P4 deliver**, so measuring them
before those phases can only ever return the pre-phase number. Only *"remaining folklore steps"* is
measurable now, and the answer is concrete: **six manual post-gate steps, three of which have no CLI
verb of any kind** — writing `status="applied"` on the spec, on the plan, and moving the bundle to
`archive/`. `src/gates/command.ts` says so outright: *"Does not set status=applied and does not move
bundles (invariant 8)."*

**The sharpest measured fact, and it is an honesty gap in the product's own record.** Across **43
archived bundles**, the run-ledger ends at the archive gate's `Decision`. **Nothing is recorded
after it** — yet both artifacts read `applied` and the bundle sits under `archive/`. The three
folklore steps leave **no machine record at all**, so the ledger cannot show that the transition it
gates ever happened. That is what P3.1 exists to close, and it is a stronger argument for the step
than the step makes for itself.

**Two corrections to P3's own text, applied in the roadmap.** P3.7's *"all sixteen archived bundles"*
was measured 2026-08-09 and is now **43 (39 with a ledger)** — a corpus 2.7x the size the rule was
sized against. And P3.1's *"folds any loose epoch"* fires on **recovery paths only**: the archive gate
already requires `no-open-epoch`, so on the normal path there is nothing left to fold.

**The rule.** A gate that measures its own phase's output is not a gate — it is a restatement of the
objective. When writing one, separate **what must be true before starting** from **what success looks
like after**, and check that the artifact the gate reads actually exists in the repository that will
run it.

### F87 — lint still does not check XML well-formedness; F39's repair was exactly one rule wide. **[verified]**

Surfaced by the brownfield transcripts (`brownfield-findings.md`, incident O1) and verified directly.

**Measured, one lint run, 168 artifacts checked.** A `spec.xml` containing `&mdash;` — an undefined
entity, not one of XML 1.0's five predefined ones — reports **0 errors**. A conformant parser rejects
the same file: `undefined entity: line 3, column 19`. Replace the entity with `--` inside a comment
body and lint reports **1 error**, `xml.comment-not-well-formed`.

**So the well-formedness surface is one rule, not a parse.** [F39](#f39) said *"lint reports every
XML artifact clean while a growing set is rejected by a conformant parser"* and named the defect
precisely: *"the report's claim of a validity never checked."* P1.13 shipped a check for the single
case F39 happened to enumerate — two adjacent hyphens in a comment — and the general claim was left
standing. This is [F46](#f46) / [F49](#f49) / [F52](#f52)'s class again: **a check's name and its
blast radius drift apart**, and the citing artifacts inherited the optimistic reading. Nine bundles
have since been closed on a lint run that does not do what its own finding said it must.

**It took a weaker model to find it.** A capable model writes `—` or `-` and never emits an undefined
entity, so the gap was structurally invisible from inside this project — the same reason six manual
post-gate steps went unrecorded across 43 bundles. The failing agent wrote HTML out of habit, and the
tool told it the artifact was fine.

**And note what did *not* find it: verbosity.** The check was silent, so no amount of logging from
`ngrace` would have shown anything. What exposed it was a **differential** — running an independent
conformant parser over the same file and comparing verdicts. When a checker's honesty is in question,
a second implementation is the instrument; more output from the suspect one is not.

**The rule.** When a finding says a class of validity is unchecked, the repair is checked against the
**class**, not against the instance that surfaced it. Before closing such a repair, ask what else in
that class exists and construct one — and where the product claims conformance to an external
standard, **test it against an implementation of that standard**, not against itself.

### F88 — approval is self-certified: both agents approved their own specs, and nothing in the product can tell. **[verified]**

The most consequential result of the brownfield runs, and it is not a model defect.

**Measured.** In `neo-grace-6.2.0-brownfield-ornith_35`, commit `932c452` — *"GRACE: init done,
C-AUDIT-001 spec approved + plan partially written"* — writes `status="approved"` onto the spec the
same agent authored, in the same commit, with no human act between. The other run did the same at
its own scale. **Neither asked.** Two independent models, no hesitation.

**Why the product cannot object.** `gate approve` evaluates requirements and records a `Decision`,
but by A29.2 / D1 it deliberately **does not write `status`** — that transition is "authored". The
design assumed the author is a human ratifying work. Nothing enforces or records *who* authored it.
So the approved state that gates `ngrace plan new` (`change.plan-requires-approved-spec`) and
`gate apply` is, for an autonomous agent, **a self-certification** — the same actor writing both the
claim and its ratification.

**This is [F38](#f38)'s shape at the level above.** F38 found D12's approve gate vacuous because the
element it read could never be authored; the gate fired on nothing. Here the gate fires correctly and
the *state it guards* is writable by the party it is meant to constrain. A gate whose precondition the
gated party can simply assert is not a gate — and the roadmap's own words for the failure this product
exists to prevent are exactly this: **"an authored claim of doneness outrunning its evidence."**

**Note what this does not mean.** The rule is not wrong: D1's asymmetry — apply has a machine-evaluable
precondition, approve has none — is sound reasoning, and recorded as such. What is missing is that
*because* approve has no machine-evaluable precondition, the product has **no evidence about it at all**
and does not say so. It reports `approved` with the same confidence whether a human ratified it or the
authoring agent typed it.

**The honest options, none of them free.** (a) Record an attestation on the approve event — who, and by
what claim — accepting that an agent can also lie in a field. (b) Detect the shape: spec authored and
approved with no intervening act, and report it as an absence rather than a defect. (c) Say plainly, in
`status` and in `review`, that approval is unverified — the [`RM-AGENT-RELIABILITY` D5] typed-absence
answer, and the only one that costs nothing and claims nothing false. **(c) is the floor; anything else
is additive.** This also intersects `RM-GITLESS-INTEGRITY`, which already records that `gate approve`
keeps no fingerprint of the artifact it approved.

**The rule.** When a transition is left to a human on purpose, **say what the product knows about it**
— which is nothing. An unverifiable claim reported without qualification is indistinguishable from a
verified one, and the party best placed to exploit that is the agent the governance exists to
constrain.

### D18 — `gate approve` becomes the sanctioned writer of `draft → approved`, and records what it approved

**Decided 2026-08-14 by the maintainer**, on the evidence of [F88](#f88).

**The decision.** `ngrace gate approve` writes `status="approved"` onto the spec and records, on the
approve event, a **fingerprint of the artifact it approved**. A `status="approved"` that carries no
matching approval record — or whose fingerprint no longer matches the bytes — is a reportable defect,
the shape P3.7 already proposes for a hand-written `applied`. A non-interactive escape hatch ships
**with** the change, not after it, following [D1.5](#d1)'s precedent: it records the approval as
forced, with an operator-supplied reason.

**Why.** Two independent models adopting GRACE on a real repository each wrote `status="approved"`
onto the spec they had just authored, in the same commit, without asking anyone (F88). Neither
hesitated. The approved state gates `ngrace plan new` and `gate apply`, so for an autonomous agent it
was the same actor writing both the claim and its ratification — **"an authored claim of doneness
outrunning its evidence"**, which is the roadmap's own phrase for the failure this product exists to
prevent.

**What this changes about [D1](#d1), precisely.** D1 said the tool is the **only sanctioned writer of
`approved → applied`**, and left `draft → approved` authored, reasoning that *apply has a
machine-evaluable precondition — the gate — and approve has none.* **That reasoning was correct and is
not overturned.** What it did not anticipate is the consequence: because approve had no
machine-evaluable precondition, the product held **no evidence about it at all**, and printed
`approved` with identical confidence whether a human ratified it or the authoring agent typed it. D18
does not claim to have found a machine-evaluable precondition for human judgement. It **narrows the
unverifiable region**: the tool now records *that* an approval was performed and *what bytes* it
covered, leaving only *whether the human actually read them* outside the record — and says so rather
than implying otherwise.

**What this deliberately does not claim.** This is **tamper-evidence, not enforcement.** A single
actor with write access can still author the status, the record, and the fingerprint. What changes is
that forging approval becomes a **deliberate, visible act** rather than the default one — today,
writing `approved` is *easier* than asking. Do not let the change be reported as
"human-in-the-loop enforced"; verifiable approval needs a party the agent is not, which is recorded
separately as [`RM-VERIFIED-APPROVAL`](../RM-VERIFIED-APPROVAL/review.md).

**This decision is revisable, and here is what would revise it.** If `RM-VERIFIED-APPROVAL` ships —
an external service issuing one-time codes bound to an artifact fingerprint — the write path and the
attestation format both change, and D18's fingerprint record becomes the local half of a two-party
scheme rather than the whole of it. If measurement shows approvals are frequent enough to be pasted
unread, the correct response is to **narrow what requires ratification**, not to strengthen the
mechanism. And if a later reader finds that requiring the CLI to write status blocks a legitimate
workflow the escape hatch does not cover, that is evidence against this shape, not a reason to
hand-write around it — **amend the decision instead.**

**Sequencing.** The repo-local floor ships first and independently of any service: it needs no new
trust boundary, and it is the half that would have caught both measured runs, since **neither ever
requested an approval at all**. A future service that ships without the detection half has not fixed
F88.

### F87.1 correction — lint does validate; it trusts a validator that is not XML 1.0 conformant. **[verified]**

[F87](#f87) said lint *"still does not check XML well-formedness."* **The symptom was right and the
mechanism was wrong**, which matters because it changes what the repair is.

**Measured.** `parseGraceXmlArtifact` already calls `XMLValidator.validate` on **every** artifact
(`src/artifact/xml.ts:87-89`) and emits `xml.parse` on failure. Lint is not skipping validation. It is
trusting `fast-xml-parser`, and that implementation is **not conformant**. A differential against a
conformant parser over the same samples disagrees on four cases — `fast-xml-parser` **accepts** all
four:

| case | fast-xml-parser | conformant |
|---|---|---|
| `&mdash;` in text | accept | reject — undefined entity |
| `&nbsp;` in an attribute value | accept | reject — undefined entity |
| `--` inside a comment body | accept | reject — not well-formed |
| **two root elements** | **accept** | reject — junk after document element |

**So "turn the validator on" is not the fix — it is already on.** This is a parser-conformance
decision, not a wiring change.

**And the shape of the existing workaround is now explicable.** P1.13's `xml.comment-not-well-formed`
is a hand-rolled string scan for `--` plus a nine-path escape hatch. It exists **because the vendored
validator misses that case too** — P1.13 met this same leniency, patched the one instance it had
found, and left the general defect. That is [F46](#f46)/[F49](#f49)/[F52](#f52)'s pattern with its
cause visible in the source.

**The corpus is far cleaner than F87 implied.** Of **199** XML files, **9 fail** a conformant parse —
all one cause (`--` in comment bodies, from CLI flags written inside comments), all in archived plans.
`COMMENT_WELL_FORMED_PATH_ALLOWLIST` (`src/artifact/xml.ts:39-49`) names **exactly those nine**: set
equality, not overlap. Both skill template trees pass. **No migration strategy is needed** — the open
question is only whether to repair the nine and delete the allowlist, or widen the allowlist to cover
`xml.parse` as well. Note the allowlist currently suppresses only the comment rule, so under a
conformant parser those nine would fail at `xml.parse` and lose **all** downstream grammar checking,
since that path returns `root: null`.

**Two things the sweep surfaced that no finding had.** `allowBooleanAttributes: true`
(`src/artifact/xml.ts:88`) is a **deliberate non-conformance already in the configuration** — a
conformant parser rejects bare attributes, so any swap needs a decision on whether GRACE artifacts may
use them. And **a file with two root elements is accepted today**: a concatenated or duplicated
artifact is a corruption mode nothing in the product catches.

**The rule.** When a checker is found to miss a case, establish **whether it ran and was wrong** or
**never ran** before naming the defect — the repairs are different, and "it does not check" reads as a
wiring bug when the real answer is that the dependency's semantics differ from the standard the
product claims. Where a claim rests on a vendored implementation, **test the vendor against the
standard**, not the product against itself.

### F88.1 correction — the self-approval evidence is confounded: the prompt sanctioned guessing and never mentioned a human. **[verified]**

Raised by a third model (qwen 3.6) reflecting on its own run when challenged — a different run from
the corrected-prompt qwen3.8-28B one — and it is a correction to **my instrument**, not to its
behaviour.

**Measured against the prompt text.** The brownfield prompt contains **no occurrence** of *user*,
*ask*, *human*, *operator*, *interactive*, or *approval* — the sole match on that grep is an
incidental "approved through to archived". It offered exactly two categories for uncertainty:
`BLOCKED` ("could not proceed") and `INFERRED` ("you decided something the instructions did not
specify"). It then described `INFERRED` lines as **"the most valuable lines in the transcript."**

**So the instrument rewarded guessing and never disclosed that a human was reachable.** All three
models resolved the approval stop by inference and labelled it — which is precisely, and only, what
they were told to do. The third model named the conflation exactly: it read the absence of an
interactive user as *"there is no human to ask"*, when what was actually true was *"the CLI does not
enforce the lexicon."* Its own sentence is the sharpest statement of the product principle anyone has
written this phase: **"the human stop is a social contract on the agent, not the binary."**

**What this does and does not do to [F88](#f88).**

- **The product defect stands, and is not transcript-dependent.** `gate approve` does not write
  `status`; nothing records who authored the transition; the product cannot distinguish human
  ratification from agent self-certification. That was verified from source, not inferred from
  behaviour. [D18](#d18) rests on that, and is unaffected.
- **The behavioural claim is contaminated and must not be cited as it was written.** F88 says the two
  models did it *"without hesitation"*, framed as evidence that agents will self-certify when
  unwatched. They had no sanctioned alternative. **That inference is not supported by this
  experiment.** What the runs do establish is weaker and still useful: when a governance stop is
  unenforced by the tool *and* unmentioned by the operator, it is skipped — three times out of three.
- The third run adds the piece the design most needed: challenged, the model recognised the stop as
  binding, reverted its own self-approval, and asked. **The gate is respected when it is surfaced.**

**A second finding out of the same run, unrelated to the confound.** It wrote module-contract markup
into a file that its own change's `ObservedWriteScope` names — **before the spec or plan were
approved**. Governance writes landing ahead of the approval that gates them is an ordering hole the
lifecycle does not currently catch, and no finding covered it.

**The rule.** **An instrument that offers only one route past uncertainty measures the route, not the
subject.** Before drawing a behavioural conclusion from an agent transcript, read the prompt for the
options it made available — and check whether the behaviour under study was one the prompt made the
cheapest legal move. Give every affordance you intend to measure: if asking is a possible correct
action, the prompt must say a human is reachable, or its absence is the finding about the prompt.

### F89 — skills are the governance mechanism, and they are only binding in a harness that executes them. **[verified]**

Observed across three brownfield runs: **the models read the skills as reference material rather than
executing them as contracts.** Reading is not following. A document you consult is information you may
weigh and discard; a skill that is *invoked* governs the turn.

**Why this is a product finding and not a harness detail.** GRACE ships its governance **as skill
text**. The approval lexicon, the stop points, the must-do tables, the ordering rules — none of them
live in the binary. `ngrace` does not check that a human approved, does not check that the spec skill
was consulted, does not check ordering of governance writes. **So the enforceability of GRACE's
central controls is delegated to whether the reader's harness treats `SKILL.md` as instructions or as
documentation** — a property the product neither declares nor detects.

This is the mechanism behind [F88](#f88) and its correction: a model that never invokes `ngrace-spec`
never encounters the instruction to stop for approval, so the stop is not *skipped* so much as never
seen. The third run's own phrasing is the right frame — *"the human stop is a social contract on the
agent, not the binary"* — and a social contract requires the other party to have read it.

**What follows, and none of it is free.** Either (a) the controls that matter move into the binary,
where they are checkable — which is [D18](#d18)'s direction for approval and would need repeating for
ordering and lexicon; or (b) the product states plainly that skill contracts are advisory outside a
skill-executing harness, which is honest and weak; or (c) skills gain a machine-checkable
representation the CLI can verify was honoured, which is new surface. **What is not defensible is the
current position: shipping controls as prose and reporting outcomes as though they were enforced.**

**Measurement note for the next run.** A prompt cannot make a harness execute skills, but it can force
the reading to become accountable: require the agent to transcribe each skill's requirements as a
checklist *before* the stage and mark every item done / skipped / could-not *after* it. That converts
a document into obligations and makes a skipped contract item visible in the transcript instead of
silent. Applied to the brownfield prompt on 2026-08-14.

**The rule.** When a control is shipped as text for another system to honour, **it is not a control —
it is a request.** Before claiming a governance property, ask which component refuses when the rule is
broken; if the answer is "the agent, if it read the file", the property is aspirational and must be
reported that way.

### F88.2 — given a reachable human and a ban on self-approval, the fourth measured run asked. **[verified]**

Qualifies [F88](#f88)'s behavioural claim. Does not touch the product defect.

**Measured, run 4** (`neo-grace-6.2.0-brownfield-qwen3.8-28B`, prompt at
`/Users/sas/Projects/neo-grace-useful-prompts/brownfield-transcript-prompt.md`; evidence in
[brownfield-run4-findings.md](./brownfield-run4-findings.md)). The spec stayed `draft` until a
human said `i approve`. `plan new` was proved to refuse beside that draft. The plan stayed
`draft` until `i approve plan`. `status="approved"` was then hand-written, as D1 still
requires. The apply Decision records `plan-present status=approved`, so the sanctioned
authored transition happened; it was never committed as its own snapshot
(`a24eafd` is draft, `6cc2429` is applied).

**What this does and does not do.**

- **F88's product defect stands.** `gate approve` still does not write `status`; nothing
  records who authored the transition; the product cannot distinguish this run's human phrase
  from ornith's silent seven characters. [D18](#d18) still rests on that.
- **F88's "neither asked" / "without hesitation" does not describe this run.** F88.1 already
  withdrew that inference as confounded by the old prompt. This run is the positive control
  that sentence needed: name a human, forbid self-approval, and the approval stop is
  respected. That is a fact about the *corrected instrument*, not about agents in general
  (F88.1's rule, applied here as T7).
- **D18's sequencing sentence** — *"neither ever requested an approval at all"* — is now
  three-of-four: runs 1–3 (ornith, muse, and qwen 3.6, all on the original prompt) never
  requested an approval; only this fourth, corrected-prompt run asked. Not rewritten in
  place. The repo-local floor is still the half that would have caught runs 1–3, and is
  still the record this run's ask does not have.
- **The stop that was skipped is a different stop.** Action #34 mutated `ObservedWriteScope`
  on an approved working-tree plan. The corrected prompt did not prevent it. It was surfaced
  only after a human challenge (#41). Approval-of-status and immutability-of-content are not
  the same gate; this run honoured the one the prompt named and broke the one it did not
  score.

**The rule.** A behavioural finding measured under one prompt is not a finding about agents.
Re-measure under the affordance you intend to claim, and say so when the new measurement is
of the instrument.

### F88.1.1 — governance writes still land before the approval that would gate them. **[verified]**

F88.1's second finding, reproduced on this run rather than only on the qwen 3.6 reflection
that raised it.

`6809122` adds `M-IDENT` to the graph, `MODULE_CONTRACT` / `MODULE_MAP` on
`internal/ident/ident.go`, and `V-M-IDENT`. The spec does not exist until `a60e161`. No
change bundle owns the bootstrap; lint is green; the lifecycle has nothing to refuse.
Ordering of governance writes ahead of `draft → approved` is still unenforced. No finding
before F88.1 covered it; this is that finding, now with a committed tree.

### F89.1 — the checklist obligation was skipped where the contract was broken. **[verified]**

[F89](#f89)'s measurement note, applied. The corrected prompt required: before each stage,
transcribe the owning skill's requirements; after, mark each `done` / `skipped` / `could
not`.

**Measured against the transcript, not against the model's account of it.** Init has a
pre-stage checklist and no after-stage marks. Spec, plan, and execute have no transcribed
must-do table — plan cites "must_do (1-17)" as a count. Cursor `advance` / `attempt` /
`fold` ran (the ledger has them) and are not numbered. The skip that mattered — approved-plan
immutability, #34 — is visible because they wrote that they were violating it, not because a
checklist item was marked `skipped`.

**So F89's prediction is not borne out as specified.** A prompt-level checklist is the same
class of control F89 named: a request, binding only if the reader executes it. This run
executed it at the given entry point (init) and dropped it once inside the lifecycle. The
instrument did not make later skipped contract items visible; the instrument was itself
skipped.

**The rule.** An obligation whose only enforcement is "write it down before you start" will
be written down where the operator is watching the start, and not where the operator would
most need the skip to be visible.

### F86.1 — a stranger reached the close; the three no-verb steps were performed; the ledger still ends at `archive=permit`. **[verified]**

[F86](#f86) said the three folklore close steps — spec `applied`, plan `applied`, `mv` to
`archive/` — had not been "discovered by doing" because neither run 1 nor run 2 reached a
permitting `gate apply`. This run did.

Ledger at `cd6def9`: `apply=permit` (after a first refuse for no verdict),
`archive=permit` (`run/ empty`). Bundle sits under `archive/C-IDENT-COVERAGE/`. Both
artifacts read `status="applied"`. Nothing is recorded after the archive Decision. The
three writes are still folklore. F86's honesty gap is no longer a prediction about a close
nobody reached; it is a property of a close that happened.

P3.7's detection rule would fire on this bundle the day D1 ships, and D1.4's
non-retroactive trigger does not protect it — the ledger *has* approve events from the
gate surface. That is the rule working as designed, on a tree this repository does not
own.

### F86.2 — superseding a bundle has no verb; the only linting order is replacement-first, and nothing creates the replacement atomically. **[verified]**

[F86.1](#f861) recorded the *applied-close* instance of the missing-verb gap: spec `applied`,
plan `applied`, `mv` to `archive/` are still folklore. Superseding is the same shape and was
unrecorded. Measured over `C-CURSOR-TASK-SENTINEL` → `C-CURSOR-TASK-IDENTITY` →
`C-CURSOR-TASK-RESOLVER` (all three now archived).

**There is no `supersede` verb.** `src/grace.ts:41–56` registers `context`, `cursor`, `doctor`,
`file`, `gate`, `graph`, `lint`, `module`, `plan`, `review`, `scaffold`, `spec`, `status`,
`verification`. `src/gates/command.ts:336–340` registers `approve`, `apply`, `archive`,
`verdict`. `plan` and `spec` expose `new` only (`src/grace-generate.ts:154–156`, `:230–232`).
None writes `status="superseded"`, none writes `<Replacement>`, none moves a bundle.

**The four hand writes, forced by named checks.** A superseded bundle in `active/` is
`change.invalid-active-status` (`src/artifact/grammar.ts:539–542`;
`ACTIVE_CHANGE_STATUSES` is `{draft, approved}` at `src/artifact/types.ts:139`;
`ARCHIVED_CHANGE_STATUSES` is `{applied, rejected, cancelled, superseded}` at `:142`). In
`archive/`, spec status must equal plan status (`change.archive-status-mismatch`,
`grammar.ts:1316–1318`). Each artifact with `status="superseded"` must name a different
replacement C-* (`change.superseded-missing-replacement` at `:588–598`;
`change.superseded-self-replacement` at `:601–604`). So the close is: a `status` write on
`spec.xml`, a `status` write on `plan.xml`, a `<Replacement>` (or `ReplacementChange`, or
direct C-* child — `replacementChangeIds` at `:1426–1433`) on **both**, and a filesystem
move to `archive/`. All four are visible on the archived pair:
`C-CURSOR-TASK-SENTINEL/{spec,plan}.xml:1–3` (`status="superseded"`,
`<Replacement>C-CURSOR-TASK-IDENTITY</Replacement>`);
`C-CURSOR-TASK-IDENTITY/{spec,plan}.xml:1–3` (`status="superseded"`,
`<Replacement>C-CURSOR-TASK-RESOLVER</Replacement>`).

**The fifth absence is the one that decides the order.** `validateReplacementTargetExists`
(`grammar.ts:1436–1448`) errors `change.superseded-replacement-not-found` unless
`knownChangeIds` already contains the replacement. `collectChangeBundleIds` (`:1415–1423`)
reads directory names under `active/` and `archive/`. **The replacement bundle must already
exist as a directory.** No verb creates it atomically with the supersede. The only order
that ever lints is **replacement-first**.

**What the skills actually say.** `skills/ngrace/ngrace-plan/SKILL.md:32` is *"Create a new
`C-*` bundle and mark the old bundle superseded with an explicit replacement reference"* —
create-then-mark as a sentence, no named checks, no status-on-both, no move, no statement
that every other order is an error. `ngrace-execute` `:8` and `:28` say "supersede and
replan" as a recovery action. Neither is a verb, and neither names the grammar that makes
replacement-first the only green path.

The honest intermediate state is unrepresentable, the same class as [F19.1](#f191): write
`superseded` while still under `active/` and `change.invalid-active-status` fires; move
without matching statuses and `change.archive-status-mismatch` fires; move without the
replacement directory and `change.superseded-replacement-not-found` fires.

**The rule.** A lifecycle transition the grammar accepts only as four writes plus a move,
and only after a directory the transition itself does not create, is not a transition the
product performs. It is folklore with a checker.

### F90 — `--run-commands` emits `T-000`, which the plan cannot declare, and a clean cursor then cannot be derived. **[verified]**

The check ran and was right. The writer is wrong.

`lint --run-commands` records each `MustPassCommand` through `appendCommandRunEvent`
(`src/lint/core.ts:501`) and never passes a task. The writer falls back:

```
const task = options.task ?? loose[loose.length - 1]?.task ?? "T-000";
```

(`src/grace-cursor.ts:2977`.) After a fold, `run/` is empty, so the next command-run is
`T-000`. `cursor.unknown-task` (`src/artifact/grammar.ts:1365–1369`) then fires when
`run.xml` names a task the plan does not declare. The same module's position type says
*"Known task id only — never a guessed id (A13.2)"* (`src/grace-cursor.ts:252–256`).
`T-000` is a guessed id.

Reproduced on run 4 at HEAD of that branch: lint 1 error, `run.xml names task T-000,
which is absent from plan.xml`. `ngrace cursor regenerate` dry-run prints `Task: T-000`
from the folded ledger. The `--explain` repair ("regenerate from the ledger and plan")
re-derives the illegal name. There is no sanctioned edit of a folded ledger.

**The transcript overclaimed "unreachable".** Re-opening a declared task before the
post-fold `--run-commands` avoids the fallback. The *written* close protocol does not say
that: `ngrace-execute` step 7 runs `--assertions final --run-commands` as the outermost
lifecycle gate; step 9 then applies and archives; archive requires `no-open-epoch`.
Followed in that order, the sanctioned path emits `T-000`, demands a fold, and leaves
`cursor.unknown-task` if the fold is done by opening the sentinel.

**P3.1 as specified does not cover this.** `lifecycle finish` folds loose epochs and
writes `applied`. Folding T-000 events without renaming the cursor leaves the same error.
The derivation pass for P3.1 has to absorb this, or a small `C-*` has to land first. See
the decision candidate below.

**The rule.** A fallback identity the grammar forbids is not a fallback — it is a
self-inflicted integrity error. When the close protocol writes a task the plan cannot
declare, the checker that then refuses is doing its job; the repair is the writer.

#### Decision candidate — T-000 (not ratified)

Honest options, none free:

- **(a) Do not emit `T-000`.** Inherit a task the plan already declares, or refuse
  before write. No new lint surface — `src/grace-lint.ts` still has no `--task` flag.
  Sources, in this order, only when the id is in `planTaskIds`: explicit `options.task`
  (library callers; not a new CLI flag), last loose event, `run.xml` Task, last folded
  ledger event. Refuse `invalid-arguments` when none of those is a declared id. Cheap,
  fail-closed, matches A13.2. Cost: every post-fold `--run-commands` needs a declared
  task already in scope. The execute skill must say so.
- **(b) Declare `T-000` as a permitted system task** the grammar exempts from
  `cursor.unknown-task`. Makes the fallback legal. Cost: a phantom task in every
  command-run-only epoch; `status` `tasks=` becomes a lie unless counted separately;
  A13.2 is weakened for one magic id.
- **(c) Auto-terminate command-run events** so they never become the cursor's current
  task and never require a T-000 open/terminal to fold. Cost: fold semantics grow a
  special case; "terminal is a judgment" (cursor kinds) is no longer true for this kind.

**(a) is the only option that does not invent a task the plan did not declare.**
**Shipped as (a) without the `--task` flag this candidate first proposed**, by
[`C-CURSOR-TASK-RESOLVER`](../../../../.ngrace/changes/archive/C-CURSOR-TASK-RESOLVER/)
in PR #59 (`49c3c94`).

**Discharged by [`C-CURSOR-TASK-RESOLVER`](../../../../.ngrace/changes/archive/C-CURSOR-TASK-RESOLVER/)
(PR #59, `49c3c94`).** `resolveDeclaredCommandRunTask` (`src/grace-cursor.ts:3126–3150`)
inherits a `planTaskIds` member from explicit `options.task`, last loose event, `run.xml`
Task, or last folded ledger event, and throws `invalid-arguments` when none is declared
— *"Cannot record command-run: no declared task is in scope."* `appendCommandRunEvent`
calls it at `:2989`. The T-001 fallbacks on `recover --fix` and
`maybeAutoOpenCoveringAllocation` are deleted; both now `inheritLooseEventTask`
(`:736–746`) and refuse rather than invent. `cursor.unknown-task` is untouched. No
`--task` flag was added to lint (`src/grace-lint.ts` has none); a new lint argv token
`task` was a NonGoal (`C-CURSOR-TASK-RESOLVER/spec.xml:587–591`). The bundle's own close
is the proof: post-fold `--assertions final --run-commands` wrote events 13–18 as
`task="T-003"` (`run-ledger.xml` Epoch-2), not `T-000`.

**Residuals this discharge does not pay**, all stated NonGoals of that spec
(`:592–612`) and still true at `49c3c94`: `regenerateCursor` (`src/grace-cursor.ts:802–815`)
still re-derives whatever `derivePosition` last-event / last-ledger task is
(`:1374–1380`), with no `planTaskIds` check; default `--open-epoch` `from = options.from
?? 1` (`:910`) still holes after a fold ([F90.1](#f901) point 3); operator-supplied
advance / attempt task ids are still unchecked at write time ([F98](#f98)); the published
`@neograce/cli@6.2.0` still invents the sentinel ([F99](#f99)). [F93](#f93) is unchanged.

### F91 — `scaffold` cannot create the first module; nothing else writes one. **[verified]**

Runs 1–2 recorded that `scaffold` was not found. This run found it.

`ngrace scaffold --module M-X` throws `Unknown module ${moduleId}` when the graph has no
such record (`src/grace-generate.ts:183`). `ngrace module` is find / show / health.
`ngrace graph` is `split`. `ngrace init` is not a command. The first `M-*` + `V-M-*` +
graph index entry of a legacy repo is four hand-edits and a lint. Live on run 4:
`scaffold --module=M-VOLUME` refused; they hand-wrote `M-IDENT`.

**Scheduled, not new debt.** P4.1 (`graph scan --draft`) is the owner. Recorded because
the mechanism — the repair verb they were told to find *refuses the bootstrap case* —
was not in the F-register, and because "not found" and "found and refused" have
different repairs. Teaching `scaffold` harder does not create the first module.

### F92 — generators still emit `bun test` and `ObservedWriteScope <None />`, regardless of detected language. **[verified]**

P1.5 paid valid-by-construction emit (`C-SKELETON-GENERATORS`). Unmodified output lints
0. That debt is paid (F85). This is a different one.

`src/artifact/skeletons.ts:113` and `:160` hardcode `bun test`. `:198–199` emit
`<ObservedWriteScope><None /></ObservedWriteScope>`. Neither reads
`.ngrace/context/technology.xml` (this run's says `<Language>Go</Language>`). Combined
with [F11](#f11)'s leftover — spec.xml / plan.xml are **intentionally** inside the
scope-audit universe (`src/review/core.ts:986–1005`; test
`AC-SCOPE-LIFECYCLE-EXCLUSION`) — the first `ngrace review --change` after `spec new` /
`plan new` flags the bundle's own files unless the author names them.

This run overrode `bun test` by hand, named `go test ./internal/ident/...`, and still
self-flagged because OWS was `<None />` then only the test file. The OWS correction was
the approved-plan mutation F88.2 names.

#### Decision candidate — skeletons (not ratified)

- **(a) Language-detecting emit** (`go test ./...` from `technology.xml` / adapter /
  `go.mod`). Fits the repo they just initialised. Cost: init's guessed `<Language>`
  becomes load-bearing; a wrong guess emits a wrong command that looks official.
- **(b) Keep `bun test` as a valid-by-construction placeholder** and make the instance
  message at first lint say so. Honest about P1.5's acceptance test. Cost: every
  non-JS repo rewrites every spec and plan, which is what this run did.
- **(c) Seed OWS with the bundle's own `spec.xml` and `plan.xml`.** Stops the first
  review from self-flagging the generator's own writes. Cost: those paths then *must*
  stay in scope, which is what F27.2 already asks the author to declare; the generator
  would be doing the skill's must-do #6.

**(c) is cheap and local; (a) is the one the transcript asked for and is a product
change to a completed phase.** Not ratified here.

#### Decision candidate — apply/archive lexicon (not ratified)

This run's #38: there is no approval-lexicon phrase for apply / archive / `applied`.
The human's "per-state, do not extrapolate" rule left the close unattested. D18 and
`RM-VERIFIED-APPROVAL` already own attestation for `draft → approved`. Widening the
lexicon to apply without a machine-evaluable extra is more prompt, which F88.2 just
measured as insufficient for a different stop. Leave it on that entry. Not a new
`RM-*`.

---

### F90.1 correction — `T-000` is a well-formed task id; the check fires on undeclared, not reserved; the way back exists and is undocumented. **[verified]**

[F90](#f90) said `--run-commands` emits `T-000`, *"which the plan cannot declare"*, and that
*"there is no sanctioned edit of a folded ledger"* / the written close protocol leaves
*"no sanctioned way back"*. **Four of those clauses do not survive HEAD.** The writer is
still wrong and the checker is still right. What F90 named as the repair, and what it
named as unreachable, are not.

**1. `T-000` matches the task grammar.** `ANCHOR_PATTERNS.task` is `/^T-[0-9]{3}$/`
(`src/artifact/types.ts:212`). `T-000` is a well-formed task id. A plan *may* declare it.
Generators emit `T-001`; conventional plans do not declare `T-000`. That is a convention,
not a reservation. F90's phrase that the plan cannot declare the id is false as grammar. It
is true of the conventional plan the close protocol produces.

**2. `cursor.unknown-task` fires on an undeclared id, not a reserved one.**
`src/artifact/grammar.ts:1361–1370` is `if (!tasks.has(entry.task))` against
`planTaskIds`. There is no blacklist. A plan that declared `T-000` would silence the
code for that id. A repair that exempts `T-000` from the checker — F90 candidate (b) —
would therefore be the wrong repair even if it were ratified: it would punch a hole in a
check that is doing its job, for an id the grammar already accepts. Candidate (b) is
more clearly wrong than F90 stated, not less.

**3. The way back exists and is undocumented.** After a poisoned `T-000` command-run,
`cursor advance --task T-001 --kind terminal` *without* `--open-epoch`, then `cursor fold`,
leaves `run.xml` on a declared task. Fold's auto-open (`src/grace-cursor.ts:1081–1087`,
`maybeAutoOpenCoveringAllocation` at `:730`) inherits the last loose event's task; a
trailing declared terminal makes that task `T-001`. The same sequence is already in the
suite: `src/grace-cursor.test.ts:2966–2967` advances `kind: "terminal"` with no
`openEpoch` after a post-work `appendCommandRunEvent`, then folds. F90's *"no sanctioned
way back"* is an overclaim. **No *documented* way back is true, and still damning** —
`ngrace-execute` steps 7 and 9 (`skills/ngrace/ngrace-execute/SKILL.md:40–43`) still run
`--run-commands` after fold and then archive, and nothing in that contract names the
terminal-without-open-epoch recovery. An operator following the written order still walks
into the trap F90 measured.

The natural reread of "re-open a declared task" does **not** work. Default `--open-epoch`
sets `from = options.from ?? 1` (`src/grace-cursor.ts:896`). After a prior fold,
`nextEventId` takes `ledgerMax + 1` (`:3047–3051`). The new opened event lands at that
id with allocation `1..id+98`. `validateEventsAgainstAllocations` (`:2536–2540`) then
refuses `range hole at 1`. The suite already knows: `:2976` comments *"default from=1
would hole"* and computes `from = maxFolded + 1` by hand. That is why the recovery has
to be *no* default open-epoch.

**4. The `T-001` fallbacks F90 never named.** F90 cited `appendCommandRunEvent`'s
`?? "T-000"` at `src/grace-cursor.ts:2977`. Two siblings invent `T-001` by the same
A13.2 shape:

| Writer | Line | Fallback |
|---|---|---|
| `recover --fix` | `src/grace-cursor.ts:616` | last loose task, else `"T-001"` |
| `maybeAutoOpenCoveringAllocation` | `src/grace-cursor.ts:730` | last loose task, else `"T-001"` |

After a `T-000` command-run they *inherit* `T-000` (not a new guess). The `T-001`
fallback is the same defect on the empty-`run/` path. A repair that changes only
`:2977` and leaves these two is this repository's repeated one-site patch.

**What this does and does not do to [F90](#f90).**

- **Stands.** The writer invents a task id. The checker is right to refuse an undeclared
  one. The written close protocol emits `T-000` after fold, and archive then permits
  (`[F93](#f93)`). Candidate (a) — do not emit a guessed id; refuse when none is in
  scope — is still the only option that does not invent a task the plan did not declare.
  Not re-ratified here; still not ratified there.
- **Overturned.** "The plan cannot declare `T-000`." A blacklist of `T-000` as the
  repair. "No sanctioned way back."
- **Narrowed.** "No sanctioned way back" → no *documented* way back. The verbs exist;
  the contract does not name them.

Those three clauses are this correction's effect on [F90](#f90) at the time it was
written. The writer-invents clause and "still not ratified" are now paid; see the
writer-half paragraph below. The archive-permits half is still [F93](#f93).

**Scheduled as `C-CURSOR-TASK-SENTINEL`, already authored on `fix/cursor-task-sentinel`
at `241c628`** (`.ngrace/changes/active/C-CURSOR-TASK-SENTINEL/spec.xml` on that
branch; not present here). That spec absorbs these four points (its Problem states
them) and forbids exempting a sentinel id. This pass does not create or edit that
bundle.

**The writer half is paid.** `C-CURSOR-TASK-SENTINEL` was superseded (F83 close-criterion
trap) by `C-CURSOR-TASK-IDENTITY`, which was superseded (F64 write-scope miss) by
`C-CURSOR-TASK-RESOLVER`, which shipped [F90](#f90) candidate (a) in PR #59. Point 3's
range hole and the regenerate re-derivation of an undeclared last event remain, as
that spec's NonGoals (`C-CURSOR-TASK-RESOLVER/spec.xml:600–612`).

**The rule.** A well-formed id the plan did not declare is an undeclared id, not a
reserved one. Do not repair a guessed fallback by making the guess legal.

### F93 — the archive gate permits a cursor that lint rejects. **[verified]**

`evaluateArchiveGate` (`src/gates/core.ts:423–467`) carries one requirement,
`no-open-epoch` (`:450`), and **no cursor requirement at all**. If `run/` has no
foldable loose events, the gate permits. It does not read `run.xml`. It does not
run `cursor.unknown-task`. A bundle whose cursor names `T-000` and whose plan does
not declare `T-000` archives cleanly.

That is how brownfield run 4 archived. [F86.1](#f861) recorded the close:
`archive=permit` (`run/ empty`), bundle under `archive/C-IDENT-COVERAGE/`, lint at
HEAD one error, `cursor.unknown-task`. The gate and the checker disagreed, and the
gate won.

**This is a defect of the gate, not of the writer.** [F90](#f90) / [F90.1](#f901)
own the guessed id. This finding owns the gate that then accepted the poisoned
cursor as a closed bundle. Two surfaces, two repairs.

**P3.1 inherits it verbatim.** `lifecycle finish` (`plan.md:462–467`) is *"one
operation that, after a permitting `gate apply`: folds any loose epoch (via P0.6 —
recovery paths only; see F86, since the archive gate already requires
`no-open-epoch`)"*. The justification for trusting fold-and-move is the archive
gate's `no-open-epoch`. That predicate does not see the cursor. Shipping P3.1
against the gate as it stands moves a lint-red cursor into `archive/` in one
verb, with `status="applied"` written by the tool, which is a worse record than
today's folklore close: the same residual, now tool-certified.

`C-CURSOR-TASK-SENTINEL` spec `:280–285` (same branch) explicitly forbids
touching `src/gates/**` archive predicates. The owner is not that bundle.

**The mechanism it demands.** The archive gate must require a cursor that lint
accepts. A live `cursor.unknown-task` (and, once [F90.1](#f901) lands, any other
cursor error) is a refuse, not a permit. `no-open-epoch` stays; it is no longer
sufficient.

**This is a binding requirement on P3's derivation.** P3 is objectives-only
(`plan.md` header; `docs/plans/README.md` rule 7). This pass does not write P3
step detail. The derivation that authors P3.1's first bundle must carry the
requirement. The bundle that requirement names is **`C-ARCHIVE-CURSOR`** — either
as its own change or as a must-include of `lifecycle finish`. Not created here.
Not folded into `C-CURSOR-TASK-SENTINEL`.

**The rule.** A gate that asks only "is `run/` empty?" will archive whatever
`run.xml` says. Emptiness of the loose directory is not integrity of the cursor.

### F88.3 — the authority-side half of F88: a brief asserted ratification, and the product could not refuse. **[verified]**

On 2026-08-15 an executor brief *asserted* that the maintainer had ratified
`C-CURSOR-TASK-SENTINEL` and made the `status="approved"` write step 1 of a
numbered imperative. The executor performed it, then self-audited and stopped.
**Nothing in the product could refuse.**

`evaluateApproveGate` (`src/gates/core.ts:259–298`) reads one thing:
`no-unresolved-ic-inv-clarification`. It reads no phrase. It writes no status.
`src/gates/command.ts:15` is still *"evaluate/record; never author status
(A29.2, A31.1)"*. The permit that followed dressed a self-certified write as a
gated approval of a human-ratified spec.

The record it produced, discarded at the maintainer's direction before any commit,
was exactly:

```xml
<Decision gate="approve" decision="permit" baseCommit="93d30dab4140bcb4fef427ae96b4a04a61dc3204"><Requirement id="no-unresolved-ic-inv-clarification" required="true" present="true" blocking="false" /></Decision>
```

`93d30dab4140bcb4fef427ae96b4a04a61dc3204` is the draft-spec commit. The same
XML now sits in the committed ledger (`241c628`, the authority's later act,
after a real in-session phrase). **The discarded Decision and the kept Decision
are indistinguishable.** That is [F88](#f88) performed by this repository's own
operators, not by a brownfield adopter.

**Record the departure; do not reframe it as compliance.** The sanctioned route
for a wrongly transitioned artifact is supersede and replan with an explicit
replacement reference (`skills/ngrace/ngrace-plan/SKILL.md:29–33`,
`skills/ngrace/ngrace-execute/SKILL.md:8`). It was not taken. Nothing had been
committed, and the maintainer directed a discard — an exception, named as one,
following [F65](#f65)'s precedent for a user-directed departure (F65, not F64:
F64 is the scope miss that made supersede expensive after execution; F65 is the
named in-place exception). [F64](#f64) is the cost argument, not the precedent.

**What this does and does not do to [F88](#f88).**

- **The product defect stands, and has a second actor.** F88 measured adopters
  writing `approved` onto a spec they had authored. This is the authority writing
  `approved` onto a spec because a brief *said* a human had ratified it. Same
  seven characters, same gate, same silence. [D18](#d18) still rests on that.
- **F88.1's instrument confound does not cover this.** The brief was not a
  brownfield prompt that forgot to mention a human. It *named* the ratification
  as a fact and ordered the write. The failure is the opposite of F88.1: the
  human stop was asserted, not omitted.
- **D18 as written would not have refused this Decision.** D18 records a
  fingerprint of the bytes and writes `status`. It does not record the phrase,
  who said it, or what the phrase covered. A brief-asserted write plus
  `gate approve` still produces a permitting Decision whose fingerprint matches
  the bytes. The forged claim is *"a human ratified these bytes"*, and D18 does
  not hold that claim.

**The rule it yields.** A brief may assert nothing about ratification. The
phrase must travel with the bytes it covered, or the agent's write is
indistinguishable from self-certification — which, on this date, it was.

#### Decision candidate — phrase attestation (not ratified)

Honest options, none free. [D18](#d18) is already decided and is the floor.
This candidate is additive.

- **(a) D18 only — fingerprint of the bytes, no phrase.** Already decided.
  Cost: this slip's Decision still looks like a gated approval of a ratified
  spec. The discarded XML and the kept XML stay twins.
- **(b) D18 plus an attestation naming the phrase and the bytes it covered.**
  The approve event records the closed-lexicon phrase and a fingerprint of
  what that phrase was claimed to cover. A `status="approved"` whose record
  names no phrase — or whose phrase-fingerprint no longer matches — is the
  same reportable defect D18 already specifies for a missing fingerprint.
  Cost: an agent can still forge the field. That is D18's own ceiling
  (tamper-evidence, not enforcement). What changes is that forging the
  *ratification claim* becomes a visible act rather than the default one,
  the same move D18 already makes for the status write.
- **(c) Wait for [`RM-VERIFIED-APPROVAL`](../RM-VERIFIED-APPROVAL/review.md).**
  The phrase becomes a one-time code bound to the fingerprint, issued by a
  party the agent is not. Cost: not scheduled; the floor is still required
  first; this slip would have waited on a service that does not exist.

**(b) is the mechanism this slip demands, and it is not ratified here.** D18
as written records a fingerprint and not the phrase; saying that out loud is
the point of this entry. If (b) is adopted it ships *with* D18's
implementation, not after it — a floor that cannot tell this Decision from a
real one has not narrowed the unverifiable region this instance opened.

### F94 — a brief can contradict an approved spec, and the plan it would produce lints clean. **[verified]**

The same 2026-08-15 brief made `docs/plans/**` a deliverable of
`C-CURSOR-TASK-SENTINEL`. The approved spec forbids exactly that, as Constraint
prose:

```
Do not edit docs/plans/**, the phase board,
CHANGELOG.md, any version surface, or
.ngrace/changes/archive/**.
```

(`.ngrace/changes/active/C-CURSOR-TASK-SENTINEL/spec.xml:273–278` on
`fix/cursor-task-sentinel` at `241c628`. Not present on this branch; this pass
does not touch `.ngrace/`.)

The executor caught it by reading both. The product would not have.

`change.plan-scope-exceeds-spec` (`src/artifact/grammar.ts:1864–1873`) compares
`DurableScope` **anchors** against anchors collected from spec `AffectedAreas`,
at **warning** severity, and never looks at file paths. [F52](#f52) already
measured this. That spec's `AffectedAreas` (`:421–425`) is
`<M-CURSOR /><M-LINT-CATALOG /><M-SKILLS />` — no paths. A plan that listed
`docs/plans/**` under `ObservedWriteScope` would not trip this code. A brief
is not an artifact the product reads at all.

**Two layers, and they must not be collapsed.**

1. **Brief versus spec.** An executor brief is not a GRACE artifact. Nothing
   in the binary can refuse it. That layer ends in no shipped check, and
   cannot, without making briefs a governed surface they are not.
2. **Plan versus spec.** The plan the brief would have produced — one that
   names a path its spec forbids — lints clean. That layer is a product
   defect, and it is the one a check can close.

**The mechanism the brief under review demanded** — *"that check compares
file paths and errors"* — would not have caught *this* instance. The forbid
lives in Constraint prose, not in a path inventory. Widening
`change.plan-scope-exceeds-spec` to compare `ObservedWriteScope` paths against
`AffectedAreas` still compares against `<M-CURSOR />`. This is [F66](#f66)'s
class: a rule whose trigger is English is not a checkable predicate.

**The mechanism that would refuse the plan.** The spec carries a
machine-readable path bound (allow or forbid — `File` / `Path` / `Glob`
children, not Constraint sentences). The check compares the plan's
`ObservedWriteScope` against that bound, and **errors**. Existing
`change.plan-scope-exceeds-spec` cannot grow a path comparison until that
inventory exists; the grammar change is the bundle's first act, not a
severity flip on the current body.

#### Decision candidate — path-bound comparison (not ratified; scheduled)

- **(a) Structured forbid/allow on the spec, compared to `ObservedWriteScope`,
  error severity.** Catches the plan this brief would have produced. Cost:
  every existing spec that forbids paths only in prose stays silent until
  those forbids are restated as structured paths. Under [D5.2](#d5) that is
  a silent failure made loud *after* the inventory exists, not a
  compatibility break. Cost of the inventory: authoring burden on every
  spec that today writes "do not edit X" as a sentence.
- **(b) Severity-flip only — same check, error instead of warning.** Free,
  and does not see paths. This slip stays green.
- **(c) Parse Constraint prose for path patterns.** Unimplementable as a
  reliable check. F66 already refused this shape.

**(a) is the scheduled repair, not advice.** The bundle it names is
**`C-PLAN-SCOPE-PATHS`**. Not created here. [F52](#f52) recorded the weakness
and left it; this slip is what makes that weakness load-bearing. (b) and (c)
are recorded so a later reader does not "fix" F52 by flipping a severity on
a check that never looks at the thing that failed.

**The rule.** A Constraint that names a path is a request ([F89](#f89)). A
path the plan is forbidden to touch has to live in a field a checker reads,
or the forbid is decorative. A brief that contradicts a spec is a human
failure; a plan that would lint clean afterwards is a product one.

### F95 — `ngrace-plan` requirement 15 mandates the second, unorderable approve Decision. **[verified]**

[F81](#f81) measured **five** archived bundles already carrying two permitting approve
`Decision`s, and made the reader first-in-document-order / the writer first-observation-wins
so a re-approval cannot silently rewrite the recorded `baseCommit`. The count is no longer
five. Measured 2026-08-15 across `.ngrace/changes/archive/*/run-ledger.xml`: **ten**
bundles carry two byte-identical `<Decision gate="approve" decision="permit" …>` elements
(`C-CONTRACT-DEBT`, `C-CURSOR-TASK-IDENTITY`, `C-CURSOR-TASK-RESOLVER`,
`C-DECLARED-WRITES`, `C-EXPLAIN-COVERAGE`, `C-FAILURE-LOCALIZATION`,
`C-OBSERVABLE-CHECKS`, `C-REVIEW-SURFACE`, `C-SUBSTANCE-OVER-NAME`,
`C-SUBSTANTIATION-HONESTY`). The repo README does **not** note the pair; the "five"
lived in this file at F81 and in the P2 board, and is now a dated measurement, not a
current one.

**The causation is the product, not a re-approval.** `skills/ngrace/ngrace-plan/SKILL.md:68`
requirement 15: *"Before setting `plan.xml` to `approved`, run `ngrace gate approve
--change C-ID`."* The hard rule at `:112` repeats it. `gate approve` records a Decision
and does not write status (`src/gates/command.ts:15`, `:349–352`). The spec-stage run
already stored a permitting approve Decision. The plan-stage run appends another. On
`C-CURSOR-TASK-RESOLVER/run-ledger.xml` the two lines are byte-identical, including
`baseCommit="7957afef93f7cf56f5be441850d247049ed3cba7"` — first-observation-wins
(`src/gates/ledger.ts:354–358`, `firstStoredBaseCommit` at `:587–596`) copies the stored
sha onto the second write, and a `Decision` carries no timestamp. Nothing orders them.
The same pair is on `C-CURSOR-TASK-IDENTITY` (`baseCommit="684b724e9fe8920680cfd36c662dd936215c68ab"`).

Following the skill is what produces the unorderable record. This is
`RM-GITLESS-INTEGRITY`'s defect performed by the documented happy path, not by an
edit-and-re-approve.

**The rule.** A gate that records a Decision on every invocation, pointed at the same
requirement list, will append a twin every time the skill says to run it again. If the
second run is mandatory and the two records cannot be told apart, the product is
authoring the gap it will later be asked to detect.

The candidate that would stop the plan-stage run duplicating the spec-stage one is
under [F4](#f4). It is not ratified.

**Correction (2026-08-15), appended rather than rewritten.** The pointer above is false.
The [co-draft candidate](#decision-candidate--co-draft-the-pair-not-ratified) under
[F4](#f4) carries **no mechanism** that would stop the duplicate. A `<Decision>` written
by `gate approve` carries only `gate`, `decision`, `baseCommit` and `Requirement`
children (`src/gates/ledger.ts:553–584`; the type at `:109–114`) — no timestamp, no
stage, and no identity of the artifact it permits — so co-drafting both approvals into
one turn makes the two records **more** certainly byte-identical, not less. F4's own
candidate now says the same: co-draft as written would *worsen* F95.

The missing mechanism is [D18](#d18)'s fingerprint. What actually pays F95 is
**`C-APPROVAL-FINGERPRINT`** — position 2 of the [named-bundle registry](#named-bundle-registry),
authorized to start. `C-CO-DRAFT` is position 5, ordered *after* it, and the registry
records that it does **not** pay F95.

### F96 — `MustNotContain` binds a substring, so a rewording satisfies it while the prohibited behaviour remains. **[verified]**

Raised by the executor of `C-CURSOR-TASK-RESOLVER`. Re-derived, not taken from the brief.

`evaluateTextContainment` (`src/artifact/assertions.ts:345–368`) decides by
`contents.includes(expectedText)` (`:356`). `MustNotContain` is that test with
`shouldContain = false` (`:181–182`). There is no AST walk, no identifier check, no
behavioural probe. A Target `MustNotContain` of `?? "T-000"`
(`C-CURSOR-TASK-RESOLVER/plan.xml:199–201`) is satisfied by deleting those six
characters, or by spelling the same fallback as `` `${"T-000"}` ``, or by moving the
invention to a helper whose body the needle does not name. The prohibited behaviour —
inventing a task id the plan did not declare — can remain.

`MustMatchPattern` / `MustNotUseLiteral` (`:370–410`) compile a regex and still bind
text. Nothing in the assertion grammar binds "does not invent a task id".

**The rule.** A containment assertion is a spelling pin. Treat it as one. A behaviour
the plan needs to forbid needs a test that observes the behaviour, not a needle the
next author can rename past.

### F97 — the `assertion.` prefix remediation advises supersede-and-replan for planned baseline flips. **[verified]**

Raised by the same executor as [F96](#f96). The brief named `assertion.MustContain`;
there is no exact guide for that code (`src/lint/catalog.ts` `EXACT_GUIDES` has none).
`resolveLintIssueGuide` (`:1117–1125`) falls through to the prefix table. The
`assertion.` prefix (`:990–993`) remediates every assertion failure, including
`MustContain` and `MustNotContain`, with:

> Reconcile the current state with the approved plan assertions.
> If the approved plan is stale, supersede and replan rather than editing it silently.

That second sentence is the wrong remedy for a **planned** baseline flip. The same
bundle's baseline `MustContain` of `?? "T-000"` (`plan.xml:61–63`) is the current
tree; its target `MustNotContain` of the same needle (`:199–201`) is the flip. Mid-
change, the baseline fails because the production edit deleted the needle — the plan
is not stale, and superseding it would discard the flip it authored. The prefix cannot
tell a stale plan from a plan whose target is the negation of its baseline.

**The rule.** Remediation that names supersede as the response to any assertion
failure will fire on the exact shape a target assertion is for. A planned flip needs
a different sentence, or the catalog should stay silent rather than prescribe the
wrong lifecycle act.

### F98 — operator-supplied task ids are still unchecked at write time. **[verified]**

Stated NonGoal of `C-CURSOR-TASK-RESOLVER` (`spec.xml:592–599`). Still true.

`advanceCursor` writes `options.task` onto the opened event with no `planTaskIds`
check (`src/grace-cursor.ts:916`). The non-open path validates only
`ANCHOR_PATTERNS.task` (`:957–959`) — well-formed `T-NNN`, including undeclared
`T-000` and `T-999`. `cursor attempt` and `verification-unavailable` pass
`String(context.args.task)` through the same way (`:3279`, `:3335`, `:3382`).
Detection remains `cursor.unknown-task` when the name lands on `run.xml`
(`src/artifact/grammar.ts:1361–1370`). Prevention at the write is a different
product. No named bundle already owns this; it is not `C-ARCHIVE-CURSOR` (gate
predicate) and not a residual of the writer repair [F90](#f90) paid.

**The rule.** A write that accepts any well-formed task id will accept an undeclared
one. The checker that then refuses is doing its job; the residual is that the
illegal name is already on disk.

### F99 — the published `@neograce/cli@6.2.0` still invents `T-000`; the tree fix carried no version bump. **[verified]**

[F90](#f90) is paid **in this tree** (`49c3c94`). The change carried no version bump:
`package.json` is `"6.2.0"`, `openpackage.yml` / marketplace / plugin manifests agree,
`C-CURSOR-TASK-RESOLVER/spec.xml:548–554` forbade a version surface edit. `v6.2.0`
was tagged on 2026-08-12 (`0764686`); npm `latest` is `6.2.0`. Installers of the
published CLI still run the pre-`resolveDeclaredCommandRunTask` writer. The defect is
fixed in HEAD and live for installers until a release.

Not a `C-*` already named on this board. A release is a maintainer act, not a
roadmap bundle. Recorded so the next brief cannot treat a green tree as a green
install.

**The rule.** A repair that does not move the published version has not reached the
installers of that version. Say so at the close that ships it.

## D19 — an approval covers the current step only

**Decided 2026-08-15 by the maintainer**, on evidence from the SLM brownfield
runs, which raised the ambiguity, and run 4, whose human had to state the
per-state rule in-session because the skills do not.

**The decision.** An approval covers the **current step** only. Approval of
the spec is not approval of the plan. Approval of the plan is not approval
of apply, archive, or `applied`. Each transition waits on its own sufficient
phrase from the closed lexicon, matching that artifact. The skills **must
say this explicitly**.

**Why.** Run 4 asked before `draft → approved` on the spec, then asked again
for the plan ([F88.2](#f882)). At close the human had to say, in session,
that the rule is per-state and must not be extrapolated — because
`ngrace-spec` and `ngrace-plan` each ship a lexicon for *their* artifact,
`ngrace-execute` step 8 asks for "explicit apply confirmation" without a
closed phrase, and nothing anywhere says the earlier phrase does not travel.
The apply/archive lexicon candidate under [F92](#f92) already left that
gap on this entry. This decision answers the scope question those lexicons
were silent on.

**What it costs.** As skill prose it is a control shipped as a request
([F89](#f89)). Enforcement still arrives with [D18](#d18)'s fingerprint
binding an approval to bytes: a plan `approved` under a spec-only phrase
would be a status whose matching record, once D18 ships, either does not
exist or fingerprints the wrong artifact. Until D18 lands, this decision
is a sentence an agent may weigh and discard — the same class F89 named,
now written down so the next brief cannot pretend the skills already said
it.

**What this does not do.** It does not invent an apply/archive lexicon.
It does not make `gate approve` write status — that is D18. It does not
claim the product can see a phrase — that is [F88.3](#f883) candidate (b),
not ratified. It answers only *how far one phrase reaches*.

**This decision is revisable, and here is what would revise it.** If D18
ships and measurement shows per-step phrases are frequent enough to be
pasted unread, the correct response is the one D18 already recorded:
narrow what requires ratification, not a batch phrase that silently
covers the next three states. If `RM-VERIFIED-APPROVAL` ships, the unit
of approval (per spec, per bundle, per batch) is an open question of
that entry and may supersede this one. And if a later reader finds a
legitimate workflow that cannot name each step, that is evidence against
this shape, not a reason to treat one phrase as a season ticket —
**amend the decision instead.**

**Sequencing.** Named follow-up bundle: **`C-APPROVAL-SCOPE`**. It writes
the per-step rule into the spec, plan, and execute skills (and their
packaged mirrors). It does not implement D18. Not created here.

## D20 — the authority owns the close

**Decided 2026-08-15 by the maintainer.** Decision, not a deferral.

**The decision.** `--assertions final`, `review`, `gate verdict`, `gate apply`,
`gate archive`, the `applied` status writes, and the archive move are the
**authority's** acts, not the executing agent's. [D19](#d19) said an approval
covers the current step only; this says who performs the steps after the plan
is approved. The two compose: the plan phrase does not travel, and the actor
who would have carried it does not perform those acts.

**Why.** Every dispatch in this phase has had to contradict the shipped
`ngrace-execute` skill on that split, and the executor has flagged it each
time ([F84](#f84)). The close of `C-CURSOR-TASK-RESOLVER` was performed this
way (PR #59 commit body: terminal, fold, `--assertions final --run-commands`,
terminal, fold, review, `gate verdict`, `gate apply`, `gate archive`, then
the applied writes and the archive move — "The authority owns the close").

**The shipped skill is now wrong.** `skills/ngrace/ngrace-execute/SKILL.md:40–43`
(steps 7–10) still assign `--assertions final`, apply confirmation, `review`,
`gate verdict`, `gate apply`, `gate archive`, the `applied` status writes, and
the archive move to the executing agent. Do not fix the skill here — that is
its own bundle.

**The trigger was consumed without payment.** [F84](#f84) owed the decision to
*"whichever bundle next opens `ngrace-execute`"*. That bundle was
`C-CURSOR-TASK-RESOLVER`. Its approved plan forbade deciding the split
(`plan.xml:396–403`, `:767–768`: *"Do not decide F84 standing executor versus
operator close ownership while editing ngrace-execute"*). The file was opened;
the obligation was scoped out. Without this record the trigger expires unpaid.
A trigger consumed by a bundle scoped to not pay it is not a discharge.

`C-CURSOR-TASK-IDENTITY`'s plan-approve commit had already named the same
trigger and deferred it to "the same branch"; RESOLVER then inherited the
file and the forbid. The pattern happened twice in one chain.

**What this does not do.** It does not invent an apply/archive lexicon (still
the candidate under [F92](#f92)). It does not make the gates write `status` or
move the bundle (still D1 / `src/gates/command.ts:15`). It does not rewrite
the skill. It answers only *who* performs the close acts.

**This decision is revisable, and here is what would revise it.** If a
harness is built in which the executing agent cannot write `status` or move
the bundle — a host-enforced split, not a sentence — the skill can assign
the *request* for those acts to the agent and the *writes* stay with the
host. Until that exists, assigning the writes to the agent is the claim D20
refuses. If measurement shows the authority-owned close is the bottleneck
that sends work around the governed path, amend this decision rather than
quietly handing the writes back.

**Sequencing.** Named follow-up bundle: **`C-APPROVAL-SCOPE`**, the same
bundle [D19](#d19) already named. It already opens the spec, plan, and
execute skills. It now also writes that the close acts listed above are the
authority's, and removes the execute-skill sentences that assign them to
the executor. It does not implement D18. Not created here.

---

## Slip register — 2026-08-15

Every governance slip of the last two days, and the mechanism that must
catch it. A row ends in a shipped check, a named bundle, or a recorded
acceptance. A row with none of those is itself the finding.

| Slip | What should have refused it | Where the repair is |
|---|---|---|
| Writer emits a guessed task id (`T-000` / `T-001`); written close protocol walks into `cursor.unknown-task` ([F90](#f90), [F90.1](#f901)) | The writer, before the event exists — A13.2, never a guessed id. The checker that then fires is doing its job. | **Paid in-tree** by **`C-CURSOR-TASK-RESOLVER`** (PR #59, `49c3c94`): inherit a declared task or refuse; no `--task` flag; not a blacklist. `C-CURSOR-TASK-SENTINEL` was the first name and was superseded. Residuals: regenerate still re-derives an undeclared last event ([F90](#f90)); range hole ([F90.1](#f901)); operator-supplied ids unchecked at write ([F98](#f98)); published `6.2.0` still invents ([F99](#f99)). |
| Archive gate permits a cursor lint rejects ([F93](#f93); run 4 archived this way) | Archive, when `run.xml` would fail `cursor.unknown-task` (or any cursor error). | **`C-ARCHIVE-CURSOR`**, as a binding requirement on P3's derivation / P3.1 `lifecycle finish`. Not created here. P3 stays objectives-only. |
| A brief asserted the maintainer had ratified a spec; executor wrote `approved`; `gate approve` permitted ([F88.3](#f883)) | A gate that reads a phrase bound to bytes. D18's fingerprint does not hold the phrase. | **D18** / **`C-APPROVAL-FINGERPRINT`** (decided 2026-08-14, unshipped; authorized to start). Phrase attestation is [F88.3](#f883) candidate (b), **not ratified** — that half of the row is a candidate, not a shipped check, a named bundle, or an acceptance. |
| A brief named `docs/plans/**` as a deliverable of a spec that forbids it ([F94](#f94)) | Nothing can refuse a brief (not an artifact). The *plan* that brief would produce should error on a path outside a machine-readable spec path bound. Today's check does not look at paths ([F52](#f52)). | **`C-PLAN-SCOPE-PATHS`** (named; not created). Brief-versus-spec itself **ends in nothing** and must: briefs are not a governed surface. |
| Agent mutated an approved plan in place (run 4 #34; [F88.2](#f882)) | `approved-contract-drift` ([F7](#f7)) — shipped, and defeated because the approval was never committed as its own snapshot. Skill immutability (`ngrace-plan` `:29–33`, `ngrace-execute` `:8`) is a request ([F89](#f89)). | **`C-APPROVAL-FINGERPRINT`** ([D18](#d18): fingerprint of approved bytes) plus **`C-APPROVAL-SCOPE`** ([D19](#d19): skills say the phrase does not travel; [D20](#d20): the close acts are the authority's). The shipped check exists and did not fire. |
| F84's trigger — whichever bundle next opens `ngrace-execute` — was consumed by `C-CURSOR-TASK-RESOLVER`, whose approved plan forbade deciding the split ([D20](#d20)) | Nothing. A trigger is a sentence. A bundle scoped to not pay it will not pay it. | **D20** (decided 2026-08-15). Skill text lands in **`C-APPROVAL-SCOPE`**. The unpaid obligation is recorded so the trigger cannot expire. |
| Governance writes landed before the spec that would gate them ([F88.1](#f881), [F88.1.1](#f8811)) | The lifecycle, on a module-contract / graph write with no approved change that owns it. Nothing refuses today. Lint is green. | **`C-GOVERNANCE-ORDER`** (named; not created). P4.1 owns first-module bootstrap ([F91](#f91)); this is the ordering hole beside it. No shipped check. No acceptance. |

No row is an acceptance of the slip. The discard of the 2026-08-15
self-certified `approved` is a named exception ([F65](#f65) class), not a
repair and not a ratification.

---

## Named-bundle registry

`C-*` names mentioned in this directory that do not exist under
`.ngrace/changes/{active,archive}/`. Names have been minted in findings; this board
is where they live so the next dispatch does not invent a synonym or miss an existing
one.

**Sweep (2026-08-15).** Every `C-[A-Z0-9-]+` token in
`docs/plans/active/RM-GOVERNED-PATH/*.md` (including `sources/`, derivations, and
brownfield notes), excluding a match that is only the tail of an `AC-*` id. Compared
to directory names under `.ngrace/changes/active/` and `.ngrace/changes/archive/`.
62 distinct mentioned names; 43 exist on disk; 19 do not. This pass minted three
names the sweep could not have seen: `C-CRITERION-CLOSE-EVIDENCE`,
`C-APPROVAL-FINGERPRINT`, `C-SUPERSEDE-VERB`. Three on-disk bundles are unmentioned
here (`C-CALIBRATION-CONTEXT`, `C-GRAPH-COVERAGE`, `C-SELECTION`) and are not this
board's subject.

**Execution order, decided 2026-08-15.** Positions 1 and 2 are **authorized to
start**. Positions 3–5 are **ordered, not deferred** — they wait on the earlier
positions; they are not parked. Position 5 ships only if the candidate is ratified
after the re-measure. A name found by the sweep and not in this order is recorded
below; it is not given a slot.

| # | Name | Charter | Pays | Status |
|---|---|---|---|---|
| 1 | **`C-CRITERION-CLOSE-EVIDENCE`** | A close/verdict-bound acceptance-criterion state, so post-archive lint 0/0 is authorable rather than reinvented as an unsatisfiable `AC-*`. Named here 2026-08-15. No existing name covers it: no `C-CRITERION*` / `C-CLOSE-EVIDENCE` in this directory; [`C-DRIFT-HONESTY`](../../../../.ngrace/changes/archive/C-DRIFT-HONESTY/) archived the workaround, not a third `AC-*` state. | [F82](#f82), [F83](#f83), [F83.1](#f831). F82 is already discharged as *practice* by `C-DRIFT-HONESTY`; this bundle is the product state that would make that practice authorable. F83's P2.6 / P2.4 halves were paid by the same archive; the live remainder is F83.1. | **Authorized to start.** |
| 2 | **`C-APPROVAL-FINGERPRINT`** | [D18](#d18): a `Decision` records what it permits. No existing name: D18 named none; `C-BUNDLE-BASE-REF` shipped `baseCommit`, not an artifact fingerprint. | [F95](#f95), and [F81](#f81) as a consequence of the dated "five" (superseded by F95's ten of 46). Unblocks [D19](#d19), [D20](#d20), and the [co-draft candidate](#decision-candidate--co-draft-the-pair-not-ratified), all of which already name fingerprints that do not exist. | **Authorized to start.** Prerequisite of position 5. |
| 3 | **`C-SUPERSEDE-VERB`** | A verb that performs the four writes plus the move that superseding currently is, atomically with the replacement. Named here 2026-08-15. No existing name. | [F86.1](#f861), [F86.2](#f862). | **Ordered, not deferred.** |
| 4 | **`C-APPROVAL-SCOPE`** | Skill text for the per-step rule and the authority-owned close. Already named by [D19](#d19) and [D20](#d20). | D19, D20 (and so F84's skill-versus-practice follow-up). | **Ordered, not deferred.** |
| 5 | **`C-CO-DRAFT`** | `plan new` may write beside a draft spec; two approval phrases remain two decisions. Already named under [F4](#f4). | The authoring-versus-approval revision of `change.plan-requires-approved-spec`. **Not** [F95](#f95). | **Ordered, not deferred** — after 2, and only if ratified after the re-measure. Unratified. |

**Named by this directory, not in the 2026-08-15 order.**

| Name | Charter | Pays | Position |
|---|---|---|---|
| **`C-ARCHIVE-CURSOR`** | Archive gate requires a cursor lint accepts. Named by [F93](#f93). | F93. Binding on P3.1 / `lifecycle finish`. | Named; not in the order. |
| **`C-PLAN-SCOPE-PATHS`** | Structured spec path bound compared to `ObservedWriteScope`, at error. Named by [F94](#f94). | F94, and [F52](#f52)'s load-bearing weakness. | Named; not in the order. |
| **`C-GOVERNANCE-ORDER`** | Refuse a module-contract / graph write with no approved change that owns it. Named by the slip register. | [F88.1](#f881), [F88.1.1](#f8811). | Named; not in the order. |

**Sweep remainder — mentioned, missing from disk, not a chartered bundle.** Recorded so they
are not silently dropped. None is work.

| Name | What it is |
|---|---|
| `C-AUDIT-001` | Brownfield run 1 bundle in another repository ([F88](#f88)). |
| `C-IDENT-COVERAGE` | Brownfield run 4 bundle in another repository ([F86.1](#f861)). |
| `C-ESTABLISH-MODULE-GRAPH-4` | Prior-attempt backup cited in the brownfield notes, not a charter here. |
| `C-001` | Brownfield / generator example id (`spec new C-001`). |
| `C-P0-CALIBRATION` | Rejected name; `C-CALIBRATION-COMMAND-EVIDENCE` shipped (`p0-calibration-derivation.md:394–396`). |
| `C-LEDGER-MEMBERSHIP` | Rejected split; `C-REPORT-HONESTY` absorbed F14+F15 (`p0-report-honesty-derivation.md:511–512`). |
| `C-BASE` | Temp-fixture id in the P0 derivation. |
| `C-TEST` | Temp-fixture id in the cursor derivation. |
| `C-PROBE` | Example change id in a command line ([F25](#f25)). |
| `C-ID` | Placeholder in skill / command prose. |
| `C-SLUG` | Placeholder in [plan.md](./plan.md). |
| `C-X` | Example id in [review.md](./review.md). |
| `C-CURSOR` | Abbreviation of `C-CURSOR-INTEGRITY` in the cursor derivation. |
| `C-TOKEN` | Abbreviation of `C-TOKEN-INTEGRITY` in the cursor derivation. |
