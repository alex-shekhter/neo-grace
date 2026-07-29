---
name: ngrace-explainer
description: Explain GRACE 4 methodology, .ngrace artifacts, semantic anchors, change lifecycle, verification, and migration boundaries.
---

<skill>
<core_model>
GRACE 4 uses `.ngrace` as the durable project model:

- `.ngrace/context` stores requirements, technology, principles, deployment, and UX constraints.
- `.ngrace/graph` stores graph indexes and routed graph documents with `GD-*`, `M-*`, and `DF-*` tags.
- `.ngrace/verification` stores verification indexes and routed `V-M-*` entries.
- `.ngrace/changes` stores active and archived `C-*` change bundles with `NgraceChangeSpec`, optional non-normative design context, and `NgraceChangePlan`.
</core_model>

<workflow>
1. `ngrace-init` creates the `.ngrace` skeleton.
2. `ngrace-spec` creates an active change spec and waits for approval.
3. `ngrace-plan` creates assertions, scopes, and `T-*` implementation tasks.
4. `ngrace-execute` runs sequential or parallel-safe mode from the approved plan.
5. `ngrace lint` and `ngrace status` provide validation and health evidence.
6. Existing GRACE 3 projects use `ngrace-migrate`; the CLI validates the result but does not convert legacy docs directly.
</workflow>
</skill>
