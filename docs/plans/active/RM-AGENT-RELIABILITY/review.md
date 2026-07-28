---
id: RM-AGENT-RELIABILITY
kind: context
status: draft
supersededBy: null
created: 2026-07-28
updated: 2026-07-28
baseline: 5.0.0
targets: []
normative: false
plan: null
---

# Agent reliability: context discipline, scope drift, and self-verification

> **Status: exploration, not a commitment.** There is no `plan.md` for this document yet
> and no phase has been approved. Nothing here is normative. It exists to record the
> reasoning while it is fresh, so that a future `plan.md` can be argued from evidence
> rather than re-derived from memory.
>
> Sibling document: [RM-LANGUAGE-EXTENSIBILITY](../RM-LANGUAGE-EXTENSIBILITY/review.md)
> covers the tool's own extension model — who can add a language and what it costs. This
> one covers the agent operating on GRACE artifacts. Kept separate because they argue from
> different evidence and will finish at different times.

## 1. Why this document exists

GRACE 5.0.0 made the *artifacts* trustworthy. Language claims are honest, plans must
cover their specs, interface contracts have owners and versions, UI states have evidence.

It did not address the other half of the problem: **the agent operating on those
artifacts is unreliable in specific, repeatable ways.** This document proposes work
aimed at the agent, not the model of the codebase.

The evidence base is the RM-POLYGLOT-ENFORCEMENT execution itself, where a capable
implementation agent produced nineteen defects across nine phases, every one of them
shipping with a green test suite and a confident report. That is an unusually clean
dataset: same executor, same plan, nine sequential samples, every defect diagnosed and
recorded in [RM-POLYGLOT-ENFORCEMENT §10.1a](../../archive/RM-POLYGLOT-ENFORCEMENT/plan.md).

## 2. What the nineteen defects actually taught us

Five patterns recurred. They are the design constraints for everything in §3.

| # | Pattern | Instances | Implication |
|---|---|---|---|
| 1 | **Confidently wrong beats honestly unsure** — asserting a fact that was never checked, at `exact` confidence or as a hard error | 6 | Self-reported confidence is worthless as a signal. It correlates with fluency, not correctness. |
| 2 | **A comparison where one side is derived from the thing under test proves nothing** | 2 (defects 5, 15) | Round-trip tests, symmetric fixtures, and "compare the output to the output" all pass while the code is broken. |
| 3 | **A guard written as a regex over structured text is a guard you do not have** | 3 (defects 4, 9, 11) | Where the input has structure — XML, source, a regex — scan the structure. |
| 4 | **Zero-or-more anchor lists silently swallow malformed children** | 2 (defects 7, 14) | Cardinality checks cannot protect a list that is allowed to be empty. |
| 5 | **New constructs are not threaded back through earlier guarantees** | 1 (defect 12) | Invisible by construction: every existing test still passes, because the guarantee was never expressed for the new family. |

Two meta-observations matter more than the individual patterns:

**Concrete failures outperform abstract rules.** The plan carried both an anti-pattern
list (§10.4, rules) and a defect log (§10.1a, worked failures with consequences). The
defect log was visibly more effective — by Phase 8 the executor was applying lessons
from it unprompted, including ones nobody asked it to apply.

**Fresh-context review is why the defects were found.** The reviewer had the plan and
the diff but not the implementer's reasoning. Detachment from the implementation was
the operative property, not superior skill.

## 3. Proposals

Each proposal states the problem it solves, why GRACE specifically is positioned to
solve it, and an honest confidence level.

---

### 3.1 Task-scoped context slices — `grace context --task T-001`

**Confidence: high. Highest leverage item in this document.**

**Problem.** An agent starting task four of a plan is carrying the whole graph, the
whole plan, and three tasks of accumulated conversation. Relevant detail is diluted by
irrelevant detail. This is not a model defect that better prompting fixes; it is a
working-set problem.

**Proposal.** A command that emits the minimal artifact slice a task needs:

```
grace context --task T-001
  → the M-* anchors the task names, and only those
  → their IC-* contracts and V-M-* verification entries
  → the AC-* the task Satisfies
  → nothing else
```

**Why GRACE.** This is the payoff for having built a graph. No other methodology in
this space can compute a minimal relevant slice, because none of them has a machine-
readable model of what relates to what. GRACE already has `Satisfies`, `DurableScope`,
`Owns`, and `LINKS:` — the edges needed to compute the slice all exist today.

**Supporting evidence.** During RM-POLYGLOT-ENFORCEMENT the executor was told, at one
point, to re-read only three named sections of a ~2,900-line plan rather than the whole
document. The phase that followed was the cleanest of the run. That is one data point
and should not be oversold, but it is consistent with the dilution hypothesis.

**Related, cheap:** a re-anchoring checkpoint that restates the task's acceptance
criteria before work begins. Drift is gradual; restatement is the cheapest correction.

---

### 3.2 Scope-drift interrupt and append-only `<ScopeAmendment>`

**Confidence: high. Closes the one hole with no coverage at all today.**

**Problem.** The user approves a spec for keyboard navigation. Four messages later:
*"while you're in there, fix the date formatting."* The agent complies. Nothing catches
this — the spec→plan coverage check sees consistent artifacts, because only the code
drifted. The user's own deviation propagates into the agent, and the change bundle
becomes a lie about what happened.

**Proposal, two parts.**

1. **Live interrupt.** `ObservedWriteScope` already declares which files a plan may
   touch. Today it is checked after the fact. Make it a stop condition *during*
   execution: when the agent is about to write outside declared scope, it halts and
   names three options — amend the spec, open a new `C-*`, or record out-of-scope debt.
   Never silently absorb.

2. **A lightweight, sanctioned amendment path.** Today the only way to change scope
   mid-flight is superseding the whole bundle. That is heavyweight, and **a
   heavyweight-only path guarantees people route around it** — the same reasoning that
   produced ceremony tiers in Phase 9. Proposal: an **append-only** `<ScopeAmendment>`
   carrying a reason, a timestamp, and user approval. Append-only preserves approved-plan
   immutability while giving drift a legitimate destination.

**The reframe that matters.** User deviation is not a failure to prevent. Users
legitimately change their minds mid-task, and a methodology that treats that as an error
will be abandoned at the first inconvenience. What is corrosive is scope changing with
*no trace*. Record the event; do not forbid it.

---

### 3.3 Self-review as a skill, with the mechanizable parts mechanized

**Confidence: high on the mechanization, medium on `grace mutate` specifically.**

**Problem.** The five-audit self-review protocol (`§0.7`) demonstrably worked — from
Phase 7 onward the executor was pinning its own zero-failure mutation rows before
reporting. But it is *text inside one plan document*, so it dies with that plan, and it
is an honor system, which is precisely what GRACE exists to replace elsewhere.

**Proposal.** Split it by what can be checked mechanically:

| §0.7 audit | Disposition |
|---|---|
| Scope audit | **Mechanize.** `git diff --name-only` vs the plan's `ObservedWriteScope` — the concept already exists, it is simply not enforced live. |
| Test weakening | **Mechanize.** Diff test files; flag removed or loosened assertions. Caught by hand twice during review; trivially automatable. |
| Mutation check | **Mechanize** as `grace mutate --change C-X`: revert each hunk alone, run that module's verification commands, report which hunks no test defends. |
| Backward-compat sweep | **Mechanize.** Lint every fixture before and after; diff the issue-code sets. |
| Adversarial probe | **Keep as skill guidance.** This is judgment and cannot be automated. |
| Anti-pattern audit | **Keep as skill guidance**, but drive it from a defect log, not a rule list (§2). |

**The governing principle:** *anything in the self-review that an agent can skip and
lie about should become a command that emits evidence.* GRACE's thesis is log-driven
verification; its own review protocol should obey the rule it preaches.

**Structural requirement.** The reviewing agent must be a **separate instance that does
not receive the implementer's transcript** — only the plan and the diff. Folding
self-review into `grace-execute` would destroy the exact property (detachment) that made
it effective. This argues for a distinct skill, invoked after execute, not a section
inside it.

---

### 3.4 Provenance on every recorded fact

**Confidence: medium-high. Cheap to build, compounding value.**

**Problem.** An inference made in week one is indistinguishable from a verified fact by
week six. Agents treat everything in `.grace` as ground truth, so hallucinations harden
rather than decay.

**Proposal.** Generalize the `exportConfidence: exact | heuristic` field already built
for the language adapters. Every claim in `.grace` records how it was established:

- `user-stated` — the human said it
- `tool-verified` — a command or parser confirmed it
- `agent-inferred` — the agent guessed from context and nobody confirmed

Then `grace doctor` can report: *"41% of your graph is agent-inferred and never
confirmed."* That is a directly actionable hallucination metric, and it turns an
invisible risk into a number that can be driven down.

**Adjacent idea, unranked:** graph claims have no freshness. Verification evidence
carries timestamps; a module `<Summary>` written eight months ago and never re-checked
does not. Staleness is a hallucination source with no current visibility.

---

### 3.5 Interview-driven init, grounded in compilability rather than confidence

**Confidence: medium. Valuable, but benefits from 3.4 existing first.**

**Design note on the original framing.** The proposal that motivated this section was to
have the agent ask follow-up questions when its perplexity indicates uncertainty. Two
issues, one terminological and one substantive:

- *High* perplexity indicates uncertainty; low perplexity indicates confidence. Minor.
- More importantly, **a coding agent in a harness like Claude Code has no access to
  token logprobs**, and self-reported confidence is badly calibrated — see §2 pattern 1,
  where every one of nineteen defects arrived with a confident report. Building an
  interview mechanism on introspected certainty builds it on sand.

**Proposal — a non-introspective uncertainty signal that GRACE already implies:**

> **Can the answer be compiled into a check that could fail?**

| Answer | Compiles to | Verdict |
|---|---|---|
| "We use Postgres" | `MustExist` on migrations; `MustPassCommand` on a connection test | Accept |
| "Performance matters" | nothing | Ask again |
| "Keyboard nav should feel natural" | nothing | Ask again |
| "Arrow keys move focus; Home/End jump to first/last row" | `AC-KEYBOARD-NAV` | Accept |

This never lies, requires no model introspection, and is the discipline GRACE already
enforces at the assertion layer — moved earlier, into the interview.

**Two supporting rules:**

- **Read the repository before asking.** Detect → propose → confirm, not ask → hope.
  Asking "what language do you use?" beside a `Cargo.toml` teaches the user that the
  interview is theatre, after which they answer carelessly and the artifacts get worse.
  Ask only what is genuinely unknowable from the tree: intent, constraints, non-goals,
  risk tolerance.
- **Record the interview's provenance** (§3.4). Which statements were confirmed verbatim,
  which were inferred, which were guessed.

---

### 3.6 Context hygiene: quarantine rejected concepts

**Confidence: high on the authoring rules, medium on the tooling.**

**Problem.** Rejected alternatives remain in context with nonzero weight, and it is worse
than a simple weighting issue: **negation is weakly represented.** "We decided *not* to
use Redis" reliably resurfaces later as Redis. The rejection carries the concept into
context, and the negation is the first part to decay.

**Three responses, in increasing ambition:**

1. **Record decisions as positive statements, never as negations.** Not *"rejected
   Redis"* but *"caching uses Postgres unlogged tables."* This is an authoring rule and
   costs nothing.

2. **Quarantine the rationale.** `design-context.xml` already exists as the non-normative
   companion to a spec. Make the rule explicit and mechanical: rejected alternatives live
   there, and **`design-context.xml` is not loaded during execution.** It is for humans
   and for the reviewer, never for the implementer.

3. **`grace context --compact`.** Emit current truth only: active decisions as positive
   statements, no history, no alternatives, no superseded reasoning.

**The reframe.** GRACE is already a context-cleanup mechanism and has never been
described as one. The entire point of a durable `.grace` model is that **the conversation
can be discarded and the state reloaded from artifacts.** That should be operational
practice, not merely architecture:

> **Artifact reload beats conversation memory.**

Between waves, between tasks, after any long detour: drop the transcript, reload from
`.grace`. Rejected concepts, abandoned approaches, and the user's mid-flight reversals
are not in the artifacts — so they do not come back. This is the strongest single answer
to context pollution and it requires no new machinery, only a stated practice and a
command that makes the reload cheap.

## 4. Suggested sequencing

Ordered by leverage per unit of effort, not by ambition:

| Order | Item | Rationale |
|---|---|---|
| 1 | §3.1 task-scoped context slices | Highest leverage; reuses structure that already exists; improves every other item on this list |
| 2 | §3.2 scope-drift interrupt + `<ScopeAmendment>` | Closes the only problem here with zero current coverage |
| 3 | §3.3 self-review skill + mechanized audits | Makes the thing that found nineteen defects repeatable without a human reviewer |
| 4 | §3.4 provenance fields | Cheap; the only defence against inference hardening into fact over months |
| 5 | §3.6 context hygiene rules + `--compact` | Authoring rules are free and can land immediately; the command can follow |
| 6 | §3.5 interview redesign | Genuinely valuable, but materially better once provenance exists |

Items 1, 2 and 6 are user-visible behaviour changes and would need their own change
bundles and approval. Items 3–5 are largely additive.

## 5. The honest concern

**GRACE grew faster than its on-ramp.**

Phases 6–9 added `AC-*`, `DT-*`, `BP-*`, `ST-*`, `IC-*`, `INV-*`, `Stack-*`, two context
artifacts, seven assertion kinds, and three CLI surfaces. Every piece is optional and
every piece earns its place on the merits. The adoption risk is nonetheless real, and
ceremony tiers are guidance rather than enforcement — a documented way to do less, with
nothing preventing a team from tiering everything down to T0.

Before another layer of capability, `examples/polyglot` should become something a
newcomer can follow end to end in twenty minutes. It currently governs three files. That
is enough to stop the example bitrotting in CI; it is not enough to *teach*. If GRACE 5
has a weak point entering adoption, it is that the surface area outran the tutorial.

**A related risk for this document specifically:** everything proposed here adds process
to the agent's loop. Each item should be justified by a failure it would have caught in
the RM-POLYGLOT-ENFORCEMENT dataset, and any item that cannot be is a candidate for
deletion rather than implementation.

## 6. Considered and set aside

Recorded as positive statements about what was chosen, per §3.6 rule 1.

| Question | Decision |
|---|---|
| Source of interview uncertainty | Compilability into a failing check (§3.5), because it is observable and cannot be gamed by the model |
| Home of the self-review protocol | A skill separate from `grace-execute`, invoked with the plan and diff only, because detachment from the implementation is the property that makes review work |
| Handling of mid-flight scope change | Append-only amendment with approval, because an immutable-or-supersede-only path is heavy enough that teams will bypass it |
| Anti-pattern guidance format | A defect log of worked failures with consequences, because it measurably outperformed the abstract rule list in practice |

## 7. Open questions

1. Does `grace mutate` justify its cost? Reverting hunks and re-running verification is
   slow and can be flaky. A cheaper first version might only report which changed hunks
   are covered by *any* test at all.
2. Should the scope-drift interrupt be a hard stop or a prompt? A hard stop is safer and
   more annoying; annoyance is how tools get disabled.
3. Where does `<ScopeAmendment>` live — inside `plan.xml` (keeping the bundle
   self-contained) or in a sibling artifact (keeping `plan.xml` byte-stable after
   approval)? The immutability rule argues for the sibling.
4. Is provenance per-anchor or per-field? Per-field is more useful and considerably more
   verbose to author.
5. Does this repository adopt its own methodology (`.grace` self-migration) before or
   after this work? Doing it first would test every proposal here against a real project;
   doing it first also delays everything.
