# Implementation Plans

Roadmap-level plans for this repository. **Read this index before starting work.**

## Active

| ID | Title | Status | Baseline | Targets | Plan |
|---|---|---|---|---|---|
| `RM-LANGUAGE-EXTENSIBILITY` | Language bundles, conformance fixtures, and parser strategy | `draft` | 5.0.0 | — | _not written_ — see [review.md](./active/RM-LANGUAGE-EXTENSIBILITY/review.md) |

A row with no `plan.md` is exploration, not a commitment: the explanatory document
exists and nothing has been approved or scheduled. See rule 6.

**No roadmap track is currently approved for execution.** `RM-AGENT-RELIABILITY` completed on
2026-08-01 and is archived (targets `6.1.0` for Phases 2–11; product release actions remain the
maintainer's). `RM-AGENT-RELIABILITY-EVIDENCE` completed on 2026-07-30. Surviving scheduled work
from that track includes the draft change bundle `C-LEDGER-READ-ABSENCE` under
`.ngrace/changes/active/` (not a roadmap plan).

**Execution order (historical).** `RM-NAMESPACE-SEPARATION` ran first and is complete — shipped
2026-07-29 as `@neograce/cli` 6.0.1. `RM-AGENT-RELIABILITY` (with its evidence sibling) followed and
is complete. `RM-LANGUAGE-EXTENSIBILITY` remains exploration only.

The archived reliability track carries `decisions.md` (ratified design decisions D1–D16),
`review-consolidated.md`, and `review.md` beside `plan.md` — one context serving both the evidence
and implementation bundles. See the archive row for links.

## Archive

| ID | Title | Status | Baseline | Targets | Completed | Plan |
|---|---|---|---|---|---|---|
| `RM-AGENT-RELIABILITY` | Context discipline, scope drift, and self-verification | `complete` | 6.0.1 | 6.1.0 | 2026-08-01 | [plan.md](./archive/RM-AGENT-RELIABILITY/plan.md) · [decisions.md](./archive/RM-AGENT-RELIABILITY/decisions.md) · [review-consolidated.md](./archive/RM-AGENT-RELIABILITY/review-consolidated.md) · [review.md](./archive/RM-AGENT-RELIABILITY/review.md) |
| `RM-AGENT-RELIABILITY-EVIDENCE` | Evidence harness and thin `.ngrace` self-migration | `complete` | 6.0.1 | — | 2026-07-30 | [plan.md](./archive/RM-AGENT-RELIABILITY-EVIDENCE/plan.md) |
| `RM-NAMESPACE-SEPARATION` | Separate the `ngrace` namespace from upstream GRACE | `complete` | 5.0.1 | 6.0.1 | 2026-07-29 | [plan.md](./archive/RM-NAMESPACE-SEPARATION/plan.md) · [review.md](./archive/RM-NAMESPACE-SEPARATION/review.md) |
| `RM-POLYGLOT-ENFORCEMENT` | Polyglot enforcement, design layer, and systems modeling | `complete` | 4.0.4 | 4.1.0 · 4.2.0 · 5.0.0 | 2026-07-28 | [plan.md](./archive/RM-POLYGLOT-ENFORCEMENT/plan.md) |

---

## What lives here

This directory holds **roadmap plans**: multi-release, narrative, human-approved documents
that explain what is being built and in what order.

It does **not** hold per-change execution artifacts. Those are GRACE change bundles
(`spec.xml` + `plan.xml`) under `.ngrace/changes/`, are machine-validated by `ngrace lint`,
and must never be duplicated as markdown here.

```
Roadmap plan  →  why, and in what order        (docs/plans/, human-approved)
  └─ C-*      →  one unit of work, gated       (.ngrace/changes/, machine-checkable)
```

A `C-*` spec should name the roadmap plan and phase it implements, so the rationale
survives the bundle being archived.

> **Note.** This repository hosts a thin `.ngrace` tree for dogfooding (see `CLAUDE.md`).
> Roadmap plans under `docs/plans/` remain the human-approved long-range surface; per-change
> execution artifacts live under `.ngrace/changes/` when active.

## Layout

```
docs/plans/
  README.md                      this index
  active/<RM-SLUG>/
    plan.md                      normative: phases, steps, verification
    review.md                    explanatory: why the plan exists, evidence
    sources/                     optional: raw inputs that review.md cites
  archive/<RM-SLUG>/             completed, superseded, or cancelled
```

`plan.md` : `review.md` is the same relationship as `plan.xml` : `design-context.xml`
in a GRACE change bundle — one normative, one explanatory, archived together as a unit.

## Rules

1. **Never edit anything under `archive/`.** Archived plans are history.
2. **Status lives in two places and they must agree** — the frontmatter `status` field
   and the `active/` vs `archive/` directory. This mirrors how `ngrace lint` validates a
   change bundle's location against its declared status.
3. **Superseding, not rewriting.** When a plan is replaced, set `status: superseded`,
   set `supersededBy` to the replacing plan's `id`, and `git mv` it to `archive/`.
   Do not delete it and do not silently rewrite an approved plan — the same immutability
   rule GRACE applies to approved change plans.
4. **Update this index in the same commit** that adds, promotes, or archives a plan.
5. **Phase status lives inside the plan**, in its own status board. This index tracks the
   plan as a whole; the plan tracks its phases.
6. **`review.md` may exist without `plan.md`.** That combination means exploration:
   the reasoning is recorded, nothing is approved, and no work is scheduled. Such a
   document is non-normative and must say so. Writing the `plan.md` is the act that
   turns it into a commitment.
7. **Do not specify a phase in step detail before the evidence it assumes exists.** A roadmap plan
   spans releases, so its later phases are written against a codebase and measurements that do not
   exist yet — and step-level detail written that far ahead reads as specified when it is speculative.
   State those phases as objectives, decisions delivered, and review gates; write their steps when
   their preconditions land, and record what changed. Mark provisional detail as provisional in the
   plan itself, so nobody has to infer it.

   **This is a roadmap-plan rule only.** Change bundles under `.ngrace/changes/` are short-lived and
   do not suffer this, so the same ceremony there would be cost without benefit. `RM-AGENT-RELIABILITY`
   was split in two on 2026-07-29 for exactly this reason: ten of its phases had been specified against
   a measurement format and a `.ngrace` tree that its first two phases produce.

## Frontmatter

Every `plan.md` carries:

```yaml
---
id: RM-<SLUG>              # uppercase kebab, matches the directory name
kind: plan                 # plan | context
status: draft              # draft | approved | superseded | cancelled
supersededBy: null         # required (non-null) when status is superseded
created: YYYY-MM-DD
updated: YYYY-MM-DD
baseline: <version>        # the released version the plan was written against
targets: [<version>, ...]  # releases the plan delivers into
context: ./review.md       # optional pointer to the explanatory companion
---
```

Status values reuse GRACE's own change-status vocabulary rather than inventing a
second one. `RM-*` is a filename convention chosen to be greppable alongside GRACE
anchors — it is deliberately **not** a registered semantic anchor family, and it does
not appear in `ANCHOR_PATTERNS`.

## Naming

`RM-<UPPERCASE-KEBAB-SLUG>` — no date prefix. Dates rot when work slips and git already
records them; `created`/`updated` in the frontmatter carry that information. This matches
`C-*` bundle naming, which is also undated.
