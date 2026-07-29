# Golden-path polyglot example

A worked GRACE 4 project for a React UI + Go API + Rust core monorepo. Use this as the pattern-match source for module granularity, segmented graph/verification documents, design-system tokens, invariants, interface contracts, and change-bundle lifecycle.

## Layout

| Path | Role |
|---|---|
| `apps/web` | React UI (`M-WEB-LEDGER-TABLE`) + design tokens |
| `services/api` | Go gateway router (`M-API-ROUTER`) |
| `crates/core` | Rust ledger core (`M-LEDGER-CORE`) |
| `openapi/posting.yaml` | Schema for `IC-POSTING-V1` |
| `.ngrace/graph/{ui,api,core,contracts}.xml` | Segmented knowledge graph |
| `.ngrace/verification/{ui,api,core}.xml` | Segmented verification |
| `.ngrace/context/design-system.xml` | Tokens + breakpoints |
| `.ngrace/context/invariants.xml` | Cross-cutting invariants |
| `.ngrace/changes/active/C-ADD-KEYBOARD-NAV` | Mid-lifecycle approved change |
| `.ngrace/changes/archive/C-ADD-POSTING-CONTRACT` | Applied happy-path archive |

## Multi-stack technology

`technology.xml` declares three `Stack-*` roots under `<Stacks>` so each package has its own language/runtime/testing defaults without forcing a single global stack.

## Validate

```bash
ngrace lint --path examples/polyglot
```

CI runs this on every push. Zero errors is the contract; warnings (if any) are intentional documentation signals.

## Ceremony tier note

The active change is a **T1** module-level UI feature (keyboard nav). The archived change was **T2** (cross-stack contract introduction). See `grace-spec` / `grace-plan` for T0–T3 section guidance — tiers never skip `--assertions final`.
