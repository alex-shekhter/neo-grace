---
id: RM-GITLESS-INTEGRITY
kind: context
status: draft
supersededBy: null
created: 2026-08-10
updated: 2026-08-10
baseline: null
targets: []
normative: false
plan: null
related: [RM-GOVERNED-PATH]
---

# Gitless artifact integrity: what the tool knows about what it approved

> **Status: exploration, not a commitment.** There is no `plan.md` and no phase has been
> approved. Nothing here is normative.
>
> **Not scheduled before the release after `RM-GOVERNED-PATH`'s next target.** The maintainer
> placed it after the next version. It also has a hard ordering dependency on that track — see
> §4.

## 1. The question

`ngrace` can tell you an approved `plan.xml` changed. It cannot tell you *what was approved*.

`gate approve` records a `Decision` in `run-ledger.xml` naming the gate, the decision, and the
requirements it evaluated. It records **no fingerprint of the artifact it was evaluating.** From that
moment on, the tool's only answer to *"is this the plan that was approved?"* is *"whatever
`plan.xml` currently says"* — which is the property this product exists to remove.

The gap is filled today by `collectApprovedContractDrift` (`grace-status.ts:371`), which compares
against git's tracked-changed files and derives the `approved-contract-drift` state.

## 2. Where the git-based answer runs out

Three weaknesses, all measured against the current implementation rather than supposed:

1. **It requires git.** A GRACE project need not be a repository. Where it is not, the check is
   silently absent rather than absent-with-a-reason — the shape `C-LEDGER-READ-ABSENCE` exists to
   fix elsewhere.
2. **It cannot see edit-and-commit.** An approved plan modified *and* committed in a single step
   presents as clean, permanently. The detector keys on the working tree, so committing the edit
   removes the evidence.
3. **It has no memory of approval.** It answers *"does this differ from HEAD?"*, not *"does this
   differ from what was approved?"* — different questions that coincide only while nobody commits.

A fourth, discovered in practice: authoring `status="approved"` is itself a modification to a
committed artifact, so the check fires a **hard stop** on every approval until it is committed
(`decisions.md` F19). That one is arguably correct behaviour, but it shows the check is measuring
proximity to a commit rather than fidelity to an approval.

## 3. The shape a repair would take

The machinery already exists. Every `cursor attempt` writes `<WriteEvidence><File digest="…">` with
64-hex content digests, so digesting an artifact is a solved problem in this codebase, with an
established format.

The move is to have `gate approve` record the digests of what it approved — the spec and the plan —
into the same `Decision` it already writes. That record is:

- **append-only**, so it is compatible with D9;
- **git-independent**, so it works in a non-repository project;
- **durable across commits**, which is exactly the hole in (2) above;
- **retrospective**, in that it fixes the approved bytes at the moment of approval rather than
  inferring them later.

Open questions this document does not answer: whether the digest is over raw bytes or a normalized
form (raw flags harmless reformatting — which may be the correct answer, since *approved* should mean
*these bytes*); whether spec and plan are digested separately or as a pair; and what the surface says
when the recorded digest and the file disagree — a refusal, a state, or a finding.

## 4. The condition that makes this worth doing

**It replaces `approved-contract-drift`'s git reading. It does not run beside it.**

Two surfaces answering *"did the approved contract change?"* from two different sources is the exact
defect `C-REPORT-HONESTY` was written to remove: `ngrace status` and the archive gate each computing
loose-event membership, agreeing on most inputs, disagreeing on one directory
(`decisions.md` F14, F15). The acceptance criterion there — *"agreement of independent copies is the
defect in remission, not the repair"* — applies here in advance.

So this work cannot start until `RM-GOVERNED-PATH` has settled what owns that answer. Its P3 phase
(*lifecycle mechanics and evidence honesty*) already touches the approve-event record via D3's
approve-event base ref; the digest is the same record gaining a fingerprint, and the two should be
designed together or in a known order.

## 5. What this is not

- Not a signing or tamper-proofing scheme. A digest recorded in the same repository as the artifact
  proves *change*, not *authority*; anyone who can edit the plan can edit the ledger. The value is
  that the change becomes **visible and dated**, not that it becomes impossible.
- Not a replacement for review. It answers *"did this change?"*, never *"is this right?"*.
- Not a second copy of git. Where git is present the two will normally agree; the point is the cases
  where git is absent, or where a commit has erased the difference.
