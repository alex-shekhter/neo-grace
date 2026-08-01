---
name: ngrace-execute
description: Execute an approved neo-grace NgraceChangePlan in sequential or parallel-safe mode with recovery-aware preflight and centralized durable apply.
---

<skill>
<preflight>
Require one active bundle with approved, identity-matched `spec.xml` and `plan.xml`. Approved plans are immutable. Read context, projections, assertions, scopes, task dependencies, and verification before editing. Reject phase-incompatible plans before writes: `MustPassCommand` must be leaf project evidence, and neither target assertions nor post-write task verification may invoke `--assertions current` or nest GRACE lifecycle commands. Supersede and replan instead of editing an approved conflict in place.
</preflight>

<assertion_commands>
- Active-baseline preflight before observed writes: `ngrace lint --path PROJECT --assertions current`
- Selected baseline: `ngrace lint --path PROJECT --change C-ID --assertions baseline` (add `--run-commands` when the baseline declares `MustPassCommand`)
- Selected target without commands: `ngrace lint --path PROJECT --change C-ID --assertions target`
- Selected target with command evidence: `ngrace lint --path PROJECT --change C-ID --assertions target --run-commands`
- Final end-state validation: `ngrace lint --path PROJECT --change C-ID --assertions final` (add `--run-commands` when the target declares `MustPassCommand`)
- Parallel preflight: `ngrace lint --path PROJECT --parallel-preflight`
</assertion_commands>

<mode_selection>
Wait for explicit `sequential` or `parallel-safe` choice. Parallel-safe requires the explicit preflight to pass. Workers never mutate approved plans; durable `.ngrace` changes are applied centrally after observed work verifies.
</mode_selection>

<recovery_decision_table>
| state | required action |
| clean-to-start | Run selected baseline, then execute tasks. |
| partial-observed-writes | Inspect the declared observed scope and ask whether to resume or revert. |
| durable-state-changed | Hard stop; supersede and replan. Approved assertions are immutable. |
| target-already-satisfied | Run final end-state validation, opted-in command evidence when declared, durable reconciliation, and ask for explicit apply confirmation. |
| unsafe-unknown-drift | Hard stop and report unexplained files. |
</recovery_decision_table>

<execution_rules>
1. Run the selected baseline before implementation, including explicit `--run-commands` when its assertions declare `MustPassCommand`.
2. Execute one dependency-ready task or one verified parallel-safe batch at a time.
3. Run each task's acceptance and verification immediately.
4. Advance the run cursor when a task starts or completes (`ngrace cursor advance`); pause/resume around interruptions; fold the open epoch when the wave is quiescent (`ngrace cursor fold`).
5. Record every verification cycle with `ngrace cursor attempt --change C-ID --task T-NNN --outcome pass|fail` (add `--signature-kind` and `--signature-key` on fail). When verification cannot run, use `ngrace cursor verification-unavailable --change C-ID --task T-NNN --reason …` — never an attempt and never silence. Do not use `cursor advance --kind attempt`. Two failed attempts exhaust the fix budget and escalate to paused-pending-approval: a pause awaiting a replan decision, not a task failure.
6. Apply approved durable context, graph, and verification changes centrally.
7. Reconcile durable state, run leaf plan gates, then run selected `--assertions final` as the outermost lifecycle gate, including `--run-commands` when `MustPassCommand` is declared. Final mode performs full project lint, evaluates the selected target, keeps unrelated approved baselines active, and does not re-evaluate the selected plan's superseded baseline.
8. Ask for explicit apply confirmation after fresh end-state evidence passes.
9. Before setting `applied` or archiving: run `ngrace review --path . --change C-ID` for mechanized findings (does not record a verdict), form judgment on a detached reviewer when the host supports it, then record with `ngrace gate verdict --change C-ID --outcome <token>` (closed set in `references/verdicts.md`; the verdict command only writes). Then run `ngrace gate apply --change C-ID` and `ngrace gate archive --change C-ID`. Each gate evaluates and records a Decision in `run-ledger.xml`; exit non-zero means refuse. Do not set status or move the bundle when refused. The gate does not itself author `status` or archive paths. Detachment is host-conditional — see README host-capability matrix.
10. Only after both gates permit, set spec and plan to `applied` and archive the complete bundle.
11. Never edit approved assertions/scopes/tasks in place, bypass stale evidence, or continue through unknown drift.
</execution_rules>

<verdicts>
Report the value the CLI emitted. Never summarize an absence into a pass. Shared vocabulary: `references/verdicts.md` under ngrace-cli (do not restate tokens here).
</verdicts>
</skill>
