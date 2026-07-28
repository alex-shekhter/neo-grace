---
name: grace-reviewer
description: Review GRACE 4 integrity across .grace artifacts, active changes, scopes, assertions, code anchors, and verification evidence.
---

<skill>
<review_checklist>
- `.grace/context` artifacts are present and relevant.
- `.grace/graph/index.xml` routes every graph anchor to the correct graph document.
- `.grace/verification/index.xml` routes deterministic `V-M-*` entries and covers current modules.
- Active change specs/plans use valid statuses for their location and exactly one `C-*` wrapper.
- Baseline and target assertions are meaningful and not stale.
- Durable scopes and observed write scopes are explicit; unsafe parallel overlaps are blocked.
- File-local contracts, `LINKS:`, and semantic blocks match durable anchors.
- Verification evidence is fresh and tied to commands or markers.
- Optional `DesignReferences` use http(s) Figma URLs and project-contained `UserResearch` paths.
</review_checklist>

<ceremony_tier_review>
Ceremony tiers (T0–T3) are skill guidance that change required **section depth**, never whether gates run.

| finding | when to raise |
|---|---|
| **T0 misuse on architectural change** | Spec claims T0 (hotfix) but `AffectedAreas` spans multiple packages, introduces `IC-*` / new `DF-*`, renames modules, or changes durable graph structure. Flag as high severity; require reclassification to T2/T3 and a full plan. |
| **T0 without issue link** | Hotfix tier without a tracker/issue reference in `Constraints` or `Problem`. |
| **Tier skips a gate** | Any language that suggests skipping baseline, target, final, or user approval. Hard reject — tiers never bypass `--assertions final`. |
| **Under-scoped T2/T3** | Cross-stack or architectural work planned with single-module scopes and no integration assertions. |

T0 is valid only for true production hotfixes with tight `ObservedWriteScope` and known blast radius.
</ceremony_tier_review>

<output>
Return findings with severity, location, why it matters, expected fix direction, and verification target. Do not fix unless explicitly asked.
</output>
</skill>
