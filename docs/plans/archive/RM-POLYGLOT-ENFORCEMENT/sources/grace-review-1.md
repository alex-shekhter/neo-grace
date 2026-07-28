# GRACE Methodology: Comprehensive Evaluation & Improvement Plan

**Reviewer**: Senior AI/Systems Expert
**Date**: 2026-07-28
**Target Use Case**: Projects with high UI/UX requirements + complex backends in Rust & Go
**GRACE Version Reviewed**: 4.0.4

---

## Executive Summary

GRACE (Graph-RAG Anchored Code Engineering) is a **contract-first AI engineering methodology** that brings rigor, determinism, and multi-agent safety to AI-assisted development. It is exceptionally well-designed for backend-heavy, logic-dense projects where correctness is paramount. However, it has **significant gaps for UI/UX-intensive work** and **incomplete language support for Rust and Go** that must be addressed before it can serve as a comprehensive methodology for full-stack projects with complex frontends and polyglot backends.

**Overall Assessment**: GRACE is a **strong foundation** (8/10 for backend TypeScript projects, 6/10 for polyglot backends, 3/10 for UI/UX-heavy work). With the improvements outlined below, it could reach 8-9/10 across all dimensions.

---

## Part 1: How GRACE Works

### 1.1 Core Architecture

GRACE organizes AI-assisted development around five pillars:

#### Pillar 1: Durable Project Model (`.grace/`)

```
.grace/
├── context/           # Requirements, technology, principles, deployment, UX
│   ├── requirements.xml
│   ├── technology.xml
│   ├── principles.xml
│   ├── deployment.xml
│   └── ux-guidelines.xml
├── graph/             # Knowledge graph: modules, data flows, dependencies
│   ├── index.xml      # Routes GD-* documents to their files
│   └── main.xml       # Contains M-* modules and DF-* data flows
├── verification/      # Verification contracts and evidence
│   ├── index.xml      # Routes VD-* documents to their files
│   └── main.xml       # Contains V-M-* verification entries
└── changes/           # Change management
    ├── active/C-*/    # In-flight change bundles (spec + plan)
    └── archive/C-*/   # Completed/terminal changes
```

#### Pillar 2: Semantic Markup (File-Local Contracts)

Every governed source file carries load-bearing markup:

```
// START_MODULE_CONTRACT
//   PURPOSE: [What this module does]
//   SCOPE: [Bounded responsibility]
//   DEPENDS: [M-* dependencies]
//   LINKS: [Related M-* and V-M-* anchors]
// END_MODULE_CONTRACT

// START_MODULE_MAP
//   exportedSymbol - one-line responsibility
// END_MODULE_MAP

// START_CONTRACT: functionName
//   PURPOSE: [What it does]
//   INPUTS: { paramName: Type - description }
//   OUTPUTS: { ReturnType - description }
//   SIDE_EFFECTS: [External state changes]
// END_CONTRACT: functionName

// START_BLOCK_VALIDATE_INPUT
// ... implementation ...
// END_BLOCK_VALIDATE_INPUT
```

#### Pillar 3: Unique Tag Convention (Semantic Anchors)

Instead of generic XML tags with ID attributes, GRACE uses the ID itself as the tag name:

```xml
<!-- GRACE way: unambiguous closing tags -->
<M-AUTH NAME="Authentication" TYPE="CORE_LOGIC">
  <M-DB />
</M-AUTH>

<!-- NOT: ambiguous </Module> closings -->
<Module ID="M-AUTH">...</Module>
```

This eliminates "closing-tag polysemy" — a known LLM attention problem where `</Module>` forces backtracking to determine which module is being closed. Unique tags like `</M-AUTH>` serve as "semantic accumulators" that re-activate all associations built since the opening tag.

#### Pillar 4: Assertions & Scopes (Machine-Checkable Contracts)

Plans declare two kinds of assertions:

| Assertion Kind | Purpose |
|---|---|
| `MustExist` / `MustNotExist` | Anchor or file existence |
| `MustOwn` | Document-to-anchor ownership |
| `MustLink` | Inter-module dependency links |
| `MustVerify` | Verification coverage requirements |
| `MustPassCommand` | Leaf project evidence (tests, builds, lint) |
| `MustContain` / `MustNotContain` | File content assertions |

And two kinds of scopes:

- **DurableScope**: What `.grace` artifacts a change may touch (graph anchors, verification anchors, context artifacts)
- **ObservedWriteScope**: What source files a change may write to (explicit files + supported globs)

These enable **parallel-safe execution**: the CLI can detect scope overlaps between approved plans and block unsafe concurrent work.

#### Pillar 5: Recovery-Aware Execution Lifecycle

```
grace-spec  →  grace-plan  →  grace-execute
    ↓              ↓               ↓
  spec.xml      plan.xml      sequential | parallel-safe
  (draft→       (assertions,   (baseline→tasks→target→final→archive)
   approved)     scopes,
                 tasks)
```

The execution workflow has a decision table for recovery:

| State | Action |
|---|---|
| clean-to-start | Run baseline, execute tasks |
| partial-observed-writes | Inspect scope, ask: resume or revert |
| durable-state-changed | Hard stop; supersede and replan |
| target-already-satisfied | Run final validation, reconcile, confirm |
| unsafe-unknown-drift | Hard stop, report unexplained files |

### 1.2 The CLI (`grace`)

The Bun-powered CLI provides:

- **`grace lint`**: Multi-mode validation (current/baseline/target/final/parallel-preflight)
- **`grace status`**: Health report with module summaries, drift detection, next-action guidance
- **`grace module find|show`**: Graph projection navigation
- **`grace verification find|show`**: Verification projection navigation
- **`grace file show`**: File-local markup inspection

All commands fail closed with structured JSON error envelopes (`schemaVersion`, `ok`, `error`).

### 1.3 Multi-Agent Architecture

GRACE defines four subagent roles:

1. **Module Implementer**: Implements one module within assigned scope
2. **Contract Reviewer**: Verifies implementation matches approved contract
3. **Fixer**: Takes failure packets and applies minimal fixes
4. **Verification Reviewer**: Assesses whether verification is strong enough for autonomous execution

### 1.4 Language Adapter Architecture

| Language | Support Level |
|---|---|
| TypeScript/JavaScript | **Bundled** — compiler-backed export parity checking |
| Python | **Runtime adapter** — requires `python3` on PATH; exact with `__all__`, heuristic otherwise |
| Dart | **Runtime adapter** — requires `dart` on PATH |
| Go | **Not supported** — no adapter exists |
| Rust | **Not supported** — no adapter exists |

---

## Part 2: Strengths

### 2.1 Structural Strengths

1. **Contract-First Discipline**: Forces explicit specification before implementation. This is the single most important guardrail for AI coding agents, which otherwise tend to over-build or drift from intent.

2. **Semantic Anchors as XML Tags**: The unique-tag convention is genuinely clever. It directly addresses a known LLM weakness (closing-tag ambiguity in large XML documents) and makes the artifacts more navigable for both humans and agents.

3. **Deterministic, Machine-Checkable Assertions**: Unlike prose-based acceptance criteria, GRACE assertions are evaluated by a real parser. `MustPassCommand` with `--run-commands` opt-in means tests, typecheck, and builds become part of the automated evidence chain.

4. **Parallel-Safe Execution**: The scope overlap detection (both durable and observed-write) is a sophisticated solution to a real multi-agent problem. The glob intersection algorithm with globstar support is non-trivial and well-implemented.

5. **Fail-Closed Everywhere**: Every command, every validation, every path resolution fails closed. Invalid paths, missing runtimes, ambiguous states — all produce structured errors, never silent degradation. This is essential for autonomous agent workflows.

6. **Immutable Approved Plans**: Once approved, assertions/scopes/tasks cannot be edited in place. Changes require superseding with a new bundle. This prevents the "silent scope creep" that plagues agentic development.

7. **Recovery-Aware State Machine**: The execution decision table (clean/partial/durable-changed/target-satisfied/unknown-drift) is pragmatic and covers the real failure modes of agentic workflows.

8. **Grep-First Navigation**: The explicit navigation order (graph index → graph doc → verification index → verification doc → changes → file-local markup) gives agents a deterministic path to understanding any project.

9. **Migration Safety**: GRACE 3→4 migration is copy-and-validate, never destructive. The cleanup preconditions (inventory, backup, lint pass, status pass, git inspection, explicit approval, dirty-worktree acknowledgement) are exhaustive and correct.

10. **Structured Subagent Contracts**: The four subagent roles have clear input/output contracts, scope boundaries, and escalation paths. This is production-grade multi-agent orchestration.

### 2.2 Implementation Strengths

1. **Well-typed TypeScript source** with comprehensive test coverage across grammar, assertions, scopes, projections, paths, and language adapters.

2. **Path safety**: `resolveContainedProjectPath` prevents `..` escapes, absolute paths, and symlink escapes. This is critical security hygiene for agent-driven file operations.

3. **Glob intersection algorithm**: The scope overlap detection uses a proper BFS-based glob intersection with memoization, handling `*`, `?`, `**`, and case sensitivity correctly.

4. **Projection architecture**: Graph and verification projections are built as logical views independent of physical document segmentation, with full validation (duplicate detection, ownership mismatches, dangling links, missing coverage).

---

## Part 3: Weak Points & Gaps

### 3.1 Critical Gap: No Go Language Adapter

**Severity**: High
**Impact**: Go source files can have GRACE markup but get **zero export parity checking**. The `MODULE_MAP` can drift from actual exports with no automated detection. For a methodology that prides itself on "contract-first" and "verification-driven" development, this is a fundamental gap.

**Root Cause**: The language adapter architecture (`src/lint/adapters/`) only has TypeScript, Python, and Dart implementations. Go's static type system and package structure would require a new adapter.

**What's Missing**:
- Go AST parsing to extract exported symbols (functions, types, interfaces, constants)
- `go/build` or `golang.org/x/tools/go/packages` integration for package-level export discovery
- Handling of Go's capitalization-based export rules (uppercase = exported)
- Support for Go's module structure (`go.mod`, multi-package repos)

### 3.2 Critical Gap: No Rust Language Adapter

**Severity**: High
**Impact**: Same as Go — zero export parity checking for Rust source files.

**What's Missing**:
- Rust AST parsing (via `rust-analyzer` or `syn` crate)
- `pub` visibility detection for functions, structs, enums, traits, type aliases, constants
- Cargo workspace support for multi-crate repositories
- Module tree resolution (`mod` declarations, `pub mod`, `pub use`)

### 3.3 Critical Gap: UI/UX Verification

**Severity**: High
**Impact**: GRACE has no concept of visual correctness. A change can pass all assertions (tests pass, typecheck passes, markers emit) while producing a **visually broken UI**. For projects with high UI/UX requirements, this is a showstopper.

**What's Missing**:
- Visual regression testing integration (screenshot comparison, Percy/Chromatic-style)
- Accessibility (a11y) audit assertions
- Design token / design system compliance checking
- Component-level visual contract testing (Storybook integration)
- Responsive/breakpoint verification
- Cross-browser visual evidence

### 3.4 Moderate Gap: UX Guidelines Are Placeholder-Only

**Severity**: Moderate
**Impact**: The `ux-guidelines.xml` template is a single `<Guideline>` placeholder. There's no structured model for:
- Design system references (color tokens, spacing scales, typography scales)
- Component library mappings
- Interaction patterns (loading, empty, error, success states)
- Accessibility requirements (WCAG level, screen reader support)
- Animation/motion constraints
- Responsive breakpoints
- User flow documentation

### 3.5 Moderate Gap: No API Contract Testing Integration

**Severity**: Moderate
**Impact**: For complex backends (especially microservices), API contract testing (OpenAPI, gRPC, GraphQL schema) is essential. GRACE has no structured way to:
- Link a module to its API contract file
- Assert that implementation matches the OpenAPI/gRPC schema
- Verify backward compatibility of API changes
- Track API versioning in the graph

### 3.6 Moderate Gap: Flat Graph Model for Large Monorepos

**Severity**: Moderate
**Impact**: The graph model is flat — all M-* modules are direct children of GD-* documents. For a monorepo with 50+ services in multiple languages, this becomes unwieldy. There's no:
- Hierarchical module grouping (services, packages, crates)
- Cross-language dependency modeling (e.g., a Go service depending on a Rust library's API contract)
- Service-level graph documents (one GD-* per service with its own modules)

### 3.7 Moderate Gap: No Performance/Benchmark Assertions

**Severity**: Moderate
**Impact**: `MustPassCommand` can run benchmarks, but there's no structured way to assert:
- "p99 latency < 50ms"
- "throughput > 1000 req/s"
- "memory < 256MB"
- "bundle size < 100KB" (critical for frontend)

### 3.8 Minor Gap: Linear Change Lifecycle

**Severity**: Minor
**Impact**: The spec→plan→execute pipeline is linear. For UI work requiring rapid prototyping and user feedback, this can feel heavy. There's no "exploratory" or "prototype" mode that allows lighter-weight iteration before formalizing.

### 3.9 Minor Gap: No Design-Artifact Linking

**Severity**: Minor
**Impact**: No way to link Figma files, design specs, or user research documents to change bundles or modules. The `design-context.xml` is freeform text only.

### 3.10 Minor Gap: Template-Driven Init Is Shallow

**Severity**: Minor
**Impact**: The init templates are minimal placeholders. For complex projects, the agent must invent structure from scratch. There's no:
- Project archetype templates (monorepo, microservices, full-stack, library)
- Language-specific init guidance
- Pre-configured graph/verification structures for common patterns

---

## Part 4: Detailed Improvement Plan

### Phase 1: Language Adapter Expansion (Go + Rust)

**Priority**: Critical
**Effort**: High
**Timeline**: 4-6 weeks

#### 4.1.1 Go Language Adapter

**File**: `src/lint/adapters/go.ts`
**Test File**: `src/lint/adapters/go.test.ts`

**Design**:

```typescript
// Go adapter uses go/parser and go/types from stdlib via subprocess
// Architecture: spawn `go` toolchain, parse JSON output

interface GoExports {
  functions: Array<{ name: string; signature: string; doc: string }>;
  types: Array<{ name: string; kind: "struct" | "interface" | "alias"; doc: string }>;
  constants: Array<{ name: string; value: string }>;
  variables: Array<{ name: string; type: string }>;
}

// Implementation approach:
// 1. Run a helper Go program that uses go/parser + go/types to extract exports as JSON
// 2. Parse JSON output in the adapter
// 3. Compare against MODULE_MAP
```

**Key Requirements**:
- Detect `go.mod` to find module root
- Handle multi-package repos (each `package` declaration is a separate export surface)
- Respect Go's capitalization-based export rule
- Handle `init()` functions (not exported but significant)
- Support Go 1.21+ generics syntax
- Graceful degradation when `go` is not on PATH (fail closed with `analysis.runtime-missing`)

**Go Helper Program** (bundled or generated):

```go
// grase-goparse: extracts exports from a Go source file as JSON
// Usage: go run grase-goparse.go <file.go>
package main

import (
    "encoding/json"
    "go/ast"
    "go/parser"
    "go/token"
    "os"
)

type Export struct {
    Name      string `json:"name"`
    Kind      string `json:"kind"`      // "func", "type", "const", "var"
    Signature string `json:"signature"` // for funcs
    Doc       string `json:"doc"`
}

// ... walks AST, collects exported (capitalized) declarations, outputs JSON
```

#### 4.1.2 Rust Language Adapter

**File**: `src/lint/adapters/rust.ts`
**Test File**: `src/lint/adapters/rust.test.ts`

**Design**:

```typescript
// Rust adapter uses rust-analyzer or syn via subprocess
// Preferred approach: use `rust-analyzer` LSP-style or a small syn-based helper

interface RustExports {
  functions: Array<{ name: string; signature: string; visibility: string }>;
  structs: Array<{ name: string; fields: Array<{ name: string; type: string; visibility: string }> }>;
  enums: Array<{ name: string; variants: string[] }>;
  traits: Array<{ name: string; methods: string[] }>;
  typeAliases: Array<{ name: string; target: string }>;
  constants: Array<{ name: string; type: string }>;
  macros: Array<{ name: string }>;
}
```

**Key Requirements**:
- Detect `Cargo.toml` to find crate root
- Handle Cargo workspaces (multiple crates in one repo)
- Respect Rust's `pub` visibility (including `pub(crate)`, `pub(super)`, etc.)
- Handle `pub use` re-exports
- Support Rust 2021 edition+ syntax
- Graceful degradation when `cargo`/`rustc` is not on PATH

**Rust Helper Program** (using `syn` crate):

```rust
// grase-rustparse: extracts public exports from a Rust source file as JSON
use syn::visit::Visit;
// ... walks AST, collects `pub` items, outputs JSON to stdout
```

#### 4.1.3 Adapter Registration

Update `src/language-registry.ts` to register Go (`.go`) and Rust (`.rs`) file extensions with their adapters. Update `src/lint/config.ts` to support `ROLE` and `MAP_MODE` for these languages.

#### 4.1.4 Verification

- Unit tests with fixture `.go` and `.rs` files covering exports, visibility, generics, workspaces
- Integration test: `grace lint` against a temp project with Go/Rust modules
- CI: Add Go and Rust to the CI matrix (already have Python and Dart)

---

### Phase 2: UI/UX Verification Framework

**Priority**: Critical
**Effort**: High
**Timeline**: 6-8 weeks

#### 4.2.1 Visual Contract Model

Extend the verification model with UI-specific evidence types:

```xml
<V-M-BUTTON>
  <Cwd>packages/design-system</Cwd>
  <TestFiles>
    <File>packages/design-system/src/Button/Button.test.tsx</File>
  </TestFiles>
  <Command>bun test src/Button</Command>

  <!-- NEW: Visual regression evidence -->
  <VisualBaseline>
    <Screenshot>packages/design-system/__screenshots__/button-primary.png</Screenshot>
    <Threshold>0.01</Threshold>
    <Viewport>1280x800</Viewport>
  </VisualBaseline>

  <!-- NEW: Accessibility evidence -->
  <AccessibilityAudit>
    <Standard>WCAG2.1-AA</Standard>
    <Command>bun run test:a11y -- Button</Command>
  </AccessibilityAudit>

  <!-- NEW: Design token compliance -->
  <DesignTokenContract>
    <TokenFile>packages/design-system/tokens/colors.json</TokenFile>
    <RequiredTokens>
      <Token>color.background.primary</Token>
      <Token>color.text.primary</Token>
    </RequiredTokens>
  </DesignTokenContract>

  <Scenario>Primary button renders with correct design tokens</Scenario>
  <Scenario>Button meets WCAG 2.1 AA contrast requirements</Scenario>
</V-M-BUTTON>
```

#### 4.2.2 New Assertion Kinds for UI

| Assertion Kind | Purpose |
|---|---|
| `MustPassVisualRegression` | Screenshot comparison against baseline |
| `MustPassAccessibility` | a11y audit (axe-core, pa11y, Lighthouse) |
| `MustUseDesignTokens` | Verify component uses tokens, not hardcoded values |
| `MustSupportViewports` | Responsive breakpoint coverage |
| `MustPassBundleSize` | Bundle size budget enforcement |

#### 4.2.3 UX Guidelines Structured Model

Replace the placeholder `ux-guidelines.xml` with a structured model:

```xml
<GraceUXGuidelines graceVersion="4.0">
  <Applicability>applicable</Applicability>
  <Audience>General public, including users with disabilities</Audience>

  <DesignSystem>
    <Name>Acme Design</Name>
    <TokenSource>packages/design-system/tokens/</TokenSource>
    <ComponentLibrary>packages/design-system/src/</ComponentLibrary>
    <FigmaFile>https://figma.com/file/abc123</FigmaFile>
  </DesignSystem>

  <Accessibility>
    <Standard>WCAG2.1-AA</Standard>
    <ScreenReaderSupport>required</ScreenReaderSupport>
    <KeyboardNavigation>required</KeyboardNavigation>
    <ColorContrast>minimum-4.5:1</ColorContrast>
  </Accessibility>

  <ResponsiveBreakpoints>
    <Breakpoint name="mobile" minWidth="320" maxWidth="767" />
    <Breakpoint name="tablet" minWidth="768" maxWidth="1023" />
    <Breakpoint name="desktop" minWidth="1024" />
  </ResponsiveBreakpoints>

  <InteractionPatterns>
    <Pattern name="loading">Skeleton screens for content, spinners for actions</Pattern>
    <Pattern name="empty">Illustrated empty state with CTA</Pattern>
    <Pattern name="error">Inline error messages with recovery action</Pattern>
  </InteractionPatterns>

  <MotionConstraints>
    <Constraint>Respect prefers-reduced-motion</Constraint>
    <Constraint>Animations under 200ms</Constraint>
  </MotionConstraints>

  <ContentGuidelines>
    <Guideline>Sentence case for UI labels</Guideline>
    <Guideline>Active voice for error messages</Guideline>
  </ContentGuidelines>
</GraceUXGuidelines>
```

#### 4.2.4 UI Component Graph Model

Extend the graph model with UI-specific module types and metadata:

```xml
<M-BUTTON>
  <Summary>Primary button component with loading, disabled, and icon variants</Summary>
  <Path>packages/design-system/src/Button/Button.tsx</Path>
  <Type>UI_COMPONENT</Type>

  <!-- NEW: UI-specific metadata -->
  <UIComponent>
    <Framework>React</Framework>
    <Stories>packages/design-system/src/Button/Button.stories.tsx</Stories>
    <VisualBaseline>packages/design-system/__screenshots__/button-*.png</VisualBaseline>
    <DesignTokens>
      <M-DESIGN-TOKENS />
    </DesignTokens>
  </UIComponent>

  <M-ICON />
</M-BUTTON>
```

#### 4.2.5 Visual Regression CLI Integration

Add a `--visual` flag to `grace lint` that:
1. Runs the component's visual tests (Storybook + Chromatic/Percy, or Playwright screenshot comparison)
2. Compares against stored baselines
3. Reports pixel diff percentages
4. Fails if diff exceeds threshold

```bash
grace lint --path . --change C-ADD-BUTTON --assertions target --run-commands --visual
```

---

### Phase 3: API Contract Testing Integration

**Priority**: Moderate
**Effort**: Medium
**Timeline**: 3-4 weeks

#### 4.3.1 API Contract Model

```xml
<M-USER-SERVICE>
  <Summary>User management gRPC service</Summary>
  <Path>services/user/src/server.rs</Path>
  <Type>INTEGRATION</Type>

  <!-- NEW: API contract reference -->
  <APIContract>
    <Schema>proto/user/v1/user.proto</Schema>
    <Style>gRPC</Style>
    <Version>v1</Version>
  </APIContract>
</M-USER-SERVICE>
```

#### 4.3.2 New Assertion Kinds

| Assertion Kind | Purpose |
|---|---|
| `MustSatisfyAPIContract` | Verify implementation matches schema |
| `MustBeBackwardCompatible` | Check for breaking API changes |
| `MustPassE2E` | End-to-end integration test |

#### 4.3.3 Supported API Styles

- **OpenAPI/REST**: Validate against OpenAPI 3.x spec, run Dredd/Schemathesis
- **gRPC**: Validate against `.proto` files, run grpcurl/buf breaking change detection
- **GraphQL**: Validate against schema, run graphql-inspector diff
- **Async/Messaging**: Validate against AsyncAPI/JSON Schema for message formats

---

### Phase 4: Hierarchical Graph Model for Monorepos

**Priority**: Moderate
**Effort**: Medium
**Timeline**: 3-4 weeks

#### 4.4.1 Service-Level Graph Documents

Allow nested GD-* documents for service/package grouping:

```xml
<GraceGraphIndex graceVersion="4.0">
  <GraphDocuments>
    <GD-MAIN>
      <Path>graph/main.xml</Path>
      <Owns>
        <GD-USER-SERVICE />
        <GD-PAYMENT-SERVICE />
        <GD-DESIGN-SYSTEM />
      </Owns>
    </GD-MAIN>
    <GD-USER-SERVICE>
      <Path>graph/services/user.xml</Path>
      <Owns>
        <M-USER-HANDLER />
        <M-USER-STORE />
        <M-USER-AUTH />
      </Owns>
    </GD-USER-SERVICE>
  </GraphDocuments>
</GraceGraphIndex>
```

#### 4.4.2 Cross-Language Dependencies

```xml
<M-USER-HANDLER>
  <Summary>User gRPC handler (Go)</Summary>
  <Path>services/user/handler.go</Path>
  <Language>go</Language>
  <M-USER-STORE />  <!-- Go → Go dependency -->
  <DF-USER-PROTO /> <!-- Depends on shared proto definitions -->
</M-USER-HANDLER>

<M-USER-STORE>
  <Summary>User data layer (Rust)</Summary>
  <Path>libs/user-store/src/lib.rs</Path>
  <Language>rust</Language>
  <DF-USER-PROTO />
</M-USER-STORE>
```

---

### Phase 5: Performance & Benchmark Assertions

**Priority**: Moderate
**Effort**: Low-Medium
**Timeline**: 2-3 weeks

#### 4.5.1 New Assertion Kind

```xml
<MustPassBenchmark>
  <Command>cargo bench --bench user-store</Command>
  <Metric>p99_latency</Metric>
  <Operator>lt</Operator>
  <Threshold>50</Threshold>
  <Unit>ms</Unit>
</MustPassBenchmark>
```

Support for:
- Latency percentiles (p50, p95, p99)
- Throughput (req/s, msg/s)
- Memory (MB/GB)
- Bundle size (KB) — critical for frontend
- Startup time (ms)

---

### Phase 6: Iterative/Exploratory Mode

**Priority**: Minor
**Effort**: Medium
**Timeline**: 3-4 weeks

#### 4.6.1 Prototype Change Status

Add a `prototype` status for lightweight iteration:

```
grace-spec --mode prototype  →  creates spec.xml with status="prototype"
                                lighter requirements, no plan needed
                                → after iteration, promote to draft → approved
```

Prototype changes:
- Skip assertion/scopes requirements
- Allow direct code edits without plan
- Auto-archive after promotion or abandonment
- Track iteration count

---

### Phase 7: Design Artifact Linking

**Priority**: Minor
**Effort**: Low
**Timeline**: 1-2 weeks

#### 4.7.1 Design References in Change Bundles

```xml
<GraceChangeSpec graceVersion="4.0" status="draft">
  <C-ADD-DASHBOARD>
    <Summary>Add analytics dashboard</Summary>
    <!-- ... -->

    <!-- NEW: Design artifact references -->
    <DesignReferences>
      <FigmaFile url="https://figma.com/file/abc/Dashboard">
        <Frame name="Dashboard - Desktop" />
        <Frame name="Dashboard - Mobile" />
      </FigmaFile>
      <UserResearch>docs/research/dashboard-usability.md</UserResearch>
    </DesignReferences>
  </C-ADD-DASHBOARD>
</GraceChangeSpec>
```

---

### Phase 8: Richer Init Templates

**Priority**: Minor
**Effort**: Low-Medium
**Timeline**: 2-3 weeks

#### 4.8.1 Project Archetypes

```
grace-init --archetype fullstack-react-go
grace-init --archetype microservices-rust
grace-init --archetype design-system
grace-init --archetype cli-tool
```

Each archetype provides:
- Pre-configured context artifacts
- Language-specific AGENTS.md guidance
- Example graph/verification structures
- CI pipeline templates

---

## Part 5: Risk Assessment

### 5.1 Adoption Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Markup overhead feels burdensome | Medium | Medium | Tooling auto-generation, IDE snippets |
| Linear lifecycle too rigid for some teams | Medium | Low | Prototype mode (Phase 6) |
| Learning curve for XML artifacts | Low | Medium | Better templates, `grace-explainer` skill |
| Go/Rust adapter maintenance burden | Medium | Low | Community-contributed adapters, stable helper binary interface |

### 5.2 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Go/Rust AST parsing edge cases | Medium | Medium | Comprehensive fixture tests, graceful degradation |
| Visual regression flakiness | High | Medium | Configurable thresholds, anti-flake measures (pixel tolerance, retry) |
| Monorepo graph scaling | Low | Medium | Lazy loading, pagination in CLI output |
| Cross-language dependency tracking complexity | Medium | Low | Start with explicit manual links, add auto-detection later |

---

## Part 6: Conclusion

GRACE is a **well-architected, production-quality methodology** for AI-assisted development. Its contract-first discipline, deterministic assertions, scope management, and recovery-aware execution are best-in-class. The unique-tag convention is a genuine innovation for LLM-friendly XML.

However, GRACE in its current form is **optimized for TypeScript backend projects**. To serve as a comprehensive methodology for projects with high UI/UX requirements and complex Rust/Go backends, it needs:

1. **Go and Rust language adapters** (Phase 1) — the most urgent gap
2. **UI/UX verification framework** (Phase 2) — essential for frontend work
3. **API contract testing** (Phase 3) — important for microservice backends
4. **Hierarchical graph model** (Phase 4) — needed for large monorepos
5. **Performance assertions** (Phase 5) — important for systems programming
6. **Iterative/prototype mode** (Phase 6) — quality-of-life for UI iteration
7. **Design artifact linking** (Phase 7) — bridges design/engineering gap
8. **Richer init templates** (Phase 8) — reduces cold-start friction

With these improvements, GRACE would be a **truly comprehensive methodology** suitable for the full spectrum of modern software projects — from design-system components to high-performance Rust services, from Go microservices to complex React applications.

### Recommended Implementation Order

1. **Phase 1** (Go + Rust adapters) — unblocks backend use immediately
2. **Phase 2** (UI/UX framework) — unblocks frontend use
3. **Phase 4** (Hierarchical graph) — enables monorepo adoption
4. **Phase 3** (API contracts) — strengthens microservice patterns
5. **Phase 5** (Performance assertions) — adds systems-level rigor
6. **Phase 6-8** — quality-of-life improvements

The first two phases alone would transform GRACE from a TypeScript-backend methodology into a **full-stack, polyglot methodology** capable of handling the most demanding projects.
