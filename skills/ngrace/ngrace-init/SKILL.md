---
name: ngrace-init
description: Bootstrap a Full GRACE 4 project by creating the canonical .ngrace context, graph, verification, and changes skeleton.
---

<skill>
<task>
Create the canonical GRACE 4 project layout from this skill's `assets/` templates:

- `AGENTS.md`
- `.ngrace/context/requirements.xml`
- `.ngrace/context/technology.xml`
- `.ngrace/context/principles.xml`
- `.ngrace/context/deployment.xml`
- `.ngrace/context/ux-guidelines.xml`
- `.ngrace/graph/index.xml`
- `.ngrace/graph/main.xml`
- `.ngrace/verification/index.xml`
- `.ngrace/verification/main.xml`
- `.ngrace/changes/active/`
- `.ngrace/changes/archive/`

Every XML artifact uses `graceVersion="4.0"`. Semantic anchors are XML tags, never attributes. Do not create dummy `C-*` change bundles. Do not overwrite existing `.ngrace` artifacts without explicit confirmation.
</task>

<template_sources>
| Template source | Target in project |
|---|---|
| `assets/AGENTS.md.template` | `AGENTS.md` |
| `assets/.ngrace/context/requirements.xml.template` | `.ngrace/context/requirements.xml` |
| `assets/.ngrace/context/technology.xml.template` | `.ngrace/context/technology.xml` |
| `assets/.ngrace/context/principles.xml.template` | `.ngrace/context/principles.xml` |
| `assets/.ngrace/context/deployment.xml.template` | `.ngrace/context/deployment.xml` |
| `assets/.ngrace/context/ux-guidelines.xml.template` | `.ngrace/context/ux-guidelines.xml` |
| `assets/.ngrace/graph/index.xml.template` | `.ngrace/graph/index.xml` |
| `assets/.ngrace/graph/main.xml.template` | `.ngrace/graph/main.xml` |
| `assets/.ngrace/verification/index.xml.template` | `.ngrace/verification/index.xml` |
| `assets/.ngrace/verification/main.xml.template` | `.ngrace/verification/main.xml` |
</template_sources>

<cli_precondition>
**Check for the `grace` binary before writing anything.** Run `ngrace --version`.

If it is missing, install it with `bun add -g @neograce/cli` and check again.

If it is still missing after the install attempt, **refuse to initialize**. Create no
directories and write no files. Report exactly this, adapted to the observed error:

> GRACE init stopped: the `grace` CLI is not available and could not be installed.
>
> The CLI is what validates `.ngrace` artifacts — XML well-formedness, required sections,
> anchor discipline, path containment, and cross-artifact references. It is also every
> execution gate (`--assertions baseline|target|final`). Without it, init would produce
> artifacts that nothing checks, which is the failure mode GRACE exists to remove.
>
> Install it with `bun add -g @neograce/cli`, then run `$ngrace-init` again.
> Requires Bun: https://bun.sh

Do not offer to continue without validation, do not offer a reduced or "manual" init, and
do not write a partial `.ngrace` tree for the user to finish later. A half-initialized,
unvalidated project is worse than no project: later skills will treat it as a real model.

This check runs first for the same reason `ngrace graph split` stages its writes — a
precondition that fires after the work has begun is not a precondition.
</cli_precondition>

<steps>
0. Verify the `grace` CLI per `<cli_precondition>`. Stop here if it cannot be obtained.
1. Gather project name, annotation, keywords, language/runtime/framework, testing stack, observability constraints, deployment applicability, UX applicability, and any known initial modules.
2. If `.ngrace` or `AGENTS.md` already exists, stop and ask whether to keep, merge, or overwrite each existing artifact. Never overwrite silently.
3. Create `.ngrace/context`, `.ngrace/graph`, `.ngrace/verification`, `.ngrace/changes/active`, and `.ngrace/changes/archive`.
4. Read each `.template` file, replace `$PLACEHOLDER` values with gathered project information, and write the target file.
5. Run `ngrace lint --path <project-root>`. If it reports errors, fix the generated artifacts and re-run until clean. Do not report init complete while lint is failing.
6. Print created files and recommend the next workflow: use `ngrace-spec` to create an active `NgraceChangeSpec`, then `ngrace-plan` to produce a `NgraceChangePlan` before implementation.
</steps>

<hard_rules>
- GRACE 4 state lives under `.ngrace`; do not create legacy `docs/*.xml` as the bootstrap surface.
- `NgraceChangeSpec` and `NgraceChangePlan` are created by later change workflows, not by init.
- If legacy GRACE 3 docs are present, explain that migration is handled only by `ngrace-migrate`; init must not convert or delete them.
- The `grace` CLI is a precondition, not a recommendation. Verify it before writing, and refuse to initialize when it cannot be obtained — see `<cli_precondition>`.
- Validate the resulting project with `ngrace lint --path <project-root>` before reporting init complete. An unvalidated `.ngrace` tree is not a finished init.
</hard_rules>
</skill>
