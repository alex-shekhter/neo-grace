---
name: ngrace-refactor
description: Refactor neo-grace governed code while keeping .ngrace graph, verification, change scopes, and file-local anchors synchronized.
---

<skill>
<scope>
Use this for rename, move, split, merge, extraction, or boundary cleanup work. Greenfield feature work should go through `ngrace-spec`, `ngrace-plan`, and `ngrace-execute`.
</scope>

<must_do>
- Resolve affected `M-*`, `DF-*`, and `V-M-*` anchors through `.ngrace/graph/index.xml` and `.ngrace/verification/index.xml`.
- Check active `.ngrace/changes` for scope overlap before editing.
- Preserve or update file-local `LINKS:`, module contracts, function contracts, and semantic blocks.
- Update durable graph and verification artifacts only when the refactor intentionally changes boundaries, paths, or evidence.
- Run targeted tests and `ngrace lint --path <project-root>` when available.
</must_do>
</skill>
