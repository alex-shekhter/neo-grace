# v3 → v5 capability map

**Source tag:** `v3.11.0`  
**Read on:** 2026-07-29 (RM-AGENT-RELIABILITY-EVIDENCE Phase 0)  
**Sources (authoritative for this table):**

1. `plugins/grace/skills/grace/grace-init/assets/docs/development-plan.xml.template`
2. `plugins/grace/skills/grace/grace-init/assets/docs/operational-packets.xml.template`
3. `plugins/grace/skills/grace/grace-execute/SKILL.md`
4. `plugins/grace/skills/grace/grace-multiagent-execute/SKILL.md`

**Verdict vocabulary** (exactly one per row):

| Verdict | Meaning |
|---|---|
| `superseded` | v5 has a replacement; name it |
| `collateral-loss` | Dropped as a known cost of another design; name the decision restoring it |
| `genuinely-missing` | No v5 home yet; name the phase / decision that will restore it |
| `deliberately-dropped` | Not coming back; name why |

D7's first-pass sort (eleven constructs) is the starting hypothesis. Rows marked **beyond D7**
were present in the four sources but not in that table.

**Leaf fields are rolled into parent rows** — e.g. `purpose` / `param` / `export-functionName`
under a module contract are not separate map rows; the parent construct (`Modules` / `M-*`,
`ExecutionPacket`, …) carries the verdict for the whole field set.

IDs are stable for migrate reporting. Never renumber; append only.

---

## Development plan (`development-plan.xml.template`)

| ID | v3 construct | Verdict | Basis |
|---|---|---|---|
| DP-01 | `DevelopmentPlan` root + `VERSION` | `superseded` | Change bundles: `NgraceChangeSpec` / `NgraceChangePlan` under `.ngrace/changes/{active,archive}/` with `graceVersion` |
| DP-02 | `ArchitectureNotes` (`objective`, `non-goal`, `risk-*`) | `superseded` | Spec `Goals` / `NonGoals` / `Constraints` + optional `design-context.xml` |
| DP-03 | `Modules` / `M-*` with inline `contract`, `interface`, `depends`, `target`, `observability`, `verification-ref`, `notes` | `superseded` | Graph modules + source `MODULE_CONTRACT` / `MODULE_MAP` + verification index. Layer/ORDER attributes absorbed into plan tasks, not module XML status |
| DP-04 | Module attribute `STATUS` on `M-*` | `deliberately-dropped` | Nested status on durable graph anchors is forbidden (`artifact.forbidden-status-attribute`). Progress lives in change plan tasks + run cursor (D1), not on the module |
| DP-05 | `DataFlow` / `DF-*` with ordered `step-N` + `evidence` | `superseded` | Graph `DF-*` membership + verification markers/scenarios. Ordered DF gaps are linted (Phase 7 ordered-DF support) |
| DP-06 | `ImplementationOrder` / `Phase-N` / `step-N` (`module`, `status`, `verification`) | `collateral-loss` | Byte-stable plans removed in-document step status. Restore as run cursor + ledger outside the plan (D1–D3); migrate must map statuses instead of dropping them |
| DP-07 | `ExecutionPolicy` / `default-profile` (`safe` \| `balanced` \| `fast`) | `genuinely-missing` | Profiles exist only as prose in retired multiagent skill. No enforced v5 surface; sibling RM-AGENT-RELIABILITY host-matrix / wave work (D10, §5.2) |
| DP-08 | `controller-owns` | `superseded` | Controller role is skill procedure (`ngrace-execute`); shared artifacts are under `.ngrace/` with dry-run structural writes (`ngrace graph … --apply`). Parallel preflight covers part of shared-write safety |
| DP-09 | `worker-owns` | `superseded` | `ObservedWriteScope` + DurableScope on change plans; execute skill keeps workers inside approved paths |
| DP-10 | `max-fix-attempts-per-step` | `genuinely-missing` | D9: budget of 2 escalating to replan; not yet in grammar or gates |
| DP-11 | `replan-trigger` | `genuinely-missing` | D9 pairs replan with fix budget; no v5 field or gate yet |
| DP-12 | `checkpoint-requirement` | `collateral-loss` | Field list restored as ledger / checkpoint events (D1, D6); not a plan-side checklist attribute |

## Operational packets (`operational-packets.xml.template`)

| ID | v3 construct | Verdict | Basis |
|---|---|---|---|
| OP-01 | `ExecutionPacket` composition (one task slice) | `genuinely-missing` | Retrieval halves exist (`module show --with verification`, `file show --contracts --blocks`); **composition + exclusion boundary** is §4.1 / D7 |
| OP-02 | Packet `write-scope` | `superseded` | `ObservedWriteScope` on the change plan |
| OP-03 | Packet `contract-excerpt` / `graph-entry-excerpt` / `verification-excerpt` | `superseded` | Deterministic query projections; do not reintroduce authored paraphrase packets (D7 rule 1) |
| OP-04 | Packet `dependency-contract-summaries` | `superseded` | `module find --depends` + graph DEPENDS/LINKS validation (G-10/G-11) |
| OP-05 | Packet `assumptions` | `superseded` | Spec `Assumptions` + typed holes / `ASSUMPTION` markers (§4.4); not a separate packet document |
| OP-06 | Packet `stop-conditions` | `genuinely-missing` | Adjacent to replan-trigger (D9); no machine field yet |
| OP-07 | Packet `retry-budget` | `genuinely-missing` | Same as DP-10 / D9 |
| OP-08 | Packet `checkpoint-fields` (assumptions-kept, commands-run, evidence-captured, next-action) | `collateral-loss` | Restored as ledger event payload shape (D1/D6), not as free-form worker prose |
| OP-09 | Packet `expected-graph-delta-fields` | `superseded` | Target/final assertion modes + DurableScope express expected end-state; delta *documents* as worker artifacts are not restored (D7 rule 1) |
| OP-10 | Packet `expected-verification-delta-fields` | `superseded` | Same as OP-09 via verification index + assertion modes |
| OP-11 | `GraphDelta` worker→controller document | `deliberately-dropped` | Paraphrase risk; controller applies structural graph writes via tooling, not authored delta XML |
| OP-12 | `VerificationDelta` worker→controller document | `deliberately-dropped` | Same; verification edits go through real verification documents under lint |
| OP-13 | `FailurePacket` / `first-divergent-block` | `genuinely-missing` | D8: join expected markers from `V-M-*` with observed run sequence |
| OP-14 | `FailurePacket` expected vs observed evidence | `genuinely-missing` | D8 localization inputs; ingredients exist, join does not |
| OP-15 | `CheckpointReport` (scope, assumptions-kept, commands-run, evidence-captured, retry-budget-used, next-action) | `collateral-loss` | D1/D6 ledger events re-derived the same field list; not a separate authored template |

## Execute skill (`grace-execute/SKILL.md`)

| ID | v3 construct | Verdict | Basis |
|---|---|---|---|
| EX-01 | Sequential step execution over `ImplementationOrder` | `collateral-loss` | Cursor + ledger (D1–D3) replace in-plan status mutation; `ngrace-execute` still sequences tasks but without a machine cursor today |
| EX-02 | Controller-built execution packet per step | `genuinely-missing` | Same as OP-01 / §4.1 |
| EX-03 | Scoped review after each step | `genuinely-missing` | Detached reviewer + deterministic finding IDs (D4); host-conditional (D5/§5.2) |
| EX-04 | Central shared-artifact apply after step | `superseded` | Graph CLI dry-run / `--apply`; skills own narrative apply steps |
| EX-05 | Phase-level broader checks | `superseded` | `ngrace lint`, assertion modes, verification commands at phase boundaries in skill text |
| EX-06 | Mid-run status write into `development-plan.xml` | `deliberately-dropped` | Conflicts with byte-stable plans; cursor is external (D1) |
| EX-07 | Optional CLI seed of packet via `grace module show` / `file show` | `superseded` | Same queries as `ngrace module` / `ngrace file` (namespace separation) |

## Multiagent execute skill (`grace-multiagent-execute/SKILL.md`)

| ID | v3 construct | Verdict | Basis |
|---|---|---|---|
| MA-01 | Parallel-safe waves (disjoint write scope) | `superseded` | Parallel preflight / overlap diagnostics on approved scopes |
| MA-02 | Execution profiles `safe` / `balanced` / `fast` | `genuinely-missing` | Same as DP-07; profile depth is not enforced |
| MA-03 | Fresh worker agent per module | `genuinely-missing` | Host capability (cold subagent); matrix in §5.2 / D4 path |
| MA-04 | Ownership split (controller vs worker vs reviewer) | `superseded` | Skill roles + scopes; not a separate XML ownership table |
| MA-05 | Batched graph sync after wave | `superseded` | `ngrace graph` refresh / split tooling; skill-described batching |
| MA-06 | Wave- and phase-level verification tiers | `genuinely-missing` | D10: wave-scoped review outcomes as plan-quality signal |
| MA-07 | Profile-gated review strictness | `genuinely-missing` | Depends on MA-02 + transition gates (D14) |

---

## D7 first-pass reconciliation

| D7 row | Map IDs | Outcome vs hypothesis |
|---|---|---|
| `step-N` cursor | DP-06, EX-01, EX-06 | Confirmed `collateral-loss` → D1–D3 |
| Packet excerpts | OP-03, OP-04, EX-07 | Confirmed `superseded` |
| Packet `write-scope` | OP-02 | Confirmed `superseded` |
| Packet `assumptions` | OP-05 | Confirmed covered (`superseded` / partial in D7 → treated as covered by existing surfaces) |
| Expected graph/verification deltas | OP-09, OP-10 | Confirmed `superseded` (delta *documents* OP-11/12 deliberately dropped) |
| Packet composition | OP-01, EX-02 | Confirmed `genuinely-missing` |
| `worker-owns` | DP-09 | Confirmed `superseded` |
| `controller-owns` | DP-08 | Resolved to `superseded` (was "needs audit") |
| `max-fix-attempts` / `replan-trigger` | DP-10, DP-11, OP-06, OP-07 | Confirmed `genuinely-missing` → D9 |
| `CheckpointReport` fields | OP-08, OP-15, DP-12 | Confirmed restored via D1/D6 (`collateral-loss` of the *document*, not the fields) |
| `first-divergent-block` | OP-13, OP-14 | Confirmed `genuinely-missing` → D8 |

### Constructs D7's table did not list (found in sources)

| Map ID | Construct | Why it matters |
|---|---|---|
| DP-04 | Module-level `STATUS` | Explains why restore cannot put status back on `M-*` |
| DP-05 | Ordered DF `step-N` + evidence | Already largely superseded; not in D7's eleven |
| DP-07 / MA-02 | Execution profiles | Real v3 surface; missing from D7 sort |
| OP-11 / OP-12 | GraphDelta / VerificationDelta documents | Explicit non-restore (paraphrase) |
| EX-03 | Scoped per-step review | Bridges to D4 detached reviewer |
| MA-01, MA-03–MA-07 | Wave ownership, batch sync, tiered verification | Multiagent layer beyond sequential D7 list |

**Row count:** 34 constructs (DP-01…12, OP-01…15, EX-01…07, MA-01…07).

**Migrate implication:** `ImplementationOrder` step/phase `status` (DP-06) must become an explicit mapping entry in `ngrace-migrate` rather than silent drop. Packet documents are not recreated as authored XML; field lists map to queries, scopes, ledger events, or future phases as above.
