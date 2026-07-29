---
id: RM-AGENT-RELIABILITY
kind: context
status: draft
supersededBy: null
created: 2026-07-29
updated: 2026-07-29
baseline: 6.0.0
targets: []
normative: false
plan: ./plan.md
context: ./review-consolidated.md
---

# Agent reliability — decision log

> **Non-normative.** The decisions below are *settled* — they were argued and approved — but
> what makes them binding is `plan.md`, which encodes them and is still `draft`. This file
> records what was decided and why, so the plan can be reviewed and executed without
> re-litigating any of it.
>
> **Blocked on [RM-NAMESPACE-SEPARATION](../RM-NAMESPACE-SEPARATION/plan.md)**, which moves the
> artifact namespace (`.grace/` → `.ngrace/`, `Grace*` → `Ngrace*`) and the skill namespace.
> Several decisions here name artifacts in the namespace being retired — D1's run ledger most
> directly. That plan's Phase 6 reconciles this document rather than leaving it to drift.
>
> Companion to [review-consolidated.md](./review-consolidated.md), which frames the
> questions. This file answers them, one at a time, as they are decided.
>
> **Sequencing is out of scope here.** These are design decisions. Where one decision
> depends on another artifact existing, that is recorded as a dependency, not as an order.
> Ordering is decided separately, when `plan.md` is written.

Evidence tags follow `review-consolidated.md` §0.2: **E1** dataset · **E2** verified against
this repository at 5.0.1 · **E3** prior art · **E4** reasoned only.

---

## Findings that these decisions rest on

Three corrections to `review-consolidated.md`, verified during this discussion. They are
recorded here because D1 in particular does not stand without them.

### F1 — The binary already writes. **(E2)**

`review-consolidated.md` §4.10 states that the run cursor "is the first proposal that
requires the binary to *write*", and non-negotiable constraint #4 states the read-only
invariant is "broken only for the cursor". Both are false at 5.0.1.

`ngrace graph split --apply` rewrites `graph/index.xml` and creates a new `GD-*` document,
moving anchors between documents — `src/grace-graph.ts:285–290`. It ships today.

The consequence is favourable: the cursor needs no novel exception, only an existing
precedent. That precedent is visible in the same code path:

- dry-run by default; writes only behind an explicit `--apply` (`src/grace-graph.ts:296`, `:347`)
- writes **structural** facts only — which anchor lives in which document — never authored content
- refuses to run when the projection has errors (`:121`): fail-closed before mutating

**The invariant is therefore restated as:** *the binary writes only structural state it can
derive or is explicitly given, never authored content, and never without an explicit apply.*

Related **(E2)**: `"Must not write to the filesystem"` is scoped to the doctor report builder
(`src/grace-doctor.ts:54`), not to the binary, and it is already machine-checked by a
directory-snapshot test (`src/grace4/scale-ergonomics.test.ts:212`). That test is the
enforcement mechanism §4.10 asks for, already written and reusable per-command.

### F2 — The GRACE 3 schema is verifiable in this repository. **(E2)**

`review-consolidated.md` §10 states the v3 schema is "not verifiable here". The tag
`v3.11.0` contains the complete v3 skill tree and its templates, including
`grace-init/assets/docs/development-plan.xml.template`. The v3 side of §4.10 is readable
with `git show`, not reported testimony.

### F3 — The v3 position marker lived inside a document that grew with the project. **(E2)**

`development-plan.xml` (v3.11.0) held, in one file: `ArchitectureNotes`, every module's full
contract / interface / depends / target / observability / notes, `DataFlow`,
`ImplementationOrder`, and `ExecutionPolicy`. Answering *"which step am I on"* meant loading
every module contract in the project, on every step.

The cost therefore scaled with project size and was paid most often exactly when context was
already scarce. This is reported operational experience from a large v3 project, and the
template confirms it is structural rather than incidental.

GRACE 4 already learned the general form of this lesson elsewhere — graph documents are
split behind `graph/index.xml` routing, `ngrace graph split` exists for oversized documents,
`src/lint/document-size.ts` measures pressure, and `doctor` reports it. The run cursor is the
one place the lesson was not applied.

### F4 — GRACE 4 dropped an execution-loop layer that v3 had specified. **(E2)**

`review-consolidated.md` Q24 asks what else the 3→4 immutability trade dropped, and treats the
run cursor as "one find from one probe." Reading `v3.11.0` shows the layer was larger:

| v3 construct | What it was | Tag in `review-consolidated.md` |
|---|---|---|
| `<ImplementationOrder>` → `<step-N module="M-*" status verification="V-M-*">` | Run cursor, **joined to the module and verification anchors** | §4.10, E2 regression — but the join is absent from the proposal |
| `operational-packets.xml` → `<ExecutionPacket>` | Per-task context slice with a canonical schema: write-scope, contract excerpt, graph entry, dependency contract summaries, verification excerpt, assumptions, stop-conditions, retry-budget, expected deltas | §4.1, **E4 + one anecdote** |
| `<ExecutionPolicy>`: `controller-owns` / `worker-owns` / `max-fix-attempts-per-step` / `replan-trigger` | Multi-agent ownership split and failure budget, declaratively | §5.6, **E4**; Q16, open |
| `<CheckpointReport>`: assumptions-kept, commands-run, evidence-captured, retry-budget-used, next-action | Structured honest reporting per step | §4.7 / §4.4 |
| `<FailurePacket>`: expected vs. observed evidence, `first-divergent-block` | Deterministic failure handoff | not proposed anywhere |

Four constructs the review tags *"reasoned only — the dataset structurally cannot contain
this"* were shipping here for eleven minor versions.

**This is not "v3 was right."** v3's controller was an *agent* assembling excerpts by hand —
the "agent paraphrase at emit time" failure §4.1 exists to prevent. Nothing enforced the
packet, the retry budget, or the checkpoint. That is precisely why GRACE 4 could delete the
whole layer without anything failing loudly: none of it was load-bearing.

---

## D1 — Position is a separate file, and it is a cache, not the record

**Decided.** Position lives outside `plan.xml`, in its own small file. Reading position never
loads the plan.

Half of this was already forced: a per-task `status` attribute inside `plan.xml` is
schema-illegal — `artifact.forbidden-status-attribute`, `src/grace4/grammar.ts:167` **(E2)**.
F3 supplies the other half, and is the stronger reason: even where a nested marker were
legal, co-locating position with the plan reintroduces the v3 read cost.

### The split

The cursor is **not** the whole story, because its fields divide sharply by whether they can
be recovered after loss:

| Field | Recoverable | From |
|---|---|---|
| Which tasks are done | Yes | diff vs. `ObservedWriteScope`; anchors present; `--assertions target` |
| What is next | Yes | `DependsOn` + what is done |
| What is in flight | Yes | uncommitted work |
| Who approved what, when, against which evidence | **No** | nothing else records a human saying "proceed" |
| Overrides — applied despite a finding, by whom | **No** | |
| Degradations — a mechanism reported `not-run` here | **No** | absence of evidence is indistinguishable from "never needed" |
| Retry budget consumed | **No** | |
| Which amendment happened at which point in the run | Partially | timestamps only |

So there are two artifacts, not one:

> **The ledger is the truth: append-only, never rewritten, therefore small. The cursor is a
> derived cache: mutable, optional, regenerable, cheap to lose.**

The cursor is a fold over the ledger. That is *why* it may be lossy — losing it discards a
projection, not a fact.

### "Optional" has three senses; two of them apply

| Sense | Answer |
|---|---|
| Optional to **build** | **No.** It ships, and `grace-execute` maintains it by default. |
| Optional for a **project to have** | **Yes.** A `.grace` tree with no cursor lints clean — no finding, no migration. Purely additive, so the "existing valid trees keep validating" invariant costs nothing. |
| Optional to **survive** | **Yes.** Loss is non-fatal. |

The recovery argument holds because **re-derivation cost is bounded by wave size, not project
size** — closed waves stay closed, and reconstruction only ever happens inside the open one.
That is also an independent argument for keeping waves small.

### Where fail-closed applies

A missing **cursor** is a missing cache: no issue emitted, and the referential-integrity lint
is conditional — absent is silent, present-but-naming-a-task-not-in-the-plan is an error.

A missing **ledger entry** where one was required — apply with no approval record — is a
missing *check*, and is an error.

The house rule "nothing degrades silently" governs evidence, not ergonomics. Without that
distinction it would push toward making an absent cursor an issue, destroying the optionality
that makes the cursor low-risk in the first place.

---

## D2 — Events append as immutable files, with pre-allocated ID ranges

**Decided.** One immutable file per event during an open epoch. No rewriting, no single
document to reserialize, no coordination on the write path.

```
run/<id>-<task>-<kind>.xml
```

### Ordering is by allocated range, not by clock

Millisecond timestamps were considered and **rejected**:

- clock skew across workers breaks the only property they offered — lexicographic sort equal
  to chronological order
- NTP steps can move time backwards
- a fast fold loop can collide inside a millisecond
- fundamentally, a timestamp encodes *when*, not *order*, and a ledger needs causal order

Instead the orchestrator allocates a disjoint ID range per worker **before** concurrent work
starts, recorded as the epoch's opening event. Each worker appends from its own range with a
local counter.

This is collision-free by construction rather than probabilistically, needs no clock and no
coordination during the run — and, uniquely among the options, **makes loss detectable**:

- a worker's events must be dense from its range start up to a terminal event
- a hole inside a used range is corruption
- a used range with no terminal event is a worker that died mid-flight
- an event ID outside any allocated range is a rogue writer

Timestamps detect none of these. A missing file simply looks like an event that never
happened — the exact failure this track exists to eliminate.

### Order within an epoch is partial, and that is honest

Worker A's `#105` and worker B's `#205` are not comparable, because those events genuinely
were concurrent. A timestamp would have manufactured a total order that does not exist.
Total ordering is supplied at the epoch boundary instead (D3).

---

## D3 — Fold per epoch into `run-ledger.xml`; sections are `Epoch-N`

**Decided.** At each epoch close, the orchestrator folds `run/*` into a new section appended
to `run-ledger.xml`, verifies it, and deletes the loose files. `run/` is empty between epochs.

An epoch close is the only safe fold point: it is already a quiescent barrier — every worker
done, nothing in flight, orchestrator the sole writer. Folding mid-run would race; folding
only at archive would be safe but late.

### Resulting shape

```
.grace/changes/active/C-3/
  plan.xml            immutable
  run-ledger.xml      grows by one <Epoch-N> section per fold; the truth
  run/                loose event files; empty between epochs
  run.xml             cursor cache; regenerable; disposable
```

| Moment | What happens |
|---|---|
| Epoch opens | Orchestrator appends `<EpochOpened>` carrying the worker→range map |
| During | Workers append `run/*` from their own ranges — no clock, no coordination |
| Epoch closes | Fold into `<Epoch-N>`; verify range membership and density; delete loose files |
| Archive | Nothing to compact — the ledger is already complete. Delete the cursor. |

### This removes archive-time compaction entirely

An earlier design folded at archive, which introduced a write-verify-delete transition with a
crash window and a repair lint for the half-done state. Per-epoch folding deletes that whole
problem. The archive precondition becomes **"no open epoch"** — a rule worth having anyway,
since a bundle with work in flight should not archive — and it is easier to state and check
than a both-files-exist repair rule.

Ordering of operations at a fold is nonetheless **write, verify, then delete** — never delete
first — so an interrupted fold leaves both forms rather than losing events.

### Why `Epoch-N`, not `Wave-N` or `Segment-N`

Sections are `<Epoch-N wave="M">`: a monotonic ledger-side number, carrying the plan-side
wave as an attribute.

A **wave** is a plan-side grouping — "T-004 and T-005 may run together". An **epoch** is an
execution-side period with one fixed worker→range allocation. These are usually 1:1 and are
not always: interrupt wave 2 and resume it, and one wave has two allocations.

```xml
<Epoch-3 wave="2">   <!-- T-004, T-005 — interrupted -->
<Epoch-4 wave="2">   <!-- resumed under a new allocation -->
```

| Option | Rejected because |
|---|---|
| `Wave-N` | Emitting `Wave-2` twice, or renumbering, breaks the append-only never-reorder contract adopted from spec-kit's converge rule (§4.2). It also implies plan-side and ledger-side numbering are one sequence when they are not — and it reads as a euphemism for a sequential run |
| `Segment-N` | Log-storage vocabulary; frames the fold as file chunking. The fold is where concurrent, partially-ordered events become a totally-ordered record, and a storage name invites someone to later move the boundary for storage reasons |

`Epoch` also carries correct prior art: in consensus systems an epoch is a numbered period
during which a membership allocation holds, incremented when that allocation changes. Our
fold boundary *is* "the range allocation is retired".

**This does not violate the one-vocabulary rule** (§4.4, Q23). That rule's test is whether two
words answer the same question — the smell there was two competing answers to *"how sure is
this claim?"*. Here, *"which tasks are grouped?"* and *"which execution attempt, under which
allocation?"* are different questions with different lifetimes: wave numbers are stable and
plan-side, epoch numbers are monotonic and ledger-side. Using one word for both is precisely
what would force the renumbering. The codebase already separates plan-side intent from
evaluated state this way, in the assertion modes `current | baseline | target | final`.

### Sequential runs

A sequential run is a sequence of single-worker epochs — allocate a range of one, fold at each
task boundary. One rule covers both modes, `run/` is nearly always empty, and crash
granularity is finer. `Epoch` carries no implication of parallelism, so `<Epoch-7 wave="1">`
for a single sequential task reads correctly. An epoch with no `wave` attribute — a hotfix
executed outside any planned wave — is also legal and honest.

---

## D4 — Success metric: a deterministic gate and a trend, both required

**Decided.** The track is measured by a pair. Neither half is sufficient alone, and shipping
only one is how a reliability track ends up asserting its own success.

| Role | Metric |
|---|---|
| **Gate** — binary, runs in CI, can fail | Reviewer determinism (two runs, no intervening change, identical finding IDs and counts) **plus a no-regression ratchet**: a seeded defect caught at version *N* must still be caught at *N+1* |
| **Trend** — reported, does not gate | Seeded-defect detection rate, broken out by the five patterns of `review-consolidated.md` §2.1 |

### Why neither half stands alone

**Determinism alone certifies a reviewer that finds nothing.** It is cheap, binary, and a
genuinely rare property for an agent command to have — but it measures *stability*, not
*detection*. A reviewer that reliably reports zero findings scores perfectly.

**Detection rate alone has no failure condition.** A trend can drift for a release and be
explained away; it cannot fail a build. Only the pair can move the toolkit's quality: one
half proves the reviewer is a measuring instrument at all, the other proves it is pointed at
something.

### Why a ratchet rather than a threshold

Any absolute number — "catch 80%" — is arbitrary, and the argument about where to set it
never resolves. A ratchet compares against the previous version only: it needs no threshold
and can move in one direction. It is also the mechanic `review-consolidated.md` §4.9
identifies as the most novel contribution in the corpus ("12/16 → 15/16, CHK007 regressed"),
applied here to the track itself.

### Rejected candidates

| Candidate | Rejected because |
|---|---|
| Ratio of honest `not-run` to false `pass` (§7.2 Q13b) | Requires knowing what *should* have been reported `not-run` — ground truth that does not exist outside seeded fixtures. Inside seeded fixtures it collapses into the detection rate |
| Out-of-scope writes reaching apply (§7.2 Q13d) | Its correct value is always zero. A quantity that must always be zero is an **invariant to gate**, not a trend to chart |
| Defect density on a fixed multi-phase fixture plan (§7.2 Q13a) | Retained as an optional deep measurement, not as the trend. It requires executing a full multi-phase plan and adjudicating each defect by hand — expensive, slow, and noisy enough that it cannot run per-change |

### Dependencies, and what the metric does not cover

The gate is undefined until the seeded-defect corpus (§5.4) exists — ground truth by
construction is what makes both halves measurable without human adjudication. This is a
dependency, not a schedule.

Some work carries no defect signal at all: skill-text rules and the cursor have nothing to
detect against. Their evidence is the token instrumentation (§7.2 Q22) and a working
self-migration. `plan.md` should state that plainly rather than stretch this metric to cover
work it cannot measure.

---

## D5 — The trust model: two axes for claims, one value for absence

**Decided.** `review-consolidated.md` Q23 asks whether provenance
(`user-stated | tool-verified | agent-inferred`) and the language tier's `exact | heuristic`
should collapse into one vocabulary, since both appear to answer *"how sure is this claim?"*

**They do not collapse.** They answer different questions:

- `exact | heuristic` is **precision** — how sharp is the instrument that produced this.
- `user-stated | tool-verified | agent-inferred` is **authority** — who is responsible for it
  being true.

A fact can be `tool-verified` **and** `heuristic`: a regex-based adapter genuinely found that
export, with a genuinely limited instrument. Collapsing the two destroys the distinction
between *verified by a blunt tool* and *asserted by the agent* — which is the distinction
pattern 1 is about. Add **freshness** (`verified-at`, R2's contribution) and claims carry
three axes: authority, precision, and when last confirmed by that source.

Authoring cost stays near zero via Q4's already-adopted rule — **declare coarse, derive
fine**. Authority is authored once per anchor; precision is computed by the CLI from what
backs the anchor; freshness is stamped by the CLI. Nobody hand-writes three fields.

### What unifies instead: the absence value

Seven names for one concept are already scattered across shipped code and proposals:

| Value | Status | Means |
|---|---|---|
| `analysis.no-adapter` | shipped **(E2)** | no adapter exists for this language |
| `analysis.runtime-missing` | shipped **(E2)** | the runtime needed is not installed |
| `assertion.command-not-evaluated` | shipped **(E2)** | a declared command assertion was not run |
| `not-run` | proposed §4.7 | verification row did not execute |
| `unable-to-determine` | proposed §4.7 | reviewer could not reach a verdict |
| `satisfied-unverified` | proposed §4.7 | AC claimed but not exercised |
| mechanism failure | open, Q16 | the check itself broke |

All say the same thing: **no answer was produced.** *That* is what unifies — not the two
axes above.

**One value, plus a required reason.** The seven differ trivially in value and meaningfully
in *why*, and the why is what determines remediation:

| Reason | Character |
|---|---|
| `no-adapter` | structural, expected, not fixable by rerunning |
| `runtime-missing` | environmental, fixable by installing something |
| `command-not-evaluated` | the operator declined; fixable with a flag |
| `mechanism-failed` | a bug; file it |

So: a single absence value carried on every surface, with a reason code attached. Not a flat
enum of seven, and not seven private vocabularies.

### Q16 falls out: blocking is declared by the gate

An earlier draft proposed a per-mechanism table of what blocks and what does not. That makes
blocking a property of the *mechanism*, so every new mechanism needs a new policy row.

**Each gate instead declares which evidence it requires.** Required evidence returning the
absence value fails the gate closed; optional evidence returning it is reported and does not
block. The reason code serves *remediation*, not policy.

The scope check blocking apply and coverage attribution not blocking are then one rule
applied to two gate declarations, rather than two special cases. A mechanism that crashed
gets identical treatment to one that was never run — correct, since both produced no answer.

**False positives** are the other half of Q16. A mechanism that fires must name its evidence,
and suppression is a **recorded event in the ledger** (D1), never a config flag. Suppressions
are then countable, and a mechanism with a high suppression rate is one to fix. This handles
false positives without pretending they will not happen and without the silent-disable
failure mode.

### Cost

Mostly renaming and routing what already exists — three of the seven absence values ship
today. Genuinely new surface: the reason-code enum, the authority attribute, and the
`verified-at` stamp. These are attributes on existing anchors, not a new anchor family, so
this stays compatible with §8's *"no large new anchor family; reliability is loop and
evidence."*

---

## D6 — Self-reported confidence is recorded, never consumed

**Decided.** An earlier draft of D5 forbade `agent-inferred` claims from carrying any
confidence at all. That conflated two different things:

- **Consuming** it — letting it influence a gate, a verdict, or another agent's decision.
  Pattern 1 **(E1, 6 of 19)** says this is worthless: it tracks fluency, not correctness.
- **Recording** it — storing the claim so its correlation with outcomes can be measured.

Forbidding the record permanently forecloses the only study that could ever establish whether
consuming it is safe in some context. That is also inconsistent with the standard this track
applies elsewhere — §4.1's context slices are to be instrumented rather than justified by
R4's unmeasured number.

**The rule is therefore:**

> `agent-inferred` may not carry **`precision`** — the CLI-derived, gate-consumable field. It
> **may** carry a separately named **`claimed-confidence`**, which is analysis-only and read
> by no gate.

### Why this is unusually cheap to study here

Self-reported confidence is normally unfalsifiable — nothing later establishes what was
actually true, so no calibration data ever accumulates. In GRACE, claims are adjudicated by
machinery already being built:

| Claim | Adjudicated by |
|---|---|
| "this AC is satisfied" | verification assertions, `--assertions final` |
| "this change is clean" | detached reviewer findings |
| "this mechanism ran" | ledger degradation records (D1) |
| anything, on a seeded fixture | ground truth by construction (D4) |

Labeled pairs — *claimed confidence* against *what turned out to be true* — fall out as a
byproduct rather than requiring a separate study. The same corpus answers Q21 (do the five
patterns hold on a second model family) at no extra cost.

### Conditions

1. **Separate field from `precision`**, kept apart by lint. Merged, every consumer that reads
   precision would silently start consuming agent confidence.
2. **Write-only from the agent's side.** It must never flow back into any agent's context or
   into a gate; otherwise the measurement is contaminated and pattern 1 is quietly rebuilt.
3. **Only where an adjudicator exists.** Confidence attached to a claim nothing will verdict
   is unfalsifiable and is not collected. Free-floating narration does not carry it.
4. **A named consumer, built alongside** — the calibration report. This is R1's *"provenance
   needs a consumer or it rots into metadata nobody reads"* applied here: with no one
   computing the calibration curve, the field is pure token tax.
5. **A small ordinal scale** — three levels. Not free text, not a percentage, or it will not
   aggregate.
6. **Promotion bar stated up front:** demonstrated calibration on a held-out set, per context
   class, before `claimed-confidence` may inform any gate. Without this, *"we have the data"*
   drifts into *"so let's use it"* with nobody deciding.

### Context is derived, not authored

Context features are **joined from the ledger and the bundle**, not emitted with each claim.

This is cheaper, and it is also more trustworthy: an agent-authored context tag is *itself* a
self-report, which would put both axes of the calibration study under the control of the thing
being studied. Exactly one self-report belongs in the record, and it is the one being measured.

| Context feature | Derived from |
|---|---|
| Task kind; which AC was claimed | `plan.xml`, via the task ID on the event |
| Adapter present or absent | the absence reason codes already emitted (D5) |
| Mechanism ran or degraded | ledger degradation events |
| Wrote vs. read the code in question | `ObservedWriteScope` vs. the claim's target |
| Retry burn, overrides, amendments | ledger |
| Sequential vs. parallel | `<EpochOpened>` worker→range map |

**Executor identity is the exception, and it comes from the harness.** The toolkit cannot
introspect which model produced a claim; the harness knows and calls in. So it is
*harness-stated*, unverifiable by `ngrace`, and may be absent when a host does not supply it —
in which case it lands as the D5 absence value with a reason. What the harness supplies is
§5.2 host-capability-matrix territory, not a toolkit guarantee. Recorded once on
`<EpochOpened>`, not per claim.

### The ledger is an attempt log, not a state log

Every attempt is recorded — create → fail → fix → fail → pass — not only the outcome.

**Recording outcomes alone would systematically destroy the calibration data.** The eventual
green state overwrites the failures, and every claim looks correct in hindsight. The churn
*is* the signal: "confident this is done" followed by three fix cycles is a labeled negative.

Append-only does not give this for free — an append-only log that records only `started` and
`done` state transitions loses it. v3 had the instinct: `retry-budget-used` and
`max-fix-attempts-per-step` **(E2:** `v3.11.0` `operational-packets.xml.template`,
`development-plan.xml.template`**)**.

### Contradictions, not hallucinations

Hallucination is not detectable as a category. **A claim contradicted by a check is**, and it
is the useful subset:

- an anchor asserted to exist that lint reports absent
- an AC claimed satisfied where verification fails
- a narrated `pass` over a truth of `command-not-evaluated`
- a cited file or symbol that is not there

The recordable event is therefore a **contradiction**, carrying the claim, the check, and the
delta. These are the negative labels the calibration study consumes.

### On loss

The losable artifact is the **cursor**, which is disposable by design (D1). The **ledger** is
meant to be complete, so loss there is exceptional rather than routine.

For statistical collection, unbiased loss reduces *n* rather than corrupting the result. The
failure case is loss that *correlates* with what is being measured: if events are likelier to
go missing when a run dies badly, and bad runs are where confidence was most wrong, the worst
samples drop out and the agent appears better calibrated than it is.

D2's dense-range and terminal-event checks already distinguish a complete epoch from an
incomplete one. Marking completeness at fold time lets the analysis exclude incomplete epochs
as a class, or compare the two — converting a silent bias into a measurable one. This is a
rare-case safeguard, not a routine filter.

---

## D7 — Restore v3's surfaces under v5's enforcement

**Decided.** F4's frame is adopted as the track's thesis:

> **GRACE 3 specified the right execution-loop surfaces and enforced none of them. GRACE 4
> built real enforcement and deleted the surfaces. This track puts v3's surfaces under v5's
> enforcement.**

Corroboration that the surfaces were correctly identified the first time: D1 and D6 re-derived
v3's `<CheckpointReport>` field list from first principles — retry burn, commands run, evidence
captured, next action — without consulting v3. Arriving at the same fields from the calibration
argument is a reasonable sign that what was missing was enforcement, not design.

### Two rules govern the port

**1 — Restore field lists as the output contract of a command. Do not restore v3's documents.**
An `<ExecutionPacket>` as an authored artifact reintroduces the paraphrase problem. The same
field list as a *projection over the graph* is what §4.1 actually wants.

**2 — The default is do-not-restore.** Each restoration must name what fails without it. This
is §6's *"delete anything not justified by a failure"* pointed backwards in time, and it is
what keeps the port from becoming nostalgia.

### Much of v3 was already superseded by 4.x/5.x, and better

The retrieval primitives v3 asked a controller agent to hand-assemble now exist as deterministic,
JSON-emitting queries **(E2)**:

- `ngrace module show <id> --with verification --json`
- `ngrace module find --depends <id>`
- `ngrace file show <path> --contracts --blocks --json`

What is missing is **composition** — one task-scoped emit over queries that already work, plus
the exclusion boundary — not retrieval.

### First-pass sort

A starting hypothesis for the audit, not its conclusion.

| v3 construct | Verdict | Basis |
|---|---|---|
| `step-N` cursor | **Collateral loss — restore** | Dropped as the price of byte-stable plans. Done: D1–D3 |
| Packet: contract / graph / verification excerpts | **Superseded, better** | `module show --with verification`, `file show --contracts`, graph projections, verification index **(E2)** |
| Packet: `write-scope` | **Superseded** | `ObservedWriteScope` **(E2)** |
| Packet: `assumptions` | **Partly covered** | §4.4 typed holes / `ASSUMPTION` markers |
| Packet: expected graph/verification deltas | **Likely superseded — verify** | Assertion modes (`target`, `final`) express expected end-state; does the delta framing add anything? |
| Packet: composition into one task slice | **Genuinely missing** | §4.1 |
| Policy: `worker-owns` | **Superseded** | scopes **(E2)** |
| Policy: `controller-owns` | **Needs audit** | `grace-execute` parallel-safe preflight covers part of it |
| Policy: `max-fix-attempts-per-step`, `replan-trigger` | **Genuinely missing** | No v5 home. See D9 |
| `CheckpointReport` fields | **Restored already** | D1/D6 ledger events |
| `FailurePacket` → `first-divergent-block` | **Genuinely missing** | See D8 |

Roughly four of eleven are genuinely missing; four are superseded by something better; three
are handled or need a check. A materially smaller port than "restore v3's execution layer."

### Consequences

- **§4.1 is no longer an E4 bet.** Its shape is `<ExecutionPacket>`; only the savings are
  unknown. The v5 improvement is statable: the slice is **emitted deterministically from the
  graph**, not paraphrased by a controller agent.
- **§5.6 gets a starting schema** rather than "should not be silently assumed away."
- **`grace-migrate` gets a real mapping table** as the audit's output. It has none for
  `implementationOrder` today, so a v3 project's step statuses are classified unsupported and
  dropped silently.

---

## D8 — Deterministic failure localization

**Decided.** Restore v3's `first-divergent-block` idea, and separate two questions that need
different sources:

| Question | Source | Status in 5.x |
|---|---|---|
| **Which module failed?** | test results + language-aware test-file inference | already computable **(E2)** |
| **Where in the flow did it start going wrong?** | observed log markers vs. expected markers from `V-M-*` | ingredients exist (marker evidence is language-aware since RM-POLYGLOT Phase 1); no construct joins them |

Both are kept because a stack trace reports where execution *blew up*, while the first
divergent block reports where it *started going wrong* — frequently different, as when state
is corrupted in one block and detected three blocks later. Test results alone point the fixer
at the assertion site, which is reliably the place the bug is not.

So: expected marker sequence from the verification entry, observed sequence from the run, first
index at which they diverge. Deterministic, and both inputs already exist.

### Self-review is a deterministic source only for its mechanized subset

Scope diff, test-weakening diff and backward-compat fixture sweep emit machine evidence and may
be used for localization. The judgment half — adversarial probe, anti-pattern audit — may not,
or pattern 1 becomes an input to failure diagnosis. This is D5's gate rule applied here:
mechanized findings are evidence, judgment findings are advice.

### Flaky tests are classified, not pooled

This mechanism inherits the user project's test flakiness. A test that fails and then passes
with no intervening change is noise, not a localization signal. The attempt log catches it —
`fail → (no fix) → pass` is a detectable signature in the shape D6 already records — so flaky
results are classified rather than silently polluting the trend.

---

## D9 — Fix budget of 2, escalating to replan

**Decided.** Two fix attempts per task. Exhaustion routes to replan and lands the task in
`paused-pending-approval` — which §4.10 already names a **normal state, not a failure**.

**Unbounded is rejected for a reason beyond spend: each failed attempt can leave residue.** An
agent that keeps fixing accumulates changes nobody planned, which is §4.2's `unrequested`
category arriving through the back door. The budget bounds blast radius, not just cost.

**The budget's purpose is to force a diagnosis, not to abort.** After two failed fixes the
problem is usually the plan, the contract, or the understanding — not the code. v3 knew this:
`replan-trigger` sat directly beside `max-fix-attempts-per-step`.

**2 is right *conditional on escalation being cheap and resumable*.** If exhaustion meant
abandoning and unwinding the task, 2 would be too aggressive, since some failures are
legitimately layered and each step is progress. Because exhaustion pauses and asks, 2 holds.

### Definitions and discipline

- **An attempt** is one write-plus-verification cycle against the same task.
- **A failure signature** is recorded per attempt, so *same failure twice* (stuck) is
  distinguishable from *two different failures* (converging).
- **The counter stays dumb.** Every attempt counts against the budget regardless of signature.
  The intelligence lives in the recorded signature and the escalation message, not in the
  policy — the moment the budget decides what counts as progress it becomes something to argue
  with rather than a stop condition.
- **2 is a judgment call and is labelled as one.** Churn is recorded (D6); the calibration data
  determines the eventual default. The initial number is not dressed as derived.

---

## D10 — Wave-scoped review outcomes are the plan-quality signal

**Decided.** Record self-review outcomes with their scope. This is the only signal in the design
that measures **the plan** rather than **the agent** — everything else (churn, calibration,
contradictions, detection rate) measures the executor.

### The inference, stated narrowly enough to be true

*"Self-review failed, so the plan was wrong"* is too strong: failure may be an implementation
defect or a review false positive. The sound form is narrower:

> **A wave-level review failure where every constituent task passed its own verification is a
> decomposition failure, not an implementation failure.**

The tasks did what they were told; the telling was wrong.

### Classify by resolution, not by the review's opinion

| Resolution | Classification |
|---|---|
| Code-only fix | implementation defect |
| Required an amendment or supersede | **plan defect** |

Deterministic, and already recorded — amendments are ledger events (D1), so classification is a
join rather than a judgment.

### Why this matters beyond the immediate question

`review-consolidated.md` §4.9 (requirements-quality checks) is the one proposal with **no
dataset support** — RM-POLYGLOT's defects were implementation defects against a plan that was
good. Recording wave-scoped review outcomes with the resolution discriminator **generates the
missing evidence**. It also reaches R3's §5.8 target — plan quality as a measurable property —
far more cheaply than the ≥3-run determinism experiment proposed there.

### Required alongside

1. **The review's scope.** Self-review runs at end-of-wave most of the time but not always; a
   task-scoped failure and a wave-scoped failure mean different things and cannot be pooled.
2. **Whether all constituent tasks passed their own verification** — the precondition that makes
   the decomposition inference valid.

**Honest caveat:** attribution is not perfectly clean. A code-only fix can paper over a plan
defect, and the discriminator will score that as implementation. It is a good proxy, not a
truth, and the docs must say so rather than let the number harden.

---

## D11 — `applied` requires a recorded review verdict, not a clean one

**Decided.** D5 turned Q14 from a policy debate into a declaration: mechanized review findings
are evidence and block through the ordinary gate mechanism; judgment findings are not evidence
and do not. What remained was filling in the requirement for the `applied` transition.

> **`applied` requires a recorded review verdict. It does not require a clean one.**

A change may apply with `unable-to-determine`, or with open judgment findings, provided a
verdict exists. It may not apply with no review having run.

That distinction is what makes the gate safe to make mandatory. The alternative — an optional
requirement — reproduces Q14's own prediction: advisory review gets skipped under schedule
pressure, exactly as the heavyweight supersede path did.

**No tier exemption is needed.** §5.3 reduces T0's review to mechanized audits only, but reduced
depth still produces a verdict, so the requirement is satisfied without carving out a hotfix
path. Consistent with §3.3 — tiers change depth, never whether gates run **(E2)**.

### Hosts that cannot produce a detached review

Per §5.2 this is real: detachment is enforceable in Claude Code (cold subagent context plus a
tool allowlist) and degrades elsewhere.

This is **not** an exemption and needs no new mechanism. It is D5's absence value with a reason
(`host-capability-missing`): the review did not run, that fact is recorded, and it is never
disguised as a pass.

It does force one honest choice. If the absence blocks, GRACE is unusable on hosts without
subagents; if it does not, the guarantee is void there. Route it through the **existing fail-on
policy surface** rather than inventing a switch — the project declares whether a missing review
verdict is fatal — and pair it with §5.2's obligation to publish the guarantee as conditional.
Same posture as `analysis.no-adapter`: honest, visible, configurable, never silently green.

### `unable-to-determine` is tracked, not merely permitted

Its rate, broken down by D5 reason code and joined to D6's derived context, is a third quality
signal, distinct from the other two:

| Signal | Measures |
|---|---|
| D4 — detection rate and determinism | whether the **reviewer** works |
| D10 — resolution classification | whether the **plan** was sound |
| **`unable-to-determine` rate by reason** | where the **toolkit** cannot form an opinion at all |

The third is a coverage map of the evidence surface: it names the contexts that reliably produce
"cannot tell", which is a roadmap input rather than a complaint about any agent.

**Counterweight, to be written down with it:** `unable-to-determine` must not become the
comfortable answer. It is the safe verdict — cheap to emit, never wrong — and if nothing tracks
it, agents drift toward it. Two things check that drift: D5's required reason code (a reason
mapping to no known evidence gap is itself suspicious), and the rate being visible, so a rising
trend is a finding rather than background.

---

## D12 — Typed holes: clarifications are absence, assumptions are provenance

**Decided.** `review-consolidated.md` Wave 0.2 bundles `[NEEDS CLARIFICATION: …]` and
`ASSUMPTION` into one item. They are opposite kinds of thing and need opposite policies, so
they are **two items, not one**.

| Marker | What it is | Trust model (D5/D6) |
|---|---|---|
| `[NEEDS CLARIFICATION: …]` | **Absence** — no value exists | D5's absence value, arriving at authoring time rather than check time |
| `ASSUMPTION` | **Presence with weak provenance** — a value exists and its basis is declared | `agent-inferred` authority |

Conflating them is what made the blocking question hard. Separated, it resolves itself.

### Clarifications block by D5's existing rule

A hole means the field has no trustworthy value, and gates already declare which evidence they
require. Whether an absence came from a failed check or from an author writing *"I don't know"*
does not change what a gate should do about it.

| Hole location | Effect |
|---|---|
| `IC-*` or `INV-*` | **Blocks plan approval.** Approval requires contracts and invariants; executing against a hole in a contract is executing against nothing |
| `AC-*` that a task `Satisfies` | **Blocks `--assertions final` and apply** |
| Anywhere else | Visible in `doctor`, blocks nothing — no gate requires it |

This is the same table one would write by hand, except it is **derived from gate declarations
rather than maintained as a second policy surface**. No new blocking machinery is required —
only that holes are typed and that gates declare their required fields, both of which D5
already assumes.

### Assumptions never block, and are tracked to resolution

They are a record, not a gap. The failure mode of blocking them is specific: assumptions are
cheap to write, blocking makes them expensive, and people stop writing them — the same dynamic
that kills interviews.

But they are more than doctor-visible metadata. **An `ASSUMPTION` is a falsifiable prediction**
— it is adjudicated when the work completes, by whether it held or was violated. That makes it
another labeled pair for D6's calibration corpus, at no cost beyond tracking assumptions to
resolution rather than letting them sit.

A violated assumption is a recordable **contradiction** in D6's sense.

---

## D13 — Packaging: no include mechanism is needed, and no manifest metadata is available

**Decided.** Both questions are settled by the repository rather than by argument.

### Q17 — the skill format has no include semantics **(E2)**, and does not need any

References are per-skill directories reached by relative path (`grace-plan/SKILL.md:29`); no
skill currently references another's.

**The premise is largely moot under D5.** Q17 fears the §4.7 vocabulary being physically copied
into 16 skills and again into the packaged mirror. Under D5 the binary computes the honest value
and emits it, so skills need **one sentence** — *report the value the binary emitted; never
summarize it away* — not an inlined enum. The enum lives in the binary and in one human-facing
reference.

Only the surfaces the binary does not own — review outcomes, AC satisfaction, self-review audit
rows — need authored vocabulary. That is a small set, and it needs no include mechanism either:

- a **single physical fragment** in one skill's `references/`, referenced by relative path from
  siblings
- all 16 skills ship in one plugin, so it exists **once** on disk — zero duplication, therefore
  zero drift
- `scripts/validate-marketplace.ts:257` already byte-compares each listed skill **directory**
  recursively via `git diff --no-index`, so the packaged mirror is covered with no new validator
  work

**One rule to add** (~15 lines): the verdict token set may appear in exactly one file under
`skills/`.

**One risk, and it is a verification step rather than a design question:** whether the relative
path resolves at install time. Requires a real install test, not an argument.

### Q18 — the plugin schema cannot carry inter-skill metadata **(E2)**

`skills` is a flat array of path strings and the plugin entry is `"strict": true`, so §5.9's
`requires` / `precedes` graph cannot live in the manifest.

**§5.9 is dropped rather than relocated.** A static precedence graph answers *"what runs after
what."* With the cursor designed (D1–D3), `ngrace status` answers the better question from real
state:

```
C-3 approved · epoch 4 · 2/5 tasks done · next: grace-execute
```

Strictly more useful than a declared ordering, nearly free once the cursor exists, and it does
not fight a schema that will not take the metadata. `validate-marketplace.ts` keeps validating
the flat array as it does today.

§5.9 therefore becomes a **consumer of D1's cursor**, not a packaging item.

---

## D14 — Three check surfaces, not two

**Decided.** `review-consolidated.md` §5.7 asks whether the lint catalog should host *process*
checks, offering two surfaces. Working through D5 and D11, there are **three**:

| Surface | Answers | Defining property |
|---|---|---|
| `lint` | *Are the artifacts valid?* | **Idempotent over a static tree.** Same tree, same answer, always |
| **Transition gates** | *May this state change happen?* | Preconditions for approve / apply / archive. May consult the ledger |
| `review` | *Did the process go wrong during this change?* | Findings about events; mechanized and judgment |

The middle surface was not named in the review, yet several decisions live there rather than in
either offered option: D11's verdict requirement, §4.7's *"may not archive while a declared
command assertion is unexecuted"*, and D5's *"gates declare required evidence."*

### The boundary that keeps `lint` clean

> **Lint checks artifacts — including the ledger as an artifact — but never whether a process
> step happened.**

| Check | Surface | Why |
|---|---|---|
| Ledger references a task not in the plan | **lint** | static referential check over two files; idempotent. This is D1's integrity check |
| A review ran before apply | **gate** | a fact about the run, not about the artifacts |
| The implementer weakened tests | **review** | a finding about what happened during the change |

Folding process into lint would make `ngrace lint` depend on run state, breaking both
idempotency and the *"lint the artifacts"* mental model the on-ramp rests on.

R3's evidence-linking convention (`derivedFrom` / `proposedBy`, §5.7) applies across all three,
so every surface audits against evidence the same way.

---

## D15 — Token accountability, selection, and the two-stage narrowing

**Decided.** Q22 asks for a token budget per mechanism. The answer is a scope rule, a
measurement, and explicitly **not** a cap.

### The toolkit is accountable for its own footprint only

| In scope — the toolkit's own cost | Out of scope — harness territory |
|---|---|
| Skill text (static, loaded every session) | Compressing or rewriting prompts before they reach the model |
| CLI output size per invocation | Summarizing the conversation |
| What an emitted slice or selection contains | Deciding what the agent loads, and when |

This is the boundary §5.2 already draws for pre-write hooks and subagent spawning: the toolkit
supplies material and evidence; the host decides what to load. It keeps context management from
becoming a fourth thing GRACE half-owns.

### Selection, never compression

| | What it is | Needs a model? | Owner |
|---|---|---|---|
| **Selection** | choosing a subset of *known* artifacts | No — a state and graph query | **Toolkit** |
| **Compression** | lossy rewriting of arbitrary text | Yes | **Harness** |

`grace context --compact` (§4.6) is ambiguous on this line and is resolved as **selection**. The
toolkit needs no LLM of its own to do the job properly.

Selection covers **both** GRACE artifacts and **skills** — skills are the toolkit's own
artifacts, so choosing which of the 16 apply to the current state is self-responsibility,
identical in kind to choosing which anchors go in a slice. The cursor (D1) is the source of
truth, making the selection derivable rather than guessed. Another cursor consumer, like D13's
fold of §5.9.

**The toolkit can only recommend.** `ngrace` cannot unload a skill from a model's context; it
emits a selection and the host decides whether to honour it. Skill subsetting is therefore a
§5.2 conditional guarantee — real where the host supports scoped loading, advisory elsewhere.

**Naming risk to head off:** a command that selects but is called `--compact` will create an
expectation of summarization. The behaviour is *"select the minimal relevant set."* Whether that
stays a flag, becomes the default of `--task`, or splits into a separate skill-recommendation
output should be decided on its merits rather than inherited from §4.6's wording.

### Two-stage narrowing: toolkit recall, harness precision

Subsetting is dynamic, and the toolkit cannot do semantic search. It can, however, narrow
candidates deterministically and hand off:

| Stage | Does | Property |
|---|---|---|
| **1 — toolkit** | narrow to candidates from state and graph structure | deterministic, free, reproducible |
| **2 — harness** | choose among candidates semantically | needs a model, non-deterministic, costs a call |

**Stage 1 must err toward inclusion.** A false negative there is unrecoverable — stage 2 only
ever sees candidates, so anything stage 1 drops is gone regardless of how good stage 2 is. A
false positive costs only tokens. The state-based narrowing rules are therefore conservative by
design, not clever.

**Correctness must never depend on stage 2.** Without a semantic pass the caller gets the
candidate set: larger, still correct, less economical. Stage 2 is purely an optimization, which
keeps the dependency soft and the degradation honest — more tokens, never wrong material.

Two details that follow:

- **Hand over candidates with their basis** — which anchor, which state — not bare names. Stage 2
  then reasons over something better than filenames, and D5's provenance survives the handoff.
- **Record which stage produced the final set.** D6 derives *"sliced vs. full context"* for
  calibration; with two stages that becomes three states, and pooling them would blur the
  analysis.

No new architecture: stage 1 is portable CLI, stage 2 is an optional host adapter, exactly the
§5.2 layering.

### Measurement, not a cap

An aggregate ceiling on skill text was considered and **rejected**: it cannot distinguish a
justified addition from bloat, it invites gaming (split a file, move text into a reference), and
it can block a legitimate addition while admitting a bloated one that happens to fit.

The design test is per-item — *minimal enough to cover its purpose*, applied when the item is
written. The mechanism is visibility: **report skill-text delta per change**, so growth is
justified at the moment it happens and a rising trend is a finding. Per-invocation cost (CLI
output, slice size) is measured because §4.1's entire premise is that slices save tokens — a
claim that needs a number rather than R4's unmeasured one.

Reference point **(E2)**: skill text totals **636 lines** across 16 skills at 5.0.1.

---

## Questions closed so far

Numbering from `review-consolidated.md` §7.

| # | Question | Outcome |
|---|---|---|
| Q13 | What is the success metric for this track? | A pair: reviewer determinism + seeded-corpus no-regression ratchet as the CI gate; seeded-defect detection rate per pattern as the trend. See D4 |
| Q16 | What happens when a **mechanism itself** fails? | It returns the shared absence value with a reason. Blocking is declared by the **gate** (required vs. optional evidence), not by the mechanism; the reason drives remediation. Suppressions are recorded ledger events, never config flags. See D5 |
| Q23 | Do provenance and `exact \| heuristic` unify into one vocabulary? | **No** — they are authority and precision, and collapsing them destroys the *verified-by-a-blunt-tool* vs. *asserted-by-the-agent* distinction. What unifies is the **absence value**, carried on every surface with a reason code. See D5 |
| Q21 | Do the five patterns hold on a second model family? | Not answered, but made answerable at no extra cost: executor identity is recorded on `<EpochOpened>` and the calibration corpus is the same corpus. See D6 |
| Q24 | What else did the 3→4 immutability trade drop? | Frame decided and the audit scoped: at least five constructs, of which roughly four are genuinely missing (F4). The audit itself is still to be run, against `v3.11.0`, with `grace-migrate`'s mapping table as its output. See D7 |
| Q14 | Does detached review block `applied`, or only advise? | It blocks — but on **existence**, not cleanliness. A recorded verdict is required; `unable-to-determine` is acceptable. Hosts that cannot produce one report D5's absence value with a reason, governed by the existing fail-on policy. See D11 |
| Q15 | Do typed holes block approval, execution, or only doctor? | Split the markers. `[NEEDS CLARIFICATION]` is absence and blocks wherever a gate requires that field — derived from gate declarations, not a separate policy table. `ASSUMPTION` never blocks and is tracked to resolution as calibration data. See D12 |
| Q17 | Does the skill format support include semantics? | **No (E2)** — and none is needed. D5 keeps the enum in the binary; skills carry one sentence. The small authored remainder lives as one physical fragment referenced by relative path, already covered by the recursive mirror check. See D13 |
| Q18 | Does the plugin schema support inter-skill metadata? | **No (E2)** — flat array of path strings under `"strict": true`. §5.9 is dropped and folded into `ngrace status` as a cursor consumer. See D13 |
| Q22 | What is the token budget per mechanism? | Scope rule plus measurement, **not** a cap. The toolkit is accountable for its own footprint only; skill-text delta is reported per change. See D15 |
| §5.7 | Does the lint catalog host process checks? | No — and there are **three** surfaces, not two: `lint` (artifacts, idempotent), transition gates (may this state change happen), `review` (what went wrong during the change). See D14 |
| Q9 | Run cursor inside the bundle or beside it? | Confirmed bundle-local, and refined: **two** artifacts, `run-ledger.xml` (truth) and `run.xml` (cache), both siblings to `plan.xml` |
| Q19 | Parallel cursor: one document or per-task shards? | Neither. Append-only event files under pre-allocated ranges, folded per epoch. Appends do not conflict, so no lock protocol and no single-writer constraint on the write path |
| Q20 | When do run cursors and amendment trails archive? | The ledger archives with the bundle, already folded. The cursor is deleted at archive — it is a cache, so there is no stale `in-progress` row to freeze, and no archived lie |
| Q25 | Should the cursor be reconstructible if lost? | Dissolved. It is reconstructible **from the ledger**, deterministically — not from git guesswork. The earlier "emit an `unknown` skeleton" fallback applies only if the ledger is also gone |

## Outstanding

Every question in `review-consolidated.md` §7.2 is now decided, deferred with a stated reason,
or reduced to work. What remains is listed here so `plan.md` does not have to rediscover it.

### Decisions not yet ratified

| Item | Position | From |
|---|---|---|
| Are loose `run/*` files committed to git during an open epoch? | Provisional **yes** — evidence that is not committed is not evidence, and a dead session mid-epoch is exactly when another machine needs them. Per-epoch folding keeps the diff noise to roughly one ledger update per epoch | D2, D3 |
| Name and home of the selection command | Behaviour is *"select the minimal relevant set."* Whether it stays a flag on `grace context`, becomes the default of `--task`, or splits into a separate skill-recommendation output is undecided — and should not inherit §4.6's `--compact` wording | D15 |
| Is the artifact **grammar** version renamed alongside the product? | `GRACE4_VERSION` (`"4.0"`) is deliberately distinct from the product version; bumping it signals that something became *required* and must ship with a migration path. Not resolved by the terminology cleanup | F1 context; session backlog |

### Work, not decisions

| Item | Shape | From |
|---|---|---|
| Run the v3→v5 capability audit | Bounded and local: `git show v3.11.0:…`. Output is a mapping table, whose natural home is `grace-migrate` — it has none for `implementationOrder` today, so v3 step statuses are dropped silently | D7, Q24 |
| Event kinds and their required fields | v3's `<CheckpointReport>` (`assumptions-kept`, `commands-run`, `evidence-captured`, `retry-budget-used`, `next-action`) is the starting vocabulary | D1, D6 |
| Install test for the shared reference path | Whether `../<skill>/references/<file>` resolves at install time. A verification step, not an argument | D13 |
| Fix the token measurement format before instrumenting | Static skill-text delta, per-invocation output size, tokens saved by a selection. Formats must be fixed up front or the numbers will not compare across changes | D15 |
| Validate the five patterns on a second model family | Mechanism is in place — executor identity on `<EpochOpened>`, same corpus. The study itself has not been run, and the patterns stay labelled single-executor, single-model until it is | D6, Q21 |

### Known limits, to be published rather than solved

| Limit | Why it stays |
|---|---|
| Detached review and skill subsetting are **conditional guarantees** | Both depend on host capability (§5.2). Real where the host provides cold subagent contexts and scoped loading; advisory elsewhere. Selling them as unconditional would be the confidence-without-check failure this track exists to remove |
| D10's resolution discriminator is a proxy, not a truth | A code-only fix can paper over a plan defect and will be scored as an implementation defect |
| Stage-2 semantic narrowing is an optimization only | Correctness never depends on it; without it the caller gets a larger candidate set (D15) |

---

## Reconciliation note — 2026-07-29 · RM-NAMESPACE-SEPARATION landed

**Appended, not merged into the decisions above.** Every D1–D15 entry stands exactly as ratified;
the reasoning did not change, only the spelling of some things it names. Where this note and the
body disagree about a name, this note is current and the body is the record of what was decided
and when.

`RM-NAMESPACE-SEPARATION` completed Phases 0–5 and shipped as `@neograce/cli` **6.0.0**. Four
renames touch decisions in this document:

| Was | Is | Affects |
|---|---|---|
| `.grace/` | `.ngrace/` | D1, D2, D3 — the ledger, cursor and event-file layout |
| `Grace*` root tags | `Ngrace*` | D3 — `<NgraceRunLedger>`, `<NgraceRunCursor>` |
| `GRACE4_VERSION = "4.0"` | `NGRACE_ARTIFACT_VERSION = "1.0"` | D13, and the grammar-version question in the packaging table |
| `src/grace4/`, `skills/grace/grace-*` | `src/artifact/`, `skills/ngrace/ngrace-*` | every file citation |

**Two things deliberately left as they were written.**

The `(E2)` citations at `src/grace4/scale-ergonomics.test.ts:212` and `src/grace4/grammar.ts:167`
keep their old paths. `(E2)` means *verified against this repository at 5.0.1 on 2026-07-29*, and
those paths are what was read. Rewriting them would leave the provenance tag intact while making
its content false — a claim asserting tool-verification of a file that did not exist at the stated
time. The files are now `src/artifact/scale-ergonomics.test.ts` and `src/artifact/grammar.ts`; the
line numbers still hold.

The `.grace/changes/active/C-3/` layout diagram under D3 likewise stays. It illustrates the
decision as taken. `plan.md` carries the current form, and `plan.md` is the normative document —
this one is explicitly `normative: false`.

**One decision to re-check at approval, not now.** D13 concluded that packaging needs no include
mechanism, reasoning partly from the skill directory layout. That layout moved
(`skills/grace/grace-cli/` → `skills/ngrace/ngrace-cli/`) but did not change *shape*, and
`scripts/validate-marketplace.ts` still verifies the mirror by recursive `git diff --no-index` per
skill directory. The conclusion appears unaffected; it is flagged rather than silently re-affirmed
because the evidence under it was re-verified for path, not for substance.

**Phase −1 is gone from `plan.md`.** It renamed the local `grace` script to `ngrace`; namespace
Phase 0 did that work, and it is recorded in commit `69475b4`.
