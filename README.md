# GRACE Marketplace and CLI

**GRACE** means **Graph-RAG Anchored Code Engineering**: a contract-first AI engineering methodology built around semantic markup, `.grace` XML artifacts, knowledge-graph navigation, assertions, scopes, and log-driven verification.

This repository ships the GRACE skills and the `ngrace` CLI they depend on. It is a packaging and distribution repository, not an end-user application.

> **`neo-grace` is a fork of [osovv/grace-marketplace](https://github.com/osovv/grace-marketplace),
> implementing the GRACE methodology by Vladimir Ivanov.** Version numbering continues
> upstream's, and changelog entries at 4.0.4 and below describe work done there.
> See **[LINEAGE.md](./LINEAGE.md)** for full credits.

Current packaged version: `5.0.1-rc.0`

## New to GRACE? Start Here

| Start | Time | What it is |
|---|---|---|
| [**Visual introduction**](./docs/grace-explainer.html) | 5 min | Why GRACE exists and how the pieces relate. Open the file in a browser — it is self-contained. |
| [**Twenty-minute walkthrough**](./examples/polyglot/WALKTHROUGH.md) | 20 min | A guided tour of a real React + Go + Rust project. You break it on purpose four times and watch the tooling catch you. |
| `ngrace doctor --path .` | 1 min | Run against your own repository first. Reports which of your languages have export verification before you commit to anything. |

You never hand-author the XML — the skills write it and you approve it. Both documents are written from that side of the screen.

## What This Repository Ships

- Canonical GRACE skills in `skills/grace/*`
- Packaged Claude marketplace mirror in `plugins/grace/skills/grace/*`
- Marketplace metadata in `.claude-plugin/marketplace.json`
- Packaged plugin manifest in `plugins/grace/.claude-plugin/plugin.json`
- OpenPackage metadata in `openpackage.yml`
- Required Bun-powered CLI package `neo-grace`

## GRACE 4 Model

GRACE 4 uses `.grace` as the durable project model:

| Area | Purpose |
| --- | --- |
| `.grace/context/*.xml` | Requirements, technology (optional multi-stack `Stacks`), principles, deployment, and UX constraints |
| `.grace/context/design-system.xml` | Optional design tokens (`DT-*`), breakpoints (`BP-*`), and a11y standards |
| `.grace/context/invariants.xml` | Optional cross-cutting invariants (`INV-*`) referenced by `MustUphold` |
| `.grace/graph/index.xml` + routed graph docs | Current graph projection for `GD-*`, `M-*`, `DF-*`, and `IC-*` anchors |
| `.grace/verification/index.xml` + routed verification docs | Current verification projection source for deterministic `V-M-*` entries |
| `.grace/changes/active/C-*` | Active `GraceChangeSpec` (optional `DesignReferences`), design context, and `GraceChangePlan` |
| `.grace/changes/archive/C-*` | Applied, rejected, cancelled, or superseded change bundles |
| Source/test files with GRACE markup | File-local contracts, links, and semantic block anchors |
| `examples/polyglot/` | Golden-path React + Go + Rust monorepo (CI-linted; see its [walkthrough](./examples/polyglot/WALKTHROUGH.md)) |

GRACE 4 does not dual-validate legacy GRACE 3 project docs as current state. Existing GRACE 3 projects use `$grace-migrate`; the CLI validates the generated `.grace` result but does not convert legacy docs itself.

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

**`CODE_EXTENSIONS` is a file-discovery list, not a support matrix.** A file's extension appearing there means GRACE will find and govern the file — not that GRACE can verify its `MODULE_MAP`. Languages without an export adapter emit `analysis.no-adapter` when `MAP_MODE` claims EXPORTS/LOCALS parity; acknowledge deliberately with `.grace-lint.json` `{ "unverifiedLanguages": [".rs", ".go"] }`.

**Governing a language GRACE does not ship.** Declare its extensions in `.grace-lint.json` — no fork required:

```json
{ "codeExtensions": [".ex", ".exs"], "unverifiedLanguages": [".ex", ".exs"] }
```

`codeExtensions` is additive to the built-in set, so it can add governance for a language but never remove it for another. Those files then get module contracts, `LINKS:`, semantic blocks, health, and drift detection. Export verification still requires an adapter, which is why the second key is there: it acknowledges that `MODULE_MAP` parity is unverified for those files rather than pretending it was checked. Run `ngrace doctor` to see which of your languages are adapter-backed.

## Install

**The CLI is required, not optional.** Install the skills first, then the CLI — both are needed for a working GRACE setup.

The skills can author `.grace` artifacts without it, but nothing validates them: XML well-formedness, required sections, anchor discipline, path containment, and every cross-artifact reference are checked by `ngrace lint`. The execute lifecycle is defined in terms of it — `--assertions baseline`, `target`, and `final` are the gates, and there is no gate without the binary. Skills plus no CLI is an unenforced methodology, which is the thing GRACE exists to replace.

### OpenPackage

```bash
opkg install gh@alex-shekhter/neo-grace
opkg install gh@alex-shekhter/neo-grace -g
opkg install gh@alex-shekhter/neo-grace --platforms claude-code
```

### Claude Code Marketplace

```bash
/plugin marketplace add alex-shekhter/neo-grace
/plugin install grace@neo-grace
```

### Agent Skills-Compatible Install

```bash
git clone https://github.com/alex-shekhter/neo-grace
cp -r neo-grace/skills/grace/grace-* /path/to/your/agent/skills/
```

### CLI

Requires `bun` on `PATH`. GRACE skills invoke the installed stable `ngrace` binary directly; they do not default to `bunx`, `npx`, or a prerelease dist-tag.

```bash
# Install the current stable release from npm `latest`
bun add -g @neograce/cli
ngrace --version
ngrace lint --path /path/to/grace4-project
```

## GRACE 4 Quick Start

For a new GRACE 4 project:

1. Run `$grace-init` to create `.grace`.
2. Fill `.grace/context` artifacts with your agent.
3. Run `$grace-spec` for a change.
4. Run `$grace-plan` after spec approval.
5. Before observed writes begin, run the active-baseline preflight: `ngrace lint --path /path/to/project --assertions current`.
6. Run `ngrace lint --path /path/to/project --change C-ID --assertions baseline` before execution; add `--run-commands` when the baseline declares `MustPassCommand`.
7. Run `ngrace status --path /path/to/project --json`.
8. Run `$grace-execute` and choose sequential or parallel-safe mode. Parallel-safe mode additionally requires `ngrace lint --path /path/to/project --parallel-preflight`.
9. Before apply/archive, run `ngrace lint --path /path/to/project --change C-ID --assertions final`; add `--run-commands` when the target declares `MustPassCommand`.

Existing GRACE 3 projects should run `$grace-migrate` and review the migration report before writing `.grace` artifacts.

Migration cleanup is separately gated: successful current lint, fresh status proving GRACE 4 with no integrity errors, git/worktree inspection, exact cleanup paths, and explicit cleanup confirmation are mandatory. Dirty or non-git cleanup requires an additional acknowledgement naming that risk; any cleanup failure stops without automatic destructive retry.

## Skills Overview

| Skill | Purpose |
| --- | --- |
| `grace-init` | Bootstrap the `.grace` skeleton, templates, and agent guidance |
| `grace-spec` | Create an approved GRACE 4 change spec and optional design context |
| `grace-plan` | Design assertions, scopes, tasks, and verification gates from an approved spec |
| `grace-execute` | Execute the approved plan in sequential or parallel-safe mode |
| `grace-refactor` | Rename, move, split, merge, and extract modules without artifact drift |
| `grace-setup-subagents` | Scaffold GRACE worker and reviewer presets |
| `grace-fix` | Debug issues from graph, contracts, tests, traces, and semantic blocks |
| `grace-refresh` | Detect drift and propose reconciliation changes |
| `grace-status` | Report `.grace` health and suggest the next safe action |
| `grace-ask` | Answer architecture and implementation questions from `.grace` artifacts |
| `grace-cli` | Operate the required `ngrace` binary as the lint, gate, and artifact-query layer |
| `grace-explainer` | Explain the GRACE methodology itself |
| `grace-verification` | Build and maintain `.grace/verification` entries and evidence |
| `grace-reviewer` | Review semantic integrity, projections, scopes, and verification quality |
| `grace-migrate` | Agent-applied GRACE 3 to GRACE 4 migration with CLI validation |

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

`MustPassCommand` entries are leaf project evidence such as tests, typecheck, build, format, or package checks. Do not nest `ngrace lint`, `ngrace status`, or another GRACE lifecycle command inside plan assertions; selected target/final lint is the external orchestration gate.

Output modes:

- `ngrace lint`: `text`, `json`
- `ngrace status`: `text`, `json`
- `ngrace module find`: `table`, `json`
- `ngrace module show`: `text`, `json`
- `ngrace verification find`: `table`, `json`
- `ngrace verification show`: `text`, `json`
- `ngrace file show`: `text`, `json`

Lint, status, and projection-backed navigation fail closed: invalid options, invalid grammar, malformed active assertions/scopes, duplicate ownership, missing routed files, or ambiguous targets produce structured results or a nonzero error envelope. JSON command failures emit one stable `{ "schemaVersion": "1.0.0", "ok": false, "error": { ... } }` envelope on stdout; text failures emit one concise actionable line without a stack trace.

## Grep-First Navigation

Prefer this order when narrowing scope:

1. Search `.grace/graph/index.xml` for graph document routing.
2. Open routed graph documents for `M-*` and `DF-*` anchors.
3. Search `.grace/verification/index.xml` for verification routing.
4. Open routed verification documents for `V-M-*` entries.
5. Search `.grace/changes/active/C-*` for in-flight specs and plans.
6. Search source/test files for `LINKS:`, `START_MODULE_CONTRACT`, `START_CONTRACT:`, and `START_BLOCK_`.

Common anchors:

- `GD-*` graph document wrappers
- `M-*` module IDs
- `DF-*` data-flow IDs
- `VD-*` verification document wrappers
- `V-M-*` verification IDs
- `C-*` change bundles
- `T-*` implementation plan tasks
- `AC-*` acceptance criteria (optional under `GraceChangeSpec` `AcceptanceCriteria`; referenced from plan task `Satisfies`)
- `DT-*` design tokens / `BP-*` breakpoints (optional `design-system.xml`)
- `ST-*` UI states on `UI_COMPONENT` modules (covered by verification Scenario / AccessibilityCheck / VisualCheck)
- `IC-*` interface contracts (Schema, Version, Provider/Consumer, BreakingChangePolicy) in graph documents
- `INV-*` cross-cutting invariants (optional `invariants.xml`)
- `Stack-*` technology stacks under optional `GraceTechnology/Stacks` (multi-root monorepos)

CLI helpers for scale: `ngrace doctor` (read-only coverage / size pressure) and
`ngrace graph split --by <path-prefix>` (dry-run by default; `--apply` to write).

When a spec declares `AC-*` criteria, each id should be referenced by a task
`<Satisfies>` element. Plan `DurableScope` must cover every `M-*` / `DF-*` in the
spec `AffectedAreas` (or justify omissions under `<OutOfPlanScope>` with a
non-empty `<Reason>`).

## Repository Layout

| Path | Purpose |
| --- | --- |
| `skills/grace/*` | Canonical skill sources |
| `plugins/grace/skills/grace/*` | Packaged mirror used for marketplace distribution |
| `.claude-plugin/marketplace.json` | Marketplace entry and published skill set |
| `plugins/grace/.claude-plugin/plugin.json` | Packaged plugin manifest |
| `src/grace.ts` | CLI entrypoint |
| `src/grace4/*` | GRACE 4 project detection, XML parsing, grammar, projections, assertions, and scopes |
| `src/lint/*` | `ngrace lint` implementation |
| `src/query/*` | Projection-backed query layer for CLI navigation |
| `scripts/validate-marketplace.ts` | Packaging, version, path, and mirror validation |
| `RELEASING.md` | Manual release checklist and validation commands |

## Development

```bash
bun test
bun run ./scripts/validate-marketplace.ts
bun run validate:packed
bun run validate:release
```

For CLI changes, keep tests in `src/grace-lint.test.ts`, `src/grace-status.test.ts`, and `src/grace-query.test.ts` aligned with the GRACE 4 `.grace` fixture model.

Stable releases use a protected-main two-stage flow. `release:bump` runs on a clean release branch that contains current `origin/main`, updates and validates the version surfaces, commits them, pushes the branch, and finds or creates the release PR without creating a tag. After its required checks pass and the PR is merged, `release:finalize X.Y.Z` runs from clean synchronized `main`, revalidates the exact stable state, creates the annotated tag, and pushes only that tag. CI independently requires the stable tag commit to equal fetched `origin/main` and gates npm `latest` publication through the reviewer-protected `stable-release` environment, whose explicit deployment policies allow only branch `main` and tags `v*`. Protected `main` requires Linux, Windows, and real-Dart checks without requiring a separate PR approval, while an active ruleset keeps `v*` tags immutable. `bun run release:checklist` verifies those controls and, after publication from the exact release tag commit, verifies `HEAD == tag`, npm/GitHub channel metadata, and that the local `npm pack` shasum matches the immutable published tarball.
