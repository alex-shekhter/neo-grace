# Knowledge Graph Maintenance

The `.grace/graph/` directory is the single source of truth for the project's module structure. It maps every module, its public interface, its dependencies, and how modules connect to each other. The `index.xml` file lists GD-* document routes and the modules each document owns.

## Structure

```xml
<GraceGraphIndex graceVersion="4.0">
  <GraphDocuments>
    <GD-MAIN>
      <Path>graph/main.xml</Path>
      <Owns>
        <M-CONFIG />
        <M-DB />
      </Owns>
    </GD-MAIN>
  </GraphDocuments>
</GraceGraphIndex>
```

Each GD-* document contains the actual module and data-flow definitions:

```xml
<GraceGraphDocument graceVersion="4.0">
  <GD-MAIN>
    <M-CONFIG>
      <Summary>Application configuration and environment management</Summary>
      <Path>src/config/index.ts</Path>
      <M-DB />
    </M-CONFIG>
    <M-DB>
      <Summary>Database connection and query layer</Summary>
      <Path>src/db/index.ts</Path>
    </M-DB>
  </GD-MAIN>
</GraceGraphDocument>
```

## Module Tag Convention

Every module uses a **unique ID as the XML tag name**:
- `<M-CONFIG>` not `<Module ID="M-CONFIG">`
- `<M-DB>` not `<Module ID="M-DB">`

This eliminates closing-tag polysemy — `</M-CONFIG>` is unambiguous while multiple `</Module>` closings create "semantic soup" for LLMs.

Canonical grep-stable naming rules:

- module IDs use exact uppercase kebab form with `M-` prefix only
- verification refs use exact `V-M-<MODULE-SUFFIX>` form only
- annotation tags use exact prefixes: `fn-`, `type-`, `class-`, `export-`, `const-`
- edge tags use exact `CrossLink` spelling and exact `from`, `to`, `relation` attributes
- avoid alternate synonyms like `moduleId`, `verificationId`, `edge`, `source`, or `target` when canonical anchors already exist

## Module Types

| Type | Description |
|------|-------------|
| ENTRY_POINT | Where execution begins (CLI, HTTP handler, event listener) |
| CORE_LOGIC | Business rules and domain logic |
| DATA_LAYER | Persistence, queries, caching |
| UI_COMPONENT | User interface elements |
| UTILITY | Shared helpers, configuration, logging |
| INTEGRATION | External service adapters |

`ngrace lint` accepts these values on module `<Type>`. Other free-text types emit
`graph.unknown-module-type` as a **warning** (not an error) so legacy projects stay green.

## UI Component States

`UI_COMPONENT` modules may declare interaction states under `<States>`:

```xml
<M-LEDGER-TABLE>
  <Summary>Ledger rows</Summary>
  <Type>UI_COMPONENT</Type>
  <Path>apps/web/src/LedgerTable.tsx</Path>
  <States>
    <ST-DEFAULT />
    <ST-EMPTY />
    <ST-LOADING />
    <ST-ERROR />
    <ST-FOCUS-VISIBLE />
    <ST-DISABLED />
  </States>
</M-LEDGER-TABLE>
```

Each declared `ST-*` must be named by at least one `Scenario`, `AccessibilityCheck`,
or `VisualCheck` under `V-M-*`. Matching rule: case-insensitive match of the state id
**without the `ST-` prefix**, as consecutive **whole words**, with `-` and camelCase
treated as word separators (so `ST-FOCUS-VISIBLE` matches "focus visible",
"focus-visible", or "focusVisible", and `ST-LOADING` matches "loading spinner" but not
"downloading assets"). Missing coverage is
`health.ui-state-unverified`. A `UI_COMPONENT` with no states while UX guidelines are
applicable gets `health.ui-states-undeclared`.

## Annotation Tags

| Tag | Purpose |
|-----|---------|
| `<fn-name>` | Public function in the module's external contract |
| `<type-Name>` | Public type/interface exposed by the module |
| `<class-Name>` | Public class in the module interface |
| `<export-name>` | Public named export (constants, config objects) |
| `<const-NAME>` | Public constant |

Do not mirror every private helper from the source file into `<annotations>`. Private orchestration helpers, local-only utility functions, and implementation-only types stay in the module file header and local contracts.

## Links

Links between modules are expressed as direct child tags:

```xml
<M-CONFIG>
  <Summary>Config management</Summary>
  <M-DB />   <!-- M-CONFIG links to M-DB -->
</M-CONFIG>
```

## Interface Contracts (`IC-*`)

Cross-service wire contracts live in graph documents alongside modules and flows:

```xml
<IC-LEDGER-POSTING-V1>
  <Summary>gRPC posting contract between gateway and ledger core.</Summary>
  <Schema>proto/ledger/v1/posting.proto</Schema>
  <Version>1.2.0</Version>
  <Provider><M-LEDGER-CORE /></Provider>
  <Consumer><M-GATEWAY-ROUTER /></Consumer>
  <BreakingChangePolicy>additive-only</BreakingChangePolicy>
</IC-LEDGER-POSTING-V1>
```

Rules:

- `Schema` is a project-relative path that must exist (no `..`, no absolute paths)
- `Version` is semver (`major.minor.patch`)
- `Provider` is exactly one existing `M-*`; each `Consumer` is an existing `M-*`
- `BreakingChangePolicy` is one of `additive-only`, `versioned`, `breaking-allowed`
- List every `IC-*` under the owning `GD-*` in `graph/index.xml` `<Owns>`
- Assert conformance in plans with `MustConform` (`Contract`, `Module`, `Command`); without `--run-commands` only references are checked; with the flag the command runs (`buf breaking`, `oasdiff`, …)

## Ordered Data Flows (`DF-*` Steps)

Legacy flat participant sets stay valid:

```xml
<DF-POSTING>
  <Summary>Posting flow.</Summary>
  <M-WEB-LEDGER-TABLE />
  <M-GATEWAY-ROUTER />
  <M-LEDGER-CORE />
</DF-POSTING>
```

Ordered form (backward compatible — use when sequence matters):

```xml
<DF-POSTING>
  <Summary>Posting flow from console to ledger.</Summary>
  <Step order="1"><M-WEB-LEDGER-TABLE /><Emits>PostingRequested</Emits></Step>
  <Step order="2"><M-GATEWAY-ROUTER /><Contract><IC-LEDGER-POSTING-V1 /></Contract><Property>authenticated</Property></Step>
  <Step order="3"><M-LEDGER-CORE /><Property>idempotent</Property><Property>transactional</Property></Step>
</DF-POSTING>
```

`order` must be unique positive integers, contiguous from 1. Each `Step` names exactly one `M-*`. `Property` values: `idempotent`, `transactional`, `retryable`, `authenticated`. Do not mix bare participants with `<Step>` children.

## Cross-Cutting Invariants (`invariants.xml`)

Optional context artifact (absence is not an error):

```xml
<GraceInvariants graceVersion="4.0">
  <INV-IDEMPOTENT-WRITES>
    <Statement>Every ledger write is idempotent under posting id.</Statement>
    <AppliesTo><M-LEDGER-CORE /><M-GATEWAY-ROUTER /></AppliesTo>
    <Verification><V-M-LEDGER-CORE /></Verification>
  </INV-IDEMPOTENT-WRITES>
</GraceInvariants>
```

Assert with `MustUphold` (`Invariant`, `Module`). Performance thresholds use `MustPassBudget` (`Command`, `Metric`, `Operator` lt|lte|gt|gte, `Threshold`, `Unit`, optional `Extract` regex with one capture group). Budget checks require `--run-commands`.

## Document size and segmentation

When a `GD-*` or `VD-*` document grows past ~50 anchors or ~30 KB, `ngrace lint`
emits `graph.document-too-large` / `verification.document-too-large` **warnings**
(limits configurable in `.grace-lint.json` as `documentAnchorLimit` /
`documentByteLimit`). Split graph modules by path prefix:

```bash
ngrace graph split --by services/api          # dry-run plan
ngrace graph split --by services/api --apply  # write (refuses dirty git without --allow-dirty)
```

`ngrace doctor` reports adapter coverage, document-size pressure, and missing
optional context artifacts without writing anything.

## Multi-stack technology

Optional form in `technology.xml` (flat `Language`/`Runtime` still valid):

```xml
<GraceTechnology graceVersion="4.0">
  <Stacks>
    <Stack-WEB><Language>TypeScript</Language><Root>apps/web</Root></Stack-WEB>
    <Stack-API><Language>Go</Language><Root>services/api</Root></Stack-API>
  </Stacks>
</GraceTechnology>
```

Each `Stack-*` requires a project-contained existing `<Root>`.

## Verification References

The `.grace/verification/` directory provides matching V-M-* entries. The verification reference is mechanically derivable from the module ID by replacing the leading `M-` with `V-M-`.

This keeps navigation and proof linked:
- the graph answers where the module lives and what it depends on
- the verification plan answers how the module proves correctness

## Maintenance Rules

1. **Always current** — when you add a module, add it to the graph. When you add a dependency, link it. Never let the graph drift from reality.
2. **Scan on doubt** — if unsure whether the graph is current, run `$ngrace-refresh` to scan and sync.
3. **Version tracking** — increment the graph index when the graph changes structurally (new modules, removed modules).
4. **Annotations match the public interface** — if a module's public exports change, update its `<annotations>` section.
5. **Verification refs stay valid** — if a module's verification entry changes ID, update its graph document.
6. **No orphans** — if a module is deleted, remove its graph entry and all links referencing it.
