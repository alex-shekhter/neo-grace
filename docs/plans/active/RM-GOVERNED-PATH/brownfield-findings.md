# Brownfield adoption transcripts — measurement for P3 step detail

Measured 2026-08-14 against two independent runs of the same prompt in
`/Users/sas/Projects/spaghetti-mapper-private`. This document is the missing
subject of F86: a brownfield transcript that can be counted. It is evidence,
not a plan. Do not average the two runs.

A fourth run, on a **corrected** prompt (`qwen3.8-28B`, branch
`neo-grace-6.2.0-brownfield-qwen3.8-28B`), is measured in
[brownfield-run4-findings.md](./brownfield-run4-findings.md). Do not fold
that measurement into these two counts. That transcript post-dates F88,
F88.1, F89 and D18.

Analysis used `git show` / `git log` / `git diff` against the branch refs, plus
a detached worktree (created and removed) to run `ngrace lint` on ornith HEAD
and earlier commits. Muse artifacts that were never committed were read from
the working tree of that branch, which is where the run left them. Both runs
used `~/bin/ngrace` (`/Users/sas/bin/ngrace`), a wrapper around this
repository's `src/grace.ts`, reporting `6.2.0`. That binary includes P1's
`spec` / `plan` / `scaffold`. The published `@neograce/cli@6.2.0` on `PATH`
does not; it is not what either model invoked.

---

## Runs

| | ornith | muse |
|---|---|---|
| Branch | `neo-grace-6.2.0-brownfield-ornith_35` | `neo-grace-6.2.0-brownfield-muse-glimmer_30b-mlx` |
| Model (from branch name only) | ornith 35 | muse-glimmer 30b-mlx |
| Starting SHA | `0d92d15e97f009c324e83eda80d49c246dc30b26` (`main`) | same |
| HEAD | `7b7f2bf` | `aaaf501` |
| GRACE commits after start | 5 | 1 |
| Reached a closed bundle? | **No.** `C-AUDIT-001` is still under `active/`. Spec `status="approved"`. Plan has no status (status surface reports `plan=missing`). Ledger last event is `archive=permit`. Code for the change was written. | **No.** `C-001` exists only in the working tree, spec still `draft`, no plan, no archive, no product-code change beyond a `MODULE_CONTRACT` comment. |
| What "closed" would have required | `status="applied"` on spec and plan, and the bundle under `archive/`. None of those three writes exist. | Never reached `gate apply`. |

Both forks are Go + TypeScript, adapter-backed. This measurement does **not**
exercise the tier-1 (no-adapter) path.

---

## Counts, side by side

Do not average these. The gap is the finding.

### As each transcript counted itself

| | ornith | muse |
|---|---|---|
| Total actions | **30 (estimated)** — the file says so twice | **30** (numbered 1–30) |
| CLI | **20** (estimated) | **17** |
| FOLKLORE | **6** (estimated) | **7** |
| INFERRED | **4** (estimated) | **4** ("decisions", not labels) |
| BLOCKED | **1** | **3** |
| Bundles to adopt | **1 attempted, 0 completed** | **unknown** (their word); 1 skeleton opened, 0 completed |
| Manual post-`gate apply` steps | **N/A** — apply refused both times | **N/A** — never invoked apply |

Ornith's own counts are estimates over a transcript that was appended, not
recounted. Muse's own counts do not match muse's own labels (see recount).

### Recount from labeled lines in each TRANSCRIPT.md

Ornith labels every line `N.` — there is no sequence number. Labeled rows at
HEAD (`7b7f2bf`):

| Label | n | What they are |
|---|---|---|
| `[CLI]` | **11** | 3 repo-survey commands, `ngrace --version`, `lint`, `status`, `spec new`, `plan new`, `gate approve`, `gate apply` #1, `gate archive` |
| `[FOLKLORE]` | **3** | init placeholders, `mkdir`, "removed XML declaration" |
| `[INFERRED]` | **1** | MODULE_CONTRACT markers on `merge.go` (not in any commit) |
| `[BLOCKED]` | **0** labeled | the count-section claims 1 |

Unlabeled but described in prose, and visible in commits: filling the spec,
many plan-fill iterations, hand-setting spec `status="approved"`, the product
code change (`f8a2ced`), the second `gate apply`, committing
`plan.xml.tmp_bak`, rewriting the plan into a stub (`f4c49eb`).

Muse numbered 1–30. Labels on the page:

| Label | n | Notes |
|---|---|---|
| `[CLI]` | **14** | they reported 17 |
| `[FOLKLORE]` | **11** exclusive + 1 mixed | they reported 7 |
| `[INFERRED]` | **1** exclusive (`#8`) + `#28` mixed | they reported 4 *decisions* |
| `[BLOCKED]` | **3** (`#6`, `#21`, `#29`) | matches their count |

### Recount if `CLI` means an `ngrace` command (the prompt's definition)

Both models labeled `git`, `ls`, `find`, `go build`, and hand-edits as `CLI`.
Under the prompt's definition:

| | ornith | muse |
|---|---|---|
| ngrace invocations on the page | **8** (`--version`, `lint`, `status`, `spec new`, `plan new`, `approve`, `apply`, `archive`) | **8** (`--version`, `lint` ×4, `spec new`, `plan new`, `gate approve`) |
| Hand edits labeled CLI | none (they used FOLKLORE for the xml-decl claim) | **#22 and #23** — "edit verification xml", "edit main.go LINKS" |

### Why the two count systems disagree

Ornith stopped numbering, estimated at the end, and left whole classes of work
(spec fill, plan fill, the code change, the status flip) outside the label
scheme. Muse numbered every line but then reported a different CLI/FOLKLORE
split than the labels, and counted INFERRED as narrative decisions rather than
rows. The gap between "ornith ~30 estimated, messy" and "muse 30 numbered,
clean" is a **reporting** gap, not a work-volume gap. Muse's transcript is
the one the prompt said to treat as suspicious if it looked tidy.

---

## Where both runs hit the same wall

These are the strongest shared facts. Each is independently visible in both
transcripts **and** in the trees.

### 1. There is no `ngrace init`. Init is folklore.

Both: skill `ngrace-init` step 3 is `mkdir` plus copy-from-template. Both
recorded that as FOLKLORE. Confirmed against this repository: `src/grace.ts`
registers no `init` command; `ngrace init --help` falls through to the top
help and (on the published binary) prints `Unknown command` for sibling
verbs.

Commit / tree evidence:

- ornith `7d33ddc` adds nine hand-written context/graph/verification files
  and no `AGENTS.md`. Transcript: *"skill templates didn't include
  changes/active and archive so those had to be made myself"* — the
  directories are in the skill; they are not a CLI verb.
- muse WT: same five context files, two graph, two verification, created by
  hand. Action `#9`.

### 2. `AGENTS.md` already exists. The skill says stop. There is no user.

Start tree `0d92d15` has `AGENTS.md` (SpaghettiMapper working agreements) and
**no** `.ngrace/`. Skill step 2: stop and ask keep / merge / overwrite.

- muse `#6 [BLOCKED]` then `#8 [INFERRED]` backup-and-replace. WT has
  `AGENTS.project.md`, `AGENTS.project.md.bak`, and `AGENTS.md` rewritten to
  the neo-grace protocol template. **Repo-specific trigger, product-shaped
  hole.**
- ornith: *"INFERRED: kept the existing AGENTS.md."* Diff `0d92d15..7b7f2bf`
  does not touch `AGENTS.md`. They skipped skill step 4.

Same wall, opposite guesses. That is path-dependence, recorded under
Divergence.

### 3. `ngrace spec new` works. `ngrace plan new` refuses a draft spec. `gate approve` does not flip `status`.

Both found the generators (skills, not `--help` — see Discoverability). Both
hit F4 live:

- muse `#26`: `Error: Spec at ... is not approved. An active plan may exist
  only beside an approved spec.` Then `#27` `gate approve` → `permit`. Spec
  stays `draft`. `#28` hand-sets `approved`, `#29` BLOCKED on self-approval,
  `#30` reverts. WT spec is still `status="draft"` and is **byte-identical**
  to a fresh `ngrace spec new C-001`. Ledger:
  `Decision gate="approve" decision="permit" baseCommit="0d92d15…"`.
- ornith: same generator pair. Spec at `932c452` is already
  `status="approved"` (the flip is not a labeled FOLKLORE line). `plan new`
  then ran. Later `gate approve` also `permit`
  (`baseCommit="f8a2ced"` — after the code commit).

Shared product fact: approve evaluates clarifications and records a Decision.
It does not write `status`. D1 left `draft → approved` authored. Both models
had to guess that. Muse guessed and stopped. Ornith guessed and wrote the
attribute.

### 4. After init, `status` reports unexplained drift for every file just created.

- ornith first transcript: *"`ngrace-status` showed integrity 0-0 but
  derived states `unexplained-observed-drift`, 10 files unexplained
  (expected during init)."*
- muse worst-moment #5, and a live `ngrace status` on the WT: 15 unexplained
  paths, all `.ngrace/**` plus the ledger the approve gate just wrote.

This is RC-6 / P4, not a P3 lifecycle bug. Both discovered it independently.

### 5. Neither run closed a bundle. Apply never permitted.

- ornith ledger, `f4c49eb`:
  `approve=permit`, `apply=refuse` ×2 (`plan-present` present=false
  *"plan.xml missing"* **and** `review-verdict` present=false),
  `archive=permit` (`no-open-epoch`). Bundle still in `active/`.
- muse: apply never called. Status: `C-001 [active] spec=draft plan=missing`.

The three no-verb close steps (spec `applied`, plan `applied`, move to
`archive/`) were **not performed by either run**. They cannot be counted as
"discovered by doing". Ornith discovered the *shape* of the hole: archive
can permit while the bundle stays in `active/` and the ledger ends at that
Decision — which is exactly F86's honesty gap, reproduced by a stranger.

### 6. `gate` prints no `next:`.

`src/gates/command.ts` `formatGateEvaluation` emits Gate / Change / Decision
/ Requirements / Issues. There is no `next:` line. Neither transcript quotes
one. Muse wrote the gap in words: *"Unclear coupling between gate decision
and spec status."*

### 7. MODULE_MAP / file-local markup is a wall, and `scaffold` / `file exports` were not found.

Go is adapter-backed, so this is the supported path, not tier-1.

- muse: added `START_MODULE_CONTRACT` on `main.go` (no `MODULE_MAP`), added
  `M-APP` + `V-M-APP`. Final lint (reproduced): 1 error
  `markup.module-map-missing`, 1 warning `graph.module-without-linked-files`.
  `#21 [BLOCKED]`. `ngrace lint --explain markup.module-map-missing` is
  classified **emittable-uncatalogued** and does not name `ngrace scaffold`
  or `ngrace file exports`.
- ornith: tried markers on `internal/merge/merge.go`, hit LINKS/DEPENDS
  syntax, **removed them**. No `MODULE_CONTRACT` exists on the branch. Graph
  at HEAD: `<Owns/>`, zero modules, `Governed files: 0`.

Same wall. muse pushed through to one remaining error. ornith retreated.
`ngrace scaffold` exists on the eval binary and would have printed a
contract + map; neither invoked it.

---

## Where the runs diverged

For each: who is the outlier, and whether the difference is **capability**
(one worked it out) or **path** (they did different things).

### Init XML: muse filled the templates; ornith invented a different schema

- muse context files match `skills/ngrace/ngrace-init/assets/.ngrace/context/*.template`
  (`Language` / `Runtime` / `Framework` / `TestingStack` / `Principle` /
  `Audience`). Lint after those writes: 0/0. **Capability + obedience.**
- ornith `technology.xml` uses `<ProjectLanguage>`, `<TargetFramework>`,
  `<BuildSystem>`, `<TestStacks>` — none of those tags are in the template.
  `principles.xml` uses `<Items><Item>`; the template uses `<Principle>`.
  `ux-guidelines.xml` uses `<PrimaryUsers>` / `<UserInterfaceRules>`; the
  template uses `<Audience>` / `<Guideline>`. Transcript claims sed-on-
  templates. The committed files contradict that. Lint at `7d33ddc` (init
  only, empty `archive/` created): **0 errors**. Context grammar accepted
  the invented tags. **Capability failure on following the template, hidden
  by a loose checker.** Path: they freehanded.

### AGENTS.md: keep vs replace

Path. Same skill, opposite INFERRED. muse destroyed the project's working
agreements (e2e rules, HUD contract, `.env` credentials). ornith left them.
Repo-specific content, product-shaped decision with no non-interactive verb.

### Whether to put any code under governance

Path, with a capability edge. muse kept `M-APP` and reduced lint to one
error. ornith added markers, removed them, and finished with a graph that
owns nothing. The code change they later made (`MergeAttempt`) is
**ungoverned** in GRACE terms: `Governed files: 0`.

### Spec fill vs spec-left-as-skeleton

Path. Both used `ngrace spec new`.

- muse left the skeleton. File is identical to a fresh generator emit.
  Never tested whether they could fill XML.
- ornith filled it. Result is a recognisable `NgraceChangeSpec` with real
  `AC-*` children, `AffectedAreas` as `<M-AUDIT /><M-API />`, and
  `status="approved"`. Also: `&mdash;` (undefined entity), an `IC-*` child
  sitting under `AcceptanceCriteria`, `NonGoals` as a text blob rather than
  `<NonGoal>` children. ngrace lint does **not** reject the spec for the
  entity. A conformant parser does. See Malformed XML.

### Approval discipline

Path, and it decided how far each run got.

- muse treated `draft → approved` as a human act, tried the hand-edit,
  reverted, stopped. Correct reading of `ngrace-spec` / D1. They never
  produced a plan.
- ornith wrote `status="approved"` (unlabeled) and continued. That is the
  sanctioned authored transition used without a human. It is why they
  reached `plan new` and the gate cycle at all.

### Plan authoring

Capability, and it is the most important divergence.

- muse: never wrote a plan. Floor not tested.
- ornith: used `ngrace plan new` (their description of the emit — seeded
  `MustExist` / `GraphAnchors` / `<None />` / `T-001` + `Satisfies` —
  matches the live generator; a fresh `plan new C-AUDIT-001` against their
  spec is **well-formed and lints 0**). Then they filled it by hand
  (Python / ElementTree / heredoc). Commit `932c452` is not the generator
  output. It is not well-formed XML. Commit `f4c49eb` is well-formed XML
  that is not a valid plan (no `status`, empty `MustExist/Value`,
  `Title value="..."`). They never recovered a lint-clean plan. See
  Malformed XML.

Their claimed argv `ngrace plan new --path .` (no change id) is refused by
the live binary (`Missing required positional argument: CHANGE`). The emit
they describe cannot have come from that argv. They ran it with the id and
misreported the command, or they reconstructed the argv later.

### Execute-then-gate vs stop-before-plan

Path. ornith implemented `MergeAttempt` in `f8a2ced` with no cursor events,
no attempt records, and a plan that does not parse as approved. That is the
freestyle-land dead end P4 names, on a throwaway branch, in one afternoon.
muse never touched product behaviour.

### Gate cycle depth

Path, gated by the approval choice. ornith ran approve / apply / apply /
archive. muse ran approve only.

### What they committed

Path, and it is an honesty fact.

- ornith: five commits, artifacts + code + transcript on the branch.
- muse: one commit, `TRANSCRIPT.md` only. The `.ngrace/` tree, `AGENTS.md`
  rewrite, and `main.go` contract exist only as uncommitted WT state.

### Transcript shape

muse's file is the requested output shape (numbered actions, Counts, five
worst, etc.) with almost no crossings-out. ornith's file is two drafts
glued together (Section 5 says "none yet", then "Section 5 Update" runs the
gates). The prompt forbade tidying. ornith complied. muse's cleanliness is
not evidence of a cleaner run.

---

## Transcript vs commits

### ornith — the transcript is more flattering than the history in four places

1. **Apply #2 cause.** Transcript: after removing an `<?xml` declaration,
   apply still refused *because review-verdict was missing*. Ledger
   (`f4c49eb`): **both** apply Decisions have `plan-present` present=false,
   message `plan.xml missing`, **and** `review-verdict` missing. The second
   refusal is not "only the verdict". The transcript names the smaller
   remaining problem and drops the one that was still blocking.

2. **The `<?xml` declaration is not in the history.** `932c452:plan.xml`
   does not start with `<?xml`. HEAD `plan.xml` does not either. No commit
   records adding or removing a declaration. The FOLKLORE line that claims
   this fix has no corresponding diff. What *is* in `932c452` is a
   different, sufficient reason for `readPlanStatus` to return undefined:
   the file does not parse. `evaluateApplyGateArtifact` reports that as
   `"plan.xml missing"` (`src/gates/core.ts:314–326`) — the same string it
   uses when the file is absent. The diagnostic the model trusted is itself
   a lie about absence. HEAD plan is well-formed XML with **no `status`
   attribute**, so `readPlanStatus` is still undefined and `ngrace status`
   still prints `plan=missing` for a file that exists.

3. **Init "from templates".** Transcript: sed substitution on the skill
   templates. `7d33ddc` technology / principles / ux-guidelines do not
   contain the template's element names. That is not a tidy omission; it is
   a different document.

4. **`status="approved"` on the spec is unlabeled.** The file at `932c452`
   (unchanged through HEAD) is already approved. `ngrace spec new` emits
   `draft`. Someone wrote seven characters into the root element. The
   transcript says "Spec approved ✓" in a count section and never tags the
   edit FOLKLORE or INFERRED. muse, facing the same fact, labeled it.

Lesser mismatches, not flattering so much as sloppy:

- Commit `7d33ddc` subject: *"first governance marker on merge package"*.
  No Go file is in that commit. Markers were added and removed uncommitted,
  or the subject is wrong. The transcript later admits the removal.
- Counts are estimated; labeled rows are 11 / 3 / 1 / 0, not 20 / 6 / 4 / 1.
- `plan.xml.tmp_bak` (262 lines, `C-ESTABLISH-MODULE-GRAPH-4`,
  `status="applied"`) is committed at `932c452` and never mentioned as a
  committed file. The narrative points at a branch `neo-grace-attempt-7`
  that **does not exist** in this clone. Copying a prior attempt's plan is
  repo-specific, not a GRACE step, and it is how they knew what a valid
  plan looks like.
- Section 3 of the first draft says they did not reach gates. The same
  file, after `7b7f2bf`, says they did. Incremental honesty, not a single
  clean story — which is what was asked for.

What the transcript got right, and the ledger confirms: approve permitted
with a dirty plan; apply refused; archive permitted; the change is still
`[active]`. That last observation is the valuable one.

### muse — the transcript is not more flattering; it is more complete than the branch

The branch ref `aaaf501` contains **only** `TRANSCRIPT.md` (plus the
pre-existing demo transcript). Every artifact the transcript describes is
uncommitted. Ground-truth-as-commits therefore says: *this run wrote a
diary and nothing else.* Ground-truth-as-the-tree-the-run-left says: the
diary matches.

Matches (WT vs transcript):

- spec is the untouched generator emit (`diff` against `ngrace spec new
  C-001` is empty).
- ledger is one approve/permit.
- no `plan.xml` (they say they deleted the orphan).
- `main.go` has the contract, no `MODULE_MAP`. Live lint: the one error
  they reported last.
- `AGENTS.md` replaced; backups present.

Disagreements:

- `#6` says `.ngrace` already existed with `changes/archive` at the
  pre-condition check. `0d92d15` has no `.ngrace`. Either they created
  directories before recording the stop, or they misread the start state.
  `AGENTS.md` alone is enough to fire skill step 2, so the conclusion
  (blocked) is right and the `.ngrace` clause is not.
- `#22` / `#23` are hand-edits labeled `[CLI]`.
- Self-reported 17 CLI / 7 FOLKLORE does not match the 14 / 11 on the page.
- The file is structured as the prompt's output template. The prompt said
  not to tidy. There are no `INFERRED` labels on the init placeholder
  fills — those guesses are buried in `note:` lines and then collected
  under "What I had to guess." That is tidying of the label stream.

Muse is not flattering about outcomes (three BLOCKED, one remaining
MODULE_MAP error, no close). It is flattering about **process orderliness**.
The commits cannot corroborate the orderliness because the commits do not
contain the work.

---

## What they had to guess

Every INFERRED line, grouped by the thing being guessed. muse's unlabeled
but admitted guesses are included; burying them was a reporting failure.

### Project metadata for init placeholders

- ornith: `$PROJECT_NAME`, `$KEYWORDS`, `$ANNOTATION`, `PRIMARY_GOAL`,
  `PRIMARY_USERS` from README / go.mod. Labeled FOLKLORE, described as
  INFERRED.
- muse: same set, notes on `#10`–`#14`. Counted as 4 INFERRED decisions,
  not labeled on the write lines.

This guess is inherent in `ngrace-init` step 1 ("gather…") with no human.
Not a lifecycle hole. A brownfield-interview hole.

### What to do with a pre-existing `AGENTS.md` when the user cannot answer

- muse `#8`: backup, then overwrite with the protocol template.
- ornith: keep.

Opposite guesses, both unlabeled by the skill.

### Module identity and file-local markup

- muse: `M-APP` for `main.go`; first guessed `M-API` / `M-STORE` / `M-AUTH`
  as DEPENDS, then removed them; `LINKS: V-M-APP` to silence coverage.
- ornith: tried DEPENDS/LINKS with colons, learned the hard way that the
  colon is not a separator (D5.1, live), removed the markers.

Neither found `ngrace scaffold` or `ngrace file exports`. They guessed the
markup the P1.7 read-only view exists to print.

### How `status` becomes `approved`

- muse `#28`: hand-edit after `gate approve` permit, then `#30` revert.
  The guess was *correct about the mechanism* and *wrong about permission
  in an eval with no user*.
- ornith: the same edit, kept, unlabeled. That guess is what every one of
  this repository's own 43 archived bundles did for `applied`, one
  transition earlier.

### What a plan is allowed to look like

- ornith, explicitly: copied shape from a prior-attempt plan (cited as
  `neo-grace-attempt-7`; the file they committed is
  `C-ESTABLISH-MODULE-GRAPH-4`). The generator they had just run already
  knew the shape. They guessed they should replace it.
- muse: never reached this guess.

### Whether archive permit means the bundle is archived

- ornith: ran `gate archive`, got permit, then observed `ngrace status`
  still listing `[active]`. They recorded the surprise. They did not guess
  the three missing writes; they stopped.

### Whether init should have been a change bundle

- muse worst-moment #5: drift on the files they just wrote *"suggesting
  init should have been performed via a change bundle, contradicting skill
  instructions."* That is P4's adoption kind, independently restated.

---

## What neither could do

| BLOCKED point | ornith | muse |
|---|---|---|
| Init without a human keep/merge/overwrite answer | Worked around (kept `AGENTS.md`) | Labeled `#6`, then workaround `#8` |
| Bring even one Go file to green governed lint | Retreated; 0 governed files | `#21`; stuck on `MODULE_MAP` with a guide that does not name `scaffold` |
| Produce a lint-clean **plan** | Tried; two committed versions, both fail (parse, then grammar) | Never reached |
| Get `gate apply` to permit | Twice refused | Never called |
| Record a review verdict | Transcript: *"would require `ngrace gate verdict`… skill I didn't walk, so BLOCKED"* — not labeled, but named | Never reached |
| Flip spec to `approved` without a human lexicon phrase | Did it anyway | `#29` BLOCKED, reverted |
| Close / archive the bundle as a filesystem fact | Archive *gate* permitted; bundle did not move | Never reached |
| Find a `lifecycle` or `plan amend` verb | Did not search by those names | Did not search by those names |
| Compare `MustVerify` to `MustPassCommand` | Never wrote either set honestly | Never wrote a plan |

Neither run used `cursor`, `review`, `scaffold`, `file exports`,
`lint --as`, or `lint --explain` (except that lint's text already appends
the explain hint; there is no evidence they followed it).

---

## Against the measured baseline

Verified in *this* repository on 2026-08-14 before relying on the prompt's
five facts:

| Baseline fact | Verified? | ornith independently hit it? | muse independently hit it? |
|---|---|---|---|
| Six manual steps after `gate apply` permits; three have **no CLI verb** (spec `applied`, plan `applied`, move to `archive/`) | The three no-verb steps are real (`src/gates/command.ts` header; `ngrace-execute` steps 9–10; no writer of `applied` in `src/`). **The other three of the six are not enumerated in F86.** I will not invent them. After apply the execute skill names `gate archive` (has a verb) plus the three no-verb writes. That is four, not six. | **No.** Apply never permitted. They *did* see archive-permit-without-move, which is the no-verb move step in negative space. | **No.** Never reached apply. |
| Across 43 archived bundles the ledger ends at the archive Decision; the three folklore steps leave no machine record | **43** archive dirs; **39** with a ledger; **all 39** end on `gate="archive"`. **42** specs and **42** plans are `applied`. **One** exception: `C-LEDGER-READ-ABSENCE` is `superseded` with no plan. Four have no ledger (`C-ABSENCE-VALUE`, `C-ATTEMPT-LOG`, `C-LEDGER-READ-ABSENCE`, `C-RUN-LEDGER`). F86's "every one still hand-written applied" is therefore **one bundle too strong**. | **Yes, in miniature.** Their own ledger ends at `archive=permit` while the bundle is still `active/` and spec is still `approved`, not `applied`. | No — no archive Decision. |
| `ngrace gate` prints no `next:` after a permitting decision | Confirmed in `formatGateEvaluation`. Help text for apply/archive says the command does not change status. | Not named as `next:`. They noticed the missing *effect*. | **Yes**, in substance: permit did not update `spec.xml`; "no documented human handoff command." |
| No `lifecycle` command and no `plan amend` verb | Confirmed: not in `src/grace.ts`, not on `~/bin/ngrace`. | Not discovered by name. They asked for a shorter path, not those verbs. | Not discovered by name. They asked for `ngrace init` and an approve-that-writes-status. |
| No check that a change's `MustVerify` set is ⊆ `MustPassCommand` / task `Verification` | Confirmed: no such rule under `src/artifact` or `src/lint` outside tests. | **Unmeasured.** They never wrote a real `MustVerify` / `MustPassCommand` pair. The generator they discarded emits `MustExist` + `bun test`, not a coverage relation. | **Unmeasured.** No plan. |

Did either get past a close? **No.**

The INFERRED lines that would have been "what this project's 43 bundles
have been relying on unwritten" therefore **do not exist for the close**.
The closest text is muse `#28` (status is a hand-edit; the gate will not
do it) and ornith's archive-permit-but-still-active observation. Those are
the unwritten rules for *approve* and *archive-the-gate*, not for
*applied + mv*.

---

## Malformed XML

Preliminary signal was right, and it is **one run**, not both.

### Incident O1 — `C-AUDIT-001/spec.xml` `&mdash;` (ornith, `932c452` = HEAD)

1. **Authoring path.** `ngrace spec new C-AUDIT-001`, then hand-fill.
   Generator emit is valid-by-construction and does not contain `&mdash;`.
   The entity was introduced while filling `<Constraint>`. **Editing, not
   discoverability.**
2. **What is malformed.** Undefined entity `&mdash;` (HTML, not one of the
   five predefined XML 1.0 entities). `xml.etree` rejects it:
   `undefined entity: line 14, column 81`. Adjacent issues that are *not*
   well-formedness: `IC-AUDIT-HANDLER` placed under `AcceptanceCriteria`;
   `NonGoals` has no `<NonGoal>` children. No `--` in a comment. No smart
   quotes. No truncation.
3. **Did lint catch it?** **No.** `ngrace lint` on HEAD reports nothing
   against `spec.xml` except two `change.acceptance-criterion-unmapped`
   warnings (and those are about the *plan*). The shipped parser accepted
   the entity. F43 said an XML artifact cannot quote XML; this is the
   sibling hole: an XML artifact cannot use a dash the way English wants,
   and the checker that claims well-formedness is not a conformant parser.
   `xml.comment-not-well-formed` is irrelevant here.
4. **Attempts.** One committed spec, never repaired. The model did not
   know it was malformed.

### Incident O2 — `C-AUDIT-001/plan.xml` at `932c452` (ornith)

1. **Authoring path.** `ngrace plan new` first (emit, reconstructed,
   lints 0 unmodified). Then hand-fill with Python / ElementTree / heredoc.
   **Editing.** The generator did its job. Filling destroyed the file.
   Discoverability is not the defect; **the fill surface is**.
2. **What is malformed** (single 19-line file, 2691 bytes):
   - Dotted close tags: `</Baseline.Assertions>`, `</Observed.WriteScope>`.
   - Truncated / spliced tags: `OutOfPl</OutOfPlanScope>/DurableScope>`,
     `</C/AUDIT-001>/NgraceChangePlan`.
   - Self-closed `<TargetAssertions/>` followed by prose
     `/TargetAssertions/ -- MustContainFile …`.
   - Attribute-form assertions (`<MustExist value="M-AUDIT" />`) where the
     grammar wants a `<Value>` child.
   - Typos: `Critieron`, `AcceptanceCritertia`, `</acceptanceCriter>`.
   - `<!--AC-AUDIT-NEW-->` used as a Satisfies body (comment, not an
     `<AC-*>` child). Comment bodies do **not** contain `--`;
     `xml.comment-not-well-formed` would not fire.
   - `&mdash;` again, plus `plan&amp;s` (a legal entity, a lost apostrophe).
   - No `<?xml` declaration in this commit (see honesty).
   - Not smart quotes. Not a truncated write in git — the broken file was
     committed whole.
3. **Did lint catch it, and did the message lead to a fix?**
   Lint emitted **three copies** of one `xml.parse`:

   > Expected closing tag 'BaselineAssertions' (opened in line 6, col 1)
   > instead of closing tag 'Baseline.Assertions'.

   That is a specific, teachable instance message. `--explain xml.parse`
   then generalises to *"unclosed tags, bad entities, or a missing root"*
   — true and weaker than the instance line. Parse stops at the first
   mismatch, so the other dozen breaks are invisible. The model did **not**
   rename `</Baseline.Assertions>`. It rewrote the file. The diagnostic
   named a one-token fix and was treated as a reason to start over. That
   partly indicts the diagnostic (one error, three times, no view of the
   rest of the document) and partly the model (the token to change is in
   the message).
4. **Attempts.** Two committed plan bodies (`932c452` malformed,
   `f4c49eb` well-formed stub) plus one committed foreign backup
   (`plan.xml.tmp_bak`) plus a claimed ~15 uncommitted iterations. Recovery
   to well-formed XML: **yes**, on the second committed try. Recovery to a
   valid plan: **no**.

### Incident O3 — `C-AUDIT-001/plan.xml` at HEAD (`f4c49eb`) (ornith)

1. **Authoring path.** Hand rewrite after O2. Not the generator. Looks
   like a gutted skeleton (`MustExist` with empty `<Value/>`,
   `<Title value="..."/>`, no `status`).
2. **What is malformed.** Nothing, as XML. `xml.etree` accepts it. As
   GRACE: `change.missing-status`, empty target assertions, empty title,
   missing `DependsOn` / `AcceptanceCriteria` / `Verification`,
   `scope-does-not-cover-spec` for `M-API`. **Ten errors, two warnings.**
3. **Did lint catch it?** **Yes**, with `(ngrace lint --explain …)`
   appended per code. `--explain change.missing-status` is
   **emittable-uncatalogued** and talks about active-vs-archive location,
   not "add `status="draft"` to the root". The instance message is the
   useful one: *NgraceChangePlan must declare a lifecycle status.* They
   did not add it. Apply still sees `plan.xml missing`.
4. **Attempts.** This *is* the attempted recovery from O2. It is the last
   plan on the branch.

### Incident O4 — `plan.xml.tmp_bak` (ornith, `932c452`)

Well-formed. Not their change. `C-ESTABLISH-MODULE-GRAPH-4`,
`status="applied"`. A prior attempt's plan, committed as a backup. Not a
malformation. Evidence they knew a valid plan existed and still could not
produce one for `C-AUDIT-001`.

### muse — no malformed-XML incident

Every WT XML file is well-formed. The spec is the generator emit,
unmodified. They never filled a change artifact, so they never had the
chance to break one.

### Does the XML authoring surface have a capability floor?

**Yes, for plan fill, at the ornith-35 level.** A model that can write a
recognisable spec (O1 is an entity, not a collapsed tree) cannot keep a
plan well-formed once it starts replacing generator text with content.
The failure mode is not "does not know XML"; it is nested GRACE grammar
plus English punctuation (`&mdash;`, apostrophes) plus tool-assisted
rewrites (ElementTree, heredoc) that splice tags.

**Generators remove the floor for the skeleton and do not remove it for
filling.** Evidence: `ngrace plan new C-AUDIT-001` against ornith's own
approved spec produces a document that lints 0. The next human-or-model
edit is where O2 happens. muse never took that step, so muse is not
counter-evidence; it is a run that declined the test.

Leaving the skeleton unfilled is how muse stayed valid. That is not a
strategy P3 can ship.

---

## What this says about each P3 objective

P3's objectives are `plan.md` §2 P3.1–P3.7. Four earlier roadmap steps in
this track have already failed construction. The same standard applies
here: an objective the evidence says is aimed at the wrong wall is
mis-scoped, not "supported."

### P3.1 — `ngrace lifecycle finish`

**Supports the existence of the verb.** Both runs died without a close.
Ornith independently reproduced F86's ledger-ends-at-archive-Decision
shape: permit recorded, filesystem not moved, no machine record of
`applied`. Muse independently restated the sister fact at approve: the
gate records and does not write `status`. Gate help already says this;
nobody prints `next: ngrace lifecycle finish`.

**Does not support building P3.1 as the next thing these adopters need.**
Neither run got a permitting `gate apply`. The command as specified
*starts after* that permit. Writing P3.1's steps from this measurement as
if the missing piece were "one verb after apply" would ignore the walls
that actually stopped both models (init folklore, authored approval,
MODULE_MAP, plan fill). Those walls are P4 and leftover P1
discoverability.

**Mis-scope risk, same class as F86's self-referential gate.** The P3
detail-gate's target *"manual post-gate steps = 0"* is a description of
P3.1's output. These transcripts cannot drive that number. What they can
drive is: *the last mile is folklore, and the first two miles are too.*

P3.1's "folds any loose epoch" clause is already narrowed by F86
(recovery paths only). Neither run opened a cursor. Unmeasured.

### P3.2 — `ngrace plan amend`

**Unmeasured.** Neither run had an approved plan to amend. Ornith's
in-place plan hacking is the *symptom* amend exists to replace, but it
happened to a draft/invalid plan, which amend is specified not to touch.

Do not write P3.2 steps from this evidence. Nothing here supports the
whitelist, the ledger event, or the review surfacing.

### P3.3 — MustPass coverage check

**Unmeasured.** No `MustVerify` set was mirrored, waived, or forgotten,
because no real target-assertion set was written. The generator's
`bun test` on a Go repo is adjacent colour, not this check.

### P3.4 — Marker discipline

**Mostly unmeasured, and possibly mis-aimed for brownfield.** Neither run
declared a `<Marker>` or a `START_BLOCK_*`. What they hit instead is
`MODULE_CONTRACT` / `MODULE_MAP` / `LINKS`. That is P1.7 (`file exports`)
and `scaffold`, which already exist on the eval binary and were not
found. Author-time marker-anchor checking will not have been the first
failure a brownfield adopter sees. Emission-deferred `<MarkerPending>`
was never in scope.

### P3.5 — `ngrace verification --run`

**Unmeasured.** muse created a `V-M-APP` stub with no `<Command>`. ornith
created an empty `VD-MAIN`.

### P3.6 — Verdict `--dry-run`

**Unmeasured as specified; the evidence points at a different gap.**
Ornith named `gate verdict` as the thing they had not walked and stopped.
The missing piece for them was not a dry-run of the record; it was
**discovering that the record exists and is a precondition of apply**.
`--dry-run` on a verb they did not find will not move this number.

**Suggests P3.6 is mis-scoped relative to this measurement.** Apply's
`review-verdict` requirement is invisible until apply refuses, and the
refuse text is mixed with a false `plan.xml missing`. That is a
diagnostics problem on a P1 surface, not a dry-run problem.

### P3.7 — Hand-written `applied` detection

**Unmeasured for `applied`.** Nobody wrote `applied`. muse wrote
`approved` and reverted; ornith wrote `approved` and kept it — and that
transition is *supposed* to be authored (D1). A finding that fires on
hand-written `applied` would have been silent on both of these trees.

The evidence **does** support D1.3's premise (nothing observes the
difference between a permit and a word in a file): ornith's archive
permit is recorded; the move is not; status still says `[active]`. That
is the detection gap, demonstrated on `archive`, not yet on `applied`.

**Mis-scope risk:** shipping P3.7 on day one against this repository still
needs D1.4's non-retroactive trigger. Re-measured: 39 ledgers, all
ending at archive, 42 hand-written `applied`. The naive rule is still a
mass false positive. These two runs do not change that.

---

## What the evidence does NOT support

- **That P3.1, as specified, would have let either run close.** Apply
  never permitted. A finish command that requires a permitting apply
  would have refused both.
- **That generators make an agent able to author a valid change
  artifact.** They make an agent able to *emit* one. muse's valid spec is
  an unfilled emit. ornith's invalid plan is a filled emit. P1.5's
  acceptance test ("generated output passes lint when committed
  unmodified") passed in reproduction and did not save the run.
- **That P1's "errors teach the fix" claim holds for outsiders.**
  `xml.parse` named the exact bad close tag; the model rewrote the file.
  `markup.module-map-missing` is uncatalogued and does not mention
  `scaffold` or `file exports`. `change.missing-status`'s explain guide
  talks about archive location. `gate apply`'s `plan.xml missing` is
  false when the file exists but has no `status` or does not parse. This
  is the first outside test of that claim. It did not hold.
- **That the two models walked the same path.** They did not. Agreement
  is about walls (no init verb, authored approval, drift after init, no
  close). Divergence is about everything between those walls. Averaging
  folklore-step counts would erase that.
- **That muse's 30-line transcript is a complete record.** The branch
  contains the diary and not the work. Several hand-edits are labeled
  CLI. Init guesses are unlabeled.
- **That ornith "almost closed."** Archive permit is not a close. The
  plan is missing-as-far-as-the-tool-is-concerned. The code change is
  real and ungoverned.
- **That brownfield adoption takes ≤3 bundles.** Both used one bundle
  and failed inside it. The ≤3 target remains a P3/P4 output, exactly as
  F86 said.
- **That `MustVerify` ⊆ `MustPassCommand` is a brownfield-first
  problem.** Unmeasured.
- **That Marker-vs-TraceAssertion is a brownfield-first problem.**
  Unmeasured. MODULE_MAP is.
- **That the tier-1 no-adapter path is understood.** Not exercised.
  MODULE_MAP parity *was* enforced (muse, `.go`). That is the adapter
  path working, and still blocking.
- **That a short clean transcript is a good run.** muse is the shorter
  clean one and the one that committed nothing.
- **That confidence in a step is evidence of the step.** ornith's
  "spec lints ZERO errors" is true of ngrace and false of XML 1.0.
  "archive succeeded" is true of the gate and false of the filesystem.

---

## Adoption friction vs this repository's shape

| Observation | Whose? |
|---|---|
| Pre-existing `AGENTS.md` with project-specific e2e / HUD / `.env` rules | Repo. The *stop-and-ask with no non-interactive path* is GRACE. |
| Go + VanJS, 32 `.go` files, adapter-backed | Repo, and it is why MODULE_MAP fired. Not a GRACE defect that it fired. The defect is that the repair verb (`scaffold` / `file exports`) was not discoverable from the error. |
| Cited `neo-grace-attempt-7` / committed `C-ESTABLISH-MODULE-GRAPH-4` backup | Repo (prior attempts on the same machine / clone). Using it is an eval contaminant, not a GRACE step. |
| Empty `changes/archive/` vanishing from git, then `project.missing-change-directory` | Product + git. Both runs `mkdir`'d it; only a committed empty dir would need a `.gitkeep`. ornith HEAD lint fails this (11th error) because git did not store the directory. |
| Host also has published `@neograce/cli@6.2.0` on `PATH`, which rejects `spec` as unknown | Not a run fact. Authority: both SLMs invoked `~/bin/ngrace`. P1 complete is this tree, not a 6.2.0 release. |

---

## Implication for writing P3's steps

Count remaining folklore on the path these two actually walked, not on the
path P3.1 assumes. Per run, never averaged:

**muse, still standing:** init (entirely folklore), AGENTS.md conflict,
MODULE_MAP without a named repair verb, authored `draft → approved` with
no human, unexplained drift on the init tree, no close verb. Stopped at
the approval lexicon. XML fill untested.

**ornith, still standing:** the same init and drift walls, plus a
capability floor on plan fill, plus a diagnostic that reports a present
plan as missing, plus a review-verdict precondition they did not discover
in time, plus an archive permit that does not archive. They implemented
the product change anyway.

P3 step detail that begins at `lifecycle finish` will be true and late.
The measurement F86 asked for is: the lifecycle is folklore *and* the
adoption path is still a climb. P4 is not optional colour on this
transcript. It is most of the transcript.
