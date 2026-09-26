---
id: RM-ADAPTIVE-BUNDLE-SIZING
kind: context
status: draft
supersededBy: null
created: 2026-09-20
updated: 2026-09-20
baseline: null
targets: []
normative: false
plan: null
related: [RM-GOVERNED-PATH, RM-PILOT-APPROVAL, RM-COMMITTED-STAGE-BOUNDARIES]
---

# Adaptive bundle sizing

> **Status: exploration, not a commitment.** There is no `plan.md`, no threshold is
> ratified, and no runtime gate is proposed. This records the measured case and the
> questions a later skill bundle must answer.

Recorded 2026-09-20 after `C-SUPERSEDE-MEMBERSHIP-2-C459A20C` reached twelve
corrective executor/authority turns while its plan was still draft. Five implementation
checkpoint commits existed, but T-006 through T-008 and the faithful close rehearsal
were still open. The maintainer stopped the monolithic continuation and asked how
neo-grace can respond more flexibly as bundle size and review cost become visible.

## 1. Measured incident

The bundle was an outlier before turn count is considered:

| Measure | Current bundle | Archived median | Archived p90 | Archived maximum | Population |
|---|---:|---:|---:|---:|---:|
| Acceptance criteria | 41 | 11 | 15 | 22 | 129 specs |
| Spec bytes | 116,233 | 38,669 | 62,707 | 83,314 | 129 specs |
| Plan tasks | 10 | 4 | 6.1 | 10 | 120 parseable plans |
| Task verification commands | 46 | 12.5 | 25.1 | 46 | 120 parseable plans |
| Exact observed-scope files | 31 | 13.5 | 26 | 69 | 120 parseable plans |

The current spec has almost twice as many criteria as the largest archived spec and is
larger in bytes than every archived spec. Its task count ties the archive maximum, its
verification-command count ties the archive maximum, and only 5 of 120 parseable plans
have at least 31 exact scope files.

The archive measurement covered all 135 bundle directories present on 2026-09-20:
135 specs were found, 129 bundles had plans, and 9 legacy plans were excluded from
plan-structure percentiles because a standards parser reported malformed XML. Spec
metrics therefore use 129 well-formed specs; plan metrics use the remaining 120
well-formed plans. Archive status was 103 applied and 32 superseded. That status count
is context, not evidence that size caused supersession: the applied and superseded size
distributions overlap, and age, workflow changes, and defect type are confounders.

The stronger incident signal is **review turns after approval**. Twelve materially
corrective turns repeatedly found missing discriminators, false green claims, untested
consumer paths, weak byte snapshots, and stage-boundary errors. A count of files or
criteria could warn before approval; the turn count shows that the bundle remains too
large for the review loop actually operating on it.

## 2. Turn count is a sizing signal

A future workflow should count a turn when it materially changes one or more of:

- the spec or plan contract;
- task ownership, scope, dependencies, or verification commands;
- implementation needed to satisfy a claimed row;
- evidence after a claimed row is shown not to discriminate;
- the lifecycle sequence needed for approval, execution, or close.

Status-only messages, permission handoffs, and a rerun with no changed conclusion do
not count. Each counted turn should carry the defect class and the affected task or
criterion. A raw conversation-message count is too noisy; a **corrective-turn count** is
the useful measure.

Turn count is dynamic in a way static size is not. It catches a compact but conceptually
tangled bundle, and it does not punish a large mechanical bundle that passes review in
one attempt. It is also late: by the time the count is high, an approved spec may already
require supersession. The workflow therefore needs both an early structural signal and a
live correction-cost signal.

## 3. Candidate policy shapes

1. **Hard structural caps**
   - Pros: deterministic before approval; cheap to calculate; prevents extreme outliers.
   - Cons: bytes and counts are gameable; a cohesive migration can be large but safe;
     a small bundle can still hide several coupled state machines.

2. **Corrective-turn budget only**
   - Pros: measures the review process that is actually failing; adapts to task
     difficulty and executor quality.
   - Cons: reacts after cost has been paid; depends on honest turn classification; can
     force an expensive supersede after approval.

3. **Hybrid adaptive review — recommended for the future discussion**
   - Pros: structural outliers trigger a split review before approval, while corrective
     turns can reopen the sizing decision during draft planning or prototyping; neither
     signal alone decides the outcome.
   - Cons: needs a small amount of durable review metadata and an explicit exception for
     an indivisible atomic mechanism; thresholds require more observations.

The runner-up is hard caps because they are simple and early. It loses to the hybrid
because this incident is not just large: it combines several state machines, and a
future formatter could reduce byte count without reducing review risk.

## 4. Proposed flexible behavior

The first implementation belongs in the canonical skills and packaged mirrors, not in
a new mandatory CLI control surface:

1. Before spec approval, compare the draft with measured project history: criteria,
   forced modules/files, planned task count, verification-command count, shared write
   sets, and the longest dependency chain. Crossing more than one high-percentile signal
   requires an explicit keep-or-split review.
2. During draft-plan and prototype work, maintain the corrective-turn count. Repeated
   corrections require the authority to revisit bundle boundaries rather than issuing
   another narrow repair brief automatically.
3. The review produces itemized split variants, dependencies, payment ownership, and the
   cost of superseding an already approved contract. It may keep the bundle whole only
   by naming the atomic mechanism that would be broken by a split.
4. A split is sequential when the repository permits only one active execution bundle.
   Later bundles are dependencies with concrete acceptance ownership, not deferred debt.
5. Committed stage boundaries preserve reusable prototype work when a split is chosen.

No numeric refusal threshold is selected here. The present case establishes that 41
criteria, 10 serial tasks, 46 task commands, 31 exact scope files, and 12 corrective
turns must trigger a split review. A later derivation should measure more completed
bundles and decide whether the operational trigger is a fixed turn budget, distinct
defect classes, structural percentiles, or a combination.

## 5. Questions a future spec must close

- What event records a corrective turn without depending on a chat provider or session
  identifier?
- Does the count reset after a coherent split, or follow requirements that move into a
  successor bundle?
- Which structural measures are advisory, and which combinations require an explicit
  maintainer decision?
- How is an atomic-mechanism exception stated and later falsified?
- How are acceptance criteria and finding payments partitioned exactly once when an
  approved bundle must supersede into a sequential series?
- How does the sizing review interact with pilot approval, which addresses amendments
  to approved artifacts rather than bundle decomposition?
- What corpus report keeps thresholds current without making old archived bundles fail
  new policy retroactively?

## 6. Why this is separate

The active supersede-membership spec has a closed file set and cannot authorize skill
changes. This queue entry records the sizing problem and its data without widening that
bundle. Any implementation must update canonical skill sources and packaged mirrors in
its own governed change, then validate the teaching against both an oversized fixture
and an indivisible large-but-cohesive control.
