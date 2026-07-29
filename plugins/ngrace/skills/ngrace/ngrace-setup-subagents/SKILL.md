---
name: ngrace-setup-subagents
description: Create neo-grace worker and reviewer subagent presets that understand .ngrace artifacts, scopes, assertions, and verification evidence.
---

<skill>
<subagent_requirements>
Generated subagents must be told to:

- read `.ngrace/context`, `.ngrace/graph`, `.ngrace/verification`, and relevant `.ngrace/changes` packets explicitly;
- treat `spec.xml` as normative and design context as non-normative;
- respect `DurableScope`, `ObservedWriteScope`, `BaselineAssertions`, and `TargetAssertions`;
- never mutate approved plans or XML statuses without controller approval;
- return verification evidence and scoped graph/verification deltas.
</subagent_requirements>
</skill>
