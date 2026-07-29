---
name: ngrace-explainer
description: Explain GRACE 4 methodology, .grace artifacts, semantic anchors, change lifecycle, verification, and migration boundaries.
---

<skill>
<core_model>
GRACE 4 uses `.grace` as the durable project model:

- `.grace/context` stores requirements, technology, principles, deployment, and UX constraints.
- `.grace/graph` stores graph indexes and routed graph documents with `GD-*`, `M-*`, and `DF-*` tags.
- `.grace/verification` stores verification indexes and routed `V-M-*` entries.
- `.grace/changes` stores active and archived `C-*` change bundles with `GraceChangeSpec`, optional non-normative design context, and `GraceChangePlan`.
</core_model>

<workflow>
1. `ngrace-init` creates the `.grace` skeleton.
2. `ngrace-spec` creates an active change spec and waits for approval.
3. `ngrace-plan` creates assertions, scopes, and `T-*` implementation tasks.
4. `ngrace-execute` runs sequential or parallel-safe mode from the approved plan.
5. `ngrace lint` and `ngrace status` provide validation and health evidence.
6. Existing GRACE 3 projects use `ngrace-migrate`; the CLI validates the result but does not convert legacy docs directly.
</workflow>
</skill>
