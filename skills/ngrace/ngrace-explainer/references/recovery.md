# Recovery procedures

Executed procedures for common failures. Each is meant to be **run**, not only read.
Use a scratch copy of a project when a command writes (`gate`, `cursor`).

## 1 · Unfamiliar lint / issue code

```bash
ngrace lint --explain <code>
```

Three outcomes (Phase 11 honesty):

| Classification | Exit | Meaning |
|---|---|---|
| `exact` | 0 | Dedicated catalogue entry |
| `emittable-uncatalogued` | 0 | Binary can emit it (e.g. `review.*`, `gate.*`) but has no dedicated lint entry — **does not** claim "signals drift" |
| `unknown` | **non-zero** | This binary does **not** emit that string — spelling error or stale docs |

Example (unknown — must not look like a real finding):

```bash
ngrace lint --explain not.a.real.code
# Classification: unknown · exit 1 · "this binary does not emit …"
```

## 2 · Rebuild a lost cursor from the ledger

The cursor (`run.xml`) is a **cache**. Truth is `run-ledger.xml` plus loose `run/` events.

```bash
# Dry-run by default — no write:
ngrace cursor regenerate --change C-ID --path .

# Apply when the preview is right:
ngrace cursor regenerate --change C-ID --path . --apply
```

If the ledger is also gone, regenerate degrades with absence reasons rather than inventing
progress. Prefer restoring the ledger from git over hand-editing `run.xml`.

## 3 · Read an incomplete epoch

An open epoch means loose files under `.ngrace/changes/active/C-ID/run/`.

```bash
ngrace cursor show --change C-ID --path .
# Shows epoch, task, state; recovers rather than blocking.

ls .ngrace/changes/active/C-ID/run/
# Loose events not yet folded.

ngrace cursor fold --change C-ID --path .
# Fails closed if ranges have holes or lack a terminal — never half-writes a ledger section.
```

Archive refuses while an epoch is open (`gate.archive.open-epoch`). Fold first, then archive.

## Related CLI

- `ngrace gate approve | apply | archive | verdict`
- `ngrace review` (mechanized findings; does not record Verdicts)
- Host detachment matrix: repository `README.md`
