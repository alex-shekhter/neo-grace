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
> the skill work needed to make it routine across repositories.

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

Here, **commit** means a durable checkpoint in the project's versioning system, not necessarily Git.
This is a sequencing invariant and not permission to mix unrelated dirty work into the checkpoint. A
project with no versioning system cannot truthfully claim the same guarantee; the skills require an
existing restorable snapshot mechanism instead. If neither exists, the boundary is unsatisfied and
the next stage does not begin.

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

The repository already demonstrates that the two questions are separable. Current approval
decisions record SHA-256 fingerprints, and `classifyApprovedArtifact` compares those approved bytes
without consulting Git. That proves artifact identity even after an edit is committed. It does not
prove that the rest of a completed implementation stage has a durable, restorable checkpoint.
Conversely, the current dirty-tree guard calls Git directly and treats a failed Git probe as clean;
there is no Mercurial, Subversion, or generic VCS adapter. A new boundary check must not inherit that
false equivalence.

## 3. Skill surfaces a future bundle must cover

- Update canonical `skills/ngrace/ngrace-spec/SKILL.md`, `ngrace-plan/SKILL.md`, and
  `ngrace-execute/SKILL.md`, then update the packaged mirrors in the same change.
- Teach the exact stage contents and exclusions, including predecessor transitions, approval ledger
  writes, per-task or per-wave execution evidence, and post-close archive/record writes.
- Add validation that keeps canonical and packaged text synchronized and guards the required
  boundary language against deletion.
- Discover the project's versioning mechanism from repository instructions and available tooling;
  do not infer Git merely because the current GRACE implementation invokes it in some paths.
- With Git, Mercurial, Subversion, or another VCS, use that system's native status, staging, and
  commit/checkpoint semantics and report the resulting revision identifier.
- With no VCS, accept only an existing project-native mechanism that produces a restorable snapshot;
  record its identity and digest and label it as a snapshot rather than a commit. A digest manifest
  by itself checks equality but is not a restorable boundary.
- With neither VCS nor a restorable snapshot mechanism, report that the boundary is unsatisfied and
  stop before the next stage. Never interpret an unavailable VCS command as a clean working tree.
- Drive the real CLI across spec approval → plan authoring, plan approval → epoch open, task/wave
  transitions, and archive → next bundle to prove the skill sequence fits the existing product. This
  is verification of the teaching, not a new runtime gate or harness.

## 4. Implementation variants

1. **Literal Git rule**
   - Pros: shortest teaching and directly fits this repository.
   - Cons: incorrectly turns a project policy into a Git dependency; it excludes other VCS tools and
     gives no honest instruction for no-VCS projects.

2. **VCS-neutral skill rule — recommended**
   - Pros: preserves the actual invariant — a durable stage boundary — while using the project's
     existing versioning or snapshot mechanism; requires no new control surface; makes absence
     explicit instead of pretending unavailable means clean.
   - Cons: relies on executor compliance and repository instructions; a no-VCS snapshot can be more
     expensive and must be proven restorable, not merely hashed.

3. **New CLI adapter or checkpoint harness**
   - Pros: could enforce a common result and make violations machine-readable.
   - Cons: adds a control surface for a sequencing discipline, requires mutation and recovery
     semantics for multiple VCS tools, and is unnecessary to teach the rule correctly.

**Recommendation: variant 2.** Variant 1 is the runner-up because it is simple, but it loses on the
first Mercurial, Subversion, or no-VCS project. Variant 3 loses because the repository has no future
control surface that needs this abstraction, and enforcement machinery would be larger than the
discipline it serves.

## 5. Questions the implementing spec must close

- Define when a plan task is a commit boundary and when a declared parallel wave is the atomic
  boundary, so parallel-safe work does not acquire a false sequential constraint.
- Define the exact allowed dirt at each handoff, including tool-owned loose run events and approval
  ledger writes.
- Decide whether a failed boundary check blocks only the next lifecycle command or also appears in
  `review` and `status`.
- Define what evidence proves a no-VCS snapshot is restorable; a digest alone proves only identity.
- Define how the skill discovers project-native VCS instructions without hardcoding Git, Mercurial,
  or Subversion command sets into generic prose.
- Preserve explicit operator control over VCS staging and checkpoint creation; the executor performs
  the commit or equivalent operation and reports its revision or snapshot identity.

## 6. Why it is queued separately

The active supersede-membership spec has a closed forced-file set that does not include the skill
trees. Expanding that bundle would violate its approved scope. This roadmap entry records the
already-decided policy now; a later change bundle will authorize the canonical and packaged skill
files, prove the workflow against Git, another VCS fixture if available, and a no-VCS fixture, and
close the teaching gap without carrying debt into the active bundle.
