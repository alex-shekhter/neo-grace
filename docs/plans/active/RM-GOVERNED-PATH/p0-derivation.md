# RM-GOVERNED-PATH Phase P0 — derivation against HEAD

**Derived:** 2026-08-09  
**Measuring commit:** `5be480b` (docs-only; source baseline identical to `f340a98` / 6.1.1)  
**Role:** derivation only — no code changes, no `spec.xml` / `plan.xml`.

---

```
BASELINE
  HEAD: 5be480b8aaab4f6f22cb706de6fcac72dd771286 on docs/rm-governed-path
        — origin/main f340a9885048bcf332e4041ae4c35551a1ceed10 after fetch;
        ahead 1, behind 0 (git rev-list --left-right --count origin/main...HEAD → 0 1)
  Source tree: identical to f340a98 for all of src/** (only docs/plans/* differ)
  validate:ci: PASS (exit 0)
    typecheck + bun test + validate:cli + validate-marketplace + validate:examples
    + validate:determinism + validate:packed (packed-cli-smoke ✓)

DELIVERABLE 1 — .filter() inventory
  Scope: every .filter() on authored input in src/artifact/ (non-test) and
  src/project-utils.ts. "Authored input" = multi-value field tokens, id/tag lists
  the author wrote as content, or parse results of authored XML payloads — not
  pure AST navigation that selects a known section tag (e.g. children.filter
  tag==="DurableScope" where unsupported siblings are error-looped separately).

  | file:line | filters what | classification | raising code if paired |
  |---|---|---|---|
  | project-utils.ts:505–507 | LINKS tokens → keep M-* / DF-* only | **silent discard** | — (nothing raises for TYPO-BAD, space-glued tokens, wrong families) |
  | project-utils.ts:508 | DEPENDS tokens → keep M-* only | **silent discard** | — (e.g. `postgres` dropped; green lint) |
  | project-utils.ts:509 | LINKS tokens → keep V-M-* only | **partition companion** of :505; residual non-M/DF/V-M still **silent discard** with :505 | intentional G-11 routing for V-M-*; not a second independent defect for well-formed V-M |
  | project-utils.ts:689 | splitList: drop empty pieces and case-insensitive `none` | **paired-with-an-error-path** / justified sentinel | F3: `none` means empty list; empty after split is cleanup. Preserve per D5/F3 |
  | project-utils.ts:304 | near-miss comment body `split(/\s+/).filter(Boolean)` | out of class (heuristic intermediate, not multi-value field keep-list) | near-miss path emits `markup.near-miss-marker` when it fires |
  | project-utils.ts:627 | MODULE_MAP blank lines | blank-line skip, not token integrity | — |
  | project-utils.ts:831–833 | symbolName presence / set-diff for map parity | comparison machinery, not token drop of labels | `markup.module-map-mismatch` when expected≠listed |
  | projections.ts:418 | `<Owns>` child tags → keep those matching ownsPredicate | **silent discard** | — invalid child tags raise nothing; text-in-Owns never enters this filter (see P0.5) |
  | projections.ts:369 | GraphDocuments children → GD-* only | **silent discard** | — non-GD siblings under GraphDocuments raise nothing (reproduced) |
  | projections.ts:382 | VerificationDocuments children → VD-* only | **silent discard** | — same class as :369 |
  | projections.ts:560 | Step children → M-* modules | **paired-with-an-error-path** | projections.ts:561–570 when modules.length ≠ 1 → `projection.graph.invalid-data-flow-step` |
  | projections.ts:576 | Contract children → IC-* | **paired-with-an-error-path** | projections.ts:583–590 when count wrong |
  | projections.ts:516–518 | bare M/DF participants when Steps present | **paired-with-an-error-path** | projections.ts:519–527 mix error |
  | projections.ts:487 | walk tags → graph anchors for links | structural harvest of nested tags, not multi-value string field | dangling-link later if id missing from graph |
  | projections.ts:900 | empty evidence node text | empty cleanup after collect | — |
  | grammar.ts:1028 | Allocation nodes → drop parseAllocation null | **silent discard** | no dedicated invalid-allocation code; secondary `ledger.event-outside-allocation` only if events remain |
  | grammar.ts:1033 | Event nodes → drop parseLedgerEvent null | **silent discard** | same pattern |
  | grammar.ts:997 | EscalatedTask text → drop empty strings | **silent discard** | empty `<EscalatedTask>` raises nothing (reproduced) |
  | grammar.ts:1434 | ImplementationPlan children → T-* only | **silent discard** of non-task siblings | no error for e.g. `<Note>` under ImplementationPlan (reproduced) |
  | grammar.ts:1462 / 1478 / 1493 | supported children of assertion/scope sections | **paired-with-an-error-path** | same blocks loop all children and raise `change.plan-invalid-section-shape` for unsupported tags |
  | grammar.ts:1972 / 1980 | Criterion/Command with non-empty text | **paired-with-an-error-path** | empty-all → `change.task-empty-acceptance` / `change.task-empty-verification` |
  | grammar.ts:2012 | DependsOn child text → drop empty | empty cleanup before validation | invalid non-empty text → `change.task-invalid-dependency` at :2018 |
  | grammar.ts:2269 | attribute value split candidates | detection helper for illegal anchors-in-attributes | used to raise, not to keep a list |
  | assertions.ts:231 | MustPassCommand strings matching --assertions current | select-for-error | maps to `assertion.phase-incompatible-command` |
  | assertions.ts:489–490 | AppliesTo targets → M vs DF partition | not discard of unknowns | loadInvariants (loop, not .filter) already only keeps M/DF; grammar `context.invariants.invalid-applies-to` pairs at author time |
  | paths.ts:99 | path segments "" and "." | path normalize | — |
  | scope.ts:230–232, 496, 506 | dirents / status / set intersection | filesystem or set algebra | — |
  | xml.ts:143 / remaining grammar children.tag filters | AST section selection | navigation | often paired with cardinality or shape errors elsewhere |

  **Known three (review.md §4.2 + tests documenting filter):**
  project-utils.ts:505, :508, :509 (with splitList only-comma at :689).

  **Additional silent discards the sweep must not miss:**
  projections.ts:418 (Owns), :369, :382 (index document lists);
  grammar.ts:1028, :1033 (ledger parse nulls), :997 (empty EscalatedTask),
  :1434 (non-task under ImplementationPlan).

  Totals (authored-input class only, excluding pure AST navigation and select-for-error):
    **paired-with-an-error-path / justified:** 8
      (splitList none/empty; Step modules; Contract IC; bare-vs-Step;
       durable/assertion supported-child filters; empty Criterion/Command)
    **silent discard:** 10
      (LINKS M/DF, DEPENDS M, LINKS residual via 505∪509, Owns children,
       GD list, VD list, Allocation null, Event null, empty EscalatedTask,
       ImplementationPlan non-task)
    **partition companion (not a third independent defect):** 1
      (linkedVerificationIds :509)

DELIVERABLE 2 — per-item verification

  P0.1 The .filter() sweep
    Verdict: CONFIRMED — exhaustive rg of .filter( in scope; classified above.
      Inventory is this document §Deliverable 1.
    Functions to change: every silent-discard site above (convert or written
      justification). Primary: parseGovernedFile / splitList (project-utils.ts),
      routeFromOwnerNode (projections.ts:387), readGraphRoutes / readVerificationRoutes,
      parseAllocation / parseLedgerEvent (grammar.ts:1093/1103), validatePlanTask /
      validateImplementationTasks, cursorEscalatedTasks.
    Files touched: inventory artifact in change bundle; then each silent site's
      production file + co-located tests (see bundles). This step is the review gate
      document, not a single code edit.

  P0.2 LINKS / DEPENDS multi-value + unparsed token error
    Verdict: CONFIRMED — runtime:
      - `LINKS: M-A M-B` → linkedModuleIds=[] (space not a separator)
      - `LINKS: M-A; M-B` → [] (semicolon not a separator)
      - `LINKS: M-A, TYPO-BAD, M-B` → [M-A, M-B] (typo silent)
      - `DEPENDS: M-DB, postgres, M-CACHE` → [M-DB, M-CACHE]
      - splitList (project-utils.ts:684) splits on `,` only; strips `[...]`; drops none
      - exactly two callers: parseGovernedFile :496 and :508 (F3 holds)
    Functions: splitList (project-utils.ts:684), parseGovernedFile (:494–510),
      analyzeGovernedFile if errors attach there; new issue code registration in
      lint/catalog.ts (+ emission if needed).
    Files: src/project-utils.ts, src/project-utils.test.ts, src/lint/catalog.ts
      (and catalog tests), possibly src/query/render.ts only if message surfaces
      via file query (not required for error emission).

  P0.3 DependsOn multi-value
    Verdict: CONFIRMED — `<DependsOn>T-001, T-000</DependsOn>` yields one issue:
      change.task-invalid-dependency "T-002 dependency 'T-001, T-000' must be a
      canonical T-NNN identifier." Entire text node treated as one token
      (grammar.ts:2010–2018). Child `<Task>T-001</Task>` form still works.
    Functions: validatePlanTask (grammar.ts:1955) dependency block :2005–2028;
      message rewrite for change.task-invalid-dependency; lint/catalog entry.
    Files: src/artifact/grammar.ts, src/artifact/grammar.test.ts, src/lint/catalog.ts
      (+ catalog tests if present for this code).

  P0.4 Numeric epoch bounds
    Verdict: CONFIRMED — real CLI:
      `bun run ngrace cursor advance --open-epoch --from T-001 --to 99`
      exit 0; writes `run/NaN-T-001-opened.xml`:
      `<NgraceRunEvent … id="NaN" …><Allocation worker="w0" from="NaN" to="99" />`
      Site: grace-cursor.ts:2622–2623
      `from: context.args.from ? Number(context.args.from) : undefined`.
      Number("T-001") === NaN reproduced.
      **Nuance vs review.md §4.3:** fold after this write fails with
      "No loose run/ events to fold for C-*" because listLooseEvents (:470)
      skips non-integer ids — not with "no Allocation found". The Allocation
      NaN is on disk; the event is invisible to fold. "no Allocation found"
      is the separate no-open path (P0.6).
    Functions: advance command run closure (grace-cursor.ts:2612–2635);
      optionally advanceCursor (:524) if validation should be central; parse path
      for allocation writes (:2413 area).
    Files: src/grace-cursor.ts, src/grace-cursor.test.ts.

  P0.5 Owns text-vs-tag diagnosis
    Verdict: CONFIRMED — `<Owns>M-EXAMPLE</Owns>` (text, no child tags) →
      projection.graph.unlisted-anchor "M-EXAMPLE is present but missing from
      graph index." owns list empty because only children are collected
      (projections.ts:416–419). Invalid child `<NotAnAnchor />` under Owns →
      **zero issues** (silent filter at :418).
    Functions: routeFromOwnerNode (projections.ts:387), possibly callers
      readGraphRoutes / readVerificationRoutes; new or specialized issue code;
      catalog entry.
    Files: src/artifact/projections.ts, src/artifact/projections.test.ts,
      src/lint/catalog.ts (if new code is explainable via lint catalog).

  P0.6 Cursor recovery
    Verdict: CONFIRMED —
      - fold with loose progress, no opened: "Cannot fold …: no Allocation found
        (emit an opened event with Allocation children first)." (foldEpoch :680–686)
      - no `recover` / `recoverCursor` export; no CLI `cursor recover` (rg empty)
      - advance/attempt/fold do not auto-synthesize opened for single-controller
      - listLooseEvents also silently skips NaN-id files (:470) — recovery surface
        should diagnose orphan run/* files
    Functions: foldEpoch (:645), advanceCursor (:524), recordAttempt (:1327),
      new recover command + helpers; CLI defineCommand block near :2540+.
    Files: src/grace-cursor.ts, src/grace-cursor.test.ts; possibly src/grace.ts
      if command registration is separate (cursor is in grace-cursor.ts today).

  P0.7 Verdict diagnostics
    Verdict: CONFIRMED as **message / diagnostics defect, not a race** —
      Reproduction attempt:
      1. recordReviewVerdict then immediate readLatestReviewVerdict + evaluateApplyGate
         → state present, apply decision permit, no gate.apply.no-verdict.
      2. 50 sequential write-then-apply on fresh temp projects → 0 race hits.
      3. writeAndVerifyLedger (gates/ledger.ts:215) uses writeFileSync then
         synchronous re-read validation — no async gap.
      4. Absent verdict: requirement message is exactly "no Verdicts section entry"
         (gates/core.ts:275); guideIssue message is title only unless detail passed
         (gate.apply.no-verdict at :277 has no detail). Does not report path,
         entry count, or newest-reject reason.
    Functions: evaluateApplyGate (gates/core.ts:238), guideIssue path for
      gate.apply.no-verdict (:277), GATE_CATALOG entry (gates/catalog.ts:58),
      optionally readLatestReviewVerdict / readLedgerVerdictsSurface for richer
      absence detail (gates/ledger.ts).
    Files: src/gates/core.ts, src/gates/catalog.ts, src/gates/core.test.ts;
      ledger.ts only if absence detail is structured there.

  P0.8 Calibration backfill / pending after fold
    Verdict: CONFIRMED mechanism —
      buildCalibrationAdjudicationAtFold → evaluateTargetComplete hardcodes
      runCommands: false (grace-cursor.ts:1091–1094). Any MustPassCommand at fold
      → complete undefined → outcome "pending" stored on CalibrationAdjudication.
      collectCalibrationReport (calibration/report.ts:174) reads only stored
      adjudications — "never calls evaluateTargetComplete". Reproduced: fold with
      claimedConfidence + MustPassCommand → doctor/calibration text shows
      pending with reason about command execution not opted in. Dogfood report
      also has pending archived epochs with the same reason class.
      Plan asks: do not report archived epochs as pending after a final
      --run-commands succeeded; re-derive from ledger instead of snapshotting.
      (Whether "re-derive" means report-time re-eval with runCommands, or fold-time
      run, or ledger of actual command results — open for authority if ambiguous.)
    Functions: buildCalibrationAdjudicationAtFold (:2113), evaluateTargetComplete
      (:1087), collectCalibrationReport (calibration/report.ts:174),
      formatCalibrationText; grace-doctor.ts consumer.
    Files: src/grace-cursor.ts, src/calibration/report.ts, src/calibration/report.test.ts,
      src/grace-doctor.ts if output shape changes, grace-cursor tests for fold
      adjudication.

  P0.9 Mode-aware lint summary
    Verdict: CONFIRMED — active plan with BaselineAssertions MustNotExist M-EXAMPLE
      produces assertion.MustNotExist error; formatTextReport (lint/core.ts:512)
      leads with counts and raw issues only — no "N baseline expectations (expected
      while C-* is in progress)" line. /baseline expectation|expected while/ absent.
    Functions: formatTextReport (lint/core.ts:512), possibly lintGraceProject to
      tag baseline-sourced issues; grace-lint.ts writeResult (:51) if routing needed.
    Files: src/lint/core.ts, src/lint/core tests or src/grace-lint.test.ts,
      src/lint/types.ts if result gains baselineExpectationCount.

DELIVERABLE 3 — contradictions

  1. review.md §4.3 says after `--from T-001`, fold fails with "no Allocation found".
     At 5be480b/f340a98 source, fold fails with "No loose run/ events to fold for C-*"
     because listLooseEvents skips id=NaN (grace-cursor.ts:470). The NaN Allocation
     is still written. "no Allocation found" is the true message for loose events
     without any opened Allocation (P0.6), not for the NaN-id orphan file case.
     Settled by: grace-cursor.ts:470, :680–686; CLI reproduction output.

  2. review.md / plan treat three silent filter sites as the known set; the sweep
     finds additional silent discards in scope (Owns children, GD/VD index filters,
     ledger parseAllocation/Event null filters, empty EscalatedTask, non-task
     ImplementationPlan children). Not a plan falsehood — the plan anticipates
     exactly this — but step 1's conversion set is larger than steps 2+3+5 alone.
     Settled by: inventory above; projections.ts:418; grammar.ts:1028/1033/997/1434.

  3. decisions.md frontmatter still says plan is `draft` and `normative: false`
     while plan.md is `status: approved` and docs/plans/README.md says approved
     2026-08-09. Documentation drift only; plan wins per its own authority line.
     Settled by: decisions.md:3–20 vs plan.md:4 / README.md:16–18.

  none of the P0 step *objectives* are STALE (code paths still exist at the cited
  functions). Only the fold error string for the NaN sequence is imprecise.

DELIVERABLE 4 — bundle split

  Proposal confirmed with one expansion note:

  C-TOKEN-INTEGRITY — steps 1, 2, 3, 5  (+ silent-discard conversions from the
    inventory that live under src/artifact/ and src/project-utils.ts and are not
    cursor/gate/lint-summary)
    Files (expected):
      src/project-utils.ts, src/project-utils.test.ts
      src/artifact/grammar.ts, src/artifact/grammar.test.ts
      src/artifact/projections.ts, src/artifact/projections.test.ts
      src/lint/catalog.ts (+ catalog tests)
      inventory deliverable inside the change bundle (or plan-adjacent doc)
      CHANGELOG entry for new error codes (release surface D5.4)
    Independent of other two: **yes**, if inventory conversions in grammar ledger
      parse paths are kept here and not deferred into C-CURSOR.

  C-CURSOR-INTEGRITY — steps 4, 6, 8
    Files:
      src/grace-cursor.ts, src/grace-cursor.test.ts
      src/calibration/report.ts, src/calibration/report.test.ts
      src/grace-doctor.ts (if doctor text changes)
    Independent: **yes** from token and report bundles.
    Internal shared-function constraint: steps 4, 6, and 8 all edit
      grace-cursor.ts — keep as one bundle (as proposed). Do not split 4/6/8
      across PRs without sequencing: advanceCursor / foldEpoch /
      buildCalibrationAdjudicationAtFold / listLooseEvents / CLI command table
      sit in one file.

  C-REPORT-HONESTY — steps 7, 9
    Files:
      src/gates/core.ts, src/gates/catalog.ts, src/gates/core.test.ts
      src/lint/core.ts, src/grace-lint.test.ts (or lint unit tests)
      optionally src/gates/ledger.ts if absence detail is structured on read
    Independent: **yes** — no shared functions with the other two bundles.
    evaluateApplyGate vs formatTextReport are disjoint.

  Shared-function constraints across bundles: **none** for production functions
    if the inventory's grammar ledger parse null-filters stay in C-TOKEN and are
    not also claimed by C-CURSOR. listLooseEvents (cursor) is a separate silent
    skip of NaN ids — belongs with P0.4/P0.6 (C-CURSOR), not the artifact filter
    inventory, because it is outside src/artifact/ and project-utils.ts.

  Sequencing: any order, or concurrent. Prefer C-TOKEN first only because its
    inventory review gate is the phase definition of done for "class fix".

OPEN QUESTIONS FOR THE AUTHORITY

  1. P0.8 "re-derive adjudication from the ledger instead of snapshotting":
     does that mean (a) report-time re-call of target assertions possibly with
     runCommands, (b) fold-time runCommands when claims exist, (c) store
     command-run evidence events and adjudicate from those records only, or
     (d) treat pre-fix pending snapshots as backfilled/excluded? The code
     today hard-forbids re-eval at report time by design (corr 156 comments).

  2. Should inventory silent discards outside steps 2/3/5 (GD/VD index filters,
     ledger Allocation/Event null parse, empty EscalatedTask, ImplementationPlan
     non-task children) all convert in C-TOKEN-INTEGRITY P0, or may some carry
     a written "leave silent" justification for a later phase?

  3. listLooseEvents skipping non-integer ids (orphan NaN-*.xml) is outside the
     stated inventory paths but is load-bearing for P0.4/P0.6 recovery UX —
     confirm it is in C-CURSOR scope (recommended: yes).
```
