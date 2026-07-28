---
name: grace-design
description: Interview for design-system intent and populate optional design-system.xml, UI_COMPONENT states, and a11y/visual verification evidence.
---

<skill>
<purpose>
Make UI/UX load-bearing in GRACE 4. Author optional `.grace/context/design-system.xml`, declare component `ST-*` states on graph modules, and wire `AccessibilityCheck` / `VisualCheck` evidence into `V-M-*` entries so module health can prove UI states.
</purpose>

<optional_artifact>
`design-system.xml` is **optional**. Projects without it must keep linting. Never make it required. When UX is in scope, create it from `references/design-system-template.xml` with root `GraceDesignSystem`.
</optional_artifact>

<anchors>
- `DT-*` design tokens (unique; each requires non-empty `<Value>`)
- `BP-*` breakpoints (require `<MinWidth>` and/or `<MaxWidth>`)
- `ST-*` UI states on modules under `<States>`
</anchors>

<module_types>
Validated module `<Type>` values (warning if unknown): `ENTRY_POINT`, `UI_COMPONENT`, `CORE_LOGIC`, `DATA_LAYER`, `INTEGRATION`, `UTILITY`.
</module_types>

<state_matching_rule>
A declared `ST-*` state is covered when any `Scenario`, `AccessibilityCheck`, or `VisualCheck` text under the module's `V-M-*` names the state id **without the `ST-` prefix**, case-insensitively, as consecutive **whole words**. `-` and camelCase both count as word separators. Examples: `ST-ERROR` matches "error banner" but **not** "terror scenario"; `ST-LOADING` matches "loading spinner" but **not** "downloading assets"; `ST-FOCUS-VISIBLE` matches "focus visible", "focus-visible", or "focusVisible". Whole words, not substrings: a matcher that accepts "downloading" as evidence for `ST-LOADING` reports coverage that does not exist. Document this rule whenever you author evidence so agents do not invent a fuzzy matcher.
</state_matching_rule>

<workflow>
1. Ask whether the project has a design system / token source, breakpoints, and accessibility standard.
2. If applicable, write `.grace/context/design-system.xml` from the template. Resolve `TokenSource` as a **project-relative** path only (no `..`, no absolute paths).
3. For each `UI_COMPONENT` module, declare `<Type>UI_COMPONENT</Type>` and `<States>` with the relevant `ST-*` anchors.
4. Extend `V-M-*` entries with `Scenario`s that name those states, plus optional:
   ```xml
   <AccessibilityCheck>
     <Tool>axe</Tool>
     <Command>bun run a11y --route /ledger</Command>
     <MaxSeverity>serious</MaxSeverity>
   </AccessibilityCheck>
   <VisualCheck>
     <Tool>playwright</Tool>
     <Command>bun run visual --component LedgerTable</Command>
     <Baseline>baselines/ledger-table.png</Baseline>
     <Viewports><BP-MOBILE /><BP-DESKTOP /></Viewports>
   </VisualCheck>
   ```
5. Recommend assertions when a change must enforce tokens or states:
   - `MustUseToken` / `MustNotUseLiteral` for token discipline
   - `MustMatchPattern` for general regex file checks (safe patterns only)
   - `MustCoverStates` for declared `ST-*` coverage
6. Run `grace lint --path PROJECT` and `grace status --with modules` and fix any `health.ui-state-unverified` or `health.ui-states-undeclared` findings.
</workflow>

<hard_rules>
- Do not invent token values that are not in `TokenSource` / `DT-*`.
- Do not skip `<Reason>` when Applicability is `not-applicable`.
- Semantic anchors (`DT-*`, `BP-*`, `ST-*`) are attribute-free tags, never attributes.
- Never require `design-system.xml` for non-UI projects.
</hard_rules>
</skill>
