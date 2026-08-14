---
name: ngrace-reviewer
description: Review neo-grace integrity across .ngrace artifacts, active changes, scopes, assertions, code anchors, and verification evidence.
---

<skill>
<detachment_contract>
Detached review is a **host capability**, not a skill instruction alone (§5.2).

1. Prefer a **separate subagent instance** with a cold context (no implementer transcript).
2. Use a role preset whose **tool allowlist is read-only** (see `ngrace-setup-subagents` roles).
3. Run mechanized detectors first: `ngrace review --path PROJECT [--change C-ID]`.
4. Form judgment from CLI findings plus your checklist; do not invent a second measurement instrument.
5. Record the outcome with `ngrace gate verdict --change C-ID --outcome <token>` (closed set in
   ngrace-cli `references/verdicts.md`). `ngrace review` never writes Verdicts, Decisions, or status.

On hosts that cannot spawn a cold subagent or enforce a tool allowlist, detachment degrades to an
honor system. Record that honestly using the absence outcome and `host-capability-missing` reason
from the shared vocabulary (or form a non-detached verdict under project `gateFailOn` policy).
Never disguise the gap as a clean pass.
</detachment_contract>

<mechanized_first>
Always run before judgment:

```bash
ngrace review --path . --change C-ID
# optional machine-readable:
ngrace review --path . --change C-ID --format json
```

The CLI emits deterministic finding IDs for pattern detectors (five RM-AGENT-RELIABILITY D4 patterns) and process audits
(scope, test weakening, backward-compat, hunk coverage). Finding IDs are stable across reruns and
unrelated blank-line edits. Use those IDs in your report; do not invent parallel codes.
</mechanized_first>

<review_checklist>
- `.ngrace/context` artifacts are present and relevant.
- `.ngrace/graph/index.xml` routes every graph anchor to the correct graph document.
- `.ngrace/verification/index.xml` routes deterministic `V-M-*` entries and covers current modules.
- Active change specs/plans use valid statuses for their location and exactly one `C-*` wrapper.
- Baseline and target assertions are meaningful and not stale.
- Durable scopes and observed write scopes are explicit; unsafe parallel overlaps are blocked.
- File-local contracts, `LINKS:`, and semantic blocks match durable anchors.
- Verification evidence is fresh and tied to commands or markers.
- Optional `DesignReferences` use http(s) Figma URLs and project-contained `UserResearch` paths.
- Mechanized findings from `ngrace review` are addressed or explicitly deferred with reasons.
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
Return findings with severity, location, why it matters, expected fix direction, verification target,
and any mechanized `findingId` from `ngrace review`. Do not fix unless explicitly asked.
</output>

<verdicts>
Report the value the CLI emitted. Never summarize an absence into a pass. Shared vocabulary:
`references/verdicts.md` under ngrace-cli (do not restate tokens here).

Mechanized findings are ephemeral to the review run. Outcomes that gates consume are recorded only via
`ngrace gate verdict` into `run-ledger.xml` `<Verdicts>` (sibling to `Epoch-N`). Do not invent a second
home for those records. Do not ask `ngrace review` to record a verdict — it cannot and must not.
</verdicts>
</skill>
