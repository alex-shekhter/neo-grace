# GRACE in twenty minutes

A guided tour of a real GRACE project. You will run every command yourself, break things
on purpose, and watch the tooling refuse to believe you.

**You do not need to learn the XML.** The skills write it; you approve it. This
walkthrough is organised around what *you* do and decide.

**Prerequisites:** [Bun](https://bun.sh) installed, and this repository cloned.

```bash
bun add -g neo-grace    # or, from a clone of this repo, replace
                               # `grace` below with `bun run ./src/grace.ts`
cd <this repo>
```

Every command below is run from the repository root.

---

## 0 · What problem this solves (1 min)

Coding agents are confidently wrong. They claim a function is exported when it isn't,
report a module as tested when nothing runs it, and quietly widen the scope of a change
you approved.

GRACE's answer is not a better prompt. It is a **durable, machine-checked model of your
project** that an agent cannot lie to. Everything below is that idea made concrete.

---

## 1 · Look at a healthy project (3 min)

`examples/polyglot` is a React + Go + Rust monorepo under full GRACE governance.

```bash
ngrace lint --path examples/polyglot
```

```
GRACE Lint Report
=================
Root: .../examples/polyglot
Profile: standard
Files checked: 4
Governed files: 3
XML artifacts checked: 20
Errors: 0
Warnings: 0

No issues found.
```

Green. Now ask what GRACE actually knows:

```bash
ngrace status --path examples/polyglot
```

```
Summary
- Context artifacts: 5
- Graph modules: 3
- Verification entries: 3
- Active changes: 1
- Archived changes: 1
- Integrity: 0 errors, 0 warnings
- Derived states: ready-to-execute

Changes
- C-ADD-KEYBOARD-NAV [active] spec=approved plan=approved states=ready-to-execute
- C-ADD-POSTING-CONTRACT [archive] spec=applied plan=applied states=none

Suggested Next Action
- Run $grace-execute for approved active changes.
```

Three things worth noticing:

- **Modules, not files.** `M-WEB-LEDGER-TABLE`, `M-API-ROUTER`, `M-LEDGER-CORE` — three
  languages, one vocabulary.
- **Changes have a lifecycle.** One approved and waiting, one applied and archived.
- **There is a suggested next action.** The project state implies the next move; the
  agent does not have to guess it.

And what GRACE can and cannot verify:

```bash
ngrace doctor --path examples/polyglot
```

```
Analysis coverage
  Governed files: 3
  Adapter-backed: .go×1, .rs×1, .tsx×1
  Unverified: (none)

Optional context artifacts
  - design-system.xml: present
  - invariants.xml: present
```

`ngrace doctor` is the honesty surface. If a file's language had no adapter it would be
listed under **Unverified** — GRACE tells you what it cannot check rather than pretending
the check passed.

---

## 2 · Break it on purpose (7 min)

This is the part that matters. Each break takes one edit; each is caught immediately.
Undo each one before moving to the next (`git checkout examples/polyglot`).

### 2.1 — Lie about your code

Open `examples/polyglot/services/api/internal/router/router.go` and add a line to the
`MODULE_MAP` claiming an export that does not exist:

```diff
 // START_MODULE_MAP
 //   Route - Dispatch a gateway request.
+//   Shutdown - Gracefully stop the router.
 // END_MODULE_MAP
```

```bash
ngrace lint --path examples/polyglot
```

```
Errors: 1

- [error] markup.module-map-mismatch .../router.go:10
  — MODULE_MAP EXPORTS mismatch. Missing: none; extra: Shutdown.
```

**GRACE parsed the Go source and disagreed with you.** Not a linter rule, not a naming
convention — it lexed the file, found the exported identifiers, and compared. The same
holds for Rust and TypeScript. This is the single most important thing to understand:
documentation that contradicts the code is a build error.

Undo it.

### 2.2 — Let a plan drift from its spec

Open `.grace/changes/active/C-ADD-KEYBOARD-NAV/spec.xml` and add a second module to the
approved scope:

```diff
     <AffectedAreas>
+      <M-API-ROUTER />
       <M-WEB-LEDGER-TABLE />
```

```
Errors: 1

- [error] change.scope-does-not-cover-spec .../plan.xml
  — Spec AffectedAreas names M-API-ROUTER, but the plan's DurableScope does not
    include it and it is not justified under OutOfPlanScope.
```

You approved a spec covering two modules; the plan only covers one. GRACE will not let
"approved spec A, executed plan B" happen silently. If the omission is *deliberate*, the
plan can declare it under `<OutOfPlanScope>` with a written reason — an escape hatch that
costs a sentence, so it stays honest.

Undo it.

### 2.3 — Claim a UI state you never test

Open `.grace/graph/ui.xml` and declare a third state on the table component:

```diff
       <States>
         <ST-DEFAULT />
         <ST-EMPTY />
+        <ST-ERROR />
       </States>
```

Lint stays green — this is a *health* question, not a grammar one:

```bash
ngrace module health --path examples/polyglot M-WEB-LEDGER-TABLE
```

```
State: blocked

Blockers
- health.ui-state-unverified: M-WEB-LEDGER-TABLE declares ST-ERROR, but no Scenario,
  AccessibilityCheck, or VisualCheck evidence names that state.
  Fix: Name ERROR (or the full ST-ERROR) in a Scenario, AccessibilityCheck, or
  VisualCheck under V-M-WEB-LEDGER-TABLE.
```

Declaring an error state creates an obligation to prove it works. The module is
`blocked` until evidence exists, and the remediation names the exact file and element.

Undo it.

### 2.4 — Break a cross-service contract

Open `.grace/graph/contracts.xml` and loosen the interface version:

```diff
-      <Version>1.2.0</Version>
+      <Version>v1.2</Version>
```

```
Errors: 1

- [error] projection.graph.invalid-interface-contract .../contracts.xml
  — IC-POSTING-V1 Version "v1.2" is not a valid semver (major.minor.patch).
```

`IC-POSTING-V1` is the contract between the Go gateway and the Rust core. It has a
schema file, a version, exactly one provider, its consumers, and a breaking-change
policy — so "who owns this boundary and what is allowed to change" is a fact the tooling
holds, not tribal knowledge.

Undo it. `ngrace lint --path examples/polyglot` should be green again.

---

## 3 · Read one change end to end (5 min)

Open `.grace/changes/active/C-ADD-KEYBOARD-NAV/`. Every governed change is exactly two
files.

### `spec.xml` — what and why, approved by a human

```xml
<AcceptanceCriteria>
  <AC-KEYBOARD-NAV>Arrow keys move focus between rows; Home/End jump to first/last visible row.</AC-KEYBOARD-NAV>
  <AC-AXE-CLEAN>axe reports zero serious or critical violations on the ledger route.</AC-AXE-CLEAN>
</AcceptanceCriteria>
<AffectedAreas>
  <M-WEB-LEDGER-TABLE />
</AffectedAreas>
```

Acceptance criteria are **addressable**. `AC-KEYBOARD-NAV` is a name that other artifacts
can point at — that is what makes traceability mechanical instead of aspirational.

### `plan.xml` — how, and what proves it

```xml
<TargetAssertions>
  <MustUseToken>
    <Token>DT-COLOR-ACCENT</Token>
    <File>apps/web/src/components/LedgerTable.tsx</File>
  </MustUseToken>
  <MustCoverStates><Module>M-WEB-LEDGER-TABLE</Module></MustCoverStates>
  <MustPassCommand>
    <Command>bun test apps/web/src/components/LedgerTable.example-test.ts</Command>
  </MustPassCommand>
</TargetAssertions>

<ObservedWriteScope>
  <File>apps/web/src/components/LedgerTable.tsx</File>
  <File>apps/web/src/components/LedgerTable.example-test.ts</File>
</ObservedWriteScope>

<T-001>
  <Title>Wire keyboard handlers and focus ring token usage</Title>
  <Satisfies><AC-KEYBOARD-NAV /></Satisfies>
  …
</T-001>
```

Read those three blocks again, because they are the whole methodology:

| Block | What it buys you |
|---|---|
| `TargetAssertions` | **Executable definition of done.** Not prose — commands and checks that pass or fail. The focus ring must use the design token; every declared UI state must have evidence. |
| `ObservedWriteScope` | **A blast radius you agreed to.** Two files. Writes outside it are visible. |
| `Satisfies` | **Traceability.** Task T-001 exists to satisfy `AC-KEYBOARD-NAV`. An acceptance criterion no task claims is reported. |

Now look at `.grace/changes/archive/C-ADD-POSTING-CONTRACT/` — the same two files for a
change that already shipped. The record of what was approved and what was actually done
survives the work, permanently.

---

## 4 · What you would actually do (4 min)

You have been reading artifacts. In practice you type short things and approve or reject
what comes back.

| You say | What happens |
|---|---|
| `$grace-init` | Interviews you about the project, writes the initial `.grace` model |
| `$grace-spec` | Interviews you about one change, writes `spec.xml` as **draft** |
| — | **You approve.** Nothing becomes `approved` without you saying so |
| `$grace-plan` | Reads the approved spec, writes `plan.xml` with assertions and tasks |
| `$grace-execute` | Implements tasks in order, gated by the assertions |
| `$grace-review` | Independent integrity review of the result |

The three moments that are yours alone:

1. **Approving the spec.** Scope is decided here.
2. **Approving the plan.** The definition of done is decided here.
3. **Deciding what to do when a gate fails.** GRACE reports; it does not overrule you.

Everything else — which XML tag, which anchor family, how to phrase a `MustPassCommand` —
is the skill's job, not yours.

### A note on ceremony

Not every change deserves this much structure. GRACE defines four tiers, T0 (hotfix)
through T3 (architectural), which change **how much you write** — never **whether the
gates run**. A T0 hotfix still has a spec, still has approval, still has a final gate.
There is no "skip GRACE" mode, on purpose: the moment one exists, everything becomes an
emergency.

---

## 5 · Where to go next

| If you want to… | Read |
|---|---|
| Understand the knowledge graph model | `skills/grace/grace-explainer/references/knowledge-graph.md` |
| See the file-level markup rules | `skills/grace/grace-explainer/references/semantic-markup.md` |
| Adopt GRACE in your own repo | Run `$grace-init` and let it interview you |
| Check what GRACE can verify in your stack | `ngrace doctor --path .` |

**Start with `ngrace doctor`.** It tells you which of your languages have export
verification, which files GRACE can only partially check, and what optional structure
you are missing — before you commit to anything.

---

## Appendix · The example's shape

| Path | What it demonstrates |
|---|---|
| `.grace/graph/{ui,api,core,contracts}.xml` | Segmented graph — documents split by domain, unified by an index |
| `.grace/graph/contracts.xml` | `DF-POSTING` ordered data flow + `IC-POSTING-V1` interface contract |
| `.grace/verification/{ui,api,core}.xml` | Per-module commands, scenarios, log markers, accessibility checks |
| `.grace/context/design-system.xml` | Design tokens, breakpoints, accessibility policy |
| `.grace/context/invariants.xml` | Cross-cutting rules that outlive any single change |
| `.grace/context/technology.xml` | Three `Stack-*` roots — one per language, no forced global stack |
| `apps/web/.../LedgerTable.tsx` | File-local module contract and semantic blocks |

The breaks in §2 are exercised by `bun run validate:walkthrough`, so the issue codes
printed above cannot drift from what the tool actually emits.
