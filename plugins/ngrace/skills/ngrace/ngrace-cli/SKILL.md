---
name: ngrace-cli
description: Operate the neo-grace CLI for .ngrace linting, status, module navigation, verification navigation, and file-local semantic markup.
---

<skill>
<installation_contract>Invoke the installed stable `ngrace` binary directly. If it is missing, install it with `bun add -g @neograce/cli`. Do not default to `bunx`, `npx`, or the `rc` dist-tag.</installation_contract>

<shape_sources>
Command inventory: README CLI Overview table (bound to `listLiveInvocations`). Do not restate that inventory here.
Explain a shape or code: argv token `explain`.
Registered artifact shapes: `docs/schema-reference.md`. That document is not a complete grammar.
</shape_sources>

<commands>
The live command inventory is the README CLI Overview table. Assertion-mode and fail-closed workflow stay in this skill.
- Active-baseline, selected baseline, selected target, and final assertion modes: see `lifecycle_command_contract`.
- Issue code lookup: argv token `explain` — a catalogued entry, a code the binary emits without a dedicated entry, or an unknown string (says so, exits nonzero). Never infer a meaning it did not print.
</commands>

<lifecycle_command_contract>`current` evaluates active approved baselines and is not end-state evidence. Keep `MustPassCommand` entries as leaf project checks; do not nest `ngrace lint`, `ngrace status`, or another GRACE lifecycle command inside plan assertions. Run selected target/final lint externally.</lifecycle_command_contract>

<failure_contract>
Lint, status, and navigation commands validate before returning records. JSON argument/runtime failures are one `{ "schemaVersion": "1.0.0", "ok": false, "error": { ... } }` object on stdout. Text failures are one concise actionable line with a nonzero exit code and no stack trace.
</failure_contract>

<runtime_contract>
TypeScript/JavaScript analysis is bundled. Python and Dart governed files require their runtimes on PATH; missing runtimes fail closed with actionable `analysis.runtime-missing` diagnostics instead of silently dropping parity checks.
MODULE_MAP parity is enforced only for adapter-backed languages. For languages reported under `analysis.no-adapter`, treat MODULE_MAP as agent-maintained documentation and require `MustPassCommand` evidence as the source of structural truth.
</runtime_contract>

<migration_boundary>neo-grace commands do not dual-validate legacy GRACE 3 docs. Use `ngrace-migrate`.</migration_boundary>
</skill>
