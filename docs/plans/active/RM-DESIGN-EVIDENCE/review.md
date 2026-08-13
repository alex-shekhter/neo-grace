---
id: RM-DESIGN-EVIDENCE
kind: context
status: draft
supersededBy: null
created: 2026-08-13
updated: 2026-08-13
baseline: null
targets: []
normative: false
plan: null
related: [RM-GOVERNED-PATH]
---

# Design evidence an agent can actually use: visual references, recordings, and the behaviour text that carries them

> **Status: exploration, not a commitment.** There is no `plan.md` and no phase has been
> approved. Nothing here is normative.

Recorded 2026-08-13 at the maintainer's request, during `C-TEACHING-SURFACE`. The framing is his:
*"we need the ability to show graphics in various forms including video, and describe behaviour in
text. We shouldn't support only Figma — there are current open-source solutions and more will come."*

## 1. What exists today, measured at `f611f0d`

An agent implementing a UI change has **no governed way to be handed a picture.**

`<DesignReferences>` on `NgraceChangeSpec` is the only design-artifact slot (G-18), and
`DESIGN_REFERENCE_CHILD_TAGS` (`src/artifact/grammar.ts:1694`) is a **closed set of exactly two**:

| Child | Shape | Validation |
|---|---|---|
| `<Figma url="…">` | remote URL | non-empty, well-formed http(s) |
| `<UserResearch>path</UserResearch>` | project-relative path | containment only |

Any other child raises `change.invalid-design-reference-child` at **error**. So `<Mock>`,
`<Screenshot>`, `<Recording>` and every sibling are rejected today. There is no image, asset, or
video concept anywhere under `src/artifact/` or `src/lint/`.

**Three gaps, each measured rather than assumed:**

1. **Delivery is missing, and it matters more than the schema.** `ngrace context --task` emits a
   *selected projection* — "Purpose, modules, verification anchors, write-scope, exclusions"
   (`src/grace-context.ts:126`) — and `DesignReferences` is **not in it.** So even the two slots that
   exist never reach the executing agent through the governed path; it would have to open `spec.xml`
   itself, which is exactly what the slice exists to avoid. **Adding tags without extending the slice
   would ship a data surface nothing consumes** — the [F46](./../RM-GOVERNED-PATH/decisions.md) /
   F63 class this roadmap has already paid for twice.
2. **Existence is never checked.** `UserResearch` is validated for containment, not existence:
   `docs/research/EXAMPLE.md` is referenced by the shipped spec template, does not exist, and lint is
   green. Tolerable for a research citation; for a mock it is a silent lie about the visual target.
3. **A vendor name is a tag.** `<Figma>` hardcodes one product into the grammar. That is the defect
   this entry exists to correct, not a precedent to extend.

## 2. Design direction

Recorded so a future spec inherits the reasoning rather than re-deriving it. **None of this is
ratified.**

### 2.1 Tags name the role, never the vendor

`<Figma>` is the wrong axis. Penpot, Excalidraw, tldraw, and whatever ships next are unbounded, and a
grammar that enumerates vendors guarantees drift — the same shape the roadmap rejects for
`MODULE_MAP` auto-fix (D3) and dual-format authoring (R1).

The stable axis is **what the reference is for**: a mock, a screenshot of current behaviour, a
prototype, a recording of an interaction. Those roles are finite and durable; vendors are not. Wall
§3.5's grep-stability argument favours distinct tags — applied to roles, it is a strength; applied to
vendors, it is a liability. A vendor, if recorded at all, is data on the element, never the element.

Each role should accept **either** a project-relative path **or** a remote URL, so an open-source
tool that exports a file and a hosted tool that exposes a link are equally first-class.

### 2.2 The behaviour text is the agent-facing artifact

This is the load-bearing decision and it comes from the maintainer's framing.

An agent can read a PNG or a JPG. It generally **cannot** watch an MP4, and a hosted design URL is
usually behind auth it does not have. A `<Video>` tag whose contract implies agent-consumability
would claim more than any tool can deliver — [F10](./../RM-GOVERNED-PATH/decisions.md), the
recurring failure where a name promises more than the body verifies.

The repair is to make the pairing structural: **a reference the agent cannot read must carry a text
description of the behaviour it shows, and that description is what the context slice delivers.** The
asset is then honestly human-facing, the text is honestly agent-facing, and nothing overstates. This
also fits D5's typed-absence idiom — the artifact says what it could not hand over, instead of going
quiet.

Whether the text is required for *every* reference or only for non-readable ones is open. Requiring
it universally is simpler to validate and harder to argue with; requiring it only where the agent is
blind is less ceremony for a plain screenshot.

### 2.3 Open questions

- Does this live only on the change spec, or also durably on `design-system.xml`? A design system's
  reference set outlives any one change.
- Does existence checking apply to all local assets, and does it become an error or a warning?
  Consider that assets are frequently large and may be git-ignored or LFS-backed.
- Is `<Figma url>` kept as a deprecated alias, migrated, or removed? Removal is a breaking grammar
  change and needs a migration story; `ngrace-migrate` exists.
- Should the slice inline the description text and merely *name* the asset paths, to keep
  `selectedBytes` honest (A48)?

## 3. The pins a future bundle will trip — recorded now, deliberately

[F64](./../RM-GOVERNED-PATH/decisions.md) cost `C-SKELETON-GENERATORS` its clean close: three
CI-load-bearing assertions were tripped by the deliverable and absent from its `ObservedWriteScope`,
because none named a symbol the new code touched. **The sweep for this work was done while that
lesson was fresh. Do not re-derive it — verify it, then extend it.**

Changing `DESIGN_REFERENCE_CHILD_TAGS` forces, at minimum:

- **`docs/schema-reference.md`** regenerates. `design-reference` is a registered shape and
  `DESIGN_REFERENCE_CHILD_TAGS` is in `GRAMMAR_INVENTORIES`, so `validate:schema-reference` fails
  until the document is regenerated. *This is the feature working as designed — the docs update
  themselves.*
- **The spec and plan skill templates regenerate.** Since `C-SKELETON-GENERATORS` they are the
  renderer's teaching emission, and the teaching emission renders `DesignReferences` from the live
  set. `scripts/generate-skeleton-templates.ts check` fails until they are rebuilt — in **both** skill
  trees, or `validate:marketplace` breaks.
- **`scripts/skill-contracts.test.ts`** pins `<Figma url=` on both `ngrace-spec/SKILL.md` and the spec
  template (around `:45`–`:50`). Any vendor-agnostic redesign falsifies those assertions. They are to
  be **repaired to the new true state, never weakened**.
- **`src/test-support/token-accounting.test.ts` and `README.md`** — regenerated templates move
  `referencesTotal`, and any `SKILL.md` edit moves `total` / `totalBytes` (F51).
- **`src/grace-context.ts`** and its slice tests, for §1 gap 1. Without this the feature is inert.

## 4. Why it is not scheduled

`RM-GOVERNED-PATH` P1 has steps 6, 7 and 8 outstanding against target 6.3.0, and P2 is queued behind
it. This is a grammar addition plus a context-slice change — roughly one bundle, but it is new scope
against a phase already committed. Sequencing it before P1 closes would be the branch-stacking
mistake F58/F59 recorded.

It is **not blocked** by anything, and it has no dependency on P1's remaining steps.
