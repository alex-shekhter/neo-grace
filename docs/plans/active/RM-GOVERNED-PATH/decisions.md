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
