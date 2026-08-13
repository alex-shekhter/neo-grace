---
name: ngrace-spec
description: Interview the user and create an approved neo-grace NgraceChangeSpec plus optional design-context.xml inside .ngrace/changes/active/C-*/.
---

<skill>
<change_bundle_contract>
`.ngrace/changes/active/C-CHANGE-ID/`

- `spec.xml` — normative `NgraceChangeSpec`
- `design-context.xml` — optional, explanatory only
- `plan.xml` — created later by `ngrace-plan`
</change_bundle_contract>

<status_rules>
Create `spec.xml` as `status="draft"`. Set `status="approved"` only after explicit user approval. Rejected or cancelled specs move to archive with terminal status. Do not create or edit `plan.xml` in this skill.
</status_rules>

<strict_contract>
| # | requirement |
|---|---|
| 1 | The direct `C-*` wrapper contains exactly one meaningful `Summary` section. |
| 2 | The wrapper contains exactly one meaningful `Goals` section. |
| 3 | The wrapper contains exactly one meaningful `Constraints` section. |
| 4 | The wrapper contains exactly one meaningful `NonGoals` section. |
| 5 | The wrapper contains exactly one meaningful `AcceptanceCriteria` section. |
| 6 | The wrapper contains exactly one meaningful `AffectedAreas` section. |
| 7 | The wrapper contains exactly one meaningful `VerificationIntent` section. |
| 8 | Empty containers are not approval-ready. |
| 9 | Semantic anchors are canonical attribute-free XML tags, never attributes or attribute values. |
</strict_contract>

<ceremony_tiers>
Ask the user which risk tier applies (default **T1**). Record the tier in `Constraints` (e.g. `Ceremony tier T1 (module change)`). Tiers change **which sections must be rich**, never **whether gates run**. `--assertions final` remains the release gate at every tier.

| Tier | Name | Spec emphasis | Use when |
|---|---|---|---|
| **T0** | Hotfix | Tight `Summary`/`Problem`, narrow `AffectedAreas`, issue link in `Constraints`, minimal `AcceptanceCriteria`; optional thin design-context | Production break/fix with known blast radius |
| **T1** | Module change | Full `strict_contract` sections; single-package `AffectedAreas` | Normal feature slice in one package |
| **T2** | Cross-cutting | Full sections + multi-module/`DF-*`/`IC-*` in `AffectedAreas`; integration evidence in `VerificationIntent` | API+UI or multi-crate change |
| **T3** | Architectural | Full sections + design freeze notes, multi-phase verification intent, explicit non-goals for migration windows | New subsystem, redesign, contract major bump |

Hard rules for tiers:
- T0 is **not** an ungoverned edit. A `NgraceChangeSpec` still exists; only section depth shrinks.
- Tiers never skip baseline, target, or final assertion gates and never skip user approval of the spec.
- Mis-classifying an architectural change as T0 is a review failure — see `ngrace-reviewer`.
</ceremony_tiers>

<clarifications>
Typed holes (D12) are schema elements, never prose markers. When a contract, invariant, or acceptance criterion is unknown at authoring time, declare:

```xml
<Clarifications>
  <Clarification><IC-EXAMPLE />What is the wire shape for this contract?</Clarification>
  <Clarification resolved="true"><INV-AUTH />Resolved: tokens expire at 15m.</Clarification>
</Clarifications>
```

Rules:
- Target is exactly one self-closing `IC-*`, `INV-*`, or `AC-*` child — never a target attribute.
- Unresolved clarifications on `IC-*` / `INV-*` block plan approval (`ngrace gate approve`).
- Unresolved clarifications on `AC-*` that a task `Satisfies` block apply.
- `Assumptions` remain presence with weak provenance and never block a gate.
- Do **not** write `[NEEDS CLARIFICATION: …]` in free text — lint and gates cannot verify prose markers.
</clarifications>

<acceptance_criteria_anchors>
Prefer addressable `AC-*` tags under `AcceptanceCriteria` so `ngrace-plan` can map them via task `<Satisfies>`:

```xml
<AcceptanceCriteria>
  <AC-KEYBOARD-NAV>Arrow keys move focus; Home/End jump to first/last row.</AC-KEYBOARD-NAV>
  <AC-AXE-CLEAN>axe reports zero serious or critical violations on the route.</AC-AXE-CLEAN>
</AcceptanceCriteria>
```

Rules:
- `AC-*` ids are uppercase kebab (`AC-[A-Z0-9]+(?:-[A-Z0-9]+)*`).
- Each `AC-*` id is unique within the spec and must contain non-empty text.
- Legacy free-text or `<Criterion>` children remain valid; when no `AC-*` is present, criteria mapping is skipped for backward compatibility.
- `AffectedAreas` should name real `M-*` / `DF-*` / `IC-*` anchors (not prose alone) so plan DurableScope coverage can be validated.
</acceptance_criteria_anchors>

<design_references>
Optional `<DesignReferences>` under the `C-*` wrapper links design sources without bloating normative sections:

```xml
<DesignReferences>
  <Figma url="https://www.figma.com/design/abc/Dashboard">Dashboard states</Figma>
  <UserResearch>docs/research/auth-interviews.md</UserResearch>
</DesignReferences>
```

Rules:
- `<Figma url="…">` requires a well-formed **http(s)** URL (relative paths and other schemes are rejected by lint).
- `<UserResearch>` holds a project-relative path that must stay inside the project root.
- Only `Figma` and `UserResearch` children are allowed; other tags error.
- Design references are not requirements; `spec.xml` sections remain the source of truth for `ngrace-plan`.
</design_references>

<workflow>
1. Ask one focused question at a time until goal, scope, constraints, non-goals, acceptance criteria, affected areas, verification expectations, and ceremony tier are clear.
2. Propose a concise design summary and explicit assumptions. Ask for approval before writing an approved spec.
3. Create a deterministic uppercase-kebab `C-*` change id.
4. Write `spec.xml` from `references/change-spec-template.xml` with exactly one direct `C-*` wrapper and no empty required section. Prefer `AC-*` acceptance criteria. Add `DesignReferences` when Figma or research artifacts exist.
5. If rationale, alternatives, scenarios, or external constraints would otherwise bloat the spec, write non-normative `design-context.xml` from its template.
6. If approval is not explicit, leave `spec.xml` as `status="draft"` and report the approval step needed.
</workflow>

<hard_rules>
- `spec.xml` is the source of truth for `ngrace-plan`; design context never adds requirements.
- Do not implement code, mutate current graph/verification state, or create retroactive change bundles.
- Recommend `ngrace lint --path <project-root> --assertions current` as a pre-implementation active-baseline check after writing the bundle; never present it as target or final evidence.
</hard_rules>
</skill>
