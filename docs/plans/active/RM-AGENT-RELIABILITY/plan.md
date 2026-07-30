---
id: RM-AGENT-RELIABILITY
kind: plan
status: approved
supersededBy: null
created: 2026-07-29
updated: 2026-07-30
baseline: 6.0.1
targets: []
context: ./decisions.md
---
# Agent Reliability Implementation Plan

**Target repository:** `neo-grace` (`@neograce/cli`, 6.0.1)
**Audience:** an executor coding agent
**Authority:** derived from `decisions.md` in this directory, which records fifteen ratified
design decisions (D1–D15) and four verified findings (F1–F4). Where this plan and a source
document disagree, **this plan wins** — the conflicts were adjudicated in `decisions.md`.
`review-consolidated.md` frames the questions; `decisions.md` answers them; this plan orders
and specifies the work.
**Plan version:** 2.0 · 2026-07-29 (split; see below)

> **Approved for execution on 2026-07-30 — see §14 A1 for what that approval does and does not
> clear.** The blocking dependency is satisfied:
> [RM-AGENT-RELIABILITY-EVIDENCE](../../archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md) is `complete`
> and archived. Phases 0 and 1 were moved into that bundle on 2026-07-29; it fixed the measurement
> format and produced this repository's real `.ngrace` tree. §2 sequencing rule 0 stands as the record
> of why it had to run first.

> **The step detail below is provisional, and that is why the split happened.** Phases 2–11 were
> written in full before the evidence existed — before the measurement format was fixed, before there
> was a real `.ngrace` tree to design against, and before the v3 audit had run. The **objectives,
> decisions delivered, and review gates are ratified**; the **numbered steps and their verify commands
> are drafts against an imagined dataset.**
>
> At each phase's approval, re-derive its steps from what the evidence bundle actually produced, and
> record the difference. Treating these steps as specified is the mistake this structure exists to
> prevent. Every count in them is a claim — §15. **§14 A3.1 sets the quality bar every phase is held
> to:** a step list is a floor, not a budget.

> **Releases are not yet assigned.** `targets` is empty and the Release column in §2 reads `TBD`.

---

## 0. Operating contract for the executor

Read this section completely before touching any file. It is the contract you are held to for
every phase.

### 0.1 Four working principles

**1 — Think before coding.** Before writing a line in any phase, open every file listed under
*Files touched*, read it end to end, and write a short note in your response stating: what the
code does today, which of your assumptions the code contradicts, and which named function you
will change. If reading contradicts this plan, **stop and report the contradiction** rather than
improvising — this plan was written against HEAD and drift is possible.

**2 — Simplicity first.** No new runtime dependencies. No new required external toolchains. No
abstraction introduced for a single caller. No "while I'm here" refactors. If a phase can be
done with a 40-line function, do not build a plugin system.

**3 — Surgical changes.** Touch only the files a phase names. Do not reformat untouched code. Do
not rename existing symbols. Do not reorder imports in files you did not otherwise modify. Every
diff hunk must be traceable to a numbered step.

**4 — Goal-driven execution.** Every step is written as `step → verify: check`. You are not done
with a step until the verify check passes and you have shown its output. A step whose verify
check you did not run is an incomplete step.

### 0.2 Definition of "covered by tests"

Every phase requires both, and the review gate checks for both:

| Level | Location | What it proves |
|---|---|---|
| **Unit** | co-located `*.test.ts` next to the changed module | The changed function behaves correctly across the enumerated cases, including the negative and malformed ones |
| **Integration** | `src/grace-lint.test.ts`, `src/grace-status.test.ts`, `src/grace-query.test.ts` | Running the actual CLI against a real temp-directory project produces the expected issue codes, exit status, and JSON shape |

Rules:

- Every new issue code MUST have at least one integration test asserting it fires, and at least
  one asserting it does **not** fire on a clean project. Codes that only fire in tests you wrote
  to make them fire are not evidence.
- Every bug fix MUST have a regression test that fails on the pre-fix code. Write the test first,
  watch it fail, then fix. Show both outputs.
- No test may depend on machine state outside the temp project directory — no network, no
  `go`/`cargo`/`python` on PATH required.
- Tests must be deterministic. No timing assertions, no dependence on filesystem ordering.
- **New for this track:** any test covering ledger events must not assert on wall-clock time.
  Ordering comes from allocated ranges (D2), never from timestamps. A test that sorts by time is
  a defect in the test.

### 0.3 Repository invariants you must not break

1. `skills/ngrace/*` is the source of truth; `plugins/ngrace/skills/ngrace/*` is a byte-identical
   mirror. Any skill edit must be copied to the mirror in the same commit.
2. Versions stay synchronized across `README.md`, `openpackage.yml`,
   `.claude-plugin/marketplace.json`, `plugins/ngrace/.claude-plugin/plugin.json`, `package.json`.
3. Nothing may degrade silently. Every code path that cannot perform a check must emit the
   absence value with a reason (D5).
4. New grammar arrives only with the validator that makes it load-bearing.
5. Existing valid `.ngrace` trees must keep validating. Additive only, unless a phase explicitly
   says otherwise. **The run ledger and cursor are additive by construction** (D1): a project
   without them lints clean.
6. `NGRACE_ARTIFACT_VERSION` (`"1.0"`) is the *artifact grammar* version, validated on every root tag.
   Bump it only when something becomes **required**, and ship a migration path with it. It is
   not the product version.
7. Test helpers must never be published. Put shared test helpers in `src/test-support/` and
   confirm with `bun run validate:packed`.
8. **The binary writes only structural state it can derive or is explicitly given, never
   authored content, and never without an explicit apply** (F1). `ngrace graph split --apply`
   is the existing precedent; the ledger and cursor follow it.

### 0.4 Commands you will use constantly

```bash
bun run typecheck                      # bunx tsc --noEmit
bun test                               # full unit + integration suite
bun run validate:cli                   # the three CLI integration suites
bun run validate:marketplace           # packaging, path safety, version sync, canonical↔packaged drift
bun run validate:ci                    # typecheck + test + validate:cli + validate:marketplace
bun run ngrace lint --path <dir>       # exercise the CLI directly (after Phase -1)
bun run ngrace <cmd> --help            # seven subcommands: doctor file graph lint module status verification
git show v3.11.0:<path>                # read GRACE 3 sources (F2) — they are in this repository
```

**Every command above resolves as written.** `package.json#scripts.ngrace` matches the published
binary since RM-NAMESPACE-SEPARATION Phase 0 (`69475b4`); the plan's former Phase −1, which existed
only to close that gap, was removed when that track completed. There is no `bun run grace` script
and no substitution to make.

**One thing to be careful of:** upstream `@osovv/grace-cli` may be installed on your `PATH` as
`grace`. It was, on the maintainer's machine, and `bun run grace lint` silently ran *upstream's*
linter against this repository. If a command unexpectedly succeeds, check which binary answered.

### 0.5 Per-phase reporting format

At the end of every phase, report exactly this:

```
PHASE <n> — <name>
Status: COMPLETE | BLOCKED
Steps completed: <n>/<n>
Files changed: <list>
New issue codes: <list, or none>
Unit tests added: <count> (<file names>)
Integration tests added: <count> (<file names>)
Verify output:
  bun run typecheck            → <pass/fail>
  bun test                     → <n pass, n fail>
  bun run validate:cli         → <pass/fail>
  bun run validate:marketplace → <pass/fail>
Regression evidence: <for bug-fix phases: failing-before and passing-after output>
Token delta: <skill-text lines added/removed; per-invocation output size change, or "none">

Self-review (§0.7) — all five are required:
  Scope audit:        <files outside the declared list; deletions from existing tests; or "clean">
  Mutation check:     <table: each production change reverted alone → failure count>
                      <any row with 0 failures must name the discriminating negative added>
  Adversarial probe:  <table of >=15 inputs NOT in the case table, pass/fail>
                      <for each failure: the fix, and the test that now covers it>
  Compat sweep:       <new issue codes per fixture; "[]" for each, or explain>
  Anti-pattern audit: <§12.4 line by line: does the diff contain it?>

Deviations from plan: <none, or explain>
Open questions for review: <none, or list>
```

Then **stop and wait for review**. Do not begin the next phase.

The `Token delta` line is new for this track and is not optional. D15 makes the toolkit
accountable for its own footprint; a phase that adds skill text without reporting how much is a
phase that cannot be assessed against that decision.

### 0.6 Status legend

`NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `READY FOR REVIEW` · `COMPLETE`

Update the status board in §2 as you go — it is the plan's own state, and keeping it accurate is
part of the job.

### 0.7 Phase self-review — mandatory before `READY FOR REVIEW`

A green test suite proves your tests pass. It does not prove your tests are *about* anything, and
it does not prove the code is right on inputs you did not think of. Every defect found in review
on the previous track was invisible to a green suite.

Run all five audits below and **put their output in your report**. A phase whose report is
missing an audit is not ready.

> **Note on reflexivity.** This track's product is, in part, the mechanization of this very
> protocol (Phase 6). Until that ships, you run it by hand. Do not skip an audit on the grounds
> that a later phase will automate it — the automation is being built *from* what this manual
> pass finds.

#### 0.7.1 Scope audit

```bash
git diff --name-only HEAD                                                # everything you touched
git diff --name-only HEAD | grep -vE '<the files this phase declares>'   # should be empty
git diff HEAD -- <each test file> | grep '^-' | grep -v '^---'           # deletions from existing tests
```

Report: files touched outside the phase's declared list (with justification), and any deletion
from a pre-existing test. Deleting or weakening an existing assertion is presumed wrong until you
argue otherwise.

#### 0.7.2 Mutation check — do your tests actually hold the code?

For **each** production change in the phase, revert it alone, run `bun test`, record the failure
count, restore.

```bash
cp src/path/to/file.ts /tmp/f.bak
# revert exactly one change (one function, one call site, one condition)
bun test 2>&1 | tail -4
cp /tmp/f.bak src/path/to/file.ts
```

Report as a table:

| Reverted | Failures |
|---|---|
| `foldEpoch` range-density check → always true | 3 |
| `run.xml` referential lint call site | 1 |

**Zero failures is a finding, not a pass.** A change that can be reverted with zero failures is
untested, no matter how many tests you added around it. The fix is one *discriminating negative*
— an input where the correct and incorrect behaviours differ. If a revert yields zero, write that
negative before proceeding.

#### 0.7.3 Adversarial probe — go beyond your own case table

Write a throwaway script in the scratchpad exercising **at least 15 inputs that are not in the
phase's case table**, and put the pass/fail table in your report. Probe, then promote whatever
failed into a test alongside the fix.

Probe these categories every time:

| Category | Why |
|---|---|
| **Multi-line / nested** variants of every construct in the table | Case tables drift toward one-liners |
| **Near-misses** — input resembling the target but not it | Detection logic keys on a prefix or substring |
| **The syntax appearing inside prose, comments, or strings** | Regex over flattened text cannot tell them apart |
| **Empty, truncated, unterminated, pathological** | Must degrade, never throw or hang |
| **The silent direction** — does the check stay quiet when it should? | Over-firing is as bad as under-firing |
| **Every row of the phase's own table, re-run through the public entry point** | Unit tests can pass while the wiring is wrong |

**Categories specific to this track**, to add whenever the phase touches the ledger or a gate:

| Category | Why |
|---|---|
| **Concurrent appends from two allocated ranges** | D2's whole premise; a serial-only test proves nothing about it |
| **A range with a hole, and a range with no terminal event** | D2's loss detection must fire on both, and must not fire on a clean dense range |
| **An interrupted fold** — ledger written, loose files not deleted | D3's write-verify-delete ordering |
| **A cursor naming a task absent from the plan, and an absent cursor** | D1: the first is an error, the second is silent |
| **An absence value with every reason code, through each gate** | D5: required evidence blocks, optional evidence does not |

For each failure ask: **could this produce a confident false error?** That is the worst outcome
in this codebase — worse than the silent gap it replaced — because it blocks correct work and
teaches people to ignore the tool. Rank findings by that.

#### 0.7.4 Backward-compatibility sweep

Any phase that adds an issue code must run it against **every** fixture and report the new codes
per fixture:

```
polyglotFixture()   → []
minimalTsFixture()  → []
scaleFixture(20)    → []
examples/           → []
```

A new **error** on a previously-green project is a release-breaking change. If one appears,
either the severity is wrong or the check is. Do not proceed by editing the fixture to suit the
check.

#### 0.7.5 Anti-pattern self-audit

Re-read §12.4 and state, per line, that your diff does not contain it. The list only works if it
is actually consulted against the finished diff.

#### 0.7.6 When a probe finds something

Fix it in the same phase, add the failing input as a test, and **report both the probe output and
the fix**. Do not silently fix and report clean: the probe result is the evidence that the test
you added is worth having.

If you believe a finding is out of scope, say so explicitly with your reasoning rather than
omitting it.

---

## 1. Orientation — the system as it exists today

Read this against the real code before you start. If any of it is wrong at HEAD, report it.

### 1.1 What already exists that this track builds on

| Capability | Where | Why it matters here |
|---|---|---|
| Absence primitives, fail-closed | `src/artifact/assertions.ts:263`, `:506`; `src/grace-status.ts:127` | `assertion.command-not-evaluated` is already an error. D5 unifies these rather than inventing them |
| Language confidence tiers | `src/language-registry.ts`, adapters | `exact \| heuristic \| no-adapter` — the *precision* axis of D5, already shipped |
| Deterministic retrieval | `src/grace-module.ts`, `src/grace-file.ts` | `module show --with verification --json`, `module find --depends`, `file show --contracts --blocks --json`. D7: the packet's retrieval half already exists |
| Structural writes behind `--apply` | `src/grace-graph.ts:285–290`, `:296`, `:347` | F1: the precedent the ledger follows. Dry-run default, explicit apply, refuses on a bad projection |
| Read-only enforcement by snapshot test | `src/artifact/scale-ergonomics.test.ts:212` | The mechanism for proving a command does not write. Reusable per-command |
| Recursive mirror validation | `scripts/validate-marketplace.ts:229–270` | `git diff --no-index` over each listed skill **directory**. D13 depends on this |
| Grammar forbids nested status | `src/artifact/grammar.ts:167` | `artifact.forbidden-status-attribute` — why the cursor lives outside `plan.xml` (D1) |

### 1.2 What does not exist and this track creates

| Thing | Decision |
|---|---|
| `run-ledger.xml` — append-only epoch record | D1, D2, D3 |
| `run.xml` — regenerable position cache | D1 |
| A unified absence value with reason codes | D5 |
| Transition gates as a surface distinct from lint and review | D14 |
| Detached reviewer with deterministic finding IDs | D4, §4.3 |
| Seeded-defect corpus | D4, §5.4 |
| Task-scoped selection over artifacts and skills | D15 |
| Calibration corpus and report | D6 |

### 1.3 The three check surfaces (D14)

```mermaid
flowchart LR
    A[artifacts on disk] -->|idempotent| L[lint]
    A --> G[transition gates]
    R[(run-ledger.xml)] --> G
    G -->|approve / apply / archive| S[state change]
    D[diff + plan] --> V[review]
    V -->|verdict| R
```

`lint` never reads run state. Gates may. `review` produces findings that land in the ledger.
Confusing these is the failure §5.7 warned about.

---

## 2. Phase status board

Keep this table current. It is the single source of truth for progress.

| # | Phase | Decisions delivered | Release | Status |
|---|---|---|---|---|
| 2 | Absence value & honest verdicts | D5 (vocabulary half), D13 | TBD | `COMPLETE` |
| 3 | Run ledger & cursor | D1, D2, D3 | TBD | `READY FOR REVIEW` |
| 4 | Attempt log, fix budget, escalation | D6 (attempt half), D9 | TBD | `NOT STARTED` |
| 5 | Gate declarations & transition surface | D5 (gate half), D11, D12, D14 | TBD | `NOT STARTED` |
| 6 | Detached reviewer & mechanized audits | D4 (gate), §4.3, §5.2 | TBD | `NOT STARTED` |
| 7 | Deterministic failure localization | D8 | TBD | `NOT STARTED` |
| 8 | Selection: task slices & skill subsetting | D15, §4.1 | TBD | `NOT STARTED` |
| 9 | Confidence recording & calibration report | D6 (calibration half) | TBD | `NOT STARTED` |
| 10 | Plan-quality signal & doctor consumers | D10, §4.9 subset | TBD | `NOT STARTED` |
| 11 | Adoption surface | §5.1, §5.3 | TBD | `NOT STARTED` |

**Hard sequencing rules** — these are dependencies, not preferences. Each is stated with what
breaks if violated:

0. **The evidence bundle → everything here.**
   [RM-AGENT-RELIABILITY-EVIDENCE](../../archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md) must be `complete`.
   Its Phase 0 fixes the measurement format that every number below is reported in; its Phase 1
   produces the real `.ngrace` tree that Phases 3, 4, 8 and 9 are designed against. Starting here
   first does not merely risk rework — it means measuring with an unfixed instrument and designing
   against fixtures, which is this track's own central lesson applied backwards.
1. **2 → 5.** Gates declare required evidence; the absence value is what "evidence is missing"
   means. Without it, gates have no vocabulary to fail on.
2. **3 → 4, 5, 9, 10.** The ledger is where attempts, overrides, degradations and verdicts land.
3. **5 → 6.** The reviewer's verdict requirement is a gate; the gate surface must exist first.
4. **6 → 10.** The plan-quality signal is computed from review outcomes.
5. **11 last.** §5.1 is a blocking constraint on user-visible surfaces: the full-lifecycle
   walkthrough lands with or before the last user-facing capability, not after it.

Phases **7** and **8** may float anywhere after 2 and 3 respectively. **4** may float after 3.

---

# PHASE 2 — Absence value & honest verdicts

**Status:** `COMPLETE`
**Decisions:** D5 (vocabulary half), D13
**Release:** TBD

> **Amended by §14 A3–A6 — read all four before §2.5.** The steps below were written before the evidence
> existed. A3 re-derives them against HEAD (eight corrections), adds the scope A3.1's quality bar pulls in,
> and carries two decisions; A4 answers both and adds a ninth correction; A5 adds a tenth and an eleventh,
> **withdraws A4.3's consequence 2**, and sets three standing rules; A6 adds corrections 12–14, **corrects
> A5.2's flag name**, sets a fourth standing rule, and approves the spec; A7 is the review gate — one
> undisclosed behaviour change, four defects to fix before merge, and a fifth standing rule; A8 answers
> A7.1 with a warning-level near-miss code.

## 2.1 Objective

Make *"no answer was produced"* one recognizable thing across every surface, and supply the
missing words for the surfaces the binary does not own.

**This phase is mostly renaming and routing.** Three of the seven absence values already ship.
The work is making them recognizable as a class, not inventing them.

## 2.2 Preconditions

→ verify: `bun run validate:ci` green, and the **evidence bundle** `complete` — both its Phase 0 and
its Phase 1. See [RM-AGENT-RELIABILITY-EVIDENCE](../../archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md).

→ verify: `grep -n 'assertion.command-not-evaluated' src/artifact/assertions.ts` returns two sites
(≈`:263`, ≈`:506`) and `grep -n 'analysis.no-adapter' src/lint/catalog.ts` returns one. If the
counts differ, F-series findings drifted — report before proceeding.

## 2.3 Files touched

| File | Action |
|---|---|
| `src/lint/types.ts` | EDIT — add the absence classification to the issue record |
| `src/lint/catalog.ts` | EDIT — mark absence-class codes; add `derivedFrom` / `proposedBy` |
| `src/artifact/assertions.ts` | EDIT — two call sites, classification only |
| `src/grace-doctor.ts` | EDIT — report absence counts by reason |
| `skills/ngrace/ngrace-cli/references/verdicts.md` | CREATE — the one shared fragment |
| `plugins/ngrace/skills/ngrace/ngrace-cli/references/verdicts.md` | CREATE (mirror) |
| `skills/ngrace/ngrace-execute/SKILL.md` | EDIT — one sentence |
| `skills/ngrace/ngrace-reviewer/SKILL.md` | EDIT — one sentence |
| `skills/ngrace/ngrace-verification/SKILL.md` | EDIT — one sentence |
| (+ the three packaged mirrors) | EDIT |
| `scripts/validate-marketplace.ts` | EDIT — single-source rule for the verdict tokens |

## 2.4 Design

**The codes are already the reason codes.** D5 asks for one value plus a required reason;
`analysis.no-adapter`, `analysis.runtime-missing` and `assertion.command-not-evaluated` are
exactly that reason, already named and already shipped.

So the unification is **additive classification, not a rename**:

```
PSEUDOCODE  — src/lint/types.ts

type IssueClass = "defect" | "absence";

interface LintIssue {
  // ...existing fields unchanged...
  issueClass?: IssueClass;   // absent means "defect" — no existing consumer breaks
}
```

A consumer can then ask *"is this an absence?"* without enumerating seven names, and the reason
travels in the field that already carries it.

**Renaming the codes is explicitly rejected.** It breaks every consumer matching on code strings,
for no gain: the reason is the code.

| Code | Class | Reason character |
|---|---|---|
| `analysis.no-adapter` | absence | structural; not fixable by rerunning |
| `analysis.runtime-missing` | absence | environmental; install something |
| `assertion.command-not-evaluated` | absence | operator declined; pass a flag |
| everything else today | defect | — |

**The surfaces the binary does not own** get authored vocabulary in one physical file
(D13): review outcomes (`pass | fail | unable-to-determine`), AC satisfaction
(`satisfied | satisfied-unverified | not-satisfied`), verification rows
(`pass | fail | not-run`).

Skills reference it; they do not inline it. Each verdict-emitting skill gains **one sentence**,
not a table:

> Report the value the CLI emitted. Never summarize an absence into a pass.

## 2.5 Steps

**Step 2.5.1 — Add `issueClass` to the issue record.**
→ verify: `bun run typecheck` clean, and `bun test` shows no change in pass count. This step must
be behaviour-neutral; if any test changes, the field is not additive.

**Step 2.5.2 — Classify the three shipped absence codes.**
Set `issueClass: "absence"` at the emission sites in `assertions.ts` and wherever
`analysis.no-adapter` / `analysis.runtime-missing` are raised.
→ verify: an integration test asserts a project missing an adapter produces an issue with
`issueClass === "absence"`, and a project with an ordinary grammar error produces one without it.

**Step 2.5.3 — Add `derivedFrom` / `proposedBy` to the catalog guide type (§12.1).**
Populate them for the three absence codes and leave the rest to be filled as later phases touch
them.
→ verify: a unit test asserts every code carrying `issueClass: "absence"` also carries at least
one of `derivedFrom` / `proposedBy`. Absence codes are the ones this track is built on; an
unjustified one is a design error.

**Step 2.5.4 — Teach `doctor` to report absences by reason.**
→ verify: `ngrace doctor --path .` against the **evidence bundle's** Phase 1 `.ngrace` prints an absence count per reason
code, and prints zero when nothing is absent. Include both outputs in the report.

**Step 2.5.5 — Create `skills/ngrace/ngrace-cli/references/verdicts.md`.**
Contains the three authored vocabularies above and nothing the binary already emits.
→ verify: the file is under 40 lines. If it is longer, it has started restating the catalog.

**Step 2.5.6 — Add the single-source rule to `validate-marketplace.ts`.**
The verdict token set (`unable-to-determine`, `satisfied-unverified`, `not-run`) may appear in
exactly one file under `skills/`.
→ verify: the rule fails when the tokens are duplicated into a second skill (test it by
temporarily adding one), and passes at HEAD.

**Step 2.5.7 — Add the one sentence to the three verdict-emitting skills, and mirror.**
→ verify: `bun run validate:marketplace` passes. Report the skill-text line delta — it should be
in single digits per skill.

## 2.6 Definition of done

- `issueClass` exists and is additive; no pre-existing test changed behaviour
- The three shipped absence codes are classified and justified
- `doctor` reports absences by reason, including the zero case
- One shared fragment; the single-source rule fails on duplication
- Token delta reported; skill text grew by less than 30 lines total
- `bun run validate:ci` green

## 2.7 Review gate

1. Was any existing issue code renamed or removed? It must not have been.
2. Does the shared fragment restate anything the binary emits? It must not.
3. Does the single-source rule actually fail on duplication — with the failing output shown — or
   was it only asserted to pass?

## 2.8 Rollback

Revert `issueClass` and the classification sites; delete the fragment, the two mirror copies, and
the validator rule. All additive, so rollback is clean.

---

# PHASE 3 — Run ledger & cursor

**Status:** `READY FOR REVIEW`
**Decisions:** D1, D2, D3
**Release:** TBD

> **Amended by §14 A10 and A11 — read both before §3.5.** The steps below were written before the evidence
> existed. A10 re-derives them against HEAD: §3.1, §3.6 and §3.7 stand; **§3.5 does not**. Eight corrections
> (16–23), of which correction 16 invalidates §3.4's "registers exactly as `design-context.xml` does"
> premise and correction 17 shows step 3.5.1's verify check passes today with no code written.
> **A11 answers A10.12's four decisions and adds a fifth**, and is normative where it disagrees with §3.4
> and §3.5: twelve issue codes, required bundle identity, a sixth `regenerate` subcommand reading three
> sources, and three graph modules the phase must add.

## 3.1 Objective

Give a change bundle durable position and a durable record of what cannot be re-derived, without
touching the approved plan.

Read D1, D2 and D3 in full before starting. This phase implements them literally; where this
plan is terser than `decisions.md`, `decisions.md` governs the rationale and this plan governs
the code.

## 3.2 Preconditions

→ verify: the **evidence bundle's** Phase 1 is `COMPLETE` — this phase is designed against the real
bundle flow, not a fixture.

→ verify: `grep -n 'NGRACE_CHANGE_COMPANION_TAGS' src/artifact/*.ts` shows the companion-tag
mechanism that `design-context.xml` already uses. The ledger registers the same way; if that
mechanism is gone, stop and report.

## 3.3 Files touched

| File | Action |
|---|---|
| `src/artifact/types.ts` | EDIT — companion tags, event and epoch types |
| `src/artifact/grammar.ts` | EDIT — `validateRunLedgerArtifact`, `validateRunCursorArtifact` |
| `src/artifact/paths.ts` | READ ONLY — every authored path goes through `resolveContainedProjectPath` |
| `src/grace-cursor.ts` | CREATE — the sole write surface |
| `src/grace-cursor.test.ts` | CREATE |
| `src/grace.ts` | EDIT — register the `cursor` subcommand |
| `src/lint/core.ts` | EDIT — referential integrity of ledger against plan |
| `src/grace-status.ts` | EDIT — surface the cursor |
| `src/test-support/fixtures.ts` | EDIT — builders for ledgers and epochs |

## 3.4 Design

### Layout

```
.ngrace/changes/active/C-3/
  spec.xml            immutable once approved
  plan.xml            immutable once approved
  run-ledger.xml      grows by one <Epoch-N> per fold; the truth
  run/                loose event files; empty between epochs
  run.xml             cursor cache; regenerable; disposable
```

### Grammar

`<NgraceRunLedger>` and `<NgraceRunCursor>` register as **change companion tags**, exactly as
`design-context.xml` does. Model `validateRunLedgerArtifact` on
`validateChangeDesignContextArtifact` (`src/artifact/grammar.ts:574`).

**`Epoch-N` is not a semantic anchor.** Do not add it to `ANCHOR_PATTERNS`. §8 of the review is
explicit that reliability is loop and evidence, not more anchors, and `ANCHOR_PATTERNS` is
deliberately reserved for the semantic families. An epoch is structural sequencing.

### Event identity (D2)

```
PSEUDOCODE

interface RangeAllocation { worker: string; from: number; to: number; }

// Emitted as the epoch's opening event; every later event ID must fall inside
// one of these ranges, or the ledger has a rogue writer.
interface EpochOpened {
  epoch: number;
  wave?: string;              // absent is legal — a hotfix outside any planned wave
  executor?: string;          // harness-stated, unverifiable, may be absent (D6)
  allocations: RangeAllocation[];
}
```

Event files are `run/<id>-<task>-<kind>.xml`. **No timestamps in identity or ordering.** A test
that sorts by time is a defect in the test (§0.2).

### Fold (D3)

At epoch close — a quiescent barrier, orchestrator the sole writer:

1. Read `run/*`
2. Verify **range membership** (every ID inside an allocation) and **density** (each used range
   dense from its start to a terminal event)
3. Write `<Epoch-N wave="M">` appended to `run-ledger.xml`
4. Re-read and verify the written ledger contains exactly N events
5. **Only then** delete the loose files

**Write, verify, then delete — never delete first.** An interrupted fold must leave both forms.

### Completeness

Mark each folded epoch complete or incomplete (D6's bias safeguard). Incomplete means a used
range lacked a terminal event, or had a hole.

## 3.5 Steps

**Step 3.5.1 — Types and companion-tag registration.**
→ verify: `bun run typecheck` clean; a fixture bundle carrying an empty `run-ledger.xml` lints
without `change.invalid-root-tag`.

**Step 3.5.2 — `validateRunLedgerArtifact`.**
Rejects: unknown root tag, non-monotonic epoch numbers, a renumbered or reordered epoch, an event
ID outside every allocation, a hole inside a used range, a used range with no terminal event.
→ verify: one unit test per rejection, each asserting the specific code — six tests minimum. A
single "invalid ledger" test is not evidence.

**Step 3.5.3 — `validateRunCursorArtifact` and the conditional referential check.**

Three behaviours, and the middle one is the one that gets built wrong:

| State | Result |
|---|---|
| No `run.xml` | **Silent.** No issue. The cursor is optional (D1) |
| `run.xml` naming a task absent from `plan.xml` | **Error** |
| `run.xml` consistent with `plan.xml` | Clean |

→ verify: three integration tests, one per row. The first is the one to write first — it is the
behaviour most likely to be lost to the house's fail-closed instinct.

**Step 3.5.4 — `src/grace-cursor.ts` as the sole write surface.**

Subcommands: `show`, `advance`, `pause`, `resume`, `fold`. Only `advance`, `pause`, `resume` and
`fold` write; `show` must not.

→ verify: a directory-snapshot test proves `cursor show` leaves the tree byte-identical. Model it
on `src/artifact/scale-ergonomics.test.ts:212`, which already does exactly this for `doctor`.

**Step 3.5.5 — Implement `fold` with write-verify-delete ordering.**
→ verify: a test that injects a failure between write and delete leaves **both** the ledger and
the loose files, and a follow-up `fold` is idempotent rather than duplicating the epoch.

**Step 3.5.6 — Concurrent append test.**
Two allocations, interleaved writes, then fold.
→ verify: the fold succeeds, every event is present, and no ordering assertion anywhere in the
test refers to a clock.

**Step 3.5.7 — Surface the cursor in `ngrace status`.**
→ verify: `ngrace status --path .` prints the change, epoch, task counts and next skill, and
prints normally when no cursor exists.

**Step 3.5.8 — Confirm the write invariant did not leak.**
→ verify: `grep -rn 'writeFileSync\|mkdirSync' src --include='*.ts' | grep -v test` returns
`grace-graph.ts`, `grace-cursor.ts`, and the dart adapter's temp-dir use — and nothing else.
Report the output verbatim.

## 3.6 Definition of done

- Ledger and cursor validate; six rejection tests minimum
- Absent cursor is silent; inconsistent cursor is an error; both tested
- `cursor show` proven non-writing by directory snapshot
- Interrupted fold leaves both forms; re-fold is idempotent
- Concurrent append test passes with no clock dependency
- Write-surface grep output reported verbatim
- `bun run validate:ci` green

## 3.7 Review gate

1. Does an absent cursor produce *any* diagnostic? It must not.
2. Is `Epoch-N` in `ANCHOR_PATTERNS`? It must not be.
3. Does any test order events by timestamp?
4. Was the fold's delete step ever reachable before the verify step?

## 3.8 Rollback

Remove the `cursor` subcommand and its module, the two validators, the referential check and the
status surfacing. Bundles carrying a `run-ledger.xml` then lint as unknown-companion — so
rollback must also remove the companion-tag registration, or state why not.

---

# PHASE 4 — Attempt log, fix budget, escalation

**Status:** `NOT STARTED`
**Decisions:** D6 (attempt half), D9
**Release:** TBD

## 4.1 Objective

Record every attempt, not only outcomes; bound churn at two; escalate to replan rather than abort.

## 4.2 Preconditions

→ verify: Phase 3 `COMPLETE`. Attempts are ledger events; there is nowhere to put them otherwise.

## 4.3 Files touched

| File | Action |
|---|---|
| `src/artifact/types.ts` | EDIT — attempt event, failure signature |
| `src/grace-cursor.ts` | EDIT — attempt recording, budget accounting |
| `src/grace-cursor.test.ts` | EDIT |
| `skills/ngrace/ngrace-execute/SKILL.md` | EDIT — budget and escalation rule |
| `plugins/ngrace/skills/ngrace/ngrace-execute/SKILL.md` | EDIT (mirror) |

## 4.4 Design

**The ledger is an attempt log, not a state log** (D6). Append every attempt and its verdict;
never update a task's status in place.

```
PSEUDOCODE

interface AttemptEvent {
  task: string;
  ordinal: number;              // 1-based within the task
  outcome: "pass" | "fail";
  signature?: FailureSignature; // present when outcome is "fail"
}

interface FailureSignature {
  kind: string;                 // e.g. "test-failure", "typecheck", "lint"
  key: string;                  // stable identity of *what* failed
}
```

**The counter stays dumb** (D9). Every attempt counts against the budget regardless of signature.
The signature is recorded for the escalation message and for analysis — it does not modify the
count. Do not write logic that decides an attempt "was progress" and should not count.

**Budget exhaustion is a normal state.** On the second failed attempt: record the exhaustion
event, transition the task to `paused-pending-approval`, and surface both signatures.

**Flake detection is a read over the log, not a new event.** `fail → (no fix) → pass` on the same
task with no intervening write is a flaky test, and it is classified rather than pooled into the
churn trend (D8).

## 4.5 Steps

**Step 4.5.1 — Attempt and signature types; record on every verification cycle.**
→ verify: a task that passes first time produces one attempt event; a task that fails then passes
produces two, both present in the ledger after fold.

**Step 4.5.2 — Budget accounting with a dumb counter.**
→ verify: a test asserting that two failures with *different* signatures still exhaust the budget.
This is the discriminating negative for "the counter stays dumb" — without it, a later
optimization can quietly make the counter clever and no test will notice.

**Step 4.5.3 — Exhaustion → `paused-pending-approval`, with both signatures surfaced.**
→ verify: the escalation output names both failure signatures and does not claim the task failed.
Show the output.

**Step 4.5.4 — Flake classification.**
→ verify: a fixture where a test fails then passes with no intervening write is reported as
flaky, and one where a fix landed between them is reported as a normal retry.

**Step 4.5.5 — Skill text: the budget and escalation rule, mirrored.**
→ verify: `validate:marketplace` passes; report the line delta.

## 4.6 Definition of done

- Attempts recorded individually; outcome-only recording nowhere in the diff
- Different-signature failures still exhaust the budget (test present)
- Exhaustion pauses rather than fails, with both signatures shown
- Flake distinguished from retry
- `bun run validate:ci` green

## 4.7 Review gate

1. Can the counter be made clever by a one-line change without failing a test? If so, step 4.5.2's
   negative is missing or too weak.
2. Does any code path overwrite a previous attempt rather than appending?
3. Is `2` a named constant with the "judgment, not derived" note from D9 beside it?

## 4.8 Rollback

Remove attempt events, budget accounting and the skill text. The ledger tolerates unknown event
kinds being absent, so older bundles are unaffected.

---

# PHASE 5 — Gate declarations & transition surface

**Status:** `NOT STARTED`
**Decisions:** D5 (gate half), D11, D12, D14
**Release:** TBD

## 5.1 Objective

Create the third check surface, and let each gate declare what evidence it requires — so blocking
is a property of the gate, not of any mechanism.

## 5.2 Preconditions

→ verify: Phase 2 `COMPLETE` — a gate needs the absence class to fail on.
→ verify: Phase 3 `COMPLETE` — gates consult the ledger.

## 5.3 Files touched

| File | Action |
|---|---|
| `src/gates/core.ts` | CREATE — the surface |
| `src/gates/core.test.ts` | CREATE |
| `src/gates/catalog.ts` | CREATE — `gate.*` codes |
| `src/lint/core.ts` | READ ONLY — must not learn about gates |
| `src/lint/core.test.ts` | CREATE — add the boundary test (no such file exists yet) |
| `src/grace.ts` | EDIT — wire gates into the transition commands |
| `skills/ngrace/ngrace-execute/SKILL.md`, `ngrace-reviewer/SKILL.md` | EDIT |
| (+ mirrors) | EDIT |

## 5.4 Design

```
PSEUDOCODE

interface EvidenceRequirement {
  id: string;                    // e.g. "review-verdict", "command-assertions"
  required: boolean;
}

interface Gate {
  id: "approve" | "apply" | "archive";
  requires: EvidenceRequirement[];
}

// The whole blocking rule, in one function:
//   required evidence absent            → gate fails closed
//   optional evidence absent            → reported, does not block
//   evidence present                    → gate consults its value
```

**The D14 boundary is testable and must be tested:** a `gate.*` code may never be emitted by
`runLint`. Lint reads artifacts and is idempotent; gates read run state.

### The three gate declarations this phase ships

| Gate | Requires | From |
|---|---|---|
| `approve` | no unresolved `[NEEDS CLARIFICATION]` on `IC-*` or `INV-*` | D12 |
| `apply` | a recorded review verdict (any value, including `unable-to-determine`); no unresolved clarification on any `AC-*` the change claims to satisfy; no unexecuted declared command assertion | D11, D12, §4.7 |
| `archive` | no open epoch | D3 |

**`applied` requires a verdict to exist, not to be clean** (D11). A change may apply with
`unable-to-determine` or with open judgment findings. It may not apply with no review at all.

**`ASSUMPTION` never appears in any requirement.** It is presence with weak provenance, not
absence (D12). If it shows up in a gate, the phase is wrong.

### Hosts that cannot review

A missing verdict because the host cannot produce one is the absence value with reason
`host-capability-missing` — not an exemption. Whether it blocks is governed by the existing
fail-on policy, and the docs must publish the guarantee as conditional (§5.2).

## 5.5 Steps

**Step 5.5.1 — Create the gate surface and catalog.**
→ verify: `gate.*` codes exist in their own catalog, and a unit test asserts the `gate.` prefix is
absent from `src/lint/catalog.ts`.

**Step 5.5.2 — The boundary test.**
→ verify: an integration test runs `ngrace lint` over a project with an open epoch and an absent
review verdict, and asserts **no** `gate.*` code appears in the output. This is D14's boundary and
it is the test most likely to be skipped.

**Step 5.5.3 — Implement requirement evaluation.**
→ verify: a table test covering the three rows of the blocking rule, with each absence reason code
from Phase 2 exercised through a required and an optional requirement — six cases minimum.

**Step 5.5.4 — The `approve` gate and clarification blocking.**
→ verify: a clarification on `IC-*` blocks approval; the same text on a non-satisfied `AC-*` does
not; an `ASSUMPTION` anywhere does not. Three tests.

**Step 5.5.5 — The `apply` gate and the verdict requirement.**
→ verify: apply blocked with no verdict; apply **permitted** with `unable-to-determine`. The second
is the one that proves D11 was implemented rather than a simpler "review must pass."

**Step 5.5.6 — The `archive` gate and the open-epoch precondition.**
→ verify: archive blocked with loose files in `run/`; permitted after a fold.

**Step 5.5.7 — `host-capability-missing` through the fail-on policy.**
→ verify: with the policy permissive, apply proceeds and the absence is reported; with it strict,
apply blocks. Both outputs shown.

**Step 5.5.8 — Skill text and mirrors.**
→ verify: `validate:marketplace` passes; line delta reported.

## 5.6 Definition of done

- `gate.*` codes exist and cannot be emitted by lint (test present)
- Blocking rule table-tested across every Phase 2 absence reason
- `apply` permitted with `unable-to-determine`, blocked with no verdict
- `ASSUMPTION` blocks nothing anywhere
- Host-capability path exercised both ways
- `bun run validate:ci` green

## 5.7 Review gate

1. Did `src/lint/core.ts` change? It should not have, beyond wiring nothing.
2. Is there anywhere a mechanism decides whether it blocks? Blocking belongs to the gate.
3. Does apply succeed with `unable-to-determine`? If not, D11 was implemented as "review must
   pass," which is a different and worse decision.

## 5.8 Rollback

Delete `src/gates/`, revert the transition wiring and the skill text. Lint is untouched by
construction, so nothing in the existing pipeline regresses.

---

# PHASE 6 — Detached reviewer & mechanized audits

**Status:** `NOT STARTED`
**Decisions:** D4 (gate), §4.3, §5.2
**Release:** TBD

## 6.1 Objective

Productize the self-review protocol that found all nineteen defects on the previous track:
mechanize what can be mechanized, keep the judgment part detached, and make the reviewer's own
stability testable.

## 6.2 Preconditions

→ verify: Phase 5 `COMPLETE` — the verdict requirement is a gate and the gate surface must exist.
→ verify: the **evidence bundle's** Phase 0 corpus has ≥10 entries. The determinism gate has nothing to run against
otherwise.

## 6.3 Files touched

| File | Action |
|---|---|
| `src/review/core.ts` | CREATE — mechanized audits, finding IDs |
| `src/review/core.test.ts` | CREATE |
| `src/review/catalog.ts` | CREATE — `review.*` codes |
| `src/review/scorer.ts` | CREATE — corpus scoring for D4 |
| `src/review/scorer.test.ts` | CREATE |
| `src/grace.ts` | EDIT — `review` subcommand |
| `skills/ngrace/ngrace-reviewer/SKILL.md` | EDIT — detachment contract |
| `skills/ngrace/ngrace-setup-subagents/references/roles/*.md` | EDIT — read-only reviewer preset |
| (+ mirrors) | EDIT |
| `README.md` | EDIT — host capability matrix |

## 6.4 Design

### The three non-negotiables (§4.3), and how each is enforced rather than instructed

| Rule | Enforcement |
|---|---|
| Separate instance, no implementer transcript | Subagent spawn with cold context — a **host capability**, not an instruction (§5.2) |
| Read-only by tool permission | Agent-definition tool allowlist — configuration, not instruction |
| Deterministic finding IDs | A property of `src/review/core.ts`, testable here |

The first two degrade to an honor system on hosts lacking them. **That is published, not hidden**
— see step 6.5.7.

### Mechanized audits

| Audit | Computation |
|---|---|
| Scope | `git diff --name-only` vs. `ObservedWriteScope` |
| Test weakening | diff test files; flag removed or loosened assertions |
| Backward-compat | lint every fixture before and after; diff the issue-code sets |
| Hunk coverage | which changed hunks are defended by *any* test |

**Full `grace mutate` is out of scope** (Q1, unanimous). Hunk coverage attribution first;
revert-and-rerun stays an opt-in deep audit and is not built here.

### Deterministic finding IDs

```
PSEUDOCODE

findingId(f) = hash(auditId, file, anchorOrHunkKey, ruleId)
```

**Never include:** line numbers alone (they move under unrelated edits), timestamps, iteration
order, or anything derived from the agent's narration. Two runs over an unchanged tree must
produce identical IDs *and* identical counts.

## 6.5 Steps

**Step 6.5.1 — Mechanized audits, one at a time, each with its own tests.**
→ verify: each audit fires on a corpus entry designed for it and stays silent on a clean project.
Report the pair per audit.

**Step 6.5.2 — Deterministic finding IDs.**
→ verify: run the reviewer twice over an unchanged fixture; diff IDs and counts; both identical.
Then make an *unrelated* edit elsewhere in the file (add a blank line above the finding) and
assert the ID is unchanged. The second check is what proves IDs are not line-derived.

**Step 6.5.3 — Hunk coverage attribution.**
→ verify: a changed hunk with no covering test is reported; one with a covering test is not.

**Step 6.5.4 — The scorer, over the evidence bundle's Phase 0 corpus.**
→ verify: prints detection rate per pattern and lists every `mustFire: false` entry that
incorrectly fired. Both directions, or the score is half a measurement.

**Step 6.5.5 — Wire the determinism gate into CI.**
The D4 gate: two runs identical, **plus** no seeded defect that was caught last version is missed
now.
→ verify: the gate fails when a detection is deliberately broken. Show the failing output — a gate
never seen red is a gate never tested.

**Step 6.5.6 — Reviewer skill: detachment contract and read-only preset.**
→ verify: the reviewer role definition carries a tool allowlist with no write tool. Report the
allowlist verbatim.

**Step 6.5.7 — Publish the host capability matrix in `README.md`.**

| Layer | Owns |
|---|---|
| CLI (portable) | mechanized audits, finding IDs, scoring, coverage attribution |
| Skills (portable) | when to call the CLI, judgment probe, user-facing explanation |
| Host adapters (optional) | cold subagent spawn, tool-level read-only, pre-write guards |

→ verify: the README states plainly which guarantees are conditional and what degrades without
them. Selling a hard guarantee on a host that cannot provide it is the exact
confidence-without-check failure this track exists to remove.

## 6.6 Definition of done

- Four mechanized audits, each with a fires/silent pair
- IDs stable across reruns **and** across unrelated edits
- Scorer reports both directions
- Determinism gate demonstrated red, then green
- Read-only allowlist reported verbatim
- Capability matrix published with degradation stated
- `bun run validate:ci` green

## 6.7 Review gate

1. Was the determinism gate ever observed failing? If not, it is unproven.
2. Do finding IDs survive a blank line inserted above the finding?
3. Does any audit require the implementer's transcript? It must not — that destroys detachment.
4. Does the README claim any guarantee unconditionally?

## 6.8 Rollback

Delete `src/review/`, the subcommand, the CI gate and the README section. Phase 5's `apply` gate
then has no verdict producer — so rollback must also relax that requirement, or state why not.

---

# PHASE 7 — Deterministic failure localization

**Status:** `NOT STARTED`
**Decisions:** D8
**Release:** TBD

## 7.1 Objective

When verification fails, say *where it started going wrong* — not only where it blew up.

## 7.2 Preconditions

→ verify: Phase 2 `COMPLETE` — an unlocalizable failure reports the absence value, not a guess.

## 7.3 Files touched

| File | Action |
|---|---|
| `src/verification/localize.ts` | CREATE |
| `src/verification/localize.test.ts` | CREATE |
| `src/grace-verification.ts` | EDIT — surface the localization |
| `skills/ngrace/ngrace-fix/SKILL.md` | EDIT — consume it |
| (+ mirror) | EDIT |

## 7.4 Design

Two questions, two sources (D8):

| Question | Source | Status |
|---|---|---|
| Which module failed? | test results + language-aware test-file inference | already computable |
| Where in the flow did it diverge? | observed markers vs. expected markers from `V-M-*` | built here |

```
PSEUDOCODE

firstDivergentBlock(expected: string[], observed: string[]):
  for i in 0..max(len(expected), len(observed)):
    if expected[i] != observed[i]:
      return { index: i, expected: expected[i], observed: observed[i] }
  return null   // sequences agree; the failure is elsewhere
```

**When markers are absent or the verification entry declares none, emit the absence value with a
reason.** Do not fall back to the stack trace and present it as localization — that is a confident
answer to a question the evidence did not settle.

**Self-review is a localization source only for its mechanized subset** (D8). Judgment findings —
adversarial probe, anti-pattern audit — may not feed localization.

## 7.5 Steps

**Step 7.5.1 — `firstDivergentBlock` over marker sequences.**
→ verify: unit tests for divergence at position 0, mid-sequence, at the end, observed shorter than
expected, observed longer, and identical sequences.

**Step 7.5.2 — Join test failures to modules via test-file inference.**
→ verify: a failing test in a governed test file resolves to its module; one in an ungoverned file
resolves to the absence value, not to a guess.

**Step 7.5.3 — Absence path when markers are unavailable.**
→ verify: a module with no declared markers produces an absence with reason, and **no** stack-trace
fallback appears anywhere in the output.

**Step 7.5.4 — Reject judgment findings as a source.**
→ verify: a test asserting that a judgment-class review finding does not appear in localization
output.

**Step 7.5.5 — Surface in `ngrace verification` and consume in `ngrace-fix`.**
→ verify: output shows module, first divergent block, and expected-vs-observed. Report it.

## 7.6 Definition of done

- Divergence detected at every boundary case
- Ungoverned and marker-less paths produce absence, never a guess
- Judgment findings excluded, with a test
- `bun run validate:ci` green

## 7.7 Review gate

1. Is there any path where a stack trace is presented as the divergence point?
2. Does the empty-marker case produce a confident answer?

## 7.8 Rollback

Delete the module and revert the two consumers. Purely additive.

---

# PHASE 8 — Selection: task slices & skill subsetting

**Status:** `NOT STARTED`
**Decisions:** D15, §4.1
**Release:** TBD

## 8.1 Objective

Emit the minimal relevant set — of artifacts and of skills — deterministically, and measure what
it saves.

## 8.2 Preconditions

→ verify: Phase 3 `COMPLETE` — skill subsetting derives from cursor state.
→ verify: the **evidence bundle's** Phase 0 token accounting exists. This phase's entire justification is a number it
cannot produce otherwise.

## 8.3 Files touched

| File | Action |
|---|---|
| `src/grace-context.ts` | CREATE |
| `src/grace-context.test.ts` | CREATE |
| `src/grace.ts` | EDIT — `context` subcommand |
| `src/grace-module.ts`, `src/grace-file.ts` | READ ONLY — the retrieval primitives already exist |
| `skills/ngrace/ngrace-execute/SKILL.md` | EDIT |
| (+ mirror) | EDIT |

## 8.4 Design

**Selection, never compression** (D15). No model is required and none is used.

### The slice (§4.1, D7)

```
grace context --task T-001
  → Purpose header: task Summary + the AC-* text it Satisfies, verbatim from
    approved artifacts — never agent paraphrase at emit time
  → Body (graph-minimal): M-* anchors the task names, their IC-* contracts,
    their V-M-* verification entries, task-local LINKS:
  → ObservedWriteScope paths
  → Explicit exclusions: design-context.xml, archived bundles, other tasks' scopes
```

The field list is v3's `<ExecutionPacket>` (F4). **The v5 improvement is that it is emitted from
the graph rather than assembled by an agent** — composition over `module show --with verification`,
`module find --depends` and `file show --contracts`, all of which already exist and are
deterministic.

`design-context.xml` exclusion is **absolute**, not advisory (§4.6 rule 2).

### Skill subsetting

Derived from cursor state: an approved plan mid-execution needs `ngrace-execute` and `ngrace-cli`,
not `ngrace-init` or `ngrace-migrate`.

**The toolkit recommends; the host loads.** `ngrace` cannot unload a skill from a model's context.
This is a §5.2 conditional guarantee.

### Two-stage narrowing

| Stage | Does | Property |
|---|---|---|
| 1 — toolkit | narrow to candidates from state and graph | deterministic, free |
| 2 — harness | choose among candidates semantically | optional |

**Stage 1 errs toward inclusion.** A false negative is unrecoverable — stage 2 only sees
candidates. A false positive costs tokens.

**Correctness never depends on stage 2.** Without it the caller gets the candidate set: larger,
still correct.

### Parallel safety

Slices are **per worker**, never per plan (§4.1, R1). A shared slice re-breaks the parallel path
on first real use.

## 8.5 Steps

**Step 8.5.1 — Slice emission over the existing queries.**
→ verify: a known graph and task produce exactly the expected anchor set — asserted by explicit
list, not by count. A count assertion passes while the contents are wrong.

**Step 8.5.2 — Exclusions.**
→ verify: `design-context.xml` never appears, including when the task's module links to it; other
tasks' scopes never appear; archived bundles never appear.

**Step 8.5.3 — Purpose header verbatim from approved artifacts.**
→ verify: the emitted text is byte-identical to the source `Summary` and `AC-*`. Any
transformation is a defect — the paraphrase is the failure mode this exists to prevent.

**Step 8.5.4 — Per-worker slices.**
→ verify: two workers on two tasks receive disjoint scopes, with no silent union.

**Step 8.5.5 — Skill subsetting from cursor state.**
→ verify: three cursor states produce three different recommended skill sets, and an absent cursor
produces the full set rather than an empty one. Stage 1 errs toward inclusion.

**Step 8.5.6 — Candidates carry their basis.**
→ verify: each candidate names why it is a candidate — which anchor, which state — not a bare name.

**Step 8.5.7 — Measure.**
→ verify: report `selectionRatio` for at least three real tasks from this repository's own `.ngrace`
(the evidence bundle's Phase 1). **This is the number §4.1 has never had.** If the saving is small, say so — the
measurement is the deliverable, not a favourable result.

## 8.6 Definition of done

- Slice contents asserted by explicit anchor list
- Exclusions absolute and tested
- Purpose header byte-identical to source
- Per-worker disjointness tested
- Absent cursor yields the full set
- Real measurements reported for ≥3 tasks
- `bun run validate:ci` green

## 8.7 Review gate

1. Is any emitted text a paraphrase rather than a quotation?
2. Does stage 1 ever exclude something stage 2 could not recover?
3. Were the measurements taken against this repository, or against fixtures? Fixtures do not
   answer the question.

## 8.8 Rollback

Delete the module and subcommand. Skills fall back to reading artifacts directly, as today.

---

# PHASE 9 — Confidence recording & calibration report

**Status:** `NOT STARTED`
**Decisions:** D6 (calibration half)
**Release:** TBD

## 9.1 Objective

Record self-reported confidence so it can be studied, consume it nowhere, and build the report
without which the field is pure token tax.

## 9.2 Preconditions

→ verify: Phase 3 and Phase 6 `COMPLETE`. Claims need somewhere to land and something to
adjudicate them.

## 9.3 Files touched

| File | Action |
|---|---|
| `src/artifact/types.ts` | EDIT — `claimedConfidence` |
| `src/calibration/report.ts` | CREATE |
| `src/calibration/report.test.ts` | CREATE |
| `src/grace-doctor.ts` | EDIT — surface the report |
| `src/lint/core.ts` | EDIT — the separation rule |
| `skills/ngrace/ngrace-execute/SKILL.md` | EDIT |
| (+ mirror) | EDIT |

## 9.4 Design

**Two fields, never merged** (D6):

| Field | Author | Consumable by a gate? |
|---|---|---|
| `precision` (`exact \| heuristic`) | CLI-derived | Yes |
| `claimedConfidence` (three-level ordinal) | agent-authored | **No** |

**`agent-inferred` anchors may not carry `precision`.** Pattern 1 enforced structurally.

**Context is derived, not authored** (D6) — joined from the ledger and bundle. Executor identity
is the exception: harness-stated, unverifiable, recorded once on `<EpochOpened>`, may be absent.

**Promotion bar, stated in the docs now:** demonstrated calibration on a held-out set, per context
class, before `claimedConfidence` may inform any gate.

## 9.5 Steps

**Step 9.5.1 — Add `claimedConfidence` as a three-level ordinal.**
→ verify: free text and percentages are rejected by the grammar. An unaggregatable scale is a
field that will never answer the question.

**Step 9.5.2 — The separation rule.**
→ verify: a lint error when an `agent-inferred` anchor carries `precision`; and a test asserting
no gate in `src/gates/` reads `claimedConfidence`. The second is the one that matters — grep is
not a test.

**Step 9.5.3 — Context derivation by join.**
→ verify: task kind, adapter presence, wrote-vs-read, and sequential-vs-parallel are all derived;
none is authored alongside the claim.

**Step 9.5.4 — The calibration report.**
→ verify: reports claimed confidence against adjudicated outcome, bucketed by context class, and
excludes incomplete epochs as a class (D6's bias safeguard). Show both the included and excluded
counts.

**Step 9.5.5 — Document the promotion bar.**
→ verify: the docs state that `claimedConfidence` informs nothing today and what would have to be
true for that to change.

## 9.6 Definition of done

- Ordinal scale enforced
- Separation rule tested, including the no-gate-reads assertion
- Context derived, not authored
- Report excludes incomplete epochs and says so
- Promotion bar documented
- `bun run validate:ci` green

## 9.7 Review gate

1. Does anything outside the calibration report read `claimedConfidence`?
2. Does the report pool complete and incomplete epochs?
3. Is the promotion bar written where someone would find it before using the field?

## 9.8 Rollback

Remove the field, the rule and the report. Nothing consumed it, so nothing breaks.

---

# PHASE 10 — Plan-quality signal & doctor consumers

**Status:** `NOT STARTED`
**Decisions:** D10, §4.9 subset
**Release:** TBD

## 10.1 Objective

Measure the plan, not only the agent — and ship the computable subset of requirements-quality
checks.

## 10.2 Preconditions

→ verify: Phase 6 `COMPLETE`. The signal is computed from review outcomes.

## 10.3 Files touched

| File | Action |
|---|---|
| `src/review/outcomes.ts` | CREATE — scope and resolution classification |
| `src/review/outcomes.test.ts` | CREATE |
| `src/grace-doctor.ts` | EDIT — the §4.9 subset |
| `src/grace-doctor.test.ts` | CREATE — no such file exists yet |

## 10.4 Design

**Record scope with every review outcome** — task-scoped and wave-scoped failures mean different
things and may not be pooled (D10).

**Classify by resolution, not by the review's opinion:**

| Resolution | Classification |
|---|---|
| Code-only fix | implementation defect |
| Required an amendment or supersede | **plan defect** |

Both are ledger joins, so classification is deterministic.

**The sound inference, and only this one:** a wave-level review failure where every constituent
task passed its own verification is a decomposition failure. Record the precondition alongside, or
the inference cannot be validated later.

**Honest caveat to carry into the docs:** a code-only fix can paper over a plan defect and will be
scored as implementation. Proxy, not truth.

### Doctor subset (§4.9, computable only)

- `AC-*` with no task `Satisfies` and no `V-M-*` path
- `IC-*` with no owner or version
- `ST-*` with no evidence
- anchors carrying unresolved clarifications

**The judgment-dependent remainder is not built here.** It has no dataset support, and D10 is the
mechanism that will generate it.

## 10.5 Steps

**Step 10.5.1 — Record review scope.**
→ verify: task-scoped and wave-scoped outcomes are distinguishable in the ledger, and a query
cannot accidentally pool them.

**Step 10.5.2 — Resolution classification by join.**
→ verify: a change resolved by amendment classifies as plan defect; one resolved by code only
classifies as implementation. Both asserted against real ledger contents, not mocks.

**Step 10.5.3 — The all-tasks-passed precondition.**
→ verify: a wave failure where one task also failed its own verification is **not** classified as
a decomposition failure.

**Step 10.5.4 — The four doctor checks.**
→ verify: each fires on a fixture designed for it and stays silent on the evidence bundle's Phase 1
`.ngrace`. Report
both.

**Step 10.5.5 — Document the proxy caveat.**
→ verify: the caveat appears next to the number, not in a footnote elsewhere.

## 10.6 Definition of done

- Scope recorded and unpoolable
- Classification by join, tested both ways
- Precondition enforced
- Four doctor checks with fires/silent pairs
- Caveat published beside the metric
- `bun run validate:ci` green

## 10.7 Review gate

1. Can a query pool task-scoped and wave-scoped outcomes?
2. Was any judgment-dependent checklist check built? It should not have been.
3. Is the caveat adjacent to the number?

## 10.8 Rollback

Delete the outcomes module and revert the doctor checks.

---

# PHASE 11 — Adoption surface

**Status:** `NOT STARTED`
**Decisions:** §5.1, §5.3
**Release:** TBD

## 11.1 Objective

Make everything above learnable. **This is a blocking constraint, not a documentation chore**
(§5.1): the walkthrough lands with or before the last user-visible capability.

## 11.2 Preconditions

→ verify: Phases 3, 5, 6 and 8 `COMPLETE`. The walkthrough demonstrates their surfaces, and a
walkthrough written against unshipped behaviour is fiction.

## 11.3 Files touched

| File | Action |
|---|---|
| `examples/polyglot/README.md` | EDIT — extend to a full lifecycle |
| `README.md` | EDIT — tier table |
| `docs/` | CREATE — walkthrough |
| `skills/ngrace/ngrace-explainer/references/*` | EDIT |
| (+ mirrors) | EDIT |

## 11.4 Design

**One complete change lifecycle a newcomer can feel** (§5.1):

approve → execute one task with a sliced context → hit a scope amendment → see a `not-run`
verdict → pass a detached review → fold an epoch → archive.

The existing `examples/polyglot` is CI-verified and governs three files. Extend it rather than
inventing a second example.

### Reliability tier table (§5.3, revised per §3.3)

Tiers change **depth, never whether gates run**.

| Mechanism | T0 hotfix | T1 | T2 | T3 |
|---|---|---|---|---|
| Honest verdicts | Full | Full | Full | Full |
| Ledger & amendment trail | Full | Full | Full | Full |
| Run cursor | Full | Full | Full | Full |
| Context slices | Optional | Default | Default | Default |
| Detached review | Mechanized only | Mechanized + probe | Full | Full + fixpoint |
| Coverage attribution | — | Optional | Default | Default |
| Doctor checklist subset | — | — | Yes | Yes + advisory |

**T0 may not skip honesty or the ledger.** It may skip depth.

## 11.5 Steps

**Step 11.5.1 — Extend the example to the full lifecycle, CI-verified.**
→ verify: the example's CI check exercises every step above and fails if any is removed.

**Step 11.5.2 — Publish the tier table with measured token costs.**
→ verify: every cell that says "Full" or "Default" has a token figure behind it from the evidence
bundle's Phase 0 token accounting. Adjectives without numbers are what §5.3 flagged as the gap.

**Step 11.5.3 — Recovery documentation.**
How to recover when `ngrace lint` fails with an unfamiliar code; how to rebuild a lost cursor from
the ledger; how to read an incomplete epoch.
→ verify: each procedure executed against a deliberately broken fixture, with output shown.

**Step 11.5.4 — Update `docs/plans/README.md` and archive this plan.**
→ verify: status frontmatter agrees with directory (README rule 2); index updated in the same
commit (rule 4).

## 11.6 Definition of done

- Full lifecycle CI-verified end to end
- Tier table published with real numbers
- Recovery procedures executed, not merely written
- Index and status agree
- `bun run validate:ci` green

## 11.7 Review gate

1. Does the walkthrough demonstrate a capability that does not ship?
2. Does any tier cell imply a gate is skipped rather than shallower?
3. Were the recovery procedures run, or only described?

## 11.8 Rollback

Documentation only. Revert the edits.

---

---

## 12. Cross-cutting conventions

### 12.1 New issue codes

Every code added by this plan is registered in `src/lint/catalog.ts` with a severity, a
remediation string, and — new for this track — an evidence link (§5.7, R3's complement):

| Field | Meaning |
|---|---|
| `derivedFrom` | the defect that motivated this code |
| `proposedBy` | the pattern in §2.1 it defends against |

A code with neither is a deletion candidate. This makes §6's *"delete anything not justified by a
failure"* machine-checkable.

Codes are namespaced by surface (D14): `artifact.*` and `projection.*` for lint, `gate.*` for
transition gates, `review.*` for review findings. **A `gate.*` code may not be emitted by
`runLint`.** That is the D14 boundary, and it is testable.

### 12.2 Skill mirroring

Every edit under `skills/ngrace/` is copied to `plugins/ngrace/skills/ngrace/` in the same commit.
`validate-marketplace.ts` compares each listed skill directory recursively; an unmirrored
`references/` file fails the build.

### 12.3 Commit hygiene

One phase, one or more commits, never a commit spanning two phases. Commit messages name the
phase and the step range.

### 12.4 Anti-patterns — do not do these

Re-read this list against your finished diff in every phase (§0.7.5).

1. **Asserting a fact you did not check.** Pattern 1. If you did not run it, the value is the
   absence value with a reason (D5) — never `pass`, never silence.
2. **A comparison where one side derives from the thing under test.** Pattern 2. Round-trip tests
   and symmetric fixtures pass while the code is broken.
3. **A guard written as a regex over structured text.** Pattern 3. Where the input has structure,
   scan the structure.
4. **A zero-or-more list with no cardinality check.** Pattern 4. It will swallow malformed
   children silently.
5. **A new construct not threaded back through earlier guarantees.** Pattern 5. Invisible by
   construction — every existing test still passes.
6. **Ordering by timestamp.** D2. Ranges order events; clocks do not.
7. **Making the cursor authoritative.** D1. The ledger is the truth; the cursor is a cache.
8. **A mechanism whose failure is silent.** D5. Three exits: clean, finding, absence-with-reason.
9. **Blocking policy inside a mechanism.** D5. Gates declare what they require; mechanisms report.
10. **Skill text carrying a vocabulary the binary already emits.** D13. One sentence, not an enum.

### 12.5 When you get stuck

Report the contradiction and stop. Do not improvise a design decision — `decisions.md` records
fifteen of them with their reasoning, and a sixteenth invented mid-phase will not be recorded
anywhere.

---

## 13. Traceability — decision to phase

| Decision | Subject | Phase |
|---|---|---|
| D1 | Cursor is a separate file and a cache | 3 |
| D2 | Immutable event files, pre-allocated ranges | 3 |
| D3 | Per-epoch fold, `Epoch-N` | 3 |
| D4 | Determinism gate + seeded-corpus trend | 0 (corpus), 6 (gate) |
| D5 | Trust model; absence value; gates declare | 2 (vocabulary), 5 (gates) |
| D6 | Confidence recorded, never consumed | 4 (attempt log), 9 (calibration) |
| D7 | Restore v3 surfaces under v5 enforcement | 0 (audit), 3/4/8 (restorations) |
| D8 | Deterministic failure localization | 7 |
| D9 | Fix budget of 2, escalate to replan | 4 |
| D10 | Wave-scoped review as plan-quality signal | 10 |
| D11 | `applied` requires a recorded verdict | 5 |
| D12 | Clarifications block; assumptions do not | 5 |
| D13 | Packaging: no includes, no manifest metadata | 2 |
| D14 | Three check surfaces | 5 (surface), 10.1 (convention) |
| D15 | Token accountability; selection not compression | 0 (format), 8 (selection) |
| D16 | A check that has never failed is not a check | **E**0 (audit what checks exist); enforcement deferred |
| F1 | Binary already writes; invariant restated | 0.3 invariant 8 |
| F4 | v3 execution layer dropped | 0 |

**Phases prefixed `E` are in the evidence bundle** — `E0` and `E1` are
[RM-AGENT-RELIABILITY-EVIDENCE](../../archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md)'s Phases 0 and 1. Bare
numbers are phases in this document. The unprefixed `0` and `1` in the rows above predate the
2026-07-29 split and mean the evidence bundle in every case: D4's corpus, D7's audit and D15's
measurement format are all its Phase 0, and F1's invariant is its §0.3.

Every decision appears in at least one phase. A decision with no phase is either deferred in
`decisions.md` § Outstanding, or this table is wrong.

**D16 is deliberately half-placed.** Its measurement lands in `E0` — auditing which checks exist and
which have ever been observed to fail. Its *enforcement* has no phase because whether `lint` should
require a falsification witness is priced against that audit, not decided ahead of it. That is a
deferral with a named trigger, not an omission.

---

## 14. Amendments

Append-only. Each entry records a decision or a correction made after the plan was written, with the
date it was made. Never edit an existing entry; add a new one that supersedes it.

### A1 — 2026-07-30 · Approved for execution

**Approved by the maintainer on 2026-07-30.** §2 sequencing rule 0 is satisfied:
[RM-AGENT-RELIABILITY-EVIDENCE](../../archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md) is `complete` and
archived, both its phases landed (`583a327`, `e33d048`), and `ngrace lint --path .` exits zero on this
repository.

**What this approval clears, and what it does not.** The objectives, decisions delivered, and review
gates for Phases 2–11 are ratified. **The numbered steps are not.** The banner above says they are
drafts against an imagined dataset, and approving the bundle does not promote them: before each phase
runs, re-derive its steps from what the evidence bundle actually produced and record the difference in
this section. Treating a step as specified because the plan is `approved` is the exact failure this
split was made to prevent.

**`targets` stays empty and the Release column stays `TBD`.** Releases are assigned per phase, not by
this approval.

**The evidence to re-derive against, as it exists at `e33d048`:**

- **D15 token accounting** — `src/test-support/token-accounting.ts` with `skillTextLines()`,
  `commandOutputBytes()`, `selectionRatio()`. The baseline is **636 SKILL.md lines across 16 skills**,
  captured pre-`.ngrace` and asserted exactly in `token-accounting.test.ts`. `referencesTotal` is
  asserted only `> 0`, so Phase 8 must pin its own reference figure rather than cite 1285 as
  instrumented. The baseline is not repeatable — do not edit the expected values; the design is that
  the baseline moves while the instrument holds still.
- **D4 defect corpus** — `src/test-support/defect-corpus.ts`, **ten entries** across the five
  patterns, with finding reachability declared per expected finding (`surface`, `lintMode`,
  `changeId`, `moduleId`). Phase 6's mechanized audits consume this. Ids are stable and never
  renumbered. `corpus-zo-03` is a recorded known gap, not an oversight.
- **A real `.ngrace` tree** — five modules (`M-LINT-CORE`, `M-ASSERTIONS`, `M-GRAMMAR`, `M-STATUS`,
  `M-SKILLS`), five verification entries, `GD-MAIN` / `VD-MAIN`, empty change dirs. Thin on purpose;
  Phases 3, 4, 8 and 9 design against it. Four `graph.module-without-linked-files` warnings are
  expected and deliberate: `src/project-utils.ts:568` forces ROLE→MAP_MODE, so adding
  `START_MODULE_CONTRACT` to those four files would mean enumerating 38 exports that must then stay in
  sync forever.

**Two debts this track inherits, both owed by named phases:**

1. **The `scripts/` lint suppression.** `.ngrace-lint.json` ignores `examples` (a nested project,
   covered by `validate:examples`) and `scripts` — the second hides **20 pre-existing errors** in this
   repository's own code: six `markup.unknown-link` to `M-RELEASE-AUTOMATION`, five
   `role-map-mode-mismatch`, five `module-map-mismatch`, three `reversed-marker`, one
   `duplicate-marker`. Adoption is deferred to a later `C-*`. Phase 10 must not read a rising
   `Governed files` count as progress it caused.
2. **Candidate `corpus-re-03`.** `src/project-utils.ts:130` matches marker names with a line-oriented
   regex and no string-literal awareness, so fixture markers inside template literals parse as real
   markup. Phase 1 worked around it in `src/project-utils.test.ts`; the defect is open. It belongs to
   whichever phase touches markup scanning. The rewritten helper is not evidence the scanner is
   correct.

### A2 — 2026-07-30 · Phase 10's doctor baseline, recorded here

The evidence bundle's A2 item 5 required the first `ngrace doctor` reading on this repository to be
recorded **with the `.ngrace-lint.json` contents inline**, as Phase 10's baseline. It was reported at
Phase 1 review but never committed to a file, and that bundle is archived and may not be edited — so
the baseline is recorded here, in the plan that owns Phase 10. Re-captured at `e33d048`, whose tree is
byte-identical to the tree Phase 1 landed.

Configuration in force (`.ngrace-lint.json`):

```json
{
  "ignoredDirs": [
    "examples",
    "scripts"
  ]
}
```

`bun run ngrace doctor --path .` → exit 0:

```
neo-grace Doctor
================
Root: /Users/sas/Projects/neo-grace

Adapters
  - js-ts: .cjs, .cts, .js, .jsx, .mjs, .mts, .ts, .tsx
  - python: .py, .pyi
  - dart: .dart
  - go: .go
  - rust: .rs

Analysis coverage
  Governed files: 0
  Adapter-backed: (none)
  Unverified: (none)

Document size (limits: 50 anchors / 30720 bytes)
  No documents over limit.

Optional context artifacts
  - design-system.xml: missing (optional)
  - invariants.xml: missing (optional)

Analysis issues
  None.
```

`bun run ngrace lint --path .` → exit 0, 72 files checked, **0 governed files**, 9 XML artifacts,
0 errors, 4 warnings (the four `graph.module-without-linked-files` named in A1).

**`Governed files: 0` is the honest reading of `src/`**, which has never carried semantic markup — not
a measurement failure. It is zero *because* of the configuration above, and Phase 10 compares against
both together or against neither.

### A3 — 2026-07-30 · The standing quality bar, and Phase 2 re-derived against HEAD

A1 required each phase to re-derive its steps from what the evidence bundle actually produced before it
runs, and to record the difference here. This is that record for Phase 2, done before execution rather
than during it. It also sets a bar that applies to **every remaining phase**, not only this one.

#### A3.1 The quality bar — normative for Phases 2–11

**A phase's step list is a floor, not a budget.** A phase is done when its objective is genuinely met —
tested, recorded, no workaround left standing — not when its numbered steps are ticked off. The steps
were written before the code existed, so they are routinely thinner than the work; where they are, do the
work and record the difference in this section.

Three consequences, binding on every phase:

1. **Test what you change.** A surface this plan modifies must have a test that covers the modification.
   "No test file exists yet" is a reason to create one, not a reason to skip it.
2. **Fix defects in the files you are already editing.** A known defect in a file a phase touches belongs
   to that phase. Deferring it to a later phase that may never arrive is how the debt in A1 accumulated
   in the first place.
3. **Keep the `.ngrace` tree honest.** Work on files no module governs is work this repository's own
   tooling cannot see. Either bring them under the graph or state per file why they stay out.

**The bar is depth, not breadth.** Depth on the phase's own surface is required; reaching into a later
phase's design is still refused — no `run-ledger.xml`, cursor, attempt log or provenance attribute
before the phase that owns it. If a phase appears to *need* a later construct, that is a finding to
report, not a licence to build it. Deferral stays legitimate when folding work in would swamp the review
gate that has to judge the phase — but it is then a decision to raise, never an omission to leave
implied.

#### A3.2 Eight corrections to Phase 2, measured at `009a3e8`

**1 — §2.3 omits the file that raises two of the three absence codes.** The table names
`src/artifact/assertions.ts` but not `src/project-utils.ts`:

| Code | Emission site |
|---|---|
| `assertion.command-not-evaluated` | `src/artifact/assertions.ts:263`, `:506` |
| `analysis.no-adapter` | `src/project-utils.ts:344` |
| `analysis.runtime-missing` | `src/project-utils.ts:330` |

`:330` is a ternary — `LanguageRuntimeMissingError ? "analysis.runtime-missing" : "analysis.adapter-failed"`.
One branch is an absence, the other a defect; they may not be classified together.

**2 — step 2.5.4 cannot work until a `Pick` is widened.** `src/grace-doctor.ts:52` declares
`analysisIssues: Array<Pick<LintIssue, "code" | "severity" | "file" | "message">>`, which structurally
drops any field 2.5.1 adds. Widen it to include `issueClass`. The failure mode is silent: the
classification appears in `lint --format json`, is absent from `doctor`, and nothing errors.

**3 — step 2.5.6's rule may not be written as "exactly one file."** Measured across `skills/`:
`unable-to-determine` **0 files**, `satisfied-unverified` **0**, `not-run` **0**. As *exactly one* the
rule fails on any tree without `verdicts.md` — including one where 2.5.6 lands before 2.5.5, and any tree
a bisect visits. Write it as **at most one**, with a separate assertion that `verdicts.md` exists and
carries all three tokens: two checks that each fail for one reason. **Scope the scan to `skills/`** —
`plugins/ngrace/skills/` is a byte-identical mirror, so a repo-wide scan fails on correct work.

**4 — §12.1's `proposedBy` cites a section that no longer holds patterns.** It defines the field as "the
pattern in §2.1 it defends against"; after the 2026-07-29 split, §2.1 is Phase 2's *Objective*. The
vocabulary is the D4 corpus's `PatternId` (`src/test-support/defect-corpus.ts:18,26`) — five values:
`confidently-wrong`, `self-referential-comparison`, `regex-over-structure`, `zero-or-more-swallow`,
`unthreaded-construct`. Type `proposedBy` against that union, **without importing `src/test-support/`
into `src/lint/`** — invariant 7 keeps test support off the published surface. Duplicate the union in
`catalog.ts` or lift it to a shared non-test module, and state which.

**5 — `skills/ngrace/ngrace-cli/references/` does not exist.** Step 2.5.5 assumes it does. The directory
is part of the create, in both trees.

**6 — step 2.5.7 will fail `src/test-support/token-accounting.test.ts`, correctly.** The test asserts
`expect(measured.total).toBe(636)` exactly; one sentence in three SKILL.md files makes it 639. Update the
expected value in the same commit and report both numbers and the delta. This is the instrument working,
not a regression — the baseline is meant to move while the instrument holds still. Do not modify
`token-accounting.ts`. Two figures that do **not** move: `perSkill` length stays **16** (a reference file
is not a skill), and `referencesTotal` is asserted only `> 0` — which also means **1285 is pinned by
nothing**, so any references figure must be measured before it is cited.

**7 — §2.4's pseudocode says `interface LintIssue`; it is a `type`** (`src/lint/types.ts:11`). Add the
optional field; do not convert the declaration.

**8 — the phase changes two surfaces that nothing tests and nothing governs.**

| Gap | Measured |
|---|---|
| `src/grace-doctor.test.ts` | **does not exist**; doctor is exercised once, incidentally, at `src/artifact/scale-ergonomics.test.ts:381` |
| Graph ownership of the files §2.3 edits | `assertions.ts` → `M-ASSERTIONS`; `src/lint/types.ts`, `src/lint/catalog.ts`, `src/grace-doctor.ts` → **no module** |

Also confirmed: **§2.2's preconditions hold exactly as written** — two `command-not-evaluated` sites at
`:263` and `:506`, one `analysis.no-adapter` in `catalog.ts` at `:34`. F-series findings have not
drifted. And **no test asserts an exact issue-object or guide shape** (`grace-lint.test.ts` uses
`objectContaining` or code projections at `:102`, `:116`, `:199`, `:276`, `:239`–`:241`, `:972`), so
2.5.1's additive-field bar is achievable. `schemaVersion` stays `"1.0.0"`: an optional additive field is
not a breaking schema change, and bumping it would ripple into `grace-status` and `grace-query` for
nothing.

#### A3.3 Scope added to Phase 2 by A3.1

- **`src/grace-doctor.test.ts` is created in this phase**, covering absence-by-reason output, the zero
  case, and `--format json` shape. Phase 10's §10.3 lists this file as `CREATE — no such file exists
  yet`; that assumed doctor stayed untested until Phase 10, which step 2.5.4 invalidates. **Phase 10
  inherits the file rather than creating it.**
- **Candidate `corpus-re-03` is reassigned to Phase 2, and the scanner defect is fixed here.** A1 owed it
  to "whichever later phase touches markup scanning"; step 2.5.2 edits `src/project-utils.ts`, and the
  defect is at `:130` in that same file — a line-oriented regex over
  `START_MODULE_CONTRACT|START_MODULE_MAP|…` with no string-literal awareness. Give the scanner
  string-literal awareness, land `corpus-re-03` with the shape that used to defeat it, and revert Phase
  1's `contract()` workaround in `src/project-utils.test.ts` if the fix makes it redundant. Leaving a
  `regex-over-structure` defect in the parser while building reliability tooling is the contradiction A1
  named when it said the rewritten helper is not evidence the scanner is correct.
- **`corpus-zo-03` gets a real attempt.** It is a recorded gap because no shape was found that still
  linted clean after apply — not because the gap is acceptable. If it still cannot be written honestly,
  report the shapes tried and why each failed. A gap with an attempt behind it is evidence; one with
  nothing behind it is a placeholder.
- **Graph and verification cover the files the phase edits**, or each exception carries a stated reason.
  `M-LINT-CORE` covers `src/lint/core.ts` only — `types.ts` and `catalog.ts` are separately unowned.
  Stay thin; "thin" was never "the files we edit are invisible to lint."

#### A3.4 Two decisions pending, to be answered before Phase 2 is applied

1. **A `C-*` change bundle for this phase.** This repository dogfoods its own tooling, `CLAUDE.md` says
   per-change execution artifacts are bundles under `.ngrace/changes/`, and Phase 2 is a real change to
   `src/`. **Recommendation: open one.** Phase 1 shipping with no active change was right *for Phase 1* —
   `ngrace-init`'s SKILL.md forbids dummy bundles and there was nothing to gate (A2 item 4 of the
   evidence bundle). Phase 2 is not a dummy, and doing it here means Phase 5's transition gates land on a
   repository that already has a real bundle to gate.
2. **Whether Phase 2 also adopts `scripts/`.** The 20 suppressed errors are the last standing silent
   degradation in this repository (invariant 3), and Phase 2 edits a file inside the ignored directory.
   **Recommendation: keep the guard and give adoption its own `C-*`** — folding six unrelated files in
   would swamp the review gate that must judge the absence-value work. Raised rather than left implied.
   If it is folded in, it lands as a separate commit on the same branch.

   Either way, Phase 2 must report the un-ignored error count before and after its changes. The reference
   reading at `009a3e8` with `ignoredDirs: ["examples"]` alone is **6 governed files, 20 errors**:
   6 `markup.unknown-link`, 5 `markup.role-map-mode-mismatch`, 5 `markup.module-map-mismatch`,
   3 `markup.reversed-marker`, 1 `markup.duplicate-marker`. `scripts/` is lint-invisible at the default
   config, so drift introduced there is silent unless measured.

#### A3.5 Additions to §2.6 definition of done

- A3's corrections applied, with each measurement reproduced in the phase report
- `issueClass` visible in **both** `lint --format json` and `doctor`
- `src/grace-doctor.test.ts` exists and covers the three cases above
- Both doctor readings reported — the zero case from this repository, the non-zero case from a fixture,
  each labelled. The non-zero case **cannot** come from this repository: root reports
  `Governed files: 0`, so build a fixture governing an extension no adapter supports (the five adapters
  are js-ts, python, dart, go, rust; use `codeExtensions: [".ex"]`). Do not weaken the root config to
  manufacture an absence.
- Scanner string-literal aware; `corpus-re-03` in the corpus and firing; Phase 1's workaround reverted if
  redundant
- `corpus-zo-03` landed, or refused with the attempted shapes shown
- Graph and verification coverage settled for every file edited
- Single-source rule shown **failing** on deliberate duplication, not only passing — §2.7 gate 3, and
  §0.7.2: zero failures is a finding, not a pass
- Token delta reported, new expected value committed
- `bun run validate:ci` **and** `bun run validate:packed` green — invariant 7, since this phase touches
  both `src/test-support/` and the catalog

A pointer to this amendment was added under the `# PHASE 2` header, so a phase-by-phase reader reaches it
without reading to the end of the plan. Nothing in §2.1–§2.8 was rewritten.

### A4 — 2026-07-30 · A3.4 answered, and a ninth Phase 2 correction

Both decisions A3.4 left open are answered by the maintainer, and settling the first one surfaced a
correction A3.2 missed.

#### A4.1 Phase 2 opens a `C-*` change bundle — decided yes

This repository dogfoods its own tooling, so Phase 2's work flows through a bundle rather than landing as
a bare commit. Phase 5's transition gates then arrive at a repository that already has a real bundle to
gate, instead of gating a hypothetical.

Mechanics verified against `src/artifact/grammar.ts` and `src/artifact/types.ts` at `3f943b4`, not
assumed:

- **Location and files.** `.ngrace/changes/active/C-<ID>/` holding `spec.xml` and `plan.xml`. Only
  `spec.xml`, `plan.xml` and `design-context.xml` may be `.xml` files in that directory
  (`grammar.ts:809`) — anything else is an error, so working notes go elsewhere.
- **Statuses are closed sets.** Active bundles accept `draft` or `approved` only; archive accepts
  `applied`, `rejected`, `cancelled`, `superseded` (`types.ts:53,56`). A `plan.xml` present in an active
  bundle requires its `spec.xml` to be `approved` (`grammar.ts:788`) — so `spec.xml` at `draft` means
  `plan.xml` does not exist yet, and writing both at once means the spec is being approved in the same
  breath. Author the spec, stop for review, then the plan.
- **The wrapper tag must equal the directory name**, in both files, or `change.bundle-id-mismatch` /
  `change.spec-plan-id-mismatch` fire (`grammar.ts:757,768,771`).
- **Shape reference:** `examples/polyglot/.ngrace/changes/active/C-ADD-KEYBOARD-NAV/`. Read it rather
  than inventing a shape. Its `DurableScope` names `GraphAnchors` and `VerificationAnchors`.

**That last point couples the bundle to A3.3.** A bundle's `DurableScope` names graph and verification
anchors, and three of the four `src/` files Phase 2 edits are owned by no module. So the graph coverage
A3.3 requires is not optional bookkeeping — without it the bundle has no anchors to declare, and the
dogfooding is decorative. Do the graph work before writing `plan.xml`.

#### A4.2 `scripts/` keeps its guard — adoption stays its own `C-*`

Phase 2 does not adopt `scripts/`. It measures the un-ignored error count before and after its changes
and reports both (reference at `009a3e8`: **6 governed files, 20 errors**, broken down in A3.4). Adoption
needs an `M-RELEASE-AUTOMATION` module plus ROLE/MAP_MODE parity fixes across six files unrelated to
absence values; folding that in would swamp the review gate that has to judge the absence-value work.

**This is a deferral with a named owner, not an omission:** its own `C-*`, and it remains the last
standing instance of the silent degradation invariant 3 forbids. Do not let the guard's presence imply
the debt is settled.

#### A4.3 Correction 9 — `doctor` sees only two of the three absence codes

`src/grace-doctor.ts:105–106` builds `analysisIssues` by string prefix:

```ts
analysisIssues: lint.issues.filter((issue) => issue.code.startsWith("analysis."))
```

`analysis.no-adapter` and `analysis.runtime-missing` match. **`assertion.command-not-evaluated` does
not** — so step 2.5.4's "report absences by reason" can only ever report two thirds of the class while
that filter stands. A3.2 correction 2 found the `Pick` that drops the field; this is the filter that drops
the *issue*, and widening the `Pick` alone leaves the third code invisible.

**Replace the prefix filter with the classification** — `issue.issueClass === "absence"` — rather than
adding `assertion.` to the prefix list. §2.4's stated purpose for `issueClass` is that "a consumer can ask
*is this an absence?* without enumerating seven names," and this filter is that consumer. A prefix test
extended by hand is the same enumeration in a different shape, and it silently under-reports the moment a
fourth absence code lands in a fourth namespace.

Two consequences to carry into the report:

1. **`doctor`'s absence count will move from 2 possible codes to 3.** That is a behaviour change on a
   surface Phase 10 baselines. A2 recorded the baseline with `Analysis issues: None`, so the zero case is
   unaffected — but say explicitly that the widening happened, so Phase 10 does not read the new shape as
   drift.
2. **A `C-*` bundle with a `MustPassCommand` makes this observable in this repository.** Command
   assertions are not executed under default lint, so they emit `assertion.command-not-evaluated` — an
   absence, in this repo's own output, with no fixture required. A4.1's bundle therefore gives Phase 2 a
   live absence to demonstrate against. It does **not** replace A3.5's fixture requirement: the fixture
   covers `analysis.no-adapter`, which needs a governed file with no adapter, and this repository has
   `Governed files: 0`. Report both.

> **Consequence 2 is withdrawn by A5.2.** Its premise is right and its inference is wrong: default lint
> *skips* unevaluated command assertions rather than reporting them, so the bundle yields no live absence.

### A5 — 2026-07-30 · Two more corrections, and three standing rules against the class that produced them

Phase 2's draft `spec.xml` was reviewed before approval. Two further corrections came out of it — but the
more useful finding is that corrections 2, 9 and 10 are **the same defect three times**, so this entry also
sets rules that bind every remaining phase, not only this one.

#### A5.1 Correction 10 — `issueClass` cannot reach lint from `assertions.ts`

Measured at `0085f32`:

- `assertion.command-not-evaluated` is emitted as an `NgraceIssue` (`src/artifact/types.ts:150-156`).
  That type carries `severity`, `code`, `file`, `line`, `message` — and nothing else.
- `addNgraceIssue` (`src/lint/core.ts:48-56`) re-lists exactly those five fields into the `LintResult`.
  Anything the artifact layer attaches beyond them is dropped on the way in.

So §2.5.2's "set `issueClass` at the emission sites" works for the two `analysis.*` codes —
`src/project-utils.ts` builds a `LintIssue` directly via `markupIssue` (`:607`) — and **cannot** work for
the third. Choose a route and state which:

1. **Widen `NgraceIssue` and `addNgraceIssue`.** Keeps §2.5.2's emission-site model, at the cost of a field
   on the artifact-layer record that only lint reads.
2. **Derive the class from the catalog** in `withLintIssueGuide` (`src/lint/catalog.ts:459`).
   `finalizeResult` already maps every issue through it (`core.ts:65`) and it already spreads `...issue`, so
   the class arrives on every issue regardless of which layer emitted it, and a new absence code cannot
   forget to classify itself.

**Recommendation: route 2** — it makes `AC-CATALOG-JUSTIFY`'s catalog the single source of the
classification instead of a second one running beside the emission sites. Either route pulls a file into the
change that the draft spec does not name: `src/lint/core.ts` (`M-LINT-CORE`) or `src/artifact/types.ts`.

#### A5.2 Correction 11 — `doctor` cannot observe `assertion.command-not-evaluated` at all

A4.3's consequence 2 claimed the `C-*` bundle's `MustPassCommand` gives Phase 2 a live absence in this
repository with no fixture. The premise is right — command assertions are not executed under default lint —
and the inference is wrong: default lint **skips** them rather than reporting the absence.

Measured at `0085f32`:

- `doctor` calls `lintGraceProject(root)` with no options (`src/grace-doctor.ts:68`) → `assertionMode:
  "current"`, and `doctorCommand` accepts only `--path` and `--format` (`:173-186`). There is no way to ask
  it for another mode.
- In `current` mode an active approved plan gets `BaselineAssertions` with `skipUnevaluatedCommands=true`
  and `TargetAssertions` with `evaluateSemantically=false` (`src/lint/core.ts:238-244`); the skip covers
  exactly `MustPassCommand` and `MustPassBudget` (`:290-297`). Archived plans are never evaluated
  semantically (`:247-250`).
- Two existing tests already pin this: `src/grace-lint.test.ts:410` and `:1080`.

The skip is deliberate, and the code's severity is why: it is an **error** (`assertions.ts:263`). If current
mode emitted it, every repository holding an active approved plan with a command gate would fail its own
lint. Three consequences:

1. **Writing `plan.xml` produces no absence in this repository.** A3.5's zero case survives — for *this*
   reason. Say so in the report, or a reader takes "zero" as evidence nothing was wired up.
2. **Step 2.5.4's `doctor` can report at most the two `analysis.*` codes.** Do not add flags to `doctor` to
   manufacture the third; that is Phase 2 growing scope to satisfy a sentence. Instead make the absence
   partition a pure function over `LintIssue[]`, unit-test it across all three codes, and add one lint-level
   test asserting the third code carries `issueClass` under `--assertion-mode target --change
   C-ABSENCE-VALUE`. Report it as *classified, unreachable from `doctor` today*, citing this amendment.
3. **Phase 10 baselines `doctor`.** It must not read "two of three" as an incomplete Phase 2.

#### A5.3 The shape three of these corrections share

| # | Record | The allowlist that drops it |
|---|---|---|
| 2 (A3.2) | `DoctorResult.analysisIssues` | `Pick<LintIssue, …>` — `grace-doctor.ts:52` |
| 9 (A4.3) | the issue itself | `code.startsWith("analysis.")` — `grace-doctor.ts:105-106` |
| 10 (A5.1) | `NgraceIssue` → `LintIssue` | five-field re-copy — `lint/core.ts:48` |

One defect, three times: a value is added at one end, an explicit list of fields or values on the path drops
it, **nothing errors**, and the surface reports a confident, smaller truth. That is §15's failure in
miniature — a report about work that was not checked. None of the three was found by the executor; each was
found by a different reader, after the step depending on it had been written.

Correction 11 is a second shape: a claim about runtime behaviour that nobody traced to the code. And the
draft `spec.xml` re-loosened two things a correction had already tightened (A5.6). One rule each.

#### A5.4 Standing rule 1 — inventory the drop sites before widening a record

**Normative for Phases 2–11.** Before a phase adds a field to a record that crosses a module boundary, it
produces a **drop-site inventory** for that record and puts it in the phase report: every point between
emission and each consumer surface that re-lists fields instead of carrying the record whole.

Shapes that qualify: `Pick<>` / `Omit<>`, an object literal that re-copies fields, a destructure-and-rebuild,
a projection inside `.map()`, a serializer with an explicit field list, and any filter that enumerates
*values* of the new field rather than reading it.

Each site is named `file:line` and marked **widened**, **deliberately not widened** (with the reason), or
**not on the path**. A phase that widens a record and reports no inventory has not finished the step.

#### A5.5 Standing rule 2 — an amendment is a claim measured at a commit, not a fact

Every amendment states what it measured and where. A phase that **depends** on a claim from an earlier
amendment re-measures it and reports agreement or contradiction. It does not transcribe it.

A4.3's consequence 2 was wrong on the day it was written, and the draft `spec.xml` carried it into an
acceptance criterion unexamined — `assertion.command-not-evaluated countable when present`, beside `zero case
on this repo`, two clauses that cannot both be demonstrated. Presence in an approved plan is not evidence.

When a claim contradicts the code: **report it and amend the plan before the work proceeds.** Silently
adopting it and silently working around it fail the same way — both leave the plan lying to the next reader.

#### A5.6 Standing rule 3 — a criterion that descends from a correction cites it

Corrections lose their teeth on transcription. Both instances in the draft spec come from corrections
already recorded in this section:

- **A3.2 correction 3** scoped the token scan to `skills/` and named the packaged mirror as the reason.
  `AC-SINGLE-SOURCE` says "at most one under `skills/`" — which a naive glob reads as matching
  `plugins/ngrace/skills/` too: precisely the failure the correction exists to prevent.
- **A3.2 correction 1** added `src/project-utils.ts` to §2.3 because the file table had been derived from
  prose rather than from the emission path. The draft's `AffectedAreas` repeats that error one layer up,
  omitting whichever file correction 10 pulls in.

So: an acceptance criterion descending from a correction **cites it inline** — `AC-SINGLE-SOURCE (A3.2 §3)` —
and carries the correction's discriminating detail: the excluded path, the defect branch, the mode. A
reviewer can then diff the criterion against its source in one read. And `AffectedAreas` is derived from the
traced code path, never from §x.3's file table — that table is a floor, exactly like the steps (A3.1).

#### A5.7 A finding for whichever phase owns scope checking — recorded, not scheduled

`src/artifact/scope.ts` validates `ObservedWriteScope`'s shape and computes overlaps between concurrent
active changes. **Nothing cross-checks its files against the graph's module `Path`s.** So a plan may write a
file whose owning module appears in neither `DurableScope` nor `AffectedAreas`, and lint stays quiet — the
same invisibility A3.3 fixed by hand for Phase 2, unenforced for the next change.
`change.scope-does-not-cover-spec` covers spec→plan (`grammar.ts:1176`) and `change.plan-scope-exceeds-spec`
the reverse as a warning (`:1199`); the file→module direction has no check at all. Do not build it in
Phase 2.

#### A5.8 Revisions required before `spec.xml` is approved

1. **`AC-DOCTOR-ABSENCE`** — rewrite per A5.2. Two codes reachable from `doctor`; the third classified and
   tested where it is reachable; the zero case attributed to the skip, not to absence of wiring.
2. **`AffectedAreas`** — add the file A5.1's chosen route pulls in, and state the route.
3. **`AC-SINGLE-SOURCE`** — "the repository-root `skills/` tree only; the packaged mirror is excluded",
   citing A3.2 §3.
4. **`AC-ISSUE-CLASS`** — name `analysis.adapter-failed` as the defect branch of the `:330` ternary
   (A3.2 §1). The trap is the branch, so the criterion must name it.
5. **`VerificationIntent`** — add `bun run ngrace lint --path .`. `validate:ci` lints only
   `examples/polyglot` (`package.json:60`), never this repository's own tree, and this change lands its
   first real bundle plus four new modules.
6. **Assumption 1** — the §2.2 preconditions were re-measured at HEAD, not assumed. Record them as verified.

#### A5.9 Additions to §2.6 definition of done

- The drop-site inventory for `LintIssue` / `NgraceIssue` reported per A5.4
- The reachability of each absence code recorded per surface — `lint --format json`, `doctor`,
  `--assertion-mode target` — rather than a single "absences are reported"

### A6 — 2026-07-30 · Route 2's unstated precondition, and evidence that outlives its bundle

The revised `spec.xml` adopts A5.1 route 2 and applies every A5.8 item. Three corrections remain, two of
them created *by* the route change and one of them inherited from an error in A5 itself.

#### A6.1 Correction 12 — the third absence code is not in the catalog, and the prefix guide is a trap

Route 2 derives the class from the catalog, so it depends on the catalog knowing the code. Measured at
`0085f32`: `getLintIssueGuide` (`src/lint/catalog.ts:440-457`) resolves **exact entry → prefix guide →
synthesized fallback**, and `assertion.command-not-evaluated` has **no exact entry**. It falls through to the
`assertion.` prefix guide (`:390`). Three things follow, none of them stated in the spec:

1. **The code must gain an exact catalog entry**, or `AC-ISSUE-CLASS`'s "carries `absence` after
   `withLintIssueGuide`" cannot hold. This is also what lets `AC-CATALOG-JUSTIFY` attach its
   `derivedFrom` / `proposedBy` to it.
2. **The class may be set on exact entries only — never on a prefix guide.** Setting `issueClass:
   "absence"` on the `assertion.` prefix guide classifies *every* `assertion.*` code as an absence:
   `assertion.MustExist`, `assertion.MustVerify`, `assertion.invalid-pattern`, `assertion.budget-no-match`,
   `assertion.change-required`. Those are failures and defects. None of them has an exact entry either, so
   they all resolve through that same prefix — the misclassification would be silent and wholesale. Pin it:
   a test asserting a non-absence `assertion.*` code carries no `absence` class.
3. **The synthesized fallback yields no class**, so an uncatalogued code is a defect by default. That is the
   right default; state it as chosen rather than leaving it to be inferred.

`AC-CATALOG-JUSTIFY` currently carries the hole in its own trailing conditional — "a new absence code cannot
forget to classify itself **if it is catalogued**" — and today the uncatalogued one is exactly the third
absence code. Rewrite it so being catalogued is a requirement, not a hypothesis.

#### A6.2 Correction 13 — evidence pinned to `C-ABSENCE-VALUE` dies when the bundle is archived

`AC-DOCTOR-ABSENCE` specifies a lint-level test run with `--change C-ABSENCE-VALUE`. Archived plans are
**never** evaluated semantically (`src/lint/core.ts:247-250`), so the moment this phase's own bundle moves to
`.ngrace/changes/archive/` as `applied`, that test stops seeing the code and fails. It would go green for the
length of the phase and break on the commit that completes it.

Use a **fixture** bundle. `src/grace-lint.test.ts:399-417` already builds exactly the right one —
`writeApprovedChange(root, "C-COMMAND", …)`, target mode, no `--run-commands` — and asserts the code at
`:414`. Extend that assertion to `issueClass`; the fixture is durable because nothing archives it.

#### A6.3 Correction 14 — the flag is `--assertions`, not `--assertion-mode`

`assertionMode` is the programmatic `LintOptions` key; the CLI flag is `--assertions`
(`src/grace-lint.ts:114-118`). **A5.2 wrote it wrong and the spec inherited it verbatim** — `AC-DOCTOR-ABSENCE`
and `VerificationIntent` both cite a flag that does not exist. This entry supersedes the flag name wherever
A5.2 and A5.9 use it; per this section's append-only rule those entries stay as written. This is A5.5
catching an amendment of its own: a claim in an approved plan is not evidence, including when the plan is
this one.

#### A6.4 Standing rule 4 — evidence must not depend on transient artifact state

**Normative for Phases 2–11.** A test or recorded measurement may not depend on a project artifact whose
lifecycle moves: an active change bundle, a plan at a particular status, a cursor position, a ledger entry, a
file that a later phase archives. Evidence is built on fixtures the phase owns outright.

This track is about to build run ledgers, cursors, attempt logs and gates — all of them transient by design.
A test that reads live project state passes during the phase that wrote it and fails for whoever moves the
state next, which reads as an unrelated regression. When a phase genuinely needs live state, it records the
reading in the report and tests the mechanism against a fixture.

#### A6.5 One tree note, then approval

`V-M-DOCTOR` now points at `src/artifact/scale-ergonomics.test.ts`, and the `Scenario` says the coverage is
incidental until the real file lands. That is honest and acceptable as an interim, but A3.3 requires
`src/grace-doctor.test.ts` **in this phase**, and `VerificationIntent` still names it — so the anchor must be
repointed in the commit that creates the file. Added to §2.6: `V-M-DOCTOR` names the real test file at phase
end, and the interim pointer does not survive the phase.

**With A6.1–A6.3 applied, the spec is approved.** No third stop for review: apply them, set
`status="approved"`, write `plan.xml`, and proceed to §2.5 as corrected by A3–A6.

### A7 — 2026-07-30 · Phase 2 review gate: one undisclosed behaviour change, four small defects

Phase 2's implementation was reviewed against the diff at `READY FOR REVIEW`. §2.7's three gates pass:
no code was renamed or removed; `verdicts.md` restates nothing the binary emits; and the single-source
rule was reproduced **failing** on deliberate duplication during review, not merely asserted. Every
verify-table row reproduces. What follows does not undo any of that.

#### A7.1 Correction 15 — the near-miss marker guard trades three errors for silence, undisclosed

The adversarial probe found that `hasGraceMarkers` over-matched `START_MODULE_CONTRACTX`, and the fix
added `(?![A-Za-z0-9_])` guards plus `START_BLOCK_[A-Z0-9_]+`. Measured on the branch:

| Input | Before | After |
|---|---|---|
| `// START_MODULE_CONTRACTX` | governed → `markup.missing-module-contract`, `markup.module-map-missing`, `markup.module-map-mismatch` | **not governed → no issues** |
| `// START_BLOCK_foo` | governed → the same three | **not governed → no issues** |

`hasGraceMarkers` is the governance gate (`src/lint/core.ts:104`), so a file that fails it is not linted
at all. **The direction is defensible** — §0.7.3 ranks a confident false error above a silent gap, and
`START_BLOCK_[A-Z0-9_]+` now matches the real block grammar at `project-utils.ts:478`. But the ranking
covers the file that never opted in (`// START_MODULE_MAPPER`), not the file that opted in and *typed the
marker wrong*: there the author wanted governance and now gets nothing. One regex cannot tell the two
apart, and the fix answers both the same way.

What is missing is the disclosure. The report says "over-match found and fixed"; that three errors became
silence appears nowhere, and §0.7.4's compat sweep cannot surface it because no fixture carries a
near-miss marker. §0.7.6 requires the probe output **and** the fix.

Required: state the trade in the phase report with the table above. Then either accept it explicitly as a
recorded decision, or raise a warning-level near-miss code (`START_MODULE_CONTRACT[A-Za-z0-9_]+` in a
comment, file not governed) so both cases stay loud — that is a new issue code under §12.1, so it is a
decision to raise, never a unilateral add.

#### A7.2 Standing rule 5 — a change to a detection boundary reports both directions

**Normative for Phases 2–11.** When a phase changes what a detector matches — a regex, a gate, a filter,
a governance predicate — the report gives a table of inputs whose outcome changed, in **both**
directions: what newly fires, and what newly stays quiet. "Fixed an over-match" is half a sentence; the
half that matters is what went silent.

This is the sibling of A5.4. A5.4 catches a value dropped between modules; this catches a *case* dropped
at a boundary. Both are invisible in a green test run, and both read as improvements in a report.

#### A7.3 Four defects to fix before the phase merges

1. **`DefectPatternId` is duplicated with nothing keeping it honest.** A3.2 §4 allowed the duplicate into
   `catalog.ts:10-16` and the phase stated the choice — but nothing pins it against `PATTERNS` in
   `src/test-support/defect-corpus.ts:26`. A sixth D4 pattern, or a rename, diverges silently and
   `proposedBy` types against a stale vocabulary. `catalog.test.ts` is a test file, so it may import
   test-support without touching invariant 7: one assertion that the two sets are equal.
2. **Two assertions are vacuous by construction.** `grace-lint.test.ts` (`if (defect) { … }`) and
   `language-registry.test.ts` (`if (ordinary) { … }`) skip their check when `find` returns `undefined`.
   Assert the discriminating issue exists, then assert its class.
3. **A skipped test reports as a pass.** `grace-doctor.test.ts`'s python-gated case does `if (!hasPython)
   return;`. On a host without `python3` it is green having checked nothing. Use `it.skipIf(...)` so the
   absence is reported as a skip — `verdicts.md`, shipped by this same phase, defines `not-run` as
   "evidence was not produced," and this test converts exactly that into a pass.
4. **Dead defensive default in `formatDoctorText`.** Every row of `report.analysisIssues` comes from
   `toDoctorAbsenceIssues`, so `issue.issueClass ?? "absence"` can never fire; if a non-absence row ever
   leaked in, the `??` would launder it instead of surfacing it. Count by `code` directly.

#### A7.4 Phase 10 inherits the `analysisIssues` naming debt

`doctor`'s JSON key `analysisIssues` and its "Analysis issues" heading now carry absence-class rows, kept
for A2 baseline continuity. That is the right call for Phase 2 and the wrong name to keep forever: it is
accurate only while every reachable absence happens to be an `analysis.*` code. **Phase 10 owns the
rename**, together with whatever baseline note the change needs. Recorded here so it is a named debt with
an owner rather than an open question in a report.

### A8 — 2026-07-30 · A7.1 answered: the near-miss marker gets a warning

**Decided by the maintainer:** Phase 2 closes the silence it introduced rather than recording it. The file
still does not become governed — that part of A7.1's fix stands, and no false errors return — but a comment
that *resembles* a marker is reported instead of ignored. Both the "never opted in" and the "opted in and
typo'd" cases are loud again, which is what invariant 3 asks for.

Scope, so this does not sprawl at a review gate:

- **One code, warning severity.** A warning cannot turn a previously-green project red (§0.7.4 makes that
  test about *errors*), so the blast radius is bounded.
- **Registered per §12.1** with `derivedFrom` and `proposedBy` — it is an exact catalog entry like the three
  absence codes, and `proposedBy` is a `DefectPatternId`. It is a **defect**, not an absence: do not give it
  `issueClass: "absence"`. The file's markup is malformed, not missing.
- **Detection is the near-miss, not the near-match.** A comment line whose marker token starts with a known
  marker name and continues with `[A-Za-z0-9_]` — the inputs A7.1 tabulated. `START_BLOCK_` with a
  lowercase name belongs here too, since `project-utils.ts:478` will never parse it.
- **§0.7.4's sweep runs for it**, and the phase report's "New issue codes: none" line becomes one warning
  with the per-fixture table.
- **A7.2 applies to the code itself:** report what newly fires *and* what stays quiet, including the fact
  that a near-miss file is still not governed.

The rest of A7 is unchanged: A7.1's disclosure table is still required — it is what makes this decision
legible to the next reader — and A7.3's four fixes still land before merge.

### A9 — 2026-07-30 · §0.7.4's sweep gains this repository's own tree

**Add `bun run ngrace lint --path .` to §0.7.4's fixture list**, expecting `[]` like the rest.

A8's near-miss code passed the sweep against `polyglotFixture()`, `minimalTsFixture()`, `scaleFixture(20)`
and `examples/` — then warned on its own JSDoc at `src/project-utils.ts:202`. Every fixture is *built to
exercise* markers; only the dogfood tree contains prose that *discusses* them, which is the input class
§0.7.3 names and the synthetic fixtures structurally cannot contain. A check that reads comments must be
swept against a tree with real comments in it.

Not added to the `# PHASE 2` banner: this binds every phase, not that one.

### A10 — 2026-07-30 · Phase 3 re-derived against HEAD

**Everything below was measured at `7388d5e`** (Phase 2 merged, tree clean), per A5.5: this entry is a
set of claims tied to a commit, and the executor re-measures the ones it depends on rather than
transcribing them.

§3.1, §3.4's design, §3.6's definition of done and §3.7's four gates survive the re-derivation
unchanged. §3.2's preconditions hold. **§3.5's step list does not survive intact**: eight corrections
follow, one of which (16) invalidates a step's central premise and one of which (17) makes a verify
check vacuous — it passes today, before any code is written.

#### A10.1 §3.2's preconditions, re-measured

Both hold:

| Precondition | Measured | Result |
|---|---|---|
| Evidence bundle Phase 1 `COMPLETE` | `docs/plans/archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md` frontmatter `status: complete`; `.ngrace/` tree present at repository root | ✅ |
| `NGRACE_CHANGE_COMPANION_TAGS` mechanism live | `src/artifact/types.ts:28`; consumed at `src/artifact/grammar.ts:11,26` | ✅ |

One line of drift, recorded so §3.4's cross-reference stays usable: `validateChangeDesignContextArtifact`
is at `src/artifact/grammar.ts:575`, not `:574`.

#### A10.2 Correction 16 — companion-tag registration does not admit the *file*, and the plan assumes it does

§3.4 says the two new roots "register as **change companion tags**, exactly as `design-context.xml`
does." That is true of the **root tag** and false of the **file**, and the file is the half Phase 3 needs.

Measured at `7388d5e`, `design-context.xml` is admitted by **three separate hardcoded mentions of its
filename**, none of which consults `NGRACE_CHANGE_COMPANION_TAGS`:

| Site | What it does |
|---|---|
| `grammar.ts:751` | `const designFile = path.join(entryPath, "design-context.xml")` — the file is found by literal name |
| `grammar.ts:798-806` | `if (existsSync(designFile))` — validation runs only for that name |
| `grammar.ts:809` | `!["spec.xml", "plan.xml", "design-context.xml"].includes(fileEntry.name)` — a literal allowlist; everything else in the bundle is `change.unexpected-file`, **error** |

`NGRACE_CHANGE_COMPANION_TAGS` is read at `grammar.ts:26` into `COMPANION_ROOT_TAGS`, whose only use is
the root-tag check inside `validateChangeDesignContextArtifact` (`:585`). Adding two entries to that
constant therefore changes **nothing** about whether `run-ledger.xml` and `run.xml` are accepted.

Reproduced, not inferred — a bundle carrying both a `run-ledger.xml` and a `run/` directory, linted
through the real CLI:

```
- [error] change.unexpected-file …/C-RUN-LEDGER-PROBE/run-ledger.xml
          — Unsupported XML artifact 'run-ledger.xml' in change bundle C-RUN-LEDGER-PROBE.
```

**Consequence:** Step 3.5.1 as written produces a bundle that fails lint with an error. `grammar.ts`'s
filename allowlist is load-bearing for this phase and §3.3 must say so — it currently lists `grammar.ts`
only for the two new validators.

**Recommended shape, to avoid a fourth literal:** derive the bundle's known filenames from one exported
constant beside `NGRACE_CHANGE_COMPANION_TAGS` — filename → validator — and have `:751`, `:798` and
`:809` all read it. That keeps invariant 4 honest (grammar arrives with the validator that makes it
load-bearing) and means a fifth companion cannot be half-registered the way this correction describes.
It is a small refactor of an existing literal, not a new abstraction, so it stays inside working
principle 2 — but it touches a line the phase would otherwise not touch, so it is a decision to
ratify, not to improvise (§12.5).

#### A10.3 Correction 17 — step 3.5.1's verify check cannot fail

Step 3.5.1 reads: *"a fixture bundle carrying an empty `run-ledger.xml` lints without
`change.invalid-root-tag`."*

`change.invalid-root-tag` is emitted at `grammar.ts:499`, inside `validateChangeArtifact`, which runs
only against `spec.xml` and `plan.xml` (`:753`, `:764`). **No input to `run-ledger.xml` can produce it.**
The check passes at `7388d5e` with no Phase 3 code written at all — while the real behaviour, the
`change.unexpected-file` error above, goes unobserved.

This is A5.3's shape at the verify layer rather than the data layer: a check that reports a confident,
smaller truth. Replace it with the assertion that actually discriminates:

> → verify: a fixture bundle carrying an empty `run-ledger.xml` and a `run/` directory lints with **no
> `change.unexpected-file`** for either path, and the near-neighbour case — an unregistered
> `notes.xml` in the same bundle — still errors. Show both.

The second clause is the one that must not be dropped: widening an allowlist is a detection-boundary
change, and A7.2 requires the silent direction be reported alongside the new-pass direction.

#### A10.4 Correction 18 — `run/` is invisible to lint, and the plan never decides whether it should be

The sweep at `grammar.ts:808` iterates `readdirSync(entryPath, { withFileTypes: true })` and filters
`fileEntry.isFile()`. A `run/` **subdirectory** is therefore skipped entirely: in the probe above, the
event file `run/1-T-001-start.xml` produced **no issue of any kind** — no error, and no validation.

So loose event files are unreachable from `validateNgraceProject` today, and §3.5 contains no step that
changes this. That is a defensible design (D2's events are validated at fold time, by the fold, against
range membership and density) but it is currently an accident of a `isFile()` filter rather than a
decision, and it means **a malformed event file is silent until someone folds**.

Decide explicitly and record it in the phase report:

- **(a) Lint stays out of `run/`.** Validation of events is the fold's job (D3 step 2). Then say so in
  §3.4, and add one test pinning that a garbage file under `run/` produces no lint issue — otherwise the
  next reader "fixes" the gap.
- **(b) Lint validates `run/*` shallowly** — root tag and ID-inside-an-allocation only. Costs a
  directory walk on every lint of every bundle.

**Recommendation: (a).** It matches D3, keeps lint cheap, and the fold already owns the invariants. But
(a) is only safe *with* its pinning test, because "no issue" is indistinguishable from "not implemented"
— which is the exact confusion D5 exists to remove.

#### A10.5 Correction 19 — Phase 3 names no issue codes, and §12.1's namespace guidance does not match HEAD

Step 3.5.2 requires "one unit test per rejection, each asserting the specific code — six tests minimum"
and then names **zero codes**. Step 3.5.3's table says "Error" without a code. §3.6 repeats the count.

§12.1 says codes are "namespaced by surface: `artifact.*` and `projection.*` for lint". Measured against
`src/lint/catalog.ts` at `7388d5e`, lint's actual namespaces are `config.*`, `project.*`, `markup.*`,
`analysis.*`, `assertion.*`, `graph.*`, `change.*`, `design-context.*`, `artifact.*` and `path.*`. The
governing precedent is not §12.1's list — it is `design-context.*`: **a change-bundle companion artifact
gets its own namespace**, registered as exact catalog entries.

Following that precedent, and requiring registration per §12.1 with `derivedFrom` and `proposedBy`
(`catalog.ts:22-26`):

| Code | Severity | Fires when | `proposedBy` |
|---|---|---|---|
| `ledger.invalid-root-tag` | error | root is not `NgraceRunLedger` | `unthreaded-construct` |
| `ledger.non-monotonic-epoch` | error | epoch numbers not strictly increasing | `zero-or-more-swallow` |
| `ledger.reordered-epoch` | error | an epoch renumbered or moved vs. its predecessor | `zero-or-more-swallow` |
| `ledger.event-outside-allocation` | error | an event ID in no `RangeAllocation` — D2's rogue writer | `zero-or-more-swallow` |
| `ledger.range-hole` | error | a used range not dense from its start | `zero-or-more-swallow` |
| `ledger.range-unterminated` | error | a used range with no terminal event | `confidently-wrong` |
| `cursor.invalid-root-tag` | error | root is not `NgraceRunCursor` | `unthreaded-construct` |
| `cursor.unknown-task` | error | cursor names a task absent from `plan.xml` — D1 | `unthreaded-construct` |

Eight codes, which satisfies "six minimum" for the ledger with the two cursor codes beside it. These are
**defects, not absences** — a malformed ledger is malformed, not missing; do not set `issueClass:
"absence"` (A8's distinction, applied again). An *absent* ledger or cursor emits nothing at all (D1,
invariant 5).

The names above are a proposal, not a ratification. §12.5 forbids the executor inventing them mid-phase,
so they are settled here or in the `spec.xml` review — not in the diff.

#### A10.6 Correction 20 — §3.3's file table omits every surface a new subcommand touches

`src/grace.ts:20-28` registers seven subcommands. Phase 3 makes it eight. Each of the following names
that set and is absent from §3.3:

| File | Why it is pulled in |
|---|---|
| `README.md:170-186` | The CLI command table and the per-command output-format list |
| `skills/ngrace/ngrace-cli/SKILL.md:16` | Enumerates the CLI surfaces an agent may call |
| `plugins/ngrace/skills/ngrace/ngrace-cli/SKILL.md` | Byte-identical mirror — invariant 1, §12.2 |
| `skills/ngrace/ngrace-execute/SKILL.md` + mirror | D1: *"It ships, and `grace-execute` maintains it by default."* A `cursor` subcommand no skill invokes is a mechanism with no caller |

The `ngrace-execute` row is the substantive one. Without it Phase 3 delivers a write surface that
nothing in the methodology drives, and D1's "optional to build: **No**" is unmet. Keep the skill edit to
one or two sentences — §12.4 anti-pattern 10 forbids skill text restating a vocabulary the binary emits,
so the skill says *when* to advance and fold, never *what the codes are*.

Per A5.6, `AffectedAreas` in the `spec.xml` is derived from this traced set, never from §3.3.

#### A10.7 Correction 21 — step 3.5.4's model reference points at a private helper

Step 3.5.4 says to model the directory-snapshot test on `src/artifact/scale-ergonomics.test.ts:212`.
Measured: the `describe` is at `:212`, the `it` at `:213`, and the snapshot helper it calls,
`snapshotTree`, is a **file-local function at `:66`** — not exported.

Meanwhile `src/test-support/fixtures.ts:194` exports `snapshotProjectTree(root)`, which is the shared
helper and the one invariant 7 wants used. The reference stands as a *model*; the dependency is
`snapshotProjectTree`. Do not copy the private helper into a third location.

Related, and worth stating because §3.3 names only one of them: there are **two** fixture modules that
build change bundles — `src/test-support/fixtures.ts:391` and `src/artifact/test-fixtures.ts:26,101`
(`writeMinimalNgraceProject`, used by the grammar and ergonomics suites). Step 3.5.1's "fixture bundle"
must name which, and if ledger builders are needed by both, invariant 7 says the shared home is
`src/test-support/`.

#### A10.8 Correction 22 — step 3.5.7 overstates the work, and hides the decision inside it

Step 3.5.7: *"`ngrace status --path .` prints the change, epoch, task counts and next skill."* Measured
at `7388d5e`, two of those four already ship:

- **the change** — `formatStatusText:333` already prints `changeId`, location, spec/plan status and
  derived states, from `ChangeBundleStatus` (`grace-status.ts:22-29`)
- **the next skill** — `chooseNextAction` (`:171-184`) already returns `$ngrace-execute` and friends,
  printed at `:364` under "Suggested Next Action"

The new content is **epoch and task counts**. Phase 2's §2.1 made the same kind of note honestly
("three of the seven absence values already ship"); this step should too, so the phase is not credited
with work that shipped in an earlier release.

The decision the step conceals: **must `chooseNextAction` consult the cursor?** It must not. §12.4
anti-pattern 7 — *making the cursor authoritative* — is exactly this, and D1 makes the cursor a
regenerable cache. `nextAction` stays derived from spec/plan status and integrity. The cursor is
*displayed*, never *consulted*. State this in the report and add a test: a project whose cursor names a
different position than the plan state implies still gets the plan-derived `nextAction`.

**A5.4 applies here, and this is its most likely victim in Phase 3.** `ChangeBundleStatus` is a record
crossing a module boundary, and `formatStatusText:333` is a textbook drop site — an object literal that
re-lists five fields by name. Add `epoch` to the type, forget `:333`, and JSON carries it while text
silently does not: corrections 2, 9 and 10 for a fourth time. The drop-site inventory for
`ChangeBundleStatus` and `StatusResult` is required in the phase report.

#### A10.9 Correction 23 — step 3.5.8's baseline reproduces exactly, and this is its pre-state

Recorded now so the executor compares against a measurement rather than re-deriving expectations after
writing the code. At `7388d5e`, `grep -rn 'writeFileSync\|mkdirSync' src --include='*.ts' | grep -v test`
returns exactly:

```
src/grace-graph.ts:3:import { existsSync, mkdirSync, writeFileSync } from "node:fs";
src/grace-graph.ts:289:  mkdirSync(path.dirname(newAbsolute), { recursive: true });
src/grace-graph.ts:291:    writeFileSync(write.file, write.contents);
src/lint/adapters/dart.ts:2:import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
src/lint/adapters/dart.ts:178:  writeFileSync(analyzerFile, DART_ANALYZER_SCRIPT, "utf8");
```

Step 3.5.8's expected post-state is this set **plus `src/grace-cursor.ts` and nothing else**. Note the
dart adapter's two lines are its `mkdtempSync` temp-dir use, which §3.5.8 already anticipates.

Invariant 8 binds the new module: the cursor writes only structural state, and `fold` — which deletes
files — is the phase's one destructive operation. It needs an explicit trigger, not an implicit one.

#### A10.10 The step list's floor — three things D1–D3 require that §3.5 does not cover

Per A3.1, §3.5 is a floor. Three obligations fall inside Phase 3's objective and have no step:

1. **D3's archive precondition.** *"The archive precondition becomes 'no open epoch'"* (`decisions.md`
   §D3). Nothing in §3.5 implements or tests it, and `grammar.ts:786-796` — where archive-bundle rules
   already live — is where it belongs. A bundle archiving with work in flight loses the open epoch.
2. **Invariant 5, demonstrated rather than asserted.** §3.6 says nothing about it. The additive claim is
   testable in one line: every existing fixture plus `bun run ngrace lint --path .` yields zero new
   codes (A9 folds the dogfood tree into that sweep, and A9's own finding is why it matters).
3. **The `run.xml` → `plan.xml` reference direction.** Step 3.5.3 covers *cursor names an unknown task*.
   The reverse — a cursor whose named change bundle does not exist, or names a different bundle than
   its own directory — has a direct precedent in `design-context.bundle-id-mismatch` (`grammar.ts:803`)
   and no step. Add `cursor.bundle-id-mismatch` to A10.5's table or state why the case cannot arise.

#### A10.11 Standing rules that bind this phase, named so they are not rediscovered at the gate

- **A5.4** — drop-site inventory required for `ChangeBundleStatus` / `StatusResult` (A10.8), and for
  any field added to `LintIssue`. Note that `addNgraceIssue` (`lint/core.ts:54-62`) still re-lists five
  fields: anything the ledger validators attach beyond `severity/code/file/line/message` is dropped on
  the way into `LintResult`. Phase 2 chose route 2 (catalog-derived) to sidestep this; Phase 3 must not
  reintroduce it.
- **A5.5** — every claim in this entry is measured at `7388d5e`. Re-measure what you depend on.
- **A5.6** — acceptance criteria descending from these corrections cite them inline, e.g.
  `AC-BUNDLE-FILE-ALLOWLIST (A10.2)`, and carry the discriminating detail.
- **A7.2** — `grammar.ts:809` is a detection boundary. Widening it requires the both-directions table:
  what newly passes (`run-ledger.xml`, `run.xml`) **and** what still errors (`notes.xml`, a stray
  `spec.old.xml`, a `.xml` file directly under `changes/active/` — `grammar.ts:737-739`).
- **§0.2** — no test may order ledger events by clock. This is also §3.7 gate 3 and §12.4 anti-pattern 6;
  it is stated three times because it is the one the house's instincts will reintroduce.

#### A10.12 Decisions required before `spec.xml` is drafted

Four, none of which the executor may take alone (§12.5):

1. **A10.2** — refactor `grammar.ts`'s filename allowlist to one derived constant, or add two more
   literals? *(recommend: derive)*
2. **A10.4** — does lint walk `run/`? *(recommend: no, with a pinning test)*
3. **A10.5** — ratify the eight code names and the `ledger.*` / `cursor.*` namespaces.
4. **A10.10 §3** — `cursor.bundle-id-mismatch`: in or out?

#### A10.13 Additions to §3.6 definition of done

- The `grammar.ts:809` both-directions table per A7.2, including the still-erroring near neighbours
- The drop-site inventory for `ChangeBundleStatus` / `StatusResult` per A5.4
- Whichever A10.4 route was taken, named, with its pinning test
- `nextAction` proven independent of the cursor (A10.8)
- The archive-precondition decision from A10.10 §1, implemented or explicitly deferred with a reason
- Invariant 5 demonstrated across all five sweep targets, not asserted

### A11 — 2026-07-30 · A10's four decisions answered, and the cursor's recovery contract

**Decided by the maintainer.** A10.12's four questions are closed, and answering the fourth opened a
fifth that is closed here too. This entry is normative for Phase 3 and supersedes §3.4 and §3.5
wherever they disagree.

#### A11.1 Decision 1 — derive the bundle's filename allowlist (A10.2)

`grammar.ts`'s three literal mentions of `"design-context.xml"` (`:751`, `:798`, `:809`) collapse into
one exported constant beside `NGRACE_CHANGE_COMPANION_TAGS`, mapping bundle filename → root tag →
validator. All three sites read it.

This is the correction's own argument applied: a companion registered in the tag list but absent from
the filename allowlist is *half-registered*, and nothing today detects that state. After this change a
companion is one entry or it does not exist. Invariant 4 — grammar arrives with the validator that
makes it load-bearing — becomes structurally true rather than a convention.

It touches a line Phase 3 would not otherwise touch. That is ratified here, not improvised (§12.5).

#### A11.2 Decision 2 — lint does not walk `run/` (A10.4 route a)

Event validation is the fold's job (D3 step 2: range membership and density). Lint stays out.

**The pinning test is not optional.** A garbage file under `run/` must be shown to produce no lint
issue, in a test that says so. Without it, "no issue" is indistinguishable from "not implemented" —
which is the confusion D5 exists to remove, and the next reader will "fix" the gap.

#### A11.3 Decision 3 — twelve issue codes, `ledger.*` and `cursor.*` (A10.5, extended by A11.4)

Ratified. The namespaces follow `design-context.*`: a change-bundle companion artifact owns its own
namespace. All twelve are **defects**, never `issueClass: "absence"` — a malformed ledger is malformed,
not missing (A8's distinction). An *absent* ledger or cursor emits nothing (D1, invariant 5).

| Code | Fires when |
|---|---|
| `ledger.invalid-root-tag` | root is not `NgraceRunLedger` |
| `ledger.invalid-change-id` | identity is not exactly one canonical `C-*` |
| `ledger.bundle-id-mismatch` | identity disagrees with the bundle directory |
| `ledger.non-monotonic-epoch` | epoch numbers not strictly increasing |
| `ledger.reordered-epoch` | an epoch renumbered or moved relative to its predecessor |
| `ledger.event-outside-allocation` | an event ID in no `RangeAllocation` — D2's rogue writer |
| `ledger.range-hole` | a used range not dense from its start |
| `ledger.range-unterminated` | a used range with no terminal event |
| `cursor.invalid-root-tag` | root is not `NgraceRunCursor` |
| `cursor.invalid-change-id` | identity is not exactly one canonical `C-*` |
| `cursor.bundle-id-mismatch` | identity disagrees with the bundle directory |
| `cursor.unknown-task` | cursor names a task absent from `plan.xml` |

Each registers per §12.1 with `derivedFrom` and `proposedBy` (`catalog.ts:22-26`).

**Why the identity trio collapses to one code per artifact.** `design-context` splits missing /
ambiguous / invalid into three (`grammar.ts:616-620`) because it is hand-authored and the diagnostics
guide the author. Ledger and cursor are machine-written by `grace-cursor.ts`; the granular distinction
buys nothing and costs four codes.

#### A11.4 Decision 4 — identity is required on both artifacts, and `cursor.unknown-task` does not cover it

**Identity is required, not optional.** Both `run-ledger.xml` and `run.xml` declare their bundle and
are cross-checked against the directory they sit in.

The check `cursor.unknown-task` was expected to subsume this and does not. `ANCHOR_PATTERNS.task` is
`/^T-[0-9]{3}$/` (`types.ts:98`), so every plan starts at T-001. Measured at `7388d5e`:
`.ngrace/changes/archive/C-ABSENCE-VALUE/plan.xml` carries T-001…T-005 and the `examples/` bundle
carries T-001…T-002. **Task IDs collide across bundles by construction.** Copy a bundle directory to
template a new change — a normal thing to do — and the stale `run.xml` pointing at T-002 validates
clean against the new plan while reporting a position that was never true.

A ledger under the wrong bundle is worse still: it attributes one change's approvals, overrides and
degradations — D1's non-recoverable column — to another change. It is the single worst corruption this
phase can produce.

This also restores the house convention. Spec and plan cross-check via `change.bundle-id-mismatch`
(`grammar.ts:757`, `:768`), design-context via `design-context.bundle-id-mismatch` (`:803`), all
errors. Ledger and cursor would have been the first bundle artifacts to opt out.

#### A11.5 Decision 5 — lint reports, the mechanism recovers

Required identity and dynamic recovery are not in tension; they live on different surfaces.

| Surface | Behaviour on a missing, identity-less, or mismatched cursor |
|---|---|
| `ngrace lint` | **Error**, per the codes in A11.3 — the written file is wrong |
| `ngrace cursor show` | **Never blocks.** Distrusts the cursor, re-derives position, and announces the degradation |

This is §12.4 anti-pattern 9 — *"Blocking policy inside a mechanism. Gates declare what they require;
mechanisms report."* It also means an untrustworthy cursor and an absent cursor take the **same** code
path, which is the property that makes it testable.

The degradation is announced, never silent (invariant 3). It reports through Phase 2's absence
vocabulary in `skills/ngrace/ngrace-cli/references/verdicts.md` — Phase 3 does not invent a second one
(anti-pattern 5, and D13's one-fragment rule).

##### Regeneration reads three sources, in order of authority

| # | Source | Covers | Authority |
|---|---|---|---|
| 1 | `run-ledger.xml` | every closed epoch | **the truth** (D1) |
| 2 | `run/*` loose events | the open epoch, unfolded | authoritative, unfolded |
| 3 | Codebase evidence — `ObservedWriteScope` diff (`scope.ts:19`, `:91`, `:405`), anchors present, `--assertion-mode target` | work done but never recorded | **inference** |

**Row 3 output is labelled inferred and never merged flat into rows 1–2.** Regenerating from code alone
would silently manufacture D1's non-recoverable column: a cursor that looks complete having lost every
approval record. That is §15's failure with a fresh coat of paint.

**All three rows land in Phase 3.** Row 3 is not an edge case — it is the *adoption* case. Where the
ledger is intact, rows 1–2 make regeneration trivial; the case that actually hurts is work done with no
events recorded at all, which is the normal early state of any project adopting this. A regeneration
that handles the easy case and reports absence on the common one is a mechanism that fails where it is
needed. Both objections to building it now are already dissolved: the scope-diffing pieces exist, and
Phase 2 shipped the vocabulary for labelling inference.

Nothing downstream forced this. Phases 4, 5 and 9 each name the **ledger** in their preconditions, not
the cursor, and Phase 10 depends on Phase 6. Row 3 is in Phase 3 because it belongs to the capability,
not because a later phase blocks on it — and because a deferral with no phase number and no owner is
how a real gap becomes permanent debt (contrast A5.7 and A7.4, which both name an owner).

##### `regenerate` writes, so it takes `--apply`

Invariant 8 / F1. `ngrace graph split` is the complete template: dirty-worktree guard
(`grace-graph.ts:110`), `dryRun: !options.apply` (`:165`), early return (`:169`), and the
*"dry-run; pass --apply to write"* line (`:297`). Bare `regenerate` prints the position it would write
and stays read-only, preserving §3.4's rule that only `advance`, `pause`, `resume` and `fold` write.

Subcommands become six: `show`, `regenerate`, `advance`, `pause`, `resume`, `fold`.

#### A11.6 Three tiers of desync, each with an existing owner

`doctor` **diagnoses and never repairs.** It is pinned strictly read-only by a directory-snapshot test
(`src/artifact/scale-ergonomics.test.ts:213`, *"is strictly read-only (directory snapshot unchanged)"*),
and repairing would break both that test and invariant 8.

| Condition | Surface | Action |
|---|---|---|
| Cursor missing, identity-less, or mismatched | `cursor show` | Re-derive, announce the degradation; lint errors on the file |
| Cursor recoverable but stale | `cursor regenerate --apply` | Rewrite from rows 1–3 |
| Code diverged from the artifacts themselves | `status` → `$ngrace-refresh` | **Replan through a new spec** |

The third tier already ships and is not Phase 3's to rebuild: `collectObservedDrift` →
`unexplained-observed-drift` → the `nextAction` at `grace-status.ts:177`, *"Use $ngrace-refresh to
reconcile unexplained repository changes through a new NgraceChangeSpec and NgraceChangePlan."*
Regenerating a cursor against a plan the code no longer matches would produce a confident position over
stale tasks.

`doctor`'s contribution is **one report line** — cursor present / absent / stale / unrecoverable — and
it belongs to Phase 10 ("doctor consumers"; A2 already baselines doctor). Do not add doctor flags in
Phase 3; that is the scope growth A5.2 §2 refused.

#### A11.7 Consequences for §3.3 — the graph does not cover this phase's files

Measured at `7388d5e`, `.ngrace/graph/main.xml` declares nine modules, eight carrying a `Path`:
`src/lint/{core,types,catalog}.ts`, `src/artifact/{assertions,grammar}.ts`, `src/project-utils.ts`,
`src/grace-status.ts`, `src/grace-doctor.ts`.

**`src/artifact/types.ts` and `src/grace.ts` are in no module, and `src/grace-cursor.ts` will not be.**
This is A5.7's recorded finding arriving in practice: a plan may write a file whose owning module
appears in neither `DurableScope` nor `AffectedAreas`, and lint stays quiet.

Phase 3 adds, with matching `V-M-*` entries:

- **`M-CURSOR`** → `src/grace-cursor.ts`. Required, not optional: it is a new module and the phase's
  sole write surface, which is exactly what invariant 8 governs.
- **`M-ARTIFACT-TYPES`** → `src/artifact/types.ts`. Phases 4 and 9 both edit it per their file tables;
  it has earned a module.
- **`M-CLI`** → `src/grace.ts`. Phase 5 also edits it.

Together with A10.6's documentation surface (README, `ngrace-cli`, `ngrace-execute`, and the two
mirrors), this is the set §3.3 omits. `AffectedAreas` derives from here, not from §3.3 (A5.6).

**And nothing will catch it if the executor forgets.** `AffectedAreas` anchors are compared only
against the *plan's* `DurableScope` — `validateSpecPlanCoverage` (`grammar.ts:1140`, `:1163`), yielding
`change.scope-does-not-cover-spec` and `change.plan-scope-exceeds-spec`. **Nothing cross-checks them
against the graph.** Verified: the `C-RUN-LEDGER` draft spec names `M-CURSOR`, `M-ARTIFACT-TYPES` and
`M-CLI`, none of which exist, and `ngrace lint --path .` reports zero errors.

This is A5.7's family one direction over — that finding covers file→module, this covers
anchor→existence — and it is why `AC-GRAPH-COVERAGE` has to be an acceptance criterion checked by a
human rather than a lint code the executor can lean on. Recorded, not scheduled: do not build the
check in Phase 3.

#### A11.8 Two commits, one review gate

Phase 3 is the largest phase in the track and §12.3 already permits the shape: *"One phase, one or more
commits, never a commit spanning two phases."*

1. Grammar, filename allowlist, both validators, the twelve codes, `fold`, and the graph modules
2. `regenerate`, the three-source re-derivation, `status` surfacing, and the skill and README edits

One `READY FOR REVIEW`, one §0.5 report, one §0.7 self-review covering both. This keeps each diff
reviewable without inventing a phase boundary the sequencing rules do not support.

---

## 15. Final instruction to the executor

Work one phase at a time. Report in the §0.5 format. Stop after each phase and wait for review.

The failure this plan exists to prevent is not a bug — it is a **confident report about work that
was not checked**. Every mechanism here is downstream of that. If you find yourself about to
write "verified" next to something you inferred, that is the moment the whole track is about.

Write the absence value instead. It is always available, and it is never wrong.
