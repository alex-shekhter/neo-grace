# Authored verdict vocabularies

Shared vocabulary for surfaces the CLI does not emit. Skills reference this file;
they do not restate these tokens. Issue codes and absence reasons stay in the binary.

## Review outcomes

- `pass` — checked and acceptable
- `fail` — checked and not acceptable
- `unable-to-determine` — no honest verdict was possible (absence)

## Acceptance-criterion satisfaction

- `satisfied` — criterion met with evidence
- `satisfied-unverified` — claimed met without independent evidence
- `not-satisfied` — criterion not met

## Verification row results

- `pass` — command or check succeeded
- `fail` — command or check failed
- `not-run` — evidence was not produced (absence)
