---
name: grace-spec
description: Interview the user and create an approved GRACE 4 GraceChangeSpec plus optional design-context.xml inside .grace/changes/active/C-*/.
---

<skill>
<change_bundle_contract>
`.grace/changes/active/C-CHANGE-ID/`

- `spec.xml` — normative `GraceChangeSpec`
- `design-context.xml` — optional, explanatory only
- `plan.xml` — created later by `grace-plan`
</change_bundle_contract>

<status_rules>
Create `spec.xml` as `status="draft"`. Set `status="approved"` only after explicit user approval. Rejected or cancelled specs move to archive with terminal status. Do not create or edit `plan.xml` in this skill.
</status_rules>

<strict_contract>
The direct `C-*` wrapper must contain exactly one meaningful `Summary`, `Goals`, `Constraints`, `NonGoals`, `AcceptanceCriteria`, `AffectedAreas`, and `VerificationIntent` section. Empty containers are not approval-ready. Semantic anchors are canonical attribute-free XML tags, never attributes or attribute values.
</strict_contract>

<acceptance_criteria_anchors>
Prefer addressable `AC-*` tags under `AcceptanceCriteria` so `grace-plan` can map them via task `<Satisfies>`:

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
- `AffectedAreas` should name real `M-*` / `DF-*` anchors (not prose alone) so plan DurableScope coverage can be validated.
</acceptance_criteria_anchors>

<workflow>
1. Ask one focused question at a time until goal, scope, constraints, non-goals, acceptance criteria, affected areas, and verification expectations are clear.
2. Propose a concise design summary and explicit assumptions. Ask for approval before writing an approved spec.
3. Create a deterministic uppercase-kebab `C-*` change id.
4. Write `spec.xml` from `references/change-spec-template.xml` with exactly one direct `C-*` wrapper and no empty required section. Prefer `AC-*` acceptance criteria.
5. If rationale, alternatives, scenarios, or external constraints would otherwise bloat the spec, write non-normative `design-context.xml` from its template.
6. If approval is not explicit, leave `spec.xml` as `status="draft"` and report the approval step needed.
</workflow>

<hard_rules>
- `spec.xml` is the source of truth for `grace-plan`; design context never adds requirements.
- Do not implement code, mutate current graph/verification state, or create retroactive change bundles.
- Recommend `grace lint --path <project-root> --assertions current` as a pre-implementation active-baseline check after writing the bundle; never present it as target or final evidence.
</hard_rules>
</skill>
