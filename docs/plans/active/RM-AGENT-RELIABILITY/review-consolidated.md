---
id: RM-AGENT-RELIABILITY
kind: context
status: draft
supersededBy: null
created: 2026-07-28
updated: 2026-07-29
baseline: 5.0.1
targets: []
normative: false
plan: ./plan.md
---

# Agent reliability — consolidated review

> **Status: exploration, not a commitment.** There is no `plan.md` for this track and no
> phase has been approved. Nothing here is normative.
>
> This document unifies the internal exploration (`review.md`, 2026-07-28) with five
> independent external reviews of it, and reconciles them against the repository as it
> actually is at 5.0.1. Where the inputs agree, it says so and stops arguing. Where they
> disagree, it records the disagreement and takes a position. Where an input is factually
> wrong about the code, it is corrected in §3.
>
> Sibling: [RM-LANGUAGE-EXTENSIBILITY](../RM-LANGUAGE-EXTENSIBILITY/review.md) covers the
> tool's own extension model. Kept separate: different evidence, different completion time.

---

## 0. How to read this document

### 0.1 Inputs

| Ref | Document | Character |
|---|---|---|
| **R0** | `review.md` (this directory, 2026-07-28) | The internal exploration. Ten proposals, dataset-grounded, ten open questions. |
| **R1** | `future_enhancements_review_1.md` | Harness-design lens. Most operationally specific; adds eight new items and ten new open questions. |
| **R2** | `future_enhancements_review_2.md` | Product/adoption lens. Adds tier applicability, token economics, multi-agent consistency, mechanism testing. |
| **R3** | `future_enhancements_review_3.md` | Codebase-architecture lens. Most willing to disagree; strongest on the skills-vs-binary split and enforceability. |
| **R4** | `future_enhancements_review_4.md` | Executive/roadmap lens. Resolves all ten open questions in a table; adds a four-phase rollout. |
| **R5** | `future_enhancements_review_5.md` | Short summary. Restates R0 faithfully; contributes no independent argument and one position against consensus (§3.4 below). |

R1–R4 are substantive and independent. R5 is treated as a restatement, not as a vote.

### 0.2 Evidence tags

Every claim below carries the strength of its justification. This is the standard R0 §5
set for itself, applied uniformly:

| Tag | Meaning |
|---|---|
| **E1** | Supported by the RM-POLYGLOT-ENFORCEMENT defect dataset — a countable number of observed instances. |
| **E2** | Verified against this repository at 5.0.1 during this consolidation. |
| **E3** | Prior art (spec-kit). Evidence about what a widely-used system found worth enforcing — *not* evidence that it works. |
| **E4** | Reasoned only. Addresses a failure mode the dataset structurally could not contain. Legitimate, but weaker, and labelled as such. |

**An E4 item is not disqualified — it is bounded.** The dataset is one executor following
one approved plan; it cannot contain user-driven scope drift, bad specs, multi-agent
races, or model-family variation. Refusing to plan for those because the dataset is silent
would be its own kind of dishonesty. Refusing to *claim dataset support* for them is the
discipline.

### 0.3 Consensus notation

`[4/4]` means all four substantive external reviews agree. `[3/4, R3 dissents]` names the
dissent. Positions taken here are marked **Resolution**.

---

## 1. What `neo-grace` is, and the consolidated verdict

All six inputs converge on the same characterization, in different words: GRACE is not a
coding agent, a prompt pack, or a better `CLAUDE.md`. It is a **governance layer between
the agent and the codebase** — a durable, greppable project model (`.grace`), a
fail-closed CLI (`ngrace`) whose gates emit evidence, and short skill texts that
choreograph the two.

The decomposition that makes it unusual **[4/4]**:

- **`skills/grace/*`** — 16 skills, 636 lines of SKILL.md total **(E2)**. These are
  *choreography*, not intelligence: what to run, in what order, with which gate.
- **`src/*`** — the `ngrace` binary is the *enforcement*: grammar, projections, assertion
  modes, scopes, language adapters, lint catalog, query layer. Seven subcommands at 5.0.1
  (`doctor`, `file`, `graph`, `lint`, `module`, `status`, `verification`) **(E2)**.

R3 states the invariant most precisely, and it is correct: *skill text that cannot be
honored without the binary, and a binary whose gates the skill text choreographs.* Most
neighbours in this space are one or the other — an unenforced prompt pack, or a linter
with an unmanaged agent. The third thing is the product.

### 1.1 What is genuinely strong (consolidated)

| Property | Why it matters | Agreement |
|---|---|---|
| Unique-tag anchors (`M-*`, `AC-*`, `IC-*`, `V-M-*`, `INV-*`) | Architecture is addressable without RAG guesswork; the graph is a real computation surface, not documentation | [4/4] |
| Assertion **modes** (`current \| baseline \| target \| final`) | Turns "is the plan satisfied" into four machine-checkable gates with defined composition. A state machine, not a lint rule | R3, elevated here |
| Immutable approved plans, flow-forward bundles | More rigorous than any open methodology in this space; makes "what actually happened" recoverable | [4/4] |
| Confidence honesty in the language tier (`exact \| heuristic \| no-adapter`, `analysis.runtime-missing`) | The codebase already believes *do not lie about what you verified* — it just has not generalized it to the agent's own reports | [4/4] |
| Fail-closed everywhere | Path escapes, ambiguous targets, invalid grammar, stale assertions all produce structured nonzero envelopes. No silent degradation | [4/4] |
| Ceremony tiers change **section depth, never whether gates run** | An escape valve from process *volume*, never from process *existence* **(E2:** `grace-reviewer/SKILL.md:20`, `grace-spec/SKILL.md:34`**)** | R3; load-bearing in §5.3 below |
| Short skills, centralized mechanisms | Avoids spec-kit's permanent per-command prompt tax | [4/4] |

### 1.2 What is genuinely weak (consolidated)

**The one-sentence diagnosis, agreed by all six inputs:**

> **5.0 made the artifacts trustworthy. It did not make the agent operating on them
> trustworthy.**

| Weakness | Evidence | Agreement |
|---|---|---|
| Agent operating reliability | 19 defects / 9 phases, every one green-suite and confidently reported **(E1)** | [4/4] |
| No context economy under long runs | Graph exists; no slice emitter; position is conversational **(E2:** no `context` subcommand**)** | [4/4] |
| Self-verification proven once, never productized | `RM-POLYGLOT §0.7` is text inside one archived plan | [4/4] |
| **No dogfooding** — repo has no `.grace` state | `CLAUDE.md` says so explicitly; `docs/plans/` is a hand-maintained markdown index with manual status-agreement rules — an honor system, applied to GRACE's own roadmap | [4/4], R3 hardest |
| On-ramp outran the surface | ~12 anchor families, 3 assertion modes, 4 fail-on policies, tiers, size limits, graph splitting — against a walkthrough that governs three files | **[6/6] — the single most agreed item in all inputs** |
| Skills carry choreography but almost no reasoning defense | 636 lines, mostly "run these commands in this order"; nothing about *how the agent reasons* | R3 |

R1's scorecard, retained because it compresses the above usefully:

| Dimension | Score |
|---|---|
| Conceptual model (unique tags, graph routing) | ★★★★★ |
| Artifact lifecycle rigor | ★★★★★ |
| Polyglot honesty of checks | ★★★★☆ |
| Agent operating reliability | ★★☆☆☆ |
| Context economy under long runs | ★★☆☆☆ |
| Self-verification as product | ★★☆☆☆ |
| On-ramp / tutorial depth | ★★★☆☆ |
| Prompt-tax discipline | ★★★★★ |
| Dogfooding | ★☆☆☆☆ |

---

## 2. The evidence base and its limits

### 2.1 The five defect patterns (E1)

Unchanged from R0 §2 and endorsed without dissent by all five external reviews.

| # | Pattern | Instances | Implication |
|---|---|---|---|
| 1 | **Confidently wrong beats honestly unsure** — asserting a fact never checked, at `exact` confidence or as a hard error | 6 | Self-reported confidence is worthless as a signal. It correlates with fluency, not correctness. |
| 2 | **A comparison where one side derives from the thing under test proves nothing** | 2 | Round-trip tests and symmetric fixtures pass while the code is broken. |
| 3 | **A guard written as a regex over structured text is a guard you do not have** | 3 | Where the input has structure, scan the structure. |
| 4 | **Zero-or-more anchor lists silently swallow malformed children** | 2 | Cardinality checks cannot protect a list allowed to be empty. |
| 5 | **New constructs are not threaded back through earlier guarantees** | 1 | Invisible by construction: every existing test still passes. |

### 2.2 The two meta-observations

R2 is right that these matter more than the individual patterns, and that every proposal
traces back to one or both:

1. **Concrete failures outperform abstract rules.** The defect log (worked failures with
   consequences) visibly outperformed the anti-pattern list (rules). By Phase 8 the
   executor was applying lessons from it unprompted.
2. **Fresh-context review is why the defects were found.** The reviewer had the plan and
   the diff but not the implementer's reasoning. **Detachment was the operative property,
   not superior skill.**

Observation 2 is the load-bearing claim of the whole track. R3 correctly identifies that
it is also the claim with the heaviest harness dependency — see §5.2.

### 2.3 What the dataset structurally cannot contain

Named honestly, because four proposals rest on its absence:

- **User-driven scope drift** — the executor followed an approved plan throughout. §3.2
  and §3.8 are E4.
- **Bad specs** — the plan was, by all evidence, good. §3.9 is E4.
- **Multi-agent and multi-session effects** — one executor, one continuous run. §5.6 is E4.
- **Model-family variation** — one executor, one model. R2 §4.3 is a real caveat: pattern
  1 and pattern 3 may be training-distribution artifacts. Nothing here should be
  advertised as a cross-model finding until it is tested on a second family.

### 2.4 spec-kit's status (E3)

All six inputs agree: **prior art for mechanism shape, not evidence that those mechanisms
work.** Transferable: progressive disclosure, append-only converge, read-only analyze with
deterministic findings, clarify loop budgets, honest verdict enums, constitution-style
standing rules. Explicitly *not* transferable: the inlined extension-hook boilerplate
(~40 lines duplicated in every command, twice), which is exactly the prompt tax GRACE's
short-skill discipline exists to avoid.

---

## 3. Corrections to the input reviews

Balance requires saying where the reviews are wrong. Four corrections, all verified
against the repository (**E2**). The first materially changes the §3.7 argument.

### 3.1 The machine-emitted `not-run` primitive already exists

R3's headline recommendation is a "one-day change in `lint/core.ts`" to make `ngrace`
emit a `not-run` verdict for `MustPassCommand` assertions evaluated without
`--run-commands`. R1's §4.5 raises the related worry that opt-in command evidence "trains
agents that green lint equals done."

**Both are already answered by shipped code.** `src/grace4/assertions.ts:263` and `:506`
emit `assertion.command-not-evaluated` as a fail-closed **error** when `MustPassCommand`
or `MustPassBudget` is evaluated without explicit command opt-in, and
`src/grace-status.ts:127` counts it as a baseline failure. A plan that declares a command
assertion cannot pass its gate by declining to run the command.

This is not a small correction. It means:

- The §3.7 gap is **narrower and better-located** than R0 or the externals describe. The
  binary already refuses to say `pass` for evidence it does not have. The dishonesty
  lives entirely in surfaces the binary does not own: the agent's narrative report,
  review outcomes, acceptance-criterion satisfaction claims, and self-review audit rows.
- The right §3.7 work is therefore **not** new enforcement in lint. It is (a) vocabulary
  for the unowned surfaces and (b) a skill rule that `assertion.command-not-evaluated`
  **must** be reported as `not-run` rather than summarized away.
- It is also a template. The pattern *the binary computes the honest value; the skill is
  forbidden to soften it* is the shape every other §3.7 surface should copy.

### 3.2 Pre-write hooks exist in at least one target harness

R3 states that "no current agent harness gives a tool a pre-write hook," and concludes the
live scope interrupt is "post-hoc detection rebranded."

The conclusion is right for the *portable core*; the premise is too strong. Claude Code
supports `PreToolUse` hooks configured in `settings.json`, which can intercept and block a
write before it happens. So a genuine live interrupt is implementable — **as a host
adapter, for one host**. It is not implementable as a portable GRACE guarantee, because
Claude Code, Codex, Cursor, and generic skill runners do not share an intercept API.

R3's retitle recommendation survives the correction and is adopted in §4.2: the portable
promise is a gate plus a sanctioned amendment path; the live stop is an adapter.

### 3.3 Ceremony tiers cannot be used as a mechanism on/off switch

R2 §4.2 proposes a tier applicability matrix in which, for example, the scope-drift
mechanism is absent at T0, "Warn" at T1, and "Enforce" at T2–T3.

The proposal is right that reliability mechanisms need tier guidance. The specific shape
conflicts with a rule the codebase already enforces: tiers change **which sections must be
rich, never whether gates run** (`grace-spec/SKILL.md:34`), and `grace-reviewer` hard-rejects
tier language that bypasses `--assertions final` (`SKILL.md:20`) **(E2)**. A matrix that
turns a mechanism off at T0 reintroduces the "skip GRACE" escape hatch that tiering was
designed to avoid.

**Resolution:** keep R2's matrix, change its axis from *existence* to *depth*. See §5.3.

### 3.4 Two claims that are stated more strongly than their support

- **R4's "70–90% token reduction per task"** for context slices has no measurement behind
  it, in R4 or anywhere else. The only supporting datum in the entire corpus is a single
  anecdote: one phase went unusually cleanly after the executor was told to re-read three
  named sections of a ~2,900-line plan. That is a hypothesis worth instrumenting, not a
  number worth quoting. R4's adjacent "LLM attention degrades exponentially with context
  length" is likewise stated as fact without support.
- **R5 restates the standing-authority proposal as a "constitution"** — a new immutable
  artifact — where the other four externals and R0's own §7.6 converge on a scope
  attribute over existing `INV-*`. R5 contributes no argument for the more expensive
  reading; it is treated as a summarization artifact rather than a dissent.

---

## 4. The ten proposals, consolidated

Each entry states the resolved position, the evidence tag, the consensus, and any live
dissent. Section numbers follow R0 so cross-references from all six inputs still work.

### 4.1 Task-scoped context slices — `grace context --task T-001`

**Evidence: E4 + one anecdote. Consensus: [4/4] high leverage.**

The payoff for having built a graph: no methodology without a machine-readable relation
model can compute a minimal relevant slice. The edges exist today — `Satisfies`,
`DurableScope`, `Owns`, `LINKS:`.

**Resolution of the graph-minimal vs. independently-demonstrable tension (R0 open Q7).**
All four externals converge on a hybrid; the differences are only in where the purpose
text comes from.

```
grace context --task T-001
  → Purpose header: task Summary + the AC-* text it Satisfies, verbatim from
    approved artifacts — never agent paraphrase at emit time
  → Body (graph-minimal): M-* anchors the task names, their IC-* contracts,
    their V-M-* verification entries, task-local LINKS:
  → ObservedWriteScope paths
  → Explicit exclusions: design-context.xml, archived bundles, other tasks' scopes
```

Scenario text (R2's `--with-scenario`, R4's "parent feature scenario") stays behind a flag
and waits until specs carry structured scenario anchors — that is a separate design
question, and inventing motivation at emit time is the failure this proposal exists to
avoid.

**Ship the prompt-discipline version first [4/4].** Hardcoded progressive-disclosure lists
in skill text cost nothing, test the dilution hypothesis with real runs, and de-risk the
slice definition before any code is written.

**Instrument it.** Given §3.4, the prompt version should record context size before and
after so the CLI version is justified by a measurement rather than by R4's number.

**Parallel-safe caveat (R1 §4.4):** slices must be *per worker*, not per plan, or the
parallel execution path re-breaks on first real use.

### 4.2 Scope drift: `unrequested`, `<ScopeAmendment>`, and the interrupt

**Evidence: E4 (dataset structurally excludes scope drift) + E3. Consensus: [4/4] that
this is three separable products, not one.**

| Piece | Cost | Ship |
|---|---|---|
| `unrequested` gap type — code present that no requirement, plan decision, or task called for; artifact-vs-code, post-hoc | Low–medium | **Early.** It is the only thing that catches "while you're in there" *inside* declared files, which path scope structurally cannot see |
| Append-only `<ScopeAmendment>` with approval | Medium | **Yes.** The reframe is correct: user deviation is not a failure to prevent, it is an event to record |
| *Live* write interrupt outside `ObservedWriteScope` | High, host-specific | **Last, and as an adapter** (see §3.2) |

**The reframe that all six inputs endorse:** users legitimately change their minds; a
methodology that treats that as an error is abandoned at the first inconvenience. What is
corrosive is scope changing with *no trace*.

**Resolution of hard-stop vs. prompt (R0 open Q2).** Positions ranged from soft-with-record
(R1), prompt-default/hard-optional (R2), defer the live path entirely (R3), to
hard-in-CI/prompt-interactive (R4). The reconciliation:

- **Interactive:** prompt, naming the three options, with the user's choice *recorded* in
  the amendment trail. A hard stop that fires on every convenience request is a hard stop
  that gets disabled.
- **Non-interactive / CI:** fail closed. There is no user to prompt.
- **Hard stop regardless of mode** only when a project-scope invariant (§4.8) is cited —
  which is precisely the authority the interrupt is otherwise missing.

**Adopt R2's amendment UX**, the best concrete contribution in the external set: a
one-line command, not a ceremony.

```
ngrace amend --change C-X --add "Fix date formatting in LedgerTable"
```

Timestamp automatic; the approval *is* running the command. A heavyweight-only path
guarantees people route around it.

**Adopt spec-kit's converge contract nearly verbatim (E3):** append-only, never renumber
or reorder, never touch a prior amendment section, and when nothing is outstanding leave
the file **byte-for-byte unchanged** — no empty header as a "we ran" marker. Also its
run-to-fixpoint property: GRACE's review today is one-shot, which means a review that
finds work never verifies the work it caused.

### 4.3 Self-review as a detached skill, with the mechanizable parts mechanized

**Evidence: E1 (this protocol found all 19) + E3. Consensus: [4/4] structurally the most
important proposal. R3 ranks it #1 outright.**

| §0.7 audit | Disposition |
|---|---|
| Scope audit | **Mechanize.** `git diff --name-only` vs `ObservedWriteScope`. Trivial, no schema change |
| Test weakening | **Mechanize.** Diff test files; flag removed or loosened assertions |
| Backward-compat sweep | **Mechanize.** Lint every fixture before and after; diff the issue-code sets |
| Mutation check | **Mechanize cheaply first** — see below |
| Adversarial probe | **Skill judgment.** Cannot be automated |
| Anti-pattern audit | **Skill judgment, driven by a defect log**, not a rule list (§2.2) |

**Governing principle, unchanged and endorsed by all six inputs:** *anything in the
self-review that an agent can skip and lie about should become a command that emits
evidence.*

**Three non-negotiables, elevated here to hard product rules [4/4]:**

1. **Separate instance, no implementer transcript.** Plan and diff only. Folding
   self-review into `grace-execute` destroys the property that made it work.
2. **Read-only by tool permission, not by instruction.** A reviewer that can write becomes
   the implementer at the moment it finds something.
3. **Deterministic finding IDs.** Rerun with no intervening change ⇒ identical IDs and
   counts. This is a rare, cheap, testable property of an agent command — the only
   mechanism in the entire corpus that verifies the verifier. Build it in from day one.

**Resolution of R3's "answer this before writing any `plan.md`" question.** R3 argues the
whole track rests on whether detachment is *enforceable* or merely *instructable*, and
that if it is only instructable, the strongest finding reduces to a prompt the model can
ignore. The answer for the primary target harness: **enforceable.** A Claude Code subagent
starts from a cold context — it does not inherit the parent transcript — and agent
definitions carry a tool allowlist, so read-only is a configuration property rather than
an instruction. For hosts without those two capabilities, detachment degrades to an honor
system.

The consequence is not "problem solved." It is that **the guarantee is conditional and
must be published as conditional** — see the host capability matrix in §5.2. Selling a
hard detachment guarantee to users on a harness that cannot provide it would be the exact
confidence-without-check failure this track exists to eliminate.

**`grace mutate` (R0 open Q1): unanimous [4/4] — do not build it first.** Start with hunk
coverage attribution ("which changed hunks are defended by *any* test"), which is cheap
and already catches the "a test exists but does not exercise this change" mode. Full
revert-and-rerun stays an opt-in deep audit; it is slow, flaky, and may never justify its
cost.

### 4.4 Provenance on recorded facts, and typed holes

**Evidence: E3 + E4. Consensus: [4/4] typed holes first, schema later.**

**Ship order:**

1. **Typed holes in free text** — `[NEEDS CLARIFICATION: …]` and `ASSUMPTION` markers.
   Greppable, zero schema cost, blocks nothing, and converts the highest-risk case (*the
   agent had no basis at all*) from invisible to obvious.
2. **Provenance fields** — `user-stated | tool-verified | agent-inferred` — once there is
   a corpus of holes and confirmed statements to calibrate against.
3. **Freshness.** R2 makes the strongest addition in the external set here: provenance and
   staleness are two axes of one trust model — *how was this established* and *when was it
   last checked*. A `verified-at` timestamp is the same write as the provenance field and
   should ship with it, not as an "adjacent idea, unranked."

**Resolution of per-anchor vs. per-field (R0 open Q4).** R3's formulation is the sharpest
and is adopted: **declare coarse, derive fine.** Provenance is authored once per anchor;
`ngrace` *computes* the finer-grained value from whether the anchor is backed by a
verification entry, a command, or a contract. This mirrors the existing adapter pattern
exactly — the adapter declares a confidence ceiling, the framework verifies against
fixtures. Per-field authoring is verbose enough that agents stop filling it, at which
point the field is either absent (indistinguishable from unknown) or defaulted (a silent
lie — the precise failure provenance exists to prevent).

R1's refinement composes: high-risk surfaces (`AC-*`, `IC-*`, verification rows) may carry
explicit per-claim provenance; everything else is derived.

**Provenance needs a consumer or it rots into metadata nobody reads [R1].** The consumer
is `ngrace doctor` reporting *"41% of your graph is agent-inferred and never confirmed"* —
a directly actionable hallucination metric.

**Vocabulary discipline (R1 open Q20):** provenance and the language tier's
`exact | heuristic` are the same conceptual surface — *how sure is this claim?* Do not ship
two vocabularies for it.

### 4.5 Interview-driven init, grounded in compilability

**Evidence: E3 + E1 (the rejection of introspection is E1). Consensus: [4/4] good idea,
sequence late.**

Rejecting perplexity/logprob introspection is correct and dataset-backed: harnesses do not
expose logprobs, and self-reported confidence is pattern 1. The replacement is pure GRACE:

> **Can the answer be compiled into a check that could fail?**

"We use Postgres" → `MustExist` on migrations, `MustPassCommand` on a connection test.
"Performance matters" → nothing → ask again. This never lies and requires no introspection.

**Import spec-kit's loop mechanics (E3)**, which the original proposal was missing
entirely: hard budget of 5 questions asked one at a time with the queue never revealed;
a coverage scan (Clear / Partial / Missing) to rank *which* question is worth one of the
five; always propose a recommended answer with one or two lines of reasoning so the user
can reply "yes"; write to disk immediately after each accepted answer; a `Deferred` bucket
naming unresolved high-impact categories rather than dropping them. **(E2:** `grace-spec`
already says "one focused question at a time" but has no budget, no coverage scan, no
recommended answer, and no deferred residual — which is why interviews sprawl or get
abandoned.**)**

**Two additions from the externals, both adopted:**

- **R3:** the clarification queue must live in an artifact, not in the conversation. A
  five-question loop that survives compaction is a §4.10-class requirement in disguise.
- **R2's bootstrapping objection**, honestly recorded rather than resolved: the agent
  generating the questions is the agent that needs the interview. The compilability test
  grades *answers*, not questions. The coverage scan helps but is itself agent judgment.
  Partial mitigation: recommended answers move the judgment to the user, who ratifies or
  corrects. This is not a full answer and should not be presented as one.

**Also adopted (R0):** read the repository before asking. Asking "what language do you
use?" beside a `Cargo.toml` teaches the user the interview is theatre, after which they
answer carelessly and the artifacts get worse.

### 4.6 Context hygiene, and artifact reload

**Evidence: E4 + E3. Consensus: [4/4]. R2 calls the reload thesis the most underrated idea
in R0, and that assessment is adopted here.**

> **Artifact reload beats conversation memory.**

The entire point of a durable `.grace` model is that the conversation can be discarded and
the state reloaded. That has always been the architecture and has never been stated as
*practice*. Between waves, between tasks, after any long detour: drop the transcript,
reload from `.grace`. Rejected concepts, abandoned approaches, and mid-flight reversals
are not in the artifacts, so they do not come back.

**Blocked on §4.10 [4/4] and non-negotiable.** The practice destroys the information it
needs — *which wave, which task, what was approved* — unless position is externalized
first.

**Three authoring rules, all free:**

1. **Decisions carried into execution are phrased positively.** Not "rejected Redis" but
   "caching uses Postgres unlogged tables." Negation is weakly represented; the rejection
   carries the concept into context and the negation is the first part to decay.
   *The corrected form of this rule matters:* stated as "never write negations" it destroys
   disconfirming evidence, which is exactly the material that prevents bad decisions. The
   real distinction is **which context the material is loaded into** — a rejected concept
   in *execution* context resurfaces as an instruction; disconfirming evidence in
   *decision* context is what prevents the bad decision. Preserve it in full, quarantine
   it by rule 2.
2. **`design-context.xml` is not loaded during execution.** Absolute, not advisory —
   simpler to state, simpler to check, and it matches the quarantine thesis. The one
   plausible exception (an implementer asked to choose among recorded alternatives
   mid-task) is supersede/amend territory, not a reason to load it.
3. **Treat post-compaction memory as a dirty cache (R1 §4.7).** Long runs do not only fail
   by dilution; they fail by *summarization that drops the wrong things* — negations,
   non-goals, approval boundaries. The rule costs one sentence in `grace-execute` and the
   AGENTS template: *after any compaction or session boundary, do not trust the summary;
   reload the run cursor, the task slice, and the standing invariants.*

`grace context --compact` is nice and lower priority than all three rules.

### 4.7 Honest failure values in every reported verdict

**Evidence: E1 (6 of 19) — the best-supported item in the document. Consensus: [4/4] ship
early; [4/4] vocabulary alone is insufficient.**

Part of pattern 1 is calibration and unfixable. Part of it is **missing vocabulary**, which
is fixable: every report the executor could make was shaped as *done* or *failed*, and "I
asserted this without checking" maps to neither, so it was reported as done.

Applied to GRACE: verification rows report `pass | fail | not-run`; review outcomes admit
`unable-to-determine`; a task may complete `satisfied-unverified` against an acceptance
criterion it could not exercise.

**Resolution of R0 open Q10 — is vocabulary enough?** R0 was on the fence. All four
externals say no, and §3.1 above sharpens *why*, and *where the remaining gap actually is*:

- The binary **already** emits the honest value where it owns the surface
  (`assertion.command-not-evaluated`, fail-closed error) **(E2)**. That part is done.
- So the work splits cleanly:
  1. **Skill rule (free):** `assertion.command-not-evaluated` must be surfaced in the
     agent's report as `not-run`. It may not be summarized away, and a `pass` narrative
     over an unexecuted declared assertion is a reportable defect.
  2. **Vocabulary (free):** supply the missing words for the surfaces the binary does not
     own — review outcomes, AC satisfaction, self-review audit rows.
  3. **One new ratchet (small):** a change may not archive as `applied` while a declared
     command assertion is unexecuted, absent an explicit recorded user override. This
     enforces *using the word when command evidence was required* — not honesty in
     general, which is not enforceable.

**Centralize it (R3, adopted).** Every verdict-emitting skill needs the identical block.
Copying it into 16 skills guarantees drift, and the packaged mirror under
`plugins/grace/skills/` doubles it. It belongs in one shared `references/` fragment that
skills reference. This is the "centralized, not inlined" rule applied to this document's
own proposals — with a real open question attached (§7, Q17): whether the skill format
supports include semantics, and whether `validate-marketplace.ts` can enforce that a
shared reference stays byte-identical across importers.

**Do not wait for provenance.** Honest verdicts *produce* provenance; they do not require it.

### 4.8 Standing authority: precedence over the current plan

**Evidence: E4 + E3. Consensus: [4/4] — attribute, not a new artifact.** (R5 dissents by
restatement; see §3.4.)

The problem is real: when the user says "while you're in there," every artifact in
`.grace` describes *this* change, the user's instruction is about this change too, and it
is more recent. There is no artifact with standing above the conversation, so the
conversation always wins. §4.2's interrupt is a speed bump without something that outranks
the live message *and cannot be edited in flight*.

**Resolution:** elevate selected `INV-*` invariants (and principle statements in
`.grace/context/principles.xml`) with **scope and precedence fields** — project-wide,
immutable during a change, severity-pinned on conflict. Amendment requires a separate
change bundle, never a mid-flight edit.

Three properties matter more than the contents:

1. **It outranks the plan.** A conflict is resolved against the plan, not by reinterpreting
   the principle.
2. **It may not be amended in flight.** A command that hits a conflict may not dilute,
   reinterpret, or silently ignore it.
3. **Violations are severity-pinned, not judged** — removing the agent's discretion over
   how seriously to take it.

A first-class constitution file is the expensive on-ramp choice and should be revisited
only if teams need governance metadata (ratification dates, amendment-process prose) that
does not fit an invariant. What §4.2 needs is precedence, and precedence can be a field.

**Keep the E4 label.** No defect in the nineteen was scope drift. This is justified by a
failure mode the dataset structurally excludes.

### 4.9 Requirements-quality checks

**Evidence: E3 only — no E1 support. Consensus: [4/4] defer the agent surface, ship the
computable subset now.**

"Checklists are unit tests for English" is a good frame, and the strict form is right:
*"verify the button click navigates home"* is an implementation test and must be rejected;
*"is 'prominent display' quantified with specific sizing and positioning?"* is the correct
form. The re-validation ratchet (report before/after counts *including regressions* —
"12/16 → 15/16, CHK007 regressed") is the genuinely novel mechanic.

But this is the largest new agent surface and the item with no dataset support at all.
RM-POLYGLOT's defects were implementation defects against a plan that was good.

**What ships now, into `ngrace doctor` [4/4]:**

- `AC-*` with no task `Satisfies` and no `V-M-*` path
- `IC-*` with no owner or version
- `ST-*` with no evidence
- Anchors carrying unresolved typed holes
- (Later, once §4.4 lands) high `agent-inferred` ratio, and stale `verified-at`

These are graph queries, they are small, and they are the difference between a checklist
and a lint rule. The judgment-dependent remainder stays advisory and waits for evidence
that vague requirements are causing real defects here.

### 4.10 Run position as an artifact

**Evidence: E2 (a verified capability regression from GRACE 3) + E3. Consensus: [4/4] —
and all four externals raise its priority above R0's fifth place.** R1 puts it second or
third; R3 fourth; R4 in phase 2.

The argument for raising it is the strongest sequencing argument in the corpus:
**compaction is not an edge case, it is the normal long-run failure mode.** GRACE's best
reliability practice (§4.6) is *unsafe* until position is externalized, and the same gap
appears without any deliberate reload — a dead session or a context limit loses the
position just as thoroughly.

**This is a regression, not a missing feature — and all six inputs missed it.** GRACE 3's
`development-plan.xml` carried `implementationOrder` → `step` with a per-step `status`
attribute. That *was* a run cursor, and it worked. GRACE 4 did not merely decline to carry
it forward; it made the construct **illegal**:

| Rule | Where **(E2)** |
|---|---|
| `status` is legal **only on change artifact roots**; any nested element raises `artifact.forbidden-status-attribute` | `src/grace4/grammar.ts:167` |
| Root status vocabulary is coarse and partitioned by location — active `{draft, approved}`, archive `{applied, superseded}` | `src/grace4/grammar.ts:502–512` |
| `<ImplementationPlan><T-001>` carries `Title`, `DependsOn`, `Satisfies`, `AcceptanceCriteria`, `Verification` — **no status field** | `grace-plan/references/change-plan-template.xml` |

`<T-001 status="done">` does not merely fall outside the template. It fails lint.

**Why it went away, and why that was defensible.** This is the direct cost of the
immutability decision. GRACE 4 made the approved plan byte-stable, and a mutable per-step
marker *inside* the approved document is exactly what byte-stability forbids. v3 could
carry position in the plan because v3's plan was not immutable. **GRACE 4 bought
immutability and paid for it by deleting the position marker, then never built the
replacement.** For four versions position has lived in the conversation.

That reframes this proposal. It is not "add a capability GRACE never had." It is **restore
a capability that demonstrably worked in v3, this time outside the immutable document** —
which is a materially stronger justification than the dataset-silent E4 argument the
inputs relied on.

**Corroborating detail (E2):** `grace-migrate` instructs the agent to "list ambiguities and
unsupported structures rather than guessing," and there is no mapping for
`implementationOrder` anywhere in the repository. A v3 project migrating to v4 has its step
statuses classified as unsupported and dropped, with no destination and no skill text
naming the loss.

**Shape:**

```
.grace/changes/active/C-*/run.xml     # sibling to plan.xml, never inside it
```

Properties that matter more than schema elegance:

1. Readable without the agent that wrote it — a file, a fixed state vocabulary, and
   machine-readable output.
2. Mutates freely; the approved plan stays byte-stable.
3. `paused-pending-approval` is a **normal state**, not a failure.
4. `ngrace status` surfaces the cursor so humans and agents share one answer to *where are we?*
5. **Records what was approved, by whom, and against which evidence** (R1 open Q12) — or
   "explicit apply confirmation" remains a conversational ghost across sessions.
6. **Referentially checked against its plan** — see the drift constraint below.

**Resolution of placement (R0 open Q9): forced, not preferred.** The externals split
[3/4] for a bundle-local sibling file against R4's top-level `.grace/runs/`. The grammar
settles it: `artifact.forbidden-status-attribute` makes a per-task marker inside
`plan.xml` schema-illegal **(E2)**, so the only options that do not require repealing that
rule are the two the externals already proposed. The losing option — v3's — is the one
nobody argued for.

Within the legal set, the majority reasoning stands: the bundle is the unit of work, the
cursor is position within that unit, and archiving the bundle should archive the cursor,
which is exactly the historical record of *what actually happened* that the amendment trail
exists to preserve. So: `run.xml`, sibling to `plan.xml`, inside the bundle directory.
R4's concern is not baseless and resurfaces for parallel execution; recorded as Q19.

**A constraint v3 got for free and v5 must pay for.** v3 had one document: position lived
on the step it described, so position and plan could not disagree. v5 will have two —
`plan.xml` naming tasks, `run.xml` naming position — which creates a drift surface with no
v3 analogue. A cursor pointing at `T-007` in a plan with six tasks, or at a task removed by
a supersede, is a new class of lie in exactly the place this track is trying to eliminate
lies. **`run.xml` therefore requires a referential-integrity lint against its plan**, and
that check should ship with the cursor rather than after it. This is the price of keeping
the approved plan byte-stable, and it is worth paying — but it should be named in the plan,
not discovered in execution.

**Adopt R3's architectural invariant, the best structural contribution in the external
set.** The binary is read-only today — `grace-doctor` documents it explicitly (*"Must not
write to the filesystem"*). The run cursor is the first proposal that requires the binary
to *write*. That should be a deliberate, stated exception, not a slippage:

> **The binary writes only the run cursor and approved-bundle state transitions. It never
> authors content.**

Without that invariant stated, the slope leads to the binary writing specs, which inverts
the whole architecture. R3's suggested mechanization — an `ngrace cursor`
(`show`/`advance`/`pause`/`resume`) family as the *sole* write surface — makes the rule
machine-checkable: a lint rule forbidding filesystem writes outside the cursor module.

---

## 5. Additional proposals from the external reviews

Items not in R0, ordered by consensus strength.

### 5.1 A full-lifecycle on-ramp — **[6/6], the most agreed item in the corpus**

Every input raises it; R0 raises it against itself. `examples/polyglot` is CI-verified and
does what it claims as a golden path, but it governs three files and teaches *mechanics*,
not *judgment*. A newcomer adopting GRACE on their own project needs answers to questions
the documentation does not currently address: how to choose which modules to declare; what
belongs in context vs. graph vs. verification; how to recover when `ngrace lint` fails with
an unfamiliar code; how to pick a ceremony tier.

**Proposal:** before any second layer of user-visible ceremony ships, the walkthrough should
carry one complete change lifecycle a newcomer can feel — approve → execute one task with a
sliced context → hit a scope amendment → see a `not-run` verdict → pass a detached review.

**Treated here as a blocking constraint on Wave 3, not an aside.**

### 5.2 A published host-capability matrix — **[3/4: R1, R2, R3]**

Two of this document's central guarantees are host-dependent: detached read-only review
(§4.3) and any live write interrupt (§4.2). GRACE must publish the minimum host capability
it assumes and what degrades without it.

| Layer | Owns |
|---|---|
| **CLI (portable)** | Context emit, scope check, run cursor read/write, coverage attribution, doctor metrics, deterministic review inputs |
| **Skills (portable)** | When to call the CLI, interview loop, adversarial probe judgment, user-facing explanation |
| **Host adapters (optional)** | Pre-tool write guards, tool-level read-only enforcement, subagent spawn with empty transcript |

**The rule:** if a reliability guarantee requires a host-specific hook, it is an adapter
feature, not a GRACE guarantee, and the docs must say so. Selling a hard stop that only
works in one host is a paper guarantee everywhere else — and, precisely, a confident claim
that was never checked.

### 5.3 Reliability mechanisms by ceremony tier — **[R2, revised per §3.3]**

R2's matrix is needed; its axis must change from *existence* to *depth*, because tiers may
not gate-skip **(E2)**.

| Mechanism | T0 hotfix | T1 | T2 | T3 |
|---|---|---|---|---|
| Honest verdicts (§4.7) | Full | Full | Full | Full |
| Scope recording / amendment trail (§4.2) | Full | Full | Full | Full |
| Run cursor (§4.10) | Full | Full | Full | Full |
| Context slices (§4.1) | Optional | Default | Default | Default |
| Detached review (§4.3) | Mechanized audits only | Mechanized + probe | Full | Full + fixpoint rerun |
| Provenance (§4.4) | Typed holes only | Typed holes | Full | Full + freshness |
| Coverage attribution (§4.3) | — | Optional | Default | Default + opt-in mutation |
| Requirements checklists (§4.9) | — | — | Doctor subset | Doctor subset + advisory |

The invariant: **T0 may not skip honesty or scope recording.** It may skip depth — the
adversarial probe, the mutation audit, the checklist. If tiers today only change section
depth, reliability gates need this table explicitly, or in practice everything becomes T3
and the tiers stop meaning anything.

**Related, unresolved (R2):** none of the inputs estimates the token cost of any mechanism.
Token cost is the primary adoption friction for AI coding methodologies; a methodology that
doubles tokens per change is abandoned at scale regardless of correctness. Each mechanism
should carry a rough budget before it ships.

### 5.4 A reliability evaluation harness — **[2/4: R1, R2, both emphatic]**

You cannot improve agent reliability without a regression suite for *agent behavior*. Unit
tests for the CLI are necessary and insufficient. Minimum viable:

- A small library of **fixture projects paired with defective diffs**, drawn from the five
  patterns: symmetric tests, missing mutation defense, out-of-scope files, `not-run`
  claimed as `pass`, an anchor family not threaded through an older guarantee.
- Scripts that invoke the skills' expected CLI evidence and score: did the scope audit
  fire? did the honest verdict appear? did the reviewer stay read-only?
- **Determinism tests** for the reviewer: two runs, no intervening change, diff the finding
  IDs and counts.
- **Slice-correctness tests** for `grace context --task`: a known graph and task, assert the
  slice contains exactly the expected anchors.

Without this, reliability work is another confident report — which is the failure mode the
track exists to eliminate. `examples/polyglot` is the existing pattern for this style of
CI-verified deliberate breakage; extend it rather than inventing a second one.

### 5.5 Dogfood: a thin `.grace` self-migration — **[4/4 that it should happen; disagreement on when]**

| Input | Position |
|---|---|
| R3 | **First**, as a prerequisite. The repo's own roadmap is currently an honor system — a hand-maintained markdown index with manual status-agreement rules — which is precisely what GRACE exists to replace |
| R4 | Before reliability implementation |
| R1 | Thin migration soon after the first two or three items |
| R2 | After §4.7 and §4.1 ship, so the rest is tested on a real project |

**Resolution: Wave 1, at its head** — after the free skill-text work, before any CLI
context or cursor work. The reasoning that decides it is R3's: every proposal developed
without a real `.grace` project is developed against fixtures, and the dataset's central
lesson is that fixtures pass while reality breaks. The run cursor and context slices in
particular should be designed against this repo's actual change flow, not a synthetic log.

**Thin means thin:** context and graph for the CLI and skills packages, plus one active
change for the next reliability slice. Not a heroic full markup of every adapter.

**The bootstrapping caveat (R3), adopted:** migrate *now* with 5.0.1 tooling, which is
honest and enforced today; then retrofit the reliability features onto the migrated repo as
a sequence of `C-*` bundles, each eating its own dog food as it lands. Do not attempt to
migrate using tools that do not exist yet.

### 5.6 A multi-agent and parallel-execution consistency model — **[2/4: R1, R2]. E4.**

`grace-execute` already ships a parallel-safe mode with preflight, and
`grace-setup-subagents` scaffolds worker and reviewer presets **(E2)** — yet every proposal
in §4 is written as though one agent walks one task. The gaps:

- **Stale reads** — the reviewer reads a plan the implementer is still writing, and passes
  a snapshot that was already stale.
- **Per-worker context slices** with no silent union of observed scopes.
- **A shared run cursor** that can record multiple in-flight task IDs (which reopens the
  placement question — see Q19).
- **Findings attached to task IDs**, not only to the change.
- **Approval races** — two agents setting `status="approved"` on artifacts that reference
  each other.

Ignore this and the reliability work re-breaks the first time someone uses the parallel path
for real. It does not need to be solved in Wave 1, but it should not be silently assumed
away either.

### 5.7 The defect log as a living product artifact — **[R1; complements R3]**

§2.2's strongest finding is that concrete worked failures outperformed abstract rules — and
the defect log that proved it currently lives inside an *archived* plan, where by the repo's
own governance it may never be edited again. That is how pattern memory dies.

**Proposal:** a short, versioned defect log (`docs/defects/` or a shared skill reference)
that the self-review skill is required to consult, and that new defects append to.

**R3's complement:** link the lint catalog to it. Each code in `src/lint/catalog.ts` carries
a `derivedFrom` reference to the defect that motivated it, or a `proposedBy` reference to a
pattern in §2.1. This makes the catalog auditable against evidence by the same standard
applied to everything else, and makes §6's "delete anything not justified by a failure" rule
machine-checkable: a code with neither reference is a deletion candidate.

**Open sub-question (R3):** does the lint catalog host *process* checks, or does that
conflate artifact integrity with execution integrity? Lean: keep them separate — `lint`
stays artifact-only, a `review` surface carries process checks — but share the
evidence-linking convention so both audit the same way.

### 5.8 Executor determinism as a plan-quality metric — **[R3 only. Speculative, cheap, novel.]**

§4.3 imports determinism-via-rerun for the *reviewer*. R3 observes a deeper axis nobody
measures: **the same plan, executed twice from identical baselines by two fresh instances,
should produce compatible diffs.** Where they diverge, either the plan left a judgment open
(a plan-quality signal, feeding §4.9 with the dataset support it currently lacks) or the
model is stochastic in a way that matters (a capability signal for `doctor`).

Cheap to instrument once §4.10 and §5.5 exist. **Honest caveat, R3's own:** separating
"diverged because underspecified" from "diverged because stochastic" is not possible from a
single pair of runs; it needs ≥3 runs and a majority notion. Worth a tiny experiment before
any design.

### 5.9 Skill ordering in the manifest — **[R3 only. Packaging, cheap.]**

A user installing the plugin gets 16 skills as a flat array **(E2:** `marketplace.json`**)**.
The README carries the ordering (init → spec → plan → execute → …); the install does not. An
agent discovering skills by name must have read the README to know `grace-plan` follows
`grace-spec`. A declared `requires` / `precedes` graph, validated as acyclic by
`validate-marketplace.ts`, is packaging work rather than methodology work and is cheap.

Contingent on Q18 (whether the plugin schema supports inter-skill metadata); if it does not,
the graph lives in one centrally-referenced skill.

---

## 6. Reconciled sequencing

Four different orderings were proposed (R0, R1, R3, R4). They disagree mainly on two axes:
whether §4.3's mechanized audits precede §4.7's vocabulary, and whether self-migration comes
first. The wave structure below honors both sides of the first disagreement — vocabulary is
free and lands immediately; nothing load-bearing depends on it until the mechanized audits
exist alongside it — and takes a position on the second.

### Wave 0 — free (skill text and docs only; no schema, no CLI)

| # | Item | § |
|---|---|---|
| 0.1 | Honest verdict vocabulary in **one shared reference fragment**; skill rule that `assertion.command-not-evaluated` must be reported as `not-run` | 4.7 |
| 0.2 | Typed holes: `[NEEDS CLARIFICATION]` / `ASSUMPTION` markers | 4.4 |
| 0.3 | Context hygiene authoring rules; absolute `design-context.xml` exclusion during execute; post-compaction dirty-cache rule | 4.6 |
| 0.4 | Progressive-disclosure lists in skills — the prompt version of context slices, **instrumented** for before/after context size | 4.1 |

### Wave 1 — foundations

| # | Item | § |
|---|---|---|
| 1.1 | **Thin `.grace` self-migration of this repo**, using 5.0.1 tooling | 5.5 |
| 1.2 | Run cursor + `ngrace cursor` as the binary's **sole write surface**; approval record in the cursor; **referential-integrity lint of `run.xml` against its plan, shipped with it** | 4.10 |
| 1.3 | Standing authority as a scope/precedence attribute on `INV-*` — not a new file | 4.8 |

Wave 1 unblocks the transcript-discard practice and gives §4.2 something to cite.

### Wave 2 — evidence-producing mechanisms

| # | Item | § |
|---|---|---|
| 2.1 | Mechanized audits: scope diff, test-weakening diff, backward-compat fixture sweep — read-only, machine evidence | 4.3 |
| 2.2 | Detached reviewer skill: separate instance, read-only by tool permission, **deterministic finding IDs**; publish the host capability matrix alongside it | 4.3, 5.2 |
| 2.3 | Hunk coverage attribution (**not** full `grace mutate`) | 4.3 |
| 2.4 | Reliability evaluation harness — fixtures, defective diffs, determinism tests | 5.4 |

### Wave 3 — user-visible surfaces

**Blocked on §5.1: the full-lifecycle walkthrough lands before or with this wave.**

| # | Item | § |
|---|---|---|
| 3.1 | `unrequested` gap check + `ngrace amend` append-only amendments | 4.2 |
| 3.2 | `grace context --task` — graph-minimal body, purpose header from approved anchors | 4.1 |
| 3.3 | Doctor subset of requirements-quality checks | 4.9 |
| 3.4 | Reliability tier table published | 5.3 |

### Wave 4 — schema and interview

| # | Item | § |
|---|---|---|
| 4.1 | Provenance fields + `verified-at` freshness; doctor consumes both | 4.4 |
| 4.2 | Interview redesign: budget, coverage scan, recommended answers, artifact-backed clarification queue | 4.5 |
| 4.3 | `grace context --compact` | 4.6 |

### Deferred, with reasons

| Item | Reason |
|---|---|
| Live pre-write interrupt | Host adapter only; never a portable GRACE guarantee (§3.2, §5.2) |
| Full `grace mutate` | Slow and flaky; coverage attribution first, deep audit opt-in |
| Full §4.9 checklist agent | No dataset support; the computable subset ships in Wave 3 instead |
| Executor-determinism metric | Needs §4.10 + §5.5 and a ≥3-run experiment before design (§5.8) |
| Multi-agent consistency model | Real (§5.6), E4, and should not block Wave 1 — but must be addressed before parallel execution is documented as supported |

### Non-negotiable constraints

Two from R0, two added by the externals and adopted:

1. **§4.2 does not ship before §4.8.** An interrupt with nothing to cite is a speed bump.
2. **The transcript-discard practice is not documented before §4.10 exists.** A practice
   that destroys the state it needs.
3. **No proposal that *enforces* a behavior may ship as skill text alone (R3).** If it can
   be skipped and lied about, it needs a binary component or it does not count as
   enforcement. This generalizes §4.3's governing principle to the whole track.
4. **The binary's read-only invariant is broken only for the cursor (R3).** Stated
   explicitly, or the architecture inverts.

---

## 7. Open questions

### 7.1 Resolved by this consolidation

| # | Question | Resolution | Basis |
|---|---|---|---|
| Q1 | Does `grace mutate` justify its cost? | No, not as v1. Hunk coverage attribution first; revert-and-rerun as opt-in deep audit | [4/4] |
| Q2 | Hard stop or prompt on scope drift? | Prompt + recorded choice interactively; fail closed non-interactively; hard stop only when a project-scope invariant is cited | Reconciled from four positions |
| Q3 | Where does `<ScopeAmendment>` live? | Sibling artifact in the bundle directory. Approved `plan.xml` stays byte-stable | [4/4] |
| Q4 | Provenance per-anchor or per-field? | Declare coarse (per-anchor), **derive fine** in the CLI; explicit per-claim only on high-risk surfaces | R3 + R1, adopted |
| Q5 | Self-migrate before or after? | Wave 1, at its head: after free skill work, before CLI context/cursor work. Migrate with 5.0.1 tooling, retrofit features as `C-*` bundles | [4/4] direction, timing reconciled |
| Q6 | Standing authority: new artifact or `INV-*` attribute? | Attribute. A constitution file only if governance metadata demands it | [4/4] |
| Q7 | Graph-minimal or independently-demonstrable slice? | Graph-minimal body + purpose header verbatim from task Summary and `AC-*`; scenario text flag-gated and later | [4/4] |
| Q8 | How much of §4.9 is computable? | Enough for a useful doctor subset now; the judgment remainder waits for evidence | [4/4] |
| Q9 | Run cursor inside the bundle or beside it? | Inside the bundle directory, outside the approved plan document — `run.xml` next to `plan.xml`. **The grammar forces the "outside the plan document" half**: a per-task status attribute is schema-illegal (`artifact.forbidden-status-attribute`). Only the bundle-local vs. `.grace/runs/` choice was ever open, and the majority takes bundle-local | [3/4, R4 dissents] + **E2** |
| Q10 | Is vocabulary enough for §4.7? | No. But the missing enforcement is smaller than assumed: the binary already emits the honest value where it owns the surface (§3.1). Add a skill rule, vocabulary for unowned surfaces, and one archive-time ratchet | [4/4] + E2 |
| Q11 | Is a live pre-write interrupt implementable? | Yes in Claude Code (`PreToolUse` hooks); no portably. Adapter, not guarantee | E2 / §3.2 |
| Q12 | Is fresh-context review enforceable or only instructable? | Enforceable in Claude Code (cold subagent context + tool allowlist); degrades to honor system elsewhere. Publish the matrix and label the guarantee conditional | §4.3, §5.2 |

### 7.2 Still open — decide before `plan.md`

| # | Question | Why it matters |
|---|---|---|
| Q13 | **What is the success metric for this track?** Candidates: (a) defect density on a fixed multi-phase fixture plan; (b) ratio of honest `not-run` to false `pass`; (c) reviewer determinism; (d) out-of-scope writes reaching apply. **Recommend two: (c) as a hard binary gate — it is pass/fail and cheap — and (a) as the trend metric.** | Without one, this track ships features and *claims* improvement, which is pattern 1 applied to the roadmap |
| Q14 | Should detached review **block** `applied`, or only advise? | Advisory gets skipped under schedule pressure, exactly as heavyweight supersede did. Blocking needs a documented escape with a recorded override for T0 and hotfixes |
| Q15 | Do typed holes block plan approval, execution, or only doctor? | Blocking approval is purest and most annoying; doctor-only is the weakest. Middle: block `--assertions final` / apply while holes remain on `AC-*` the change claims to satisfy |
| Q16 | What happens when a **mechanism itself** fails — an empty slice, a false-positive scope interrupt? | Fail-closed is the house style, but stopping on a false positive is how mechanisms get disabled. Needs a stated degradation path per mechanism |
| Q17 | Does the skill format support include/import semantics for a shared reference block? | If not, the §4.7 vocabulary is physically copied into 16 skills and again into the packaged mirror — guaranteed drift. `validate-marketplace.ts` compares whole files today and would need a byte-identity check across importers |
| Q18 | Does the plugin/marketplace schema support inter-skill metadata (`requires` / `precedes`)? | Determines whether §5.9 is a manifest change or a centrally-referenced skill |
| Q19 | Parallel run cursor: one document with multi-task state, or per-task shards? | One document is easier for humans; shards reduce write contention. This is also where R4's dissent on Q9 resurfaces. Decide before implementing §4.10 if parallel-safe stays a first-class mode |
| Q20 | Retention: when do run cursors and amendment trails archive? | Flow-forward immutability argues they archive **with** the bundle, as the historical record of what actually happened — which is precisely the anti-lie property amendments exist for |
| Q21 | Do the five patterns hold on a second model family? | The dataset is one executor. Pattern 1 and pattern 3 may be training-distribution artifacts. Validate before advertising them as general findings |
| Q22 | What is the token budget per mechanism? | Token cost is the primary adoption friction; no input estimated it (§5.3) |
| Q23 | Do provenance and `exact \| heuristic` unify into one vocabulary? | Both answer *how sure is this claim?* Two vocabularies for one question is a design smell, and it is a shared surface with RM-LANGUAGE-EXTENSIBILITY |
| Q24 | **What else did the 3→4 immutability trade drop without a replacement?** The run cursor (§4.10) was a v3 capability deleted as a known cost of byte-stable plans, and no input to this document noticed — it surfaced only from a direct question about v3's `implementationOrder`. That is one find from one probe, which is weak evidence that it is the only one | An explicit v3-vs-v5 capability audit is cheap and bounded. Finding the next one the same way we found this one is not a strategy. `grace-migrate` is the natural home for the output: today it has no mapping for `implementationOrder` at all, so v3 step statuses are silently unsupported |
| Q25 | Should `run.xml` be reconstructible from evidence if lost or corrupted? | v3's position was a property of the plan and could not go missing independently. A separate cursor can. Partial reconstruction from lint history, git, and applied assertions may be possible; if it is not, the cursor becomes a new single point of failure for exactly the long runs it exists to protect |

---

## 8. Considered and set aside

Recorded as positive statements about what was chosen, per §4.6 rule 1.

| Question | Decision |
|---|---|
| Source of interview uncertainty | Compilability into a failing check, because it is observable and cannot be gamed by the model |
| Home of the self-review protocol | A skill separate from `grace-execute`, invoked with plan and diff only, because detachment is the property that makes review work |
| Handling of mid-flight scope change | Append-only amendment with a one-line command, because an immutable-or-supersede-only path is heavy enough that teams bypass it |
| Anti-pattern guidance format | A defect log of worked failures with consequences, because it measurably outperformed the abstract rule list |
| Placement of cross-cutting mechanisms | Centralized, with skills referencing them, because inlining costs a permanent prompt tax proportional to the number of commands |
| Treatment of disconfirming evidence | Preserved in full and quarantined in `design-context.xml`, because the material that prevents a bad decision is exactly what a naive "no negations" rule deletes |
| Scope of the discovery track | Out of scope. spec-kit's `assess` pipeline sits *before* specification; GRACE begins after "is this worth building" is settled. The transferable parts — forced counter-evidence and honest verdicts — are taken without the pipeline |
| Persistence model | Flow-forward: completed bundles are immutable historical records and change arrives as a new bundle. Worth stating explicitly in product docs, because Q3, Q9 and Q20 are all consequences of it |
| Relationship to RM-LANGUAGE-EXTENSIBILITY | Kept separate. Different evidence, different completion times. The one shared surface is confidence vocabulary (Q23) |
| Reliability grammar | No large new anchor family. Reliability is mostly loop and evidence, not more anchors |
| Self-reported confidence as a signal | Rejected everywhere, not only in interviews. Pattern 1 generalizes |

---

## 9. Bottom line

After 5.0.1, `neo-grace` is a serious and unusually rigorous agent-engineering
methodology whose remaining reliability debt is concentrated in **the agent loop, not the
artifact model**. All six inputs converge on that diagnosis, and the disagreements among
them are about sequencing and mechanism shape, not direction.

Four things this consolidation changes relative to the inputs:

1. **The §4.7 gap is smaller and better-located than described.** The binary already
   refuses to report `pass` for evidence it does not have. The remaining dishonesty lives
   in the surfaces the binary does not own — and the fix pattern is *the binary computes
   the honest value; the skill is forbidden to soften it*.
2. **Detachment is enforceable in the primary target harness, and only there.** That
   turns R3's blocking question into a documentation obligation rather than a design
   crisis, and it makes the host-capability matrix (§5.2) a prerequisite for honest
   marketing rather than a nicety.
3. **Self-migration moves earlier than R0, R1, or R2 placed it** — to the head of Wave 1 —
   because every mechanism designed against fixtures inherits the dataset's central lesson
   in the wrong direction.
4. **The run cursor is a regression, not a gap.** GRACE 3 had a working per-step position
   marker; GRACE 4 made it schema-illegal as the price of byte-stable approved plans and
   never shipped the replacement. No input to this document noticed. That upgrades §4.10
   from a dataset-silent E4 argument to a verified E2 one, forces half of Q9's answer, and
   raises the question of what else that trade dropped (Q24).

**If only five things were funded:**

1. Honest verdict vocabulary, centralized, plus the `not-run` reporting rule (§4.7)
2. Run cursor as durable position, with the binary's write invariant stated (§4.10)
3. Detached, read-only, deterministic self-review with mechanized scope and test audits
   (§4.3) — plus the evaluation harness that proves it works (§5.4)
4. Thin `.grace` self-migration, so the next defects are found in-house (§5.5)
5. Task context slices — prompt discipline first, measured, then the command (§4.1)

**And the failure mode to avoid**, which R0 named against itself and every external review
independently confirmed: shipping another layer of capability before the tutorial and the
agent loop can carry the weight of what 5.0 already shipped.

---

## 10. Sources

**Consolidated from:**

- `docs/plans/active/RM-AGENT-RELIABILITY/review.md` (R0, 2026-07-28)
- `../grace-review/future_enhancements_review_{1,2,3,4,5}.md` (R1–R5, 2026-07-29)

**Verified against (E2 claims):** `src/grace.ts`, `src/grace4/assertions.ts`,
`src/grace4/grammar.ts`, `src/grace-status.ts`, `src/lint/catalog.ts`, `src/grace-doctor.ts`,
`skills/grace/*/SKILL.md`, `skills/grace/grace-plan/references/change-plan-template.xml`,
`.claude-plugin/marketplace.json`, `CLAUDE.md`, at 5.0.1 on 2026-07-29.

**Not verifiable here:** the GRACE 3 schema. This repository contains no v3 artifacts and no
mapping for `implementationOrder`. The v3 side of §4.10 is reported as described by the
maintainer; the v5 side — that a per-task `status` attribute is schema-illegal — is verified
above. Q24 proposes closing that verification gap properly.

**Prior art read (E3):** the local `spec-kit` checkout at commit `be33d2a` —
`templates/commands/{analyze,clarify,checklist,converge,implement}.md`,
`templates/{spec,tasks,constitution}-template.md`,
`docs/concepts/{spec-persistence,spec-of-specs,complex-features}.md`,
`docs/guides/evolving-specs.md`, `docs/reference/workflows.md`, and the
`assess`/`bug`/`agent-context` extensions.

**Dataset (E1):** `docs/plans/archive/RM-POLYGLOT-ENFORCEMENT/plan.md` §0.7 and §10.1a —
the self-review protocol and the nineteen-defect log.

This document does not re-run the CLI against fresh fixtures. E2 claims are source-grounded
in the repository as read on 2026-07-29; everything else carries its tag.
