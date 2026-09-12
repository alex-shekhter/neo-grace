---
name: ngrace-plan
description: Read an approved neo-grace NgraceChangeSpec and optional design context, then create a NgraceChangePlan with assertions, scopes, tasks, and verification gates.
---

<skill>
<purpose>Convert one approved active `NgraceChangeSpec` into the executable `NgraceChangePlan`; do not implement source code.</purpose>

<shape_sources>
Registered change-plan and change-task shapes: `docs/schema-reference.md` (headings change-plan, change-task). That document is not a complete grammar — it excludes imperative validators and file-local markup.
Explain a shape or code: argv token `explain`.
Primary write path: `ngrace plan new`.
Optional-section teaching source: `references/change-plan-template.xml`.
</shape_sources>

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
- Create a new `C-*` bundle and mark the old bundle superseded with an explicit replacement reference: create the replacement first with `ngrace spec new`, then run `ngrace supersede`. The verb folds any open epoch (no-op when none exists) and discards governance, never code. Replacement-first is the only linting order. Named checks: `change.invalid-active-status`, `change.archive-status-mismatch`, `change.superseded-missing-replacement`, `change.superseded-self-replacement`, and `change.superseded-replacement-not-found`. Do not hand-write a superseded status or move the bundle directory by hand.
</approved_plan_immutability>

<approval_lexicon>
Sufficient approving phrases, closed:
- the standalone word `approved`
- the phrase `I approve`
- the phrase `approve this plan` matching this artifact

Named non-approvals, closed:
- `looks good`
- `continue`
- any question

A question is not an approval even when it contains an approving word.

When requesting ratification of a written plan, quote the sufficient phrases bound to the artifact id and stage in the same breath. Use one approval request per message, one artifact, nothing else asked. Then record the ratifying phrase verbatim — the bytes the human wrote, never a paraphrase.
</approval_lexicon>

<must_do>
Produce `plan.xml` with `ngrace plan new` as the primary write path. Use `references/change-plan-template.xml` as the teaching source for optional sections. Leave the plan as draft unless the user explicitly approves the completed plan.

| # | requirement |
|---|---|
| 1 | Matching direct `C-*` wrapper identical to the authorizing spec. |
| 2 | Required plan sections are those `docs/schema-reference.md` lists under change-plan. Do not restate that list here. |
| 3 | Required task sections are those `docs/schema-reference.md` lists under change-task. Do not restate that list here. |
| 4 | Non-empty machine-checkable baseline and target assertions. |
| 5 | Explicit durable and observed write scopes (or `<None />` when there are no writes). |
| 6 | Scope covers what the deliverable forces, not only the files it targets: a skill-text change declares the skill-footprint pin; a rule change declares the fixtures that construct that rule. If the approved deliverable makes an edit inevitable, list that path at plan time — never leave the executor choosing between a scope breach and a failed task. Failure shape: `review.write-evidence-outside-scope`. |
| 7 | A scope with no writes must use an explicit `<None />` marker; prose such as "none" is invalid. |
| 8 | Unique acyclic `T-NNN` tasks under the implementation plan. |
| 9 | Every task has exactly one `Title`. |
| 10 | Every task has exactly one `DependsOn`. |
| 11 | Every task has non-empty acceptance criteria. |
| 12 | Every task has non-empty verification commands. |
| 13 | Surface stale-state and coexistence warnings from preflight lint. |
| 14 | Reject unsupported scope glob syntax instead of guessing. |
| 15 | Before the plan is approved, after a sufficient lexicon phrase, run `ngrace review --path . --change C-ID` (does not record a verdict), then `ngrace gate approve --change C-ID`. Refuse means unresolved Clarifications on IC-* / INV-* unless force; the gate writes status and records the fingerprint. Request ratification of C-ID at plan stage with a sufficient phrase: `approved`, `I approve`, or `approve this plan`. The approval write may belong to a party other than the author of the artifact: whoever holds the approving phrase writes it, and the author requests ratification without collapsing the two roles. At spec-approve the scope and WriteEvidence audits report they did not run (no plan); attempt-pair reports ran over 0 pairs and that is not substantiation. At plan-approve `review.scope-outside-write-scope` on the bundle's own spec.xml, plan.xml, and (when that file changed) decisions.md is expected; do not add those paths to ObservedWriteScope. |
| 16 | Optional typed holes use `<Clarifications><Clarification><IC-*|INV-*|AC-* /></Clarification></Clarifications>` — exactly one self-closing IC-*, INV-*, or AC-* child; never a target attribute and never a prose `[NEEDS CLARIFICATION]` marker. |
| 17 | Every authorizing spec must decide `README.md` and `examples/` in a Goal, Constraint, or NonGoal. Silence fails. Enforcement is `checkDocsAndExamplesDecision`. |
| 18 | `plan new` seeds are placeholders: the skeleton's tasks, assertions, and pre-wired `Satisfies` exist to be replaced — fill each seed from the authorizing spec or remove it, and never approve a placeholder a reader would execute as if it were a task. The pre-wired `Satisfies` is re-homed deliberately: point it at the criterion the task actually implements, never left where the skeleton minted it. |
| 19 | Drive every planned command on a prototype before the plan is approved: a `Verification` command that has never been executed against a fixture is a claim, and a gate it cannot satisfy is discovered by the executor mid-flight instead of by you now. Probes mutate copies, never the production record. |
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
- An unmapped non-CloseEvidence criterion is only a warning, and a warning is enough to sink the close: a CloseEvidence criterion running with `--fail-on warnings` turns that warning into an uncloseable bundle. Map the criterion to the task that implements it, or the close fails with no error to fix.
- CloseEvidence `AC-*` are not Satisfies targets. `plan new` links only ordinary criteria. Satisfies of a complete CloseEvidence `AC-*` is an error.
- Absence of `<Satisfies>` or `<OutOfPlanScope>` is never an error by itself.
</spec_plan_traceability>

<command_phase_rules>
- `current` is an active-baseline preflight and is valid only before observed writes begin.
- `baseline` is the selected pre-edit gate, `target` is selected post-edit evidence, and `final` is the outer apply/archive gate owned by `ngrace-execute`.
- `MustPassCommand` contains leaf project evidence such as tests, typecheck, build, format, or package checks. Do not put a current-mode lint of this project root in TargetAssertions. Current mode means the command text contains `--assertions current`, or it invokes `ngrace lint` and omits `--assertions`. The restriction matches command text; it does not resolve `bun run <script>` through package.json, and it does not apply to `--help` or to lint of a different project root. Use selected target/final lint externally instead.
- Never put `--assertions current` in task verification that runs after writes. Use selected target/final lint externally instead.
- A recorded task `Verification` command is evaluated at the stage the task runs, on the tree that stage leaves: a target-mode gate expected to pass only at a later stage exits non-zero at an earlier one by design, and that exit is not a defect — it is the phase rule telling you the evidence belongs to the later stage.
</command_phase_rules>

<validation>
- Active-baseline preflight: `ngrace lint --path PROJECT --assertions current`
- Parallel safety: `ngrace lint --path PROJECT --parallel-preflight`
- Recommend `ngrace status --path PROJECT --json` after approval.
</validation>

<hard_rules>
Do not implement code, silently approve a plan, overwrite an approved plan, or mutate current graph/verification artifacts while planning. Semantic anchors are canonical XML tags, never attributes. Do not hand-write plan status to approved; a permitting `ngrace gate approve` writes status and records the fingerprint. When a spec, plan, design-context, or skill XML block must name a tag, attribute form, or angle-bracketed token, write it as character data with entities (`&lt;` `&gt;` `&amp;`); do not paraphrase the brackets away to keep the document well-formed; markup-byte assertions belong in a TypeScript test.
</hard_rules>
</skill>
