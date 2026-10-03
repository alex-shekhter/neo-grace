# GRACE implementation findings queue

> **Non-normative status record.** The original survey was measured 2026-09-26
> at `a4d5d9d`; later entries state their own measurement dates. This records
> findings and maintainer priorities for governed bundle selection. It does not change the approved
> [RM-GOVERNED-PATH plan](./plan.md), ratify a new decision, schedule a bundle, or
> decide [RM-PILOT-APPROVAL](../RM-PILOT-APPROVAL/review.md).

## Paired block anchors: supported, retain the current form

The [GRACE semantic-markup convention](../../../../skills/ngrace/ngrace-explainer/references/semantic-markup.md)
uses `START_BLOCK_X` and `END_BLOCK_X`. The shared `X` is a file-unique name;
`START` and `END` make the boundary direction explicit. The
[marker validator](../../../../src/project-utils.ts) at
`src/project-utils.ts:749-826` rejects duplicate, reversed, mismatched,
crossed, and unclosed markers. The parser at `src/project-utils.ts:690-711`
records inclusive source lines for properly paired blocks, and
[verification localization](../../../../src/verification/localize.ts) at
`src/verification/localize.ts:333-385` can map a
caller-supplied `[BLOCK_X]` log marker to linked runtime source lines. Parsing a
block and requiring that a project use blocks are different capabilities.

| Variant | Benefit | Cost |
|---|---|---|
| **Keep `START_BLOCK_X` / `END_BLOCK_X` (recommended)** | Explicit close and validated nesting; existing tooling works. | Two different full marker strings rather than an exact repeated delimiter. |
| Use one identical delimiter twice | Exact textual recurrence. | Opening versus closing depends on position and nesting inference; no measured model-behavior advantage. |

The identical-delimiter variant loses because it weakens structural clarity
without evidence of a compensating model benefit. **Keep the directional
prefixes and the shared unique suffix.**

A complete disposable project made with `writeMinimalNgraceProject` was driven
through the real `bun run ngrace lint --path <root> --fail-on warnings` command:

| Source mutation | Exit | Lint result |
|---|---:|---|
| Matching `START_BLOCK_RUN` / `END_BLOCK_RUN` | 0 | 0 errors, 0 warnings |
| Replace end name with `OTHER` | 1 | `markup.mismatched-marker`, `markup.missing-end-marker` |
| Repeat the completed `RUN` block | 1 | `markup.duplicate-marker` |
| Remove the end marker | 1 | `markup.missing-end-marker` |

These observations establish CLI syntax and structural refusal. They do not
establish a particular attention mechanism or improvement in model accuracy.

## The repository's own source has not adopted the lower layers

The current population is **69 non-test TypeScript files under `src/`**. Every one
has a `START_MODULE_CONTRACT` header. There are **zero real function-contract
annotations** and **zero real block annotations** in runtime source. Six paired
block examples occur only in three fixture generators:
`src/artifact/test-fixtures.ts`, `src/test-support/fixtures.ts`, and
`src/test-support/defect-corpus.ts`. The scan matched comment-marker positions,
not marker words in regexes or prose. This re-measures the still-relevant part of
[F162](./findings.xml) against the merged tree; F162's older 65-file count is a
dated measurement. The whole population was enumerated with
`Path('src').rglob('*.ts')` excluding `.test.ts`, and the marker counts used
start-of-comment-line expressions over every file.

One more real-CLI direction exposed the conditional-validator gap: adding
`src/unmarked.ts` with only `export const unmarked = true;` to the same complete
project still returned exit 0, 0 errors, 0 warnings. The linter validates
`MODULE_CONTRACT` structure on files it has already recognized as governed, but
does not require the header on every eligible `src/**/*.ts` file.

[D29](./rulings.xml) already chooses the route; it needs no duplicate ruling:

- `C-MODULE-CONTRACT-GATE` is the chartered baseline gate for eligible `src/`
  files. It must precede function-contract adoption.
- `C-FUNCTION-CONTRACT-SURFACE` is the chartered rollout for selected public and
  state-changing functions, with its validator rule in the same bundle. D29
  reserves block markers for complex control flow and disallows them in flat
  sequential logic. These remain [live charter rows](./registry.xml), not
  implementation completed by the present marker parser.

## Logging and localization remain a separate ruling

The [semantic-markup convention](../../../../skills/ngrace/ngrace-explainer/references/semantic-markup.md)
asks important runtime logs to carry `[Module][function][BLOCK_X]`. No runtime
source file in the measured `src/` population contains that structured literal;
the fourteen occurrences are inside the same three fixture generators. The
repository's `V-M-CURSOR` uses a `TraceAssertion` and declares no required
`Marker`. The shipped `ngrace verification localize` reads a caller-supplied log
and never executes the verification command itself
(`.ngrace/verification/main.xml:48-52`, `src/grace-verification.ts:175-196`).

D29 explicitly leaves open whether this CLI repository should emit block-linked
logs or claim the existing `TraceAssertion` route where logs are unnatural. A
future decision must settle that boundary before a logging implementation is
specified. Function contracts, block annotations, runtime log emission, and
log-driven localization must not be counted as one already delivered feature.

## The attention explanation is a hypothesis, not a product guarantee

The convention calls these markers “attention anchors.” The
[residual-stream analysis](https://transformer-circuits.pub/2021/framework/index.html)
describes an additive communication channel; the
[induction-head study](https://transformer-circuits.pub/2022/in-context-learning-and-induction-heads/index.html)
studies pattern completion of the form `[A][B] … [A] → [B]` in particular models.
Neither result demonstrates that GRACE's directional block markers trigger that
circuit, make code blocks atomic to a model, or avoid the computational cost of
attention. The repeated suffix `X` is not necessarily a single model token.

Preserve the practical convention and its structural tests. Any future skill
wording about model behavior should distinguish the intended context cue from a
measured mechanism, and an effectiveness claim would need a controlled task
comparison using identical code with and without markers.

## PILOT evidence is still incomplete

The [PILOT review §7](../RM-PILOT-APPROVAL/review.md) asks for discarded-work cost
at discard time: attempts reached, tasks completed, diff size, and available
token accounting. Its statement that superseding erases every loose run event is
stale: `discardAndFoldEpoch` now writes a `discarded` event when needed and folds
the stream into `run-ledger.xml`. Folding preserves events, but does not by itself
record all the requested cost fields. [F202](./findings.xml) identifies another
blind spot: chain depth records neither the cause of a supersede nor an approved
defect deliberately left unsuperseded. Current `supersedeChangeBundle` still
calls `discardAndFoldEpoch` and moves the bundle without a cause field
(`src/grace-cursor.ts:1794-1808,1908-1952`, `src/gates/ledger.ts:1538-1713`).

[D23](./rulings.xml) chooses `supersedeChainDepth` over amendment count as the
observed correction signal. [D27](./rulings.xml) keeps approved-artifact repair on
the supersede route until PILOT is decided. The cost record, cause, and
declined-supersede outcome are evidence work for that later discussion; this
document neither selects a PILOT design nor relaxes D27.

## First-class sequence/class diagrams: teaching and validation are unscheduled

**Measured present shape, 2026-09-27 at `890d556` plus the feature-branch `CLAUDE.md` commit.**
`design-context.xml` has no child-section allowlist (`src/artifact/grammar.ts:784-833`), so an
optional `<Diagrams>` section carrying `<SequenceDiagram>` and `<ClassDiagram>` children stores
Mermaid as escaped character data and passes the real
`bun run ngrace lint --path <root> --fail-on warnings` (exit 0, 0 errors, 0 warnings). An unescaped
Mermaid `<` in a child produces `xml.parse` (exit 1); restoring the escaped form returns exit 0.
This establishes XML acceptance only: there is no typed validation of diagram content, and
`src/grace-context.ts:343-355,868-876` deliberately excludes `design-context.xml` from execution
slices, so a diagram stored there does not reach an executing agent.

| Variant | Benefit | Cost |
|---|---|---|
| **A. Teach optional diagram children in the canonical `ngrace-spec` skill and template, plus the packaged mirror, with `ngrace-plan` consumption semantics (recommended)** | Authors get a sanctioned home for reviewed diagrams; the rule matches `CLAUDE.md`'s diagram-before-brief process; no CLI shape change. | Skill and mirror edits; `ngrace-plan` consumption wording must be pinned by a `TAUGHT_RULES` needle; still unvalidated. |
| **B. Additionally register and validate a typed diagram shape in the CLI grammar, tests, generated schema reference, issue catalog, and teaching-surface checks** | Structural validation of the children; a count or attribute claim becomes parser-checkable. | Touches the grammar, generated schema reference, issue catalog, teaching-surface checks, and measured README/token footprint; larger than the authoring need. |

Variant B loses until authoring demand is measured: the grammar, schema reference, and issue
catalog are generated and validated surfaces, and a typed shape with no consumers is cost without a
measured benefit. **Recommendation: a separate governed bundle decides the smallest useful
first-class contract, starting from A.** Authoring and planning use is distinct from delivering
diagrams into an execution context: the current absolute design-context exclusion would have to be
overturned for delivery, and that is a separate decision from storage. This is not
[RM-DESIGN-EVIDENCE](../RM-DESIGN-EVIDENCE/review.md)'s visual-asset proposal (mocks, sketches,
screenshots, recordings); that question is about references an implementing agent can consume, not
about sequence/class diagrams authored for review.

## Historical archive compatibility: withdrawn

**Withdrawn 2026-10-03 by maintainer decision.** The current-only CLI policy in `CLAUDE.md` replaces this compatibility campaign: old archives are opaque historical evidence for LLM interpretation, not current validation or operational inputs. The earlier directions below are history, not queued work. Remove existing archive dependencies through small governed bundles, starting with `C-CURRENT-VALIDATION-BOUNDARY-1-D8D7DF85`; do not carry forward the obsolete historical-reader compatibility criteria.

**Recorded 2026-10-01 at `f346480`; priority: immediate derivation.** The maintainer's
instruction is: **if a defect is found, fix it ASAP**. Queueing records the work;
it does not permit known defects to remain unpaid or bypass stage ratification.

The corpus-regression repair is applied and archived as
`C-ARCHIVE-CORPUS-BASELINE-2-D5F2E1C3` (merged PR #121; status updated 2026-10-02). Its design replaces
`C-SUBSTANTIATION-HONESTY`'s ongoing dynamic-zero test with its verified historical
close baseline while retaining positive detection and current retired-code checks;
it does not settle the broader format and historical-validation contract.

The compatibility concern rests on these verified mechanisms:

- Current grammar validators process both active and archived bundles and accept
  only the current `graceVersion` (`src/artifact/grammar.ts:317-349,1345-1360`).
  The XML reader does not select a historical validator by declared version
  (`src/artifact/xml.ts:73-120`).
- Archived plan assertions already receive syntax-only checks because their
  semantics can become stale (`src/lint/core.ts:544-548`). Other coverage checks
  and process audits still examine archived evidence under current rules.
- [D5.2](./rulings.xml) requires a grammar-version bump and migration path when
  a legitimate working state becomes an error. Local legacy-shape exceptions
  exist; their coverage does not by itself verify compatibility across the archive population.

**Next action:** Luna measures the complete archive population with the shipped
validators and real CLI, classifies historical integrity checks separately from
retroactive requirements, and reproduces candidate compatibility failures using
ordinary disposable copies. The authority decides the design from that evidence;
the external executor implements confirmed defects through neo-grace skills,
CLI gates, and explicit stage ratification. A confirmed defect receives prompt
corrective work rather than an indefinite queue position or a future-release deferral.

The design review must decide how declared historical formats remain readable,
how historical acceptance baselines differ from retrospective audits, and how a
breaking format or policy change migrates interpretation while preserving original
archive bytes. No version-dispatch or migration mechanism is ratified here. A
limitation or future risk is not recorded as an already reproduced defect.

## Queue boundary

The existing D29 charters own module-header enforcement and selective function
and block adoption. Logging versus `TraceAssertion`, model-effect wording, and
PILOT cost/cause instrumentation are separate questions to scope after the
current branch is committed. The archive-compatibility entry records the maintainer's
2026-10-01 urgency without reordering D29's existing charters. No new bundle identity
or unreviewed implementation mechanism is chosen here.
