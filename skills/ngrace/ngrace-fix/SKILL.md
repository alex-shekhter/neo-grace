---
name: ngrace-fix
description: Debug and fix issues in a neo-grace project using .ngrace semantic navigation, assertions, and verification evidence.
---

<skill>
<investigation_path>
1. Start from the failure, pasted error, failing command, or user report.
2. Load relevant `.ngrace/graph` module anchors and `.ngrace/verification` entries.
3. Check active `.ngrace/changes` for overlapping or stale planned work.
4. Capture the failing run's log (stdout/stderr). Localize with
   `ngrace verification localize <V-M-*> --log <file>` (or `--log -` for stdin).
   Optional: `--review-json` from `ngrace review --format json` for D8 process context only.
   Read first divergent block and `path:startLine-endLine` when a `BLOCK_*` region resolves;
   if location or sequence is absent, treat that as absence — never invent a stack frame as the
   divergence point.
5. Inspect file-local contracts and semantic blocks before editing.
6. Identify root cause, present findings, then make the smallest safe fix.
</investigation_path>

<verification>
Run the specific `V-M-*` commands or closest deterministic tests. If verification expectations are stale, update or propose changes through the neo-grace change lifecycle. After a failed cycle, re-run localization against the new log before a second fix attempt.
</verification>
</skill>
