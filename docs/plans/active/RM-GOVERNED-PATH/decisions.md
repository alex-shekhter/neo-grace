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
> 2026-08-09 — but what makes them binding is [plan.md](./plan.md), which encodes them and is still
> `draft`. This file records what was decided and why, so the plan can be reviewed and executed
> without re-litigating any of it.
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

### D5.4 — Not a break is still not invisible

A project with a typo'd `LINKS` has green lint today and red lint after. Philosophically that is a
pre-existing defect surfacing; operationally it is somebody's CI going red on a Tuesday.

Required with P0, therefore: a CHANGELOG entry listing every newly-erroring code, and
`lint --remediate` coverage wherever the fix is mechanical. Visible, but not a version bump.
