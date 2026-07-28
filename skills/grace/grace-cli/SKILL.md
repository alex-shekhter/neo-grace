---
name: grace-cli
description: Operate the GRACE 4 CLI for .grace linting, status, module navigation, verification navigation, and file-local semantic markup.
---

<skill>
<installation_contract>Invoke the installed stable `ngrace` binary directly. If it is missing, install it with `bun add -g @neograce/cli`. Do not default to `bunx`, `npx`, or the `rc` dist-tag.</installation_contract>

<commands>
- Active-baseline preflight before observed writes: `ngrace lint --path PROJECT --assertions current`
- Selected baseline: `ngrace lint --path PROJECT --change C-ID --assertions baseline` (add `--run-commands` when the baseline declares `MustPassCommand`)
- Selected target: `ngrace lint --path PROJECT --change C-ID --assertions target --run-commands`
- Final execution gate: `ngrace lint --path PROJECT --change C-ID --assertions final --run-commands`
- Parallel preflight: `ngrace lint --path PROJECT --parallel-preflight`
- Status: `ngrace status --path PROJECT --with modules --json`
- Navigation: `ngrace module find|show`, `ngrace verification find|show`, and `ngrace file show`.
</commands>

<lifecycle_command_contract>`current` evaluates active approved baselines and is not end-state evidence. Keep `MustPassCommand` entries as leaf project checks; do not nest `ngrace lint`, `ngrace status`, or another GRACE lifecycle command inside plan assertions. Run selected target/final lint externally.</lifecycle_command_contract>

<failure_contract>
Lint, status, and navigation commands validate before returning records. JSON argument/runtime failures are one `{ "schemaVersion": "1.0.0", "ok": false, "error": { ... } }` object on stdout. Text failures are one concise actionable line with a nonzero exit code and no stack trace.
</failure_contract>

<runtime_contract>
TypeScript/JavaScript analysis is bundled. Python and Dart governed files require their runtimes on PATH; missing runtimes fail closed with actionable `analysis.runtime-missing` diagnostics instead of silently dropping parity checks.
MODULE_MAP parity is enforced only for adapter-backed languages. For languages reported under `analysis.no-adapter`, treat MODULE_MAP as agent-maintained documentation and require `MustPassCommand` evidence as the source of structural truth.
</runtime_contract>

<migration_boundary>GRACE 4 commands do not dual-validate legacy GRACE 3 docs. Use `grace-migrate`.</migration_boundary>
</skill>
