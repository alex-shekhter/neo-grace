# GRACE semantic markup for Rust

## Crate visibility and exports

GRACE export parity uses **crate-external** visibility only:

| Visibility | In `exports`? |
|---|---|
| `pub` | yes |
| `pub(crate)` | no — crate-private, not an external export |
| `pub(super)` / `pub(in path)` | no |
| private (no `pub`) | no |

List only true `pub` items in `MAP_MODE: EXPORTS`. Listing a `pub(crate)` symbol produces `markup.module-map-mismatch` by design.

Struct **fields** may be `pub` for field visibility within the type; they are **not** module exports. Same for enum variants, trait methods, and `impl` methods.

## Where MODULE_MAP lives

- **Crate surface:** `lib.rs` (or `main.rs`) with `MAP_MODE: EXPORTS` for the crate's public API, or `MAP_MODE: SUMMARY` when the file is mostly re-exports.
- **Submodules:** each `mod.rs` / module file carries its own map for *that* module's exports.
- Re-export barrels (`pub use …`) often use `MAP_MODE: SUMMARY` or list re-exported names under `EXPORTS` with the understanding that re-exports are recorded as values.

Every file in a module chain should declare the same `LINKS: M-*`.

## Markup placement

Put GRACE markers above the module docs / item docs, never between a `///` doc comment and the item it documents (that breaks `rustdoc`).

```rust
// START_MODULE_CONTRACT
// PURPOSE: Ledger core posting.
// SCOPE: Balanced journal entries.
// DEPENDS: none
// LINKS: M-LEDGER-CORE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
// post - Post a balanced journal entry.
// END_MODULE_MAP

/// Post a balanced journal entry.
pub fn post(amount: i64) -> Result<(), String> {
    // START_BLOCK_VALIDATE_BALANCE
    tracing::warn!("[LedgerCore][post][BLOCK_VALIDATE_BALANCE] unbalanced");
    // END_BLOCK_VALIDATE_BALANCE
    Ok(())
}
```

## Feature gates, macros, and include!

Files with `#[cfg(feature = …)]` items, `include!`, or macro-generated surfaces report `exportConfidence: heuristic` by design. Prefer `MustPassCommand` evidence (`cargo test`, `cargo clippy`) as structural truth for those files.

## Methods and impl blocks

`impl` methods (even `pub fn`) are not crate-level exports. They appear as locals for navigation under `MAP_MODE: LOCALS` only.

## Tests and evidence

Pure library crates often prove behavior with tests rather than runtime logs — use `TraceAssertion` when log markers are not natural. When markers matter, Phase 1 already credits idiomatic `tracing!` / `log!` / `println!` emission.

## unsafe

Document `unsafe` obligations in `MODULE_CONTRACT` prose and wrap critical regions in named `BLOCK_*` markers so verification can require evidence of the safety path.
