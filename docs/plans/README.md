# Implementation Plans

Roadmap-level plans for this repository. **Read this index before starting work.**

## Active

_None._

## Archive

| ID | Title | Status | Baseline | Targets | Completed | Plan |
|---|---|---|---|---|---|---|
| `RM-POLYGLOT-ENFORCEMENT` | Polyglot enforcement, design layer, and systems modeling | `complete` | 4.0.4 | 4.1.0 · 4.2.0 · 5.0.0 | 2026-07-28 | [plan.md](./archive/RM-POLYGLOT-ENFORCEMENT/plan.md) |

---

## What lives here

This directory holds **roadmap plans**: multi-release, narrative, human-approved documents
that explain what is being built and in what order.

It does **not** hold per-change execution artifacts. Those are GRACE change bundles
(`spec.xml` + `plan.xml`) under `.grace/changes/`, are machine-validated by `grace lint`,
and must never be duplicated as markdown here.

```
Roadmap plan  →  why, and in what order        (docs/plans/, human-approved)
  └─ C-*      →  one unit of work, gated       (.grace/changes/, machine-checkable)
```

A `C-*` spec should name the roadmap plan and phase it implements, so the rationale
survives the bundle being archived.

> **Note.** This repository does not yet contain its own `.grace` state — see `CLAUDE.md`.
> Until a self-migration is approved, roadmap plans are the only planning artifacts here.

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
   and the `active/` vs `archive/` directory. This mirrors how `grace lint` validates a
   change bundle's location against its declared status.
3. **Superseding, not rewriting.** When a plan is replaced, set `status: superseded`,
   set `supersededBy` to the replacing plan's `id`, and `git mv` it to `archive/`.
   Do not delete it and do not silently rewrite an approved plan — the same immutability
   rule GRACE applies to approved change plans.
4. **Update this index in the same commit** that adds, promotes, or archives a plan.
5. **Phase status lives inside the plan**, in its own status board. This index tracks the
   plan as a whole; the plan tracks its phases.

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
