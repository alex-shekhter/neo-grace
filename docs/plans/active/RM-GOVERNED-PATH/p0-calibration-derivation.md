# RM-GOVERNED-PATH Phase P0 — calibration derivation (P0.8)

**Derived:** 2026-08-10  
**Measuring commit:** `a4b9ce7` (package `6.1.1`)  
**Role:** derivation only — no code changes, no change bundle, no cursor events.

**Precedent shape:** [p0-cursor-derivation.md](./p0-cursor-derivation.md) (accepted for P0.4/0.6/0.10; its P0.8 section is the prior sketch this document supersedes as the dedicated gate).  
**Binding decisions:** D6.1–D6.5, D8.1, D8.4, D8.5 in [decisions.md](./decisions.md).  
**Walls:** Correction 156 (labels stored at fold; never recomputed at report time); A5.2 (default lint does not execute command assertions); A29.2 / F1 (binary writes structural state only, with explicit apply).

---

```
BASELINE
  HEAD: a4b9ce7d7cec64ee38e0aeeb5548ece6964ea127 on docs/rm-governed-path
        — origin/docs/rm-governed-path after git fetch; left-right count 0 0
          (not ahead, not behind the remote tracking branch)
        — origin/main...HEAD left-right → 0 22 (ahead of main; not behind)
  Tree: clean (git status --porcelain empty at start of this pass)
  Version under test: 6.1.1 (package.json; bun run ngrace --version)
  Binary: bun run ./src/grace.ts (script "ngrace"); not the unrelated PATH grace
  lint --path .: 0 errors, 0 warnings (measured)
  doctor --path .: Calibration 2 included, 0 excluded, 3 pending, 1 backfilled
    (matches the task brief)

RETROACTIVE SUBJECT — does recorded evidence exist that the three pending
                      bundles' MustPassCommands later passed?

  Short answer: **No. P0.8 has no retroactive subject in this repository.**
  The step is **purely forward-looking** for adjudication. Historical pendings
  stay pending (D8.4). Scope shrinks accordingly: document the three as permanent
  pending, do not migrate or restate them into pass/fail.

  What was checked (ran, not assumed)
    1. doctor pairs for C-ADOPTION-SURFACE, C-PLAN-QUALITY,
       C-REVIEW-LANGUAGE-SCOPE: each bucket=pending, adjudicatedAt=fold, reason
       text is exactly the not-run absence:
         "MustPassCommand or MustPassBudget evidence was not executed
          (command execution not opted in); complete is not evaluable from
          structural target assertions alone"
    2. Each archive's run-ledger.xml stores:
         <CalibrationAdjudication … outcome="pending" adjudicatedAt="fold"
          reason="MustPassCommand or MustPassBudget evidence was not executed…"/>
       There is **no** sibling CommandRun / CommandEvidence / RunCommand node,
       no exitCode payload, no later Epoch that re-adjudicates them.
    3. Project-wide rg for CommandEvidence | CommandRun | RunCommandEvidence
       under .ngrace/ and src/: **no durable event type exists**. The only
       "command ran" path is live spawnShellCommand in assertions.ts when
       context.runCommands is true — success becomes "no lint issues" and is
       **discarded**, not written to any ledger.
    4. CalibrationRestatements in the corpus: only C-CALIBRATION-PROVENANCE
       restates C-CALIBRATION to adjudicatedAt=backfill (outcome already pass
       on the restated pair via stored adjudication on C-CALIBRATION itself).
       Restatement API (listCalibrationRestatements / recordCalibrationRestatement)
       carries **only** adjudicatedAt + reason — **not** a new outcome. report.ts
       :266–279 keeps outcome="pending" in the pending bucket regardless of
       adjudicatedAt.
    5. Plan TargetAssertions for the three pending list MustPassCommand shells
       (bun test …, validate:ci, etc.). That is the *requirement*, not evidence
       those commands ever ran under opt-in for fold.

  Contrast with P0.8's plan wording (plan.md §2 step 8)
    Plan describes: archived epochs pending *after a final --run-commands
    succeeded* — implying evidence existed and fold failed to consult it.
    Measured: these three are pending because commands were **never opted into
    at fold**. D6.2's phrase *"the command evidence exists; nothing ever
    consults it"* is therefore **half-true as a product description** (live
    re-run with --run-commands would evaluate) and **false as a ledger claim**
    for these archives (nothing durable was recorded). The derivation treats
    the ledger claim as authoritative for retroactive scope.

  Three recently archived integrity bundles (confirm)
    C-TOKEN-INTEGRITY, C-CURSOR-INTEGRITY, C-RECOVER-FOLDABLE:
      - plan.xml has MustPassCommand under TargetAssertions (suite bar)
      - run-ledger.xml: **no** claimedConfidence on any attempt
      - **no** CalibrationAdjudication section
    They add **zero** calibration pairs. Doctor's 2/0/3/1 counts are unchanged
    by their archive. (Authority earlier asserted the opposite; measured false.)

  D8.4 restated against this measurement
    The three historical pendings remain pending permanently. Relabelling them
    to pass because "validate:ci is green today" would be report-time / current-
    tree adjudication wearing a corpus vocabulary — exactly corr 156's ban.
    P0.8 documents that and fixes the **forward** path only.

═══════════════════════════════════════════════════════════════════
DEFECT LOCATION
═══════════════════════════════════════════════════════════════════

  Surface that produces the false (or incomplete) pending
    Primary writer:
      buildCalibrationAdjudicationAtFold  src/grace-cursor.ts:2553–2597
        → evaluateTargetComplete          src/grace-cursor.ts:1505–1542
            hardcodes runCommands: false  :1512
        → on assertion.command-not-evaluated → complete undefined
            → outcome "pending" with the not-run reason :2590–2596
    Assertion gate that forces not-run when opt-in is false:
      evaluateMustPassCommand  src/artifact/assertions.ts:287–301
        if (!context.runCommands) → assertion.command-not-evaluated :288–289
        when runCommands true: spawnShellCommand; success → [] (no durable write)
    Honest reader (not the defect):
      collectCalibrationReport  src/calibration/report.ts:174–310
        :169–172 documents "never calls evaluateTargetComplete (corr 156)"
        :205–224 / :266–279 read stored CalibrationAdjudication only
        pending outcome → bucket pending, reason from stored adj.reason
    Consumer surface:
      ngrace doctor → collectCalibrationReport (src/grace-doctor.ts imports
      and formats it). Reproduced at a4b9ce7: 3 pending with the not-run reason.

  Reader or recorder?
    **Recorder (fold-time recording gap).** The report/doctor surfaces are
    corr-156-correct honest readers of a fold snapshot that never had command
    evidence available because fold never opts into runCommands and nothing
    else records command results into the ledger.

    A "reader fix" that re-called evaluateTargetComplete (with or without
    runCommands) at report time would **violate D6.5 / corr 156**. Do not.

  What was reproduced
    bun run ngrace doctor --path .
      → pending: C-ADOPTION-SURFACE, C-PLAN-QUALITY, C-REVIEW-LANGUAGE-SCOPE
      → reason text matches evaluateTargetComplete :1523–1524 verbatim
    Read-only open of each archive run-ledger.xml → stored outcome="pending"
      adjudicatedAt="fold" (not a report-time invention)
    No further reproduction of "fold after --run-commands" was possible without
      inventing durable evidence that does not exist — that would be a fixture
      for the *forward* design, not a retroactive subject.

  Cursor-derivation line numbers (60c752f) are stale at a4b9ce7
    evaluateTargetComplete is now :1505 (was cited :1087)
    buildCalibrationAdjudicationAtFold is now :2553 (was :2113)
    Semantics unchanged; citations in *this* document use a4b9ce7 lines.

═══════════════════════════════════════════════════════════════════
DESIGN UNDER D6.3(c) — record command-run evidence; adjudicate from records
═══════════════════════════════════════════════════════════════════

  Goal (forward only)
    When an operator (or CI) evaluates MustPassCommand / MustPassBudget with
    explicit opt-in, the **results become durable ledger facts**. At fold, if
    claimedConfidence attempts exist, buildCalibrationAdjudicationAtFold derives
    complete from structural target assertions **plus those records**, still
    writes a single CalibrationAdjudication, and never requires report-time
    evaluateTargetComplete.

  Durable record (proposed shape — plan chooses exact tags)
    Name illustrative: **CommandRunEvidence** (or CommandEvidence), written as:
      - either a root child under the change identity in run-ledger.xml, or
      - a kind of loose run/ event that fold folds into the epoch (preferred if
        it should be membership-dense with the epoch under audit)
    Minimum fields (structural, A29.2-derivable or operator-given):
      - command text (or stable assertion id + command)
      - exitCode
      - evaluatedAt (ISO or event id / wall clock — choose one and stick)
      - source: "lint-run-commands" | "assertions-final" | explicit CLI
      - optional: stderr digest / truncated, cwd relative root
    Writer:
      - the **only** paths that today set runCommands: true must append this
        record when they evaluate MustPassCommand/Budget successfully *or*
        unsuccessfully (both matter for fail labels). Sites measured:
          src/grace-lint.ts runCommands flag → lintGraceProject
          src/lint/core.ts :61, :265
          evaluateMustPassCommand / MustPassBudget in assertions.ts
      - Explicit apply: the CLI flag --run-commands (or assertionMode final with
        runCommands) is the operator act; the binary derives exit codes from the
        spawn it just performed — same family as cursor attempt writing digests.
    Non-writer:
      - fold does **not** spawn commands (reject silent (b) creep).
      - report / doctor do **not** spawn or re-evaluate.

  Fold consumption
    buildCalibrationAdjudicationAtFold (or a helper it calls) becomes:
      1. Run structural target evaluation with runCommands: false **or** a new
         mode "use recorded command evidence only" that treats MustPassCommand
         as satisfied/failed **iff** matching CommandRunEvidence exists for each
         required command with exitCode 0 / non-zero.
      2. If required command assertions have **no** matching records → complete
         undefined → pending with reason that evidence is **absent from ledger**
         (honest; not "not opted in at this process" alone).
      3. If records exist and all pass (and structural assertions pass) → pass.
      4. If any recorded command failed → fail (boolean, not pending).
      5. Still write one CalibrationAdjudication with adjudicatedAt=fold.
    evaluateTargetComplete may stay as the structural helper with runCommands
    false, **plus** a separate join against recorded evidence — or grow an
    option { commandEvidence: "recorded" } that never spawns. Either way, the
    fold path must not call lint with runCommands: true unless D6.3(b) is
    separately decided (D8.5: cost is not that decision).

  Late evidence (after fold) — D6.4
    If CommandRunEvidence is written **after** fold:
      - Do **not** mutate the archived CalibrationAdjudication outcome.
      - Use CalibrationRestatement + backfilled bucket for provenance when a
        *new* boolean outcome is later authorized — **but today's restatement
        API only overrides adjudicatedAt, not outcome**. Forward design must
        either:
          (i) extend restatement to carry optional outcome into the backfilled
              bucket only (never into included), or
          (ii) require that command evidence be recorded **before** fold for
              a boolean label, and treat post-fold evidence as documentary only
              until a restatement schema decision lands.
    Recommendation: **(ii) for v1 of P0.8** — fold requires evidence present;
    post-fold recording is allowed for audit but does not move labels until a
    separate A61 extension is decided. That keeps D6.5 trivial and avoids
    inventing outcome-carrying restatement under time pressure.
    D8.4: do **not** use restatement to "fix" the three historical pendings.

  D6.5 compliance (shown, not asserted)
    - collectCalibrationReport remains free of evaluateTargetComplete (keep
      the :170 comment as a regression string if useful).
    - Fold still **stores** CalibrationAdjudication; report only reads it.
    - No doctor/report path spawns commands or re-lints for labels.
    - Discriminating test: monkeypatch evaluateTargetComplete to throw; doctor
      calibration section still builds from stored pairs (already true today;
      keep it true after the change).

  Cost and D8.5
    Estimated touch:
      - assertions.ts / lint path: write CommandRunEvidence on evaluate
      - grace-cursor.ts: fold join against records; maybe listCommandRunEvidence
      - grammar / types if new root or event kind
      - calibration/report.test.ts, grace-cursor.test.ts, grace-lint.test.ts
    Not a multi-month schema rewrite. **Below the D8.5 stop-and-report line**
    if v1 refuses fold-time spawn (b) and refuses historical migration.
    If implementation discovers evidence must live in a new companion file with
    full grammar + packaging version bump, **stop and report** before shipping —
    that is schema cost the authority owns.

  Rejected for this step (binding)
    - (a) report-time re-eval — forbidden (D6.3)
    - (b) fold-time runCommands without its own decision — not a cost fallback (D8.5)
    - Relabelling the three historical pendings — forbidden (D8.4 / corr 156)
    - Restatement that silently moves pending → included pass — would pool late
      labels into the corpus (corr 161 forbids backfill in included; inventing
      "included after restatement" is worse)

═══════════════════════════════════════════════════════════════════
CONTRADICTIONS (plan vs code / plan vs measured corpus)
═══════════════════════════════════════════════════════════════════

  1. P0.8 plan wording vs measured pending reason
     Plan: pending after final --run-commands **succeeded**.
     Code/corpus: pending because command execution was **not opted in at fold**;
     no durable success record exists.
     → Plan describes a scenario this repo does not have. Scope is forward-only
       (D8.4 already; this derivation confirms the premise).

  2. D6.2 "command evidence exists; nothing ever consults it"
     As a description of **live** --run-commands capability: true (evidence can
     be produced in-process and is thrown away).
     As a description of **ledger** facts for the three pendings: **false** —
     nothing was recorded to consult.
     → Correct D6.2 reading for implementers: the *class* of evidence is not
       durable today; P0.8 makes it durable. Do not assume archives already hold it.

  3. P0.8 "re-derive adjudication from the ledger instead of snapshotting"
     D6.5 already corrects: keep the snapshot; derive it from recorded command
     evidence. Code today snapshots from runCommands:false structural lint only.
     → No further plan edit required if D6.5 is the implementer's brief; the
       phrase remains imprecise and is intentionally not rewritten in place.

  4. CalibrationRestatement cannot lift pending → boolean
     D6.4 points at restatement + backfilled for late evidence. report.ts and
     recordCalibrationRestatement only restate adjudicatedAt=backfill; pending
     outcomes stay pending (:266–279). Extending restatement to carry outcome
     is **not shipped**.
     → Under-specified if someone expects late --run-commands to fix pending
       without fold-time evidence. v1 recommendation: require evidence before fold.

  5. Cursor derivation P0.8 file:line citations (60c752f) vs a4b9ce7
     Semantics hold; line numbers moved. This document re-measured.

  6. What was checked to avoid inventing further contradictions
     - report.ts never imports evaluateTargetComplete (rg)
     - No CommandRun* types in src/ or .ngrace/
     - Three new integrity archives lack claimedConfidence (rg run-ledger)
     - doctor calibration counts match collectCalibrationReport buckets
     - C-LEDGER-READ-ABSENCE is draft-spec only; no ObservedWriteScope yet
     - graph: M-CALIBRATION → src/calibration/report.ts; M-CURSOR → grace-cursor.ts

  Empty contradiction that is a real claim: **corr 156 is not violated by today's
  report path.** The incomplete corpus is a fold-recording problem, not doctor lying.

═══════════════════════════════════════════════════════════════════
FILES TOUCHED / BUNDLE PROPOSAL
═══════════════════════════════════════════════════════════════════

  Expected write set for a single P0.8 bundle (illustrative)
    src/grace-cursor.ts              — fold join; list/write helpers for evidence
    src/grace-cursor.test.ts
    src/artifact/assertions.ts       — emit evidence when runCommands evaluates
    src/artifact/assertions.test.ts  and/or systems-modeling tests
    src/lint/core.ts and/or grace-lint.ts — plumb context so evidence can be written
    src/calibration/report.ts        — only if summary text or pending reason copy changes
    src/calibration/report.test.ts
    src/artifact/grammar.ts / types.ts — **if** new root tag or event kind is required
    docs/plans/active/RM-GOVERNED-PATH/plan.md — board only after execution
    .ngrace/changes/active/C-*/spec.xml plan.xml — the new bundle itself

  Overlap with C-LEDGER-READ-ABSENCE (active, draft spec, no plan)
    That draft owns: wrapperFromLedger three-exit (gates/ledger.ts), plan-quality
    shared read, M-GATES + M-REVIEW.
    P0.8's natural modules: **M-CURSOR**, **M-CALIBRATION**, possibly **M-ARTIFACT-TYPES**
    / grammar if new tags, lint entry for --run-commands write.
    **File-disjoint from C-LEDGER-READ-ABSENCE's stated goals** unless evidence is
    stuffed into gates/ledger.ts (do not). Sequential risk only if both later
    expand into the same grammar file — declare ObservedWriteScope honestly if so
    (F10.2 precedent). No concurrent execution expected while LEDGER remains draft.

  Bundle proposal
    **One bundle:** `C-CALIBRATION-COMMAND-EVIDENCE` (name illustrative).
    Rationale: D8.1 already split P0.8 from cursor integrity; internal shape is
    one recording path + one fold join + tests. Splitting "writer" and "fold join"
    into two bundles would leave doctor still pending between them with no
    intermediate product value. Keep restatement-outcome extension **out** of this
    bundle (non-goal / later decision) so v1 stays small.

  Non-goals for the bundle
    - Migrating or restating the three historical pendings (D8.4)
    - Fold-time runCommands spawn (D6.3(b) without its own decision)
    - Report-time evaluateTargetComplete
    - Making claimedConfidence gate-consumed
    - C-LEDGER-READ-ABSENCE work

═══════════════════════════════════════════════════════════════════
PROPOSED ACCEPTANCE CRITERIA
  (register aligned with archive/C-CURSOR-INTEGRITY/spec.xml — post-conditions a
   wrong implementation cannot satisfy)
═══════════════════════════════════════════════════════════════════

  AC-COMMAND-EVIDENCE-RECORDED
    When ngrace lint (or the designated assertion surface) evaluates a plan's
    MustPassCommand / MustPassBudget with explicit runCommands opt-in, each
    evaluated command leaves a durable CommandRunEvidence (name per plan) on the
    change's ledger or foldable run/ stream, including command identity, exitCode,
    and evaluation source. A path that runs the command and only returns lint
    issues without a durable record fails this criterion. Discriminating negative:
    runCommands false still does not execute commands and does not invent evidence.

  AC-FOLD-ADJUDICATES-FROM-RECORDS
    Given claimedConfidence attempts and CommandRunEvidence covering every
    MustPassCommand/Budget on TargetAssertions with exitCode 0, and structural
    target assertions otherwise clean, fold writes CalibrationAdjudication
    outcome=pass adjudicatedAt=fold. Given at least one recorded non-zero exitCode,
    fold writes outcome=fail. Given missing evidence for a required command, fold
    writes outcome=pending with a reason that names **absent recorded evidence**
    (not a live re-spawn). A fold path that sets runCommands true and spawns shells
    to obtain the label fails this criterion unless D6.3(b) is separately authorized.

  AC-NO-REPORT-TIME-REEVAL
    collectCalibrationReport and ngrace doctor calibration output do not call
    evaluateTargetComplete and do not spawn MustPassCommand. Regression: with
    evaluateTargetComplete instrumented to throw, doctor still emits the calibration
    section from stored pairs. Stored labels are unchanged by later tree edits.

  AC-HISTORICAL-PENDING-UNCHANGED
    After the change, doctor still reports C-ADOPTION-SURFACE, C-PLAN-QUALITY, and
    C-REVIEW-LANGUAGE-SCOPE Epoch-1 as pending with adjudicatedAt=fold (or documents
    them as permanent pending in product text). No automatic restatement or outcome
    rewrite of those three archives. A "fix" that flips them to included pass fails
    this criterion (D8.4 / corr 156).

  AC-D65-FOLD-STILL-STORES
    Fold still writes CalibrationAdjudication when claims exist; report still refuses
    to invent labels when the section is absent. Removing fold-time storage to "fix"
    doctor fails this criterion.

  AC-SUITE-AND-LINT
    bun test for touched packages green; bun run ngrace lint --path . 0 errors
    (authorized scope.durable-overlap only if sequential OWS overlap is declared);
    bun run validate:ci green. Red-first regressions for missing-evidence pending and
    recorded-pass → fold pass.

═══════════════════════════════════════════════════════════════════
OPEN QUESTIONS FOR THE AUTHORITY
═══════════════════════════════════════════════════════════════════

  Q1. Evidence placement: foldable run/ event vs run-ledger companion section?
      **Recommend:** foldable run/ event (or epoch child written at evidence time
      into an open epoch) so fold membership/density rules apply and evidence is
      epoch-scoped. Companion-only sections skip density and are easier to orphan.

  Q2. v1: require evidence before fold for boolean labels, or extend restatement
      to carry outcome into backfilled?
      **Recommend:** require evidence before fold for v1; keep restatement as
      adjudicatedAt-only until a dedicated A61 decision. Avoids outcome-moving
      restatement under P0.8 schedule.

  Q3. Should evaluateTargetComplete grow a recorded-evidence mode, or should fold
      call a new join helper and leave evaluateTargetComplete as pure structural?
      **Recommend:** new join helper used only at fold (and tests). Leaves the
      A5.2-hardcoded function as the structural three-valued core and avoids
      accidental report-time opt-in.

  Q4. Bundle id: C-CALIBRATION-COMMAND-EVIDENCE vs C-P0-CALIBRATION?
      **Recommend:** C-CALIBRATION-COMMAND-EVIDENCE — names the mechanism, not the
      phase step number.

  Q5. Is grammar.ts / artifact version bump in scope if a new tag is required?
      **Recommend:** prefer reusing an existing extensible event/ledger child shape
      if grammar already allows unknown children with validation; if a new root tag
      is required, that is a stop-and-report before packaging (D5.x hygiene), not a
      silent add.

DOCUMENT
  This file: docs/plans/active/RM-GOVERNED-PATH/p0-calibration-derivation.md
```

---

## Summary for the authority

| Question | Answer |
|---|---|
| Retroactive subject? | **No** — no durable command-run evidence for the three pendings |
| Reader vs recorder? | **Recorder** (fold always uses `runCommands: false`) |
| Fits D6? | **Yes**, forward-only shape (c); D8.4 freezes history |
| Bundle | One: `C-CALIBRATION-COMMAND-EVIDENCE` (illustrative) |
| Cost / D8.5 | Implementable without (b); stop if schema explodes |

**Binding reminder:** Correction 156 is a wall. Any design that re-labels stored pairs from the current tree at report time fails this derivation.
