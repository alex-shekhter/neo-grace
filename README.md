# GRACE Marketplace and CLI

**GRACE** means **Graph-RAG Anchored Code Engineering**: a contract-first AI engineering methodology built around semantic markup, `.ngrace` XML artifacts, knowledge-graph navigation, assertions, scopes, and log-driven verification.

This repository ships the GRACE skills and the `ngrace` CLI they depend on. It is a packaging and distribution repository, not an end-user application.

> **`neo-grace` is a fork of [osovv/grace-marketplace](https://github.com/osovv/grace-marketplace),
> implementing the GRACE methodology by Vladimir Ivanov.** Version numbering continues
> upstream's, and changelog entries at 4.0.4 and below describe work done there.
> See **[LINEAGE.md](./LINEAGE.md)** for full credits.

Current packaged version: `6.1.0`

**Two version numbers, independent of each other:**

1. **Product version** (the number above; npm / marketplace) — the `neo-grace` release.
2. **Artifact grammar version** (`1.0`, carried on every root as `graceVersion="1.0"`) — the shape of `.ngrace` XML this CLI validates.

The grammar version is **not comparable** to upstream GRACE's numbering; this line is ours and starts at `1.0` because the grammar has diverged. It is **not** the product version either: a grammar bump means something became *required* (and ships with a migration path), not that the release is larger.

## New to GRACE? Start Here

| Start | Time | What it is |
|---|---|---|
| [**Visual introduction**](./docs/ngrace-explainer.html) | 5 min | Why GRACE exists and how the pieces relate. Open the file in a browser — it is self-contained. |
| [**Twenty-minute walkthrough**](./examples/polyglot/WALKTHROUGH.md) | 20 min | A guided tour of a real React + Go + Rust project. You break it on purpose four times, then run one complete change lifecycle — approve, slice, scope finding, absence, review, verdict, fold, archive. |
| `ngrace doctor --path .` | 1 min | Run against your own repository first. Reports which of your languages have export verification before you commit to anything. |

Contributing to this repository? See [CONTRIBUTING.md](./CONTRIBUTING.md) for the day-to-day and release workflow.

You never hand-author the XML — the skills write it and you approve it. Both documents are written from that side of the screen.

## What This Repository Ships

- Canonical GRACE skills in `skills/ngrace/*`
- Packaged Claude marketplace mirror in `plugins/ngrace/skills/ngrace/*`
- Marketplace metadata in `.claude-plugin/marketplace.json`
- Packaged plugin manifest in `plugins/ngrace/.claude-plugin/plugin.json`
- OpenPackage metadata in `openpackage.yml`
- Required Bun-powered CLI package `neo-grace`

## neo-grace Project Model

neo-grace uses `.ngrace` as the durable project model:

| Area | Purpose |
| --- | --- |
| `.ngrace/context/*.xml` | Requirements, technology (optional multi-stack `Stacks`), principles, deployment, and UX constraints |
| `.ngrace/context/design-system.xml` | Optional design tokens (`DT-*`), breakpoints (`BP-*`), and a11y standards |
| `.ngrace/context/invariants.xml` | Optional cross-cutting invariants (`INV-*`) referenced by `MustUphold` |
| `.ngrace/graph/index.xml` + routed graph docs | Current graph projection for `GD-*`, `M-*`, `DF-*`, and `IC-*` anchors |
| `.ngrace/verification/index.xml` + routed verification docs | Current verification projection source for deterministic `V-M-*` entries |
| `.ngrace/changes/active/C-*` | Active `NgraceChangeSpec` (optional `DesignReferences`), design context, and `NgraceChangePlan` |
| `.ngrace/changes/archive/C-*` | Applied, rejected, cancelled, or superseded change bundles |
| Source/test files with GRACE markup | File-local contracts, links, and semantic block anchors |
| `examples/polyglot/` | Golden-path React + Go + Rust monorepo (CI-linted, review-green, and its documented breaks plus the full lifecycle are executed by `scripts/validate-walkthrough.ts`; see the [walkthrough](./examples/polyglot/WALKTHROUGH.md)) |

neo-grace does not dual-validate legacy GRACE 3 project docs as current state. Existing GRACE 3 projects use `$ngrace-migrate`; the CLI validates the generated `.ngrace` result but does not convert legacy docs itself.

Verification commands run from the project root by default. A `V-M-*` entry may declare one contained project-relative `<Cwd>packages/example</Cwd>` while keeping `<TestFiles><File>...</File></TestFiles>` paths project-root-relative. Absolute paths, `..` escapes, and symlink escapes fail closed.

TypeScript/JavaScript semantic analysis is bundled and compiler-backed. Governed Python and Dart files require their respective runtimes on `PATH`; Python export analysis is exact when a static `__all__` is present (including Unicode identifiers) and otherwise emits heuristic confidence. A missing runtime fails closed with actionable `analysis.runtime-missing`; an installed adapter that fails emits `analysis.adapter-failed`. Neither failure state is presented as exact `MODULE_MAP` parity.

| Language | Export parity | Marker evidence | Test-file inference |
|---|---|---|---|
| TypeScript / JavaScript | exact (compiler-backed) | ✅ | ✅ |
| Python | exact with `__all__`, else heuristic | ✅ | ✅ |
| Dart | exact (runtime adapter) | ✅ | ✅ |
| Go | exact (pure-TS scanner, no `go` toolchain) | ✅ | ✅ |
| Rust | exact (pure-TS scanner, no `cargo`/`rustc`) | ✅ | ✅ |
| Java, Kotlin, Ruby, PHP, Swift, Scala, Clojure, SQL, shell | ❌ unverified — `analysis.no-adapter` | partial (default patterns) | ❌ |

**`CODE_EXTENSIONS` is a file-discovery list, not a support matrix.** A file's extension appearing there means GRACE will find and govern the file — not that GRACE can verify its `MODULE_MAP`. Languages without an export adapter emit `analysis.no-adapter` when `MAP_MODE` claims EXPORTS/LOCALS parity; acknowledge deliberately with `.ngrace-lint.json` `{ "unverifiedLanguages": [".rs", ".go"] }`.

**Governing a language GRACE does not ship.** Declare its extensions in `.ngrace-lint.json` — no fork required:

```json
{ "codeExtensions": [".ex", ".exs"], "unverifiedLanguages": [".ex", ".exs"] }
```

`codeExtensions` is additive to the built-in set, so it can add governance for a language but never remove it for another. Those files then get module contracts, `LINKS:`, semantic blocks, health, and drift detection. Export verification still requires an adapter, which is why the second key is there: it acknowledges that `MODULE_MAP` parity is unverified for those files rather than pretending it was checked. Run `ngrace doctor` to see which of your languages are adapter-backed.

## Install

**The CLI is required, not optional.** Install the skills first, then the CLI — both are needed for a working GRACE setup.

The skills can author `.ngrace` artifacts without it, but nothing validates them: XML well-formedness, required sections, anchor discipline, path containment, and every cross-artifact reference are checked by `ngrace lint`. The execute lifecycle is defined in terms of it — `--assertions baseline`, `target`, and `final` are the gates, and there is no gate without the binary. Skills plus no CLI is an unenforced methodology, which is the thing GRACE exists to replace.

### OpenPackage

```bash
opkg install gh@alex-shekhter/neo-grace
opkg install gh@alex-shekhter/neo-grace -g
opkg install gh@alex-shekhter/neo-grace --platforms claude-code
```

### Claude Code Marketplace

```bash
/plugin marketplace add alex-shekhter/neo-grace
/plugin install ngrace@neo-grace
```

### Agent Skills-Compatible Install

```bash
git clone https://github.com/alex-shekhter/neo-grace
cp -r neo-grace/skills/ngrace/ngrace-* /path/to/your/agent/skills/
```

### CLI

Requires `bun` on `PATH`. GRACE skills invoke the installed stable `ngrace` binary directly; they do not default to `bunx`, `npx`, or a prerelease dist-tag.

```bash
# Install the current stable release from npm `latest`
bun add -g @neograce/cli
ngrace --version
ngrace lint --path /path/to/grace4-project
```

## neo-grace Quick Start

For a new neo-grace project:

1. Run `$ngrace-init` to create `.ngrace`.
2. Fill `.ngrace/context` artifacts with your agent.
3. Run `$ngrace-spec` for a change.
4. Run `$ngrace-plan` after spec approval, then `ngrace gate approve --change C-ID` before the plan is marked approved. Refuse means unresolved clarifications on `IC-*` / `INV-*`.
5. Before observed writes begin, run the active-baseline preflight: `ngrace lint --path /path/to/project --assertions current`.
6. Run `ngrace lint --path /path/to/project --change C-ID --assertions baseline` before execution; add `--run-commands` when the baseline declares `MustPassCommand`.
7. Run `ngrace status --path /path/to/project --json`.
8. Run `$ngrace-execute` and choose sequential or parallel-safe mode. Parallel-safe mode additionally requires `ngrace lint --path /path/to/project --parallel-preflight`. Per task, `ngrace context --task T-NNN --change C-ID` emits the slice; each verification cycle is recorded with `ngrace cursor attempt` (or `ngrace cursor verification-unavailable` when it could not run), and each epoch is closed with `ngrace cursor fold`.
9. Before apply/archive, run `ngrace lint --path /path/to/project --change C-ID --assertions final`; add `--run-commands` when the target declares `MustPassCommand`.
10. Run `ngrace review --path /path/to/project --change C-ID` for mechanized findings, form judgment (detached where the host allows it), and record it with `ngrace gate verdict`. Then `ngrace gate apply --change C-ID` and `ngrace gate archive --change C-ID`. Apply requires a recorded verdict of *some* outcome — including `unable-to-determine` with a reason. It is never silently green.

Existing GRACE 3 projects should run `$ngrace-migrate` and review the migration report before writing `.ngrace` artifacts.

Migration cleanup is separately gated: successful current lint, fresh status proving neo-grace with no integrity errors, git/worktree inspection, exact cleanup paths, and explicit cleanup confirmation are mandatory. Dirty or non-git cleanup requires an additional acknowledgement naming that risk; any cleanup failure stops without automatic destructive retry.

## Skills Overview

| Skill | Purpose |
| --- | --- |
| `ngrace-init` | Bootstrap the `.ngrace` skeleton, templates, and agent guidance |
| `ngrace-spec` | Create an approved neo-grace change spec and optional design context |
| `ngrace-plan` | Design assertions, scopes, tasks, and verification gates from an approved spec |
| `ngrace-execute` | Execute the approved plan in sequential or parallel-safe mode |
| `ngrace-refactor` | Rename, move, split, merge, and extract modules without artifact drift |
| `ngrace-setup-subagents` | Scaffold GRACE worker and reviewer presets |
| `ngrace-fix` | Debug issues from graph, contracts, tests, traces, and semantic blocks |
| `ngrace-refresh` | Detect drift and propose reconciliation changes |
| `ngrace-status` | Report `.ngrace` health and suggest the next safe action |
| `ngrace-ask` | Answer architecture and implementation questions from `.ngrace` artifacts |
| `ngrace-cli` | Operate the required `ngrace` binary as the lint, gate, and artifact-query layer |
| `ngrace-explainer` | Explain the GRACE methodology itself |
| `ngrace-verification` | Build and maintain `.ngrace/verification` entries and evidence |
| `ngrace-design` | Interview for design-system intent; populate `design-system.xml`, `UI_COMPONENT` states, and a11y/visual evidence |
| `ngrace-reviewer` | Review semantic integrity, projections, scopes, and verification quality |
| `ngrace-migrate` | Agent-applied GRACE 3 to neo-grace migration with CLI validation |

## CLI Overview

| Command | What It Does |
| --- | --- |
| `ngrace lint --path <root> --assertions current` | Run the pre-implementation full-project check, including baselines of active approved changes; do not use it as post-edit target/final evidence |
| `ngrace lint --path <root> --change C-ID --assertions baseline [--run-commands]` | Validate the immutable selected baseline before implementation; command assertions run only when explicitly enabled |
| `ngrace lint --path <root> --change C-ID --assertions target --run-commands` | Validate selected target assertions and explicitly opt into `MustPassCommand` execution |
| `ngrace lint --path <root> --change C-ID --assertions final [--run-commands]` | Run the final full-project gate, evaluate the selected target, and keep unrelated approved baselines active without re-evaluating the selected baseline |
| `ngrace lint --path <root> --parallel-preflight` | Run the explicit approved-plan scope coexistence gate required for parallel-safe execution |
| `ngrace status --path <root>` | Report durable health, stale plans, scope conflicts, and explained/unexplained observed git drift |
| `ngrace module find <query> --path <root>` | Search graph projection modules by id, path, text, dependency, or verification id |
| `ngrace module show <id-or-path> --path <root>` | Show graph projection context and linked file-local markup |
| `ngrace module show <id> --with verification --path <root>` | Include matching deterministic `V-M-*` verification entries |
| `ngrace verification find <query> --path <root>` | Search verification projection entries |
| `ngrace verification show <id-or-module> --path <root>` | Show one verification entry and module context |
| `ngrace file show <path> --path <root>` | Show file-local `MODULE_CONTRACT`, `MODULE_MAP`, and `CHANGE_SUMMARY` |
| `ngrace lint --explain <code>` | Explain one issue code without linting. Three answers, never a guess: a catalogued code, a code this binary emits but has no dedicated entry for, or an unknown string — which says so and exits nonzero |
| `ngrace doctor --path <root>` | Read-only report: adapters, analysis coverage, document size pressure, context gaps, absence issues, calibration, plan quality |
| `ngrace graph split --by <path-prefix> --path <root>` | Move modules whose `Path` matches a prefix into a new `GD-*` document (dry-run by default; `--apply` to write) |

### Change lifecycle: gates, run ledger, and review

These carry the execute lifecycle. Gates evaluate and record a decision; they never author `status`
and never move a bundle. `ngrace review` never records a verdict. The separation is the point.

| Command | What It Does |
| --- | --- |
| `ngrace gate approve --change C-ID` | Evaluate the approve transition (unresolved `IC-*` / `INV-*` clarifications refuse) and record the decision |
| `ngrace gate apply --change C-ID` | Evaluate the apply transition — a recorded review verdict of some outcome is required |
| `ngrace gate archive --change C-ID` | Evaluate the archive transition (an open epoch refuses) |
| `ngrace gate verdict --change C-ID --outcome pass\|fail\|unable-to-determine` | Record judgment in `run-ledger.xml`; optional `--reason`, `--note`, `--scope task\|wave\|bundle`, `--classification implementation\|plan` |
| `ngrace review --path <root> [--change C-ID] [--base <ref>]` | Mechanized detectors and process audits with deterministic finding IDs; with `--change`, an `ObservedWriteScope` scope audit |
| `ngrace cursor show --change C-ID` | Show durable run position (never writes; recovers rather than blocks) |
| `ngrace cursor regenerate --change C-ID [--apply]` | Re-derive `run.xml` from ledger, loose events, and codebase evidence (dry-run by default) |
| `ngrace cursor advance\|pause\|resume\|fold --change C-ID` | Append run events, or fold an epoch into `run-ledger.xml` |
| `ngrace cursor attempt --change C-ID --task T-NNN --outcome pass\|fail` | Record a verification cycle; signature required on fail. Optional `--claimed-confidence` is write-only analysis data no gate reads |
| `ngrace cursor verification-unavailable --change C-ID --task T-NNN --reason <why>` | Record that verification could not run — an absence, not an attempt, and not counted against the fix budget |
| `ngrace context --task T-NNN --change C-ID` | Emit a task slice: the modules, files, and verification that task needs. Selection, never compression |
| `ngrace context --skills [--change C-ID]` | Emit a skill recommendation for the current state. Advisory — the CLI cannot unload a skill from a host |

`MustPassCommand` entries are leaf project evidence such as tests, typecheck, build, format, or package checks. Do not nest `ngrace lint`, `ngrace status`, or another GRACE lifecycle command inside plan assertions; selected target/final lint is the external orchestration gate.

Output modes:

- `ngrace lint`: `text`, `json`
- `ngrace status`: `text`, `json`
- `ngrace doctor`: `text`, `json`
- `ngrace review`: `text`, `json`
- `ngrace gate approve|apply|archive|verdict`: `text`, `json`
- `ngrace context --task|--skills`: `text`, `json`
- `ngrace cursor show|regenerate|advance|attempt|verification-unavailable|pause|resume|fold`: `text`, `json`
- `ngrace module find`: `table`, `json`
- `ngrace module show`: `text`, `json`
- `ngrace verification find`: `table`, `json`
- `ngrace verification show`: `text`, `json`
- `ngrace file show`: `text`, `json`

Lint, status, and projection-backed navigation fail closed: invalid options, invalid grammar, malformed active assertions/scopes, duplicate ownership, missing routed files, or ambiguous targets produce structured results or a nonzero error envelope. JSON command failures emit one stable `{ "schemaVersion": "1.0.0", "ok": false, "error": { ... } }` envelope on stdout; text failures emit one concise actionable line without a stack trace.

## Grep-First Navigation

Prefer this order when narrowing scope:

1. Search `.ngrace/graph/index.xml` for graph document routing.
2. Open routed graph documents for `M-*` and `DF-*` anchors.
3. Search `.ngrace/verification/index.xml` for verification routing.
4. Open routed verification documents for `V-M-*` entries.
5. Search `.ngrace/changes/active/C-*` for in-flight specs and plans.
6. Search source/test files for `LINKS:`, `START_MODULE_CONTRACT`, `START_CONTRACT:`, and `START_BLOCK_`.

Common anchors:

- `GD-*` graph document wrappers
- `M-*` module IDs
- `DF-*` data-flow IDs
- `VD-*` verification document wrappers
- `V-M-*` verification IDs
- `C-*` change bundles
- `T-*` implementation plan tasks
- `AC-*` acceptance criteria (optional under `NgraceChangeSpec` `AcceptanceCriteria`; referenced from plan task `Satisfies`)
- `DT-*` design tokens / `BP-*` breakpoints (optional `design-system.xml`)
- `ST-*` UI states on `UI_COMPONENT` modules (covered by verification Scenario / AccessibilityCheck / VisualCheck)
- `IC-*` interface contracts (Schema, Version, Provider/Consumer, BreakingChangePolicy) in graph documents
- `INV-*` cross-cutting invariants (optional `invariants.xml`)
- `Stack-*` technology stacks under optional `NgraceTechnology/Stacks` (multi-root monorepos)

CLI helpers for scale: `ngrace doctor` (read-only coverage / size pressure) and
`ngrace graph split --by <path-prefix>` (dry-run by default; `--apply` to write).

When a spec declares `AC-*` criteria, each id should be referenced by a task
`<Satisfies>` element. Plan `DurableScope` must cover every `M-*` / `DF-*` in the
spec `AffectedAreas` (or justify omissions under `<OutOfPlanScope>` with a
non-empty `<Reason>`).

## Reliability mechanisms by ceremony tier

Tiers change **depth, never whether gates run**. T0 may not skip honesty or scope recording; it may
skip depth (adversarial probe, mutation audit, checklist volume).

| Mechanism | T0 hotfix | T1 | T2 | T3 | Footprint note |
|---|---|---|---|---|---|
| Honest verdicts / absence values | Full | Full | Full | Full | Always on; not a per-invocation byte switch |
| Scope recording (ObservedWriteScope + `review.scope-outside-write-scope`) | Full | Full | Full | Full | Plan artifact + review finding; no separate amend command ships |
| Run ledger & cursor | Full | Full | Full | Full | See measured CLI rows below |
| Context slices (`ngrace context --task`) | Optional | Default | Default | Default | Measured on polyglot fixture |
| Detached review | Mechanized only | Mechanized + probe | Full | Full + fixpoint | Mechanized = CLI; detachment = **host** (matrix below) |
| Coverage attribution (hunk coverage in review) | — | Optional | Default | Default | Inside `ngrace review`; not a separate binary |
| Doctor / plan-quality / calibration consumers | — | — | Yes | Yes + advisory | Read-only report sections |
| Provenance (authority axis on anchors) | **Not shipped** | **Not shipped** | **Not shipped** | **Not shipped** | Designed; never built on this track — do not read as Full |

**How numbers below were measured (re-run from a clone):**

- Instrument: `src/test-support/token-accounting.ts` (`skillTextLines`, `commandOutputBytes`) — **not
  published on npm** (`package.json#files` excludes `src/test-support/`).
- **Normalization:** drop lines matching `^Root: ` from stdout before counting bytes (absolute path
  length otherwise depends on clone location).
- **Subject:** `examples/polyglot` tree (golden path), state as in the repo (one active approved
  change, one archive without ledger).
- **Stability:** skill-text lines are stable for a commit; CLI stdout for `status` / `doctor` /
  `context --skills` is **state-dependent** (moves when the project’s active bundles or skills
  change). Re-measure after material project changes.

| What | Subject / state | Normalized stdout bytes | Commit |
|---|---|---|---|
| `skillTextLines().total` (16 `SKILL.md`) | package root | **730 lines** (not bytes) | pin in `token-accounting.test.ts` |
| `skillTextLines().referencesTotal` | package root | **1445 lines** (includes recovery.md) | same instrument |
| `ngrace lint --path <polyglot>` | polyglot, clean | **163** | `f641334` (the squashed Phase 11 merge; release cut updates) |
| `ngrace status --path <polyglot>` | polyglot | **761** (state-dependent) | same |
| `ngrace doctor --path <polyglot>` | polyglot | **1907** (state-dependent) | same |
| `ngrace context --task T-001 --change C-ADD-KEYBOARD-NAV` | polyglot | **4012** | same |
| `ngrace context --skills` | polyglot | **2264** (state-dependent) | same |
| `ngrace review --path <polyglot>` | polyglot, green (declarations restored) | **131** | same |

Re-run recipe (from repo root):

```bash
bun -e 'import { skillTextLines } from "./src/test-support/token-accounting.ts";
console.log(skillTextLines());'
# CLI bytes: run the command, strip Root: lines, count utf-8 bytes of remaining stdout.
```

Recovery procedures (unfamiliar code, lost cursor, incomplete epoch):
`skills/ngrace/ngrace-explainer/references/recovery.md`.

## Host capability matrix (conditional guarantees)

Some reliability guarantees depend on the **agent host**, not only on the portable CLI and skills.
Selling them as unconditional would be the confidence-without-check failure this toolkit exists to remove.

| Layer | Owns | Portability |
| --- | --- | --- |
| **CLI (portable)** | Mechanized review (`ngrace review`: pattern detectors, process audits, deterministic finding IDs, corpus scorer), transition gates (`ngrace gate`), lint, ledger, status | Same on every host with Bun |
| **Skills (portable)** | When to call the CLI, judgment checklist, user-facing explanation, verdict vocabulary pointers | Same text everywhere; does not enforce isolation |
| **Host adapters (optional)** | Cold subagent spawn (no implementer transcript), tool-level read-only allowlists, pre-write guards | **Only where the host supports them** |

### What degrades without host support

| Guarantee | With host support | Without (degraded) |
| --- | --- | --- |
| Detached review | Separate instance, cold context, no implementer transcript | Honor system — same agent may self-review |
| Read-only reviewer | Tool allowlist with no write tools (enforced by host) | Instruction-only; a misbehaving agent can still write |
| Apply requires a review verdict | Still required by `ngrace gate apply` (existence of a recorded outcome) | Still required — but the verdict may be `unable-to-determine` with reason `host-capability-missing` when detachment was impossible |

Project policy `gateFailOn` in `.ngrace-lint.json` (`errors` \| `warnings` \| `never`) controls whether a missing or host-capability verdict is fatal at apply. It is never silently green.

Run mechanized detectors anywhere:

```bash
ngrace review --path . --change C-ID
bun run validate:determinism   # two-run identity + corpus no-regression ratchet (D4)
```

Record judgment separately (CLI never pretends a self-review was detached):

```bash
ngrace gate verdict --change C-ID --outcome pass|fail|unable-to-determine [--reason host-capability-missing]
```

## Repository Layout

| Path | Purpose |
| --- | --- |
| `skills/ngrace/*` | Canonical skill sources |
| `plugins/ngrace/skills/ngrace/*` | Packaged mirror used for marketplace distribution |
| `.claude-plugin/marketplace.json` | Marketplace entry and published skill set |
| `plugins/ngrace/.claude-plugin/plugin.json` | Packaged plugin manifest |
| `src/grace.ts` | CLI entrypoint |
| `src/artifact/*` | neo-grace project detection, XML parsing, grammar, projections, assertions, and scopes |
| `src/lint/*` | `ngrace lint` implementation |
| `src/review/*` | `ngrace review` mechanized detectors, scorer, finding IDs |
| `src/gates/*` | `ngrace gate` transition surface, run ledger, and recorded verdicts |
| `src/calibration/*` | Confidence calibration report (`claimedConfidence` is recorded, never gate-consumed) |
| `src/query/*` | Projection-backed query layer for CLI navigation |
| `src/test-support/*` | Fixtures, defect corpus, and token accounting — **not published** (`package.json#files` excludes it) |
| `examples/polyglot/` | Golden-path example, executed by `scripts/validate-walkthrough.ts` |
| `scripts/validate-marketplace.ts` | Packaging, version, path, and mirror validation |
| `scripts/validate-determinism.ts` | D4 determinism + corpus ratchet gate |
| `RELEASING.md` | Manual release checklist and validation commands |

## Development

```bash
bun test
bun run ./scripts/validate-marketplace.ts
bun run validate:packed
bun run validate:release
```

For CLI changes, keep tests in `src/grace-lint.test.ts`, `src/grace-status.test.ts`, and `src/grace-query.test.ts` aligned with the neo-grace `.ngrace` fixture model.

Stable releases use a protected-main two-stage flow. `release:bump` runs on a clean release branch that contains current `origin/main`, updates and validates the version surfaces, commits them, pushes the branch, and finds or creates the release PR without creating a tag. After its required checks pass and the PR is merged, `release:finalize X.Y.Z` runs from clean synchronized `main`, revalidates the exact stable state, creates the annotated tag, and pushes only that tag. CI independently requires the stable tag commit to equal fetched `origin/main` and gates npm `latest` publication through the reviewer-protected `stable-release` environment, whose explicit deployment policies allow only branch `main` and tags `v*`. Protected `main` requires Linux, Windows, and real-Dart checks without requiring a separate PR approval, while an active ruleset keeps `v*` tags immutable. `bun run release:checklist` verifies those controls and, after publication from the exact release tag commit, verifies `HEAD == tag`, npm/GitHub channel metadata, and that the local `npm pack` shasum matches the immutable published tarball.
