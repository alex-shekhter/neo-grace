---
name: ngrace-verification
description: Design and maintain neo-grace verification entries, commands, scenarios, markers, and assertion evidence under .ngrace/verification.
---

<skill>
<purpose>
Strengthen deterministic verification for modules and changes. Verification state lives in `.ngrace/verification/index.xml` and routed verification documents. Each durable module should have deterministic `V-M-*` coverage unless an explicit exception is planned.
</purpose>

<shape_sources>
Registered verification shapes: `docs/schema-reference.md` (artifact-root `NgraceVerificationDocument`, anchor-family `V-M-`). That document is not a complete grammar and does not carry Marker / TraceAssertion doctrine.
Explain a shape or code: argv token `explain`.
Taught example: `examples/polyglot`.
</shape_sources>

<workflow>
1. Read relevant `.ngrace/graph` anchors and current `V-M-*` entries.
2. Identify scenarios, commands, test files, required log markers, and trace assertions.
3. Ensure commands are deterministic and runnable from the project root or documented cwd.
4. Update or propose `.ngrace/verification` changes through the active change plan.
5. Run the commands and record fresh evidence in the response.
</workflow>
<cwd_contract>
When verification commands run from a workspace or package directory, add one direct `<Cwd>relative/project/path</Cwd>` child to the owning `V-M-*` entry. Keep declared `<TestFiles><File>...</File></TestFiles>` paths project-root-relative; the CLI uses `Cwd` only to compare them with cwd-relative command arguments.
</cwd_contract>
<evidence_contract>
TraceAssertion plus tests is the default for deterministic module health. Marker is only for proving a runtime trajectory (`BLOCK-*` emission from linked implementation). A non-empty Marker is not an equal alternative to TraceAssertion.
</evidence_contract>

<verdicts>
Report the value the CLI emitted. Never summarize an absence into a pass. Shared vocabulary: `references/verdicts.md` under ngrace-cli (do not restate tokens here).
</verdicts>
</skill>
