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

**A second, weaker source of evidence** was added after the first draft: a comparative
reading of [spec-kit](https://github.com/github/spec-kit), the closest neighbour in this
space with a mature command set and a large user base. Its choices are not evidence that
those choices work — they are evidence about what a widely-used system found worth
enforcing. Where a spec-kit mechanism maps onto a defect pattern in §2 it is treated as a
proposal below; where it does not, it is recorded in §6 as considered and set aside.
§8 lists exactly what was read, so a later session can re-verify rather than re-derive.

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

One further observation, arrived at late and cheap to act on: pattern 1 was partly a
**vocabulary** problem. Every report the executor could make was shaped as *done* or
*failed*. There was no sanctioned word for *asserted but not checked*, so the assertion
was reported as checked. §3.7 proposes supplying that word.

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

**Unresolved tension: minimal is not the same as coherent.** The slice above is
*graph-minimal* — the transitive closure of the edges the task names. spec-kit's unit of
decomposition is different: a prioritized user story that must be **independently
testable and demonstrable on its own**, with tasks grouped under it and a blocking
Foundational phase ahead of all of them. The two definitions will disagree. An agent can
hold every anchor a task names and still not know what the task is *for*, because the
motivating scenario was not an anchor. Which definition wins should be decided before the
command is built, not discovered during execution.

**A version of this is available today with no tooling.** Every spec-kit command
hardcodes its own progressive-disclosure list — *from `spec.md` load the overview,
functional requirements, success criteria, user stories, edge cases; nothing else* —
paired with two supporting rules: build an internal model rather than echoing raw
artifacts into the output, and cap the output (50 findings, 40 checklist items, overflow
summarized). That is `grace context --task` implemented as prompt discipline. It is
weaker, because it relies on the agent obeying, but it can ship in skill text before the
command exists and it de-risks the command by testing the hypothesis first.

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

**Two gaps this proposal has, both visible by comparison with spec-kit.**

**Gap A — the interrupt has nothing to appeal to.** As written, the halt is the agent's
judgment against the user's live instruction, and the live instruction wins that argument
every time. spec-kit's answer is a project constitution that outranks the current plan and
may not be reinterpreted in-flight. That is a separate proposal, §3.8, but §3.2 is
materially weaker without it: an interrupt with no citation is a speed bump.

**Gap B — `ObservedWriteScope` cannot see in-scope drift.** It catches writes to
*undeclared files*. It does not catch unrequested work inside files the plan already
declares — which is where "while you're in there" most often lands, because the drifting
edit is usually near the work that prompted it. spec-kit's `/converge` classifies every
finding by gap type: `missing`, `partial`, `contradicts`, and — the one GRACE has no
equivalent for — **`unrequested`**: code present that no requirement, plan decision, or
task called for. Converge never deletes it; it appends a task to justify or remove it.
The check is artifact-versus-code rather than live, so it complements the interrupt
rather than replacing it.

**Converge is also prior art for the `<ScopeAmendment>` mechanics**, and its contract is
worth copying nearly verbatim, because it has already resolved the questions in §7.3:
append-only, never renumber or reorder existing entries, a prior amendment section is
never touched (a new one is added below it), and when nothing is outstanding the file is
left **byte-for-byte unchanged** — no empty header as a "we ran" marker. It also runs to
fixpoint: implement → converge → implement → converge until a clean pass. GRACE's review
today is one-shot, which means a review that finds work does not verify the work it
caused.

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

**Two sharpenings of that requirement.**

1. **Read-only by construction, not by intention.** spec-kit's `/analyze` declares itself
   *strictly read-only*: it may not modify any file, and may only *offer* remediation for
   explicit approval. Detachment from the transcript is not sufficient on its own — a
   reviewer that can write will fix what it finds, and at that moment it has become the
   implementer and lost the property that made it useful. The constraint should be on the
   skill's permitted tools, not on its good intentions.

2. **Determinism is a testable property.** spec-kit requires that rerunning `/analyze`
   with no intervening change produce identical finding IDs and identical counts. That is
   a cheap and unusually strong handle on an agent command: **you can verify a reviewer by
   running it twice and diffing.** Nothing in this document currently proposes any way to
   check that the reviewer itself is working; this is one, and it costs a stable ID scheme.

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

Then `ngrace doctor` can report: *"41% of your graph is agent-inferred and never
confirmed."* That is a directly actionable hallucination metric, and it turns an
invisible risk into a number that can be driven down.

**Adjacent idea, unranked:** graph claims have no freshness. Verification evidence
carries timestamps; a module `<Summary>` written eight months ago and never re-checked
does not. Staleness is a hallucination source with no current visibility.

**The cheap precursor: a typed hole.** Provenance answers *how was this established*
after the fact. spec-kit's spec template does something simpler and earlier — where the
agent does not know, it writes the gap into the artifact as a marker rather than a guess:

```text
- **FR-006**: System MUST authenticate users via
  [NEEDS CLARIFICATION: auth method not specified — email/password, SSO, OAuth?]
```

The `assess` extension does the same for evidence, tagging every unsourced statement
`ASSUMPTION`. Neither needs a schema change — a marker in the text is greppable, visible
in review, and blocks nothing. It is worth landing ahead of the provenance field, because
it converts the highest-risk case (*the agent had no basis at all*) from invisible to
obvious at roughly zero cost, and it gives the provenance work a real corpus to calibrate
against.

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

**The loop, which this proposal was missing entirely.** The compilability test above
judges whether an *answer* is good. It says nothing about which questions to ask, how many,
or what to do with the ones that go unanswered. spec-kit's `/speckit.clarify` has a
worked loop, and the mechanics transfer directly:

| Mechanic | What it does | Why it matters here |
|---|---|---|
| **Hard budget: 5 questions, asked one at a time, queue never revealed** | Forces prioritisation and keeps the interview finishable | An unbounded interview is abandoned, and an abandoned interview produces worse artifacts than none |
| **Coverage scan before questioning** — every category marked Clear / Partial / Missing, questions selected by (impact × uncertainty) | Decides *which* question is worth one of the five | A second non-introspective signal, orthogonal to compilability: that one grades answers, this one ranks questions |
| **Always propose a recommended answer with one or two lines of reasoning** | User can reply "yes" | This is what makes the interview cheap enough to complete; it also converts the agent's inference into something the user explicitly ratifies, which is provenance (§3.4) obtained for free |
| **Write to disk immediately after each accepted answer** | No batching | The interview survives a crash or a compaction mid-way |
| **Question-writing rules** | Must be a full interrogative ending in `?`, plus one plain-language "why it matters" line | Explicitly banned: using a topic label or requirement id *as* the question (`Acceptance device/runtime matrix (FR-023)`). This is a real observed agent failure, and it is the exact point where an interview stops being answerable by a non-expert |
| **`Deferred` bucket with rationale** | Unresolved high-impact categories are named at the end, not dropped | Budget exhaustion becomes visible instead of silent |

Where the answer is still unknown at the end, the outcome is a typed hole in the artifact
(§3.4), not a plausible guess.

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

   **Correction to this rule as first drafted.** Stated as *never write negations* it
   destroys information the decision needs. spec-kit's `assess.research` stage does the
   opposite and **mandates** an "Evidence Against the Idea" section; §2 of this document
   likewise found that concrete recorded failures outperform abstract rules. Both are
   negative material and both are valuable. The real distinction is not positive versus
   negative, it is **which context the material is loaded into**: a rejected concept in
   *execution* context resurfaces as an instruction; disconfirming evidence in *decision*
   context is the thing that prevents a bad decision. So the rule is narrower than first
   written — decisions carried into execution are phrased positively; the counter-case is
   preserved in full and quarantined by rule 2, never deleted.

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

**The one thing the reframe needs that GRACE does not have** is a durable answer to
*where was I*. Dropping the transcript is only safe if the position in the plan survives
it; today that position lives in the conversation. §3.10 proposes fixing that, and this
practice should be considered blocked on it.

---

### 3.7 An honest failure value in every reported verdict

**Confidence: high. Cheapest item in this document by a wide margin.**

**Problem.** §2 pattern 1 — six of nineteen defects were confident assertions of facts
that were never checked. The framing so far has treated this as a calibration problem,
which is not fixable. Part of it is simpler: the executor had no vocabulary for the true
state. Reports were shaped as *done* or *failed*, and "I asserted this without checking"
maps to neither, so it was reported as done.

**Proposal.** Every verdict a GRACE skill can report carries an explicit value meaning
*not established*, and the skill text states when that value is mandatory. spec-kit does
this in two places and states the rule bluntly in both:

- the `bug` extension: a reproduction that was not actually performed is reported as
  `partial` or `not-run` — **never** `verified`;
- the `assess` extension: a `go` verdict requires evidence rated adequate or better; where
  it is weak or unknown, *"the honest verdict is `needs-clarification`"*.

Applied to GRACE this means verification rows report `pass | fail | not-run`, not
`pass | fail`; review outcomes admit `unable-to-determine`; and a task may complete with
`satisfied-unverified` against an acceptance criterion it could not exercise.

**Why this is different from provenance (§3.4).** Provenance records how a claim was
established, after the fact, in the artifact. This operates at the moment of reporting,
in the transcript, and its whole effect is to make honesty *expressible*. They compose:
`not-run` is what produces an `agent-inferred` provenance value rather than a
`tool-verified` one, so the two mechanisms agree by construction instead of by diligence.

**Justified against the dataset:** six instances of pattern 1. It is the only item here
that could ship as skill text alone, with no tooling, in an afternoon.

---

### 3.8 Standing authority: principles that outrank the current plan

**Confidence: medium-high. Prerequisite for §3.2 being more than a speed bump.**

**Problem.** When the user says *"while you're in there, fix the date formatting,"* the
agent has nothing to weigh it against. Every artifact in `.grace` describes *this* change;
the user's instruction is about this change too, and it is more recent. There is no
artifact with standing above the conversation, so the conversation always wins.

**Proposal.** A small, explicitly-versioned set of project principles — spec-kit calls it
a constitution and stores it outside any feature directory — with three properties that
matter more than its contents:

1. **It outranks the plan.** A conflict between a principle and a plan is resolved against
   the plan, not by reinterpreting the principle.
2. **It may not be amended in-flight.** spec-kit's rule: a command that hits a conflict may
   not dilute, reinterpret, or silently ignore the principle; changing it requires a
   separate, explicit constitution update outside the command that hit it. This is exactly
   the property §3.2 needs — the interrupt gets something to cite that the current
   conversation cannot edit its way past.
3. **Violations are severity-pinned, not judged.** A constitution conflict is
   automatically the highest severity, removing the agent's discretion over how seriously
   to take it.

It also arrives with the amendment discipline §3.2 is reaching for: a version, a
ratification date, a last-amended date, and a governance section describing how amendment
works.

**Open design question, and it is a real one.** GRACE already has `INV-*` invariants and
seven assertion kinds. The honest question is whether this is a genuinely new artifact or
a *scope* attribute on the ones that exist — project-wide and immutable-in-flight, versus
module-scoped and revisable. The second reading is much cheaper and does not add a new
file to the on-ramp (§5). It is not obviously wrong, either: what §3.2 needs is
precedence, and precedence can be a field.

---

### 3.9 Requirements-quality checks, with regression reporting

**Confidence: medium. Largest new idea here; probably needs its own review document.**

**Problem.** GRACE verifies that the *code* satisfies the artifacts. Nothing verifies that
the *artifacts are any good*. A spec can be vague, internally inconsistent, and missing
every edge case while passing every coverage check GRACE performs, because coverage checks
compare artifacts to each other and they are all equally vague.

**Proposal.** spec-kit's framing is the useful part, and it is a genuinely good one:

> **Checklists are unit tests for English.** They test the requirements, not the
> implementation.

The distinction is enforced strictly. *"Verify the button click navigates home"* is
rejected as an implementation test; *"Is 'prominent display' quantified with specific
sizing and positioning?"* is the correct form. Items are grouped by quality dimension —
completeness, clarity, consistency, measurability, coverage, edge cases — and each carries
a traceability marker: a spec section reference, or one of `[Gap]`, `[Ambiguity]`,
`[Conflict]`, `[Assumption]`. At least 80% of items must be traceable.

Two mechanisms around it matter as much as the checklist itself:

- **Re-validation with regressions reported.** After any spec edit, every item is
  re-evaluated and the result is reported as a before/after count *including items that
  went from passing to failing* — "12/16 → 15/16, CHK007 regressed." This is a ratchet.
  §3.4's *"41% of your graph is agent-inferred"* is a reading; this is a reading that
  cannot silently get worse.
- **It gates execution.** `/implement` refuses to start silently when a checklist is
  incomplete: it prints the table and asks for an explicit decision to proceed anyway.

**Why GRACE is well placed.** A meaningful fraction of this is *computable* here rather
than generated by an agent, which is the whole difference between a checklist and a lint
rule: an `AC-*` with no `V-M-*`, an `IC-*` with no owner or version, a `ST-*` with no
evidence, a `<Summary>` with no provenance (§3.4). Those are graph queries, and
`ngrace doctor` is the natural home. The judgment-dependent remainder — *is this
requirement actually unambiguous* — stays agent-generated and stays advisory.

**Honest caveat.** This is the item least supported by the §2 dataset. RM-POLYGLOT's
defects were implementation defects against a plan that was, by all evidence, good. The
justification for this proposal is a risk not yet observed here, which by §5's own
standard makes it a candidate for deferral rather than the next thing built.

---

### 3.10 Run position as an artifact, not a conversational fact

**Confidence: high on the need, medium on the shape.**

**Problem.** §3.6 concludes that artifact reload beats conversation memory and recommends
discarding the transcript between tasks and waves. But *which wave, which task, which
phase, and what has already been approved* currently live only in the transcript. The
recommended practice destroys the information required to follow it. The same gap appears
without any deliberate reload: a compaction or a dead session loses the position.

**Proposal.** An externalized, resumable run cursor. spec-kit's workflow engine is the
worked version: a run has an id and a state (`created`, `running`, `paused`, `failed`,
`aborted`), the position is persisted under a per-run directory, `resume <run_id>` picks up
from the exact step that stopped, `status` reports where any run is, and gate steps are
first-class — a run may *pause pending a human decision*, which is a normal state rather
than a failure.

GRACE needs a much smaller version of this, and much of the content already exists inside
the change bundle. What is missing is a single durable answer to *where are we*, separate
from the plan itself, and the pause-pending-approval state — which the approval-checkpoint
model already implies but does not record anywhere durable.

**The property to preserve:** the cursor must be readable without the agent that wrote it.
That means a file, a defined state vocabulary, and machine-readable output — the same
argument as §3.3's *"anything an agent can skip and lie about should emit evidence"*,
applied to progress rather than to review.

## 4. Suggested sequencing

Ordered by leverage per unit of effort, not by ambition:

| Order | Item | Rationale |
|---|---|---|
| 1 | §3.7 honest failure values in verdicts | Skill text only, no tooling, lands in an afternoon; attacks the most-instanced defect pattern in the dataset (6 of 19) |
| 2 | §3.1 task-scoped context slices | Highest leverage of the tooling items; reuses structure that already exists; improves every other item on this list. Ship the prompt-discipline version first |
| 3 | §3.8 standing authority | Small, and §3.2 is a speed bump without it. Settle first whether it is a new artifact or a scope attribute on `INV-*` |
| 4 | §3.2 scope-drift interrupt + `<ScopeAmendment>` + `unrequested` | Closes the only problem here with zero current coverage. The `unrequested` gap type is separable and cheaper than the live interrupt |
| 5 | §3.10 run position as an artifact | Small, and §3.6's central practice is unsafe until it exists |
| 6 | §3.3 self-review skill + mechanized audits | Makes the thing that found nineteen defects repeatable without a human reviewer |
| 7 | §3.4 typed holes, then provenance fields | The `[NEEDS CLARIFICATION]` marker is free and can precede the schema work by months |
| 8 | §3.6 context hygiene rules + `--compact` | Authoring rules are free and can land immediately; the command can follow |
| 9 | §3.5 interview redesign | Genuinely valuable, but materially better once provenance and the question loop are settled |
| — | §3.9 requirements-quality checks | Deliberately unranked. The largest idea here and the one with no supporting evidence in the §2 dataset; see §5 |

Items 2, 4, 5 and 9 are user-visible behaviour changes and would need their own change
bundles and approval. Items 1, 3, 6, 7 and 8 are largely additive.

Two sequencing constraints are not negotiable regardless of how the priorities are argued:
§3.2 should not ship before §3.8 (an interrupt with nothing to cite), and §3.6's
transcript-discard practice should not be documented as guidance before §3.10 exists (a
practice that destroys the state it needs).

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

**Applying that standard to the new material honestly.** §3.7 clears it (6 instances).
§3.2's `unrequested` gap type and §3.8 do not clear it — no defect in the dataset was
scope drift, because the executor was following an approved plan the whole way. They are
justified by a failure mode this dataset structurally could not contain, which is a weaker
argument and should be labelled as one. §3.9 does not clear it at all and is unranked in
§4 for that reason.

**The counter-example is also instructive.** spec-kit pays a large, permanent prompt tax
for its extensibility: roughly forty lines of extension-hook dispatch boilerplate,
duplicated inline in every command, twice — once before the work and once after — in files
that are otherwise 150–350 lines. Every invocation carries it whether or not any extension
is installed. That is the concrete shape of the risk described above: a mechanism that is
individually reasonable, applied uniformly, until the instructions are mostly protocol.
GRACE is not there, and the way to stay out of it is to keep cross-cutting mechanisms in
one place rather than inlining them into every skill.

## 6. Considered and set aside

Recorded as positive statements about what was chosen, per §3.6 rule 1.

| Question | Decision |
|---|---|
| Source of interview uncertainty | Compilability into a failing check (§3.5), because it is observable and cannot be gamed by the model |
| Home of the self-review protocol | A skill separate from `grace-execute`, invoked with the plan and diff only, because detachment from the implementation is the property that makes review work |
| Handling of mid-flight scope change | Append-only amendment with approval, because an immutable-or-supersede-only path is heavy enough that teams will bypass it |
| Anti-pattern guidance format | A defect log of worked failures with consequences, because it measurably outperformed the abstract rule list in practice |
| Placement of cross-cutting mechanisms | Centralized, with skills referencing them, because spec-kit's inlined-in-every-command approach costs a permanent prompt tax proportional to the number of commands (§5) |
| Treatment of disconfirming evidence | Preserved in full and quarantined in `design-context.xml`, because the material that prevents a bad decision is exactly the material a naive "no negations" rule deletes (§3.6 rule 1) |
| Scope of the discovery track | Out of scope for this document. spec-kit's `assess` pipeline (intake → research → define → shape → decide, where a documented kill is a successful outcome) sits *before* specification and answers "is this worth building"; GRACE begins after that question is settled. The transferable parts — forced counter-evidence and honest verdicts — are taken in §3.7 and §3.6 without the pipeline |
| Persistence model | GRACE is flow-forward — completed bundles are immutable historical records and change arrives as a new bundle. spec-kit names three models (flow-back, flow-forward, living spec) and refuses to choose for the team; GRACE has effectively chosen but never said so, which is worth stating explicitly because §7.3 is a consequence of it |

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
6. Is §3.8 standing authority a new artifact, or a scope attribute on `INV-*` marking it
   project-wide and immutable in-flight? The second is much cheaper and adds nothing to
   the on-ramp. §3.2 needs precedence, and precedence can be a field.
7. Is the §3.1 slice graph-minimal or independently-demonstrable? These give different
   answers, and the difference is whether a task carries its motivating scenario.
8. How much of §3.9 is computable from the graph rather than agent-generated? If most of
   it is, it belongs in `ngrace doctor` and is small. If most of it is not, it is a large
   new agent surface with no supporting evidence in the dataset, and should wait.
9. Should the run cursor of §3.10 live inside the change bundle or beside it? The bundle
   is the natural home, but the cursor mutates constantly and the bundle is supposed to be
   stable after approval — the same argument as §7.3, and it should get the same answer.
10. Does §3.7 need enforcement, or is vocabulary sufficient? An agent that will report
    `pass` without checking can equally report `pass` when `not-run` is available. The
    counter-argument is that §2 showed the executor applied worked lessons unprompted once
    they existed, which suggests the missing word was a real constraint and not an excuse.

## 8. Prior art read

For the comparative claims in this document, the following were read in the local
`spec-kit` checkout at commit `be33d2a`, so a later session can re-verify rather than
re-derive:

- `templates/commands/{analyze,clarify,checklist,converge,implement}.md` — the command
  prompts, and the source for §3.1's progressive disclosure, §3.2's gap types and
  append-only contract, §3.3's read-only and determinism rules, §3.5's question loop, and
  §3.9's checklist framing.
- `templates/{spec,tasks,constitution}-template.md` — `[NEEDS CLARIFICATION]` markers
  (§3.4), independently-testable prioritized stories (§3.1), and the constitution's
  versioning and governance sections (§3.8).
- `docs/concepts/{spec-persistence,spec-of-specs,complex-features}.md` and
  `docs/guides/evolving-specs.md` — the three persistence models (§6), roadmap
  decomposition, and their own account of context exhaustion during long implementation
  runs, which independently matches the dilution hypothesis in §3.1.
- `docs/reference/workflows.md` — run states, resume semantics, and gate steps (§3.10).
- `extensions/{assess,bug,agent-context}/README.md` and the `assess`/`bug` command
  prompts — honest verdict vocabularies and forced counter-evidence (§3.7, §6).

Deliberately not read, as packaging rather than reliability concerns: the `specify` CLI
source, presets, integrations, and the bundle/catalog machinery. The extension model
itself belongs to the sibling
[RM-LANGUAGE-EXTENSIBILITY](../RM-LANGUAGE-EXTENSIBILITY/review.md), where workflow
overlays — project-local customizations that survive an upstream upgrade — are the idea
worth examining.
