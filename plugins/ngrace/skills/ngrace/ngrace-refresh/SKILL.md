---
name: ngrace-refresh
description: Detect drift between observed repository state and durable neo-grace .ngrace current state, then help create reconciliation changes.
---

<skill>
<purpose>
Compare code, tests, and file-local markup against `.ngrace/context`, `.ngrace/graph`, `.ngrace/verification`, and active change scopes. This skill reports drift and proposes a normal `NgraceChangeSpec`/`NgraceChangePlan`; it does not silently mutate current state.
</purpose>

<workflow>
1. Run or request `ngrace lint --path <project-root>` and `ngrace status --path <project-root>`.
2. Inspect `.ngrace/graph/index.xml` and routed graph documents for stale, missing, or orphaned `M-*` and `DF-*` anchors.
3. Inspect `.ngrace/verification/index.xml` and routed verification documents for missing deterministic `V-M-*` coverage, stale commands, or missing evidence markers.
4. Compare file-local `LINKS:`, module contracts, tests, and log markers against durable anchors.
5. Report drift as findings with proposed reconciliation scope.
6. If changes are needed, route through `ngrace-spec` and `ngrace-plan` instead of direct mutation.
</workflow>
</skill>
