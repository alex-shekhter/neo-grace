---
name: ngrace-execute
description: Execute an approved neo-grace NgraceChangePlan in sequential or parallel-safe mode with recovery-aware preflight and centralized durable apply.
---

<skill>
<preflight>
Require one active bundle with approved, identity-matched `spec.xml` and `plan.xml`. Approved plans are immutable. Read context, projections, assertions, scopes, task dependencies, and verification before editing. Load the task slice with `ngrace context --task T-NNN --change C-ID` (Purpose is quotation, not paraphrase; archived subjects are measurement-only). Reject phase-incompatible plans before writes: `MustPassCommand` must be leaf project evidence, and neither target assertions nor post-write task verification may invoke `--assertions current` or nest GRACE lifecycle commands. Supersede and replan instead of editing an approved conflict in place.
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
5. Record every verification cycle with `ngrace cursor attempt --change C-ID --task T-NNN --outcome pass|fail` (add `--signature-kind` and `--signature-key` on fail). Optionally record agent self-report with `--claimed-confidence low|medium|high` — **analysis only**: no gate may read it; the calibration report scores it against independent `target-assertions`, never against the attempt's own outcome. When verification cannot run, use `ngrace cursor verification-unavailable --change C-ID --task T-NNN --reason …` — never an attempt and never silence. Do not use `cursor advance --kind attempt`. The fix budget escalates on 2 failed attempts of the same signature, or on 4 distinct failing signatures in the current budget window (not a raw attempt count) — `paused-pending-approval` awaits a replan decision; the task has not failed. On epoch open, the harness may pass `--executor-model` / `--executor-harness` (optional; may be absent).
6. Apply approved durable context, graph, and verification changes centrally.
7. Reconcile durable state, run leaf plan gates, then run selected `--assertions final` as the outermost lifecycle gate, including `--run-commands` when `MustPassCommand` is declared. Final mode performs full project lint, evaluates the selected target, keeps unrelated approved baselines active, and does not re-evaluate the selected plan's superseded baseline.
8. Ask for explicit apply confirmation after fresh end-state evidence passes.
9. Before setting `applied` or archiving: run `ngrace review --path . --change C-ID` for mechanized findings (does not record a verdict), form judgment on a detached reviewer when the host supports it, then record with `ngrace gate verdict --change C-ID --outcome <token>` (closed set in `references/verdicts.md`; the verdict command only writes). Then run `ngrace gate apply --change C-ID` and `ngrace gate archive --change C-ID`. Each gate evaluates and records a Decision in `run-ledger.xml`; exit non-zero means refuse. Do not set status or move the bundle when refused. The gate does not itself author `status` or archive paths. Detachment is host-conditional — see README host-capability matrix.
10. Only after both gates permit, set spec and plan to `applied` and archive the complete bundle.
11. Never edit approved assertions/scopes/tasks in place, bypass stale evidence, or continue through unknown drift.
</execution_rules>

<cursor_kinds>
  <kind id="opened">
    When: open a new epoch at the start of execution (`ngrace cursor advance --task T-NNN --open-epoch`). Do not pass `--from`/`--to` unless you have a measured allocation need; never pass a task id as a bound.
    Meaning / state: records the epoch open and range allocation; cursor stays `in-progress`.
    How to emit: `ngrace cursor advance --change C-ID --task T-NNN --open-epoch`.
  </kind>
  <kind id="progress">
    When: mark task start or completion (or other non-terminal structural progress) during the open epoch.
    Meaning / state: structural progress event; cursor stays `in-progress`. Default kind for `cursor advance` when `--kind` is omitted.
    How to emit: `ngrace cursor advance --change C-ID --task T-NNN` (optionally `--kind progress`).
  </kind>
  <kind id="resume">
    When: continue after a pause, or clear a per-task unresolved escalation after a replan decision allows work to continue.
    Meaning / state: cursor returns to `in-progress`. A resume for a task also clears that task from the unresolved-escalation set when it was escalated.
    How to emit: When clearing an unresolved escalation, `ngrace cursor resume --change C-ID --task T-NNN --reason "…"` (or `ngrace cursor advance --change C-ID --task T-NNN --kind resume --reason "…"`). The reason is the recorded replan decision — why work may continue — and is stored on the resume event; the CLI refuses before write when it is absent or whitespace-only. An ordinary resume that does not clear an escalation still works without `--reason`.
  </kind>
  <kind id="attempt">
    When: every verification cycle for a task — including intentional red-first runs meant to fail.
    Meaning / state: records pass|fail against the fix budget; cursor stays `in-progress`. Escalation fires on 2 failed attempts of the same signature, or on 4 distinct failing signatures in the current window — not on any two fails regardless of signature. Pass and verification-unavailable do not count toward those budgets.
    How to emit: `ngrace cursor attempt --change C-ID --task T-NNN --outcome pass|fail` (add `--signature-kind` and `--signature-key` on fail). Do not use `cursor advance --kind attempt`.
    Ordering for honest red-first (F9.8): write `ngrace cursor attempt --outcome fail` in its **own tool round trip**, then perform the production edit, then record pass — not in the same batched tool call as the fix. Reason: `WriteEvidence` digests `ObservedWriteScope` at attempt command time, so a fail attempt batched with the fix snapshots a tree that already contains the fix and cannot corroborate the sequence. Failure shape: `review.attempt-pair-unsubstantiated` on fail→pass pairs with no non-test digest movement. An honest disclosed gap is cheap; an unsubstantiated contradiction is not. Never stage a retrospective red (`git stash` → record fail → unstash).
  </kind>
  <kind id="verification-unavailable">
    When: verification cannot run (environment, tooling, or other blocker) — not when it ran and failed.
    Meaning / state: records that evidence could not be collected; does not count against the fix budget; cursor stays `in-progress`.
    How to emit: `ngrace cursor verification-unavailable --change C-ID --task T-NNN --reason …`. Never an attempt and never silence.
  </kind>
  <kind id="command-run">
    When: durable evidence of a MustPassCommand (or budget) evaluation is recorded by the harness/CLI after opted-in command execution.
    Meaning / state: command-evaluation evidence event; cursor stays `in-progress`. Agents do not invent this kind by hand for ordinary task progress — it is emitted when command evidence is written into the run stream.
    How to emit: produced by the CLI/harness path that appends command-run evidence (e.g. lint `--run-commands`); not a substitute for `cursor attempt`.
  </kind>
  <kind id="pause">
    When: work is interrupted and must stop mid-epoch without closing the epoch (await operator, context switch, or other pause).
    Meaning / state: cursor becomes `paused`. Distinct from escalation's `paused-pending-approval`.
    How to emit: `ngrace cursor pause --change C-ID --task T-NNN` (or `ngrace cursor advance --change C-ID --task T-NNN --kind pause`). Resume later with kind `resume`.
  </kind>
  <kind id="terminal">
    When: the epoch's work is finished and you are ready to fold. Emit terminal **before** `ngrace cursor fold`.
    Meaning / state: cursor becomes `complete` for the terminated range. Fold requires a terminal event **inside the covering allocation range**; the CLI blocks fold with an unterminated-range error otherwise.
    How to emit: the **operator** emits it (`ngrace cursor advance --change C-ID --task T-NNN --kind terminal`) when judging the work finished. Emitting terminal is a judgment about completion, not structural state the binary can derive — `recover --fix` does **not** emit terminal (it only extends covering allocations).
  </kind>
  <kind id="escalation">
    When: the fail path exhausts the fix budget and work must stop for a replan decision — on 2 failed attempts of the same signature (trigger R), or on 4 distinct failing signatures (trigger D), evaluated R before D in the current budget window.
    Meaning / state: cursor becomes `paused-pending-approval` — a pause awaiting replan, not a task-failure outcome. The task has not failed; a replan decision is owed.
    How to emit: written automatically by `ngrace cursor attempt` on the fail that exhausts the budget — do not use `cursor advance --kind escalation` (reserved). Clear later with a deliberate `resume` for that task that includes `--reason` recording the replan decision (required when clearing escalation; ordinary resume that does not clear an escalation needs none).
  </kind>
</cursor_kinds>

<verdicts>
Report the value the CLI emitted. Never summarize an absence into a pass. Shared vocabulary: `references/verdicts.md` under ngrace-cli (do not restate tokens here).
</verdicts>

<calibration>
`claimedConfidence` is recorded so correlation with outcomes can be studied later. **It informs nothing today** — no gate, review audit, or context slice may consume it. Promotion bar: demonstrated calibration on a held-out set, per context class, before any gate may use it. See `ngrace doctor` Calibration section (includes included/excluded/pending counts; N=0 is an honest empty report, not a rate table).
</calibration>
</skill>
