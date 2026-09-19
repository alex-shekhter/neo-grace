---
kind: discussion
status: draft
normative: false
created: 2026-09-19
reviewedAgainst: 6dd1d953652775f3dc25095e4f249b37876b9cb6
---

# Autonomous agents, neo-grace, and Sashimi

This document collects proposals for discussion. It is not an approved roadmap,
change specification, or authorization to implement them. It does not change the
scope or instructions of an executor already in flight.

## Direction

The intended direction is a system in which automatic agents handle most of the
work, including inexpensive, fast, and local models whose instruction-following
can be unreliable.

**Sashimi is the planned agent orchestration platform/harness. Neo-grace should
be part of Sashimi in the future.** Sashimi's plans have not yet been supplied to
this review. The integration boundary below is therefore a proposal to reconcile
with those plans, not a claim about Sashimi's existing design or capabilities.

The main recommendation is to move procedural responsibility from the model into
a deterministic controller and give implementation agents small tasks with
limited authority. A model proposes and implements a change; the controller
manages procedure; an independent examiner judges the evidence. Human authority
remains explicit wherever it has not been deliberately delegated.

Neo-grace's documentation already supports this direction. The governed-path
review identifies repeated operating manuals as a missing product feature, and
the reliability review separates CLI mechanics, agent judgment, and host
enforcement:

- [Governed-path reasoning, §2.3](plans/active/RM-GOVERNED-PATH/review.md#23-the-strongest-evidence-in-the-corpus-is-not-any-review)
- [Reliability review, §5.2](plans/archive/RM-AGENT-RELIABILITY/review-consolidated.md#52-a-published-host-capability-matrix--34-r1-r2-r3)

Those documents contain dated evidence and proposals. Their descriptions of the
product must be checked against the implementation before becoming requirements.

## Proposed division of responsibility

| Component | Proposed responsibility |
| --- | --- |
| neo-grace | Contracts and artifacts; graph navigation; task context; structural validation; lifecycle operations; evidence records; review diagnostics; machine-readable preconditions and results |
| Sashimi | Agent dispatch and model selection; isolated workspaces; tool permissions; scheduling; retry and escalation orchestration; interruption recovery; delivery of context; collection of host execution evidence |
| Examining agent or operator | Semantic judgment, independent probes, assessment of verification quality, and verdicts within explicitly granted authority |
| Human authority | Goals, consequential policy and scope decisions, approval requirements, and the boundaries of any delegation |

The integration should preserve neo-grace's usefulness as a portable CLI and
methodology outside Sashimi. It should also identify which stronger guarantees
require Sashimi or another capable host. A host-dependent permission boundary
must not be advertised as an unconditional CLI guarantee.

## Architectural alternatives considered

| Direction | Pros | Cons |
| --- | --- | --- |
| Improve skills and examples alone | Cheap, portable, immediately useful | Correct execution still depends on instruction-following |
| Supervise agents through neo-grace's CLI and structured interfaces | Automates sequencing, bounds worker authority, reuses current artifacts | Requires host integration and careful recovery design |
| Build a complete orchestration platform inside neo-grace | Direct control over dispatch, permissions, approval, and evidence | Much larger product and adoption burden; would overlap the planned Sashimi responsibility |

**Recommendation:** develop the interfaces and lifecycle guarantees that let
Sashimi supervise neo-grace work. Prototype the smallest useful integration once
the Sashimi plans are available. Building a second orchestration platform inside
neo-grace loses to that approach because it duplicates the planned harness and
forces platform decisions before the integration boundary has been reviewed.
Skill improvements remain useful, but cannot carry the enforcement burden alone.

## 1. Publish an unambiguous view of the current rules

An agent can read “gates never author status” in RM-GOVERNED-PATH's load-bearing
walls and find the later D18 decision making `gate approve` the status writer.
The history is legitimate; reconstructing which rule applies requires reasoning
that every new worker should not have to repeat.

Sources:

- [RM-GOVERNED-PATH plan, §3](plans/active/RM-GOVERNED-PATH/plan.md#3-load-bearing-walls--do-not-touch)
- [D18](plans/active/RM-GOVERNED-PATH/rulings-retired.xml), especially its explicit
  explanation of what changes about D1
- [Verified approval, §6](plans/active/RM-VERIFIED-APPROVAL/review.md#6-why-it-is-not-scheduled),
  which distinguishes the shipped fingerprint mechanism from the remaining
  authorization problem

**Proposal:** generate a concise reference for the rules that apply now, with
links to their originating and modifying decisions. Distinguish requirements in
force, implemented behavior, and proposals. Include the applicable product or
protocol version. Keep historical documents intact.

Retirement of a record entry means its disposition has been recorded; it must
not accidentally make a codified rule disappear from the current-policy view.

**Benefit:** weaker models stop having to reconcile history. **Cost:** relationships
between decisions must become structured and maintained. A generated view must
have an authoritative source and validation, rather than becoming another copy
of the rules that can drift.

## 2. Make lifecycle sequencing a controller protocol

Neo-grace already has status, context, gates, cursor operations, command evidence,
and lifecycle writers. The proposal is to compose and expose these reliably for
a controller, not to claim they are missing or introduce a competing lifecycle.

A controller should receive structured answers identifying:

- the next permitted operation or set of operations;
- the actor authorized to perform each operation;
- the evidence and approval it requires;
- the state or artifact fingerprint against which it was derived;
- any blocker and its supported recovery route.

Mechanical sequences should be resumable and safe to retry after interruption.
A stale instruction should be rejected or recomputed against the new state.
Semantic completion remains a judgment by an authorized examiner; successful
process execution alone must not manufacture it.

This develops the [P3 lifecycle objective](plans/active/RM-GOVERNED-PATH/plan.md#p3--lifecycle-mechanics-and-evidence-honesty--objectives-detail-when-p0p2-land).
That section contains historical command proposals whose functionality has
partly arrived under other names. Derive the remaining work from current code,
not from the absence of a particular proposed command name.

**Benefit:** fewer opportunities to skip or reorder steps. **Cost:** partial
failure, repeated invocation, and stale-state behavior become explicit product
contracts. The supersede and membership investigation underway when this note
was written illustrates why those contracts matter; it remains its own work.

## 3. Give workers complete, bounded task packets

Extend the existing task context slice into the worker's operational interface:
purpose, acceptance criteria, relevant contracts, allowed writes, verification
commands, and stop conditions. Bind the packet to the approved artifact revision.

The archived reliability discussion distinguishes minimal context from enough
context to understand a task's purpose. The design-evidence proposal also argues
for delivering behavior descriptions that the receiving agent can consume:

- [Context-slice reasoning, §3.1](plans/archive/RM-AGENT-RELIABILITY/review.md#31-task-scoped-context-slices--grace-context---task-t-001)
- [Behavior descriptions, §2.2](plans/active/RM-DESIGN-EVIDENCE/review.md#22-the-behaviour-text-is-the-agent-facing-artifact)

For Sashimi, discuss an explicit handoff contract covering the worker's required
capabilities, context budget, source revisions, and allowed operations. If a
packet does not fit or cannot deliver a required reference, surface that absence;
do not silently truncate requirements or assume the model can reconstruct them.

**Benefit:** less memory and interpretation required. **Cost:** an incomplete
packet becomes a controller/product defect, so packet completeness and freshness
need verification. This should remain a derived transport representation of the
canonical artifacts, not a second independently authored source of truth.

## 4. Let the host enforce worker permissions and collect evidence

An implementation worker should receive access to its task workspace, while
approval, shared governance, and final verdict operations belong to separate
roles. A cold reviewer should inspect the actual diff and independently
collected evidence. Running a command and recording its result should be a
controller operation wherever possible, building on neo-grace's existing
command-run evidence rather than trusting a worker's summary.

The [existing rejection of CLI-only sandbox enforcement](plans/active/RM-GOVERNED-PATH/plan.md#5-rejected-with-reasons)
is a constraint to preserve: a shell-capable agent can bypass a restriction
implemented only in a CLI wrapper. Enforcement belongs in a capable host or
isolated environment. A separate prompt declaring “read-only” is not itself
such a boundary.

Sashimi should report the capabilities actually enforced. Where isolation or
independent review is unavailable, the record should state the weaker guarantee;
the authorized policy decides whether that mode may proceed.

**Benefit:** an ignored instruction has a smaller consequence, and evidence is
less dependent on self-report. **Cost:** guarantees become host-specific, and
the controller's own evidence collection must be tested. An exit code still
does not prove that the chosen test checks the right behavior.

## 5. Resolve delegated authority before increasing autonomous approvals

Verified approval already recognizes that an agent cannot be its own independent
authority. D37 explicitly discusses third-party authorization for autonomous
agents:

- [Verified approval, §§3–4](plans/active/RM-VERIFIED-APPROVAL/review.md#3-the-shape-that-does-work)
- [D37](plans/active/RM-GOVERNED-PATH/rulings-retired.xml), including the distinction
  between authorship, authorization, ratification, and execution attestations

**Discussion question:** can a human authorize a bounded class of work, with
explicit scope, evidence requirements, escalation conditions, and revocation,
while reserving consequential changes for direct approval?

Such delegation would be a new policy decision. It is not permission for today's
executor to self-approve, change approved artifacts, or infer a broader grant
from a task brief. A fingerprint binds bytes; by itself it does not establish
who authorized those bytes.

**Benefit:** fewer routine human interruptions. **Cost:** defining and verifying
the delegation is harder than collecting an approval phrase. The credential or
policy authority must sit outside the worker's control.

Pilot approval alone does not resolve this. Its proposal increases amendment
opportunities while requiring re-ratification, and the documentation already
identifies the tension with approval fatigue:
[Pilot, §5](plans/active/RM-PILOT-APPROVAL/review.md#5-open-questions).
The unit of authorization needs to be discussed jointly with pilot, without
silently treating either exploration as approved.

## 6. Measure cost per independently accepted change

Compare the current workflow with supervised workers on ordinary projects,
including projects outside neo-grace itself. Measure the full set of runs in a
defined cohort, not selected successes.

Useful observations include:

- human interventions and authority effort;
- model and runtime cost, including review and retries;
- work discarded after scope or plan defects;
- recovery failures and attempted unauthorized transitions;
- defects escaping independent review;
- successful completion of the requested behavior.

Use runner-collected evidence where available and report unavailable measurements
explicitly. Keep agent self-report distinguishable from observed execution.

The [pilot measurement discussion](plans/active/RM-PILOT-APPROVAL/review.md#7-the-measurement-problem-which-is-prior-to-the-decision)
already explains why supersede counts alone conceal the expensive cases. The
brownfield record also demonstrates why a model's own action tally is not a
measurement to accept without checking.

**Benefit:** model selection becomes an empirical economic decision. **Cost:**
realistic evaluation requires more than a green repository suite. A cheap worker
that consumes extensive authority attention may be expensive overall.

## Suggested sequence for discussion

1. Establish a clear current-rule reference and review Sashimi's plans.
2. Agree the neo-grace/Sashimi interface and ownership boundaries.
3. Prototype supervised execution of one bounded task using existing neo-grace
   artifacts and commands.
4. Exercise interruptions, stale packets, failed verification, scope violations,
   and recovery before expanding parallelism or delegated authority.
5. Compare total cost and independently verified outcomes against the current
   workflow, then decide which automation to expand.

The first prototype should test whether a weaker worker can complete a useful
task without remembering the entire ceremony. Its success criterion must include
the controller's handling of a worker that makes a mistake, not only a worker
that follows every instruction.

These proposals do not relax the current gates, approve PILOT, authorize an
orchestration implementation, or revise the executor's active assignment.
