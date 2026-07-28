# Lineage and credits

`neo-grace` is a fork. This file records where it came from and who is owed credit for
what. It is the canonical attribution document; the README carries a short pointer to it
and nothing more, so the two cannot drift apart.

## The methodology

**GRACE — Graph-RAG Anchored Code Engineering — is a methodology by Vladimir Ivanov.**

Everything this repository packages is an implementation of that methodology: semantic
markup, the `.grace` durable model, knowledge-graph navigation, contract-first change
bundles, and log-driven verification. The ideas are his. Forking the tooling does not
fork the authorship of the method, and no change to this repository ever transfers it.

## The upstream repository

This project is a fork of **[osovv/grace-marketplace](https://github.com/osovv/grace-marketplace)**,
published on npm as `@osovv/grace-cli`.

That repository is the parent of this one in the fullest sense: the skills, the CLI, the
artifact grammar, the marketplace packaging, and the release tooling all originate there.
`neo-grace` began as a working copy of it and inherits its entire git history.

Upstream contributors, from that history:

- Aleksei Chendemerov
- Aleksey Chendemerov
- Alex Shekhter
- Denis Scheglov
- dmkononenko

## Version lineage

Versions continue upstream's numbering rather than restarting. Upstream's last published
release was `@osovv/grace-cli@4.0.4`; this fork's first release is `neo-grace@5.0.0`.

`CHANGELOG.md` reflects that split literally: **every entry at 4.0.4 and below describes
work that happened in the upstream repository**, including commit permalinks that point
at `github.com/osovv/grace-marketplace`. Those entries are history and are not edited
here — not the wording, not the links, not the version numbers. Entries from 5.0.0 onward
describe work done in this fork.

## What this fork changed

The 5.0.0 entry in `CHANGELOG.md` is the complete record. In summary, it turned GRACE's
language claims honest and rebuilt the on-ramp:

- Go and Rust export adapters written as pure TypeScript scanners, so no language
  toolchain is required, plus `analysis.no-adapter` rather than silent false confidence
- Spec→plan traceability (`AC-*`, `Satisfies`, `OutOfPlanScope`)
- A design-system layer, interface contracts (`IC-*`), invariants, and performance budgets
- `ngrace doctor`, `ngrace graph split`, document-size warnings, multi-stack technology
- `codeExtensions`, so a project can govern a language the tool ships no adapter for
- A CI-verified twenty-minute walkthrough and a standalone visual introduction

## Naming

The binary is `ngrace`, not `grace`, so this fork and upstream can be installed side by
side without one silently shadowing the other. That follows the Vim/Neovim precedent: a
fork that expects to coexist takes a distinct command name rather than fighting over the
parent's.

The npm package is `neo-grace`. The methodology it implements is still called GRACE.

## Licence

Upstream is MIT and so is this fork. `LICENSE` carries both copyright lines: the original
`GRACE Framework Contributors` notice, which MIT requires be retained, and this fork's.
The original is never removed or replaced.

## Contributing upstream

Nothing here has been offered to `osovv/grace-marketplace` yet. If upstream wants any of
it, it is MIT and it is theirs to take — no permission needed and none owed. A pull
request from this fork is welcome to be opened by anyone.
