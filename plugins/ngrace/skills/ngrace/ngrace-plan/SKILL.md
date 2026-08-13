---
name: ngrace-plan
description: Read an approved neo-grace NgraceChangeSpec and optional design context, then create a NgraceChangePlan with assertions, scopes, tasks, and verification gates.
---

<skill>
<purpose>Convert one approved active `NgraceChangeSpec` into the executable `NgraceChangePlan`; do not implement source code.</purpose>

<inputs>
- Required: `.ngrace/changes/active/C-CHANGE-ID/spec.xml`
- Optional: sibling `design-context.xml`
- Current state: `.ngrace/context`, graph and verification indexes, and their routed documents
</inputs>

<preflight>
- Require `.ngrace/changes/active/C-CHANGE-ID/spec.xml` with `NgraceChangeSpec`, status `approved`, and exactly one matching direct `C-*` wrapper.
- Refuse draft, rejected, cancelled, applied, or superseded specs.
- Treat optional `design-context.xml` as explanatory; `spec.xml` wins on conflict.
- Run `ngrace lint --path PROJECT --assertions current` before planning and surface stale or invalid active baselines.
</preflight>

<approved_plan_immutability>
- If `plan.xml` already exists with status `approved`, stop before writing.
- Do not refresh `BaselineAssertions`, `TargetAssertions`, `DurableScope`, `ObservedWriteScope`, or tasks in place.
- Create a new `C-*` bundle and mark the old bundle superseded with an explicit replacement reference.
</approved_plan_immutability>

<must_do>
Produce `plan.xml` from `references/change-plan-template.xml` as draft unless the user explicitly approves the completed plan.

| # | requirement |
|---|---|
| 1 | Matching direct `C-*` wrapper identical to the authorizing spec. |
| 2 | Meaningful `IntentSummary` describing what the plan will accomplish. |
| 3 | Non-empty machine-checkable `BaselineAssertions`. |
| 4 | Non-empty machine-checkable `TargetAssertions`. |
| 5 | Explicit `DurableScope` (or `<None />` when there are no durable writes). |
| 6 | Explicit `ObservedWriteScope` (or `<None />` when there are no observed writes). Scope covers what the deliverable forces, not only the files it targets: a skill-text change declares the skill-footprint pin; a rule change declares the fixtures that construct that rule. If the approved deliverable makes an edit inevitable, list that path at plan time — never leave the executor choosing between a scope breach and a failed task. Failure shape: `review.write-evidence-outside-scope`. |
| 7 | A scope with no writes must use an explicit `<None />` marker; prose such as "none" is invalid. |
| 8 | Unique acyclic `T-NNN` tasks under `ImplementationPlan`. |
| 9 | Every task has exactly one `Title`. |
| 10 | Every task has exactly one `DependsOn`. |
| 11 | Every task has non-empty acceptance criteria. |
| 12 | Every task has non-empty verification commands. |
| 13 | Surface stale-state and coexistence warnings from preflight lint. |
| 14 | Reject unsupported scope glob syntax instead of guessing. |
| 15 | Before setting `plan.xml` to `approved`, run `ngrace gate approve --change C-ID`. Refuse means unresolved Clarifications on IC-* / INV-*; do not approve when refused. The gate records a Decision and does not itself set status. |
| 16 | Optional typed holes use `<Clarifications><Clarification><IC-*|INV-*|AC-* /></Clarification></Clarifications>` — exactly one self-closing IC-*, INV-*, or AC-* child; never a target attribute and never a prose `[NEEDS CLARIFICATION]` marker. |
</must_do>

<ceremony_tiers>
Honor the tier recorded in the authorizing spec's `Constraints`. Tiers change **how many gates and tasks you pre-declare**, never **whether gates run**. `--assertions final` remains the outer apply/archive gate at every tier.

| Tier | Plan shape |
|---|---|
| **T0** | Thin plan: minimal baseline/target (often a single `MustPassCommand` for the fix test), tight `ObservedWriteScope`, one or two tasks. Still requires approved plan + final gate. |
| **T1** | Full plan sections; single-package durable/observed scopes; task count matches AC mapping. |
| **T2** | Full plan + multi-module scopes + integration `MustPassCommand` / `MustConform` gates across packages. |
| **T3** | Full plan + multi-wave tasks, design-freeze assertions (`MustUseToken` / `MustCoverStates` when UI), staged verification. |

Never invent a "skip plan" path. If the user wants an ungoverned edit, refuse and offer the correct tier instead.
</ceremony_tiers>

<spec_plan_traceability>
- `DurableScope` must cover every `M-*` / `DF-*` / `IC-*` named in the authorizing spec `AffectedAreas`. A matching `V-M-*` under `VerificationAnchors` counts as covering `M-*`.
- If a plan deliberately omits a spec-affected anchor, declare it under optional `<OutOfPlanScope>` with a non-empty `<Reason>`:
  ```xml
  <OutOfPlanScope>
    <M-LEGACY-EXPORT><Reason>Deprecated; removal tracked in C-DROP-LEGACY.</Reason></M-LEGACY-EXPORT>
  </OutOfPlanScope>
  ```
- When the spec declares `AC-*` criteria, each task that implements one should list it under optional `<Satisfies><AC-ID /></Satisfies>`. Unmapped criteria warn; Satisfies of unknown `AC-*` ids error.
- Absence of `<Satisfies>` or `<OutOfPlanScope>` is never an error by itself.
</spec_plan_traceability>

<command_phase_rules>
- `current` is an active-baseline preflight and is valid only before observed writes begin.
- `baseline` is the selected pre-edit gate, `target` is selected post-edit evidence, and `final` is the outer apply/archive gate owned by `ngrace-execute`.
- `MustPassCommand` contains leaf project evidence such as tests, typecheck, build, format, or package checks. Never place `ngrace lint`, `ngrace status`, or another GRACE lifecycle command inside it.
- Never put `--assertions current` in `TargetAssertions` or in task verification that runs after writes. Use selected target/final lint externally instead.
</command_phase_rules>

<validation>
- Active-baseline preflight: `ngrace lint --path PROJECT --assertions current`
- Parallel safety: `ngrace lint --path PROJECT --parallel-preflight`
- Recommend `ngrace status --path PROJECT --json` after approval.
</validation>

<hard_rules>
Do not implement code, silently approve a plan, overwrite an approved plan, or mutate current graph/verification artifacts while planning. Semantic anchors are canonical XML tags, never attributes. Do not set plan status to approved without a permitting `ngrace gate approve` result.
</hard_rules>
</skill>
