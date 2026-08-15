# Implementation Plans

Roadmap-level plans for this repository. **Read this index before starting work.**

## Active

| ID | Title | Status | Baseline | Targets | Plan |
|---|---|---|---|---|---|
| `RM-GOVERNED-PATH` | Make the governed path the path of least resistance | `approved` | 6.1.1 | 6.2.0 · 6.3.0 · 6.4.0 _(provisional)_ | [plan.md](./active/RM-GOVERNED-PATH/plan.md) · [decisions.md](./active/RM-GOVERNED-PATH/decisions.md) · [review.md](./active/RM-GOVERNED-PATH/review.md) |
| `RM-LANGUAGE-EXTENSIBILITY` | Language bundles, conformance fixtures, and parser strategy | `draft` | 5.0.0 | — | _not written_ — see [review.md](./active/RM-LANGUAGE-EXTENSIBILITY/review.md) |
| `RM-GITLESS-INTEGRITY` | Gitless artifact integrity: what the tool knows about what it approved | `draft` | — | — | _not written_ — see [review.md](./active/RM-GITLESS-INTEGRITY/review.md) |
| `RM-VERIFIED-APPROVAL` | Verified approval: making ratification something the agent cannot assert | `draft` | — | — | _not written_ — see [review.md](./active/RM-VERIFIED-APPROVAL/review.md) |
| `RM-DESIGN-EVIDENCE` | Design evidence an agent can actually use: visual references, recordings, and the behaviour text that carries them | `draft` | — | — | _not written_ — see [review.md](./active/RM-DESIGN-EVIDENCE/review.md) |

A row with no `plan.md` is exploration, not a commitment: the explanatory document
exists and nothing has been approved or scheduled. See rule 6.

**`RM-GOVERNED-PATH` is approved for execution as of 2026-08-09** — seven ratified decisions
(D1–D7 in `decisions.md`), no open questions, baseline `6.1.1` at `f340a98`. Its release targets stay
provisional; a release commitment is a separate act per phase. Each phase begins with a derivation
pass against HEAD before any `C-*` bundle is authored — see the plan's header.

`RM-AGENT-RELIABILITY` completed on
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

## Backlog

Recorded, not scheduled. Each has an explanatory `review.md` and **no `plan.md`** — per rule 6 that
means exploration, not a commitment. They are independent of each other and of one another's
sequencing; nothing here is blocked by anything else on this page.

### `RM-VERIFIED-APPROVAL` — recorded 2026-08-14

Two independent models adopting GRACE on a real repository each wrote `status="approved"` onto the
spec they had just authored, in the same commit, without asking (F88). A third run, on a prompt that
named a reachable human and forbade self-approval, asked and waited (F88.2). `gate approve`
deliberately does not write `status`, so for an autonomous agent the approved state that gates
`plan new` and `gate apply` is a self-certification the product cannot distinguish from human
ratification.

Records why the cheap answers fail — anywhere the agent can write, it can forge; a blockchain
faithfully records whatever was submitted; a prompt only governs agents already willing to ask — and
the shape that works: **a service the agent cannot write to, issuing one-time codes to the human
bound to a fingerprint of the artifact.** That moves approval from tamper-evident to **verifiable**.
Constraints that decide whether it holds are recorded with it, including that **the detection half is
still required** — the first two measured runs bypassed the request entirely, so codes alone would
not have caught them. The third run asked; the product still cannot tell that ask from a typed
`approved`.

**Not scheduled.** The repo-local floor ships first regardless: `gate approve` writing status with a
fingerprint, and lint reporting `approved` without a matching record.

### `RM-DESIGN-EVIDENCE` — recorded 2026-08-13

An agent implementing a UI change has no governed way to be handed a picture. `<DesignReferences>`
admits exactly `<Figma url>` and `<UserResearch>`, so mocks, sketches, screenshots and recordings
have no home — and **`ngrace context` does not carry `DesignReferences` into the task slice at all**,
so even those two never reach the executing agent.

Two design decisions are recorded ahead of any spec. **Tags name the role, never the vendor**:
`<Figma>` hardcodes one product into the grammar, open-source tools are unbounded, and a grammar that
enumerates vendors guarantees drift. **A reference the agent cannot read must carry a text
description of the behaviour**, and that description is what the slice delivers — otherwise a video
tag claims more than any tool can consume (F10).

**Not scheduled**: `RM-GOVERNED-PATH` P1 still owes steps 6–8 against 6.3.0, and this is new scope
against a committed phase. Not blocked by anything, and it has no dependency on P1's remainder.

### `RM-GITLESS-INTEGRITY` — recorded 2026-08-10

`gate approve` records no fingerprint of the artifact it approved, so integrity depends on git and
cannot survive an edit-and-commit. **Not scheduled before the release after `RM-GOVERNED-PATH`'s next
target**, and it must replace `approved-contract-drift`'s git reading rather than run beside it — two
surfaces answering the same question from two sources is the defect `C-REPORT-HONESTY` exists to
remove.

**First worked instance, 2026-08-12 — no contrivance required.** `C-EXPLAIN-COVERAGE`'s plan was
approved, `gate approve` recorded `permit` into `run-ledger.xml`, and the plan was then edited to
repair four assertion subjects (F40). Re-running the gate appended a **second** `<Decision>` that is
byte-identical to the first — no timestamp, no artifact digest, only `gate`, `decision` and the
requirement list:

```xml
<Decision gate="approve" decision="permit"><Requirement id="no-unresolved-ic-inv-clarification" … /></Decision>
<Decision gate="approve" decision="permit"><Requirement id="no-unresolved-ic-inv-clarification" … /></Decision>
```

So the ledger cannot distinguish the approval of the pre-repair plan from the approval of the
repaired one, and a reader cannot order them. The edit was legitimate and the re-run was
voluntary — which is the point: the gap is invisible inside one bundle's ordinary lifecycle, so it
will not announce itself when it matters.

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
