---
name: ngrace-fix
description: Debug and fix issues in a neo-grace project using .ngrace semantic navigation, assertions, and verification evidence.
---

<skill>
<investigation_path>
1. Start from the failure, pasted error, failing command, or user report.
2. Load relevant `.ngrace/graph` module anchors and `.ngrace/verification` entries.
3. Check active `.ngrace/changes` for overlapping or stale planned work.
4. Capture the **run's own stdout/stderr** (not only the test framework failure report that
   echoes expected marker strings). Localize with
   `ngrace verification localize <V-M-*> --log <file>` (or `--log -` for stdin).
   Optional: `--review-json` from `ngrace review --format json` for D8 process context;
   `--change C-*` (and optional `--task T-*`) for flake classification from ledger attempts.
   Observed is textual presence of declared markers in that log (see command output ground),
   not proven emissions — if only a failure report exists, treat the observed sequence as
   unreliable and prefer absence over a confident divergence.
   Expected is a requirement list in declaration order; observed is a transcript — repeats and
   extra own-marker traffic are absorbed, not divergence. Read the first *unmet* required marker
   and `path:startLine-endLine` when a `BLOCK_*` region resolves; if location or sequence is
   absent, treat that as absence — never invent a stack frame as the divergence point.
5. Inspect file-local contracts and semantic blocks before editing.
6. Identify root cause, present findings, then make the smallest safe fix.
</investigation_path>

<verification>
Run the specific `V-M-*` commands or closest deterministic tests. If verification expectations are stale, update or propose changes through the neo-grace change lifecycle. After a failed cycle, re-run localization against the new run log before a second fix attempt.
</verification>
</skill>
