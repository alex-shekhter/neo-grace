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
- `splitList` already strips a surrounding `[...]` and drops `none` case-insensitively. D5 preserves
  both.

D5 rests on the second point: it is what makes widening safe rather than a guess.

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
| `src/test-support/token-accounting.test.ts` | D15's skill-line budget, pinned at `730` | **yes** — `validate:ci` fails |
| `README.md:286` | a published measurements table stating **730 lines** | no — and worse for it |

**The first is not a brittle test and should not be filed with F11.1.** D15's pin is a *deliberate
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
in history carried D12's predicted lint error. That plan is wrong: it leaves the executor working
inside a bundle whose own status says *stop*, and telling an executor to disregard a hard stop is how
a check is taught to be noise — the harm F9.9 named, arriving by a different road.

**Rule: commit the approval immediately after authoring it.** Where that collides with a predicted
lint error, the error is carried in the commit and named in the commit body. **A documented expected
error costs less than a live false hard stop**, because the first is a sentence a reader can check
and the second is an instruction a reader may obey.

### D12.1 — Two corrections to D12, neither of which changes the decision

**`DEPENDS` was cited wrongly.** D12 said hosting the membership body in `paths.ts` would falsify
*"both the SCOPE line and `DEPENDS`"*. `DEPENDS` does not describe file imports: it lists **M-\***
graph anchors (`lint/catalog.ts:113` — *"LINKS accepts M-\*, DF-\*, and V-M-\*; DEPENDS accepts M-\*
only"*), and `src/gates/core.ts` declares `DEPENDS: none` while importing widely. Adding an
`./artifact/xml` import to `paths.ts` would not have falsified it.

**The SCOPE argument stands alone and is sufficient.** `paths.ts` declares
`SCOPE: Root tags, companions, anchor patterns, ARTIFACT_DIR`; an XML-reading `run/` inventory is not
that, and accommodating it means editing the SCOPE line to describe whatever landed. The decision is
unchanged — `src/artifact/run-membership.ts` — on one true reason instead of one true and one
invented.

**The out-of-scope importer list was short by one.** D12 and the plan name
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
  That falsifies a module contract **D12 had just insisted must be true on the day it is written**,
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
`--flag true` as well as `--flag false`, which by the letter of D5's standing rule — *"making a silent
failure loud is not a compatibility break; turning a working state into an error is"* — looks like it
converts a working state into an error, since `--json true` happens to produce `json: true`. The probe
shows it is not a working state. The flag lands correctly **by coincidence** while the positional is
silently corrupted, and the coincidence does not hold for the seven commands that read one. Rejecting
both spellings is the honest reading of D5, not an exception to it.

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

**Consequence, and the irony.** D12's approve gate refuses on an unresolved Clarification targeting
`IC-*` or `INV-*` (`src/gates/core.ts:181–182` reads `node.attributes.target`). No Clarification can
exist, so the gate can never fire. `C-GATE-SURFACE`'s own `AC-TYPED-CLARIFICATION` reads *"Without this
AC the approve gate is vacuous."* The AC shipped; the gate is vacuous.

**Footprint of the repair.** `src/artifact/grammar.ts` (shape + validator), `src/gates/core.ts:181–182`
(the approve-gate reader), and **six** skill/template sites across both trees that teach the broken
form — measured, not estimated:

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
that plan, and the `detail` field is empty in `--format json` too. Nothing in the output says which
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
