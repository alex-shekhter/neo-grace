---
id: RM-PILOT-APPROVAL
kind: context
status: draft
supersededBy: null
created: 2026-09-01
updated: 2026-09-01
baseline: null
targets: []
normative: false
plan: null
related: [RM-GOVERNED-PATH, RM-VERIFIED-APPROVAL]
---

# Pilot approval: a ratified artifact that may be amended a bounded number of times

> **Status: exploration, not a commitment.** There is no `plan.md` and no phase has been
> approved. Nothing here is normative.

Recorded 2026-09-01, from the design discussion that followed the second supersede in four
bundles. The maintainer proposed the shape; §3 is his, sharpened by the objection in §2 that he
then answered.

## 1. The defect this exists to answer

**Immutability begins before the only test that can falsify the artifact.** A spec and plan are
ratified, and `approved_plan_immutability` freezes them from that moment. But the evidence that
would show the plan wrong arrives during **execution**, which happens afterwards. So a defect that
only running the code can reveal costs a whole bundle to correct — new spec, new plan, two more
approval phrases, full re-execution.

Measured against the archive: **4 of 50 archived bundles are superseded (8%)**, but **2 of the last
4** were, and both for the same reason.

- [F120](../RM-GOVERNED-PATH/decisions.md) — `C-SUPERSEDE-VERB`'s approved plan omitted
  `scripts/release-check.ts` from `ObservedWriteScope`, which
  `scripts/release-check.test.ts:494-513` forces for any new `src/` path in `package.json#files`.
  Invisible until the suite ran. Cost: a complete execution, reverted.
- [F127](../RM-GOVERNED-PATH/decisions.md) — `C-VERDICT-EVIDENCE`'s T-008 required
  `bun run validate:ci` green while the spec froze `examples/`; `validate:ci` runs
  `validate:examples`, whose walkthrough closes with the very command the bundle turns into a
  refuse. Invisible until the validator ran. Cost: seven completed tasks, reverted.

Both were **scope declarations**, not design. Neither bundle's binding, identity scheme, or refuse
split was wrong. A one-line correction cost a bundle each time, because the rule that protects
ratified bytes cannot distinguish "the design was wrong" from "the declaration missed a file."

## 2. The objection, and why it did not survive

The first response to any cheaper-amendment proposal is that **expense is the pressure that produces
care**. Three findings ([F120](../RM-GOVERNED-PATH/decisions.md),
[F126](../RM-GOVERNED-PATH/decisions.md), [F127](../RM-GOVERNED-PATH/decisions.md)) are one class —
a requirement and a restriction written in different sections and never checked against each other —
and each produced a review rule rather than a product change. Make amendment cheap and that pressure
goes.

Two things answer it.

**The pressure is aimed at the wrong party.** The cost of a defective approved plan lands on the
executor's discarded work, not on the reviewer who approved it. Discarding execution does not improve
review; explicit rules did.

**A bounded budget does not remove the pressure, it caps the cheap path.** Which is the proposal.

## 3. The shape

A **pilot** state in which an approved spec and plan may be amended a bounded number of times —
three was the number proposed — after which the artifact hardens and any further change requires a
supersede.

It is idiomatic rather than novel. This codebase already budgets attempts one level down:
`FIX_SIGNATURE_REPEAT_BUDGET = 2` and `FIX_DISTINCT_SIGNATURE_BUDGET = 4`
(`src/grace-cursor.ts:179,185`), with `paused-pending-approval` awaiting a replan decision when a
budget is exhausted. Pilot applies the same treatment to the plan that the plan's tasks already get.

**Exhaustion is the signal.** A bundle that burns all three amendments is not suffering a scope
typo; its plan is wrong at the design level, and supersede is the correct answer there. The budget
encodes that judgement instead of leaving it to argument each time.

**The budget is also the measuring instrument.** The amendment count is a number, per bundle, in the
ledger. It answers "are the review rules working?" without anyone tallying supersedes by hand.

### Why an attempt budget and not a clock

The proposal was first heard as wall-clock. That version fails: a bundle taking three days is not
riskier than one taking three hours, a deadline invites racing an amendment in before expiry, and
mutability keyed to elapsed time is invisible to any later reader of the artifact. An attempt count
is observable, countable, non-gameable, and carries an actor and a reason per increment — the
state-versus-event distinction [F115](../RM-GOVERNED-PATH/decisions.md) drew about superseding.

## 4. Constraints that decide whether it holds

1. **Every amendment re-ratifies.** A budget is not a substitute for a maintainer phrase and a
   fingerprint. Amendment *N* carries its own sufficient phrase and its own fingerprint over the
   amended bytes, or pilot is not cheaper supersede — it is approval that does not bind, which is
   precisely what D18 and `C-APPROVAL-FINGERPRINT` closed.
2. **One amendment is one recorded event**, which may change several fields but must name what
   forced it. Without that, "one amendment" becomes "everything discovered this week" and the
   budget is soft. `cursor attempt` already sets the precedent.
3. **The count never resets** — per bundle, not per epoch, not across a re-execution. Otherwise it
   is unbounded by restarting.
4. **A plan amendment must not reset or evade the task-level fix budget.** An executor blocked by
   signature escalation must not be able to amend its way out.
5. **The count is surfaced at close and in `review`.** A supersede is loud; three quiet amendments
   are not. Without this the mechanism hides the very signal that produced it.

## 5. Open questions

- **Which fields are amendable?** Amending `ObservedWriteScope` or a `MustPassCommand` is a
  different act from rewriting an acceptance criterion, which changes what was ratified in
  substance. One budget over all fields is simpler and leans on the phrase requirement to carry the
  weight; two tiers are more precise and more machinery. Undecided.
- **Is three the right number?** Chosen by proposal, not by measurement. Both recorded failures
  needed one amendment each.
- **What does an exhausted budget do?** Refuse further amendment and require supersede, or pause
  pending an explicit maintainer decision as the fix budget does. The second is closer to existing
  behaviour.
- **Does pilot interact with `RM-VERIFIED-APPROVAL`?** If ratification becomes verifiable rather
  than merely tamper-evident, each amendment needs its own code, and three amendments mean three
  round trips to the human. That may make the budget's real cost higher than it looks.

## 6. Why it is not scheduled

The 50% recent supersede rate is better explained by review failures than by the product. All three
instances were one defect class, and three rules now exist that each would have caught one —
expand what a required command actually runs before approving it, reconcile an artifact against
measurements already taken, and report a scope breach *before* making the write. The last one has
already worked on its first test: seven completed tasks survived `C-VERDICT-EVIDENCE`'s block where
zero survived `C-SUPERSEDE-VERB`'s.

Building pilot before establishing that those rules do not work would remove the pressure that
produced them, and would answer a process problem with a permanent grammar change. **The recorded
position is: measure two to three more bundles under the new rules; if the rate holds, build this —
narrow, event-counted, and re-ratified per amendment.**
