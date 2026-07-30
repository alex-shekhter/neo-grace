---
name: ngrace-verification
description: Design and maintain neo-grace verification entries, commands, scenarios, markers, and assertion evidence under .ngrace/verification.
---

<skill>
<purpose>
Strengthen deterministic verification for modules and changes. Verification state lives in `.ngrace/verification/index.xml` and routed verification documents. Each durable module should have deterministic `V-M-*` coverage unless an explicit exception is planned.
</purpose>

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
Use `<Marker>` when module health must prove a runtime log or trace emission from linked implementation code. Use `<TraceAssertion>` for deterministic test or trace evidence that does not require runtime logging, such as pure functions, type-level modules, and core libraries. A non-empty marker or trace assertion satisfies the module-health evidence requirement; only authored markers require matching runtime emission and `BLOCK_*` evidence.
</evidence_contract>

<verdicts>
Report the value the CLI emitted. Never summarize an absence into a pass. Shared vocabulary: `references/verdicts.md` under ngrace-cli (do not restate tokens here).
</verdicts>
</skill>
