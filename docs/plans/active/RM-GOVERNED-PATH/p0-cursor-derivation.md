# RM-GOVERNED-PATH Phase P0 — cursor integrity derivation (P0.4 / P0.6 / P0.8 / P0.10)

**Derived:** 2026-08-10  
**Measuring commit:** `60c752f` (package `6.1.1`)  
**Role:** derivation only — no code changes, no change bundle, no cursor events.

**Precedent shape:** [p0-derivation.md](./p0-derivation.md) (accepted).  
**Binding decisions:** D6, F8, F8.1, F9, F9.2, F9.3 in [decisions.md](./decisions.md).  
**Walls:** A29.2 / F1 (binary writes structural state only); Correction 156 (labels stored at fold).

---

```
BASELINE
  HEAD: 60c752f03190040da28960699d91035c13c96275 on docs/rm-governed-path
        — origin/main after fetch; ahead 5, behind 0
          (git rev-list --left-right --count origin/main...HEAD → 0 5)
  Tree: clean (git status --porcelain empty)
  Version under test: 6.1.1 (package.json; bun run ngrace --version)
  Binary: bun run ./src/grace.ts (script "ngrace"); not the unrelated PATH grace
  Fixture preserved: .ngrace/changes/active/C-TOKEN-INTEGRITY/run/NaN-T-001-opened.xml
        (untouched — F8.1 acceptance fixture; no recover/fold/rm/hand-edit)

DELIVERABLE — per-step verification

═══════════════════════════════════════════════════════════════════
P0.4 — Numeric epoch bounds
═══════════════════════════════════════════════════════════════════

  Plan claim
    Validate --from / --to before Number(). Message names accepted form and states
    that task ids are not event ids.

  What the code does
    CLI only user-facing coercion site for allocation bounds:
      src/grace-cursor.ts:2622–2623
        from: context.args.from ? Number(context.args.from) : undefined
        to:   context.args.to   ? Number(context.args.to)   : undefined
      No isInteger / positive / from≤to check. openEpoch path then uses the number
      as-is (advanceCursor :546–549): worker defaults to "w0"; from defaults to 1;
      to defaults to from+98 when omitted.
    writeEventFile (:2410) builds filename `${event.id}-${task}-${kind}.xml` and
      id attribute via String(event.id) — so NaN → "NaN-T-001-opened.xml" /
      id="NaN"; float 1.5 → "1.5-T-001-opened.xml".
    listLooseEvents discovery:
      EVENT_FILENAME = /^(\d+)-(T-[0-9]{3})-(.+)\.xml$/  (:437)
      Non-matching names (NaN-…, 1.5-…) are dropped at :459–460 — never reach :470.
      :470  if (!Number.isInteger(id) || id <= 0) continue  — second silent skip for
      ids that match the filename pattern but fail integer/positive checks (e.g.
      hand-edited id="0" under a \d+ name, or XML id disagreeing with name).
    parseAllocationNode (:2039–2044): rejects non-integer from/to and from>to by
      returning null (silent null; collectAllocations then has no range).
    nextEventId (:2449–2453): uses listLooseEvents only — orphan NaN files do not
      reserve ids; progress after a NaN open starts at 1 (reproduced).
    status epochs (src/grace-status.ts:193, :210–218): countLedgerEpochs counts
      folded Epoch-N sections in run-ledger.xml only. It does not call
      listLooseEvents. Open (unfolded) epochs never appear in epochCount.

  User-supplied id coercion inventory (CLI)
    | surface | user args | coercion | validation today |
    |---|---|---|---|
    | cursor advance --open-epoch | --from, --to | Number() :2622–2623 | none |
    | cursor advance | --task | string; ANCHOR_PATTERNS.task in advanceCursor :593 | task only |
    | cursor attempt / pause / resume / VU | --task | same pattern | task only |
    | other cursor commands | no event-id bounds | — | — |
    Disk readers (listLooseEvents, parseAllocation, ledger event ids) coerce stored
    attributes with Number(); they are not user CLI entry points for P0.4, but they
    define what a valid written bound must be.

  What was reproduced (temp fixtures + dogfood; C-TOKEN ledger not modified)
    CLI (temp project):
      bun run ngrace cursor advance --path $TMP --change C-TEST --task T-001 \
        --open-epoch --from T-001 --to T-001
      → exit 0; "Epoch: 1" "State: in-progress"
      → run/NaN-T-001-opened.xml:
        <NgraceRunEvent … id="NaN" … kind="opened">
          <Allocation worker="w0" from="NaN" to="NaN" />
      then progress → 1-T-001-progress.xml
      then fold → exit 1:
        "Cannot fold C-TEST: no Allocation found (emit an opened event with
         Allocation children first)."
      lint on $TMP → 0 errors (corrupt run event invisible to integrity).
    Library bounds matrix (advanceCursor openEpoch, then listLooseEvents):
      | input from/to | written file | listLoose sees | allocation collected |
      |---|---|---|---|
      | T-001 via Number → NaN | NaN-T-001-opened.xml | 0 | — |
      | 1.5, 10 | 1.5-T-001-opened.xml | 0 (filename regex) | — |
      | 0, 10 | 1-…-opened (id floor) | 1 | from=0 to=10 (accepted!) |
      | -1, 10 | 1-…-opened | 1 | from=-1 to=10 (accepted!) |
      | 5, 3 | 5-…-opened | 1 | [] (parseAllocation null) |
      | 1, 10 | 1-…-opened | 1 | from=1 to=10 |
    Dogfood C-TOKEN-INTEGRITY (read-only):
      listLooseEvents → 18 events ids 1–18; kind opened absent
      fold → "no Allocation found …"
      status → epochs=0, ready-to-execute; cursor show → Epoch 1, in-progress
      lint → 0 errors
    Healthy open epoch (from=1 to=10 + progress) also has status epochCount
      undefined/0 while run.xml says Epoch 1 — same status design, independent
      of the NaN skip.

  Classification vs plan
    **Correct but under-specified.**
    - The defect and the fix target (validate before Number / refuse non positive
      integers) are real and confirmed.
    - Plan (and F8 / review.md §4.3) attribute the invisible NaN file solely to
      listLooseEvents :470. For the live F8 artifact `NaN-T-001-opened.xml`, the
      **primary** drop is EVENT_FILENAME :437/:459 (`\d+` does not match `NaN`).
      :470 is a real second silent path and still belongs in scope.
    - F8's "status epochs=0 vs run.xml epoch 1" is real on C-TOKEN, but it is
      **not** a third consumer of the skip logic: status never counts open epochs.
      Input validation alone does not make status agree with run.xml for a healthy
      open epoch either.
    - Bounds validation must also reject 0, negatives, non-integers (float), and
      from>to — not only NaN/task-id forms — or silent half-valid allocations remain.

  Is input validation sufficient, or must the reader stop skipping silently?
    **Both.**
    1. **CLI / advanceCursor validation (P0.4 proper):** sufficient to stop *new*
       corrupt opens. Message must name positive integer event ids and that task
       ids (T-NNN) are not event ids.
    2. **Reader honesty (shared with P0.6):** listLooseEvents must not silently
       drop discoverable run/* files. At minimum recover (and preferably fold /
       doctor) must readdir the full run/ inventory and surface:
         - names that fail EVENT_FILENAME
         - names that parse but fail :470 integer/positive checks
         - opened events whose Allocation children parse to null
       Without (2), the F8.1 fixture remains invisible to the machinery that is
       supposed to repair it, and any pre-existing corrupt file stays a green hole.

  Verdict: **correct but under-specified**

  Files touched (expected)
    src/grace-cursor.ts (CLI advance validation; preferably advanceCursor guard so
      library callers cannot write NaN either; listLooseEvents / orphan diagnosis
      may land here or with P0.6 — see split)
    src/grace-cursor.test.ts
    (no calibration, no review, no C-TOKEN production scope files)

═══════════════════════════════════════════════════════════════════
P0.6 — Cursor recovery
═══════════════════════════════════════════════════════════════════

  Plan claim (two parts)
    1. Auto-open for single-controller runs: advance/attempt/fold with loose
       events, no open epoch, and no --worker ever recorded for this change
       synthesizes a retroactive opened spanning loose ids; if any explicit
       --worker appears, refuse and demand explicit epoch.
    2. cursor recover --change C-ID: diagnose loose events, unterminated ranges,
       out-of-allocation events; --fix extend-allocation is a recorded,
       ledger-visible repair. Deleting run/ stops being documented recovery.

  What the code does
    foldEpoch :680–686 throws when collectAllocations(events) is empty:
      "Cannot fold ${changeId}: no Allocation found (emit an opened event with
       Allocation children first)."
    collectAllocations :2047–2049 = flatMap opened.allocations only.
    validateEventsAgainstAllocations :2052+ (membership + density) runs only after
      allocations exist — fold owns validation (A11.2).
    No recover command: cursor CLI subcommands are show|regenerate|advance|attempt|
      verification-unavailable|pause|resume|fold (grace-cursor.ts cursor --help).
    No auto-open on advance/attempt/fold (rg empty for synthesize / auto-open /
      recoverCursor).
    Default worker: options.worker ?? "w0" (:549). Every written Allocation carries
      worker="w0" whether or not the operator passed --worker. There is no durable
      "worker was explicit" bit.
    Documented recovery folklore: review.md §4.3 / F8.1 — rm -r run/ is the corpus
      remedy today; lint catalog points at cursor recovery "when available".

  A29.2 / F1 wall (binary writes only structural state it can derive or is
  explicitly given, never authored content, and never without an explicit apply)

    Cursor advance / attempt / openEpoch already write on command invocation
    (no separate --apply). The reliability track's "explicit apply" for this
    surface is the invocable write command itself (regenerate is the dry-run/
    --apply cousin). Precedent: graph split --apply for structural rewrites.

    | write | side of the line | why |
    |---|---|---|
    | Auto-open synthesized `opened` + Allocation spanning min..max loose integer ids | **Permitted** | Bounds are **derived** from existing event inventory; worker default w0 only when no multi-worker evidence; operator act is advance/attempt/fold that triggers synthesis. Not authored prose. |
    | recover --fix extend-allocation (or create covering allocation) | **Permitted** | Operator passes explicit --fix (apply-class); new Allocation bounds **derived** from loose integer ids / gaps. Recorded as a new ledger-visible opened (or equivalent structural event). |
    | Inventing multi-worker partitions, rewriting attempt outcomes, deleting events, inventing an id for NaN | **Forbidden** | Authored or destructive; multi-worker ranges must not be fabricated (plan); deleting run/ is the antipattern F8.1 forbids. |

    Neither part requires widening A29.2 / F1. If implementation cannot derive the
    allocation without inventing worker topology, it must refuse (already the plan's
    multi-worker rule) rather than widen the wall.

  The F8.1 fixture — hardest judgment
    Live file (untouched):
      run/NaN-T-001-opened.xml
      id="NaN" Allocation worker="w0" from="NaN" to="NaN"
    Plus valid loose events 1–18 (progress/attempt mix); run.xml Epoch 1 in-progress;
    run-ledger.xml has Decisions only (no Epoch-N).

    Can --fix extend-allocation *honestly* repair this ledger?
    **Not by extending the NaN allocation** — there is no recoverable numeric range
    on that event (parseAllocationNode returns null; listLooseEvents does not see
    the file). Claiming to "extend" NaN would be a lie.

    Honest repair requirements:
    1. **Diagnose the NaN file as unrecoverable orphan** (name/id not a positive
       integer event id). Do not invent an id for it. Do not delete it (F8.1 /
       no rm -r run/). Leave it on disk as evidence of the P0.4 bug.
    2. **Write a new, valid opened event** (or equivalent structural repair record)
       with Allocation covering the **valid** loose integer ids actually present
       (here from=1 to=18, or from=1 to=max(used) per density rules). That is
       "create covering allocation", not "extend NaN". Naming --fix
       extend-allocation is acceptable as the operator-facing verb only if the
       diagnosis text says when no prior valid allocation existed.
    3. **Single-controller gate:** fixture's NaN opened used default w0; valid
       events carry no worker attribute. Treat as no *explicit multi-worker*
       topology — auto-open / recover may proceed with w0. (See open question:
       explicit vs default worker is under-specified in code.)
    4. After (2), fold can validate membership for events 1–18. Orphan NaN-*
       remains reported by recover until a future quarantine policy exists;
       fold must not require the orphan to be a member of the allocation.
    5. **Honestly does not mean** rewriting attempt WriteEvidence, staging reds
       (F9.1), or hand-editing Allocation attributes.

    Summary: --fix can repair *foldability of the valid 1–18 stream* by a
    recorded covering allocation; it cannot and must not "heal" the NaN event
    into a normal member of that stream.

  What was reproduced
    fold on C-TOKEN-INTEGRITY → no Allocation found (work events present).
    listLooseEvents → 18 ids, no opened.
    readdir run/ → NaN-T-001-opened.xml present (orphan relative to listLooseEvents).
    No `cursor recover` in CLI help.
    Temp: open without Allocation (inverted 5>3) → opened visible, allocations [],
      fold still "no Allocation found".

  Verdict: **correct but under-specified**
    Objectives confirmed. Gaps to resolve before implementation:
    - "no --worker ever recorded" vs always-written default w0
    - extend-allocation vs create-covering for zero valid allocations
    - orphan discovery must not depend only on listLooseEvents
    - auto-open trigger surfaces (advance vs attempt vs fold) and idempotency
      when a valid opened already exists

  Files touched (expected)
    src/grace-cursor.ts (recover command, diagnosis, auto-open, orphan scan;
      shared listLooseEvents honesty with P0.4)
    src/grace-cursor.test.ts
    skills/ngrace/ngrace-execute/SKILL.md and/or ngrace-cli / recovery.md only if
      documented recovery currently says delete run/ (skill prose; may be
      C-CURSOR or follow-up — flag for authority)
    Possibly src/lint/catalog.ts if recover emits new issue codes via lint —
      **overlap risk with C-TOKEN** (catalog is in C-TOKEN OWS). Prefer cursor-
      local errors (GraceCommandError) over new lint codes if orderability matters.

═══════════════════════════════════════════════════════════════════
P0.8 — Calibration backfill
═══════════════════════════════════════════════════════════════════

  Plan claim
    Doctor must not report archived epochs as pending MustPassCommand adjudication
    after a final --run-commands succeeded; re-derive adjudication from the ledger
    instead of snapshotting. **Bound by D6.**

  D6 restated (binding)
    - Labels stored at fold; never recomputed at report time (corr 156).
    - No report-time call to evaluateTargetComplete.
    - Derive fold snapshot from **recorded command evidence**, not runCommands:false
      structural lint alone.
    - Late evidence: CalibrationRestatement + backfilled bucket (corr 161).
    - If design cannot fit, stop and report.

  What the code does
    buildCalibrationAdjudicationAtFold (grace-cursor.ts:2113–2157):
      if any claimedConfidence attempts → evaluateTargetComplete(projectRoot, changeId)
      evaluateTargetComplete (:1087–1124) hardcodes runCommands: false (:1094)
      MustPassCommand → assertion.command-not-evaluated → complete undefined →
      outcome "pending" with reason about command execution not opted in.
    collectCalibrationReport (calibration/report.ts:174+):
      reads only stored CalibrationAdjudication; comment :169–172 "never calls
      evaluateTargetComplete (corr 156)". Buckets included|excluded|pending|backfilled (:82).
    listCalibrationRestatements (:1720): supersedes adjudicatedAt to backfill only;
      does **not** change outcome.
    report.ts:266–279: pending outcome **stays pending** regardless of adjudicatedAt.
    No CommandResult / durable MustPassCommand evidence event type exists in src/.
    evaluateMustPassCommand (assertions.ts:287) runs only when context.runCommands
      and discards success to "no issues" — nothing is written to the ledger.

  False "pending" surface
    **ngrace doctor → Calibration section** (formatCalibrationText over
    collectCalibrationReport). Reproduced on this repo at 60c752f:

      pending (no durable boolean outcome): 3
      pairs:
        C-ADOPTION-SURFACE Epoch-1 … reason=MustPassCommand … not opted in
        C-PLAN-QUALITY Epoch-1 … same
        C-REVIEW-LANGUAGE-SCOPE Epoch-1 … same

    Each archive's run-ledger.xml stores CalibrationAdjudication outcome="pending"
    adjudicatedAt="fold" with that reason. Doctor is an honest reader of a dishonest
    (or incomplete) fold-time snapshot — not a report-time recompute bug.

  Reader change vs fold-time recording gap?
    **Fold-time recording gap** (primary). Report-time reader is already corr-156-
    correct. Fixing the reader to re-call evaluateTargetComplete would **violate D6**.
    Required shape inside D6:
      (c) record command-run evidence as durable structural facts when
          --run-commands actually evaluates MustPassCommand / MustPassBudget;
          at fold, adjudicate from those records (and structural assertions),
          still writing CalibrationAdjudication once.
      (b) fold-time runCommands: true is D6-permitted but not preferred (re-opens
          A5.2 cost / side effects); still stores a label once — does not break 156.
      (d) restatement/backfill for evidence after fold — **partially** already
          shipped for pass|fail → backfill provenance; **cannot** lift pending →
          pass today (report keeps pending; restatement does not write outcome).

  Does P0.8 fit inside D6?
    **Yes**, for the **forward** path: either (b) or (c) at fold; never report-time
    evaluateTargetComplete; keep stored CalibrationAdjudication.
    **Under-specified for the three existing pending archives:** without a way to
    record a new outcome (or a restatement that carries outcome), doctor will keep
    reporting those three pending even after a perfect forward fix. Historical
    repair needs an authority-sanctioned mechanism (extend restatement to carry
    outcome into backfilled, or accept permanent pending for pre-fix folds).
    That is not a D6 violation to report as "stop" — it is a scope boundary.

  Verdict: **correct but under-specified** (plan wording "instead of snapshotting"
  already corrected by D6; implement inside D6.5). **Fits inside D6: yes.**

  Files touched (expected)
    src/grace-cursor.ts (fold adjudication; optional command-evidence writer if (c))
    src/calibration/report.ts only if restatement/outcome display needs extension
    src/calibration/report.test.ts, src/grace-cursor.test.ts
    src/artifact/assertions.ts and/or src/grace-lint.ts / grace-lint path if (c)
      records evidence at --run-commands time
    src/grace-doctor.ts only if output shape changes (unlikely if report API stable)
    **Surface note:** this is calibration + fold, not pure cursor recovery — see split.

═══════════════════════════════════════════════════════════════════
P0.10 — Attempt-pair write evidence
═══════════════════════════════════════════════════════════════════

  Plan claim (F9.3 weakened form — supersedes F9.2)
    For fail→pass attempt pair on same task, at least one **non-test** file in
    ObservedWriteScope should differ in digest. When none does, ngrace review
    raises a finding the reviewer must clear with a recorded reason — does not
    fail the bundle. Detection, not prevention (R3/F2 ceiling).

  What the code does
    recordAttempt writes WriteEvidence via snapshotWriteEvidence (:1251) — digests
      **all** git porcelain changed files, not OWS-filtered (evidence is broader
      than the plan's scope; F9.2's rule still evaluates the OWS intersection).
    classifyFlakeFromEvidence (:1506) already compares fail→pass digests for
      flaky vs retry — opposite product question; useful neighbour for compare logic.
    review process audits (src/review/core.ts):
      auditScopeOutsideWriteScope :860
      auditTestWeakening :902  ← closest neighbour in shape/intent
      auditHunkCoverage :965
      assembled in runReview :983+; test weakening only if options.testFileDiffs
      supplied; no attempt-pair audit exists.
    review command never writes verdicts (A35.2); gate verdict records
      outcome/note/scope on run-ledger Verdicts (gates/ledger.ts) — bundle-level,
      not finding-id-level clearance.
    No finding-clearance / waiver ledger schema found (rg).

  Non-test file definition (precise proposal from existing review practice)
    Treat as **test file** (excluded from the "must differ" set):
      - path ends with `.test.ts` or `.test.js` (core.ts:418 already uses both;
        :634 production scan only strips `.test.ts` — align on both).
    Do **not** treat as test solely for being under src/test-support/ unless the
      path is itself a `*.test.ts` / `*.test.js` (test-support is unpublished
      helpers; rarely in OWS). Do **not** treat plan/spec/docs as tests — they are
      non-test scope files; if only docs change across a fail→pass pair the finding
      still fires (reviewer clears with reason if the task was documentation-only).
    Intersection order for the check:
      1. fail and pass attempts same taskId, ordered by event id
      2. both have WriteEvidence available
      3. paths ∈ ObservedWriteScope (plan files + globs; use same expansion as
         scope audit for archive identity)
      4. paths that are non-test per above
      5. if that set is empty (test-only OWS) → finding still fires (T-005 shape)
         unless authority adds a "test-only task" exemption (not recommended —
         F9.3 wants the honest sentence recorded)
      6. if no non-test path differs in digest (or all undetermined) → finding

  Live evidence on C-TOKEN-INTEGRITY (digests read from event files; F9 confirmed)
    T-001 fail#2 → pass#3: src/project-utils.ts digest identical
      1b2c38c5f22cae32… at both ends; test/catalog.test changed.
    T-002 fail#6 → pass#7: src/artifact/grammar.ts identical
      9376220ca2613ead…; grammar.test.ts and catalog.ts moved.
    T-005 fail#16 → pass#17: only catalog.test.ts content digest differs among
      implementation-ish paths (fb93cc56… → f708df11…); honest test-only deliverable.
    T-003 / T-004: no fail attempt recorded (F9) — out of P0.10 pair rule (no pair).

  Where the finding attaches
    **ngrace review process-audit path** inside runReview when changeId is set
    (or when ledger/loose attempts are loadable for that change): new function
    e.g. auditAttemptPairWriteEvidence(…) next to auditTestWeakening.
    Code: review.attempt-pair-unsubstantiated (name illustrative).
    Severity: **warning** (or finding that does not fail the bundle) per F9.3 —
      not an automatic error that blocks gate apply unless authority elevates later.
    cursor attempt stays quiet at write time (F9.2/F9.3).

  Clearing reason mechanism
    **Does not exist today at finding granularity.** Available surfaces:
      - ngrace gate verdict --note "…" (bundle Verdict text) — free text, not keyed
        to findingId
      - skill prose requiring the note to cite the finding id
    Inventing a FindingClearance ledger section is an **authority call**, not a
    derivation call. Recommend for implementer: emit finding with stable findingId;
    document that reviewer clearance is recorded in the gate verdict note citing
    that id, until a first-class clearance schema is decided.

  Verdict: **correct but under-specified** (rule sound; clearance mechanism and
  exact severity need authority confirmation; OWS∩WriteEvidence intersection
  must be stated in the bundle).

  Files touched (expected)
    src/review/core.ts, src/review/core.test.ts
    src/review/catalog.ts (explain entry for the new code)
    possibly src/grace-cursor.ts only if shared helpers for reading attempt pairs
      from loose+ledger are exported (readAttemptPayload already exists :1565)
    **Not** C-TOKEN production OWS files if review/* stays outside that scope
      (C-TOKEN OWS does not list src/review/*)

═══════════════════════════════════════════════════════════════════
CONTRADICTIONS (plan / findings vs code at 60c752f)
═══════════════════════════════════════════════════════════════════

  1. **Silent-skip site for F8's NaN file is mis-cited as only :470.**
     Live artifact `NaN-T-001-opened.xml` fails EVENT_FILENAME (`\d+`) at :437/:459
     and never reaches :470. :470 remains a second silent path. Settled by:
     EVENT_FILENAME definition; listLooseEvents loop; readdir vs listLooseEvents
     on C-TOKEN (19 files on disk, 18 events).

  2. **F8's status epochs=0 vs run.xml epoch 1 is not a listLooseEvents consumer.**
     status countLedgerEpochs (grace-status.ts:210) counts folded Epoch-N only.
     Healthy open epochs show the same disagreement. Input validation (P0.4) does
     not fix status. Settled by: status source; healthy open-epoch repro.

  3. **review.md / plan imply fold after NaN is "the" dead-end; two messages exist.**
     Already corrected in review.md §4.3 (open-only → no loose events; open+work →
     no Allocation). Reconfirmed both. Not a new contradiction — keep both in AC.

  4. **"no --worker ever recorded" is not observable in the ledger.**
     Allocation always serializes worker (default w0). Explicit vs default is lost.
     Plan condition for multi-worker refuse cannot be implemented as written without
     a new signal (attribute, or heuristic "more than one distinct worker value" /
     "worker other than w0"). Settled by: advanceCursor :549; writeEventFile alloc.

  5. **P0.8 "re-derive from ledger instead of snapshotting"** — verbal conflict with
     corr 156 already resolved by D6. Implementation that recomputes at doctor time
     would contradict D6; current doctor is not that bug. No code contradiction with
     D6; plan text alone is imprecise (D6.5).

  6. **CalibrationRestatement cannot clear the three live pending pairs.**
     Restatement only flips adjudicatedAt; pending stays pending (report.ts:266–279).
     D6.4's "use restatement when evidence lands after fold" does not, as shipped,
     convert pending→pass. Historical P0.8 acceptance needs authority scope.

  7. **P0.10 "recorded reason" has no finding-level ledger home.**
     Plan assumes a clearance act; only gate verdict notes exist. Not a code
     contradiction with F9.3's detection half — the adjudication half is missing.

  8. **P0.4 bounds hole is wider than task-id NaN.**
     from=0, from=-1, non-integer floats, from>to all write or half-write today.
     Plan text only names the T-001 intuition; AC should cover the class.

  Checked and **not** contradicted:
    - open-epoch CLI Number() path still unvalidated (:2622–2623).
    - No cursor recover command.
    - No attempt-pair review audit.
    - evaluateTargetComplete still runCommands:false at fold.
    - F9 digests on C-TOKEN fail→pass pairs (T-001, T-002, T-005) match decisions.md.
    - C-TOKEN OWS still excludes grace-cursor / review / calibration production paths.

═══════════════════════════════════════════════════════════════════
FILES-TOUCHED ANALYSIS + OVERLAP WITH C-TOKEN-INTEGRITY
═══════════════════════════════════════════════════════════════════

  C-TOKEN-INTEGRITY ObservedWriteScope (active plan):
    src/project-utils.ts|.test.ts
    src/artifact/projections.ts|.test.ts
    src/artifact/grammar.ts|.test.ts
    src/lint/catalog.ts|.test.ts
    .ngrace/changes/active/C-TOKEN-INTEGRITY/{spec,plan}.xml
    docs/plans/active/RM-GOVERNED-PATH/plan.md

  | Step | Production files | Overlap with C-TOKEN OWS? |
  |---|---|---|
  | P0.4 | grace-cursor.ts + tests | **No** |
  | P0.6 | grace-cursor.ts + tests; skill recovery prose optional | **No** (catalog.ts only if new lint codes — avoid) |
  | P0.8 | grace-cursor.ts; calibration/report.ts; possibly assertions.ts / grace-lint.ts | **No** |
  | P0.10 | review/core.ts, review/catalog.ts, tests; maybe grace-cursor read helpers | **No** |

  Internal overlap among the four steps:
    P0.4 ∩ P0.6 ∩ P0.8 all edit **src/grace-cursor.ts** (validation, listLooseEvents /
    orphans, recover/auto-open, fold adjudication). P0.10 is primarily **src/review/**.
    P0.8 also touches **src/calibration/** (and possibly lint command-evidence write).

  Orderability with C-TOKEN: **file-disjoint if catalog.ts is not claimed for new
  recover codes.** Rule 7 sequencing (C-CURSOR before C-TOKEN archive) remains
  process ordering, not merge conflict.

═══════════════════════════════════════════════════════════════════
BUNDLE SPLIT PROPOSAL
═══════════════════════════════════════════════════════════════════

  Split question (stated explicitly)
    P0.4, P0.6, P0.10 are cursor/ledger honesty. P0.8 is calibration reporting /
    fold-time adjudication evidence. Does the name C-CURSOR-INTEGRITY force one
    bundle, or should P0.8 split?

  Recommendation: **two bundles**, sequenced.

  1) **C-CURSOR-INTEGRITY** — P0.4, P0.6, P0.10
     Rationale: shared listLooseEvents / orphan honesty; recover acceptance fixture
     is C-TOKEN's NaN ledger; P0.10 is review-of-ledger but unblocks the same
     "ledger honesty" closure story and rule-7 archive gate (F8.1 + F9).
     Internal sequencing inside the bundle: P0.4 → P0.6 (validation before recovery
     ACs; orphan reader with recovery) → P0.10 (can parallelize after reader can
     see attempts; does not depend on recover for unit tests).

  2) **C-CALIBRATION-COMMAND-EVIDENCE** (name illustrative) — P0.8 alone
     Rationale: different product surface (doctor calibration corpus, fold
     adjudication, optional assertions/lint write path); different acceptance
     fixture (archived pending epochs, not NaN run/); D6/corr 156 is a distinct
     wall from A29.2. Keeping it out of C-CURSOR avoids loading command-evidence
     schema work onto the recover critical path that unblocks C-TOKEN archive.

  Alternative (one bundle) is acceptable if the authority prioritizes a single
  6.2.0 integrity ship and accepts grace-cursor.ts contention across four steps.
  Prior p0-derivation.md recommended one C-CURSOR for 4+6+8 before P0.10 existed;
  P0.10's review surface and P0.8's calibration surface now pull in opposite
  directions — **two bundles is the cleaner split**.

  If forced to one bundle: still implement P0.8 behind D6; do not let calibration
  schema debates block P0.4/P0.6 landing.

═══════════════════════════════════════════════════════════════════
PROPOSED ACCEPTANCE CRITERIA (C-TOKEN register: AC-* blocks)
═══════════════════════════════════════════════════════════════════

  P0.4
    AC-EPOCH-BOUNDS-REJECT-TASK-ID
      cursor advance --open-epoch --from T-001 --to T-001 exits non-zero; message
      names positive integer event ids and states that task ids are not event ids;
      no run/* file is written.
    AC-EPOCH-BOUNDS-CLASS
      Same refusal for non-integers (abc, 1.5), zero, negatives, and from>to;
      valid --from 1 --to 10 still opens.
    AC-EPOCH-BOUNDS-LIBRARY
      advanceCursor({openEpoch, from: NaN}) refuses (not only CLI).

  P0.6
    AC-RECOVER-DIAGNOSE-NAN-FIXTURE
      On a copy of the F8.1 ledger shape (or the live fixture in a worktree copy),
      cursor recover --change C-ID lists: orphan NaN-* file (unrecoverable id),
      missing valid allocation, loose integer events 1..N, fold blocked.
    AC-RECOVER-FIX-COVERING-ALLOCATION
      --fix extend-allocation (or create-covering) writes a recorded opened/
      allocation spanning valid loose ids; does not delete NaN-*; does not invent
      an id for NaN; subsequent fold succeeds for the valid stream.
    AC-AUTO-OPEN-SINGLE-CONTROLLER
      Loose progress without opened and without multi-worker evidence: fold (or
      advance) synthesizes covering opened; multi-worker evidence refuses with
      message demanding explicit epoch open.
    AC-NO-RM-RUN-DOCS
      Skill/CLI help no longer documents rm -r run/ as recovery.

  P0.8
    AC-FOLD-USES-RECORDED-COMMAND-EVIDENCE
      When MustPassCommand evidence was recorded successful before fold, stored
      CalibrationAdjudication is pass|fail (not pending-for-not-opted-in); report
      still never calls evaluateTargetComplete.
    AC-NO-REPORT-TIME-REEVAL
      Regression: stored fail remains fail after tree becomes clean (corr 156).
    AC-HISTORICAL-PENDING (authority-scoped)
      Either: documented permanent pending for pre-fix folds, OR restatement/
      backfill path that can place a late pass in backfilled without mutating
      archive outcome in place.

  P0.10
    AC-ATTEMPT-PAIR-FINDING
      fail→pass pair with identical digests on all non-test OWS files → ngrace
      review emits a finding (does not fail the bundle by default).
    AC-T005-SHAPE-STILL-FINDING
      Test-only digest change still raises (F9.3); clearance is a recorded reason,
      not silence.
    AC-T001-T002-CORPUS
      Replay digests from C-TOKEN events 2/3 and 6/7 raises the finding.
    AC-CURSOR-QUIET
      cursor attempt does not refuse write-time when digests match.

═══════════════════════════════════════════════════════════════════
SEQUENCING CONSEQUENCES
═══════════════════════════════════════════════════════════════════

  Rule 7 (plan §1): C-TOKEN-INTEGRITY must not archive until cursor recover can
  honestly address the F8.1 NaN epoch (P0.6). F9 adds P0.10 as a second reason
  the same ordering serves (review can surface unsubstantiated pairs before close).

  This derivation adds / tightens:
  1. P0.4 should land before or with P0.6 (stop new NaN; recover tests assume
     validation exists for green path).
  2. P0.8 does **not** block C-TOKEN archive (calibration pending is unrelated to
     the NaN ledger). Prefer not on the critical path.
  3. P0.10 should run against C-TOKEN before archive if the authority wants F9
     visible in the closing review; it does not repair the ledger (F9.1 forbids
     retrofit) — findings are expected and need recorded clearance reasons.
  4. Avoid new lint catalog codes in C-CURSOR if that would join C-TOKEN's OWS;
     use command errors for recover/bounds.
  5. No change to "two stay orderable on files" — only process order.

═══════════════════════════════════════════════════════════════════
OPEN QUESTIONS FOR THE AUTHORITY
═══════════════════════════════════════════════════════════════════

  1. Bundle split: one C-CURSOR-INTEGRITY (4+6+8+10) vs two (cursor 4+6+10 and
     calibration P0.8)?
     **Recommendation:** two bundles; P0.8 separate. Unblocks C-TOKEN archive
     without command-evidence schema design.

  2. Explicit --worker detection for auto-open refuse?
     **Recommendation:** refuse auto-open when any Allocation in the change's
     ledger∪loose has worker ≠ "w0", OR when more than one distinct worker appears.
     Treat pure default-w0 as single-controller. Document that explicit
     `--worker w0` is indistinguishable from default (acceptable collapse).

  3. F8.1 NaN orphan after successful covering allocation — leave forever, or
     later quarantine command?
     **Recommendation:** leave on disk; recover diagnose continues to report
     "unrecoverable orphan"; no delete in P0. Quarantine is a later phase if ever.

  4. P0.8 historical three pending archives — fix, restate with new outcome
     schema, or accept permanent pending?
     **Recommendation:** forward-fix only in this phase; document the three as
     pre-fix corpus pending; optional later restatement-with-outcome under A61
     extension. Do not hand-edit archives.

  5. P0.8 implement (b) fold-time runCommands vs (c) durable command evidence?
     **Recommendation:** (c) if the write can be structural and opt-in (lint
     --run-commands already is the human apply); if schema cost is too high for
     6.2.0, (b) is D6-legal and smaller — record the A5.2 re-open in decisions.

  6. P0.10 clearance: gate verdict note citing findingId vs new ledger schema?
     **Recommendation:** gate verdict note + skill text for 6.2.0; no new schema
     in this phase. Severity warning so apply gate is unchanged.

  7. listLooseEvents: convert silent skips to errors always, or only surface via
     recover/doctor?
     **Recommendation:** listLooseEvents gains a parallel orphan inventory API;
     default list remains integer events for fold density math; recover/doctor
     must call the orphan scan. Do not make fold throw on orphans alone if a
     valid covering allocation exists (F8.1 residual NaN).

  8. status epochCount vs open epochs — in scope?
     **Recommendation:** out of P0.4/P0.6 scope; open a note for P3 lifecycle
     honesty. Do not pretend P0.4 fixes F8's status line.
```

---

## Derivation agent attestation

- No source edits, no `.ngrace/changes/` writes, no cursor events, no commits.
- C-TOKEN-INTEGRITY ledger and `run/NaN-T-001-opened.xml` were read-only.
- Claims above that cite commands were run at measuring commit `60c752f`.
