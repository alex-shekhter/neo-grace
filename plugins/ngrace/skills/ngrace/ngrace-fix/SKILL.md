---
name: ngrace-fix
description: Debug and fix issues in a neo-grace project using .ngrace semantic navigation, assertions, and verification evidence.
---

<skill>
<investigation_path>
1. Start from the failure, pasted error, failing command, or user report.
2. Load relevant `.ngrace/graph` module anchors and `.ngrace/verification` entries.
3. Check active `.ngrace/changes` for overlapping or stale planned work.
4. Inspect file-local contracts and semantic blocks before editing.
5. Identify root cause, present findings, then make the smallest safe fix.
</investigation_path>

<verification>
Run the specific `V-M-*` commands or closest deterministic tests. If verification expectations are stale, update or propose changes through the neo-grace change lifecycle.
</verification>
</skill>
