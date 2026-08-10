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
