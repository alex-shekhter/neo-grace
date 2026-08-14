---
id: RM-GOVERNED-PATH
kind: plan
status: approved
supersededBy: null
created: 2026-08-09
updated: 2026-08-09
approved: 2026-08-09
baseline: 6.1.1
targets: [6.2.0, 6.3.0, 6.4.0]
context: ./decisions.md
---

# Governed path: make the checked route the cheap route

**Target repository:** `neo-grace` (`@neograce/cli`, 6.1.1 at `f340a98`)
**Audience:** the maintainer deciding whether to schedule this, then an executor coding agent
**Authority:** [decisions.md](./decisions.md) records seven ratified decisions (D1–D7) and nine
findings (F1–F9); [review.md](./review.md) carries the evidence, the root-cause analysis, and the
merge record of the two source consolidations. `review.md` frames the questions, `decisions.md`
answers them, this plan orders and specifies the work. Where this plan and either companion
disagree, **this plan wins.**
**Plan version:** 1.4 · 2026-08-09 (converted from
[sources/RM-GOVERNED-PATH-merged.md](./sources/RM-GOVERNED-PATH-merged.md); D1–D5 ratified; D6–D7 added during P0
execution)

> ## Approved for execution — 2026-08-09.
>
> Approved by the maintainer. All decisions are ratified (D1–D7,
> [decisions.md](./decisions.md)) and no question is open.
>
> **What the approval clears.** The objectives, the phase order, the sequencing rules in §1, the
> decisions, and the deferral/rejection lists (§4, §5). Work may begin.
>
> **What it does not clear.** The `targets` above remain **provisional** — a release commitment is a
> separate act per phase. Approval is not a licence to skip the derivation below: P0–P2's steps were
> written against HEAD, not against a files-touched analysis, and P3–P4 have no steps at all.
>
> **Execution model.** Phases become GRACE change bundles under `.ngrace/changes/`, per
> [../../README.md](../../README.md). A `C-*` spec names the roadmap plan and phase it implements.
> Each phase's execution detail is derived at its start (see the box below) and recorded before any
> bundle is authored.

> ## What this plan deliberately does not carry — and what must happen before each phase
>
> Per `docs/plans/README.md` rule 7, and the split that rule was written from:
>
> - **P0–P2 carry step detail** because the evidence for every step exists at HEAD and was
>   reproduced (`review.md` §4, §6).
> - **P3–P4 are objectives, decisions, and gates only.** Their steps are written when P0–P2 land
>   and produce the measurements they assume.
> - **No phase carries a *Files touched* table, a *Rollback* section, or step-level verify
>   commands.** Writing them before the phase starts would make speculation read as specification,
>   which is the exact failure the rule exists to prevent.
>
> **Therefore every phase begins with a derivation pass, before any bundle is authored:** fetch and
> confirm the baseline (`RM-AGENT-RELIABILITY` §0.4.1), re-derive the phase's steps against the tree
> as it then stands, produce the files-touched analysis, record every contradiction between the plan
> and the code, and propose the bundle split. **A step that reading contradicts is reported, not
> improvised around.** `RM-AGENT-RELIABILITY` §0 is the operating-contract precedent to instantiate
> at that point.

---

## 1. Phase status board

Keep this table current. It is the single source of truth for progress.

| # | Phase | Root causes addressed | Target (provisional) | Detail | Status |
|---|---|---|---|---|---|
| P0 | Reject, don't filter: the integrity cluster | RC-1 | 6.2.0 | steps | `COMPLETE` — **all ten declared P0 items (P0.1–P0.10) are delivered and archived, and every integrity finding discovered during P0 is closed.** The last was F35: the deduplicated clone helper had a **third** copy under another name, `cloneNode` at `gates/ledger.ts:165`, byte-identical apart from the identifier, which `AC-CLONE-XML-SINGLE-HOME` went green across because it counted one identifier. `C-SUBSTANCE-OVER-NAME` closed it and replaced the criterion with an identifier-insensitive AST shape match — verified against a copy under an invented name, in an untouched file, with its properties reordered. F20 and F29/F29.1 are **closed** by `C-CONTRACT-DEBT`. F18 and F18.1 are **closed** by `C-FLAG-HONESTY`; F24 and F25 by `C-LEGIBLE-FAILURE`, which also absorbed `C-LEDGER-READ-ABSENCE` (superseded, `d113f6a`) and so closed the three-exit ledger read; F21 and F22 by `C-ESCALATION-HONESTY`; F9.9/F9.10 by `C-SUBSTANTIATION-HONESTY`, which also closed F31 and F32 (recorded and closed inside the same bundle, so they never reached this board). F27 by `C-DECLARED-WRITES`. **The count: six → four → four → three → two → one → zero.** It moved down only when a bundle closed more than it discovered. It reached zero one bundle later than projected: the projection was stated before the survey behind it had been run, and `C-CONTRACT-DEBT` closed two findings while discovering one. D14's two owed repairs are **delivered** by `C-CONTRACT-DEBT` (object `cause` at both conversion boundaries; process-fault handlers at the CLI entry). Also carried, outside the count because none is a defect on a P0 surface: F30's disclosed residual on `AC-COMMIT-BODY-PROTOCOL`; F34/F34.1 (D14 clause 4 asserted a consequence — "the process can exit 0 with an error that was never reported" — that is false on Bun 1.3.14, where the default already exits 1 and walks the whole cause chain, so the mandated handler can only regress it unless deliberately built past it; the shipped handler matches exit code, chain depth and halting and adds a fault-kind label, but trades Bun's inline source excerpts); and F35.1 (a plan `TargetAssertion` already true at HEAD, recorded so its green is not read as evidence). Closing 6.2.0 over recorded findings on the surface the phase exists to make honest would be the board claiming ahead of reality. **Archived:** `C-TOKEN-INTEGRITY` (`a4b9ce7`) — P0.1, P0.2, P0.3, P0.5. `C-CURSOR-INTEGRITY` (`a4b9ce7`) — P0.4 (epoch bounds), P0.6 (orphan inventory + `cursor recover` diagnose/`--fix` + single-controller auto-open), P0.10 (`review.attempt-pair-unsubstantiated`), D8.8 (status open vs folded epochs), F10 (catalog namespace + `makeFinding` visibility). `C-RECOVER-FOLDABLE` (`a4b9ce7`) — F13 (`recover --fix` append-only effective-range supersession, covering ceiling, damaged-shape repair, clean E2E; fold half of `AC-RECOVER-FIX-PRESERVES-ORPHAN`). `C-CALIBRATION-COMMAND-EVIDENCE` (`eb5bbe7`) — P0.8 (command-evidence adjudication for `MustPassCommand`). `C-EXECUTION-CONTRACT` (`a944430`) — cursor event protocol documented in the execution contract (skills). `C-FLAG-HONESTY` (`267188b`) — F18 + F18.1 (citty boolean space form silently inverted intent and rebound free-form positionals; guarded class-wide across all 24 live boolean sites, coverage asserted from a live command-object walk). `C-REPORT-HONESTY` (`2ca3ae8`) — F14/F15 (one loose-event membership definition under artifact; status no longer imports the cursor; archive-gate detail honest over orphan-only `run/`), F16 + Correction 171 (archive-identity `MustExist` for same-id active↔archive paths), F11/F11.2 (CLI lifecycle paths excluded from scope audit), P0.7 (apply-gate no-verdict diagnostics: path/count/reason), P0.9 (baseline lint framing line; issues stay errors). `C-LEGIBLE-FAILURE` (`e9499e1`) — F24 (`M-CLI-INFRA` now owns the shared CLI infrastructure whose contract denied it, no file moved), F25 (the boolean-flag refusal routes through `runGraceCommand`, so `--format json` yields the declared envelope, text is one legible line, and the exit code comes from the error and is pinned rather than coinciding at 1), and F18's remaining seam via the superseded `C-LEDGER-READ-ABSENCE` (`readLedgerWrapper` is the sole three-exit ledger classification; the old null-collapse helper is deleted, not upgraded). Three findings came *out* of it: F25.1 (routing everything through the renderer erased every unexpected cause — repaired in the same task), F26 (a plan restatement dropped the spec's "at close" qualifier and became unsatisfiable), and the F23 widening past counts. `C-ESCALATION-HONESTY` (`0f63382`) — F21 (the fix budget counted attempts of any outcome, so a red-first red was charged as thrash; replaced by trigger R at 2 failed attempts of the same signature and trigger D at 4 distinct failing signatures, R evaluated first, the message naming the trigger that fired) and F22 (`paused-pending-approval` cleared by the agent that caused it; an escalation-clearing resume now refuses without a recorded `--reason`, stored as a child element that survives fold). The contract prose was rewritten at all four sites in both skill trees and bound to the constants bidirectionally. Three findings came *out* of it: F28 (the resume agreement assertion passed on the very file it existed to change — `--reason` was already present on an unrelated command — tightened in-task to pin the flag inside each command form), F29 (the D15 footprint pin counts lines, so this change's 9% character growth registered as zero movement), and F30 (a commit-body criterion the first commit of a multi-task change cannot satisfy without backdating a claim). `C-SUBSTANTIATION-HONESTY` (`20b9135`) — F9.9/F9.10 (the attempt-pair check asked whether production moved between a fail and a pass, which has no honest answer when the deliverable is a test or a document; measured across the archive it had raised 8 findings with 0 true positives, and it now raises only when the trees are identical outside `.ngrace/`, renamed to `review.attempt-pair-identical-tree`), F31 (the audit ran only under `--change` and was silent otherwise, while the scope audit in the same report declared `not-run` with a reason), and F32 (findings anchored at a hardcoded `active/` path that does not exist once a bundle is archived). One finding came *out* of it: F33 (a criterion naming a count measured at authoring but evaluated at close, where the change itself moves the count — the same family as F26 and F30). `C-DECLARED-WRITES` (`3197252`) — F27/F27.1 (a scope comparison existed but read the git working tree, so at close, with the tree clean, it honestly declined to run; the ledger's `WriteEvidence` is tool-generated from `git status`, survives fold and archive, and was never consulted — a second audit now reads it, raising `review.write-evidence-outside-scope`, with `docs/plans/` excluded as authority-owned and eleven evidence-less bundles reporting `unable-to-determine` rather than clean) and F27.2 (the prevention half: `ngrace-plan` now requires `ObservedWriteScope` to cover what the deliverable **forces**, since both historical breaches were forced by their own bundle's approved deliverable and by execute time the executor could only breach scope or fail the task). It found a real one: `C-EXECUTION-CONTRACT` wrote `src/test-support/token-accounting.test.ts` undeclared and undisclosed, adjudicated in F27.2 without touching the archive. `C-CONTRACT-DEBT` (`f10f868`) — F29/F29.1 (the footprint pin counted lines, so a 962-byte rewrite of agent-loaded skill text moved it by zero; `skillTextLines` now reports `totalBytes`/`perSkillBytes` **beside** the frozen line `total`, because two archived roadmaps cite that field at 636 and 723 and redefining it would falsify them, and the module comment's unsatisfiable "update every phase report that cites them" is replaced by the survey command that dissolves it), F20 (`cloneXmlNode` exported from `artifact/xml.ts`, the module declaring `GraceXmlNode`, with both private copies deleted and neither consumer re-exporting it — `xml.ts`'s own `SCOPE` was corrected in the same edit, since "Validation of .ngrace artifacts and path resolution" was an overclaim and leaving it would have closed F20 by reproducing F20 at the destination), and D14 clauses (i) and (ii) (one exported `asGraceCommandError` used by both conversion boundaries attaches the caught value as ES2022 object `cause` and writes the chain to stderr exactly once, stdout staying a pure envelope at unchanged `schemaVersion`; `unhandledRejection`/`uncaughtException` handlers installed only under `import.meta.main`, reusing that same chain walker rather than shipping a second one). Two findings came *out* of it: F35 (the third clone copy, above) and F34/F34.1. Its close is the first in this roadmap where both process audits ran and declared their coverage — WriteEvidence scope over 26 declared paths and attempt pairs over 6 fail→pass pairs, 0 findings each. `C-SUBSTANCE-OVER-NAME` (`3f26381`) — F35 (the third clone copy deleted, `gates/ledger.ts` importing the single export, and the post-condition restated as a TypeScript AST shape match over `src/**/*.ts` with the function's own binder as a hole, so a copy under **any** identifier is a hit; a normalized-body string compare would not have been enough, since each copy's body contains its own name and they therefore compare unequal), the `appendEpochToLedger` residual (both ledger-tree paths now clone through one definition; recorded as **structural**, since no behavioural test discriminates it), and F36's owed half (the orphan's byte length asserted before its digest, so a line-ending conversion reports 136 against 135 instead of two opaque hex strings). Disclosed limit: the scan sees the algorithm as this repository writes it — a copy recursing through `this.method`, or rebuilt with `Object.assign`, is a different body and is not a hit; a repo-wide clone detector is a NonGoal. Derivations: [p0-derivation.md](./p0-derivation.md), [p0-cursor-derivation.md](./p0-cursor-derivation.md), [p0-report-honesty-derivation.md](./p0-report-honesty-derivation.md). |
| P1 | The authoring surface: diagnostics, generators, skills | RC-4, RC-7 | 6.3.0 | steps | `COMPLETE` (all 14 steps delivered; the release commitment is a separate act) — — **steps 1–3 delivered and archived** as [`C-EXPLAIN-COVERAGE`](../../../../.ngrace/changes/archive/C-EXPLAIN-COVERAGE/). The review and gate catalogs are wired into `lint --explain` (23 codes that held populated guide objects and rendered boilerplate); exact guides authored for the 23 constructed codes the coverage test reported red after the wire, plus the five `change.task-*dependency*` codes, each bound to its **own** emitted message — the corpus's first-listed authoring failure (`review.md` §4 item 1) now names the three accepted `DependsOn` shapes instead of sending the author to move directories, and each sibling says *"the token is already a valid T-NNN"*, refusing the shared-copy defect rather than merely avoiding it. Text lint appends `(ngrace lint --explain <code>)` once per distinct error code, suppressed in JSON, asserted as a pair in-process and at the CLI. Close: review 0 findings, WriteEvidence scope audit 19 paths / 0 findings, attempt-pair audit 3 pairs / 0 findings, suite 1259 pass, ratchet 14 unmoved. **Seven findings came out of it, four of them scheduled as new steps 12–14 and one carried to the backlog:** F38 (`<Clarification>` unauthorable in all three families, vacating D12's approve gate — P1.12), F39 (lint calls 118 artifacts clean while 8 archived plans are not well-formed XML — P1.13), F40 (`assertion.MustContain` withholds the text it asked for — P1.14), F41 (the coverage predicate matched three boilerplate sentences this bundle deletes, so it passed unconditionally; repaired to bind the resolution path, and the F35 citation that caused it corrected — a rule restated in a word that had shifted meaning, which passed three reviews), F42 (a baseline `MustNotContain` whose needle is an AC id fires when a comment explains why that AC is not yet implemented), F43 (an XML artifact cannot quote XML, so a criterion binding its own prose to an emitted message carries a silent escaping gap — due again in P1.4/P1.5/P1.6/P1.12), F44 (a criterion pinning a user-visible string but not its position accepts two visibly different products — due in P1.6's typed-absence line), F45 (a red-first universal cannot cover a criterion half true by construction — due in P1.5), plus D17 (an AC id is an evidence anchor and freezes once a run event cites it) and the first worked instance of `RM-GITLESS-INTEGRITY`. **Steps 9 and 12 delivered and archived** as [`C-GRAMMAR-SEAM`](../../../../.ngrace/changes/archive/C-GRAMMAR-SEAM/). `<Clarification>` is authorable in all three families as one self-closing anchor child; both diagnostics and both `--explain` guides teach that form; and **`RM-AGENT-RELIABILITY` D12's approve and apply gates fire for the first time in this repository's history** — the element shipped unauthorable, so zero instances ever existed, and its originating AC had said *"without this the approve gate is vacuous."* It was. All eight teaching files moved in both trees, templates proven by filling their placeholders and linting the result. `<OptionalContext>` admits the two optional artifacts in `DurableScope` with extraction in `scope.ts`, constants unmerged. Close: review 0 findings, WriteEvidence scope audit 36 paths / 0, attempt-pair audit 4 pairs / 0, suite 1275 pass, ratchet 14 unmoved. **Five more findings:** F48 (a criterion enumerating diagnostics by HEAD trigger orphans a code when the repair moves the mapping), F49 (the repaired reader *filters* what it cannot interpret where P0's thesis says *reject*; the approve gate has zero lint requirements — deferred with the conflict stated), F50 (the plan's design note instructs expanding its own `ObservedWriteScope`, which its immutability forbids — inherited from the model plan twice), F51 (a measurement pin makes every file it measures a transitive forced write; 16 `SKILL.md` files sit under it), F52 (`change.plan-scope-exceeds-spec` compares `DurableScope` anchors at *warning* severity and never looks at file paths — the third check this bundle found weaker than its description). **Steps 13 and 14 delivered and archived** as [`C-ARTIFACT-VALIDITY`](../../../../.ngrace/changes/archive/C-ARTIFACT-VALIDITY/). `parseGraceXmlArtifact` now emits `xml.comment-not-well-formed` at error when a comment body holds two adjacent hyphens, **keeping the root** so the document's other diagnostics survive, and the code is new rather than a reuse of `xml.parse`, which compares validator-reject and no-root and would have claimed more than it verifies. Archive is not grandfathered as a class: a frozen nine-path allowlist admits today's offenders and the suite pins the exported constant to exactly that set, so a tenth errors instead of being absorbed. `evaluateTextContainment` names the file, the verb, the requested text via `JSON.stringify`, and for `MustNotContain` the first-hit offset — so two pins on one file are finally distinguishable. **The forward check is proved on the first file it could have caught:** this bundle's own plan, spec, run and ledger are now archived, none on the allowlist, scanned by the check they introduced, and clean — which is precisely what F39.1 said the previous repairs kept failing to do. Close: review 0 findings, WriteEvidence scope audit 19 paths / 0, attempt-pair audit 2 pairs / 0, suite 1286 pass, ratchet 14 unmoved, lint 0/0 across 127 artifacts. **Four more findings:** F54 (a closed path allowlist cannot be exact at a parse site that never learns the project root; the `file` argument arrives absolute from production lint and relative from tests, so the match is a normalized suffix and a same-named archived plan in a foreign tree is silently admitted — disclosed, exactness is a re-spec), F55 (`assertion.command-not-evaluated` prints four byte-identical messages for four different commands — F40's class on a code this spec excluded), F56 (the plan required four distinct T-001 fail signatures and `FIX_DISTINCT_SIGNATURE_BUDGET` is exactly 4, so the fourth planned red tripped the flailing detector and paused the task; red-first and the fix budget push in opposite directions, and the authority approved the collision without counting it), F57 (the bundle that made errors name what they withhold shipped an error that withholds *where*, though the scanner holds the offset and `NgraceIssue.line` exists — house behaviour, not a criterion violation, so recorded rather than blessed by a criterion authored at close). **Step 4 delivered and archived** as [`C-SCHEMA-REFERENCE`](../../../../.ngrace/changes/archive/C-SCHEMA-REFERENCE/). `docs/schema-reference.md` is rendered from `GRAMMAR_INVENTORIES`, a barrel over the same `Set` and array bindings the validators close over — proven by probe mutation rather than content equality, since a copied `Set` is indistinguishable from a live one by inspection. A closed fifteen-name registry drives both the document and `lint --explain`, dispatched registry-first, so a registered shape name prints its rendered section and a dotted issue code keeps its existing path untouched. `checkSchemaReference` is composed into `validate:ci`. **The drift check was proved by discrimination, not by a clean-tree no-op:** check mode exits 0 on the committed tree, 1 after a grammar inventory gains a member without regeneration, and 0 again on restore — which also proves the renderer reads live bindings. Close: review 0 findings, WriteEvidence scope audit 22 paths / 0, attempt-pair audit 3 pairs / 0, suite 1307 pass, ratchet 14 unmoved, lint 0/0 across 131 artifacts. **Three findings and a correction of a correction:** F60 forced glob semantics to ship as a NonGoal and inverted the P1.4 → P2.1 ordering above; F61 (the comment well-formedness check P1.13 shipped makes a dashed CLI flag unwritable inside any XML comment body, so artifacts must name the argv token and leave dashed forms to tests — a standing authoring constraint on every CLI-facing bundle); F62 (the authority's prompts have now three times asserted a lint expectation it had not measured, each caught by the executor); and a **correction to this session's own F21 correction**, which reported `FIX_ATTEMPT_BUDGET` deleted when it had been renamed to `FIX_SIGNATURE_REPEAT_BUDGET` and narrowed to exact kind plus key equality — a rename is indistinguishable from a deletion under a grep for the old name, so the repeat budget of 2 survives and caps planned reds a second way alongside F56. **Step 5 delivered and archived** as [`C-SKELETON-GENERATORS`](../../../../.ngrace/changes/archive/C-SKELETON-GENERATORS/). `ngrace spec new`, `ngrace plan new` and `ngrace scaffold` render from `GRAMMAR_INVENTORIES`, so a section the grammar gains cannot be missed by a copied list — proved by sentinel mutation of all three required-section inventories, not by content equality. **F63 forced the design**: the four spec/plan skill templates are *teaching* artifacts, not skeletons, and collapsing them to the CLI's required-core emission would have deleted the `Clarification` anchor-child example `C-GRAMMAR-SEAM` shipped while `SKILL.md` kept telling authors to copy from them. Resolved as **one renderer, two emissions** — the authority's proposed repair (byte-identity) was rejected by the executor as contradicting F63's own opening sentence, and it was right. `plan new` refuses to write beside a draft spec rather than emitting the pair lint rejects. Close: review 0 findings, WriteEvidence scope audit 45 paths / 0, attempt-pair audit 5 pairs / 0, suite 1344 pass, lint 0/0 across 135 artifacts. **This bundle did not close cleanly.** F64: the approved `ObservedWriteScope` missed three CI-load-bearing pins the deliverable inevitably falsifies — a `writeFileSync` inventory grep, a packed-files allowlist duplicated out of `release-check.ts` source, and a template content assertion — none of which any import-following review would surface, because they name no symbol the new code touches. The executor stopped rather than choosing between a scope breach and a failed task, which is what `ngrace-plan` requirement 6 exists to prevent. `approved_plan_immutability` directs a superseding bundle; **the user directed an in-place amendment as an explicit exception**, recorded as a deliberate departure in the bundle verdict rather than reframed as compliance. Two further findings from the close: F62.1 (a singular framing — "the trap is X" — is itself an unmeasured claim, because it asserts a search was complete) and F65. **Steps 10 and 11 delivered and archived** as [`C-TEACHING-SURFACE`](../../../../.ngrace/changes/archive/C-TEACHING-SURFACE/). Five skills — spec, plan, design, verification, cli — stop restating registered shapes and name their live sources instead; **not sixteen, and not as pointers.** `docs/schema-reference.md` says outright that it is not a complete schema, so a literal "delete the restatement, point at the reference" inversion would have dropped teaching no named source carries, which is F63 recreated one bundle after it was recorded. The approval lexicon ships with its named non-approvals, and the evidence doctrine — `TraceAssertion` plus tests is the default, `Marker` for runtime trajectory only — is installed in `ngrace-verification` and reflected in the polyglot. **F66 shipped as a function, not a sentence:** `checkDocsAndExamplesDecision` requires every *active* spec to decide `README.md` and `examples/`, archive grandfathered, because "a spec touching a user-visible surface" is not a predicate the grammar can evaluate. `checkTemplateFill` and `checkClaimedShapes` close F46's gap on the three remaining template kinds; `migration-report` gets well-formed-plus-pinned-children rather than fill-and-lint, since `NgraceMigrationReport` has zero grammar under `src/artifact/`. Close: review 0 findings, WriteEvidence scope audit 34 paths / 0, attempt-pair audit 4 pairs / 0, suite 1366 pass, lint 0/0 across 139 artifacts, `validate:ci` green. **The F64 repair held** — 35 explicit scope entries and one glob, every pin enumerated at authoring, and this close was not blocked. **Four findings, three raised by the executor unprompted:** F66 (the docs rule split out of F65, whose trigger is unimplementable as stated), F67 (a `signatureKey` keyed on the *test file stem* collides with the repeat budget when several pins share one file — the window is per-task, so this plan's split was legal but the spec never stated the rule), F68 (two planned reds against two exports of one module cannot be independently observed; the second fails naming the first, so the ledger key and the observed failure come apart, invisible to the attempt-pair audit), and F69 (the converted polyglot assertion inherited a sibling's *"without runtime log emission"* clause, false of a Go router that still emits `BLOCK_DISPATCH` — repaired by the authority at close and disclosed, since both Markers turned out to be emission-backed and the disjunction was never the defect). **Steps 7 and 8 delivered and archived** as [`C-ADAPTER-HONESTY`](../../../../.ngrace/changes/archive/C-ADAPTER-HONESTY/). `ngrace file exports` prints what the first matching adapter knows about a module's **authored** Path or a named file — adapter id, `exportConfidence`, sorted exports — and names a missing adapter instead of inventing a list. `graph.path-no-adapter` closes the case where a tier-1 Path linted green, and **`unverifiedLanguages` suppresses it** (authority ruling, reversing the draft: the existing warning's own text tells the author to acknowledge with that key, so a second code firing afterwards would make the acknowledgement false). The README check now walks live **invocations**, not roots — F70, which forced rows for **six invocations already undocumented before this bundle added a seventh**. Close: review 0 findings, WriteEvidence scope audit 29 paths / 0, attempt-pair audit 3 pairs / 0, suite 1389 pass, lint 0/0 across 143 artifacts, `validate:ci` green. **The step's premise did not survive construction.** Six temp projects showed the roadmap's "delayed IMPL=0 mystery" is missing `LINKS` and **adapter-independent** — a `.ts` Path with no markers is the same blocked shape — so there was no adapter-caused IMPL=0 to replace; the real silences were a SUMMARY tier-1 Path linting green and a wrong `MODULE_MAP` that never mismatches. **Third HEAD claim this phase to fail construction**, after P1.11's "permanently blocked" and P1.4's globstar, and the authority's own measurement instruction was wrong too (default `status` gates the module table on `includeModules`; `module show --with verification` never prints IMPL or an adapter). **Three findings:** F70 (the README check bound roots while the table documents subcommands — the authority reported the stronger claim), F71 (`getModulePath` names the authored field and returns a fallback to any linked file, which `module show` then labels "Graph Path"; binding the raw field is what kept the no-Path absence reportable), F72 (an absence check that ORs two conditions ships one message for two causes — a directory Path was reported as missing; repaired in-bundle by the authority and disclosed). **Step 6 delivered and archived** as [`C-AS-STATE`](../../../../.ngrace/changes/archive/C-AS-STATE/), and **P1 is complete**. `ngrace lint --as <status>` overlays a `ChangeStatus` onto the selected bundle, derives active-or-archive location from the status sets, and re-runs the artifact-pure rules plus the artifact-pure gate halves — approve in full, apply through a new entry point split out of the mixed evaluator. Ledger-dependent and verification-runtime classes are **not approximated**; they are reported as typed absence, and the coverage line survives `finalizeResult`, which rebuilds `summary` and would otherwise discard it. No new top-level `LintResult` key. **The step could not be built as written** — it demanded a *pure* preview of `target` and `final` while forbidding preview of anything impure, and `validateAssertions` is the impure evaluator of exactly those modes; it also named the wrong three states, since `approve` is fully previewable, `target`/`final` are not previewable at all, and the state where the absence count is genuinely non-zero is **`applied`**, which the sentence never mentions. **Fourth roadmap claim this phase to fail construction.** Close: review 0 findings, WriteEvidence scope audit 24 paths / 0, attempt-pair audit 4 pairs / 0, suite 1414 pass, lint 0/0 across 147 artifacts, `validate:ci` green. **Four findings, three correcting the authority:** F74 (a bare `D<n>` is ambiguous across plans, and one sat in a *normative* block — this plan's D5 is the separator rule while the typed-absence idiom is `RM-AGENT-RELIABILITY` D5), F75 (the approved spec counted its reds twice and the authority approved it; red counts live in `AC-HEAD-RED` alone), F76 (**the CLI silently ignores an unrecognised flag** — a transposed letter in `--assertions` runs the default mode and reports clean, found inside the bundle whose normative text is *"silence must not read as will pass"*), F77 (the coverage taxonomy is a hand-written conditional with no completeness guard, so a fourth impure class would silently under-count M). **P1 complete does not cut 6.3.0** — a release commitment is a separate act per phase. |
| P2 | Review honesty: one glob language, one audit universe | RC-2 | 6.3.0 | steps | `NOT STARTED` |
| P3 | Lifecycle mechanics and evidence honesty | RC-3, RC-5, RC-7 | 6.4.0 | objectives | `NOT STARTED` |
| P4 | The adoption path: brownfield as a first-class honest shape | RC-6 | 6.4.0 | objectives | `NOT STARTED` |

**Hard sequencing rules** — dependencies, not preferences:

1. **P0 → P3.1.** `lifecycle finish` folds loose epochs via P0.6. Without cursor recovery it
   inherits the dead-end it exists to remove.
2. **P0.6 → P3.1.** Stated separately because it is the specific item, not the whole phase.
3. **P1.1 → P1.2.** Wire the existing catalogs, let the coverage test report the real gap, then
   author only the delta. Authoring first re-does work already done in 76 existing guides.
4. ~~**P1.4 → P2.1's release note.**~~ **Inverted at P1.4's delivery — see F60.** This ordering
   assumed one semantics with review lagging behind it. There are two implementations now, so the
   reference could not state zero-depth `**` and did not. The dependency runs the other way:
   **P2.1 must delete the duplicate before any generated document can describe the rule.**
5. **P2.3 → P3.7.** The approve-event base ref (D3) is the same ledger record D1's detection rule
   keys on. The record must exist before anything reports on its absence.
6. **P3.1 → P3.7, and P3.7 → nothing.** The finding is inert until `lifecycle finish` writes the
   record, and it must never fire on bundles predating it (D1.4, F1).
7. **`C-CURSOR-INTEGRITY` → `C-TOKEN-INTEGRITY` closure.** F8.1: T-001's execution corrupted
   C-TOKEN's own epoch via P0.4. That bundle must not archive until P0.6's `cursor recover` can
   repair its ledger honestly. The two bundles are file-disjoint, so this is ordering only — no
   rework, and T-002–T-005 proceed meanwhile. **F9 adds a second reason for the same ordering:**
   this bundle's attempt records cannot substantiate red-first, and P0.10's reader is what makes that
   detectable rather than a note in a document.
8. **P0–P2 → P3's step detail.** The gate to write those steps is stated at the end of §2 P3.
9. **P1–P3 measurements → P4's open decisions.** Listed in P4.

P1 and P2 may run in either order or concurrently; they touch disjoint surfaces (authoring
diagnostics vs the review audit) and share only the schema-reference dependency in rule 4.

---

## 2. The roadmap

Baseline `6.1.1`.

### P0 — Reject, don't filter: the integrity cluster → target 6.2.0

**Objective.** Every unrecognized authored token becomes an error. No silent drops, no
`NaN`, no discarded intent.

This phase is framed as a **class fix, not three incident fixes**. RC-1's instances were
reported; the sweep finds the ones nobody hit yet.

**Steps.**

1. **The `.filter()` sweep.** Inventory every `.filter()` applied to authored input across
   `src/artifact/` and `src/project-utils.ts`. Each site is classified in the change bundle
   as *paired-with-an-error-path* (justified) or *silent discard* (converted). The inventory
   is a required deliverable, not a byproduct — it is what makes this a class fix.

   **Delivered by the derivation pass** ([p0-derivation.md](./p0-derivation.md)): 8 paired, 10
   silent discards, 1 partition companion. Seven of the ten were unknown before the sweep —
   `<Owns>` children, the `GD-*` and `VD-*` index lists, `parseAllocation` / `parseLedgerEvent`
   null drops, empty `<EscalatedTask>`, and non-task children under `ImplementationPlan`.

   **Site 11 was found afterwards, in review of the first bundle** — `<DependsOn>`'s anchor-child
   form (D7 / F5), which the sweep had classified as justified. **Eleven convert.** That the sweep
   itself missed one is the argument for its own review gate, not against it: the inventory is
   reviewed as a document precisely because a classification can be wrong.

   **All eleven convert in P0. There is no "leave it silent for now" outcome.** The two
   classifications are *already raises* and *must be made to raise* — "justified" means a paired
   error path exists, never that a silent discard is acceptable pending a later phase. A site may
   only leave the conversion list by being **reclassified on evidence** as already paired, with the
   raising code named. Deferring a detected silent discard would rebuild, inside the phase that
   exists to end silent discards, the exact thing it exists to end.
2. **`LINKS` / `DEPENDS` multi-value.** Accept **`[,;\s]+`** as separator (D5.1 — comma, semicolon,
   whitespace; **the colon is deliberately excluded**) so `LINKS: M-A M-B` works; emit
   `markup.unparsed-link-token` (error) for any token matching no `ANCHOR_PATTERNS` family, naming
   the token, the accepted separators, and the accepted families. The silent "Linked Modules: none"
   is the defect, not the separator.

   Preserve the existing `[...]` stripping and `none` handling (F3). `splitList` has exactly two
   callers, both in `parseGovernedFile`, so the widening cannot reach another field.

   **Why not the colon.** `LINKS: M-A: M-B` then yields the token `M-A:`, which matches no family
   and produces exactly this step's error — one edit to fix. Accepting the colon would make that
   slip silently work, which is filtering in the phase built to end filtering. See D5.1.
3. **`<DependsOn>` multi-value** (ag1 F-1). Split the text node on the same `[,;\s]+` set before
   per-token canonical-T validation; `<Task>` children remain the explicit form. Rewrite
   `change.task-invalid-dependency` to name **all three** accepted shapes.

   **Extended by D7 — site 11.** `readTaskDependencies` reads child *text* only, so
   `<DependsOn><T-001 /></DependsOn>` — the anchor form `Satisfies`, `DurableScope` and
   `AffectedAreas` all use, and which the shipped plan template sits directly above — **parses to
   nothing, silently.** It is live in archived `C-GATE-RECORD-ABSENCE`, whose `T-002` has never
   actually depended on `T-001`. The fix **reads the tag**; it does not raise. That makes it a
   repair under D5.3: the archived bundle gains the dependency it always claimed instead of turning
   red. The sweep classified this site as justified "empty cleanup"; **that classification is
   corrected to silent discard.**

   **F5.1 — the blast radius is three rules, not one declaration.** The empty set makes
   `change.task-unknown-dependency`, `change.task-self-dependency`, and cycle detection all pass
   vacuously (`grammar.ts:2031–2078`). Probed: `<DependsOn><T-999 /></DependsOn>` raises **nothing**,
   while `<DependsOn><Task>T-999</Task></DependsOn>` raises `change.task-unknown-dependency`. A plan
   may depend on a nonexistent task, or on itself, and lint stays green — if the author used the
   idiomatic shape. **The regression test must assert through the lint surface**, not an internal
   dependency set: `readTaskDependencies` is unexported, and the issue codes prove more.
4. **Numeric epoch bounds.** Validate `--from` / `--to` before `Number()`. The message names
   the accepted form and states that task ids are not event ids — the corpus shows
   `--from T-001` is the intuitive first guess.
5. **`<Owns>` text-vs-tag diagnosis.** When a `GD-*` / `VD-*` `<Owns>` section contains text
   where self-closing tags belong, say so directly instead of routing to
   `projection.graph.unlisted-anchor`, whose remediation ("synchronize GD-*/VD-* index
   ownership") is technically correct and useless here. Cost ag8 twenty minutes.
6. **Cursor recovery.**
   - *Auto-open for single-controller runs* (ag1 F-3, with its own condition): `advance` /
     `attempt` / `fold` with loose events, no open epoch, and **no `--worker` ever recorded
     for this change** synthesizes a retroactive `opened` event spanning the loose ids. If
     any explicit `--worker` appears in the ledger, refuse and demand the explicit epoch —
     multi-worker range assertions must never be silently fabricated.
   - *`cursor recover --change C-ID`*: diagnose loose events, unterminated ranges,
     out-of-allocation events; `--fix extend-allocation` performs a recorded, ledger-visible
     repair. Deleting `run/` stops being the documented recovery.
7. **Verdict diagnostics** (`review.md` §4.10). Reproduce first. If the race is real, flush
   before return; if not — the likely case — rewrite `gate.apply.no-verdict` to report where it
   looked, how many entries it found, and why the newest did not qualify.
8. **Calibration backfill** (ag3 §3.10). Doctor must not report archived epochs as pending
   `MustPassCommand` adjudication after a final `--run-commands` succeeded; re-derive
   adjudication from the ledger instead of snapshotting it.

   **Bound by D6 — read it before designing this step.** Taken literally this wording would break
   ratified Correction 156 (labels are stored at fold, never recomputed at report time; *"a corpus
   whose labels move is not a corpus"*). D6 corrects the reading: derive the snapshot from **recorded
   command evidence**, never from a live tree query, and use the existing `CalibrationRestatement` +
   `backfilled` bucket when evidence lands after fold. **No report-time call to
   `evaluateTargetComplete` may be introduced.** If the step cannot be built inside that constraint,
   stop and report — corr 156 is a wall, not a tradeoff.
9. **Mode-aware lint summary** (ag3 §3.7). When an active change has baseline assertions,
   default text output leads with one line — *"N baseline expectations (expected while C-* is
   in progress)"* — instead of presenting `MustNotExist` failures as generic breakage.
10. **Attempt-pair write evidence** (F9, discovered while verifying this phase's own T-002–T-004).
    Red-first is currently prose in `ngrace-execute` that nothing reads back, and the ledger for
    `C-TOKEN-INTEGRITY` records fail→pass pairs in which the implementation file is byte-identical at
    both ends. `<WriteEvidence>` already digests every `ObservedWriteScope` file on every attempt, so
    the check needs a reader, not new recording: **for a `fail` → `pass` pair on the same task, at
    least one non-test scope file must differ in digest.** Raise it in `ngrace review`, where evidence
    is judged; leave `cursor` quiet at write time, since a task may legitimately pass first try.

    **Weakened by F9.3 — read it before building this.** T-005's own red-first pair changed only its
    test file, because a test *was* the deliverable, and is structurally identical to T-002's suspect
    pair. A digest cannot read a claim, so this **raises a finding the reviewer must clear with a
    recorded reason** — detection, not prevention, at the R3/F2 ceiling. It still converts an
    invisible discrepancy into a written one, which is the point.

    Goes in `C-CURSOR-INTEGRITY` with P0.4/P0.6/P0.8 — same ledger-honesty surface, and that bundle
    is already sequenced ahead of this one's closure.

**Verification.** Each item lands with a regression test replaying the corpus transcript that
reported it (the reviews supply them verbatim: F-1's comma input, ag8's NaN sequence,
mistakes #7's fold sequence). A silently-dropped token must fail a test. Plus
`bun run validate:cli` and the dogfooding lint green.

**Release surface (D5.4).** Not a break is not the same as not visible: a project with a typo'd
`LINKS` has green lint today and red lint after. P0 therefore ships with a CHANGELOG entry listing
every newly-erroring code, and `lint --remediate` coverage wherever the fix is mechanical. Per D5.2
and D5.3 there is **no `NGRACE_ARTIFACT_VERSION` bump** — every conversion in this phase makes an
existing silent failure loud, and none turns a working state into an error.

**Review gate.** The `.filter()` inventory (step 1) is reviewed as a document, not just as a
diff: every site classified, every *silent discard* either converted or carrying a written
reason. A sweep that only fixed the three reported instances has not delivered this phase.

---

### P1 — The authoring surface: diagnostics, then generators, then skills → target 6.3.0

**Objective.** An agent can author a valid artifact without having read the TypeScript source
or the polyglot example — and when it gets something wrong, learns the fix from the error.

Ordering matters and is deliberate: **wire what exists, measure the gap, then author the
delta.** The alternative — a blind catalog pass over 76 existing guides — does work already
done.

**Steps.**

1. **Wire the review and gate catalogs into `lint --explain`** (`review.md` §4.7).
   `src/lint/catalog.ts` already imports from `src/review/catalog.ts`; consult the guide objects
   rather than falling through to prefix text. Add a **coverage test asserting every emittable
   code resolves to a surface-specific guide**, so this cannot regress.
2. **Author only the delta the coverage test exposes.** Each remaining code gets a fix-shape
   explanation — not "must be canonical" but "use `<Task>` children or comma/space-separated
   T-NNN ids." Priority order is the codes the corpus actually hit (`review.md` §4).
3. **Point at `--explain` in default output.** Text lint appends `(ngrace lint --explain
   <code>)` once per distinct code on errors. Suppressed in `--format json`.
4. **Schema reference, generated from the grammar.** Do **not** hand-write it — a
   hand-written schema doc becomes a second grammar that drifts. Generate
   `docs/schema-reference.md` from `src/artifact/grammar.ts` structure in a script, run in
   CI; extend `--explain` to shapes (`--explain graph-module`, `--explain module-contract`)
   backed by the same source, so there is exactly one truth. ~~Must document zero-depth `**`
   explicitly (see P2.1).~~ **Withdrawn at delivery — see F60.** The product implements glob
   matching twice and the copies disagree on zero-depth globstar, so a reference generated from
   the grammar cannot be the single truth about it. Glob semantics shipped as an explicit
   NonGoal, disclosed in the generated preamble. P2.1 owns deleting the duplicate; documenting
   the semantic follows that, not this step.
5. **Generators.** `ngrace spec new C-SLUG` and `ngrace plan new C-SLUG` write
   **valid-by-construction** skeletons — every mandatory section, canonical empty markers
   (`<None />`) where a section may legitimately be empty. `ngrace scaffold --module M-X`
   emits the exact `MODULE_CONTRACT` / `MODULE_MAP` block for the module's declared Path
   with correct ROLE / MAP_MODE / LINKS. **Acceptance test: generated output passes lint
   when committed unmodified.** That is what kills the discovery problem.
6. **`ngrace lint --as <state>`.** Evaluate a draft artifact under the rules that will fire
   at approve / target / final. Generators cover write-time; `--as` covers evolution-time of
   hand-edited artifacts. Non-overlapping, both needed.

   **Purity bound (normative).** `--as` may evaluate only rules that are pure functions of
   the artifact — grammar, shape, class-of-lint. Gate-time checks entangled with ledger or
   verification runtime context cannot be previewed honestly, and an approximate `--as`
   would be its own lie: an authored claim of doneness outrunning its evidence, which is the
   failure the product exists to prevent. This is the permanent shape, not a v1 compromise.

   **Absence reporting (normative).** Silence must not read as "will pass." Output reports
   *"evaluated N rule classes; M classes not evaluable at this state (ledger-dependent,
   verification-runtime)"* using **`RM-AGENT-RELIABILITY` D5**'s typed-absence idiom (*"two axes
   for claims, one value for absence"*, `docs/plans/archive/RM-AGENT-RELIABILITY/decisions.md`) —
   the tool's own coverage held to the rule it applies to everyone else. **The plan qualifier is
   load-bearing: this plan's own D5 is the separator rule** (see F74).
7. **Adapter export view.** `ngrace file exports --module M-X` prints exactly what the
   adapter considers exports — **read-only**. The two-iteration `MODULE_MAP` dance dies
   here. Auto-rewrite is deliberately deferred (§4 D3).
8. **No-adapter preflight warning.** When a graph module's `<Path>` has no adapter, lint
   emits a **warning** naming the consequence (contracts and health work; `MODULE_MAP`
   parity unverified) instead of today's delayed IMPL=0 mystery. Not an error: tier-1
   governance is a legitimate state per `RM-LANGUAGE-EXTENSIBILITY`.
9. **Optional-context DurableScope consistency** (ag3 §3.4). Allow `design-system.xml` /
   `invariants.xml` via a dedicated `<OptionalContext>` bucket — preferred over widening
   `<ContextArtifact>`, which keeps required-vs-optional semantics distinct. Flag for
   grammar-impact review.
10. **Skill emphasis inversion** (ag1 meta). Skills stop restating formats; each names its
    canonical shape sources (schema reference, `--explain`, polyglot) and spends its words on
    workflow. Add the **approval lexicon** (ag2 §4.10): exact approving phrases, and named
    non-approvals — "looks good", "continue", and questions are **not** approvals. Add the
    evidence doctrine to `ngrace-verification`: **TraceAssertion + tests is the default;
    Marker is for runtime trajectory only.**
11. **Polyglot rebalanced and enforced.** `examples/polyglot` currently teaches `Marker` by
    example, which is the rarer and harder evidence type; copying it verbatim makes every
    `V-M-*` permanently `blocked` (ag9 §2, mistakes #8). Rebalance so `TraceAssertion` reads
    as the default. Keep the example linted in CI and add a check that skills' claimed shapes
    resolve against it. **Widened by F46 (2026-08-12):** that check must also cover the two
    `references/*-template.xml` copy-sources, which return **zero** hits in the lint universe
    today — they are shipped for agents to copy and no surface validates them, which is how
    F38's unauthorable `<Clarification>` shipped inside a template. `validate:marketplace`
    only proves the two trees agree, so it is green when both teach a broken form. The
    checkable property is that a template's taught shape lints once its placeholders are
    filled — not that the raw placeholder file passes `ngrace lint`, which it cannot.
12. **`<Clarification>` is unauthorable — repair the shape and un-vacate the approve gate**
    (F38, added 2026-08-12 during P1's first bundle). `grammar.ts:1623/1637` requires a
    `target` attribute holding a canonical `IC-*` / `INV-*` / `AC-*` anchor;
    `grammar.ts:257–265` rejects any canonical anchor in any attribute value. All three
    advertised families were probed and all three error, so the element cannot be authored at
    all, and D12's approve gate — which reads `node.attributes.target` at
    `src/gates/core.ts:181` — can never fire. Move the target to a self-closing anchor **child**,
    matching `<AffectedAreas><M-X /></AffectedAreas>`; do **not** exempt the attribute from
    anchor discipline, which would trade wall §3.5's grep-stable anchors for one element's
    convenience. Carries a gate-side reader change and the skill text that teaches the element.
    Sequence with step 9: same file, same class of change.
13. **Lint accepts artifacts that are not well-formed XML** (F39, added 2026-08-12 during P1's
    first bundle). `ngrace lint` reports every XML artifact clean while a **growing set** of
    archived plans is rejected by a conformant parser (8 when recorded, 9 by 2026-08-13 — see
    F39.1; re-measure, never cite the count) — uniformly `--` inside an XML comment,
    forbidden by XML 1.0 §2.5, accepted by `fast-xml-parser`. Guaranteed by two conventions
    meeting: plans carry a binding `DESIGN` comment block, and the product being designed is a
    CLI whose every flag is `--`. Nothing is broken today — the product's own parser reads them
    — so the defect is the report's claim of a validity never checked. **The repair must settle
    how the archive is treated**: every offender is archived and immutable, so the check is scoped to
    active bundles, or warns with the archive grandfathered, or immutability is re-examined —
    argued, not assumed, since a check that excludes the files that motivated it is its own F28.
    Sequence with step 12: both are artifact-validity repairs under `src/artifact/`.
14. **`assertion.MustContain` withholds the text it asked for** (F40, added 2026-08-12 during
    P1's first bundle). `src/artifact/assertions.ts:361` renders `${fileValue} must contain
    requested text.` and never interpolates the text, which is in scope at that line. Approving
    a plan whose `MustContain` subject is one file seven times produces seven identical lines
    and an empty `detail` in `--format json`; the executor must read the plan and bisect by
    hand. This is P1's objective failing in its purest form — the diagnostic knows the answer
    and declines to print it — and the same class as P0.7 and `C-LEGIBLE-FAILURE` on a surface
    neither reached. Include the requested text, the file, and for `MustNotContain` the offset
    of the first hit. Sequence with steps 12–13: all three are `src/artifact/` repairs.

**Verification.** Golden-file tests per generator (generate → lint → green); a review-replay
fixture running each corpus authoring failure against the new messages, asserting the fix
shape appears; a skills audit confirming no skill restates a format the schema reference owns.

**Repo hygiene.** Steps 10 and 11 are skill-text and example changes: canonical
`skills/ngrace/*` and the packaged mirror `plugins/ngrace/skills/ngrace/*` change in the same
commit, and `bun run validate:marketplace` must be green.

---

### P2 — Review honesty: one glob language, one audit universe → target 6.3.0

Highest value relative to size (E1: 8/10). Review is the product's honesty surface; today it
cries wolf 14 times out of 19 and teaches every agent to verdict `pass` with a justification
paragraph. **The cure is attribution, not suppression.**

**Steps.**

1. **Delete the duplicate glob matcher** (`review.md` §4.6). Remove `matchSimpleGlob`; route
   the scope audit through `src/artifact/scope.ts`. One glob language, one implementation.

   **Direction constraint (normative).** The dedup runs **review → `scope.ts`**, never
   `scope.ts` → `matchSimpleGlob`. The reverse would be a genuine retroactive break:
   previously-explained drift becomes unexplained and preflight verdicts flip. In the
   permitted direction the change can only *widen* what review accepts, so it cannot make an
   approved plan permit less or create a new violation.

   **Release note.** An author who wrote `web/js/**/*.js` intending "subdirectories only"
   loses the one surface that ever flagged the mismatch — that intent was unenforced
   everywhere else, so the fix stands, but the CHANGELOG must say: *"review may report fewer
   findings for `**` patterns adjacent to top-level files; this is deduplication toward
   git/minimatch semantics."* ~~The schema reference (P1.4) states zero-depth `**` explicitly.~~
   **It does not — see F60.** P1.4 shipped glob semantics as a NonGoal, so this release note
   cannot lean on the reference. P2.1 must both delete the duplicate matcher and land the
   documentation itself.

   **Pinned test.** `web/js/**/*.js` × `web/js/app.js` asserted at both call sites. This is
   also this plan's first conformance test and the falsifier for `review.md` §4.6's trace.
2. **Exclude CLI-authored lifecycle files.** `run-ledger.xml`, `run.xml`, `run/*.xml` of the
   *reviewed* change are never "outside write scope" — the CLI wrote them, and auditing the
   CLI's own writes against the agent's declared scope is a category error. Scope the
   exclusion to exactly the reviewed bundle. `.ngrace/graph`, `.ngrace/verification`,
   `.ngrace/context` writes **stay audited** (ag1 F-2's own condition): those are real
   durable writes that must be declared.
3. **Bundle-stored base ref.** At `gate approve`, record `BaseCommit` into the change's
   run-ledger — a recorded fact, not authored plan state, consistent with §3.3.
   `ngrace review --change C-ID` then defaults its universe to `base..working-tree`
   name-only instead of raw porcelain: pre-existing dirt never enters the audit. No-git
   fallback keeps porcelain **and prints the explicit caveat** ("no base commit — cannot
   attribute pre-existing changes"), so the weaker audit is never silent. Existing
   `--base` / `--changed-files` remain as overrides.

   **Settled by D3.** The ref lives in the change's `run-ledger.xml`, written by `gate approve` as
   part of the approve event. The repository-scoped half of the question belongs to P4.2's adoption
   boundary, not here. This is also the record D1's detection rule keys on (P3.7), so its shape is
   load-bearing beyond this step.
4. **Drift credit from applied bundles** (ag9 #4/#10). `status`'s unexplained-drift detector
   consults **applied** bundles' `ObservedWriteScope`s before declaring drift unexplained: a
   file matching an applied bundle's scope is "explained by C-*", not drift. Removes the
   permanent post-bootstrap refresh nag without weakening detection — the credit is only as
   broad as scopes a human approved.
5. **Finding severities.** Findings gain `error | warning | info`; `--severity` filters
   output. Named profiles ("land", "hotfix") are rejected — severity is model-honest,
   profiles are taste. After items 1–4, remaining low-value findings (change-meta notes) are
   demoted to `info` so the default view is signal.
6. **Honest nextAction** (ag2 §4.3, cheap half). `status` nextAction for unexplained drift
   never recommends committing; it recommends refresh/ratify. The full process grade is
   deferred (§4 D1).

**Verification.** Fixtures reproducing each corpus audit (ag1's 14/19, ag10's 45-flagged)
must come out clean; a fixture with genuine undeclared source writes must still fail; a
no-git fixture must print the caveat.

**Success metric, stated up front: on the corpus's own transcripts, scope findings drop ≥80%
while every planted real violation is still caught.**

---

### P3 — Lifecycle mechanics and evidence honesty → objectives; detail when P0–P2 land

> **Objectives, decisions, and gates only.** The numbered items below are *what this phase
> delivers*, not *how*. Their steps are written after the gate at the end of this section.

**Objective.** No step of the change lifecycle exists only as folklore, and "documented
verification" can no longer drift from "executed verification" undetected.

1. **`ngrace lifecycle finish --change C-ID`.** One operation that, after a permitting
   `gate apply`: folds any loose epoch (via P0.6), sets `status="applied"` on spec and plan,
   moves the bundle to `archive/`, and records each action in the run-ledger. `--dry-run`
   prints the full mutation list and is the default in any ambiguous state. Gate output
   learns to print `next: ngrace lifecycle finish --change C-ID`.

   **Why a separate command and not a gate flag.** A29.2 (`RM-AGENT-RELIABILITY/plan.md:4580`,
   "Correction 49") is ratified and explicit — *"This is a correction, not a design
   question… The gate does not itself set `status` or `git mv` the bundle… The agent still
   performs the authored write after a permitting decision."* It is cited at
   `src/gates/command.ts:15`, in the CLI help, and in shipped `ngrace-execute` skill text.
   A29.2 constrains **the gate**; it is silent on a separate verb. `lifecycle finish` follows
   the `graph split --apply` precedent that invariant 8 / F1 was restated from: explicit
   verb, explicit apply, dry-run default, fail-closed.

   **Settled by D1 — and settled harder than this step assumed.** `approved → applied` is
   structural state *explicitly given*, so this command writes `status`. Beyond that, it becomes
   the **only sanctioned writer** of that transition: a hand-written `applied` is a reportable
   defect (P3.7). `draft → approved` is untouched and stays authored.

   The line between them is that apply has a machine-evaluable precondition — the gate — and
   approve has none. **Record that reason wherever this is implemented**, or a later reader
   "fixes" the asymmetry in the wrong direction.

   **D1.5 — the forced apply is not optional.** `--force` writes a ledger event naming the apply as
   forced with an operator-supplied reason. Without it, a gate that refuses for a bad reason leaves
   no sanctioned exit, people hand-write anyway, and the record becomes *worse* than before D1: the
   same write, no longer distinguishable from a tooling gap. Ship it with the command, not after.
2. **`ngrace plan amend`.** Whitelist: additive `ObservedWriteScope` entries, additive
   `<Satisfies>` mappings, task `Title` text. Forbidden: assertions, `DurableScope`, task
   structure — supersede-only. Every amendment is a ledger event with `--reason`, and
   `review` / `gate apply` **surface the amendment list prominently**. Amendments thereby
   become *more* auditable than a supersede that buries the old plan, and remove the
   incentive that produced mistakes #9 and #11 (editing approved artifacts in place).
3. **MustPass coverage check** (ag3 §4.1 — the auth-e2e failure class, E3). Plan lint: every
   `V-M-*` Command referenced by the change's MustVerify set that is not ⊆ the plan's
   `MustPassCommand` / task Verification set is an error — with an explicit
   `<EvidenceWaived>V-M-*</EvidenceWaived>` opt-out so deliberate deferral is a recorded
   decision, never silence.

   **Binding, normative.** `<EvidenceWaived>` waives **command execution mirroring only**.
   It does **not** extend to marker emission or any other health signal — see P3.4 and
   §5 R2. Widening it would let a change-bundle artifact author the durable readiness
   picture, crossing the lint/health wall in its least visible direction.
4. **Marker discipline, split correctly by surface.**
   - *Author-time anchor check (lint surface).* At plan/verification lint, a declared
     `<Marker>` requires a resolvable `START_BLOCK_*` anchor in a linked runtime file. Moves
     the mistakes-#8 failure from module-health time (post-execute, both artifacts immutable)
     to authoring. Extends 6.1.0's near-miss warnings.
   - *Deferred emission (health surface).* Per `review.md` §4.1, emission absence is a
     **report**, not a gate. Add `<MarkerPending>` as a sibling in the verification entry —
     agent-1's own parenthetical, which both source plans dropped in favour of a knob. The
     marker stays declared; health reports *"declared, emission deferred"* as a named state
     instead of collapsing it to `blocked`; `autonomyReady` stays honest (still not ready —
     which is true). Nothing is suppressed at project, bundle, or gate level, and the
     deferral lives where the marker lives.
5. **`ngrace verification --run`** (ag8 suggestion 2). Executes every `<Command>` (or
   `--module M-X` subset); prints pass/fail/duration; **advisory only, never gate-consumed** —
   the same discipline doctor already applies to calibration. This is the agent's pre-flight
   before `--assertions final --run-commands`, not a parallel evidence system.
6. **Verdict `--dry-run`** (ag9 #7). Prints exactly what would be recorded.
7. **Hand-written status detection** (new, required by D1.3). Review gains a finding for an
   `applied` status with no corresponding ledger record. **Without this, D1 is inert** — nothing
   anywhere observes the difference between a permitted apply and a word typed into a file, which is
   the entire value D1 claims.

   **Not retroactive (D1.4, F1).** The finding fires only where the ledger carries an approve event
   from the gate surface. Measured 2026-08-09: **all sixteen** archived bundles in this repository
   are hand-written `applied`, and three carry no ledger at all. A naive rule reports sixteen
   violations against its own history on the day it ships.

   **Detection, not prevention (F2).** Nothing stops an agent writing seven characters into an XML
   file, and this repository already refused the posture that pretends otherwise (§5 R3). This
   finding makes a dishonest apply *visible afterwards*; it does not make one unavailable.

**Gate to write P3's step detail.** P0–P2 shipped; the author re-runs one brownfield
transcript end-to-end and counts remaining folklore steps. Targets from ag10's accounting:
bundles for a bootstrap ≤ 3, manual post-gate steps = 0. *(The design question that also gated this
detail is answered — D1.)*

---

### P4 — The adoption path: brownfield as a first-class honest shape → objectives only

> **Objectives and open decisions only.** No step detail is written, and none should be until
> the P1–P3 measurements this phase's decisions depend on exist.

**Objective.** Resolve E4/RC-6. The current trap — init skeleton → pressure to land →
freestyle → retroactive-C-* ban → "commit and live with no lifecycle history" — is the
largest process failure in the corpus and the reason ten guides exist.

Three layers, deliberately minimal and complementary:

1. **`ngrace graph scan --draft`** (convergent: ag5 P1, ag6 idea 1, ag8 suggestion 1,
   ag10 §4.5). Adapter-driven inventory — packages, entry points, existing test commands —
   emitting **draft** graph/verification artifacts marked draft, never durable truth. The
   human edits; nothing scans its way into the model unreviewed. Scaffolding, not bypass:
   it feeds layer 2.
2. **Adoption boundary record.** A recorded adoption point declaring that everything preceding it
   is out of scope *by construction*. This is not a retroactive `C-*`: it makes no claim that prior
   work was specified, reviewed, or approved. It states a boundary. One primitive resolves four
   symptoms: the permanent unexplained-drift recommendation, review noise from pre-existing files,
   the first change's unsatisfiable clean baseline, and the freestyle-land dead end.

   **Shaped by D2.** The primitive is a **declaration plus a path inventory**; where git exists a
   commit ref is a cheaper, stronger expression of the same thing and is used. **The design order is
   the decision** — build the ref as the primary shape and the first non-git project forces a
   rebuild, which is what asking the question was meant to avoid. Contents at the boundary are not
   needed: all four symptoms turn on *which paths* predate adoption, and hashes would buy only the
   tamper detection deferred at §4 D4.

   **D2.1 — an unresolvable ref is a named absence.** Rebase, squash-merge, force-push and shallow
   clones all break a ref, and this record is permanent, so that is ordinary rather than exotic. Use
   the shipped absence vocabulary; **never** fall back silently to treating everything as drift,
   which would restore the exact nag this primitive exists to remove. Record the inventory alongside
   the ref even where git is present.
3. **Adoption change kind, with ratify semantics** (ag2 §4.2, ag10 §4.14). A spec whose
   `<Problem>` is "the repository's current state is unmodelled", whose baseline assertions
   are an **inventory** (record what *is*, not what should be), and whose apply semantics are
   **ratify**: these files *are* current state; a human accepts; archive without pretending
   the work was planned.
4. **Guide collapse.** The corpus's brownfield guides reduce to one canonical in-repo document
   carrying only what the product genuinely cannot: human approval discipline and host
   differences. Everything else must have been absorbed into P0–P4 machinery.

   **Settled by D4: this is a `C-*` bundle in this repository, and the acceptance test is the
   bootstrap benchmark (§6), not the external guide count.** The guides are files in another
   directory owned by other people; a bundle asserting they shrank carries a claim it can never
   honestly verify — the documented-but-not-executed failure this plan exists to fix, committed by
   the plan itself. Guide count is demoted to an observation recorded afterwards. The benchmark is
   also the better test of the same claim: guides shrinking is a lagging indicator of an adopter not
   needing one.

**Open decisions, written after P1–P3 measurements:** whether layer 3 is a grammar addition
(`kind="adoption"` → `graceVersion` decision) or a spec convention plus review profile; how
ag2 §4.6's phased land templates become the *doctrine* for splitting adoption into reviewable
waves rather than product machinery; and how layers 2 and 3 interact with P2.4's drift credit.
*(The non-git question that sat here is answered — D2.)*

**Explicit boundary.** HTML/CSS/shell **adapters** (ag2 §4.9, ag3 §3.8, ag9 #4/#5) belong to
[`RM-LANGUAGE-EXTENSIBILITY`](../RM-LANGUAGE-EXTENSIBILITY/review.md), not this track. This
track ships only P1.8's preflight warning and — if evidence warrants — a link-or-exempt health
surface so unmarked non-test files in governed packages become a *named* state rather than a
silent one, as doctor/health information first, never a lint error.

---

## 3. Load-bearing walls — do not touch

The corpus overwhelmingly agrees these are correct (ag1 "what I would not change", ag2, ag6
§5, ag9). Every accepted item was chosen to preserve them.

1. **Lint/health separation** — structural integrity gates; autonomy-readiness informs.
   `review.md` §4.1 shows how easily this is misread; P3.4 and §5 R2 are shaped by it.
2. **`MODULE_MAP` parity enforcement** — the feature everything else proves. See §5 R1 and
   §4 D3 for why the two proposals to soften it are refused.
3. **Gate purity: evaluate and record, never author status** (A29.2 / A31.1). Hence
   lifecycle completion is a separate command, not `gate --execute`.
4. **Immutable approved plans; supersede for substantive change.** Hence `amend` is
   whitelisted, ledger-recorded, and review-surfaced.
5. **XML tags as semantic anchors** — grep-stability is the navigation model.
6. **`gateFailOn: errors` default and the D11 honesty gate.**
7. **`refresh` is report-only.** It does not freestyle-mutate the durable model; ag3 §2.7
   names this as correct and it is easy to erode while building P4.
8. **No retroactive change bundles for applied work.** P4's adoption kind is not a hole in
   this rule — it is the rule's missing complement: an honest terminal state for work that
   predates governance, ratified by a human, recorded forever, and explicitly labelled
   adoption rather than planned change.

---

## 4. Deferred, with reasons and re-entry conditions

| # | Suggestion | Why deferred | Re-entry condition |
|---|---|---|---|
| D1 | Full "process grade" beside module health; CLI-level commit enforcement (ag2 §4.3/4.4, ag9 #10-lite) | The cheap honest half ships as P2.6. A grade that folds host git state into the durable model needs design evidence, not enthusiasm | After P2/P4, measure whether drift + adoption output is still ambiguous in practice |
| D2 | Fail-closed detached review; `doctor --host` capability matrix (ag2 §4.5, ag3 §3.6, ag9 #5/#8) | 6.1.0 shipped honest verdicts; hard fail-closed would break hosts legitimately lacking subagents. The cheap half — surfacing `review: degraded` in status — belongs with D1's grade rather than shipping alone | When host-capability detection has real implementations to key on |
| D3 | `lint --fix` auto-rewrite of `MODULE_MAP` (ag5 P2) | Parity friction is the *point*: an auto-fixer converts "a human looks at API drift" into "the agent regenerates and moves on," and the map could then never contradict the code. P1.7's read-only view removes most of the pain without the hazard | Only with a designed-in show-the-diff-and-acknowledge flow, and evidence the read-only view is insufficient |
| D4 | Tamper-evident / signed status transitions (ag9 #9) | Real threat model, wrong phase — and the party who would forge a signature is the agent holding the key. The run-ledger plus signed git commits is the honest record today; PKI adds key management to a small CLI | Standalone exploration, modelled on `RM-LANGUAGE-EXTENSIBILITY`'s review-only pattern |
| D5 | Evidence-strength tiers L0–L3 in doctor (ag2 §4.7) | Goodhart risk: graded evidence invites optimizing the grade. 6.1.0's `claimedConfidence` is deliberately not gate-consumed | Revisit as calibration *information* only, never a gate |
| D6 | Guided baseline revert, batch gate ops, supersede dry-run preview, `status --visual`, spec/plan show subcommands (ag7 §4.6/4.10, ag10 §4.8/4.11/4.12) | Bundle sprawl and revert confusion are symptoms P0/P3/P4 treat at the cause; these treat them at the keyboard | Re-propose only what still hurts after P3 |

---

## 5. Rejected, with reasons

| # | Suggestion | Why rejected |
|---|---|---|
| R1 | **YAML/TOML dual authoring format projecting to XML** (ag4, ag5 P4) | Two representations of one truth is a drift machine — the authored file and the projection *will* disagree, and the projection is what lint trusts. It breaks wall §3.5: tags are the anchors, and YAML has no grep-stable tag identity. The pain it treats (escaping, verbosity, authoring from memory) is fully treated by P1's generators, schema reference, and prescriptive errors. Note that the reviews calling XML brittle are the same ones naming grep-stable `<M-API />` the best decision in the product — they describe an authoring-tool gap, not a format problem. Highest second-order cost of any suggestion in the corpus |
| R2 | **`markerEmission: required \| deferred-allowed \| off` policy knob** (ag1 F-4) | Two independent reasons. First: a project-wide knob that downgrades a blocking signal will be set to silence it — ag1's own stated risk, and F-4 is the one item its author flagged as adding a state rather than removing friction. Second, and decisive: `review.md` §4.1 shows the signal is **not a gate** — no gate or lint consumes module health — so the knob would suppress an honest *report* while the thing it claims to unblock was never blocked. The underlying need (deliberate deferral must be recorded, not silent) is met by P3.4's `<MarkerPending>` in the verification entry, where the marker already lives. Default stays strict; nothing becomes project-wide invisible |
| R3 | **Sandboxed `gate enforce` blocking workspace edits** (ag5 P3) | Sandboxing is host territory; a CLI that refuses file writes is one shell alias from being bypassed and creates a false sense of a hard guarantee. neo-grace's real answer to skipped approvals already works: every transition leaves a durable record, and status/doctor surface its absence. Ship the sample pre-commit hook (`ngrace status --fail-on drift`) as documentation, not machinery |
| R4 | **Fast-track / patch bundles bypassing the lifecycle** (ag4 suggestion 4) | Directly contradicts the strongest cross-review finding (ag2 §3.2/3.3: leaving the rails is already too easy; green lint with no `C-*` is the failure mode). T0–T3 already modulate depth. Ceremony is also not what the corpus shows hurting — ag1 excluded it explicitly, ag3/ag8/ag9 judged it worth paying; the pain is *rework*. The correct cure is P0+P1+P3 making the governed path mechanically cheap enough that bypass pressure disappears |
| R5 | **Grace period: relaxed review rules for young projects** (ag10 §4.15) | Maturity-based two-rule systems are gameable in both directions, make the least-understood phase the least checked, and contradict E4's actual fix — P4 makes young projects *honest*, not *lenient* |
| R6 | **Leave the two glob matchers as they are; hint and document only** | Withdrawn by its author on evidence. It assumed one grammar whose semantics needed protecting; `review.md` §4.6 shows there are two, that the binary already contradicts itself on the same plan and file, and that no enforcement surface ever honoured the strict reading — drift detection and parallel preflight both already use the wide one. The feared retroactive permission change is phantom in the permitted direction. What survives is P2.1's **direction constraint** and release note, not the rejection |

---

## 6. Cross-cutting verification strategy

1. **Review-replay fixtures.** P0–P2 each carry fixtures replaying the corpus's actual
   failing transcripts — F-1's comma input, ag8's NaN sequence, ag10's 45-file audit,
   mistakes #7's fold sequence. **The plan fails its own standard if any of those still
   reproduces.**
2. **The falsifier for `review.md` §4.6.**
   `rg -n 'matchSimpleGlob|observedWriteScopeContains' src/ | rg -v test`
   returns three consumer sites and one divergent matcher; the behavioural repro compares
   `observedWriteScopeContains({files:[],globs:['web/js/**/*.js']}, 'web/js/app.js')` against
   the inlined regex at `review/core.ts:889`. P2.1's pinned test is that comparison. If the
   trace is wrong the test catches it before any code is deleted. *(Both halves re-run at
   conversion time on 2026-08-09 and held — `review.md` §6.)*
3. **Bootstrap session benchmark.** After P3, and again after P4: one fresh agent session
   performing a full brownfield land on a fixture repo. Metrics borrowed from ag10's honest
   accounting — mistake count, bundle count, manual post-gate steps, minutes-to-first-green-
   review. Baseline from the corpus: 13 / 8 / 3+. **P3 gate: ≤3 bundles, 0 folklore steps.
   P4 acceptance: no companion guide required.**

   **Per D4 this is also P4.4's acceptance test**, replacing the external guide count. It is the one
   measurement in this track that is both in-repo and repeatable on demand, which is why the phase
   with the least machine-checkable deliverable is pinned to it.
4. **Noise floor.** P2 must demonstrably preserve detection: fixtures with planted real
   violations — undeclared source write, scope creep across modules — still produce errors at
   the pre-P2 rate.
5. **Repo hygiene per this repository's own rules.** Canonical skills and packaged mirrors
   change in lockstep; versions synchronized across the four release surfaces;
   `scripts/validate-marketplace.ts` and `validate:cli` green; this index row in
   [../../README.md](../../README.md) updated in the same commit as any status change here.

---

## 7. Decisions

Every question this plan opened was **ratified 2026-08-09** and moved to
[decisions.md](./decisions.md), which carries the reasoning. Summarized here so this section
remains readable alone:

| Decision | Answer | Threaded into |
|---|---|---|
| **D1** | `approved → applied` is structural state *explicitly given*. The tool writes it, and is the **only sanctioned writer**; a hand-written `applied` is a reportable defect. `draft → approved` stays authored. The line is the machine-evaluable precondition. Requires a recorded forced apply (D1.5) and a non-retroactive detection rule (D1.3, D1.4) | P3.1, P3.7 |
| **D2** | The adoption boundary is a **declaration plus a path inventory**; a commit ref is a compression of it where git exists. An unresolvable ref is a named absence, never a silent fallback to drift | P4.2 |
| **D3** | The base commit lives in the change's `run-ledger.xml`, written by `gate approve`. The repository-scoped half of that question belongs to the adoption boundary | P2.3 |
| **D4** | Guide collapse is a `C-*` here, and its acceptance test is the bootstrap benchmark — **not** the external guide count | P4.4, §6 |
| **D5** | `LINKS` / `DEPENDS` split on `[,;\s]+`, colon excluded; unrecognized tokens are errors naming token, separators and families. Plus a standing rule: **making a silent failure loud is not a compatibility break; turning a working state into an error is.** No artifact version bump; P0 stays a minor release | P0.2, P0.3, and the whole track |
| **D6** | P0.8 derives adjudication from **recorded evidence**, never a current-tree query. Fold-time storage of `CalibrationAdjudication` stays; no report-time `evaluateTargetComplete`. Late evidence uses `CalibrationRestatement` + the `backfilled` bucket. Corrects P0.8's wording, which taken literally would break ratified Correction 156 | P0.8 |

D1 widens the reach of the reliability track's F1 and is recorded as its own decision for that
reason. It does **not** overturn A29.2, which constrains the gate and is silent on a separate verb —
see D1.1.

D5.3 classifies every planned conversion against the standing rule. Five need nothing; the sixth —
D1.4's hand-written `applied` — is the one real break, and already carries its own non-retroactive
guard. **Any new check added to this track must be classified the same way before it ships.**

---

## 8. Summary of dispositions

**Accept as-is.** ag1 F-1, F-2 (hardened per its own condition), F-5, F-6, meta-inversion;
generators and schema reference; prescriptive errors and `--explain` surfacing; bundle
exclusion, base-ref attribution, drift credit; MustPass coverage with a waiver element;
author-time marker anchor check; `verification --run`; verdict `--dry-run`; cursor auto-open
(guarded) and `recover`; NaN fix; mode-aware lint; finding severities; approval lexicon;
`graph scan --draft`; adoption boundary and change kind; guide collapse.

**Accept modified.** Lifecycle finish as a separate command and, per D1, the only sanctioned writer
of `applied` — with a recorded forced apply and a non-retroactive detection rule; `plan amend`
whitelisted, ledger-recorded, review-surfaced; adapter export view read-only; no-adapter
preflight as warning; severities instead of profiles; governed-path cheapening instead of
fast-track bundles; the reject-don't-filter sweep instead of three incident fixes;
`--explain` wiring before catalog authoring; `lint --as` bounded to state-pure rules with
absence reporting; F-4 answered by `<MarkerPending>` health reporting rather than a knob or a
widened waiver.

**Defer (§4).** Process grade and commit enforcement; fail-closed detached review;
`MODULE_MAP` auto-rewrite; signed transitions; evidence tiers; guided revert, batch ops,
preview conveniences.

**Reject (§5).** YAML/TOML dual format; `markerEmission` knob; sandboxed gate enforce;
lifecycle-bypass patch bundles; young-project grace period. R6 (leave the glob matchers
alone) withdrawn on evidence.

The through-line is ag1's closing sentence, which all ten reviews converge on: the
load-bearing walls are right; everything here is drywall and signage — plus one missing door,
the adoption path, that keeps getting mistaken for a wall agents have to climb over.
