# Repository Context

This repository is the GRACE marketplace package, not an end-user application.

GRACE means Graph-RAG Anchored Code Engineering: a contract-first AI engineering methodology built around semantic markup, XML planning artifacts, knowledge-graph navigation, and verification/log-driven execution.

## What This Repo Contains

- `skills/ngrace/*` contains the canonical skill sources.
- `plugins/ngrace/skills/ngrace/*` contains the packaged mirror used for Claude marketplace/plugin distribution.
- `.claude-plugin/marketplace.json` defines the marketplace entry.
- `plugins/ngrace/.claude-plugin/plugin.json` defines the packaged plugin manifest.
- `openpackage.yml` defines OpenPackage metadata.
- `README.md` is the user-facing overview and install guide.
- `package.json`, `src/grace.ts`, and `src/grace-lint.ts` define the published Bun-powered CLI package `neo-grace` and the `ngrace lint` command.
- `scripts/validate-marketplace.ts` validates packaging, path safety, version sync, and packaged-vs-canonical drift.
- `docs/plans/*` contains roadmap-level implementation plans (see below).

## Where Plans Live

- Index of every plan and its status: `docs/plans/README.md` — **read this before starting work.**
- Active plans: `docs/plans/active/<RM-SLUG>/plan.md` (normative) plus `review.md` (explanatory).
- Completed, superseded, or cancelled: `docs/plans/archive/`. **Never edit anything under `archive/`.**
- Per-change execution artifacts are GRACE change bundles under `.ngrace/changes/`, not markdown. Do not put plans there.

A plan's `status` appears in its YAML frontmatter and must agree with its directory
(`active/` vs `archive/`). Superseding a plan means setting `status: superseded`, filling
`supersededBy`, and moving it to `archive/` — never rewriting it in place.

## Core Purpose

The repository packages and distributes GRACE skills so coding agents can:

- initialize GRACE project artifacts
- plan module architecture and contracts
- design verification and log evidence
- execute plans sequentially or in parallel-safe waves
- inspect project health, refresh drift, review integrity, explain GRACE, and answer project questions

This repo is mainly about methodology content, skill instructions, and marketplace packaging.

## Important Working Rules

- Treat `skills/ngrace/*` as the main source of truth unless a task is explicitly about packaged output.
- Keep `plugins/ngrace/skills/ngrace/*` synchronized with the canonical `skills/ngrace/*` copies when published skills change.
- Keep versions synchronized across `README.md`, `openpackage.yml`, `.claude-plugin/marketplace.json`, and `plugins/ngrace/.claude-plugin/plugin.json`.
- Validate repo integrity with `bun run ./scripts/validate-marketplace.ts` after packaging or metadata changes.
- For CLI changes, run `bun run validate:cli` and exercise `ngrace lint` against a complete temporary or fixture neo-grace project. This packaging repository hosts a thin `.ngrace` tree for dogfooding; `bun run ngrace lint --path .` is expected to pass. That green result depends on `.ngrace-lint.json` (`ignoredDirs: ["examples", "scripts"]`): `examples/` is a nested project covered by `validate:examples`, and `scripts/` adoption (including `M-RELEASE-AUTOMATION`) is deferred to a later `C-*` — without that config, root lint reports twenty real errors under `scripts/`.
- Do not assume every directory under `skills/ngrace/` is published; the actual shipped set is declared in `.claude-plugin/marketplace.json`.

## Briefing The Executor

Implementation work is dispatched to a separate executor agent. **Always assume its context is
cold.** Every brief must be self-contained: what this repository is, where artifacts live, the role
split, and the instruction to refresh its installed `ngrace` skills from `skills/ngrace/*` before
reading any source, because the installed copies have drifted on nearly every bundle.

Never write a brief that refers to "your draft" or otherwise assumes the executor remembers earlier
work. Point at the artifact by path and tell it to read it. A cold-safe brief still works for a warm
executor; a warm brief fails a cold one, so cold is the only safe default.

## Evidence Standard For The Authority

The authority holds the executor to `file:line` citations and pasted command tails, and tells it a
hand-written claim of green is not evidence. **The same standard applies to the authority's own
claims.** Four rules, each written after a measured failure:

1. **A finding is never evidence of present state.** Entries in `decisions.md` are dated claims.
   Before citing `F<n>`, check the code it describes; if the code has moved, the finding is history.
   `F27`'s headline ("`ObservedWriteScope` … never compared") was restated as live twice after
   `C-DECLARED-WRITES` had paid it.
2. **"X does not exist" is a search result, not an inference.** Any claim that a mechanism, remedy,
   or precedent is missing requires the grep, the command run, or the archive listing *first*.
   Absence claims are the most expensive errors this repository has recorded.
3. **Read an artifact's definition before giving it a role in an argument** — what writes it, what
   consumes it. `run.xml` and `run/` are unfolded loose events; the durable record is
   `run-ledger.xml`. Inferring a role from a filename produced a whole fabricated decision.
4. **No decision reaches the maintainer on an unverified premise.** Before presenting options, list
   the facts the options depend on and verify each one. A wrong premise costs the maintainer a turn
   spent refuting instead of deciding, which is worse than a slow answer.

5. **A passing suite is not verification — exercise the product.** Tests are written by the party
   under examination and can be falsified, tautological, or aimed at the wrong surface. Before
   accepting delivered work, the authority builds a throwaway project and drives the real CLI
   through the behaviour: the happy path, each refuse path, and a byte-level diff where the change
   claims to be surgical. `bun test` green is a precondition, never the evidence. This is automatic
   and does not wait to be asked.

6. **One message, the whole picture.** When reporting defects, enumerate **every** known issue at
   once — blocking and cosmetic together — never the blocker first and the nits after it is fixed.
   Serial disclosure costs the maintainer a decision per item and hides the true size of the
   remaining work.

7. **No debt is carried forward. This is the law.** A defect found is a defect fixed before the
   work is handed on — not filed as a follow-up, not noted in a report, not deferred to a later
   bundle. Sizing decides the *actor*, never whether it gets fixed: the smallest changes are the
   authority's own or a subagent's; larger ones go to the executor. See also [D11](docs/plans/active/RM-GOVERNED-PATH/decisions.md),
   which refuses any deferral without a dependency or a conflict.

8. **Measure the population, never a sample.** Any number that will be written into a finding, a
   brief, or a decision comes from the whole set, produced by a command that can be pasted, and
   carried with the date it was taken. Never generalize from spot-checked files: `grep -l` finds the
   set, but reading three of them and writing that content onto the count is fabrication with a true
   premise. `grep -c` counts *lines*, not occurrences, and these artifacts wrap phrases across lines
   — flatten whitespace first. Counts also expire (F123): a corpus count changes the moment a bundle
   archives, so re-measure at citation rather than quoting an earlier turn. F130.1 was written after
   a three-file sample became a 22-file claim, and the five files the sample missed were the ones
   that changed the argument.

9. **Before proposing to change a behaviour, find the decision that created it.** Search the
   archived bundles and `decisions.md` for the acceptance criterion that put it there, and read the
   reasoning. Much of what looks like an oversight is a shipped ruling with a counterweight — the
   current-mode lint framing was deliberately chosen by `C-REPORT-HONESTY`, whose derivation calls
   the obvious "fix" unacceptable because it would stop catching real breakage. A proposal may still
   overturn such a ruling, but it must **say** that it is overturning one and answer the original
   argument. Silently contradicting a prior decision costs the maintainer a turn and reopens a
   question that was already paid for.

**Verify empirically, and verify before briefing, not after the report.** Every claim above is a
measurement, not a recollection. Drive the real CLI against a throwaway project, probe both
directions so a refusal discriminates rather than merely fails, and do this *before* writing a brief
— a gap the executor has to find is a gap that was cheaper to measure. When the executor corrects a
number, re-measure it independently and record the correction against the finding that carried it.

When presenting a decision, give **itemized variants with explicit pros and cons**, then the
recommendation and why the runner-up loses — never prose, and never a single recommendation with the
alternatives implied.

## How To Think About Changes

- Skill text changes are product changes.
- Packaging/manifests/metadata changes are release-surface changes.
- Validation changes protect against drift between canonical skills and packaged copies.
- README and changelog updates are part of release hygiene, not optional polish.

## Default Mental Model For Future Sessions

If a request is ambiguous, assume the user is working on one of these areas:

- refining GRACE methodology instructions
- adding or updating a skill
- fixing packaging/marketplace installation
- maintaining the published `grace` CLI and its lint workflow
- keeping canonical and packaged skill trees in sync
- tightening verification around releases
