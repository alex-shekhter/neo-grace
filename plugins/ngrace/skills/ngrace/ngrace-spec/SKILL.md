---
name: ngrace-spec
description: Interview the user and create an approved neo-grace NgraceChangeSpec plus optional design-context.xml inside .ngrace/changes/active/C-*/.
---

<skill>
<change_bundle_contract>
`.ngrace/changes/active/C-CHANGE-ID/`

- `spec.xml` — normative `NgraceChangeSpec`
- `design-context.xml` — optional, explanatory only
- `plan.xml` — created later by `ngrace-plan`
</change_bundle_contract>

<shape_sources>
Registered change-spec shape: `docs/schema-reference.md` (heading change-spec). That document is not a complete grammar — it excludes imperative validators and file-local markup.
Explain a shape or code: argv token `explain`.
Primary write path: `ngrace spec new`. The minted skeleton is a starting shape, not a verdict: when a rich, precedent-shaped artifact does not fit it, the skeleton is rewritten wholesale after the mint — the command is the write path, never the source of the final section shape.
Optional-section teaching source: `references/change-spec-template.xml`.
Optional design-context copy-source: `references/design-context-template.xml`.
</shape_sources>

<status_rules>
Create `spec.xml` as `status="draft"`. After a sufficient phrase from `approval_lexicon`, run `ngrace review --path . --change C-ID` (does not record a verdict), then `ngrace gate approve --change C-ID`; that command writes status. Do not hand-write `status="approved"`. Rejected or cancelled specs move to archive with terminal status. Do not create or edit `plan.xml` in this skill.

A draft `spec.xml` is revised in place: before approval the draft is corrected — never forked, never duplicated — and create → review → gate is the path an approved artifact takes. Only an approved artifact is immutable; repair an approved artifact by supersede, never by editing it.

At spec-approve the scope and WriteEvidence audits report they did not run (no plan); attempt-pair reports ran over 0 pairs and that is not substantiation. At plan-approve `review.scope-outside-write-scope` on the bundle's own spec.xml, plan.xml, and (when that file changed) decisions.md is expected; do not add those paths to ObservedWriteScope.
</status_rules>

<docs_and_examples>
Every `NgraceChangeSpec` must decide `README.md` and `examples/` in a Goal, Constraint, or NonGoal. A NonGoal must name the owner (a step, a bundle, or "unchanged; no user-visible surface"). Silence fails. Enforcement is `checkDocsAndExamplesDecision`, not this sentence.
</docs_and_examples>

<approval_lexicon>
Sufficient approving phrases, closed:
- the standalone word `approved`
- the phrase `I approve`
- the phrase `approve this spec` matching this artifact

Named non-approvals, closed:
- `looks good`
- `continue`
- any question

A question is not an approval even when it contains an approving word.

When requesting ratification of a written spec, quote the sufficient phrases bound to the artifact id and stage in the same breath. Use one approval request per message, one artifact, nothing else asked. Then record the ratifying phrase verbatim — the bytes the human wrote, never a paraphrase.
</approval_lexicon>

<strict_contract>
| # | requirement |
|---|---|
| 1 | Required sections are those `docs/schema-reference.md` lists under change-spec. Do not restate that list here. |
| 2 | Empty containers are not approval-ready. |
| 3 | Semantic anchors are canonical attribute-free XML tags, never attributes or attribute values. |
</strict_contract>

<ceremony_tiers>
Ask the user which risk tier applies (default **T1**). Record the tier in `Constraints` (e.g. `Ceremony tier T1 (module change)`). Tiers change **which sections must be rich**, never **whether gates run**. `--assertions final` remains the release gate at every tier.

| Tier | Name | Spec emphasis | Use when |
|---|---|---|---|
| **T0** | Hotfix | Tight `Summary`/`Problem`, narrow `AffectedAreas`, issue link in `Constraints`, minimal `AcceptanceCriteria`; optional thin design-context | Production break/fix with known blast radius |
| **T1** | Module change | Full `strict_contract` sections; single-package `AffectedAreas` | Normal feature slice in one package |
| **T2** | Cross-cutting | Full sections + multi-module/`DF-*`/`IC-*` in `AffectedAreas`; integration evidence in `VerificationIntent` | API+UI or multi-crate change |
| **T3** | Architectural | Full sections + design freeze notes, multi-phase verification intent, explicit non-goals for migration windows | New subsystem, redesign, contract major bump |

Hard rules for tiers:
- T0 is **not** an ungoverned edit. A `NgraceChangeSpec` still exists; only section depth shrinks.
- Tiers never skip baseline, target, or final assertion gates and never skip user approval of the spec.
- Mis-classifying an architectural change as T0 is a review failure — see `ngrace-reviewer`.
</ceremony_tiers>

<clarifications>
Typed holes (RM-AGENT-RELIABILITY D12) are schema elements, never prose markers. When a contract, invariant, or acceptance criterion is unknown at authoring time, declare:

```xml
<Clarifications>
  <Clarification><IC-EXAMPLE />What is the wire shape for this contract?</Clarification>
  <Clarification resolved="true"><INV-AUTH />Resolved: tokens expire at 15m.</Clarification>
</Clarifications>
```

Rules:
- Target is exactly one self-closing `IC-*`, `INV-*`, or `AC-*` child — never a target attribute.
- Unresolved clarifications on `IC-*` / `INV-*` block plan approval (`ngrace gate approve`).
- Unresolved clarifications on `AC-*` that a task `Satisfies` block apply.
- `Assumptions` remain presence with weak provenance and never block a gate.
- Do **not** write `[NEEDS CLARIFICATION: …]` in free text — lint and gates cannot verify prose markers.
- An unknown contract, invariant, or criterion is declared here and declared nowhere else: not in prose, not in a comment, not in a report after approval. The approve gate filters on these — an unresolved `IC-*` / `INV-*` hole refuses `ngrace gate approve` — so a hole carried anywhere but a `Clarification` is a gap the gate never sees.
</clarifications>

<acceptance_criteria_anchors>
Prefer addressable `AC-*` tags under `AcceptanceCriteria` so `ngrace-plan` can map them via task `<Satisfies>`:

```xml
<AcceptanceCriteria>
  <AC-KEYBOARD-NAV>Arrow keys move focus; Home/End jump to first/last row.</AC-KEYBOARD-NAV>
  <AC-AXE-CLEAN>axe reports zero serious or critical violations on the route.</AC-AXE-CLEAN>
  <AC-CLOSE-LINT>Post-archive lint 0/0.<CloseEvidence><Command>bun run ngrace lint --path . --fail-on warnings</Command></CloseEvidence></AC-CLOSE-LINT>
</AcceptanceCriteria>
```

Rules:
- `AC-*` ids are uppercase kebab (`AC-[A-Z0-9]+(?:-[A-Z0-9]+)*`).
- Each `AC-*` id is unique within the spec and must contain non-empty text.
- A close-bound `AC-*` is a child `CloseEvidence` that contains at least one non-empty `Command`. CloseEvidence is a child of `AC-*`, never an attribute. Forgotten `AC-*` (no Satisfies, no complete CloseEvidence) still warn unmapped — and the warning is produced only against an active `plan.xml`: while a draft spec is authored no plan exists, so an author reading this passage takes silence for a mapped criterion. Do not read a clean draft-state lint as a mapping check; the check exists only when the plan that maps does.
- A non-empty `Command` is necessary but not sufficient: the Command must match a discriminating shape or a configured prefix. `ngrace lint --explain change.close-evidence-undiscriminating` states the cheap-class limit.
- Legacy free-text or `<Criterion>` children remain valid; when no `AC-*` is present, criteria mapping is skipped for backward compatibility.
- `AffectedAreas` should name real `M-*` / `DF-*` / `IC-*` anchors (not prose alone) so plan DurableScope coverage can be validated.
- Name the baseline a committed-point or byte-invariance criterion is measured against as a named baseline commit — the full hash in the criterion text. The base-less diff form cannot fail, and a criterion whose baseline cannot fail was never a guard.
- An archive-edit criterion excludes the change's own archive arrival with its reason: the close itself renames the bundle's directory into the archive, so without the exclusion the close's own rename reddens the criterion it wrote.
- A CloseEvidence criterion is evaluated in the applied-archive state, after the close's own move has run. Write it against the state the ceremony produces, never the pre-close tree: an assertion true only pre-close exits non-zero at the close and is uncloseable by construction.
- Enumerate modules in every place the artifact enumerates modules, and confirm each forced file's owner against every module list: a module list that appears twice can be wrong twice, and fixing the copy you happened to look at leaves the other.
- Structural counts come from the shipped parser, never `grep -c`: the grep form counts lines, not occurrences, and these artifacts wrap one phrase across lines — flatten whitespace first, and prefer parsing the artifact when the claim is about structure.
- Read exit codes directly, never through a pipe: `cmd | tail` reports tail's status, not cmd's, and a criterion that names an exit code names the code of the command that produced the verdict.
- Any test driven against a real repository carries an explicit generous timeout: a suite that builds fixtures or copies trees dies inside a default timeout, and that death is indistinguishable from the red it was meant to measure.
- A criterion is producible: it asserts no state the shipped engine will not produce, requires no change another criterion forbids, and names no probe that cannot be run — an unsatisfiable criterion is a refusal the close discovers.
- Probe every guard in both directions on a throwaway copy: the clean direction proves it can pass, a planted violation proves it can redden, and a guard whose red direction was never driven may be vacuously green.
</acceptance_criteria_anchors>

<design_references>
Optional `DesignReferences` under the `C-*` wrapper. Children and their validators are the design-reference inventory in `docs/schema-reference.md`; do not restate them here. Design references are not requirements; `spec.xml` sections remain the source of truth for `ngrace-plan`.
</design_references>

<workflow>
1. Ask one focused question at a time until goal, scope, constraints, non-goals, acceptance criteria, affected areas, verification expectations, and ceremony tier are clear. When the dispatch is cold and has no one to ask, a brief may stand in for the interview: read the brief's named artifacts, answer its questions from them, and declare what it leaves unanswered as an unknown rather than inventing it.
2. Propose a concise design summary and explicit assumptions. Ask for approval before writing an approved spec. Only a sufficient phrase from `approval_lexicon` is approval. This pre-write ask is not lexicon ratification of a written spec: do not run the approve gate, do not combine it with the ratification request in the same message, and do not treat a lexicon phrase as permission to skip approve-time review of the written artifact.
3. Create a deterministic uppercase-kebab `C-*` change id.
4. Write `spec.xml` with `ngrace spec new` as the primary write path. Use `references/change-spec-template.xml` as the teaching source for optional sections. Prefer `AC-*` acceptance criteria. Add `DesignReferences` when design sources exist.
5. If rationale, alternatives, scenarios, or external constraints would otherwise bloat the spec, write non-normative `design-context.xml` from `references/design-context-template.xml`.
6. If approval is not a sufficient phrase from `approval_lexicon`, leave `spec.xml` as `status="draft"` and report the approval step needed. After a sufficient phrase, run `ngrace review --path . --change C-ID` (does not record a verdict), then `ngrace gate approve --change C-ID`; that command writes status. Do not hand-write approved. Request ratification of C-ID at spec stage with a sufficient phrase: `approved`, `I approve`, or `approve this spec`. At spec-approve the scope and WriteEvidence audits report they did not run (no plan); attempt-pair reports ran over 0 pairs and that is not substantiation. At plan-approve `review.scope-outside-write-scope` on the bundle's own spec.xml, plan.xml, and (when that file changed) decisions.md is expected; do not add those paths to ObservedWriteScope.
</workflow>

<hard_rules>
- `spec.xml` is the source of truth for `ngrace-plan`; design context never adds requirements.
- Do not implement code, mutate current graph/verification state, or create retroactive change bundles.
- Recommend `ngrace lint --path <project-root> --assertions current` as a pre-implementation active-baseline check after writing the bundle; never present it as target or final evidence.
- When a spec, plan, design-context, or skill XML block must name a tag, attribute form, or angle-bracketed token, write it as character data with entities (`&lt;` `&gt;` `&amp;`); do not paraphrase the brackets away to keep the document well-formed; markup-byte assertions belong in a TypeScript test.
</hard_rules>
</skill>
