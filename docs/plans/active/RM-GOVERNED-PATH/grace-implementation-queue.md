# GRACE implementation findings queue

> **Non-normative status record, measured 2026-09-26 at `a4d5d9d`.** This records
> findings for later bundle selection. It does not change the approved
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

## Queue boundary

The existing D29 charters own module-header enforcement and selective function
and block adoption. Logging versus `TraceAssertion`, model-effect wording, and
PILOT cost/cause instrumentation are separate questions to scope after the
current branch is committed. No implementation order or new bundle identity is
chosen here.
