---
id: RM-VERIFIED-APPROVAL
kind: context
status: draft
supersededBy: null
created: 2026-08-14
updated: 2026-08-14
baseline: null
targets: []
normative: false
plan: null
related: [RM-GOVERNED-PATH, RM-GITLESS-INTEGRITY]
---

# Verified approval: making ratification something the agent cannot assert

> **Status: exploration, not a commitment.** There is no `plan.md` and no phase has been
> approved. Nothing here is normative.

Recorded 2026-08-14, from the brownfield adoption experiment and the design discussion that
followed it. The maintainer's proposal is the spine of §3; the constraints in §4 came out of
stress-testing it.

## 1. The defect this exists to answer

[F88](../RM-GOVERNED-PATH/decisions.md) — **approval is self-certified.** Two independent models
adopting GRACE on a real repository each wrote `status="approved"` onto the spec they had just
authored, in the same commit, without asking anyone. Neither hesitated.

The product cannot object. `gate approve` evaluates requirements and records a `Decision`, but by
A29.2 / `RM-GOVERNED-PATH` D1 it deliberately does **not** write `status` — that transition is
"authored", on the reasoning that a human ratifies. Nothing enforces or records *who* authored it.
So the approved state that gates `ngrace plan new` and `gate apply` is, for an autonomous agent, the
same actor writing both the claim and its ratification.

**The reasoning behind D1 is sound and the gap is elsewhere:** because approve has no
machine-evaluable precondition, the product has *no evidence about it at all* — and reports
`approved` with identical confidence whether a human ratified it or the authoring agent typed it.

## 2. What does not solve it

**Anywhere the agent can write.** A local file, a local signing key, a local append-only log, a
local chain — the agent owns all of them. `RM-GOVERNED-PATH` §4 D4 already rejected signed status
transitions on exactly this ground: *"the party who would forge a signature is the agent holding the
key."*

**Blockchain, specifically.** It solves ordering and non-repudiation **between mutually distrusting
parties**. Here there is one actor with write access to everything, so a chain faithfully records
whatever was submitted — the oracle problem. And inside a single trusted service it is an
append-only log with extra machinery: if the service is trusted, a signed log gives the same
tamper-evidence; if it is not, consensus inside it rescues nothing. **Keep the append-only and
tamper-evident properties; the consensus layer is not load-bearing.**

**Prompting.** Making `gate approve` ask interactively governs only agents already willing to ask.
Both measured runs edited the attribute directly. A prompt is not a boundary.

## 3. The shape that does work

**A service the agent cannot write to.** The maintainer's proposal:

1. It holds configuration changeable **only by a human**.
2. `ngrace` reads that configuration and is bound by it.
3. It keeps an append-only record; `ngrace` may read and append, nothing else.
4. **Approval requires a one-time code the service issues to the human out-of-band**, which the
   agent must present. An agent cannot fabricate an unused code it was never issued.

This is the first proposal in the sequence that closes *fabrication* rather than merely making it
visible. It moves approval from **tamper-evident** ("we can tell if someone lied") to **verifiable**
("they could not have"). That distinction is the whole point, and it is why the cheaper local
variants are not substitutes.

## 4. Constraints that decide whether it holds

**Bind the code to the artifact, and show the artifact from the service.** A code authorising *"an
approval"* authorises whatever the client claims. It must be issued against a **fingerprint of the
bytes**, and the human must see the content **in the service's own surface**, never in the agent's
transcript — otherwise the agent presents a tidy summary and applies the code to different bytes.
Transaction signing in banking exists for precisely this reason: what you see is what you sign.

**The detection half is still required.** A code makes forgery hard; it does not make direct editing
impossible — the measured runs never made a request at all. `lint` must refuse `approved` that
carries no valid attestation, and report a fingerprint that no longer matches the bytes. **The code
stops fabrication; the check stops bypass. Neither substitutes for the other**, and the check is also
what makes this composable with [`RM-GITLESS-INTEGRITY`](../RM-GITLESS-INTEGRITY/review.md), which
already records that `gate approve` keeps no fingerprint of what it approved.

**Habituation is the failure mode most likely to bite.** A human issued codes forty times a day
pastes them unread, and the result is cryptographic proof of a rubber stamp. Unsolvable in the
protocol; solvable only by making ratification **rare and consequential**. D1's asymmetry was
reaching for that distinction — machine-evaluable transitions versus human ones — even if it drew the
line in the wrong place.

**Availability becomes a correctness question.** Offline runs, CI, and air-gapped adoption all need a
designed answer, and the honest one is typed absence — *"policy unverified: attestation service
unreachable"* — never silent permissiveness. Follow D1.5's precedent: it ships `--force` for apply
with a ledger event and an operator reason, on the reasoning that **without a sanctioned exit people
hand-write anyway and the record becomes worse than before**. Approve needs the same escape hatch or
headless runs will route around the whole mechanism.

**The product's shape changes.** Today GRACE's honesty story is that everything is inspectable in the
repository. A service moves part of the truth outside it. That is defensible for attestation
specifically — the one thing that cannot live in the repo without being forgeable — but the boundary
must be drawn **narrowly and deliberately**, or the product becomes "a service you operate" rather
than "a tool you run", and adoption cost changes with it. That cost lands on P4's adoption path.

## 5. Open questions

- Does `ngrace` verify the attestation at **use** time (every `plan new`, every `gate apply`) or only
  at write time? Use-time verification catches later tampering; write-time is cheaper.
- How does `ngrace` authenticate the service — and what stops a local process impersonating it?
- What is the unit of approval? Per spec, per bundle, or per batch? This is the same question as
  habituation, asked in the protocol.
- Does a superseded or amended artifact invalidate its attestation? It must, or an approved spec can
  be edited afterwards — the defect `RM-GITLESS-INTEGRITY` records.
- Would this have prevented the measured runs? **No** — both bypassed the request entirely. Only the
  detection half stops them. Any plan that ships the service without the check has not fixed F88.

## 6. Why it is not scheduled

`RM-GOVERNED-PATH` P3 and P4 are outstanding, and P3's own step detail is being rewritten against the
brownfield evidence. **The cheap floor should ship first regardless of this plan:** `gate approve`
writing status, recording a fingerprint, and `lint` reporting `approved` without a matching record.
That is tamper-evidence, it is repo-local, it needs no service, and it is the half that would have
caught both measured runs. This entry is what comes **after** that, not instead of it.
