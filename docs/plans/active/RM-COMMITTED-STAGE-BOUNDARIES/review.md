---
id: RM-COMMITTED-STAGE-BOUNDARIES
kind: context
status: draft
supersededBy: null
created: 2026-09-20
updated: 2026-09-20
baseline: null
targets: []
normative: false
plan: null
related: [RM-GOVERNED-PATH, RM-GITLESS-INTEGRITY, RM-VERIFIED-APPROVAL]
---

# Committed stage boundaries

> **Status: exploration, not a commitment.** There is no `plan.md` and no phase has been
> approved. Nothing here is normative. The maintainer has decided the policy; this document queues
> the product and teaching work needed to make it routine and enforceable.

Recorded 2026-09-20 after the approved spec for
`C-SUPERSEDE-MEMBERSHIP-2-C459A20C` was found outside git while plan work had already begun.

## 1. The rule

**Every approved or implemented stage is committed before the next stage begins.** A stage boundary
is at least:

1. approved spec → commit the approved `spec.xml`, its approval record, and any required predecessor
   transition before authoring the plan;
2. approved plan → commit the approved `plan.xml` and its approval record before opening the
   execution epoch or editing implementation files;
3. completed implementation task or declared parallel wave → commit its code, tests, and execution
   evidence before starting its successor task or wave;
4. completed apply/archive and record move → commit the resulting archive and governed-record state
   before starting another bundle or lifecycle stage.

The commit closes one stage only. Draft artifacts and work belonging to the next stage are excluded.
Before each commit, inspect the staged path set and scan both the staged diff and commit message for
the repository's forbidden session and credential forms.

This is a sequencing invariant, not permission for a CLI to commit automatically and not permission
to mix unrelated dirty work into the boundary commit.

## 2. Existing evidence and the uncovered gap

[F258](../RM-GOVERNED-PATH/decisions.md) measured one concrete failure: a prototype that opened its
epoch with an approved but uncommitted `plan.xml` put that path into every attempt's
`WriteEvidence`, and the archive review later rejected it. The resulting teaching appears in
`skills/ngrace/ngrace-plan/SKILL.md` row 19 and its packaged mirror: **on a copy**, commit the approved
plan before opening the epoch.

That remedy is narrower than the policy decided here. The production `ngrace-spec` workflow ends at
approval without a commit handoff. `ngrace-plan` teaches the commit only for a prototype copy.
`ngrace-execute` requires approved artifacts but does not first require those approved bytes to be a
committed baseline, and it does not close each completed task or wave with a commit. The close
sequence likewise needs an explicit archive/record commit before another bundle begins.

The incident also demonstrates why the boundary matters independently of F258: without a commit,
the next stage cannot distinguish the ratified input from its own edits, a reviewer cannot name one
stable baseline hash, and recovery can preserve an ambiguous mixture of stages.

## 3. Product surfaces a future bundle must cover

- Update canonical `skills/ngrace/ngrace-spec/SKILL.md`, `ngrace-plan/SKILL.md`, and
  `ngrace-execute/SKILL.md`, then update the packaged mirrors in the same change.
- Teach the exact stage contents and exclusions, including predecessor transitions, approval ledger
  writes, per-task or per-wave execution evidence, and post-close archive/record writes.
- Add validation that keeps canonical and packaged text synchronized and guards the required
  boundary language against deletion.
- Design a read-only CLI preflight that can refuse beginning the next stage when the previous stage
  is dirty or uncommitted. It must report the paths and the missing boundary; it must not create a
  commit.
- Reconcile enforcement with `RM-GITLESS-INTEGRITY`: when git is unavailable, report typed absence
  or require an explicit, recorded override. Do not claim a commit boundary was verified.
- Drive the real CLI across spec approval → plan authoring, plan approval → epoch open, task/wave
  transitions, and archive → next bundle. Tests alone are insufficient.

## 4. Implementation variants

1. **Skills only**
   - Pros: smallest change; immediately makes the expected handoff explicit; works with the current
     lifecycle.
   - Cons: repeats the failure mode of other prose-only safeguards; an executor can still proceed on
     dirty approved bytes, and the product reports no typed violation.

2. **Skills plus a read-only stage-boundary preflight — recommended**
   - Pros: aligns teaching and behavior; keeps commit authorship with the operator; can name the
     exact dirty paths; gives later review a stable commit hash; admits an honest gitless state.
   - Cons: requires a precise state model for predecessor transitions, task/wave boundaries, and
     close writes; intersects `RM-GITLESS-INTEGRITY` and needs discriminating fixtures.

3. **CLI-created commits**
   - Pros: makes the happy path automatic and prevents an omitted manual commit.
   - Cons: the CLI would choose staging boundaries, messages, and repository history while unrelated
     work may be present; failure recovery becomes a git-history mutation problem; it expands GRACE
     from contract orchestration into source-control authorship.

**Recommendation: variant 2.** Variant 1 is the runner-up and should land only as the teaching half
of the same governed change; alone it leaves the defect enforceable only by memory. Variant 3 loses
because automatic commit creation cannot safely infer ownership of an already-dirty working tree.

## 5. Questions the implementing spec must close

- Define when a plan task is a commit boundary and when a declared parallel wave is the atomic
  boundary, so parallel-safe work does not acquire a false sequential constraint.
- Define the exact allowed dirt at each handoff, including tool-owned loose run events and approval
  ledger writes.
- Decide whether a failed boundary check blocks only the next lifecycle command or also appears in
  `review` and `status`.
- Define the gitless override and its durable evidence before adding enforcement.
- Preserve explicit operator control over `git add` and `git commit`; the product detects and
  refuses, while the executor performs the commit.

## 6. Why it is queued separately

The active supersede-membership spec has a closed forced-file set that does not include the skill
trees or the CLI surfaces this work requires. Expanding that bundle would violate its approved scope.
This roadmap entry records the already-decided policy now; a later change bundle will measure the
full command population, authorize the files, implement the skill mirrors and enforcement, and
close the decision without carrying debt into the active bundle.
