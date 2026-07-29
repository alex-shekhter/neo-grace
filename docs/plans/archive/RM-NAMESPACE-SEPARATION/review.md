---
id: RM-NAMESPACE-SEPARATION
kind: context
status: approved
supersededBy: null
created: 2026-07-29
updated: 2026-07-29
baseline: 5.0.1
targets: []
normative: false
plan: ./plan.md
---

# Namespace separation from upstream GRACE — review

> **Explanatory, non-normative.** `plan.md` in this directory is the commitment; this document
> is the reasoning behind it.
>
> Sibling: [RM-AGENT-RELIABILITY](../RM-AGENT-RELIABILITY/review-consolidated.md). Kept separate
> deliberately — that track is reliability work, this is a release-surface rename. Merging them
> would hold one hostage to the other, and `docs/plans/README.md` is explicit that a plan bundle
> archives as a unit.

Evidence tags follow the sibling track's convention: **E2** verified against this repository at
5.0.1 · **E4** reasoned only.

---

## 1. The problem

`neo-grace` is a divergent descendant of upstream GRACE (`@osovv/grace-cli`). The two are now far
enough apart to be different products. They still share a name.

The concrete failure, which is the reason this plan exists: **a user with both installed cannot
tell which implementation answered.** Sixteen skills named `grace-init`, `grace-spec`,
`grace-execute` … exist in both. Even across separate harnesses, the operator has no signal about
which GRACE they are driving — and the two behave differently.

This is not a branding preference. It is an ambiguity that produces confident wrong action, which
is the same failure class the sibling track exists to remove — arriving here through the name
rather than through the evidence.

### 1.1 How much the harness helps, honestly **(E4)**

Claude Code addresses plugin skills as `plugin:skill`, so the plugin name does provide some
namespacing there. That weakens the *technical* collision claim for one harness. It does not
weaken the argument, for two reasons:

- Other targets — Codex, Cursor, generic skill runners — do not share that convention.
- The **human** ambiguity is untouched by any addressing scheme. `grace-execute` reads the same
  in a transcript, a commit message, and a support question, whichever plugin served it.

Recorded as E4 because it rests on reasoning about harness behaviour, not on a measurement.

---

## 2. Findings — the actual surface **(all E2, verified 2026-07-29)**

### F1 — Three layers, not one rename

| Layer | What is in it | Visible to |
|---|---|---|
| **Command** | `package.json#scripts.grace`, `meta.name` in `src/grace.ts:15` | developers of this repo |
| **Harness** | 16 skill `name:` fields, 16 directory names, plugin name `grace`, both manifests, `skills/grace/` and `plugins/grace/` | every user |
| **Artifact** | `.grace/` directory, 13 `Grace*` root tags + 1 companion tag, `GRACE4_VERSION` | every user's repository |

Each layer can move independently. They do not have the same cost, and only the first two are
required to solve §1.

### F2 — The binary emits skill names in its guidance

`src/grace-status.ts` and neighbours contain **11 sites** that print `$grace-migrate`,
`$grace-init`, `$grace-execute`, `$grace-refresh`, `$grace-plan` as next-action advice.

This is a hard coupling, and it is a **correctness** issue rather than a cosmetic one: rename the
skills without updating these strings and `ngrace status` confidently recommends skills that no
longer exist. Silent wrong guidance — precisely the failure mode being designed out elsewhere.

### F3 — `.grace` is not centralized

There is **no** `.grace` path constant. The literal is scattered across `src/grace-status.ts`
(three sites), `src/lint/core.ts`, `src/lint/catalog.ts` (remediation prose),
`src/test-support/fixtures.ts`, and the skills.

This matters for method, not just for effort. A scattered literal makes the rename a
**find-and-replace sweep**, which is unverifiable — you cannot prove you found them all. A
centralized constant makes it a **one-line value change**, which is trivially verifiable.

**Therefore: centralize first, rename second.** Introducing the constants without changing their
values is a behaviour-neutral, fully testable step, and it converts the risky part of this plan
into an ordinary edit.

### F4 — Grammar identity is a claim about someone else's grammar

`GRACE4_VERSION = "4.0"` (`src/grace4/types.ts:2`, 8 references) is validated on every artifact
root tag. It asserts kinship with upstream GRACE 4 — the thing this codebase has diverged from.

It is also deliberately distinct from the product version, and `RM-POLYGLOT-ENFORCEMENT` invariant
6 makes bumping it a signal that something became *required*, shipped with a migration path. So it
cannot be swept along with a product rename; it needs its own decision.

### F5 — Scale

| Surface | Size |
|---|---|
| `Grace*` tag literals in `src/` | 58 |
| `GRACE4_VERSION` references | 8 |
| Skill `name:` fields | 16 (× 2 with the packaged mirror) |
| `$grace-*` in CLI output | 11 |
| "GRACE 4" prose references | ~80 files |

---

## 3. What makes now the right moment

**There are no `neo-grace` projects yet.**

Every objection to this work is a migration cost, and with no installed base every one of them is
zero:

| Concern | With users | Today |
|---|---|---|
| Breaking 16 published skill identifiers | needs a deprecation window | free |
| Moving `.grace/` in every project | needs a migrator | free |
| Renaming 13 root tags | invalidates every artifact | free |
| Fixing the grammar-version claim | version-compat trap | free |

**It will never be this cheap again**, and the cost curve is not linear. New constructs added
before the rename are the *highest-risk* rename surface: nobody has muscle memory for a tag
invented last week, so a sweep that misses it produces no felt wrongness. The sibling track alone
would add a run-ledger root tag, a gate code namespace, and a shared skill reference — all in the
namespace being retired.

That is the argument for doing this **first**, and it is stronger than the general "less tech
debt" framing: the debt this accrues is specifically the *undetectable* kind.

---

## 4. The recommendation

**Separate all three layers**, in the order F3 implies.

| Layer | Move? | Reasoning |
|---|---|---|
| Command | **Yes** | Two names for one command in one repo; `bun run ngrace` currently fails while `CLAUDE.md:48` documents it |
| Harness | **Yes** | This is §1. It is the whole reason the plan exists |
| Artifact | **Yes, recommended** | See §4.1 — but it is the expensive, irreversible half and is gated on explicit ratification |

### 4.1 Why the artifact layer should move too

Two arguments, one of which was not obvious:

**It improves the migration story rather than complicating it.** A user arriving from upstream
GRACE 4 has a `.grace/` directory. If `neo-grace` owns `.ngrace/`, migration has an unambiguous
source and destination and the original is left untouched — which is exactly the promise
`grace-migrate` already makes about GRACE 3 artifacts. Sharing the directory means migration is an
in-place mutation of a *different tool's* state.

**Sharing a directory across diverged grammars produces confident false errors.** Two tools
reading `.grace/` with different grammars will each report the other's valid artifacts as invalid.
Situational — it needs both tools pointed at one repo — but when it bites, the output is
authoritative and wrong.

### 4.2 What should not move

- `src/grace-lint.ts`, `grace-status.ts`, and the other internal modules. The prefix means
  *GRACE's lint*, not *the ngrace binary's lint*. Renaming is churn with no reader.
- `src/grace.ts` as a filename. It is referenced by `package.json#files`, `#bin`, three scripts,
  and **four** sites in `scripts/release-check.ts` including a published-paths list. The gain is
  one filename matching one binary; the blast radius is the release validator.
- The word **GRACE** as the name of the methodology. Graph-RAG Anchored Code Engineering is the
  method; `ngrace` is this implementation's executable. The `n` is a disambiguator, not a rebrand,
  and prose describing the methodology stays correct as-is.

---

## 5. Open questions

### 5.1 Resolved

| # | Question | Resolution | Date |
|---|---|---|---|
| N1 | Does the artifact layer move? | **Yes, ratified.** `.grace/` → `.ngrace/`, `Grace*` root tags → `Ngrace*`. Verified during ratification that there is **no home-directory or global config surface** — every path is project-local, so this affects the project-root directory only | 2026-07-29 |
| N2 | What replaces `GRACE4_VERSION = "4.0"`? | **A fresh grammar version starting at `1.0`.** Not a bump — bumping `"4.0"` → `"5.0"` keeps the false kinship claim and only changes the number. The grammar is ours; its history is not upstream's | 2026-07-29 |
| N3 | Do skill names become `ngrace-*`? | **Yes.** Plugin-level addressing is harness-specific (§1.1) and does nothing for human ambiguity | 2026-07-29 |
| N4 | Version and package identity | **Continue `@neograce/cli`, ship `6.0.0`.** No new package, no version restart, no tag-format change — tags continue `v3.11.0 … v5.0.1 → v6.0.0`. See §5.2 | 2026-07-29 |

### 5.2 Why the product version does not restart

`@neograce/cli` is published at 5.0.1 with bin `ngrace`. Two facts decide this:

**There was never an npm-layer collision.** `@neograce/cli` is already distinct from upstream
`@osovv/grace-cli`. The collision this plan exists to fix lives in the harness and artifact
layers. Renaming the package would solve a problem that does not exist.

**Restarting at 1.0.0 would assert a discontinuity in the product that is not real.** This
codebase is the continuation of what shipped as 5.0.1. What is discontinuous is the skill
namespace and the artifact grammar — not the product. Claiming otherwise is the same
unchecked-assertion failure this project exists to remove, expressed as a version number.

A fresh `1.0.0` would in any case require a **new package name**, since npm versions are
effectively monotonic under a name — publishing `1.0.0` after `5.0.1` does not create a fresh
line, and unpublishing is unavailable after 72 hours. That cost buys only a number.

**Two version numbers now move independently** — product `6.x`, grammar `1.0`. This is not a new
scheme: `RM-POLYGLOT-ENFORCEMENT` invariant 6 already treats the grammar version as deliberately
separate, bumped only when something becomes *required* and shipped with a migration path. This
plan corrects the number in the one that was making a false claim. The relationship must be
documented (plan Phase 4), because two numbers without a note is its own confusion.

### 5.3 Still open

| # | Question | Position |
|---|---|---|
| N5 | Is repo-level coexistence (both tools, one repository) a real scenario? | Unanswered, and now **non-blocking** — N1 is ratified on the §4.1 migration argument alone. It would only have raised urgency, not changed the answer |

---

## 6. Consequences for RM-AGENT-RELIABILITY

Recorded here so the sibling track does not discover them mid-execution:

1. **Its Phase −1 is absorbed.** The local script rename belongs to this plan.
2. **`<GraceRunLedger>` is provisional.** D1–D3 specify a run ledger; its root tag depends on N1.
   The sibling plan must not mint a tag in a namespace that is moving.
3. **Its Phase 1 self-migration would author `.grace/` in this repository.** If N1 is yes, doing
   that first means migrating twice.
4. **`skills/grace/grace-cli/references/verdicts.md`** (D13) lands at a path that moves.

A closing phase of this plan reconciles that document rather than leaving the reliability executor
to find them.

---

## 7. Sources

**Verified against (E2):** `package.json`, `src/grace.ts`, `src/grace4/types.ts`,
`src/grace-status.ts`, `src/lint/core.ts`, `src/lint/catalog.ts`, `src/grace4/paths.ts`,
`scripts/release-check.ts`, `.claude-plugin/marketplace.json`,
`plugins/grace/.claude-plugin/plugin.json`, `skills/grace/*/SKILL.md`, `CLAUDE.md`, at 5.0.1 on
2026-07-29.

**Not verified:** upstream `@osovv/grace-cli`'s current skill set and grammar. The collision is
asserted from the shared ancestry and the maintainer's account, not from a diff against the
upstream package. If the exact overlap matters to a decision, that check is cheap and has not been
done.
