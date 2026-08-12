# RM-GOVERNED-PATH Phase P0 — report honesty derivation (P0.7 / P0.9 + F11 / F14 / F15 / F16)

**Derived:** 2026-08-10  
**Measuring commit:** `eb5bbe7` (package `6.1.1`)  
**Role:** derivation only — no code changes, no change bundle, no cursor events, no commits.

**Precedent shape:** [p0-cursor-derivation.md](./p0-cursor-derivation.md), [p0-calibration-derivation.md](./p0-calibration-derivation.md) (both accepted).  
**Binding findings / dispositions:** F11, F11.2, F12, F14, F15, F16, F9.6–F9.8 in [decisions.md](./decisions.md).  
**Plan steps:** P0.7 (verdict diagnostics), P0.9 (mode-aware lint summary) in [plan.md](./plan.md) §2.  
**Walls:** A29.2 / F1 (binary writes structural state only); Correction 171 (archive-identity path reading); D8.7 (orphan inventory parallel to `listLooseEvents`); never edit archives.

---

```
BASELINE
  HEAD: eb5bbe709b53de83bf55a0536275cdf6793e9035 on docs/rm-governed-path
        — git fetch origin; git rev-list --left-right --count
          origin/docs/rm-governed-path...HEAD → 0 0 (not ahead, not behind)
        — origin/main...HEAD left-right was not re-measured as a gate; branch tracks itself
  Tree: clean at start (git status --porcelain empty). Restored once after an accidental
        gate archive re-record on archive/C-TOKEN-INTEGRITY/run-ledger.xml (see
        incidental note under CONTRADICTIONS / OPEN QUESTIONS). Final porcelain empty.
  Version under test: 6.1.1 (package.json; bun run ngrace --version)
  Binary: bun run ./src/grace.ts via script "ngrace"; PATH also has unrelated
        /Users/sas/.bun/bin/grace → @osovv/grace-cli (not used)
  lint --path .: 0 errors, 0 warnings (measured)
  doctor --path .: Calibration 2 included, 0 excluded, 3 pending, 1 backfilled
  Preserved evidence: archive/C-TOKEN-INTEGRITY/run/NaN-T-001-opened.xml
        SHA-1 c0cc8899c264381766a18918e2109b5e05693893 (matches task brief; untouched)
  Active bundle (not modified): C-LEDGER-READ-ABSENCE (draft spec, no plan)

═══════════════════════════════════════════════════════════════════
PER ITEM
═══════════════════════════════════════════════════════════════════

P0.7 — Verdict diagnostics
  Verdict: **correct** (message / diagnostics defect; race not real)

  Plan claim
    Reproduce first. If the race is real, flush before return; if not — the likely
    case — rewrite gate.apply.no-verdict to report where it looked, how many entries
    it found, and why the newest did not qualify.
    (plan.md §2 step 7; review.md §4.10)

  What the code does
    evaluateApplyGate  src/gates/core.ts:238–350
      :271  latest = readLatestReviewVerdict(projectRoot, changeId)
      :273–277  state === "absent" → requirement message "no Verdicts section entry"
                + guideIssue("gate.apply.no-verdict") with **no detail**
    guideIssue  src/gates/core.ts:73–82
      message = detail ? `${title}: ${detail}` : title
      → absent path yields message = catalog title only
    GATE_CATALOG["gate.apply.no-verdict"]  src/gates/catalog.ts:58–68
      title/explanation/remediation only; no path or entry-count fields
    readLatestReviewVerdict  src/gates/ledger.ts:594–630
      absent if no wrapper / no Verdicts / empty children; invalid if unreadable child;
      present → newest of fully-valid children
    writeAndVerifyLedger  src/gates/ledger.ts:215–249
      writeFileSync then synchronous re-read + validate; restore prior bytes on failure
      — no async gap between write and durable content

  What was reproduced
    1. Temp project, approved plan, no ledger:
       evaluateApplyGate → decision refuse, issue gate.apply.no-verdict
       requirement review-verdict.message = "no Verdicts section entry"
       issue.message = "Apply Requires A Recorded Review Verdict" (title only;
       no path, no entry count, no "why")
    2. recordReviewVerdict({ outcome: "pass" }) then immediate evaluateApplyGate
       → decision permit; requirement message "outcome=pass reason=…"
       readLatestReviewVerdict.state = "present"
    3. 50 sequential write-then-apply on fresh temp projects → **0 race hits**
       (no gate.apply.no-verdict after a successful record)
    4. Race is not real at this HEAD. Flush-before-return is unnecessary.

  Classification: **correct** — step objective stands; implementation is diagnostics
  only. Prior p0-derivation.md (P0.7 CONFIRMED as message defect) still holds.

  Files touched (proposed):
    src/gates/core.ts          — richer absent/invalid detail into guideIssue /
                                  requirement message
    src/gates/catalog.ts       — optional catalog text if explanation should name the
                                  diagnostic fields (not required if detail carries them)
    src/gates/core.test.ts     — regressions for path + entry count + invalid newest
    src/gates/ledger.ts        — only if absence detail is structured at the reader
                                  (optional; can compose path in core from resolveChangeBundle)

───────────────────────────────────────────────────────────────────

P0.9 — Mode-aware lint summary
  Verdict: **correct** (under-specified on *how* to tag baseline-sourced issues)

  Plan claim
    When an active change has baseline assertions, default text output leads with one
    line — "N baseline expectations (expected while C-* is in progress)" — instead of
    presenting MustNotExist failures as generic breakage.
    (plan.md §2 step 9)

  What the code does
    formatTextReport  src/lint/core.ts:536–563
      Header: Root / Profile / counts / Errors / Warnings
      Then raw Issues lines; **no** baseline-expectation lead line
    lintGraceProject evaluation path  src/lint/core.ts:293–299
      Active approved plans: evaluate BaselineAssertions under assertionMode current
      Issues are plain LintIssue { severity, code, file, message, … }
      LintIssue (src/lint/types.ts:49–60) has **no** section / baseline source field
    evaluateSection  src/lint/core.ts:325+ → assertions emit assertion.MustNotExist etc.
    Search: /baseline expectation|expected while/ across src/ — **absent**

  What was reproduced
    Temp GraceProjectBuilder project: active approved C-BASE with
    BaselineAssertions MustNotExist M-EXAMPLE while M-EXAMPLE exists.
    lintGraceProject + formatTextReport:
      Errors: 1
      Issues
      - [error] assertion.MustNotExist …/plan.xml — Expected M-EXAMPLE not to exist.
      has baseline expectation line? **false**
    Dogfood root lint is clean (no active approved plan with failing baseline —
    only C-LEDGER-READ-ABSENCE draft/spec-only), so the defect is not live on this
    tree; it is live in the product path the plan names.

  Classification: **correct but under-specified**
    Objective is clear. Mechanism is not: issues must be tagged as baseline-sourced
    (new LintIssue field, or parallel count from evaluateSection) before the summary
    line can be honest. Plan does not say whether baseline issues remain errors
    (recommended: yes — only the framing line changes) or are downgraded.

  Files touched (proposed):
    src/lint/core.ts           — tag baseline issues; formatTextReport lead line
    src/lint/types.ts          — optional issue provenance / baselineExpectationCount
    src/lint/core.test.ts or src/grace-lint.test.ts — red-first on summary line
    (no catalog change required unless --explain text should mention the framing)

───────────────────────────────────────────────────────────────────

F11 / F11.2 — Scope audit reports CLI ledger writes as out-of-scope errors
  Verdict: **correct**

  Claim (decisions.md F11, F11.2)
    review.scope-outside-write-scope fires on run/* events, run-ledger.xml, run.xml
    written (and on fold, deleted) by the CLI. Noise scaled to 23 errors during
    C-TOKEN-INTEGRITY close and blocked the pre-verdict review. Commit-before-review
    is a process workaround; the defect remains.

  What the code does
    auditScopeOutsideWriteScope  src/review/core.ts:868–893
      For each changed file: if not in expanded ObservedWriteScope files/globs →
      review.scope-outside-write-scope. **No** exception for lifecycle paths.
    expandScopePathsForArchiveIdentity  :846–866 applied only to scope files/globs
      (corr 171), not as an exclusion list for changed files.
    Scope input  review/core.ts resolveScopeChangedFiles ~:1294+
      Default: git porcelain changed set (includes deletions).
    Catalog  src/review/catalog.ts:128–134
      remediation: "Add the path to ObservedWriteScope, or revert" — wrong advice for
      tool-owned ledger paths.

  What was reproduced
    Library: auditScopeOutsideWriteScope(
      [run/27-T-006-attempt.xml, run-ledger.xml, run.xml, src/example.ts],
      scope=["src/example.ts"], globs=[]
    ) → **3 findings**, all review.scope-outside-write-scope on the three ledger paths;
    src/example.ts silent.
    F11.2-shape: 20 deleted-style run/*.xml + run-ledger + run.xml + docs path,
    scope=["src/grace-cursor.ts"] → **23** scope-outside findings (matches measured
    count class).
    Dogfood: clean tree → review scope audit "not-run — no changed files"; F11 is
    porcelain-dependent (as F11.2 workaround predicted).

  Classification: **correct**

  Files touched (proposed):
    src/review/core.ts         — exclude bundle lifecycle paths from scope audit
    src/review/core.test.ts    — ledger paths silent; real out-of-scope still fires
    src/review/catalog.ts      — remediation text if it still suggests declaring run/

───────────────────────────────────────────────────────────────────

F14 — Archive gate records "run/ empty" when run/ is not empty
  Verdict: **correct**

  Claim
    evaluateArchiveGate computes no-open-epoch from listLooseEvents and records
    detail "run/ empty" while archive/C-TOKEN-INTEGRITY/run/ holds NaN-*.xml.

  What the code does
    evaluateArchiveGate  src/gates/core.ts:352–378
      :354  loose = listLooseEvents(bundlePath)
      :355  open = loose.length > 0
      :360–364  requirement no-open-epoch; detail =
                open ? `${loose.length} loose run/ event(s)` : **"run/ empty"**
    listLooseEvents  src/grace-cursor.ts:467–500
      EVENT_FILENAME = /^(\d+)-(T-[0-9]{3})-(.+)\.xml$/  (:450)
      non-matching names skipped at :473; invalid ids skipped at :483
    listRunOrphans  src/grace-cursor.ts:532+ — parallel inventory of those skips (D8.7)
    **Orphans never affect the gate detail string.**

  What was reproduced
    archive/C-TOKEN-INTEGRITY/run/: [NaN-T-001-opened.xml] only
    listLooseEvents → length 0
    listRunOrphans → [{ name: NaN-T-001-opened.xml, class: "event-filename" }]
    evaluateArchiveGate → decision **permit**, requirement message **"run/ empty"**
    Durable ledger already records the same false sentence:
      Decisions… gate="archive" … no-open-epoch … >run/ empty</Requirement>
    (read from committed run-ledger.xml; do not re-record)

  Classification: **correct**
    Permit is right (no foldable open epoch). Sentence is false.

  Files touched (proposed):
    src/gates/core.ts          — honest detail (no foldable loose events; name orphans)
    src/gates/core.test.ts     — fixture with NaN orphan → permit + honest message
    (optional) shared membership helper if extracted for F15

───────────────────────────────────────────────────────────────────

F15 — status open=1 vs archive gate "run/ empty" on the same directory
  Verdict: **correct**

  Claim
    Two definitions of loose-event membership: listLooseEvents (gate) vs raw
    readdirSync endsWith(".xml") (status countOpenEpochs). Same directory, opposite
    sentences. Introduced by D8.8's open-epoch counter.

  What the code does
    countOpenEpochs  src/grace-status.ts:244–249
      readdirSync(runDir).filter(name => name.endsWith(".xml"))
      return loose.length > 0 ? 1 : 0
      Comment :241–242: "Kept local to status (does not import grace-cursor — avoids
      a cycle)." Measured: grace-status.ts has **no** import of grace-cursor (only
      that comment). grace-cursor does not import grace-status either. The cycle
      fear is historical / precautionary, not a current import cycle.
    status formatting uses openEpochCount → "open=N" in Changes lines.

  What was reproduced
    bun run ngrace status --path .:
      C-TOKEN-INTEGRITY [archive] … epochs=1 **open=1** tasks=5
    Same directory: listLooseEvents=0, orphan present, archive gate "run/ empty"
    Across all archive/*/run/: only C-TOKEN-INTEGRITY has any run/*.xml at HEAD,
    and it is the NaN orphan alone.

  Classification: **correct**

  Files touched (proposed):
    src/grace-status.ts        — open epoch = foldable loose membership, not raw xml
    src/grace-status.test.ts   — orphan-only run/ → open=0; real loose event → open=1
    optional extract of membership to a neutral module if status must not import cursor

───────────────────────────────────────────────────────────────────

F16 — detectConfidentlyWrong ignores Correction 171 for MustExist
  Verdict: **correct**

  Claim
    MustExist targets checked with bare existsSync; ObservedWriteScope gets
    expandScopePathsForArchiveIdentity. Standing error against a true claim for
    archived plans that name active/<id>/… for their own artifacts.

  What the code does
    detectConfidentlyWrong  src/review/core.ts:360–418
      :391–416 MustExist: target = Value text; skip semantic anchors; then
      **existsSync(path.join(root, target))** — no archive identity expansion
    expandScopePathsForArchiveIdentity  :846–866
      When planLocation === "archive", active/<id>/ ↔ archive/<id>/ aliases
      Used by auditScopeOutsideWriteScope only (:875–876)
    detectConfidentlyWrong is called project-wide from the pattern path; it does
    not receive ScopeAuditIdentity per plan.

  What was reproduced
    bun run ngrace review --path . → 2 errors:
      review.confidently-wrong
        archive/C-CALIBRATION-COMMAND-EVIDENCE/plan.xml —
        MustExist claims …/active/C-CALIBRATION-COMMAND-EVIDENCE/spec.xml …
      review.confidently-wrong
        archive/C-RECOVER-FOLDABLE/plan.xml —
        MustExist claims …/active/C-RECOVER-FOLDABLE/spec.xml …
    expandScopePathsForArchiveIdentity(
      [".ngrace/changes/active/C-RECOVER-FOLDABLE/spec.xml"],
      { changeId: "C-RECOVER-FOLDABLE", planLocation: "archive" }
    ) → both active and archive paths in the set
    archive/…/spec.xml exists: true; active/…/spec.xml exists: false
    Corpus: exactly those two archived plans MustExist their own active/spec.xml
    (rg MustExist.*active/ under archive/*/plan.xml)

  Classification: **correct**
    Fix: apply corr 171 expansion to MustExist disk checks (per plan location + id).
    Do not edit archives. Do not suppress the code.

  Files touched (proposed):
    src/review/core.ts         — detectConfidentlyWrong uses expansion (or resolve
                                  exists under active|archive alias for same id)
    src/review/core.test.ts    — archived plan MustExist active/<same-id>/spec → silent;
                                  missing in both locations → still fires;
                                  foreign change id path → still fires

───────────────────────────────────────────────────────────────────

F12 / F9.8 — Documentation gaps (same family: agent contract silent on hard rules)
  Verdict: **correct** (both are documentation defects; disposition already points to P1)

  F12 claim
    Fold requires kind=terminal inside each allocation
    (validateEventsAgainstAllocations ~:2533–2535: unterminated range for w0).
    skills/ngrace/ngrace-execute/SKILL.md mentions "terminal" **zero** times.
    CLI help at grace-cursor.ts:~3192 lists opened|progress|pause|resume|terminal.

  F12 measured
    Canonical SKILL.md: terminal count = 0 (also packaged mirror = 0)
    validateEventsAgainstAllocations still requires terminal in-range
    Archived ledgers with kind="terminal": 10 of 17 that have run-ledger.xml
    (C-ADOPTION-SURFACE, C-CALIBRATION*, C-CURSOR-INTEGRITY, C-PLAN-QUALITY,
     C-RECOVER-FOLDABLE, C-REVIEW-LANGUAGE-SCOPE, C-TOKEN-INTEGRITY, …).
    Finding's "six of six" was true at record time; **today's** corpus is larger —
    the skill gap still holds; the exact "6/6" count is historical, not current.
    decisions.md F12 disposition: **no code change; docs → P1** (RC-4 surface).

  F9.8 claim
    Honest red-first requires cursor attempt written in its **own round trip**
    before the production edit; constraint unstated; disclosed five consecutive times.
    Related context (not this repair): F9.6 multi-task suite attribution; F9.7
    pass-only invisibility to attempt-pair audit.

  F9.8 measured
    SKILL.md: no "round trip" / "WriteEvidence" / batch-ordering constraint
    Step 5 tells agents to record attempt outcomes but not *when relative to writes*
    decisions.md: belongs with F12's doc gap in **P1**

  Classification: **correct** as gaps; **out of C-REPORT-HONESTY code scope** per
  existing disposition unless the authority pulls them forward as skill-only tasks.

  Files touched (if pulled into this phase — docs only):
    skills/ngrace/ngrace-execute/SKILL.md
    plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md  (mirror)
    (not src/)

═══════════════════════════════════════════════════════════════════
THE UNIFYING QUESTION
═══════════════════════════════════════════════════════════════════

  F14, F15, F16 are all disagreements about how a declared or on-disk thing should
  be read. Are they one shared definition or separate repairs?

  Answer: **two shared definitions, not one, and not three unrelated patches.**

  (A) Loose-event / open-epoch membership — **one definition fixes F14 and F15
      together**, and should also be what recover already uses:

        foldable loose events  = listLooseEvents(bundle)     // primary, ordered
        orphans                = listRunOrphans(bundle)      // parallel, D8.7
        open epoch for status  = foldable loose events > 0   // not raw *.xml
        archive no-open-epoch  = foldable loose events == 0
        archive detail when closed:
          if orphans.length == 0 → "no loose run/ events" (or empty dir)
          else → "no foldable loose events; N orphan(s): <names/classes>"
          **never** "run/ empty" when readdir is non-empty

      Evidence: same directory, same NaN file, gate vs status already disagree only
      because status reimplemented membership with endsWith(".xml"). recover already
      has the dual inventory; status is the outlier; gate's *predicate* is right and
      its *sentence* is wrong.

  (B) Archive-identity path resolution (Correction 171) — **fixes F16 alone**, and
      is the same expander ObservedWriteScope already uses. Not a membership rule.
      MustExist disk checks must call expandScopePathsForArchiveIdentity (or an
      exists-under-aliases helper) when the plan is under archive/<id>/.

  (C) F11 is a third axis — **lifecycle path exclusion** from the scope audit's
      *changed-file* set. Related family ("report about ledger disagrees with truth")
      but a different shared rule:
        paths under .ngrace/changes/{active,archive}/C-*/run/
        and that bundle's run-ledger.xml + run.xml
      are CLI lifecycle artifacts, not authored ObservedWriteScope work.

  (D) P0.7 and P0.9 are **presentation honesty** on other surfaces (apply gate
      absence text; lint summary framing). Same family thesis, separate code paths.

  Bundle-shape consequence: one family, **at least two code clusters** (membership
  A + review-surface B/C + lint/gate presentation D). Not three independent
  membership bugs.

═══════════════════════════════════════════════════════════════════
WHAT EACH REPAIR WOULD STOP CATCHING
═══════════════════════════════════════════════════════════════════

  F11 — exclude lifecycle paths from scope audit
    Stops catching: hand-authored or accidental writes *under the reviewed bundle's
    run/, run.xml, run-ledger.xml* that are also outside ObservedWriteScope.
    Acceptable? **Yes, with a narrow exclusion.** Those paths are owned by the CLI
    execution contract; agents must not declare them in OWS. Real out-of-scope
    production/docs paths (the authority document mixed into the 23) **must still
    fire**. Exclusion must be path-prefix of *this change id's* lifecycle files,
    not a global .ngrace/changes/ free pass. Do not exclude plan.xml/spec.xml.
    Loss of "agent edited a run event by hand" is acceptable: other surfaces
    (ledger attestation, fold validation) own that; scope audit's job is authored
    write scope.

  F14 — honest archive detail (predicate unchanged)
    Stops catching: nothing structural if listLooseEvents remains the open check.
    Only the durable sentence changes. Acceptable? **Yes — strictly stronger honesty.**
    Caution: do not "fix" by treating orphans as open epochs (would refuse archive
    of C-TOKEN-INTEGRITY's shape and reverse F8.1 preservation design).

  F15 — status open count uses foldable membership
    Stops catching: treating non-event *.xml under run/ as an open epoch.
    Acceptable? **Yes — that signal was false for the NaN orphan.** Orphans must
    still be visible somewhere (status line, doctor, or recover) so the directory
    is not silently non-empty. Recommend: open=0 for orphan-only; optional
    "orphans=1" field or rely on recover diagnose (already exists). A design that
    only zeros open= and never surfaces the orphan **elsewhere** loses visibility —
    pair with F14's orphan naming or a status orphan count.

  F16 — corr 171 on MustExist
    Stops catching: a MustExist that *intentionally* means "this path must remain
    under active/ after archive" — but Correction 171 already ratified the opposite
    reading for bundle-relative paths. Acceptable? **Yes under corr 171.** Still
    catches: missing in both active and archive aliases; foreign change-id paths;
    true missing files outside the bundle. Do not global-swap all .ngrace/changes/
    prefixes (corr 171's own constraint).

  P0.7 — richer no-verdict diagnostics
    Stops catching: nothing. Strictly more information. Acceptable? **Yes.**

  P0.9 — baseline framing line
    Stops catching: nothing if baseline issues remain errors. If someone "fixes"
    by silencing baseline MustNotExist in current mode, that would stop catching
    real baseline breakage — **unacceptable**. Framing only.

  F12 / F9.8 — skill text
    Stops catching: nothing in code. Risk is doc drift if skill over-specifies
    host batching that some harnesses cannot do — state the *ordering constraint*
    as the honesty rule, not a particular tool API.

═══════════════════════════════════════════════════════════════════
CONTRADICTIONS
═══════════════════════════════════════════════════════════════════

  Plan/code disagreements and plan/corpus drift checked:

  1. P0.7 plan allows a race fix path. Code + 50-iteration probe: race **not** real.
     Settled: diagnostics-only (plan's "likely case"). Not a contradiction of the
     step objective — the plan already preferred this branch.

  2. F12 "six of six" archived ledgers with terminal: historical. At eb5bbe7,
     10 of 17 run-ledger.xml files contain kind="terminal". Skill zero-mention
     still holds. Report as **stale count, live gap**.

  3. F15 / D8.8 criterion said "status distinguishes folded vs open epochs" without
     defining membership. Code picked raw xml; gate/listLooseEvents disagree.
     Plan authority was under-specified; implementation is consistent with a
     reasonable misreading. **Plan gap, not plan falsehood.**

  4. P0.9 does not specify whether baseline issues remain errors or how they are
     tagged. LintIssue has no section provenance field today. **Under-specified,
     not contradicted.**

  5. decisions.md assigns F12 and F9.8 documentation gaps to **P1**, while this
     derivation task includes them as family members. Not a code contradiction —
     sequencing disposition already exists. Derivation follows P1 for skill work
     unless authority overrules.

  6. p0-derivation.md P0.7 already classified race as message defect (prior pass).
     Re-confirmed at eb5bbe7; no drift.

  What was checked to claim no other plan-vs-code dead letters for these items:
    - plan.md §2 steps 7 and 9 text vs gates/core.ts, lint/core.ts
    - decisions F11/F11.2/F14/F15/F16 cited lines vs current file:line (offsets match
      within the same functions; line numbers above re-opened at HEAD)
    - NaN orphan SHA-1 and archive gate durable "run/ empty" string
    - review confidently-wrong on the two archived MustExist active/spec paths

  Incidental (not a plan step, discovered during probe):
    `ngrace gate archive --change C-TOKEN-INTEGRITY --dry-run` **does not dry-run**.
    There is no --dry-run flag; record defaults true (gates/command.ts:126–129,
    :70–88). Unknown args are ignored; the command re-records a Decision.
    Restored the ledger with git checkout. Prefer evaluateArchiveGate library or
    `gate archive --record false` for read-only probes. Optional honesty fix
    outside this bundle: reject unknown flags or implement real --dry-run.

═══════════════════════════════════════════════════════════════════
FILES TOUCHED / BUNDLE SPLIT
═══════════════════════════════════════════════════════════════════

  Per item (implementation surface)
    P0.7   gates/core.ts, gates/core.test.ts [, gates/catalog.ts, gates/ledger.ts]
    P0.9   lint/core.ts, lint/types.ts, lint tests / grace-lint.test.ts
    F11    review/core.ts, review/core.test.ts [, review/catalog.ts]
    F14    gates/core.ts, gates/core.test.ts
    F15    grace-status.ts, grace-status.test.ts
           + optional shared membership module (see below)
    F16    review/core.ts, review/core.test.ts
    F12/F9.8  skills only (if in scope)

  Overlaps
    gates/core.ts     — P0.7 + F14 (same file, different functions)
    review/core.ts    — F11 + F16 (same file, different detectors)
    membership helper — F14 + F15 (+ recover already on listLooseEvents/listRunOrphans)

  Bundle split proposal
    **Recommend one code bundle: C-REPORT-HONESTY** (name already assigned; keep it).

    Reasoning:
    - One family thesis for the phase close ("surfaces must not disagree about disk").
    - File overlaps (gates/core, review/core) make two concurrent bundles fight OWS.
    - No other active plan is writing these paths (C-LEDGER-READ-ABSENCE is draft
      spec only).
    - Tasks can still be ordered: membership (F14/F15) → review honesty (F11/F16)
      → presentation (P0.7, P0.9).

    **Do not** force docs F12/F9.8 into this bundle by default — decisions.md already
    sends them to P1. If the authority wants them closed before P0 is marked done,
    add skill-only tasks with zero src/ scope.

    Alternative (only if OWS must stay tiny): 
      C-LEDGER-MEMBERSHIP (F14+F15) then C-REPORT-HONESTY (F11+F16+P0.7+P0.9).
    Higher process cost for little isolation benefit at current HEAD.

    Optional extract (same bundle or tiny prerequisite task):
      src/run-events.ts (or similar) exporting listLooseEvents + listRunOrphans
      so grace-status need not import grace-cursor. Not required if status may import
      cursor now that the cycle is measured absent — but extract matches D8.7's
      "single definition" intent cleanly.

═══════════════════════════════════════════════════════════════════
PROPOSED ACCEPTANCE CRITERIA
═══════════════════════════════════════════════════════════════════

  Register: post-conditions a wrong implementation cannot satisfy
  (shape from archive/C-RECOVER-FOLDABLE/spec.xml AcceptanceCriteria).

  AC-APPLY-VERDICT-DIAGNOSTICS (P0.7)
    Given a bundle with plan status=approved and no Verdicts section entry (no
    ledger, or ledger without Verdicts / empty Verdicts), evaluateApplyGate /
    `ngrace gate apply --record false` refuses with gate.apply.no-verdict and the
    emitted requirement or issue detail names **(1)** the ledger path looked at
    (or that run-ledger.xml is missing), **(2)** how many Verdict children were
    found (0 for absence), and **(3)** why the newest did not qualify (absent vs
    invalid with reason). A message that is only the catalog title
    ("Apply Requires A Recorded Review Verdict") or only "no Verdicts section
    entry" fails this criterion. After recordReviewVerdict + immediate
    evaluateApplyGate, decision is permit when other requirements hold (no race
    dependency on flush).

  AC-BASELINE-LINT-FRAMING (P0.9)
    Given an active approved plan whose BaselineAssertions include a failing
    MustNotExist (or other baseline assertion) and default text lint output,
    formatTextReport **leads** with a line matching the plan's intent:
    N baseline expectation(s) expected while C-* is in progress (wording may
    normalize whitespace). The underlying assertion.* issues remain present as
    errors (not deleted, not silently downgraded to zero). A fix that only removes
    baseline evaluation, or that prints the line without counting baseline-sourced
    issues correctly, fails this criterion. Archived plans' baselines stay
    syntax-only (existing rule).

  AC-SCOPE-LIFECYCLE-EXCLUSION (F11)
    Given changed files that are only:
      .ngrace/changes/active|archive/<C-ID>/run/**,
      …/<C-ID>/run-ledger.xml,
      …/<C-ID>/run.xml
    for the reviewed change id, and ObservedWriteScope that does not list them,
    auditScopeOutsideWriteScope / ngrace review reports **zero**
    review.scope-outside-write-scope on those paths. Given an additional
    out-of-scope production or docs path (e.g. src/secret.ts or docs/…), that path
    **still** raises scope-outside. A global suppress of all .ngrace/changes/**
    paths, or requiring run/ in ObservedWriteScope to pass, fails this criterion.

  AC-ARCHIVE-DETAIL-HONEST (F14)
    Given a bundle whose run/ contains only unrecoverable orphans (EVENT_FILENAME
    non-match or invalid-id class) and zero listLooseEvents, evaluateArchiveGate
    **permits** no-open-epoch and the requirement message **must not** be the
    string "run/ empty". The message must state that there are no foldable loose
    events and must name the orphan inventory (name and/or class). Given a truly
    empty or missing run/, the message may say the directory is empty / absent.
    Given ≥1 foldable loose event, archive still refuses. Do not mutate the
    preserved NaN fixture; tests use copies.

  AC-STATUS-OPEN-MEMBERSHIP (F15)
    On a project containing archive/C-TOKEN-INTEGRITY (or a fixture copy) with
    only NaN-T-001-opened.xml under run/, `ngrace status` reports open=0 (or omits
    open) for that change — **not** open=1 — while epochs folded count remains 1.
    A fixture with a real positive-integer loose event under run/ reports open≥1.
    Status and evaluateArchiveGate agree on whether an open foldable epoch exists.
    Orphan visibility is preserved via AC-ARCHIVE-DETAIL-HONEST and/or an explicit
    status/recover orphan signal (state which in the plan).

  AC-MUSTEXIST-ARCHIVE-IDENTITY (F16)
    For a plan resolved under archive/<C-ID>/ whose MustExist names
    .ngrace/changes/active/<C-ID>/<artifact> and that artifact exists under
    archive/<C-ID>/, detectConfidentlyWrong / ngrace review does **not** emit
    review.confidently-wrong for that claim. The same check still emits when the
    artifact is missing under both active and archive aliases, or when the path
    names a different change id whose file is absent. Applying a global string
    replace of active→archive for unrelated change ids fails this criterion.
    No archive file content is edited to clear the finding.

  AC-DOGFOOD-REVIEW-CLEAN-MEMBERSHIP
    After the above, on this repository at a clean tree:
      ngrace review --path . has **no** review.confidently-wrong from the two
      archived MustExist active/spec claims (F16).
      ngrace status does not show C-TOKEN-INTEGRITY open=1 solely due to the NaN
      orphan (F15).
      bun run ngrace lint --path . remains 0 errors, 0 warnings.
    (Other pre-existing findings unrelated to this bundle must be listed if any.)

  AC-SUITE-AND-LINT
    Red-first regressions for each AC above; bun test for touched packages green;
    bun run validate:ci green; ngrace lint --path . 0 errors / 0 warnings.
    No edits under docs/plans/archive/ or .ngrace/changes/archive/ except via the
    normal gate record path on active work; NaN orphan SHA-1 unchanged.

  Explicit non-criteria (wrong "fixes")
    - Deleting or renaming NaN-T-001-opened.xml
    - Teaching archive to refuse on orphans
    - Silencing review.confidently-wrong globally
    - Adding run/ to every plan's ObservedWriteScope
    - Recomputing stored archive Decision strings in historical ledgers

═══════════════════════════════════════════════════════════════════
OPEN QUESTIONS FOR THE AUTHORITY
═══════════════════════════════════════════════════════════════════

  Q1. Bundle shape: one C-REPORT-HONESTY vs split membership / review / lint?
      **Recommend:** one bundle C-REPORT-HONESTY with ordered tasks (membership →
      review → presentation). Split only if OWS size becomes unreadable.

  Q2. F12 / F9.8 skill gaps in this phase or leave for P1?
      **Recommend:** leave for P1 per decisions.md F12 / F9.8 disposition. Mention
      them in C-REPORT-HONESTY NonGoals so executors do not invent skill edits.

  Q3. F15 orphan visibility on status: open=0 only, or also orphans=N?
      **Recommend:** open=0 for orphan-only run/, plus a cheap orphans count on the
      change line *or* an explicit pointer that recover diagnose owns orphan
      inventory. Prefer orphans=N on status if one field is cheap — status was the
      surface that invented the false open=1.

  Q4. Shared module extract for listLooseEvents / listRunOrphans?
      **Recommend:** extract to a neutral module if status must stay free of
      grace-cursor imports; otherwise status may import listLooseEvents +
      listRunOrphans directly (cycle measured absent). Prefer extract for the
      "one definition" story in AC language.

  Q5. P0.9: baseline issues stay errors?
      **Recommend:** yes — framing line only. Downgrading would hide real baseline
      failures outside the in-progress narrative.

  Q6. Historical archive Decision strings saying "run/ empty"?
      **Recommend:** leave durable history untouched (corr-style: do not rewrite
      past records). Forward gate detail is honest; F14's sentence in
      C-TOKEN-INTEGRITY's ledger remains archaeological evidence of the bug.

  Q7. Incidental: gate ignores --dry-run / always records by default?
      **Recommend:** out of this bundle unless it bites again; document
      `--record false` for probes. Optional later: reject unknown flags.

  Q8. F11 exclusion: only the *reviewed* change id's lifecycle paths, or any
      C-*/run/ in porcelain?
      **Recommend:** any path matching
      `.ngrace/changes/(active|archive)/C-[^/]+/(run/|run\.xml$|run-ledger\.xml$)`
      is CLI lifecycle, regardless of --change filter — fold/review noise is not
      "someone else's authored scope". Still never exclude plan/spec.

DOCUMENT
  docs/plans/active/RM-GOVERNED-PATH/p0-report-honesty-derivation.md
```

---

## Summary for the authority

| Item | Verdict | Race / key fact |
|---|---|---|
| P0.7 | **correct** | Race **not** real (0/50); diagnostics only |
| P0.9 | **correct but under-specified** | No baseline framing line; need issue tagging |
| F11 | **correct** | Scope audit has no lifecycle exclusion; 23-shape reproduced |
| F14 | **correct** | Gate permits + says `run/ empty` with NaN present |
| F15 | **correct** | status `open=1` vs gate empty on same dir |
| F16 | **correct** | 2 standing confidently-wrong; corr 171 unused for MustExist |
| F12 / F9.8 | **correct** (docs) | terminal×0 in skill; attempt ordering unstated → **P1** |

| Unifying answer | F14+F15 share loose-event membership; F16 is corr 171 path identity; F11 is lifecycle exclusion — related family, two definitions + one exclusion, not one mega-predicate |

| Bundle | **One `C-REPORT-HONESTY`** for code; skills stay P1 unless overruled |

**Binding reminder:** Do not delete the NaN orphan. Do not refuse archive on orphans. Do not silence confidently-wrong without corr 171. Do not downgrade baseline assertions to fix P0.9.
