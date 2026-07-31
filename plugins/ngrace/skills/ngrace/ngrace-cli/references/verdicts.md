# Authored verdict vocabularies

Shared vocabulary for surfaces the CLI does not emit. Skills reference this file;
they do not restate these tokens. Issue codes and absence reasons stay in the binary.

## Review outcomes

- `pass` — checked and acceptable
- `fail` — checked and not acceptable
- `unable-to-determine` — no honest verdict was possible (absence)

Recorded on the change bundle in `run-ledger.xml` under `<Verdicts><Verdict outcome="…" reason="…"/></Verdicts>`
(sibling to `Epoch-N`; not a loose `run/` event). The apply gate requires a recorded verdict of any
outcome, including `unable-to-determine` (D11).

### Absence reasons on a review verdict

- `host-capability-missing` — the host cannot produce a detached review (D11). Whether that blocks
  apply is the project `gateFailOn` policy in `.ngrace-lint.json` (`errors` | `warnings` | `never`).
  It is never disguised as `pass`.

## Acceptance-criterion satisfaction

- `satisfied` — criterion met with evidence
- `satisfied-unverified` — claimed met without independent evidence
- `not-satisfied` — criterion not met

## Verification row results

- `pass` — command or check succeeded
- `fail` — command or check failed
- `not-run` — evidence was not produced (absence)
