import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { childNodes, childText, computeElementSpans, parseGraceXmlArtifact, walkNodes, type GraceXmlNode } from "../src/artifact/xml.ts";
import { validateStubAndIndex } from "./validate-citation-anchors.ts";
import { proveRecordPreservation } from "./prove-record-preservation.ts";
import {
  FINDINGS_HEADROOM_MULTIPLIER,
  INDEX_HEADROOM_ENTRIES,
  RULINGS_HEADROOM_MULTIPLIER,
  RULINGS_PROVENANCE_CEILING,
  bodyEndsWithSeparator,
  derivePayerMap,
  listArchiveNames,
  liveH2DecisionLineCounts,
  median,
  main,
  newlineCount,
  recordHeadroom,
  resolveRecordDirWithinBoundary,
  stripBodySeparator,
  validateRecordRetirement,
  xmlDecode,
} from "./validate-record-retirement.ts";
import { assertRecordSchema, recordSchemaViolations, serializeRecordDocument } from "./record-serialize.ts";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT = path.join(import.meta.dir, "validate-record-retirement.ts");
const RECORD_REL = "docs/plans/active/RM-GOVERNED-PATH";

// C-FLUSH-AND-PAY minted the C-INDEX-METRIC-2 row post-archive, so the production
// derivation mints F205; the baseline map was captured before that row existed.
// C-ROOT-WINDOW's row mints its six tokens to this bundle only once the
// bundle is archived (eligibility requires the payer's name to be an archive
// directory); the extension is consulted only for tokens the derivation
// actually mints, so the test stays green with the row live and in the
// applied-archive state.
// C-FLUSH-AND-UNPIN minted this row live by its own plan, so the close's
// move derives F232 from the row's Pays cell once the bundle's directory
// is in the archive. The derivation is first-row-wins, so a paid token's
// payer never changes — a paid state is durable, a live one is not — and
// the extension is consulted only for tokens the derivation actually
// mints, so the walk is inert (green) with the row live and green in the
// applied-archive state.
const bundleMinted: Record<string, string> = {
  // C-INSPECTION-SURFACE-1-2628AA2B T-006: the chartered row's two minted tokens.
  // The extension is consulted only for tokens the derivation actually mints, so
  // the walk is green with the row live (nothing minted — the row's name is not an
  // archive directory while the bundle is active) and green in the applied-archive
  // state (the close's mint). A stale id reds the same walk.
  F270: "C-INSPECTION-SURFACE-1-2628AA2B",
  F291: "C-INSPECTION-SURFACE-1-2628AA2B",
  F205: "C-INDEX-METRIC-2",
  F216: "C-ROOT-WINDOW",
  F182: "C-ROOT-WINDOW",
  F193: "C-ROOT-WINDOW",
  F190: "C-ROOT-WINDOW",
  F225: "C-ROOT-WINDOW",
  F226: "C-ROOT-WINDOW",
  F232: "C-FLUSH-AND-UNPIN",
  // C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92 T-004: the chartered row's one minted
  // token. The id moved once at the supersede of `-1-A0E753F3`; the entry pins the
  // successor, so the post-close walk is green and a stale `-1` reds it.
  F288: "C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92",
  // C-TAUGHT-RULES T-005: the chartered row's six minted tokens. The
  // extension is consulted only for tokens the derivation actually mints,
  // so the walk is green with the row live (nothing minted — the row's
  // name is not an archive directory while the bundle is active) and
  // green in the applied-archive state (the close's mint).
  F210: "C-TAUGHT-RULES",
  F196: "C-TAUGHT-RULES",
  F199: "C-TAUGHT-RULES",
  F188: "C-TAUGHT-RULES",
  F233: "C-TAUGHT-RULES",
  F234: "C-TAUGHT-RULES",
  // C-APPLY-VERB T-006: the chartered row's one minted token. The
  // extension is consulted only for tokens the derivation actually
  // mints, so the walk is green with the row live (the row's name is
  // not an archive directory while the bundle is active) and green in
  // the applied-archive state (the close's mint).
  F224: "C-APPLY-VERB",
  // C-FLUSH-AND-TEACH T-004: the chartered row five minted tokens.
  F236: "C-FLUSH-AND-TEACH",
  F237: "C-FLUSH-AND-TEACH",
  F238: "C-FLUSH-AND-TEACH",
  F239: "C-FLUSH-AND-TEACH",
  F241: "C-FLUSH-AND-TEACH",
  F185: "C-RETIRE-AND-CODIFY",
  F198: "C-PAYMENT-RECORD-2",
  F197: "C-PAYMENT-INTEGRITY",
  // C-GUARD-RATCHET T-001: F244's payment is recorded on the already
  // archived C-PAYMENT-INTEGRITY row (retired-row append), and the
  // bundle's own row pays F222 and F223 once its name is an archive
  // directory. The extension is consulted only for tokens the derivation
  // actually mints.
  F244: "C-PAYMENT-INTEGRITY",
  F222: "C-GUARD-RATCHET",
  F223: "C-GUARD-RATCHET",
  // C-REVIEW-SELF-SCOPE-2 T-002: the chartered row's two minted tokens. The
  // extension is consulted only for tokens the derivation actually mints,
  // so the walk is green with the row live and green in the applied-archive
  // state (the close's mint).
  F240: "C-REVIEW-SELF-SCOPE-2",
  F245: "C-REVIEW-SELF-SCOPE-2",
  // C-TEACH-DRIVE-BEFORE-APPROVE-2 T-001: the chartered row's five minted
  // tokens. The extension is consulted only for tokens the derivation
  // actually mints, so the walk is green with the row live and green in
  // the applied-archive state (the close's mint).
  F243: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F246: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F247: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F248: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F249: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  // C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 T-004: the chartered row's two minted
  // tokens. The extension is consulted only for tokens the derivation
  // actually mints, so the walk is green with the row live and green in the
  // applied-archive state (the close's mint).
  F250: "C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22",
  F251: "C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22",
  // C-TEACH-PLAN-DRIVES-CORRECTIONS-2-1E59AEAA T-001: the chartered row's two
  // minted tokens. The extension is consulted only for tokens the derivation
  // actually mints, so the walk is green with the row live and green in the
  // applied-archive state (the close's mint).
  F253: "C-TEACH-PLAN-DRIVES-CORRECTIONS-2-1E59AEAA",
  F254: "C-TEACH-PLAN-DRIVES-CORRECTIONS-2-1E59AEAA",
  // C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA T-001: the chartered row's three
  // minted tokens. The extension is consulted only for tokens the derivation
  // actually mints, so the walk is green with the row live and green in the
  // applied-archive state (the close's mint).
  F255: "C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA",
  F256: "C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA",
  F257: "C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA",
  // C-STATUS-TEST-TIMEOUT-1-E7DA46E8 T-001: the chartered row's one minted token.
  F263: "C-STATUS-TEST-TIMEOUT-1-E7DA46E8",
  // C-SCRIPTS-ADOPTION-2-36DEB1BD T-003: the chartered row's two minted tokens. The
  // extension is consulted only for tokens the derivation actually mints, so the walk is
  // green with the row live and green in the applied-archive state (the close's mint).
  F242: "C-SCRIPTS-ADOPTION-2-36DEB1BD",
  F264: "C-SCRIPTS-ADOPTION-2-36DEB1BD",
  // C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F T-001: the chartered row's five
  // minted tokens. The extension is consulted only for tokens the derivation
  // actually mints, so the walk is green with the row live and green in the
  // applied-archive state (the close's mint).
  F258: "C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F",
  F259: "C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F",
  F260: "C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F",
  F261: "C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F",
  F262: "C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F",
  // C-RECORD-SCHEMA-2-0785BD5E T-004: the chartered row's five minted tokens. The
  // extension is consulted only for tokens the derivation actually mints, so the walk
  // is green with the row live and green in the applied-archive state (the close's mint).
  F207: "C-RECORD-SCHEMA-2-0785BD5E",
  F221: "C-RECORD-SCHEMA-2-0785BD5E",
  F235: "C-RECORD-SCHEMA-2-0785BD5E",
  F252: "C-RECORD-SCHEMA-2-0785BD5E",
  F265: "C-RECORD-SCHEMA-2-0785BD5E",
  // C-TEST-TIMEOUT-CEILING-2-7AD2A006 T-002: the chartered row's two minted tokens.
  // Consulted only for tokens the derivation actually mints; green with the row live
  // and green in the applied-archive state (the close's mint).
  F266: "C-TEST-TIMEOUT-CEILING-2-7AD2A006",
  F267: "C-TEST-TIMEOUT-CEILING-2-7AD2A006",
  // C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD T-001: the chartered row's eight minted
  // tokens. Consulted only for tokens the derivation actually mints; green with the
  // row live and green in the applied-archive state (the close's mint).
  F268: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F269: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F271: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F272: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F273: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F274: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F275: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F276: "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD",
  F228: "C-RECORD-FLUSH-VERB-2-6BB9DF5A",
  F277: "C-RECORD-FLUSH-VERB-2-6BB9DF5A",
  F278: "C-RECORD-FLUSH-VERB-2-6BB9DF5A",
  F279: "C-CLONE-FAITHFUL-TESTS-1-D68520A2",
  // C-TEST-TIME-BUDGET-4-F173437E T-009: the chartered row's three minted tokens
  // (F281, F282 and F286). Consulted only for tokens the derivation actually
  // mints; green with the row live and green in the applied-archive state (the
  // close's mint).
  F281: "C-TEST-TIME-BUDGET-4-F173437E",
  F282: "C-TEST-TIME-BUDGET-4-F173437E",
  F286: "C-TEST-TIME-BUDGET-4-F173437E",
  // C-RECORD-DECISION-FLUSH-1-368E01F2 T-004: the chartered row's one minted
  // token (F289). Consulted only for tokens the derivation actually mints, so
  // the walk is green with the row live and green in the applied-archive state
  // (the close's mint). `D41` needs no entry: the derivation matches `F` tokens
  // only.
  F289: "C-RECORD-DECISION-FLUSH-1-368E01F2",
  // C-TEACHING-INCREMENT-2-4E28E16C T-005: the chartered row's eight minted
  // tokens. Consulted only for tokens the derivation actually mints, so the
  // walk is green with the row live (nothing minted while the bundle is active)
  // and green in the applied-archive state (the close's mint).
  F296: "C-TEACHING-INCREMENT-2-4E28E16C",
  F298: "C-TEACHING-INCREMENT-2-4E28E16C",
  F283: "C-TEACHING-INCREMENT-2-4E28E16C",
  F285: "C-TEACHING-INCREMENT-2-4E28E16C",
  F290: "C-TEACHING-INCREMENT-2-4E28E16C",
  F293: "C-TEACHING-INCREMENT-2-4E28E16C",
  F302: "C-TEACHING-INCREMENT-2-4E28E16C",
  F303: "C-TEACHING-INCREMENT-2-4E28E16C",
  // C-EVENT-LOCK-ATOMIC-1-9711E83D T-003: the chartered row's one minted token.
  // Consulted only for tokens the derivation actually mints, so the walk is green
  // with the row live and green in the applied-archive state (the close's mint).
  F307: "C-EVENT-LOCK-ATOMIC-1-9711E83D",
  // C-EPOCH-OPEN-DEFAULT-1-CE010A4C T-003: the chartered row's one minted token.
  // Consulted only for tokens the derivation actually mints, so the walk is green
  // with the row live and green in the applied-archive state (the close's mint).
  F308: "C-EPOCH-OPEN-DEFAULT-1-CE010A4C",
  // C-PER-BUNDLE-READERS-1-58BB7AB1 T-005: the chartered row's two minted tokens
  // (F300 and F301). The extension is consulted only for tokens the derivation
  // actually mints, so the walk is green with the row live (nothing minted while
  // the bundle is active) and green in the applied-archive state (the close's mint).
  F300: "C-PER-BUNDLE-READERS-1-58BB7AB1",
  F301: "C-PER-BUNDLE-READERS-1-58BB7AB1",
};


const tempRoots: string[] = [];

function isolatedRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "record-retirement-"));
  tempRoots.push(root);
  return root;
}

function plant(root: string, rel: string, body: string): string {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

/** The real process boundary: one test keeps it, where the OS exit code is the contract. */
function runValidator(
  cwd: string,
  args: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * The bulk path: call the validator's exported `main(argv, cwd)` in-process and
 * capture its console output through a seam that is restored in a `finally`, so
 * no buffer leaks between calls or tests.
 */
function runValidatorInProcess(
  cwd: string,
  args: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const captured: string[] = [];
  const errored: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => captured.push(parts.map(String).join(" "));
  console.error = (...parts: unknown[]) => errored.push(parts.map(String).join(" "));
  let status: number;
  try {
    status = main(args, cwd);
  } finally {
    // Restore in a finally so no buffer can leak into the next call or test.
    console.log = originalLog;
    console.error = originalError;
  }
  return {
    status,
    stdout: captured.length > 0 ? `${captured.join("\n")}\n` : "",
    stderr: errored.length > 0 ? `${errored.join("\n")}\n` : "",
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeHappy(root: string, overlay: Partial<ReturnType<typeof happyParts>> = {}): void {
  const parts = { ...happyParts(), ...overlay };
  plant(root, `${RECORD_REL}/findings.xml`, parts.findings);
  plant(root, `${RECORD_REL}/findings-retired.xml`, parts.findingsRetired);
  plant(root, `${RECORD_REL}/rulings.xml`, parts.rulings);
  plant(root, `${RECORD_REL}/rulings-retired.xml`, parts.rulingsRetired);
  plant(root, `${RECORD_REL}/registry.xml`, parts.registry);
  plant(root, `${RECORD_REL}/registry-retired.xml`, parts.registryRetired);
  plant(root, `${RECORD_REL}/decisions.xml`, parts.index);
  plant(root, `${RECORD_REL}/decisions.md`, parts.stub);
  plant(root, `${RECORD_REL}/record-inventory.json`, parts.inventory);
  mkdirSync(path.join(root, ".ngrace/changes/archive/C-OLD"), { recursive: true });
}

function happyParts() {
  return {
    findings: `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`,
    findingsRetired: `<Findings>
  <Finding id="f2" token="F2" status="retired">
    <PaidBy>C-OLD</PaidBy>
    <Title>### F2 — retired</Title>
    <Body>body two</Body>
  </Finding>
</Findings>
`,
    rulings: `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
  </Decision>
</Rulings>
`,
    rulingsRetired: `<Rulings>
</Rulings>
`,
    registry: `<Registry base="1" headroom="15" ceiling="100">
  <Row name="C-LIVE-ROW" status="live" kind="chartered">
    <Number>1</Number>
    <Charter>charter</Charter>
    <Pays></Pays>
    <StatusText>Ordered</StatusText>
  </Row>
</Registry>
`,
    registryRetired: `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays></Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`,
    index: `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`,
    stub: `# stub

The parseable citation index is [./decisions.xml](./decisions.xml).
`,
    inventory: `${JSON.stringify(
      [
        { token: "F1", id: "f1", bodyHash: "a" },
        { token: "F2", id: "f2", bodyHash: "b" },
        { token: "D1", id: "d1", bodyHash: "c" },
      ],
      null,
      2,
    )}\n`,
  };
}

describe("validate-record-retirement", () => {
  it("exits 0 on a happy fixture", () => {
    const root = isolatedRoot();
    writeHappy(root);
    // This one keeps the real process boundary: the contract is the OS exit code.
    const result = runValidator(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("record-retirement: ok");
    expect(result.stderr).toBe("");
  });

  it("errors per live finding whose PaidBy names an archived directory", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <PaidBy>C-OLD</PaidBy>
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("finding-eligible-still-live");
    expect(result.stderr).toContain("C-OLD");
    expect(result.stderr).toContain("retired sibling");
  });

  it("errors per live registry row whose name equals an archived directory", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registry = `<Registry base="1" headroom="15" ceiling="100">
  <Row name="C-OLD" status="live" kind="chartered">
    <Number>1</Number>
    <Charter>charter</Charter>
    <Pays></Pays>
    <StatusText>Ordered</StatusText>
  </Row>
</Registry>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("registry-eligible-still-live");
    expect(result.stderr).toContain("C-OLD");
    expect(result.stderr).toContain("retired sibling");
  });

  it("errors when a live part exceeds its persisted ceiling and does not name a config key", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.findings = `<Findings base="1" headroom="0" ceiling="1">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ceiling-exceeded");
    expect(result.stderr).toContain("retired sibling");
    expect(result.stderr).toContain("Raising the persisted ceiling is not the remedy");
    expect(result.stderr.toLowerCase()).not.toContain("config key");
    expect(result.stderr).not.toContain("ignoredDirs");
  });

  it("errors on a live CodifiedIn lint-rule absent from the catalog", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="lint-rule">no.such.lint.rule</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("codified-in-unresolved");
    expect(result.stderr).toContain("no.such.lint.rule");
  });

  it("errors when a live CodifiedIn test-suite path is missing", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/missing.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("codified-in-unresolved");
    expect(result.stderr).toContain("tests/missing.test.ts");
  });

  it("errors on a live TaughtIn whose skill path is missing", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <TaughtIn path="skills/ngrace/missing/SKILL.md" section="purpose"></TaughtIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("taught-in-unresolved");
    expect(result.stderr).toContain("skills/ngrace/missing/SKILL.md");
  });

  it("errors on a live TaughtIn whose section is missing from the skill file", () => {
    const root = isolatedRoot();
    plant(root, "skills/ngrace/ngrace-plan/SKILL.md", "<purpose>hello</purpose>\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <TaughtIn path="skills/ngrace/ngrace-plan/SKILL.md" section="no-such-section"></TaughtIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("taught-in-unresolved");
    expect(result.stderr).toContain("no-such-section");
  });

  it("errors when a live decision carries a resolving CodifiedIn", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("decision-eligible-still-live");
    expect(result.stderr).toContain("CodifiedIn");
  });

  it("allows markdown fences inside Body and refuses a fenced metadata block outside Body", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>example:\n\`\`\`\ncode\n\`\`\`\n</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const ok = runValidatorInProcess(root);
    expect(ok.status).toBe(0);
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">
\`\`\`
token: F1
\`\`\`
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const bad = runValidatorInProcess(root);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("fenced-metadata");
  });

  it("errors when status does not match the file", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="retired">
    <Title>### F1 — live file</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("status-file-mismatch");
  });

  it("reads CLAUDE.md and docs/plans/README.md and fails if teaching names are absent", () => {
    const claude = readFileSync(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const plans = readFileSync(path.join(REPO_ROOT, "docs/plans/README.md"), "utf8");
    for (const [label, text] of [
      ["CLAUDE.md", claude],
      ["docs/plans/README.md", plans],
    ] as const) {
      expect(text, label).toContain("decisions.md");
      expect(text, label).toContain("decisions.xml");
      expect(text, label).toContain("findings");
      expect(text, label).toContain("decisions");
      expect(text, label).toContain("registry");
      expect(text, label).toContain("index");
      expect(text, label).toContain("live");
      expect(text, label).toContain("retired");
      expect(text, label).toContain("--retire");
      expect(text, label).toContain("index Entry layers flip in place");
      expect(text, label).toContain("the index has no retired sibling");
    }
    expect(claude).toContain("re-derives PaidBy");
    expect(claude).toContain("never raised");
    expect(claude).toContain("resolving CodifiedIn");
    expect(claude).toContain("a resolving TaughtIn does not move it");
    expect(claude).not.toContain("CodifiedIn or TaughtIn");
  });

  it("reads package.json and fails if validate:ci drops the retirement member", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["validate:record-retirement"]).toContain(
      "bun ./scripts/validate-record-retirement.ts",
    );
    expect(pkg.scripts["validate:ci"]).toContain("validate:record-retirement");
    expect(pkg.scripts["validate:ci"]).toContain("validate:citation-anchors");
    expect(pkg.scripts["validate:ci"]).not.toContain("--retire");
    expect(pkg.scripts["validate:record-retirement"]).not.toContain("--retire");
  });

  it("exits non-zero when a live finding is derivation-eligible with no stored PaidBy", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("finding-eligible-still-live");
    expect(result.stderr).toContain("C-OLD");
    expect(result.stderr).toContain("retired sibling");
    expect((result.stderr.match(/finding-eligible-still-live/g) ?? []).length).toBe(1);
  });

  it(
    "prose-dead guard: a Closed with sentence mints nothing while a Pays cell mints, so the deleted prose path cannot be re-entered by wording (generous timeout)",
    () => {
      const root = isolatedRoot();
      mkdirSync(path.join(root, ".ngrace", "changes", "archive", "C-PROSE-PROBE"), { recursive: true });
      const proseOnly = derivePayerMap(root, [
        { name: "C-PROSE-PROBE", pays: "", statusText: "Delivered. Closed with F999 and F998." },
      ]);
      expect([...proseOnly.entries()], "a Closed with sentence mints nothing").toEqual([]);
      const declared = derivePayerMap(root, [
        { name: "C-PROSE-PROBE", pays: "F999", statusText: "Delivered. Closed with F999." },
      ]);
      expect([...declared.entries()], "a Pays cell still mints — the instrument is not vacuously empty").toEqual([
        ["F999", "C-PROSE-PROBE"],
      ]);
    },
  );

  it("stamp-paid-by writes PaidBy and does not move; validate still fails until --retire moves", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    writeHappy(root, parts);
    const productionFindings = path.join(REPO_ROOT, RECORD_REL, "findings.xml");
    const beforeProduction = readFileSync(productionFindings, "utf8");
    const stamped = runValidatorInProcess(root, ["--stamp-paid-by"]);
    expect(stamped.status).toBe(0);
    const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const retired = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
    expect(live).toContain("<PaidBy>C-OLD</PaidBy>");
    expect(live).toContain('token="F1"');
    expect(retired).not.toContain('token="F1"');
    const stillRed = runValidatorInProcess(root);
    expect(stillRed.status).not.toBe(0);
    expect(stillRed.stderr).toContain("finding-eligible-still-live");
    expect(readFileSync(productionFindings, "utf8")).toBe(beforeProduction);
  });

  it("argv fixture --retire does not read or write the repository record files", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    writeHappy(root, parts);
    const productionFiles = [
      "findings.xml",
      "findings-retired.xml",
      "rulings.xml",
      "rulings-retired.xml",
      "registry.xml",
      "registry-retired.xml",
      "decisions.xml",
    ].map((name) => path.join(REPO_ROOT, RECORD_REL, name));
    const before = productionFiles.map((file) => readFileSync(file, "utf8"));
    const result = runValidatorInProcess(root, ["--retire", RECORD_REL]);
    expect(result.status).toBe(0);
    for (let i = 0; i < productionFiles.length; i++) {
      expect(readFileSync(productionFiles[i]!, "utf8")).toBe(before[i]);
    }
    const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const retired = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
    expect(live).not.toContain('token="F1"');
    expect(retired).toContain('token="F1"');
    expect(retired).toContain('status="retired"');
    expect(retired).toContain("<PaidBy>C-OLD</PaidBy>");
  });

  it("--split on a stub still exits non-zero", () => {
    const root = isolatedRoot();
    plant(
      root,
      `${RECORD_REL}/decisions.md`,
      `# RM-GOVERNED-PATH record stub\n\nThe parseable citation index is [./decisions.xml](./decisions.xml).\n`,
    );
    const result = runValidatorInProcess(root, ["--split"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/refusing to split a stub|not the pre-split dump/);
  });

  it("T-002 removal: a split-shaped ruling file keeps its previous ceiling when the 7-times term exceeds it", () => {
    const root = isolatedRoot();
    const parts = splitShapedParts();
    writeHappy(root, parts);
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const persisted = rootAttrs(before);
    const H = 7 * median(h2LineCounts(before));
    // the split-shaped fixture carries the uncorrected 2x headroom, so the 7-times term exceeds the persisted ceiling
    expect(newlineCount(before) + H).toBeGreaterThan(persisted.ceiling);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const written = rootAttrs(after);
    // the deleted engine raised on this shape; the removal keeps the previous ceiling
    expect(written.ceiling).toBe(persisted.ceiling);
    expect(written.headroom).toBe(written.ceiling - written.base);
  });

  it("probe 2: on the written split-shaped fixture a second --retire that moves again does not persist a larger ceiling", () => {
    const root = isolatedRoot();
    const parts = splitShapedParts();
    writeHappy(root, parts);
    const first = runValidatorInProcess(root, ["--retire"]);
    expect(first.status).toBe(0);
    const afterFirstPath = path.join(root, RECORD_REL, "rulings.xml");
    const afterFirst = readFileSync(afterFirstPath, "utf8");
    const ceilingAfterFirst = rootAttrs(afterFirst).ceiling;
    const tagged = afterFirst.replace(
      "</Decision>",
      `    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>\n  </Decision>`,
    );
    plant(root, `${RECORD_REL}/rulings.xml`, tagged);
    plant(root, "tests/exists.test.ts", "export {}\n");
    const second = runValidatorInProcess(root, ["--retire"]);
    expect(second.status).toBe(0);
    const afterSecond = readFileSync(afterFirstPath, "utf8");
    expect(rootAttrs(afterSecond).ceiling).toBeLessThanOrEqual(ceilingAfterFirst);
    expect(afterSecond).not.toContain('token="D1"');
    const retired = readFileSync(path.join(root, RECORD_REL, "rulings-retired.xml"), "utf8");
    expect(retired).toContain('token="D1"');
    expect(retired).toContain("CodifiedIn");
  });

  it("probe 3: already-7-times identity whose formula would raise keeps the previous ceiling", () => {
    const root = isolatedRoot();
    const small = `  <Decision id="d-small" token="D-SMALL" status="live">
    <Title>## D-SMALL — small</Title>
    <Body>s</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>`;
    const largeBody = ["line", "line", "line", "line", "line", "line"].join("\n");
    const large = `  <Decision id="d-large" token="D-LARGE" status="live">
    <Title>## D-LARGE — large</Title>
    <Body>${largeBody}</Body>
  </Decision>`;
    const inner = `${small}\n${large}`;
    const wrappedNoAttrs = `<Rulings>\n${inner}\n</Rulings>\n`;
    const counts = h2LineCounts(wrappedNoAttrs);
    const base = newlineCount(wrappedNoAttrs);
    const headroom = 7 * median(counts);
    const ceiling = base + headroom;
    const parts = happyParts();
    plant(root, "tests/exists.test.ts", "export {}\n");
    parts.rulings = `<Rulings base="${base}" headroom="${headroom}" ceiling="${ceiling}">
${inner}
</Rulings>
`;
    parts.rulingsRetired = `<Rulings>\n</Rulings>\n`;
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d-small" token="D-SMALL" genre="decision" layer="live" />
  <Entry id="d-large" token="D-LARGE" genre="decision" layer="live" />
</RecordIndex>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const written = rootAttrs(after);
    expect(written.ceiling).toBe(ceiling);
    expect(written.ceiling).toBeLessThan(newlineCount(after) + 7 * median(h2LineCounts(after)));
    expect(written.headroom).toBe(written.ceiling - written.base);
  });

  it("T-002 removal: a split-shaped ruling file never raises its ceiling across two --retire moves", () => {
    const root = isolatedRoot();
    const parts = splitShapedParts();
    writeHappy(root, parts);
    const begin = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const persisted = rootAttrs(begin);
    const first = runValidatorInProcess(root, ["--retire"]);
    expect(first.status).toBe(0);
    const afterFirst = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(rootAttrs(afterFirst).ceiling).toBe(persisted.ceiling);
    // re-arm a second eligible finding against a fresh archive dir, then --retire again
    mkdirSync(path.join(root, ".ngrace/changes/archive/C-LATE"), { recursive: true });
    const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const grown = live.replace(
      "</Findings>",
      `  <Finding id="f9" token="F9" status="live">\n    <Title>### F9 — paid</Title>\n    <Body>late body</Body>\n  </Finding>\n</Findings>`,
    );
    plant(root, `${RECORD_REL}/findings.xml`, grown);
    const registryRetired = readFileSync(path.join(root, RECORD_REL, "registry-retired.xml"), "utf8");
    const reg = registryRetired.replace(
      "</Registry>",
      `  <Row name="C-LATE" status="retired" kind="chartered">\n    <Number>3</Number>\n    <Charter>late</Charter>\n    <Pays>F9</Pays>\n    <StatusText>Delivered</StatusText>\n  </Row>\n</Registry>`,
    );
    plant(root, `${RECORD_REL}/registry-retired.xml`, reg);
    const second = runValidatorInProcess(root, ["--retire"]);
    expect(second.status).toBe(0);
    const afterSecond = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(rootAttrs(afterSecond).ceiling).toBe(persisted.ceiling);
    const retired = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
    expect(retired).toContain('token="F9"');
  });

  it("ceiling-exceeded names --retire / move and does not name a multiplier", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.findings = `<Findings base="1" headroom="0" ceiling="1">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ceiling-exceeded");
    expect(result.stderr).toContain("--retire");
    expect(result.stderr).toContain("retired sibling");
    expect(result.stderr.toLowerCase()).not.toContain("config key");
    expect(result.stderr).not.toContain("multiplier");
  });

  it("T-001 window: persisting the findings snapshot after a move uses the pre-move base + H", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    const grown = ["grow", "grow", "grow", "grow", "grow"];
    const f = (id: string, token: string) =>
      `  <Finding id="${id}" token="${token}" status="live">\n` +
      `    <Title>### ${token} — live</Title>\n` +
      `    <Body>body\n${grown.join("\n")}</Body>\n` +
      `  </Finding>`;
    parts.findings =
      `<Findings base="20" headroom="70" ceiling="1000">\n${f("f1", "F1")}\n${f("f3", "F3")}\n</Findings>\n`;
    writeHappy(root, parts);
    const asRead = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const baseLive = newlineCount(asRead);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const written = rootAttrs(after);
    const H = 7 * median(findingLineCounts(after));
    expect(written.ceiling).toBe(baseLive + H);
    expect(written.base).toBe(newlineCount(after));
    expect(written.headroom).toBe(written.ceiling - written.base);
    // the moved element left findings, so the shipped post-move term would persist a smaller ceiling
    expect(written.ceiling).toBeGreaterThan(newlineCount(after) + H);
    // every live root keeps base + headroom = ceiling after a successful move
    const all = {
      findings: after,
      rulings: readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8"),
      registry: readFileSync(path.join(root, RECORD_REL, "registry.xml"), "utf8"),
      index: readFileSync(path.join(root, RECORD_REL, "decisions.xml"), "utf8"),
    };
    for (const xml of Object.values(all)) {
      const r = rootAttrs(xml);
      expect(r.headroom).toBe(r.ceiling - r.base);
    }
  });

  it("T-001 window anti-ratchet: --retire keeps the previous ceiling when Base_live + H exceeds it", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    const grown = ["grow", "grow", "grow", "grow", "grow", "grow", "grow"];
    const f = (id: string, token: string) =>
      `  <Finding id="${id}" token="${token}" status="live">\n` +
      `    <Title>### ${token} — live</Title>\n` +
      `    <Body>body\n${grown.join("\n")}</Body>\n` +
      `  </Finding>`;
    const inner = `${f("f1", "F1")}\n${f("f3", "F3")}`;
    const noAttrs = `<Findings>\n${inner}\n</Findings>\n`;
    const baseLive = newlineCount(noAttrs);
    const H = 7 * median(findingLineCounts(noAttrs));
    const ceilingLow = baseLive + H - 1;
    parts.findings = `<Findings base="${baseLive}" headroom="${H}" ceiling="${ceilingLow}">\n${inner}\n</Findings>\n`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const written = rootAttrs(after);
    expect(written.ceiling).toBe(ceilingLow);
    // a no-min recompute that raises the ceiling fails this probe
    expect(written.ceiling).toBeLessThan(baseLive + H);
  });

  it("C-ROOT-WINDOW unmoved window: a genre with zero moved elements keeps its persisted ceiling with the base re-derived and headroom the remainder — the shipped clamp (C-RETIREMENT-WINDOW's min-not-decorative behaviour) is the named baseline this assertion overturns", () => {
    // Same scenario the shipped min-not-decorative test drove: a decision-only
    // move with a hand-shaped findings root. The shipped engine persisted
    // min(persisted ceiling, Base_live + H) — the window an unrelated move
    // opened was clamped back to H; that clamp is the behaviour this bundle
    // overturns, and this test reddens if an unmoved genre's window shrinks
    // across a move in another genre (the named mutation).
    const root = isolatedRoot();
    const parts = happyParts();
    plant(root, "tests/exists.test.ts", "export {}\n");
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body</Body>
  </Finding>
</Findings>
`;
    writeHappy(root, parts);
    const asRead = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const persisted = rootAttrs(asRead);
    const baseLive = newlineCount(asRead);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const written = rootAttrs(after);
    const H = 7 * median(findingLineCounts(after));
    // the shipped clamp would persist min(persisted, base + H) here — strictly
    // below the held ceiling on this fixture, which is what reddens it
    expect(baseLive + H).toBeLessThan(persisted.ceiling);
    // the unmoved genre keeps its persisted ceiling; the base is re-derived
    // from the shipped metric read back and headroom is the remainder
    expect(written.ceiling, "the unmoved genre's window survives the unrelated move").toBe(persisted.ceiling);
    expect(written.base).toBe(newlineCount(after));
    expect(written.headroom).toBe(written.ceiling - written.base);
  });

  it("C-ROOT-WINDOW rewrite-roots byte no-op: on a consistent record the mode re-derives all four live roots from the held ceilings and the metric read-backs and leaves every record file byte-identical, and a second run is again a byte no-op", () => {
    const root = isolatedRoot();
    writeHappy(root, consistentParts());
    expect(runValidatorInProcess(root).status, "the consistent fixture validates clean").toBe(0);
    const before = snapshotRecord(root);
    const result = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status, result.stderr).toBe(0);
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: byte-identical`).toBe(text);
    }
    const second = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(second.status).toBe(0);
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: the second run is again a byte no-op`).toBe(text);
    }
  });

  it("C-ROOT-WINDOW rewrite-roots refusal: an exceeded ceiling exits 1 with nothing written, naming the genre, both counts in their unit, and the move as the remedy", () => {
    const root = isolatedRoot();
    const parts = consistentParts();
    const persisted = rootAttrs(parts.findings);
    parts.findings = parts.findings.replace(
      `ceiling="${persisted.ceiling}"`,
      `ceiling="${persisted.base - 1}"`,
    );
    writeHappy(root, parts);
    const before = snapshotRecord(root);
    const result = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ceiling-exceeded");
    expect(result.stderr).toContain(
      `live findings line count ${newlineCount(parts.findings)} exceeds persisted ceiling ${persisted.base - 1}`,
    );
    expect(result.stderr).toContain("--retire");
    expect(result.stderr).toContain("move the eligible entry to the retired sibling");
    expect(result.stderr).toContain("Raising the persisted ceiling is not the remedy");
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: nothing written`).toBe(text);
    }
  });

  it("C-ROOT-WINDOW rewrite-roots refusal: a missing ceiling attribute exits 1 with nothing written", () => {
    const root = isolatedRoot();
    const parts = consistentParts();
    parts.registry = parts.registry.replace(/ ceiling="[0-9]+">/, ">");
    writeHappy(root, parts);
    const before = snapshotRecord(root);
    const result = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing-ceiling");
    expect(result.stderr).toContain("has no persisted ceiling");
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: nothing written`).toBe(text);
    }
  });

  it("C-ROOT-WINDOW rewrite-roots hold: a hand-raised ceiling passes through byte-for-byte — never recomputed and never adopted — while the base is repaired to the read-back", () => {
    const root = isolatedRoot();
    const parts = consistentParts();
    parts.registry = parts.registry.replace(
      /<Registry [^>]*>/,
      '<Registry base="12" headroom="78" ceiling="90">',
    );
    writeHappy(root, parts);
    const before = snapshotRecord(root);
    const result = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status, result.stderr).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "registry.xml"), "utf8");
    expect(after, "the ceiling's raw bytes pass through untouched").toContain('ceiling="90"');
    const written = rootAttrs(after);
    expect(written.ceiling).toBe(rootAttrs(before["registry.xml"]).ceiling);
    expect(written.base, "the hand-written base is repaired to the shipped metric read back").toBe(liveRowCount(after));
    expect(written.headroom).toBe(written.ceiling - written.base);
    for (const name of ["findings.xml", "rulings.xml", "decisions.xml", "findings-retired.xml", "rulings-retired.xml", "registry-retired.xml", "decisions.md", "record-inventory.json"]) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: untouched by the registry run`).toBe(before[name]);
    }
  });

  it("C-ROOT-WINDOW floored derivation: an even post-move population with differing middles persists the floored integer where the shipped unfloored form persists the fractional value on the identical fixture", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    const grow = (n: number) => Array.from({ length: n }, (_, i) => `grow ${i + 1}`).join("\n");
    const f = (id: string, token: string, extra: number) =>
      `  <Finding id="${id}" token="${token}" status="live">\n` +
      `    <Title>### ${token} — live</Title>\n` +
      `    <Body>body\n${grow(extra)}</Body>\n` +
      `  </Finding>`;
    // after f1 moves, the surviving population is two elements with line
    // counts 19 and 20 — the middles differ by an odd number, so the shipped
    // 7 x median persists a .5
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">\n${f("f1", "F1", 0)}\n${f("f4", "F4", 14)}\n${f("f3", "F3", 15)}\n</Findings>\n`;
    writeHappy(root, parts);
    const asRead = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const baseLive = newlineCount(asRead);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const written = rootAttrs(after);
    const unfloored = 7 * median(findingLineCounts(after));
    expect(unfloored % 1, "the fixture discriminates: the shipped unfloored product is fractional").not.toBe(0);
    expect(Number.isInteger(written.ceiling), "no fractional ceiling persists").toBe(true);
    expect(Number.isInteger(written.headroom), "no fractional headroom persists").toBe(true);
    expect(written.ceiling, "the persisted ceiling is the pre-move base plus the floored product").toBe(baseLive + Math.floor(unfloored));
    expect(written.ceiling, "the shipped unfloored form would have persisted the fractional value on the identical fixture").not.toBe(baseLive + unfloored);
    expect(written.headroom).toBe(written.ceiling - written.base);
  });

  it("C-ROOT-WINDOW unmoved window across two consecutive moves: the genre the moves did not change stays byte-identical through both and keeps its persisted ceiling", () => {
    const root = isolatedRoot();
    const parts = consistentParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    writeHappy(root, parts);
    const rulingsBefore = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const first = runValidatorInProcess(root, ["--retire"]);
    expect(first.status, first.stderr).toBe(0);
    const rulingsAfterFirst = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(rulingsAfterFirst, "the unmoved rulings genre is byte-identical across the first move").toBe(rulingsBefore);
    // re-arm a second unrelated retirement against a fresh archive dir
    mkdirSync(path.join(root, ".ngrace/changes/archive/C-LATE"), { recursive: true });
    const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const grown = live.replace(
      "</Findings>",
      `  <Finding id="f9" token="F9" status="live">\n    <Title>### F9 — paid</Title>\n    <Body>late body</Body>\n  </Finding>\n</Findings>`,
    );
    plant(root, `${RECORD_REL}/findings.xml`, grown);
    const registryRetired = readFileSync(path.join(root, RECORD_REL, "registry-retired.xml"), "utf8");
    const reg = registryRetired.replace(
      "</Registry>",
      `  <Row name="C-LATE" status="retired" kind="chartered">\n    <Number>3</Number>\n    <Charter>late</Charter>\n    <Pays>F9</Pays>\n    <StatusText>Delivered</StatusText>\n  </Row>\n</Registry>`,
    );
    plant(root, `${RECORD_REL}/registry-retired.xml`, reg);
    const second = runValidatorInProcess(root, ["--retire"]);
    expect(second.status, second.stderr).toBe(0);
    const rulingsAfterSecond = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(rulingsAfterSecond, "the unmoved rulings genre is byte-identical through both moves").toBe(rulingsBefore);
    const written = rootAttrs(rulingsAfterSecond);
    expect(written.headroom).toBe(written.ceiling - written.base);
    expect(written.base).toBe(newlineCount(rulingsAfterSecond));
  });

  it("C-ROOT-WINDOW normalising pass: after a move every surviving top-level element is byte-identical with canonical gaps, and a mutated element's own bytes redden the walk", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    parts.findingsRetired = `<Findings>\n  <Finding id="f9" token="F9" status="retired">\n    <PaidBy>C-OLD</PaidBy>\n    <Title>### F9 — retired</Title>\n    <Body>body nine</Body>\n  </Finding>\n</Findings>\n`;
    // C-RECORD-DECISION-FLUSH-1-368E01F2 T-001: the index Entry must hold the
    // reassigned retired element (f9), not happyParts' f2, or the presence
    // relation `record-index-orphan` reddens the fixture.
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">\n  <Entry id="f1" token="F1" genre="finding" layer="live" />\n  <Entry id="f9" token="F9" genre="finding" layer="retired" />\n  <Entry id="d1" token="D1" genre="decision" layer="live" />\n</RecordIndex>\n`;
    const f = (id: string, token: string, body: string) =>
      `  <Finding id="${id}" token="${token}" status="live">\n    <Title>### ${token} — live</Title>\n    <Body>${body}</Body>\n  </Finding>`;
    // pre-existing drift: a blank line and a 4-space indent before f2 (F190's
    // shape) — the move's pass must normalise it away without touching bytes
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">\n${f("f1", "F1", "body one")}\n\n    ${f("f4", "F4", "body two")}\n${f("f3", "F3", "body three")}\n</Findings>\n`;
    writeHappy(root, parts);
    const beforeXml = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    expect(gapShapesCanonical(beforeXml), "the pre-move fixture carries non-canonical gaps (the drift the pass repairs)").toBe(false);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const afterXml = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const beforeBytes = topElementBytes(beforeXml);
    const afterBytes = topElementBytes(afterXml);
    let changed = 0;
    for (const [id, bytes] of beforeBytes) {
      const survivor = afterBytes.get(id);
      if (survivor === undefined) continue;
      if (survivor !== bytes) changed += 1;
    }
    expect(changed, "every surviving element's own bytes are byte-identical across the move (changed 0)").toBe(0);
    expect(gapShapesCanonical(afterXml), "every gap is the canonical house shape after the pass").toBe(true);
    expect(afterXml.endsWith("\n</Findings>\n"), "the root close tag sits at column 0").toBe(true);
    const retiredXml = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
    expect(retiredXml, "the appended retired-side element sits at 2-space indent").toMatch(/\n  <Finding id="f1" token="F1" status="retired">/);
    expect(retiredXml.endsWith("\n</Findings>\n")).toBe(true);
    // the named red: one surviving element's own bytes mutated — the walk
    // reports changed 1 where the clean record reports changed 0
    const mutated = afterXml.replace("body two", "body two mutated");
    const mutatedBytes = topElementBytes(mutated);
    let mutatedChanged = 0;
    for (const [id, bytes] of beforeBytes) {
      const survivor = mutatedBytes.get(id);
      if (survivor === undefined) continue;
      if (survivor !== bytes) mutatedChanged += 1;
    }
    expect(mutatedChanged, "the mutated copy reddens the walk (changed 1)").toBe(1);
  });

  it("T-001 Delta = 0: a decision-only --retire leaves findings at window H when the snapshot sits at base + H", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    plant(root, "tests/exists.test.ts", "export {}\n");
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    const f =
      `  <Finding id="f1" token="F1" status="live">\n` +
      `    <Title>### F1 — live</Title>\n` +
      `    <Body>body one</Body>\n` +
      `  </Finding>`;
    const noAttrs = `<Findings>\n${f}\n</Findings>\n`;
    const baseLive = newlineCount(noAttrs);
    const H = 7 * median(findingLineCounts(noAttrs));
    parts.findings = `<Findings base="${baseLive}" headroom="${H}" ceiling="${baseLive + H}">\n${f}\n</Findings>\n`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const written = rootAttrs(after);
    expect(written.base).toBe(baseLive);
    expect(written.ceiling).toBe(baseLive + H);
    expect(written.headroom).toBe(H);
  });

  it("T-003 provenance: a rulings live ceiling at the constant validates", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.rulings = `<Rulings base="1624" headroom="259" ceiling="${RULINGS_PROVENANCE_CEILING}">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("T-003 provenance: a rulings live ceiling one above the constant errors with the provenance message", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.rulings = `<Rulings base="1624" headroom="259" ceiling="${RULINGS_PROVENANCE_CEILING + 1}">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rulings-ceiling-above-provenance");
    expect(result.stderr).toContain("C-RETIRE-AND-CODIFY");
    expect(result.stderr).toContain("no shipped operation raises it");
    expect(result.stderr).toContain("restore from git");
    expect(result.stderr).toContain("raising the persisted ceiling is not the remedy");
    expect(result.stderr.toLowerCase()).not.toContain("config key");
    expect(result.stderr).not.toContain("multiplier");
  });

  it("rulings window equilibrium: --retire persists min(previous, pre-move base + H_new) and window Delta_retired + H_new", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    const stayBody = Array.from({ length: 8 }, () => "stay").join("\n");
    const moveBody = Array.from({ length: 12 }, () => "move").join("\n");
    const stay = `  <Decision id="d-stay" token="D-STAY" status="live">
    <Title>## D-STAY — stay</Title>
    <Body>${stayBody}</Body>
  </Decision>`;
    const move = `  <Decision id="d-move" token="D-MOVE" status="live">
    <Title>## D-MOVE — move</Title>
    <Body>${moveBody}</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>`;
    const inner = `${move}\n${stay}`;
    const wrappedNoAttrs = `<Rulings>\n${inner}\n</Rulings>\n`;
    const HOld = 7 * median(liveH2DecisionLineCounts(wrappedNoAttrs));
    const baseLive = newlineCount(wrappedNoAttrs);
    const parts = happyParts();
    parts.rulings = `<Rulings base="${baseLive}" headroom="${HOld}" ceiling="${baseLive + HOld}">
${inner}
</Rulings>
`;
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d-stay" token="D-STAY" genre="decision" layer="live" />
  <Entry id="d-move" token="D-MOVE" genre="decision" layer="live" />
</RecordIndex>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(after).not.toContain('token="D-MOVE"');
    expect(after).toContain('token="D-STAY"');
    const written = rootAttrs(after);
    const HNew = 7 * median(liveH2DecisionLineCounts(after));
    const deltaRetired = baseLive - newlineCount(after);
    expect(deltaRetired).toBeGreaterThan(0);
    expect(HNew).toBeLessThan(HOld);
    expect(written.ceiling).toBe(Math.min(baseLive + HOld, baseLive + HNew));
    expect(written.ceiling).toBe(baseLive + HNew);
    expect(written.base).toBe(newlineCount(after));
    expect(written.headroom).toBe(written.ceiling - written.base);
    expect(written.headroom).toBe(deltaRetired + HNew);
    expect(written.ceiling).toBeGreaterThan(newlineCount(after) + HNew);
  });

  it("rulings window anti-ratchet: --retire keeps the previous ceiling when Base_live + H_new exceeds it", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    const stayBody = Array.from({ length: 8 }, () => "stay").join("\n");
    const moveBody = Array.from({ length: 12 }, () => "move").join("\n");
    const stay = `  <Decision id="d-stay" token="D-STAY" status="live">
    <Title>## D-STAY — stay</Title>
    <Body>${stayBody}</Body>
  </Decision>`;
    const move = `  <Decision id="d-move" token="D-MOVE" status="live">
    <Title>## D-MOVE — move</Title>
    <Body>${moveBody}</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>`;
    const inner = `${move}\n${stay}`;
    const stayOnly = `<Rulings>\n${stay}\n</Rulings>\n`;
    const HNew = 7 * median(liveH2DecisionLineCounts(stayOnly));
    const wrappedNoAttrs = `<Rulings>\n${inner}\n</Rulings>\n`;
    const baseLive = newlineCount(wrappedNoAttrs);
    const formulaTerm = baseLive + HNew;
    const ceilingLow = formulaTerm - 1;
    const parts = happyParts();
    parts.rulings = `<Rulings base="${baseLive}" headroom="${ceilingLow - baseLive}" ceiling="${ceilingLow}">
${inner}
</Rulings>
`;
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d-stay" token="D-STAY" genre="decision" layer="live" />
  <Entry id="d-move" token="D-MOVE" genre="decision" layer="live" />
</RecordIndex>
`;
    writeHappy(root, parts);
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const written = rootAttrs(after);
    expect(written.ceiling).toBe(ceilingLow);
    expect(written.ceiling).toBeLessThan(formulaTerm);
  });

  it("rulings window clamped: provenance ceiling binds and the window opens by Delta_retired", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    const stayBody = Array.from({ length: 8 }, () => "stay").join("\n");
    const moveBody = Array.from({ length: 12 }, () => "move").join("\n");
    const stay = `  <Decision id="d-stay" token="D-STAY" status="live">
    <Title>## D-STAY — stay</Title>
    <Body>${stayBody}</Body>
  </Decision>`;
    const move = `  <Decision id="d-move" token="D-MOVE" status="live">
    <Title>## D-MOVE — move</Title>
    <Body>${moveBody}</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>`;
    const pad = Array.from({ length: 1800 }, () => "  <!-- pad -->").join("\n");
    const inner = `${move}\n${stay}\n${pad}`;
    const stayPadded = `<Rulings>\n${stay}\n${pad}\n</Rulings>\n`;
    const HNew = 7 * median(liveH2DecisionLineCounts(stayPadded));
    const wrappedNoAttrs = `<Rulings>\n${inner}\n</Rulings>\n`;
    const baseLive = newlineCount(wrappedNoAttrs);
    expect(baseLive + HNew).toBeGreaterThanOrEqual(RULINGS_PROVENANCE_CEILING);
    const parts = happyParts();
    parts.rulings = `<Rulings base="${baseLive}" headroom="${RULINGS_PROVENANCE_CEILING - baseLive}" ceiling="${RULINGS_PROVENANCE_CEILING}">
${inner}
</Rulings>
`;
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d-stay" token="D-STAY" genre="decision" layer="live" />
  <Entry id="d-move" token="D-MOVE" genre="decision" layer="live" />
</RecordIndex>
`;
    writeHappy(root, parts);
    const before = rootAttrs(readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8"));
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const afterXml = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const after = rootAttrs(afterXml);
    const deltaRetired = before.base - after.base;
    expect(deltaRetired).toBeGreaterThan(0);
    expect(after.ceiling).toBe(RULINGS_PROVENANCE_CEILING);
    expect(after.headroom).toBe(before.headroom + deltaRetired);
    expect(after.headroom).toBe(after.ceiling - after.base);
  });

  it("TaughtIn-only: a resolving TaughtIn does not move and does not emit decision-eligible-still-live", () => {
    const root = isolatedRoot();
    plant(root, "skills/ngrace/ngrace-plan/SKILL.md", "<purpose>hello</purpose>\n");
    plant(root, "tests/exists.test.ts", "export {}\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <TaughtIn path="skills/ngrace/ngrace-plan/SKILL.md" section="purpose"></TaughtIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const validated = runValidatorInProcess(root);
    expect(validated.status).toBe(0);
    expect(validated.stderr).not.toContain("decision-eligible-still-live");
    const retired = runValidatorInProcess(root, ["--retire"]);
    expect(retired.status).toBe(0);
    expect(readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8")).toBe(before);
    expect(readFileSync(path.join(root, RECORD_REL, "rulings-retired.xml"), "utf8")).not.toContain(
      'token="D1"',
    );
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const moved = runValidatorInProcess(root, ["--retire"]);
    expect(moved.status).toBe(0);
    expect(readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8")).not.toContain(
      'token="D1"',
    );
    expect(readFileSync(path.join(root, RECORD_REL, "rulings-retired.xml"), "utf8")).toContain(
      'token="D1"',
    );
  });

  it("TaughtIn and CodifiedIn dangling pointers still error", () => {
    const root = isolatedRoot();
    plant(root, "skills/ngrace/ngrace-plan/SKILL.md", "<purpose>hello</purpose>\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <TaughtIn path="skills/ngrace/ngrace-plan/SKILL.md" section="purpose"></TaughtIn>
    <TaughtIn path="skills/ngrace/ngrace-plan/SKILL.md" section="no-such-section"></TaughtIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const taught = runValidatorInProcess(root);
    expect(taught.status).not.toBe(0);
    expect(taught.stderr).toContain("taught-in-unresolved");
    expect(taught.stderr).not.toContain("decision-eligible-still-live");
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/missing.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const coded = runValidatorInProcess(root);
    expect(coded.status).not.toBe(0);
    expect(coded.stderr).toContain("codified-in-unresolved");
    expect(coded.stderr).not.toContain("decision-eligible-still-live");
  });

  it("all CodifiedIn children: first dangling second resolving errors and is not moved", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/missing.test.ts</CodifiedIn>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const validated = runValidatorInProcess(root);
    expect(validated.status).not.toBe(0);
    expect(validated.stderr).toContain("codified-in-unresolved");
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const retired = runValidatorInProcess(root, ["--retire"]);
    expect(retired.status).toBe(0);
    expect(readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8")).toBe(before);
  });

  it("all CodifiedIn children: first resolving second dangling errors and is not moved", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
    <CodifiedIn kind="test-suite">tests/missing.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const validated = runValidatorInProcess(root);
    expect(validated.status).not.toBe(0);
    expect(validated.stderr).toContain("codified-in-unresolved");
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const retired = runValidatorInProcess(root, ["--retire"]);
    expect(retired.status).toBe(0);
    expect(readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8")).toBe(before);
  });

  it("all CodifiedIn children: both resolving --retire moves; one resolving child is sufficient", () => {
    const root = isolatedRoot();
    plant(root, "tests/exists.test.ts", "export {}\n");
    plant(root, "tests/also.test.ts", "export {}\n");
    const parts = happyParts();
    parts.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
    <CodifiedIn kind="test-suite">tests/also.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root, parts);
    const both = runValidatorInProcess(root, ["--retire"]);
    expect(both.status).toBe(0);
    expect(readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8")).not.toContain(
      'token="D1"',
    );
    expect(readFileSync(path.join(root, RECORD_REL, "rulings-retired.xml"), "utf8")).toContain(
      'token="D1"',
    );
    const root2 = isolatedRoot();
    plant(root2, "tests/exists.test.ts", "export {}\n");
    const parts2 = happyParts();
    parts2.rulings = `<Rulings base="20" headroom="40" ceiling="1000">
  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>ruling body</Body>
    <CodifiedIn kind="test-suite">tests/exists.test.ts</CodifiedIn>
  </Decision>
</Rulings>
`;
    writeHappy(root2, parts2);
    const one = runValidatorInProcess(root2, ["--retire"]);
    expect(one.status).toBe(0);
    expect(readFileSync(path.join(root2, RECORD_REL, "rulings.xml"), "utf8")).not.toContain(
      'token="D1"',
    );
  });

  it("T-004 no-op: a --retire with nothing eligible leaves every record byte identical", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const names = [
      "findings.xml",
      "findings-retired.xml",
      "rulings.xml",
      "rulings-retired.xml",
      "registry.xml",
      "registry-retired.xml",
      "decisions.xml",
      "decisions.md",
      "record-inventory.json",
    ];
    const readAll = () =>
      Object.fromEntries(names.map((name) => [name, readFileSync(path.join(root, RECORD_REL, name), "utf8")]));
    const before = readAll();
    const result = runValidatorInProcess(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readAll();
    for (const name of names) {
      expect(after[name], name).toBe(before[name]);
    }
  });

  it('AC-KIND-VISIBLE: kind="historical" pays without /delivered|superseded/i; sweep-remainder with the same Pays does not; chartered still pays', () => {
    const historicalStatus = "witness at src/example.ts:1; not a charter";
    expect(historicalStatus).not.toMatch(/delivered|superseded/i);

    const historicalRoot = isolatedRoot();
    mkdirSync(path.join(historicalRoot, ".ngrace/changes/archive/C-HIST"), { recursive: true });
    const historicalParts = happyParts();
    historicalParts.registry = `<Registry base="2" headroom="15" ceiling="17">
  <Row name="C-LIVE-ROW" status="live" kind="chartered">
    <Number>1</Number>
    <Charter>charter</Charter>
    <Pays></Pays>
    <StatusText>Ordered</StatusText>
  </Row>
  <Row name="C-HIST" status="live" kind="historical">
    <Number></Number>
    <Charter>historical payment so the derivation can see it</Charter>
    <Pays>F1</Pays>
    <StatusText>${historicalStatus}</StatusText>
  </Row>
</Registry>
`;
    writeHappy(historicalRoot, historicalParts);
    const historical = runValidatorInProcess(historicalRoot);
    expect(historical.status).not.toBe(0);
    expect(historical.stderr).toContain("finding-eligible-still-live");
    expect(historical.stderr).toContain('token="F1"');
    expect(historical.stderr).toContain("C-HIST");

    const sweepRoot = isolatedRoot();
    mkdirSync(path.join(sweepRoot, ".ngrace/changes/archive/C-SWEEP"), { recursive: true });
    const sweepParts = happyParts();
    sweepParts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays></Pays>
    <StatusText>Delivered</StatusText>
  </Row>
  <Row name="C-SWEEP" status="retired" kind="sweep-remainder">
    <Number></Number>
    <Charter></Charter>
    <Pays>F1</Pays>
    <StatusText>${historicalStatus}</StatusText>
  </Row>
</Registry>
`;
    writeHappy(sweepRoot, sweepParts);
    const sweep = runValidatorInProcess(sweepRoot);
    expect(sweep.status).toBe(0);
    expect(sweep.stderr).not.toContain("finding-eligible-still-live");

    const charteredRoot = isolatedRoot();
    const charteredParts = happyParts();
    charteredParts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Ordered, not a charter phrase</StatusText>
  </Row>
</Registry>
`;
    writeHappy(charteredRoot, charteredParts);
    const chartered = runValidatorInProcess(charteredRoot);
    expect(chartered.status).not.toBe(0);
    expect(chartered.stderr).toContain("finding-eligible-still-live");
    expect(chartered.stderr).toContain('token="F1"');
    expect(chartered.stderr).toContain("C-OLD");
  });

  it('AC-KIND-VISIBLE: kind="history" and kind="Historical" make the non-mutating validate run exit non-zero and name the illegal kind', () => {
    for (const illegal of ["history", "Historical"] as const) {
      const root = isolatedRoot();
      const parts = happyParts();
      parts.registry = `<Registry base="1" headroom="15" ceiling="16">
  <Row name="C-LIVE-ROW" status="live" kind="${illegal}">
    <Number>1</Number>
    <Charter>charter</Charter>
    <Pays></Pays>
    <StatusText>Ordered</StatusText>
  </Row>
</Registry>
`;
      writeHappy(root, parts);
      const result = runValidatorInProcess(root);
      expect(result.status, illegal).not.toBe(0);
      expect(result.stderr, illegal).toContain(illegal);
      expect(result.stderr, illegal).not.toContain("finding-eligible-still-live");
    }

    const retiredRoot = isolatedRoot();
    const retiredParts = happyParts();
    retiredParts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="history">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays></Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
    writeHappy(retiredRoot, retiredParts);
    const retired = runValidatorInProcess(retiredRoot);
    expect(retired.status).not.toBe(0);
    expect(retired.stderr).toContain("history");
  });

  it("AC-CEILING-ORDER: four historical archive-named rows sit in live registry before --retire; ceiling persists; occupancy returns; plant-in-retired fails the live observation", () => {
    const names = ["C-H1", "C-H2", "C-H3", "C-H4"] as const;
    const liveChartered = ["C-LIVE-ROW", "C-LIVE-2", "C-LIVE-3"] as const;
    const charteredXml = liveChartered
      .map(
        (name, i) =>
          `  <Row name="${name}" status="live" kind="chartered">\n    <Number>${i + 1}</Number>\n    <Charter>charter</Charter>\n    <Pays></Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>`,
      )
      .join("\n");
    const historicalXml = names
      .map(
        (name) =>
          `  <Row name="${name}" status="live" kind="historical">\n    <Number></Number>\n    <Charter>historical payment so the derivation can see it</Charter>\n    <Pays></Pays>\n    <StatusText>witness at src/example.ts:1; not a charter</StatusText>\n  </Row>`,
      )
      .join("\n");

    const insertRoot = isolatedRoot();
    for (const name of names) {
      mkdirSync(path.join(insertRoot, ".ngrace/changes/archive", name), { recursive: true });
    }
    const insertParts = happyParts();
    const preInsert = liveChartered.length;
    const headroom = 15;
    const ceiling = preInsert + headroom;
    expect(preInsert + names.length).toBeLessThanOrEqual(ceiling);
    insertParts.registry = `<Registry base="${preInsert}" headroom="${headroom}" ceiling="${ceiling}">
${charteredXml}
${historicalXml}
</Registry>
`;
    insertParts.registryRetired = `<Registry>
</Registry>
`;
    writeHappy(insertRoot, insertParts);
    const liveBefore = readFileSync(path.join(insertRoot, RECORD_REL, "registry.xml"), "utf8");
    expect(liveRowNames(liveBefore).sort()).toEqual([...liveChartered, ...names].sort());
    expect(liveRowCount(liveBefore)).toBe(preInsert + names.length);
    const persistedBefore = rootAttrs(liveBefore);
    expect(persistedBefore.ceiling).toBe(ceiling);

    const retired = runValidatorInProcess(insertRoot, ["--retire", RECORD_REL]);
    expect(retired.status).toBe(0);
    const liveAfter = readFileSync(path.join(insertRoot, RECORD_REL, "registry.xml"), "utf8");
    const retiredAfter = readFileSync(path.join(insertRoot, RECORD_REL, "registry-retired.xml"), "utf8");
    expect(liveRowNames(liveAfter).sort()).toEqual([...liveChartered].sort());
    expect(liveRowCount(liveAfter)).toBe(preInsert);
    expect(rootAttrs(liveAfter).ceiling).toBe(ceiling);
    expect(rootAttrs(liveAfter).headroom).toBe(ceiling - preInsert);
    for (const name of names) {
      expect(liveAfter).not.toContain(`name="${name}"`);
      expect(retiredAfter).toContain(`name="${name}"`);
      expect(retiredAfter).toContain(`kind="historical"`);
    }

    const plantRoot = isolatedRoot();
    for (const name of names) {
      mkdirSync(path.join(plantRoot, ".ngrace/changes/archive", name), { recursive: true });
    }
    const plantParts = happyParts();
    plantParts.registry = `<Registry base="${preInsert}" headroom="${headroom}" ceiling="${ceiling}">
${charteredXml}
</Registry>
`;
    plantParts.registryRetired = `<Registry>
${names
  .map(
    (name) =>
      `  <Row name="${name}" status="retired" kind="historical">\n    <Number></Number>\n    <Charter>historical payment so the derivation can see it</Charter>\n    <Pays></Pays>\n    <StatusText>witness at src/example.ts:1; not a charter</StatusText>\n  </Row>`,
  )
  .join("\n")}
</Registry>
`;
    writeHappy(plantRoot, plantParts);
    const plantedLive = readFileSync(path.join(plantRoot, RECORD_REL, "registry.xml"), "utf8");
    for (const name of names) {
      expect(plantedLive).not.toContain(`name="${name}"`);
    }
    expect(liveRowCount(plantedLive)).toBe(preInsert);
  });

  it("AC-WINDOW-FUEL: --retire of findings paid by historical archive-named rows opens H + Delta_retired and keeps the previous ceiling", () => {
    const root = isolatedRoot();
    mkdirSync(path.join(root, ".ngrace/changes/archive/C-H1"), { recursive: true });
    mkdirSync(path.join(root, ".ngrace/changes/archive/C-H2"), { recursive: true });
    const grown = ["grow", "grow", "grow", "grow", "grow", "grow", "grow"];
    const f = (id: string, token: string) =>
      `  <Finding id="${id}" token="${token}" status="live">\n` +
      `    <Title>### ${token} — live</Title>\n` +
      `    <Body>body\n${grown.join("\n")}</Body>\n` +
      `  </Finding>`;
    const inner = `${f("f1", "F1")}\n${f("f2", "F2")}\n${f("f3", "F3")}\n${f("f4", "F4")}\n${f("f5", "F5")}`;
    const noAttrs = `<Findings>\n${inner}\n</Findings>\n`;
    const baseLive = newlineCount(noAttrs);
    const H = 7 * median(findingLineCounts(noAttrs));
    const parts = happyParts();
    parts.findingsRetired = `<Findings>\n</Findings>\n`;
    parts.findings = `<Findings base="${baseLive}" headroom="${H}" ceiling="${baseLive + H}">\n${inner}\n</Findings>\n`;
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="live" />
  <Entry id="f3" token="F3" genre="finding" layer="live" />
  <Entry id="f4" token="F4" genre="finding" layer="live" />
  <Entry id="f5" token="F5" genre="finding" layer="live" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`;
    parts.registryRetired = `<Registry>
  <Row name="C-H1" status="retired" kind="historical">
    <Number></Number>
    <Charter>historical payment so the derivation can see it</Charter>
    <Pays>F1</Pays>
    <StatusText>witness at src/example.ts:1; not a charter</StatusText>
  </Row>
  <Row name="C-H2" status="retired" kind="historical">
    <Number></Number>
    <Charter>historical payment so the derivation can see it</Charter>
    <Pays>F2</Pays>
    <StatusText>witness at src/example.ts:1; not a charter</StatusText>
  </Row>
</Registry>
`;
    writeHappy(root, parts);
    const asRead = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const before = rootAttrs(asRead);
    expect(before.ceiling).toBe(baseLive + H);
    const result = runValidatorInProcess(root, ["--retire", RECORD_REL]);
    expect(result.status).toBe(0);
    const afterXml = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const after = rootAttrs(afterXml);
    const delta = before.base - after.base;
    expect(delta).toBeGreaterThan(0);
    expect(after.ceiling).toBe(before.ceiling);
    expect(after.headroom).toBe(before.headroom + delta);
    expect(after.headroom).toBe(after.ceiling - after.base);
    expect(afterXml).not.toContain('token="F1"');
    expect(afterXml).not.toContain('token="F2"');
    const retiredFindings = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
    expect(retiredFindings).toContain('token="F1"');
    expect(retiredFindings).toContain('token="F2"');
    expect(retiredFindings).toContain("<PaidBy>C-H1</PaidBy>");
    expect(retiredFindings).toContain("<PaidBy>C-H2</PaidBy>");
  });

  it(
    "AC-PAYMENT-SET: production retired registry holds the four historical names; payment-set tokens are retired with stamped PaidBy; both F27.1 elements moved",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const historicalNames = [
        "C-CURSOR-TASK-RESOLVER",
        "C-SUBSTANCE-OVER-NAME",
        "C-DECLARED-WRITES",
        "C-GRAMMAR-SEAM",
      ] as const;
      const paid = [
        { token: "F90", payer: "C-CURSOR-TASK-RESOLVER" },
        { token: "F90.1", payer: "C-CURSOR-TASK-RESOLVER" },
        { token: "F35", payer: "C-SUBSTANCE-OVER-NAME" },
        { token: "F27", payer: "C-DECLARED-WRITES" },
        { token: "F27.1", payer: "C-DECLARED-WRITES" },
        { token: "F27.2", payer: "C-DECLARED-WRITES" },
        { token: "F38", payer: "C-GRAMMAR-SEAM" },
      ] as const;

      const liveRegistry = readFileSync(path.join(recordDir, "registry.xml"), "utf8");
      const retiredRegistry = readFileSync(path.join(recordDir, "registry-retired.xml"), "utf8");
      const liveFindings = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const retiredFindings = readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8");

      for (const name of historicalNames) {
        expect(liveRegistry).not.toContain(`name="${name}"`);
        expect(retiredRegistry).toContain(`name="${name}"`);
        expect(retiredRegistry).toMatch(
          new RegExp(`<Row name="${name}" status="retired" kind="historical">`),
        );
      }

      const liveFindingHits = findingRecords(liveFindings);
      const retiredFindingHits = findingRecords(retiredFindings);
      const f271Retired = retiredFindingHits.filter((f) => f.token === "F27.1");
      expect(f271Retired.map((f) => f.id).sort()).toEqual(["f27.1", "f27.1-amendment"]);
      for (const { token, payer } of paid) {
        expect(liveFindingHits.filter((f) => f.token === token)).toEqual([]);
        const retired = retiredFindingHits.filter((f) => f.token === token);
        expect(retired.length).toBeGreaterThan(0);
        for (const row of retired) {
          expect(row.status).toBe("retired");
          expect(row.paidBy).toBe(payer);
        }
      }

      const index = readFileSync(path.join(recordDir, "decisions.xml"), "utf8");
      expectDuplicateTokenPair(liveFindings, retiredFindings, index, "F21", ["f21", "f21-correction"]);

      const validate = runValidatorInProcess(REPO_ROOT);
      expect(validate.status).toBe(0);
      expect(validate.stdout).toContain("record-retirement: ok");
    },
  );

  it(
    "AC-TAG-AND-RETIRE: production D5.1 D7 D9 D18 are retired with named CodifiedIn; D24 untouched",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const liveRulings = readFileSync(path.join(recordDir, "rulings.xml"), "utf8");
      const retiredRulings = readFileSync(path.join(recordDir, "rulings-retired.xml"), "utf8");
      const index = readFileSync(path.join(recordDir, "decisions.xml"), "utf8");
      const expected: Array<{ token: string; tags: string[] }> = [
        { token: "D5.1", tags: ['<CodifiedIn kind="lint-rule">markup.unparsed-link-token</CodifiedIn>'] },
        { token: "D7", tags: ['<CodifiedIn kind="lint-rule">change.task-invalid-dependency</CodifiedIn>'] },
        { token: "D9", tags: ['<CodifiedIn kind="test-suite">src/grace-cursor.test.ts</CodifiedIn>'] },
        {
          token: "D18",
          tags: [
            '<CodifiedIn kind="lint-rule">review.approval-never-asked</CodifiedIn>',
            '<CodifiedIn kind="lint-rule">review.approved-fingerprint-mismatch</CodifiedIn>',
          ],
        },
      ];
      for (const { token, tags } of expected) {
        expect(liveRulings).not.toContain(`token="${token}"`);
        const block = retiredDecision(retiredRulings, token);
        expect(block).toBeDefined();
        expect(block!).toContain('status="retired"');
        for (const tag of tags) {
          expect(block!).toContain(tag);
        }
        expect(index).toMatch(new RegExp(`token="${token}" genre="decision" layer="retired"`));
      }
      const d24 = retiredDecision(retiredRulings, "D24");
      expect(d24).toBeDefined();
      expect(d24!).toContain('<CodifiedIn kind="test-suite">src/grace-cursor.test.ts</CodifiedIn>');
      expect(d24!).not.toContain("markup.unparsed-link-token");
      expect(d24!).not.toContain("change.task-invalid-dependency");
      expect(d24!).not.toContain("review.approval-never-asked");

      const validate = runValidatorInProcess(REPO_ROOT);
      expect(validate.status).toBe(0);
      expect(validate.stdout).toContain("record-retirement: ok");
    },
  );

  it(
    "relocated no-op probe (AC-PROBE-RELOCATED): first --retire moves on an isolated fixture, second --retire writes no byte on the fixture, and the repository record files stay byte-identical",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const productionFiles = [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
      ].map((name) => path.join(recordDir, name));
      const before = productionFiles.map((file) => readFileSync(file, "utf8"));

      const root = isolatedRoot();
      const parts = happyParts();
      parts.registry = `<Registry base="2" headroom="14" ceiling="100">
  <Row name="C-LIVE-ROW" status="live" kind="chartered">
    <Number>1</Number>
    <Charter>charter</Charter>
    <Pays></Pays>
    <StatusText>Ordered</StatusText>
  </Row>
  <Row name="C-PROBE-ARCHIVE" status="live" kind="chartered">
    <Number></Number>
    <Charter>probe fixture</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
      writeHappy(root, parts);
      mkdirSync(path.join(root, ".ngrace", "changes", "archive", "C-PROBE-ARCHIVE"), { recursive: true });

      const fixtureFiles = [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
        "decisions.md",
        "record-inventory.json",
      ].map((name) => path.join(root, RECORD_REL, name));
      const readAll = () =>
        Object.fromEntries(fixtureFiles.map((file) => [file, readFileSync(file, "utf8")]));

      const first = runValidatorInProcess(root, ["--retire"]);
      expect(first.status).toBe(0);
      const retiredFixture = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
      expect(retiredFixture, "the first --retire must move on the fixture").toContain(
        "<PaidBy>C-PROBE-ARCHIVE</PaidBy>",
      );

      const beforeSecond = readAll();
      const second = runValidatorInProcess(root, ["--retire"]);
      expect(second.status).toBe(0);
      const afterSecond = readAll();
      for (const file of fixtureFiles) {
        expect(afterSecond[file], file).toBe(beforeSecond[file]);
      }

      for (let i = 0; i < productionFiles.length; i++) {
        expect(readFileSync(productionFiles[i]!, "utf8")).toBe(before[i]!);
      }
    },
  );

  it(
    "regression guard (remedy item 4): no validator spawn site carries a production cwd with a mutating argv — keyed on the arguments of every call site, refusing what it cannot prove",
    () => {
      const self = readFileSync(
        path.join(import.meta.dir, path.basename(new URL(import.meta.url).pathname)),
        "utf8",
      );
      expect(guardFailures(self)).toEqual([]);
    },
  );

  it(
    "AC-FLUSH: F192-F195 each exist exactly once across the findings files with agreeing index layers; a retired paid copy carries PaidBy C-RECORD-TEST-ISOLATION-2; F193 present, not located",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const liveFindings = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const retiredFindings = readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8");
      const index = readFileSync(path.join(recordDir, "decisions.xml"), "utf8");
      const live = findingRecords(liveFindings);
      const retired = findingRecords(retiredFindings);
      const entries = indexEntries(index);
      for (const token of ["F192", "F193", "F194", "F195"]) {
        const id = token.toLowerCase();
        const inLive = live.filter((f) => f.id === id);
        const inRetired = retired.filter((f) => f.id === id);
        expect(
          inLive.length + inRetired.length,
          `${token}: exactly one Finding element across findings.xml and findings-retired.xml`,
        ).toBe(1);
        const holder = inLive.length === 1 ? inLive[0]! : inRetired[0]!;
        expect(holder.token, `${id}: token matches`).toBe(token);
        const entry = entries.filter((e) => e.id === id);
        expect(entry.length, `${id}: exactly one matching decisions.xml Entry`).toBe(1);
        const layer = inLive.length === 1 ? "live" : "retired";
        expect(entry[0]!.layer, `${id}: index layer agrees with the holding file`).toBe(layer);
        if (token !== "F193" && layer === "retired") {
          expect(holder.paidBy, `${token}: a retired paid copy carries this bundle's PaidBy`).toBe(
            "C-RECORD-TEST-ISOLATION-2",
          );
        }
      }
    },
  );

  it(
    "AC-CHARTER: exactly one registry file holds the chartered Row for this bundle, its Charter records the mint search, and its derived payment set is exactly F192, F194, F195",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const liveRegistry = readFileSync(path.join(recordDir, "registry.xml"), "utf8");
      const retiredRegistry = readFileSync(path.join(recordDir, "registry-retired.xml"), "utf8");
      const name = "C-RECORD-TEST-ISOLATION-2";
      const rowRe = new RegExp(`<Row name="${name}"[^>]*>[\\s\\S]*?</Row>`);
      const liveRows = liveRegistry.match(rowRe) ?? [];
      const retiredRows = retiredRegistry.match(rowRe) ?? [];
      expect(
        liveRows.length + retiredRows.length,
        "the charter row exists in exactly one of registry.xml and registry-retired.xml",
      ).toBe(1);
      const row = (liveRows[0] ?? retiredRows[0])!;
      expect(row).toContain('kind="chartered"');
      const charter = row.match(/<Charter>([\s\S]*?)<\/Charter>/)?.[1] ?? "";
      const pays = row.match(/<Pays>([\s\S]*?)<\/Pays>/)?.[1] ?? "";
      const statusText = row.match(/<StatusText>([\s\S]*?)<\/StatusText>/)?.[1] ?? "";
      expect(charter, "the Charter records the mint search in the house form").toContain(
        "Searched before minting",
      );
      expect(charter).toContain("zero hits");
      // The derived payment set — the F-tokens in Pays plus any Closed-with
      // tokens in StatusText — computed by the shipped extraction
      // (derivePayerMap) over a synthetic repoRoot whose archive contains only
      // this row's name, so the archived-spec prose pass scans an empty archive.
      const synthetic = isolatedRoot();
      mkdirSync(path.join(synthetic, ".ngrace", "changes", "archive", name), { recursive: true });
      const derived = derivePayerMap(synthetic, [{ name, pays, statusText }]);
      expect([...derived.keys()].sort(), "derived payment set").toEqual(["F192", "F194", "F195"]);
      expect(
        row.includes("F193") || row.includes("f193"),
        "F193 appears nowhere in the row",
      ).toBe(false);
    },
  );

  it(
    "AC-SWEEP: the retired C-CODIFY-DECISIONS row carries no sentence current code falsifies, in any copy; the resolved TaughtIn sentence stands; the T-003 removals stay absent",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const retiredRegistry = readFileSync(path.join(recordDir, "registry-retired.xml"), "utf8");
      const rowMatch = retiredRegistry.match(/<Row name="C-CODIFY-DECISIONS"[\s\S]*?<\/Row>/);
      expect(rowMatch, "the C-CODIFY-DECISIONS row exists").toBeDefined();
      const row = rowMatch![0];
      expect(row).toContain('status="retired"');
      expect(row).toContain('kind="chartered"');
      // Every falsified sentence absent, in every copy (scoped to the row,
      // never to whole-file properties of registry-retired.xml).
      expect(row.includes("still clamps against the post-move base")).toBe(false);
      expect(row.includes("is unresolved")).toBe(false);
      expect(row.includes("may not be enough")).toBe(false);
      expect(row.includes("is a question to derive from the code")).toBe(false);
      expect(row.includes("the decisions half of")).toBe(false);
      // The sentences C-CODIFY-DECISIONS's own T-003 removed stay removed.
      expect(row.includes("forty lines over")).toBe(false);
      expect(row.includes("59 live")).toBe(false);
      expect(row.includes("zero tagged")).toBe(false);
      // The resolved TaughtIn sentence stands.
      expect(row.includes("annotates and does not retire")).toBe(true);
      // The corrected Pays mints no live finding's token: its only token is the
      // retired F187, computed by the shipped extraction over a synthetic root.
      const pays = row.match(/<Pays>([\s\S]*?)<\/Pays>/)?.[1] ?? "";
      const statusText = row.match(/<StatusText>([\s\S]*?)<\/StatusText>/)?.[1] ?? "";
      const synthetic = isolatedRoot();
      mkdirSync(path.join(synthetic, ".ngrace", "changes", "archive", "C-CODIFY-DECISIONS"), {
        recursive: true,
      });
      const derived = derivePayerMap(synthetic, [
        { name: "C-CODIFY-DECISIONS", pays, statusText },
      ]);
      expect([...derived.keys()].sort(), "the sweep mints no live payment").toEqual(["F187"]);
    },
  );

  // ---------------------------------------------------------------------------
  // C-RECORD-PARSE baseline evidence (T-001). The golden comparison is the
  // byte-preservation tripwire: it passes against the shipped engine at capture
  // time and must keep passing after every later conversion task. When it
  // fails, a write moved bytes it had no business moving.
  // ---------------------------------------------------------------------------

  const FIXTURES_DIR = path.join(import.meta.dir, "fixtures", "record-parse");
  const GOLDEN_DIR = path.join(FIXTURES_DIR, "golden");
  const GOLDEN_FILES = [
    "findings.xml",
    "findings-retired.xml",
    "rulings.xml",
    "rulings-retired.xml",
    "registry.xml",
    "registry-retired.xml",
    "decisions.xml",
  ] as const;

  function buildFixture(root: string, flags: string[]): void {
    const result = spawnSync(
      "bun",
      [path.join(FIXTURES_DIR, "build-fixture.ts"), root, ...flags],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 300_000 },
    );
    if (result.status !== 0) {
      throw new Error(`build-fixture failed: ${result.stderr ?? result.stdout}`);
    }
  }

  it(
    "C-RECORD-PARSE equivalence class: single-quoted, spaced and reordered f21 open tags yield the same verdict and move-set as the unmodified tag",
    () => {
      const control = isolatedRoot();
      buildFixture(control, ["--c-selection-row"]);
      const controlRetire = runValidatorInProcess(control, ["--retire", RECORD_REL]);
      expect(controlRetire.status).toBe(0);
      expect(controlRetire.stdout).toContain("moved 3");
      const controlPost = runValidatorInProcess(control);
      expect(controlPost.status, "the unmodified tag is the control").toBe(0);

      for (const variant of ["single-quoted", "spaced", "reordered"] as const) {
        const root = isolatedRoot();
        buildFixture(root, ["--c-selection-row", `--f21-tag=${variant}`]);
        const retire = runValidatorInProcess(root, ["--retire", RECORD_REL]);
        expect(retire.status, variant).toBe(0);
        expect(retire.stdout, variant).toContain("moved 3");
        // the element moved to the retired sibling, stamped, and every open-tag
        // byte form converged on the canonical form — the serializer re-emits the
        // tag from its parsed attributes, so quotes, spacing and attribute order
        // are canonical regardless of the input variant
        const inputOpenTag: Record<(typeof variant), string> = {
          "single-quoted": "<Finding id='f21' token='F21' status='live'>",
          spaced: '<Finding id = "f21" token = "F21" status = "live">',
          reordered: '<Finding token="F21" status="live" id="f21">',
        };
        const retired = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
        expect(retired, variant).toContain('<Finding id="f21" token="F21" status="retired">');
        expect(retired.includes(inputOpenTag[variant]), `${variant}: the input byte form is canonicalized away`).toBe(false);
        expect(retired, variant).toContain(`<PaidBy>C-SELECTION</PaidBy>`);
        const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
        expect(live, variant).not.toMatch(/<Finding[^>]*id\s*=\s*["']f21["']/);
        // the index layer flipped
        const index = readFileSync(path.join(root, RECORD_REL, "decisions.xml"), "utf8");
        expect(index, variant).toMatch(/<Entry id="f21"[^>]*layer="retired" \/>/);
        // and the moved record validates clean
        const post = runValidatorInProcess(root);
        expect(post.status, `${variant}: post-move validate`).toBe(0);
      }
    },
  );

  it(
    "C-RECORD-PARSE false-payment probe: an archived spec quoting the payment phrase mints nothing by a prose route, both directions",
    () => {
      // with the parked spec planted as archive event C-PAYMENT-RECORD-3:
      // no finding becomes eligible because a sentence matched a pattern
      const withSpec = isolatedRoot();
      buildFixture(withSpec, ["--parked-spec"]);
      const withResult = runValidatorInProcess(withSpec);
      expect(withResult.status, "with the parked spec planted").toBe(0);
      expect(withResult.stderr).not.toContain("finding-eligible-still-live");

      // control: the same fixture without the copied spec also validates green,
      // so the test discriminates
      const withoutSpec = isolatedRoot();
      buildFixture(withoutSpec, []);
      const withoutResult = runValidatorInProcess(withoutSpec);
      expect(withoutResult.status, "without the parked spec").toBe(0);
    },
  );

  it(
    "C-RECORD-PARSE payer derivation: F152 and F43 drop out and every other token's payer is unchanged from the baseline map",
    () => {
      const probes = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "baseline-probes.json"), "utf8"));
      const baseline: Record<string, string> = probes.payerMapBaseline.map;
      const rows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        expect(parsed.root, file).not.toBeNull();
        for (const row of parsed.root!.children.filter((child) => child.tag === "Row")) {
          const kind = row.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          rows.push({
            name: row.attributes.name ?? "",
            pays: childText(row, "Pays") ?? "",
            statusText: childText(row, "StatusText") ?? "",
          });
        }
      }
      const derived = derivePayerMap(REPO_ROOT, rows);
      expect(derived.has("F152"), "F152 was a prose-only route").toBe(false);
      expect(derived.has("F43"), "F43 was a prose-only route").toBe(false);
      for (const [token, payer] of Object.entries(baseline)) {
        if (token === "F152" || token === "F43") {
          continue;
        }
        expect(derived.get(token), token).toBe(payer);
      }
      for (const [token] of derived) {
        expect(derived.get(token), token).toBe(baseline[token] ?? bundleMinted[token]);
      }
    },
  );

  it(
    "C-RECORD-PARSE golden: a fixture --retire writes byte-for-byte the files the shipped engine wrote at capture time",
    () => {
      const root = isolatedRoot();
      buildFixture(root, ["--c-selection-row"]);
      const result = runValidatorInProcess(root, ["--retire", RECORD_REL]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("moved 3");
      for (const name of GOLDEN_FILES) {
        const golden = readFileSync(path.join(GOLDEN_DIR, name));
        const written = readFileSync(path.join(root, RECORD_REL, name));
        expect(
          written.equals(golden),
          `${name}: the converted engine must write the same bytes the shipped engine wrote`,
        ).toBe(true);
      }
    },
  );

  it(
    "C-RECORD-PARSE baseline evidence: baseline-probes.json records the shipped engine's failing signatures the probes discriminate against",
    () => {
      const probes = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "baseline-probes.json"), "utf8"));
      expect(probes.baseCommit).toBe("49b4ebb7c6627601ca77ca384f7b6e205d1f65ed");

      // The false-payment probe, both directions, as recorded.
      const fp = probes.falsePaymentProbe.withParkedSpec;
      expect(fp.validateExitCode).toBe(1);
      expect(fp.findingEligibleStillLiveCount).toBe(15);
      expect(fp.allNamingArchiveEvent).toBe("C-PAYMENT-RECORD-3");
      expect(fp.includesF21).toBe(true);
      expect(fp.includesF21Correction).toBe(true);
      expect(fp.retireMoved).toBe(15);
      expect(fp.paidByStampsWritten).toBe(15);
      expect(fp.paidByValue).toBe("C-PAYMENT-RECORD-3");
      expect(fp.postMoveValidateExitCode).toBe(0);
      expect(probes.falsePaymentProbe.withoutParkedSpec.validateExitCode).toBe(0);

      // The equivalence-class probe: the shipped engine fails the first two
      // variants (moved one low, element left live), passes the reordered one.
      const eq = probes.equivalenceClassProbe;
      expect(eq.unmodified.retireMoved).toBe(3);
      expect(eq.unmodified.f21LeftLive).toBe(false);
      expect(eq.unmodified.postMoveValidateExitCode).toBe(0);
      for (const variant of ["singleQuoted", "spaced"] as const) {
        expect(eq[variant].retireMoved, variant).toBe(2);
        expect(eq[variant].f21LeftLive, variant).toBe(true);
        expect(eq[variant].statusFileMismatch, variant).toBe(true);
        expect(eq[variant].postMoveValidateExitCode, variant).toBe(1);
      }
      expect(eq.reordered.retireMoved).toBe(3);
      expect(eq.reordered.f21LeftLive).toBe(false);
      expect(eq.reordered.postMoveValidateExitCode).toBe(0);

      // The payer-map baseline: 73 derived tokens captured post-payment from
      // the real record and real archive; the derivation reads registry rows
      // only, so proseOnlyRoutes is empty and F152/F43 are absent.
      const pm = probes.payerMapBaseline;
      expect(pm.fullTokenCount).toBe(Object.keys(pm.map).length);
      expect(pm.proseOnlyRoutes).toEqual([]);
      expect(pm.map.F152).toBeUndefined();
      expect(pm.map.F43).toBeUndefined();
      expect(pm.map.F161).toBe("C-RECORD-RETIREMENT");
      expect(pm.map.F130).toBe("C-PHASE-RULE-PIN");
      expect(pm.map.F149).toBe("C-APPROVE-TIME-REVIEW");
      expect(pm.map.F150).toBe("C-SCOPE-AUDIT-ATTRIBUTION");
      expect(pm.map.F147).toBe("C-EVIDENCE-DISCRIMINATION");

      // The can-fail demonstration: the base-less diff form cannot fail.
      const cf = probes.canFailDemonstrations;
      expect(cf.cleanTree).toEqual({ baseLess: 0, baseNamed: 0 });
      expect(cf.committedDrift.baseLess).toBe(0);
      expect(cf.committedDrift.baseNamed).toBe(1);
    },
  );

  it("C-RECORD-PARSE shape check: the clean control stays green while each refuse case exits non-zero with its record-shape- code", () => {
    // clean control: the happy fixture has genre elements as direct children
    // of the expected roots and no same-tag nesting
    const clean = isolatedRoot();
    writeHappy(clean);
    expect(runValidatorInProcess(clean).status).toBe(0);

    // wrong root element
    const wrongRoot = isolatedRoot();
    const wrongParts = happyParts();
    wrongParts.findings = `<WrongRoot base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</WrongRoot>
`;
    writeHappy(wrongRoot, wrongParts);
    const wrongResult = runValidatorInProcess(wrongRoot);
    expect(wrongResult.status).not.toBe(0);
    expect(wrongResult.stderr).toContain("record-shape-wrong-root");
    expect(wrongResult.stderr).toContain("expected \u003cFindings\u003e");

    // genre element nested inside a non-root parent
    const nested = isolatedRoot();
    const nestedParts = happyParts();
    nestedParts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Wrapper>
    <Finding id="f1" token="F1" status="live">
      <Title>### F1 — live</Title>
      <Body>body one</Body>
    </Finding>
  </Wrapper>
</Findings>
`;
    writeHappy(nested, nestedParts);
    const nestedResult = runValidatorInProcess(nested);
    expect(nestedResult.status).not.toBe(0);
    expect(nestedResult.stderr).toContain("record-shape-genre-not-direct-child");
    expect(nestedResult.stderr).toContain("<Wrapper>");

    // same-tag descendant among genre elements
    const sameTag = isolatedRoot();
    const sameTagParts = happyParts();
    sameTagParts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
    <Finding id="f1-nested" token="F1" status="live">
      <Title>### F1 nested</Title>
      <Body>body two</Body>
    </Finding>
  </Finding>
</Findings>
`;
    writeHappy(sameTag, sameTagParts);
    const sameTagResult = runValidatorInProcess(sameTag);
    expect(sameTagResult.status).not.toBe(0);
    expect(sameTagResult.stderr).toContain("record-shape-same-tag-nested");
  });

  it(
    "C-PAYMENT-RECORD-4 flush invariant: f204 is exactly once and live in the production record",
    () => {
      // The shipped parser walks both files; the walk over the whole tree is
      // the no-duplicate check, because a second id="f204" anywhere in either
      // tree makes the walk return two.
      const findings = parseGraceXmlArtifact(
        "findings.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"),
      );
      const decisions = parseGraceXmlArtifact(
        "decisions.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"),
      );
      expect(findings.root, "findings.xml parses").not.toBeNull();
      expect(decisions.root, "decisions.xml parses").not.toBeNull();
      const findingsF204 = [...walkNodes(findings.root!)].filter(
        (node) => node.tag === "Finding" && node.attributes.id === "f204",
      );
      const decisionsF204 = [...walkNodes(decisions.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === "f204",
      );
      expect(
        findingsF204.length,
        `findings.xml: exactly one Finding with id="f204" (got ${findingsF204.length})`,
      ).toBe(1);
      expect(
        decisionsF204.length,
        `decisions.xml: exactly one Entry with id="f204" (duplicate would walk two)`,
      ).toBe(1);
      expect(
        findingsF204[0]!.attributes.status,
        "the f204 Finding is live",
      ).toBe("live");
      expect(
        decisionsF204[0]!.attributes.layer,
        "the f204 Entry is live",
      ).toBe("live");
    },
  );

  it(
    "C-PAYMENT-RECORD-4 roots invariant: every live root satisfies base + headroom = ceiling and base equals its shipped metric read back",
    () => {
      for (const file of ["findings.xml", "registry.xml", "decisions.xml", "rulings.xml"] as const) {
        const text = readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8");
        const parsed = parseGraceXmlArtifact(file, text);
        expect(parsed.root, `${file} parses`).not.toBeNull();
        const root = parsed.root!;
        const base = Number(root.attributes.base);
        const headroom = Number(root.attributes.headroom);
        const ceiling = Number(root.attributes.ceiling);
        expect(
          Number.isFinite(base) && Number.isFinite(headroom) && Number.isFinite(ceiling),
          `${file}: base, headroom and ceiling are numeric`,
        ).toBe(true);
        expect(
          base + headroom,
          `${file}: base + headroom = ceiling`,
        ).toBe(ceiling);
        // The shipped metric read back from the file: the liveRowCount
        // rule — direct Row children whose status is not retired — over
        // the shipped parser for registry (the rule is mirrored,
        // liveRowCount itself is not exported).
        // decisions.xml joins the live-entry metric — direct Entry
        // children whose layer is not retired, mirroring the registry
        // rule (C-INDEX-METRIC-2); newlineCount (whole-file lines)
        // keeps governing findings and rulings.
        const metric = file === "registry.xml"
          ? childNodes(root, "Row").filter((row) => row.attributes.status !== "retired").length
          : file === "decisions.xml"
            ? childNodes(root, "Entry").filter((entry) => entry.attributes.layer !== "retired").length
            : newlineCount(text);
        expect(base, `${file}: base equals its shipped metric read back`).toBe(metric);
      }
    },
  );

  it(
    "C-PAYMENT-RECORD-4 retired-layer invariant: every retired Finding carries a PaidBy that matches its derived payer and names an archive directory",
    () => {
      // The same row collection the payer-derivation test builds: direct Row
      // children of both registry layers whose kind is chartered or
      // historical; derivePayerMap gates on real archive membership.
      const rows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        expect(parsed.root, file).not.toBeNull();
        for (const row of parsed.root!.children.filter((child) => child.tag === "Row")) {
          const kind = row.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          rows.push({
            name: row.attributes.name ?? "",
            pays: childText(row, "Pays") ?? "",
            statusText: childText(row, "StatusText") ?? "",
          });
        }
      }
      const derived = derivePayerMap(REPO_ROOT, rows);
      const archiveNames = listArchiveNames(REPO_ROOT);
      const retired = parseGraceXmlArtifact(
        "findings-retired.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"),
      );
      expect(retired.root, "findings-retired.xml parses").not.toBeNull();
      const retiredFindings = [...walkNodes(retired.root!)].filter(
        (node) => node.tag === "Finding",
      );
      expect(
        retiredFindings.length,
        "the retired layer is non-empty",
      ).toBeGreaterThan(0);
      for (const finding of retiredFindings) {
        const token = finding.attributes.token ?? "";
        const paidBy = childText(finding, "PaidBy");
        expect(paidBy, `${token}: every retired Finding carries a PaidBy child`).toBeDefined();
        expect(
          (paidBy ?? "").trim().length,
          `${token}: PaidBy is non-empty`,
        ).toBeGreaterThan(0);
        // The equality stays conditional on a derived payer existing: the
        // shipped derivation is rows-only, so a retired Finding whose token
        // no row derives (a prose-pass relic) keeps its stored stamp honest
        // via the archive-membership check below and is never compared.
        const derivedPayer = derived.get(token);
        if (derivedPayer !== undefined) {
          expect(paidBy, `${token}: stored PaidBy equals the derived row-route payer`).toBe(
            derivedPayer,
          );
        }
        expect(
          archiveNames.has(paidBy!),
          `${token}: PaidBy names a real archive directory`,
        ).toBe(true);
      }
    },
  );

  it(
    "C-FLUSH-AND-UNPIN flush invariant: every flushed id is exactly once across the findings pair with its status agreeing with the holding file and its index Entry layer and genre agreeing",
    () => {
      // The walk over both whole trees is the duplicate check: a second
      // id anywhere in either tree makes the walk return two. No fixed
      // expectation of which file holds a flushed id — the relation
      // survives the record's own payment cycle by construction.
      const flushed = ["f225", "f226", "f227", "f228", "f229", "f231", "f232"];
      const liveParsed = parseGraceXmlArtifact(
        "findings.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"),
      );
      const retiredParsed = parseGraceXmlArtifact(
        "findings-retired.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"),
      );
      const indexParsed = parseGraceXmlArtifact(
        "decisions.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"),
      );
      expect(liveParsed.root, "findings.xml parses").not.toBeNull();
      expect(retiredParsed.root, "findings-retired.xml parses").not.toBeNull();
      expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
      for (const id of flushed) {
        const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
          const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
          return [...walkNodes(parsed.root!)]
            .filter((node) => node.tag === "Finding" && node.attributes.id === id)
            .map((node) => ({ file, node }));
        });
        expect(
          carriers.length,
          `${id}: exactly one Finding element across the findings pair (got ${carriers.length})`,
        ).toBe(1);
        const { file, node } = carriers[0]!;
        const expectedStatus = file === "findings.xml" ? "live" : "retired";
        expect(
          node.attributes.status,
          `${id}: the carrier's status agrees with the holding file (${file})`,
        ).toBe(expectedStatus);
        expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`F${id.slice(1)}`);
        const entries = [...walkNodes(indexParsed.root!)].filter(
          (entry) => entry.tag === "Entry" && entry.attributes.id === id,
        );
        expect(entries.length, `${id}: exactly one Entry for the id (duplicate would walk two)`).toBe(1);
        expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("finding");
        expect(
          entries[0]!.attributes.layer,
          `${id}: the Entry's layer agrees with the holding file`,
        ).toBe(expectedStatus);
      }
      // The read-back arithmetic, exactly as the shipped roots-invariant
      // test uses the exported newlineCount: base equals the whole-file
      // line count read back, and base + headroom = ceiling.
      const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
      const findingsRoot = parseGraceXmlArtifact("findings.xml", findingsText).root!;
      const base = Number(findingsRoot.attributes.base);
      const headroom = Number(findingsRoot.attributes.headroom);
      const ceiling = Number(findingsRoot.attributes.ceiling);
      expect(base, "findings.xml: base equals the file's newlineCount").toBe(newlineCount(findingsText));
      expect(base + headroom, "findings.xml: base + headroom = ceiling").toBe(ceiling);
    },
  );

  it(
    "C-FLUSH-AND-UNPIN payment invariant: the row is exactly once across the registry layers with its derived payment set exactly F232, and an F232 carrier, when one exists, is a single element consistent with its holding file",
    () => {
      const tokenRe = /\bF\d+(?:\.\d+)*\b/g;
      // Exactly once across both registry layers (the walk over both whole
      // trees is the duplicate check), kind="chartered", with the row's
      // status agreeing with the holding file — no fixed expectation of
      // which file that is; the relation survives the close's move.
      const rows: Array<{ file: string; node: ReturnType<typeof parseGraceXmlArtifact>["root"] extends (infer T) | null ? T : never }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"] as const) {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        expect(parsed.root, `${file} parses`).not.toBeNull();
        for (const row of [...walkNodes(parsed.root!)].filter(
          (node) => node.tag === "Row" && node.attributes.name === "C-FLUSH-AND-UNPIN",
        )) {
          rows.push({ file, node: row });
        }
      }
      expect(
        rows.length,
        `exactly one Row named C-FLUSH-AND-UNPIN across the registry layers (got ${rows.length})`,
      ).toBe(1);
      const row = rows[0]!;
      expect(row.node.attributes.kind, `the row is kind="chartered"`).toBe("chartered");
      expect(
        row.node.attributes.status,
        `the row's status agrees with the holding file (${row.file})`,
      ).toBe(row.file === "registry.xml" ? "live" : "retired");
      // The Pays cell names exactly F232 and no other token.
      const pays = childText(row.node, "Pays") ?? "";
      const paysTokens = [...new Set(pays.match(tokenRe) ?? [])];
      expect(paysTokens, "the row's Pays cell names exactly F232 and no other token").toEqual(["F232"]);
      const statusText = childText(row.node, "StatusText") ?? "";
      expect(
        statusText.match(tokenRe) ?? [],
        `the row's StatusText carries no F token at all`,
      ).toEqual([]);
      // The isolated fixture mirrors the real membership the claim needs:
      // an archive root containing only the row's name, with the row's own
      // Pays and StatusText — the derivation mints exactly F232 for this
      // payer. The production archive is never written by any test.
      const isolatedRepo = isolatedRoot();
      mkdirSync(path.join(isolatedRepo, ".ngrace", "changes", "archive", "C-FLUSH-AND-UNPIN"), { recursive: true });
      const isolatedMap = derivePayerMap(isolatedRepo, [
        { name: "C-FLUSH-AND-UNPIN", pays, statusText },
      ]);
      expect([...isolatedMap.entries()], "the isolated derivation mints exactly F232 for C-FLUSH-AND-UNPIN").toEqual([
        ["F232", "C-FLUSH-AND-UNPIN"],
      ]);
      // The real derivation over the real archive and both registry layers:
      // F232, if minted at all, is minted by C-FLUSH-AND-UNPIN — green
      // with the row live (nothing minted) and in the applied-archive
      // state (the close's mint); the row is this payer's only mint.
      const realRows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"] as const) {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        for (const candidate of parsed.root!.children.filter((child) => child.tag === "Row")) {
          const kind = candidate.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          realRows.push({
            name: candidate.attributes.name ?? "",
            pays: childText(candidate, "Pays") ?? "",
            statusText: childText(candidate, "StatusText") ?? "",
          });
        }
      }
      const derived = derivePayerMap(REPO_ROOT, realRows);
      const payer = derived.get("F232");
      if (payer !== undefined) {
        expect(payer, `F232: minted, if at all, by C-FLUSH-AND-UNPIN`).toBe("C-FLUSH-AND-UNPIN");
      }
      for (const [minted, mintPayer] of derived) {
        if (mintPayer === "C-FLUSH-AND-UNPIN") {
          expect(minted, `every C-FLUSH-AND-UNPIN mint is F232`).toBe("F232");
        }
      }
      // An F232 carrier, when one exists, exists at most once across the
      // findings pair; a carrier held by the retired file is status="retired"
      // with a PaidBy C-FLUSH-AND-UNPIN child and its index Entry layer
      // agreeing with the holding file. The live pre-close case stays green —
      // the clause pins nothing live and asserts nothing absent.
      const indexParsed = parseGraceXmlArtifact(
        "decisions.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"),
      );
      expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        return [...walkNodes(parsed.root!)]
          .filter((node) => node.tag === "Finding" && node.attributes.token === "F232")
          .map((node) => ({ file, node }));
      });
      expect(
        carriers.length,
        `at most one Finding element carries F232 across the two findings files (got ${carriers.length})`,
      ).toBeLessThanOrEqual(1);
      for (const carrier of carriers) {
        const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
        expect(
          carrier.node.attributes.status,
          `F232: the carrier's status agrees with the holding file (${carrier.file})`,
        ).toBe(expectedStatus);
        if (carrier.file === "findings-retired.xml") {
          expect(
            childText(carrier.node, "PaidBy"),
            `F232: a retired carrier carries PaidBy C-FLUSH-AND-UNPIN`,
          ).toBe("C-FLUSH-AND-UNPIN");
        }
        const entries = [...walkNodes(indexParsed.root!)].filter(
          (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
        );
        expect(entries.length, `F232: the index carries exactly one Entry for the carrier's id`).toBe(1);
        expect(
          entries[0]!.attributes.layer,
          `F232: the carrier's index Entry layer agrees with the holding file`,
        ).toBe(expectedStatus);
      }
      // A read-only production run of the shipped validator: zero findings
      // on the production record, and every record byte unchanged by the call.
      const recordFiles = [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
      ];
      const before = new Map(
        recordFiles.map((file) => [file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8")]),
      );
      const production = validateRecordRetirement({
        repoRoot: REPO_ROOT,
        recordDir: path.join(REPO_ROOT, RECORD_REL),
      });
      expect(production, "the shipped validator returns zero findings on the production record").toEqual([]);
      for (const file of recordFiles) {
        const expected = before.get(file);
        if (expected === undefined) throw new Error(`${file}: missing pre-run snapshot`);
        expect(
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
          `${file}: the production run is read-only`,
        ).toBe(expected);
      }
    },
  );

  it(
    "C-INDEX-METRIC-2 live-entry metric: an index whose whole-file line count exceeds its persisted ceiling while its live Entry count does not validates clean",
    () => {
      const root = isolatedRoot();
      const parts = happyParts();
      // Two live entries (f1, d1 — f2 is retired) against a ceiling of 12,
      // with five blank lines between the Entry elements: 15 whole-file
      // lines, above the ceiling — the exact shape the shipped line metric
      // rejects and the live-Entry metric accepts.
      parts.index = `<RecordIndex base="10" headroom="40" ceiling="12">
  <Entry id="f1" token="F1" genre="finding" layer="live" />





  <Entry id="f2" token="F2" genre="finding" layer="retired" />





  <Entry id="d1" token="D1" genre="decision" layer="live" />





</RecordIndex>
`;
      writeHappy(root, parts);
      expect(newlineCount(parts.index), "the fixture's line count exceeds the ceiling").toBeGreaterThan(12);
      const result = runValidatorInProcess(root);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    },
  );

  it(
    "C-INDEX-METRIC-2 live-entry metric: an index whose live Entry count exceeds its persisted ceiling exits non-zero with ceiling-exceeded",
    () => {
      const root = isolatedRoot();
      const parts = happyParts();
      // Two live entries (f1, d1) against a ceiling of 1: breached under
      // the live-Entry metric and under the shipped line metric alike.
      parts.index = `<RecordIndex base="10" headroom="40" ceiling="1">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`;
      writeHappy(root, parts);
      const result = runValidatorInProcess(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ceiling-exceeded");
      expect(result.stderr).toContain("live index live-entry count 2 exceeds persisted ceiling 1");
    },
  );

  it(
    "C-INDEX-METRIC-2 index ceiling breach names the index flip mechanic, never a config key",
    () => {
      const root = isolatedRoot();
      const parts = happyParts();
      parts.index = `<RecordIndex base="10" headroom="40" ceiling="1">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`;
      writeHappy(root, parts);
      const result = runValidatorInProcess(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ceiling-exceeded");
      expect(result.stderr).toContain("live index live-entry count");
      expect(result.stderr).toContain("--retire");
      expect(result.stderr).toContain(
        "the eligible entries flip their index Entry layer to retired in place",
      );
      expect(result.stderr).toContain(
        "the index has no retired sibling and its Entry lines stay",
      );
      expect(result.stderr).toContain("Raising the persisted ceiling is not the remedy");
      expect(result.stderr.toLowerCase()).not.toContain("config key");
      expect(result.stderr).not.toContain("ignoredDirs");
    },
  );

  it(
    "C-INDEX-METRIC-2 the findings-genre breach message is unchanged: it names the retired-sibling move",
    () => {
      const root = isolatedRoot();
      const parts = happyParts();
      parts.findings = `<Findings base="1" headroom="0" ceiling="1">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
</Findings>
`;
      writeHappy(root, parts);
      const result = runValidatorInProcess(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ceiling-exceeded");
      expect(result.stderr).toContain("move the eligible entry to the retired sibling");
      expect(result.stderr).not.toContain("flip their index Entry layer");
    },
  );

  it(
    "C-INDEX-METRIC-2 --split computes the index base in the live-Entry unit behind INDEX_HEADROOM_ENTRIES",
    () => {
      const fixtureRoot = isolatedRoot();
      const dump = `# RM-GOVERNED-PATH record stub

The parseable citation index is [./decisions.xml](./decisions.xml).

<a id="f1" name="F1"></a>
### F1 — first finding

body of the finding.

<a id="d1" name="D1"></a>
## D1 — decision one

body of the decision.
`;
      plant(fixtureRoot, `${RECORD_REL}/decisions.md`, dump);
      const result = runValidatorInProcess(fixtureRoot, ["--split"]);
      expect(result.status, `${result.stderr}`).toBe(0);
      const written = readFileSync(
        path.join(fixtureRoot, RECORD_REL, "decisions.xml"),
        "utf8",
      );
      const parsed = parseGraceXmlArtifact("decisions.xml", written);
      expect(parsed.root, "the written index parses").not.toBeNull();
      const root = parsed.root!;
      const liveEntries = childNodes(root, "Entry").filter(
        (entry) => entry.attributes.layer !== "retired",
      ).length;
      expect(liveEntries, "the minimal dump carries two live entries").toBe(2);
      expect(root.attributes.base, "base equals the live-Entry count read back").toBe(
        String(liveEntries),
      );
      expect(Number(root.attributes.headroom), "headroom equals the shipped constant").toBe(
        INDEX_HEADROOM_ENTRIES,
      );
      expect(Number(root.attributes.ceiling), "ceiling equals base + headroom").toBe(
        Number(root.attributes.base) + Number(root.attributes.headroom),
      );
    },
  );

  it(
    "C-FLUSH-AND-REPAIR repaired flush invariant: f205 through f220 each exist exactly once across the findings files with the index layer agreeing with the holding file — no fixed expectation of which file that is; f205's paid state is the durable pin",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const liveXml = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const retiredXml = readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8");
      const indexXml = readFileSync(path.join(recordDir, "decisions.xml"), "utf8");
      const liveParsed = parseGraceXmlArtifact("findings.xml", liveXml);
      const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", retiredXml);
      const indexParsed = parseGraceXmlArtifact("decisions.xml", indexXml);
      const liveFindings = [...walkNodes(liveParsed.root!)].filter((n) => n.tag === "Finding");
      const retiredFindings = [...walkNodes(retiredParsed.root!)].filter((n) => n.tag === "Finding");
      const entries = childNodes(indexParsed.root!, "Entry");
      const flushed = ["f205", "f206", "f207", "f208", "f209", "f210", "f211", "f212", "f213", "f214", "f215", "f216", "f217", "f218", "f219", "f220"];
      for (const id of flushed) {
        const inLive = liveFindings.filter((n) => n.attributes.id === id);
        const inRetired = retiredFindings.filter((n) => n.attributes.id === id);
        expect(
          inLive.length + inRetired.length,
          `${id}: exactly one Finding element across both findings files — the walk is the duplicate check`,
        ).toBe(1);
        const holder = inLive.length === 1 ? inLive[0]! : inRetired[0]!;
        expect(holder.attributes.status, `${id}: status agrees with the holding file`).toBe(inLive.length === 1 ? "live" : "retired");
        expect(holder.attributes.token, `${id}: token matches`).toBe(id.toUpperCase());
        const entry = entries.filter((e) => e.attributes.id === id);
        expect(entry.length, `${id}: exactly one matching decisions.xml Entry`).toBe(1);
        expect(entry[0]!.attributes.layer, `${id}: index layer agrees with the holding file`).toBe(
          inLive.length === 1 ? "live" : "retired",
        );
        if (id === "f205") {
          expect(inLive.length, "f205's paid state is the durable pin — held by the retired file").toBe(0);
          expect(holder.attributes.status, "f205's paid state is the durable pin — f205 is retired").toBe("retired");
          expect(entry[0]!.attributes.layer, "f205's paid state is the durable pin — the f205 Entry layer is retired").toBe("retired");
        }
      }
      // read-back arithmetic: the written base comes from the file's newlineCount
      const root = liveParsed.root!;
      const base = newlineCount(liveXml);
      expect(Number(root.attributes.base), "findings base equals the file's newlineCount read back").toBe(base);
      expect(
        Number(root.attributes.headroom),
        "findings headroom equals ceiling minus base",
      ).toBe(Number(root.attributes.ceiling) - base);
    },
  );

  it(
    "C-FLUSH-AND-PAY payment invariant: the C-INDEX-METRIC-2 row is retired with a derived payment set of exactly F205, and f205 is not live",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const liveRegistryXml = readFileSync(path.join(recordDir, "registry.xml"), "utf8");
      const retiredRegistryXml = readFileSync(path.join(recordDir, "registry-retired.xml"), "utf8");
      const name = "C-INDEX-METRIC-2";
      const liveRows = childNodes(parseGraceXmlArtifact("registry.xml", liveRegistryXml).root!, "Row").filter(
        (row) => row.attributes.name === name,
      );
      expect(liveRows.length, "no live row carries the name").toBe(0);
      const retiredRows = childNodes(parseGraceXmlArtifact("registry-retired.xml", retiredRegistryXml).root!, "Row").filter(
        (row) => row.attributes.name === name,
      );
      expect(retiredRows.length, "exactly one retired row carries the name").toBe(1);
      const row = retiredRows[0]!;
      expect(row.attributes.status, "the row is retired").toBe("retired");
      expect(row.attributes.kind, "the row is chartered").toBe("chartered");
      // F212: the isolated archive root mirrors the real archive membership this claim needs
      const isolatedRepo = isolatedRoot();
      mkdirSync(path.join(isolatedRepo, ".ngrace", "changes", "archive", name), { recursive: true });
      const isolatedRows = [
        {
          name,
          pays: childText(row, "Pays") ?? "",
          statusText: childText(row, "StatusText") ?? "",
        },
      ];
      const isolatedMap = derivePayerMap(isolatedRepo, isolatedRows);
      expect([...isolatedMap.keys()], "the row's derived payment set is exactly F205").toEqual(["F205"]);
      // the production derivation over the real archive and both registry layers
      const productionRows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
        for (const candidate of childNodes(parsed.root!, "Row")) {
          const kind = candidate.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          productionRows.push({
            name: candidate.attributes.name ?? "",
            pays: childText(candidate, "Pays") ?? "",
            statusText: childText(candidate, "StatusText") ?? "",
          });
        }
      }
      const productionMap = derivePayerMap(REPO_ROOT, productionRows);
      expect(productionMap.get("F205"), "the production map names F205 with this payer").toBe(name);
      // f205 is not live; the retired copy carries the move's PaidBy stamp
      const liveFindingsXml = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const retiredFindingsXml = readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8");
      const liveFindings = [...walkNodes(parseGraceXmlArtifact("findings.xml", liveFindingsXml).root!)].filter(
        (n) => n.tag === "Finding",
      );
      expect(
        liveFindings.filter((n) => n.attributes.token === "F205").length,
        "no live Finding carries token F205",
      ).toBe(0);
      const retiredFindings = [...walkNodes(parseGraceXmlArtifact("findings-retired.xml", retiredFindingsXml).root!)].filter(
        (n) => n.tag === "Finding" && n.attributes.id === "f205",
      );
      expect(retiredFindings.length, "exactly one retired Finding carries id f205").toBe(1);
      const f205 = retiredFindings[0]!;
      expect(f205.attributes.status, "f205 is retired").toBe("retired");
      expect(childText(f205, "PaidBy"), "PaidBy names the archive event the move stamped").toBe(name);
      // the index Entry flipped in place
      const f205Entries = childNodes(parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(recordDir, "decisions.xml"), "utf8")).root!, "Entry").filter(
        (e) => e.attributes.id === "f205",
      );
      expect(f205Entries.length, "exactly one f205 Entry").toBe(1);
      expect(f205Entries[0]!.attributes.layer, "the f205 Entry layer is retired").toBe("retired");
      expect(f205Entries[0]!.attributes.token, "the f205 Entry token is F205").toBe("F205");
    },
  );

  it(
    "C-FLUSH-AND-PAY production invariant: the shipped validateRecordRetirement returns zero findings on the production record, and the same call reports planted eligibility on a mutated copy",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const findingsBefore = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const production = validateRecordRetirement({ repoRoot: REPO_ROOT, recordDir });
      expect(production, "the shipped validator returns zero findings on the production record").toEqual([]);
      expect(readFileSync(path.join(recordDir, "findings.xml"), "utf8"), "the call is read-only over production").toBe(findingsBefore);
      // the demonstrated red direction: a mutated copy with a live F205 Finding replanted
      const mutatedRoot = isolatedRoot();
      const recordCopy = path.join(mutatedRoot, RECORD_REL);
      mkdirSync(recordCopy, { recursive: true });
      // F212: the copy's repoRoot carries the paying archive event, mirroring the real membership
      // the eligibility check needs — the shipped derivation gates on archive membership.
      mkdirSync(path.join(mutatedRoot, ".ngrace", "changes", "archive", "C-INDEX-METRIC-2"), { recursive: true });
      for (const file of ["findings.xml", "findings-retired.xml", "rulings.xml", "rulings-retired.xml", "registry.xml", "registry-retired.xml", "decisions.xml"]) {
        writeFileSync(path.join(recordCopy, file), readFileSync(path.join(recordDir, file), "utf8"));
      }
      const retiredCopy = readFileSync(path.join(recordCopy, "findings-retired.xml"), "utf8");
      const f205Block = retiredCopy.match(/<Finding id="f205"[\s\S]*?<\/Finding>/)?.[0] ?? "";
      expect(f205Block.length > 0, "the retired f205 element exists to replant").toBe(true);
      const replanted = f205Block.replace('status="retired"', 'status="live"');
      const liveCopy = readFileSync(path.join(recordCopy, "findings.xml"), "utf8");
      writeFileSync(
        path.join(recordCopy, "findings.xml"),
        liveCopy.replace("</Findings>", `${replanted}\n</Findings>`),
      );
      const mutated = validateRecordRetirement({ repoRoot: mutatedRoot, recordDir: recordCopy });
      expect(
        mutated.filter((f) => f.code === "finding-eligible-still-live" && f.message.includes('id="f205"')).length,
        "the same call reports planted eligibility on the mutated copy",
      ).toBe(1);
    },
  );

  it(
    "C-FLUSH-AND-REPAIR flush invariant: f221, f222, f223, f224 and d37 each exist exactly once across their genre pair with status and index layer agreeing with the holding file — no fixed expectation of which file that is",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const liveFindingsXml = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const retiredFindingsXml = readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8");
      const liveRulingsXml = readFileSync(path.join(recordDir, "rulings.xml"), "utf8");
      const retiredRulingsXml = readFileSync(path.join(recordDir, "rulings-retired.xml"), "utf8");
      const indexXml = readFileSync(path.join(recordDir, "decisions.xml"), "utf8");
      const liveFindings = [...walkNodes(parseGraceXmlArtifact("findings.xml", liveFindingsXml).root!)].filter((n) => n.tag === "Finding");
      const retiredFindings = [...walkNodes(parseGraceXmlArtifact("findings-retired.xml", retiredFindingsXml).root!)].filter((n) => n.tag === "Finding");
      const liveDecisions = childNodes(parseGraceXmlArtifact("rulings.xml", liveRulingsXml).root!, "Decision");
      const retiredDecisions = childNodes(parseGraceXmlArtifact("rulings-retired.xml", retiredRulingsXml).root!, "Decision");
      const entries = childNodes(parseGraceXmlArtifact("decisions.xml", indexXml).root!, "Entry");
      const agree = (
        id: string,
        inLive: typeof liveFindings,
        inRetired: typeof retiredFindings,
        token: string,
        genre: string,
      ) => {
        expect(
          inLive.length + inRetired.length,
          `${id}: exactly one element across the genre pair — the walk is the duplicate check`,
        ).toBe(1);
        const holder = inLive.length === 1 ? inLive[0]! : inRetired[0]!;
        expect(holder.attributes.status, `${id}: status agrees with the holding file`).toBe(
          inLive.length === 1 ? "live" : "retired",
        );
        expect(holder.attributes.token, `${id}: token matches`).toBe(token);
        const entry = entries.filter((e) => e.attributes.id === id);
        expect(entry.length, `${id}: exactly one matching decisions.xml Entry`).toBe(1);
        expect(entry[0]!.attributes.layer, `${id}: index layer agrees with the holding file`).toBe(
          inLive.length === 1 ? "live" : "retired",
        );
        expect(entry[0]!.attributes.genre, `${id}: index genre agrees`).toBe(genre);
      };
      for (const id of ["f221", "f222", "f223", "f224"]) {
        agree(
          id,
          liveFindings.filter((n) => n.attributes.id === id),
          retiredFindings.filter((n) => n.attributes.id === id),
          id.toUpperCase(),
          "finding",
        );
      }
      agree(
        "d37",
        liveDecisions.filter((n) => n.attributes.id === "d37"),
        retiredDecisions.filter((n) => n.attributes.id === "d37"),
        "D37",
        "decision",
      );
      // read-back arithmetic: the written base comes from the file's newlineCount
      const findingsRoot = parseGraceXmlArtifact("findings.xml", liveFindingsXml).root!;
      const findingsBase = newlineCount(liveFindingsXml);
      expect(Number(findingsRoot.attributes.base), "findings base equals the file's newlineCount read back").toBe(findingsBase);
      expect(
        Number(findingsRoot.attributes.headroom),
        "findings headroom equals ceiling minus base",
      ).toBe(Number(findingsRoot.attributes.ceiling) - findingsBase);
      const rulingsRoot = parseGraceXmlArtifact("rulings.xml", liveRulingsXml).root!;
      const rulingsBase = newlineCount(liveRulingsXml);
      expect(Number(rulingsRoot.attributes.base), "rulings base equals the file's newlineCount read back").toBe(rulingsBase);
      expect(
        Number(rulingsRoot.attributes.headroom),
        "rulings headroom equals ceiling minus base",
      ).toBe(Number(rulingsRoot.attributes.ceiling) - rulingsBase);
    },
  );

  it(
    "C-FLUSH-AND-REPAIR payment absence: the shipped derivation mints nothing to C-FLUSH-AND-REPAIR (the bundle pays nothing), the production validator returns zero findings read-only, and a planted row over an isolated root mints its token",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const stagedTokens = ["F221", "F222", "F223", "F224", "D37"];
      const productionRows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
        for (const candidate of childNodes(parsed.root!, "Row")) {
          const kind = candidate.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          productionRows.push({
            name: candidate.attributes.name ?? "",
            pays: childText(candidate, "Pays") ?? "",
            statusText: childText(candidate, "StatusText") ?? "",
          });
        }
      }
      const productionMap = derivePayerMap(REPO_ROOT, productionRows);
      // payment-invariant: this bundle pays nothing; other bundles may later
      // pay these tokens (F225's class, payer-map dimension)
      const allRegistryRowNames: string[] = [];
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
        for (const candidate of childNodes(parsed.root!, "Row")) {
          allRegistryRowNames.push(candidate.attributes.name ?? "");
        }
      }
      expect(
        allRegistryRowNames,
        'no Row in either registry layer carries name="C-FLUSH-AND-REPAIR"',
      ).not.toContain("C-FLUSH-AND-REPAIR");
      for (const [token, payer] of productionMap) {
        expect(
          payer,
          `${token}: the production payer map does not name C-FLUSH-AND-REPAIR as payer`,
        ).not.toBe("C-FLUSH-AND-REPAIR");
      }
      // the read-only production run of the shipped validator, folded in:
      const findingsBefore = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const production = validateRecordRetirement({ repoRoot: REPO_ROOT, recordDir });
      expect(production, "the shipped validator returns zero findings on the production record").toEqual([]);
      expect(readFileSync(path.join(recordDir, "findings.xml"), "utf8"), "the call is read-only over production").toBe(findingsBefore);
      // the discriminating direction: a planted row over an isolated archive root mints its token
      const isolatedRepo = isolatedRoot();
      mkdirSync(path.join(isolatedRepo, ".ngrace", "changes", "archive", "C-FLUSH-PROBE-ROW"), { recursive: true });
      const isolatedMap = derivePayerMap(isolatedRepo, [{ name: "C-FLUSH-PROBE-ROW", pays: "F222", statusText: "" }]);
      expect(
        stagedTokens.filter((token) => isolatedMap.has(token)),
        "the planted row's token mints over the isolated archive root — the derivation is not vacuously empty",
      ).toEqual(["F222"]);
    },
  );


  it(
    "C-ROOT-WINDOW row invariant: the C-ROOT-WINDOW row exists exactly once across the registry layers with its status agreeing with the holding file, kind chartered, Pays exactly F216, F182, F193, F190, F225, F226 in that order, and a StatusText carrying no F token and no Closed-with sentence — no fixed expectation of which file that is",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const layers: Array<[string, string]> = [
        ["registry.xml", "live"],
        ["registry-retired.xml", "retired"],
      ];
      const hits: Array<{ file: string; status: string; kind: string; pays: string; statusText: string }> = [];
      for (const [file] of layers) {
        const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
        expect(parsed.root, `${file} parses`).not.toBeNull();
        for (const row of childNodes(parsed.root!, "Row")) {
          if (row.attributes.name !== "C-ROOT-WINDOW") {
            continue;
          }
          hits.push({
            file,
            status: row.attributes.status ?? "",
            kind: row.attributes.kind ?? "",
            pays: (childText(row, "Pays") ?? "").trim(),
            statusText: childText(row, "StatusText") ?? "",
          });
        }
      }
      expect(
        hits.length,
        `the C-ROOT-WINDOW row exists exactly once across the registry layers — the walk is the duplicate check (got ${hits.length})`,
      ).toBe(1);
      const hit = hits[0]!;
      const holding = hit.file === "registry.xml" ? "live" : "retired";
      expect(hit.status, "the row's status agrees with the holding file").toBe(holding);
      expect(hit.kind, "the row is chartered").toBe("chartered");
      expect(hit.pays, "Pays names exactly the six tokens in that order").toBe("F216 F182 F193 F190 F225 F226");
      expect(hit.statusText, "StatusText names no F token").not.toMatch(/\bF[0-9]/);
      expect(/closed with/i.test(hit.statusText), "StatusText carries no Closed-with sentence").toBe(false);
      // the named red-making mutation, driven on a mutated copy — never
      // against the production record: a second row with the same name
      // reddens the exactly-once clause. The duplicate is planted into
      // whichever file the production walk found the row in, so the probe
      // holds in the pre-close and the applied-archive state alike, and
      // the mutated copy is expected to read the pre-mutation count plus
      // one — the exactly-once clause above has already proven that count
      // is 1, so the expectation is the pinned 2, and the probe still
      // reds on a real second row even if the clause itself is neutered.
      const holdingFile = hit.file;
      const holdingXml = readFileSync(path.join(recordDir, holdingFile), "utf8");
      const mutated = holdingXml.replace(
        "</Registry>",
        `  <Row name="C-ROOT-WINDOW" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F216</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
      );
      const mutatedParsed = parseGraceXmlArtifact(holdingFile, mutated);
      const mutatedCount = childNodes(mutatedParsed.root!, "Row").filter(
        (row) => row.attributes.name === "C-ROOT-WINDOW",
      ).length;
      expect(mutatedCount, "the mutated copy reddens the exactly-once clause").toBe(2);
    },
  );

  it(
    "C-ROOT-WINDOW payment invariant: the derived payer map's C-ROOT-WINDOW entries, when any exist, are exactly within the row's six tokens, and each F225/F226 carrier, when one exists, is a single retired C-ROOT-WINDOW-stamped Finding whose index Entry layer agrees with its holding file",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const productionRows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
        for (const candidate of childNodes(parsed.root!, "Row")) {
          const kind = candidate.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          productionRows.push({
            name: candidate.attributes.name ?? "",
            pays: childText(candidate, "Pays") ?? "",
            statusText: childText(candidate, "StatusText") ?? "",
          });
        }
      }
      const derived = derivePayerMap(REPO_ROOT, productionRows);
      const six = ["F216", "F182", "F193", "F190", "F225", "F226"];
      // every C-ROOT-WINDOW mint, when any exist, is within the row's six
      // tokens — green with the row live (nothing minted) and in the
      // applied-archive state (the six minted); each token, if minted at all,
      // is minted by this row and no other
      for (const token of six) {
        const payer = derived.get(token);
        if (payer !== undefined) {
          expect(payer, `${token}: minted, if at all, by C-ROOT-WINDOW`).toBe("C-ROOT-WINDOW");
        }
      }
      for (const [token, payer] of derived) {
        if (payer === "C-ROOT-WINDOW") {
          expect(six, `${token}: every C-ROOT-WINDOW mint is within the row's six tokens`).toContain(token);
        }
      }
      // The payment-invariant relation the record's own cycle keeps true:
      // a carrier of F225 or F226, when one exists, exists at most once
      // across the two findings files, is held by the retired file, is
      // status="retired", carries PaidBy C-ROOT-WINDOW, and its index
      // Entry layer agrees with the holding file; the absent case stays
      // green — the relation survives the flush and every later move.
      const indexForCarriers = parseGraceXmlArtifact(
        "decisions.xml",
        readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
      );
      for (const token of ["F225", "F226"]) {
        const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
          const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
          return [...walkNodes(parsed.root!)]
            .filter((node) => node.tag === "Finding" && node.attributes.token === token)
            .map((node) => ({ file, node }));
        });
        expect(
          carriers.length,
          `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
        ).toBeLessThanOrEqual(1);
        for (const carrier of carriers) {
          expect(carrier.file, `${token}: a carrier is held by the retired file`).toBe("findings-retired.xml");
          expect(carrier.node.attributes.status, `${token}: a carrier is status="retired"`).toBe("retired");
          expect(
            childText(carrier.node, "PaidBy"),
            `${token}: a carrier carries PaidBy C-ROOT-WINDOW`,
          ).toBe("C-ROOT-WINDOW");
          const entries = [...walkNodes(indexForCarriers.root!)].filter(
            (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
          );
          expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
          const holdingLayer = carrier.file === "findings.xml" ? "live" : "retired";
          expect(
            entries[0]!.attributes.layer,
            `${token}: the carrier's index Entry layer agrees with the holding file`,
          ).toBe(holdingLayer);
        }
      }
      // the discriminating direction: the mechanism is not vacuously empty —
      // a planted archived row over an isolated archive root mints its token
      const isolatedRepo = isolatedRoot();
      mkdirSync(path.join(isolatedRepo, ".ngrace", "changes", "archive", "C-ROOT-WINDOW"), { recursive: true });
      const isolatedMap = derivePayerMap(isolatedRepo, [{ name: "C-ROOT-WINDOW", pays: "F226", statusText: "" }]);
      expect(isolatedMap.get("F226"), "the archived row's token mints over the isolated archive root").toBe("C-ROOT-WINDOW");
    },
  );
});

function rootAttrs(xml: string): { base: number; headroom: number; ceiling: number } {
  const m = xml.match(/<(?:Findings|Rulings|Registry|RecordIndex)\b([^>]*)>/);
  const raw = m?.[1] ?? "";
  const grab = (name: string): number => {
    const hit = raw.match(new RegExp(`${name}="([^"]*)"`));
    return Number(hit?.[1]);
  };
  return { base: grab("base"), headroom: grab("headroom"), ceiling: grab("ceiling") };
}

function h2LineCounts(xml: string): number[] {
  const blocks = xml.match(/<Decision\b[\s\S]*?<\/Decision>/g) ?? [];
  const out: number[] = [];
  for (const block of blocks) {
    const title = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const hashes = (title?.[1] ?? "").match(/^(#+)/);
    if (!hashes || hashes[1]!.length !== 2) continue;
    if (!/status="live"/.test(block)) continue;
    out.push(newlineCount(block) + 1);
  }
  return out;
}

function liveRowNames(xml: string): string[] {
  const blocks = xml.match(/<Row\b[\s\S]*?<\/Row>/g) ?? [];
  const names: string[] = [];
  for (const block of blocks) {
    if (!/status="live"/.test(block)) continue;
    const m = block.match(/\bname="([^"]+)"/);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

function liveRowCount(xml: string): number {
  return liveRowNames(xml).length;
}

function retiredDecision(xml: string, token: string): string | undefined {
  const blocks = xml.match(/<Decision\b[\s\S]*?<\/Decision>/g) ?? [];
  return blocks.find((block) => new RegExp(`\\btoken="${token}"`).test(block));
}

function findingRecords(
  xml: string,
): Array<{ id: string; token: string; status: string; paidBy: string | undefined }> {
  const blocks = xml.match(/<Finding\b[\s\S]*?<\/Finding>/g) ?? [];
  return blocks.map((block) => {
    const id = block.match(/\bid="([^"]+)"/)?.[1] ?? "";
    const token = block.match(/\btoken="([^"]+)"/)?.[1] ?? "";
    const status = block.match(/\bstatus="([^"]+)"/)?.[1] ?? "";
    const paidBy = block.match(/<PaidBy>([\s\S]*?)<\/PaidBy>/)?.[1];
    return { id, token, status, paidBy };
  });
}

function indexEntries(xml: string): Array<{ id: string; layer: string }> {
  return (xml.match(/<Entry\b[^>]*\/>/g) ?? []).map((tag) => ({
    id: tag.match(/\bid="([^"]+)"/)?.[1] ?? "",
    layer: tag.match(/\blayer="([^"]+)"/)?.[1] ?? "",
  }));
}

/**
 * AC-DUPLICATE-PAIR's move-invariant pair form: over the token's named
 * elements, each id occurs exactly once across findings.xml and
 * findings-retired.xml — never in both files, never in neither, never
 * duplicated within one file — all ids co-located in the same one of the two
 * files, and decisions.xml carries exactly one Entry element per id whose
 * layer agrees with the file holding the Finding. No status, layer, or PaidBy
 * of the token is pinned: a lawful payment moves the pair together and the
 * invariant holds in either layer.
 */
function expectDuplicateTokenPair(
  liveFindings: string,
  retiredFindings: string,
  index: string,
  token: string,
  ids: readonly string[],
): void {
  const live = findingRecords(liveFindings).filter((f) => f.token === token);
  const retired = findingRecords(retiredFindings).filter((f) => f.token === token);
  const liveIds = live.map((f) => f.id);
  const retiredIds = retired.map((f) => f.id);
  expect(live.length + retired.length, `${token}: exactly the named pair exists`).toBe(ids.length);
  for (const id of ids) {
    const inLive = liveIds.filter((x) => x === id).length;
    const inRetired = retiredIds.filter((x) => x === id).length;
    expect(
      inLive + inRetired,
      `${token}/${id}: must occur exactly once across the two files (never in both, never in neither, never duplicated)`,
    ).toBe(1);
  }
  const allLive = ids.every((id) => liveIds.includes(id));
  const allRetired = ids.every((id) => retiredIds.includes(id));
  expect(allLive && allRetired, `${token}: the pair is split across the two files`).toBe(false);
  const entries = indexEntries(index);
  for (const id of ids) {
    const matches = entries.filter((e) => e.id === id);
    expect(matches.length, `${token}/${id}: decisions.xml Entry count`).toBe(1);
    const layer = matches[0]!.layer;
    const holding = liveIds.includes(id) ? "live" : "retired";
    expect(layer, `${token}/${id}: index layer ${layer} must agree with the holding file (${holding})`).toBe(holding);
  }
}

function findingLineCounts(xml: string): number[] {
  const blocks = xml.match(/<Finding\b[\s\S]*?<\/Finding>/g) ?? [];
  const out: number[] = [];
  for (const block of blocks) {
    if (!/status="live"/.test(block)) continue;
    out.push(newlineCount(block) + 1);
  }
  return out;
}

function splitShapedParts(): ReturnType<typeof happyParts> {
  const body = "ruling body";
  const decision = `  <Decision id="d1" token="D1" status="live">
    <Title>## D1 — live</Title>
    <Body>${body}</Body>
  </Decision>`;
  const rulingsNoAttrs = `<Rulings>\n${decision}\n</Rulings>\n`;
  const counts = h2LineCounts(rulingsNoAttrs);
  const base = newlineCount(rulingsNoAttrs);
  const med = median(counts);
  const headroom = 2 * med;
  const ceiling = base + headroom;
  const parts = happyParts();
  parts.rulings = `<Rulings base="${base}" headroom="${headroom}" ceiling="${ceiling}">
${decision}
</Rulings>
`;
  parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>old</Charter>
    <Pays>F1</Pays>
    <StatusText>Delivered</StatusText>
  </Row>
</Registry>
`;
  return parts;
}

/**
 * A fixture whose live roots satisfy the shipped relations with base equal to
 * each genre's shipped metric read back — the consistent record the
 * --rewrite-roots byte no-op needs (the shipped happyParts roots are
 * hand-shaped, not consistent).
 */
function consistentParts(): ReturnType<typeof happyParts> {
  const parts = happyParts();
  const f1 = `  <Finding id="f1" token="F1" status="live">\n    <Title>### F1 — live</Title>\n    <Body>body one</Body>\n  </Finding>`;
  const d1 = `  <Decision id="d1" token="D1" status="live">\n    <Title>## D1 — live</Title>\n    <Body>ruling body</Body>\n  </Decision>`;
  const row = `  <Row name="C-LIVE-ROW" status="live" kind="chartered">\n    <Number>1</Number>\n    <Charter>charter</Charter>\n    <Pays></Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>`;
  const entries = `  <Entry id="f1" token="F1" genre="finding" layer="live" />\n  <Entry id="f2" token="F2" genre="finding" layer="retired" />\n  <Entry id="d1" token="D1" genre="decision" layer="live" />`;
  const findingsNoAttrs = `<Findings>\n${f1}\n</Findings>\n`;
  const findingsBase = newlineCount(findingsNoAttrs);
  const findingsHeadroom = 7 * median(findingLineCounts(findingsNoAttrs));
  parts.findings = `<Findings base="${findingsBase}" headroom="${findingsHeadroom}" ceiling="${findingsBase + findingsHeadroom}">\n${f1}\n</Findings>\n`;
  const rulingsNoAttrs = `<Rulings>\n${d1}\n</Rulings>\n`;
  const rulingsBase = newlineCount(rulingsNoAttrs);
  const rulingsHeadroom = 7 * median(h2LineCounts(rulingsNoAttrs));
  parts.rulings = `<Rulings base="${rulingsBase}" headroom="${rulingsHeadroom}" ceiling="${rulingsBase + rulingsHeadroom}">\n${d1}\n</Rulings>\n`;
  const registryNoAttrs = `<Registry>\n${row}\n</Registry>\n`;
  const registryBase = liveRowCount(registryNoAttrs);
  parts.registry = `<Registry base="${registryBase}" headroom="15" ceiling="${registryBase + 15}">\n${row}\n</Registry>\n`;
  const indexNoAttrs = `<RecordIndex>\n${entries}\n</RecordIndex>\n`;
  const indexParsed = parseGraceXmlArtifact("decisions.xml", indexNoAttrs);
  const indexBase = childNodes(indexParsed.root!, "Entry").filter(
    (entry) => entry.attributes.layer !== "retired",
  ).length;
  parts.index = `<RecordIndex base="${indexBase}" headroom="${INDEX_HEADROOM_ENTRIES}" ceiling="${indexBase + INDEX_HEADROOM_ENTRIES}">\n${entries}\n</RecordIndex>\n`;
  return parts;
}

/** The nine record files, byte-identical checks run over this set. */
function snapshotRecord(root: string): Record<string, string> {
  const names = [
    "findings.xml",
    "findings-retired.xml",
    "rulings.xml",
    "rulings-retired.xml",
    "registry.xml",
    "registry-retired.xml",
    "decisions.xml",
    "decisions.md",
    "record-inventory.json",
  ];
  const out: Record<string, string> = {};
  for (const name of names) {
    out[name] = readFileSync(path.join(root, RECORD_REL, name), "utf8");
  }
  return out;
}

/** The own bytes of each top-level element, keyed by id — the C-ROOT-WINDOW indent walk. */
function topElementBytes(xml: string): Map<string, string> {
  const parsed = parseGraceXmlArtifact("walk", xml);
  const spans = computeElementSpans(xml, parsed);
  const out = new Map<string, string>();
  for (const child of parsed.root!.children) {
    const span = spans.get(child)!;
    out.set(child.attributes.id ?? "", xml.slice(span.openStart, span.closeEnd ?? span.openEnd));
  }
  return out;
}

/** Every gap is the canonical house shape: <newline><two spaces> before each top-level element, <newline> before the root close. */
function gapShapesCanonical(xml: string): boolean {
  const parsed = parseGraceXmlArtifact("gaps", xml);
  const spans = computeElementSpans(xml, parsed);
  const rootSpan = spans.get(parsed.root!)!;
  if (rootSpan.closeStart === null) {
    return false;
  }
  let cursor = rootSpan.openEnd;
  for (const child of parsed.root!.children) {
    const span = spans.get(child)!;
    if (xml.slice(cursor, span.openStart) !== "\n  ") {
      return false;
    }
    cursor = span.closeEnd ?? span.openEnd;
  }
  return xml.slice(cursor, rootSpan.closeStart) === "\n";
}

// =============================================================================
// Regression guard (approved spec remedy item (4)), keyed on the arguments of
// every validator spawn site rather than on a source string, so it survives
// this bundle's close and runs in CI forever. Production cwd: a token stream
// containing REPO_ROOT, resolved transitively through in-file const/let
// initializers. Mutating argv: a flag arriving through a literal, an array, or
// a variable. Refusal, not filtering: an argv shape the scan cannot prove
// flag-free (a spread, a call, a parameter, an import) fails the guard. The
// bare non-mutating runValidatorInProcess(REPO_ROOT) calls stay legal. The helper's own
// internal spawn call is excluded (it is covered by scanning runValidator call
// sites); a direct spawn call naming the SCRIPT constant elsewhere is scanned.
// =============================================================================

type SpawnSiteVerdict = { index: number; site: string; production: boolean; mutating: boolean; unresolvable: boolean };

const GUARD_FLAGS = ["--retire", "--stamp-paid-by", "--split", "--rewrite-roots"];

function guardInitializerOf(source: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:const|let)\\s+${name}\\s*=\\s*([^\\n]*)`);
  const m = source.match(re);
  return m ? m[1]!.trim() : undefined;
}

/** Token stream of an expression: identifiers, string contents; plain identifiers resolve transitively through in-file const/let initializers. */
function guardTokenStream(source: string, expr: string, depth = 0): string[] {
  if (depth > 8) return [];
  const tokens: string[] = [];
  const re = /[A-Za-z_$][A-Za-z0-9_$]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
  for (const raw of expr.match(re) ?? []) {
    if (/^["']/.test(raw)) {
      tokens.push(raw.slice(1, -1));
    } else {
      tokens.push(raw);
      const init = guardInitializerOf(source, raw);
      if (init !== undefined && !init.includes("(")) {
        tokens.push(...guardTokenStream(source, init.replace(/^=\s*/, "").replace(/;$/, ""), depth + 1));
      }
    }
  }
  return tokens;
}

/** Resolve an expression to provable string values; undefined = the shape cannot be proven (refusal). */
function guardResolveStrings(source: string, expr: string, depth = 0): string[] | undefined {
  if (depth > 8) return undefined;
  const t = expr.trim().replace(/;$/, "");
  if (/^["']/.test(t) && t.length >= 2 && t.endsWith(t[0]!)) {
    return [t.slice(1, -1)];
  }
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1);
    const parts: string[] = [];
    let sq = 0, br = 0, pa = 0, inStr: string | undefined;
    let cur = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (inStr) {
        cur += ch;
        if (ch === inStr && inner[i - 1] !== "\\") inStr = undefined;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; cur += ch; continue; }
      if (ch === "[") sq++;
      else if (ch === "]") sq--;
      else if (ch === "{") br++;
      else if (ch === "}") br--;
      else if (ch === "(") pa++;
      else if (ch === ")") pa--;
      if (ch === "," && sq === 0 && br === 0 && pa === 0) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    const out: string[] = [];
    for (const part of parts) {
      const p = part.trim();
      if (p === "") continue;
      if (p.startsWith("...")) return undefined;
      const r = guardResolveStrings(source, p, depth + 1);
      if (r === undefined) return undefined;
      out.push(...r);
    }
    return out;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) {
    const init = guardInitializerOf(source, t);
    if (init === undefined) return undefined; // parameter, import, or unknown: refuse
    if (init.includes("(")) return undefined; // call initializer: refuse
    return guardResolveStrings(source, init.replace(/^=\s*/, ""), depth + 1);
  }
  return undefined; // call, member chain, ternary, spread: refuse
}

function guardIsMutating(values: string[] | undefined): boolean {
  if (values === undefined) return true; // refusal: cannot prove flag-free
  return values.some((v) => GUARD_FLAGS.some((flag) => v.includes(flag)));
}

/** Extract the balanced-paren argument text of a call starting at the "(" offset. */
function guardCallArgs(source: string, openParen: number): string | undefined {
  let depth = 0, inStr: string | undefined;
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i]!;
    if (inStr) {
      if (ch === inStr && source[i - 1] !== "\\") inStr = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return undefined;
}

function guardSplitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let sq = 0, br = 0, pa = 0, inStr: string | undefined;
  let cur = "";
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (inStr) {
      cur += ch;
      if (ch === inStr && args[i - 1] !== "\\") inStr = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; cur += ch; continue; }
    if (ch === "[") sq++;
    else if (ch === "]") sq--;
    else if (ch === "{") br++;
    else if (ch === "}") br--;
    else if (ch === "(") pa++;
    else if (ch === ")") pa--;
    if (ch === "," && sq === 0 && br === 0 && pa === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}

/** Span of a top-level function declaration (for excluding the helper's own body). */
function guardFunctionSpan(source: string, name: string): { start: number; end: number } | undefined {
  const decl = source.indexOf(`function ${name}`);
  if (decl === -1) return undefined;
  // A top-level function body closes at a "}" in column 0 (house 2-space style);
  // brace matching cannot be used directly because of the return-type annotation.
  const close = source.indexOf("\n}", decl);
  if (close === -1) return undefined;
  return { start: decl, end: close };
}

function guardScanSites(source: string): SpawnSiteVerdict[] {
  const verdicts: SpawnSiteVerdict[] = [];
  const helperSpan = guardFunctionSpan(source, "runValidator");

  const callRe = /\brunValidator\s*\(/g;
  for (const m of source.matchAll(callRe)) {
    const before = source.slice(Math.max(0, m.index! - 12), m.index!);
    if (/function\s*$/.test(before)) continue; // the declaration itself
    const openParen = source.indexOf("(", m.index!);
    const argsText = guardCallArgs(source, openParen);
    if (argsText === undefined) continue;
    const parts = guardSplitTopLevel(argsText);
    const cwdExpr = parts[0] ?? "";
    const argvExpr = parts.length > 1 ? parts.slice(1).join(",") : "[]";
    const production = guardTokenStream(source, cwdExpr).includes("REPO_ROOT");
    const argvValues = guardResolveStrings(source, argvExpr);
    const mutating = guardIsMutating(argvValues);
    verdicts.push({
      index: m.index!,
      site: source.slice(m.index!, openParen + 1 + argsText.length + 1).replace(/\s+/g, " "),
      production,
      mutating,
      unresolvable: argvValues === undefined,
    });
  }

  const spawnRe = /\bspawnSync\s*\(/g;
  for (const m of source.matchAll(spawnRe)) {
    if (helperSpan && m.index! >= helperSpan.start && m.index! <= helperSpan.end) continue;
    const openParen = source.indexOf("(", m.index!);
    const argsText = guardCallArgs(source, openParen);
    if (argsText === undefined) continue;
    const parts = guardSplitTopLevel(argsText);
    const argvExpr = parts.length > 1 ? parts[1]! : "[]";
    if (!guardTokenStream(source, argvExpr).includes("SCRIPT")) continue;
    const cwdExpr = parts.length > 2
      ? (guardSplitTopLevel(parts[2]!.replace(/^\{|\}$/g, "")).map((p) => p.trim()).find((p) => p.startsWith("cwd")) ?? "").replace(/^cwd\s*:\s*/, "")
      : "";
    const production = cwdExpr === "" ? true : guardTokenStream(source, cwdExpr).includes("REPO_ROOT");
    const argvValues = guardResolveStrings(source, argvExpr);
    const mutating = guardIsMutating(argvValues === undefined ? undefined : argvValues.slice(1)); // drop the runner token
    verdicts.push({
      index: m.index!,
      site: source.slice(m.index!, openParen + 1 + argsText.length + 1).replace(/\s+/g, " "),
      production,
      mutating,
      unresolvable: argvValues === undefined,
    });
  }
  return verdicts;
}

function guardFailures(source: string): SpawnSiteVerdict[] {
  return guardScanSites(source).filter((v) => v.unresolvable || (v.production && v.mutating));
}

// ---------------------------------------------------------------------------
// C-TAUGHT-RULES T-005: the chartered row's walk, carrier relations, and the
// named red directions. The walk was written red-first (the row absent, the
// assertion red) and greens with the mint landed; the red directions are
// driven on mutated copies, never against the production record.
// ---------------------------------------------------------------------------

const TAUGHT_ROW_SIX = ["F210", "F196", "F199", "F188", "F233", "F234"] as const;

type TaughtRowHit = {
  file: string;
  status: string;
  kind: string;
  pays: string;
  charter: string;
  statusText: string;
};

function walkTaughtRow(recordDir: string): TaughtRowHit[] {
  const hits: TaughtRowHit[] = [];
  for (const file of ["registry.xml", "registry-retired.xml"] as const) {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    for (const row of childNodes(parsed.root!, "Row")) {
      if (row.attributes.name !== "C-TAUGHT-RULES") {
        continue;
      }
      hits.push({
        file,
        status: row.attributes.status ?? "",
        kind: row.attributes.kind ?? "",
        pays: (childText(row, "Pays") ?? "").trim(),
        charter: childText(row, "Charter") ?? "",
        statusText: childText(row, "StatusText") ?? "",
      });
    }
  }
  return hits;
}

function expectTaughtRowInvariants(hits: TaughtRowHit[]): void {
  expect(
    hits.length,
    `the C-TAUGHT-RULES row exists exactly once across the registry layers (got ${hits.length})`,
  ).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.status, "the row's status agrees with the holding file").toBe(holding);
  expect(hit.kind, "the row is chartered").toBe("chartered");
  expect(hit.pays, "Pays names exactly the six tokens in that order").toBe(
    "F210 F196 F199 F188 F233 F234",
  );
  expect(hit.charter, "the Charter records the mint search").toContain("Searched before minting");
  expect(hit.charter.match(/\bF[0-9]/g), "the Charter names no F token").toBeNull();
  expect(hit.statusText.match(/\bF[0-9]/), "the StatusText names no F token").toBeNull();
  expect(/closed with/i.test(hit.statusText), "the StatusText carries no Closed-with sentence").toBe(
    false,
  );
}

function expectTaughtCarrierRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of TAUGHT_ROW_SIX) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(
        carrier.node.attributes.status,
        `${token}: the carrier's status agrees with the holding file (${carrier.file})`,
      ).toBe(expectedStatus);
      if (carrier.file === "findings-retired.xml") {
        expect(
          childText(carrier.node, "PaidBy"),
          `${token}: a retired carrier carries PaidBy C-TAUGHT-RULES`,
        ).toBe("C-TAUGHT-RULES");
      }
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(
        entries[0]!.attributes.layer,
        `${token}: the carrier's index Entry layer agrees with the holding file`,
      ).toBe(expectedStatus);
    }
  }
}

/** Isolated copy of the two registry layers, optionally mutated, never the production record. */
// The mutation lands on whichever layer holds the row (F229's state-independent
// form): the row is live before the close and retired after it, and a red
// direction pinned to registry.xml stops landing the moment the close moves it.
function plantedTaughtRegistry(mutateHolder?: (xml: string) => string): string {
  const root = isolatedRoot();
  const recordDir = path.join(root, RECORD_REL);
  mkdirSync(recordDir, { recursive: true });
  for (const file of ["registry.xml", "registry-retired.xml"]) {
    const source = readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8");
    const holdsRow = source.includes('name="C-TAUGHT-RULES"');
    writeFileSync(path.join(recordDir, file), holdsRow ? (mutateHolder?.(source) ?? source) : source);
  }
  return recordDir;
}

describe("C-TAUGHT-RULES row", () => {
  it(
    "row invariant: exactly once across the registry layers, status agreeing with the holding file, kind chartered, Pays exactly F210 F196 F199 F188 F233 F234 in that order, Charter carrying the searched-before-minting statement with no F token, StatusText naming no F token and no Closed-with sentence (generous timeout)",
    () => {
      expectTaughtRowInvariants(walkTaughtRow(path.join(REPO_ROOT, RECORD_REL)));
    },
  );

  it(
    "carrier relations: each of the six tokens, when a Finding carries it, exists exactly once across both findings files, its status agreeing with the holding file, PaidBy C-TAUGHT-RULES if retired, its index Entry layer agreeing with the holding file — and the carrier-absent case is green; the shipped validator returns zero findings on the production record, read-only (generous timeout)",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      expectTaughtCarrierRelations(recordDir);
      const recordFiles = [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
      ];
      const before = new Map(
        recordFiles.map((file) => [file, readFileSync(path.join(recordDir, file), "utf8")]),
      );
      const production = validateRecordRetirement({ repoRoot: REPO_ROOT, recordDir });
      expect(production, "the shipped validator returns zero findings with the row minted live").toEqual([]);
      for (const file of recordFiles) {
        const expected = before.get(file);
        if (expected === undefined) throw new Error(`${file}: missing pre-run snapshot`);
        expect(
          readFileSync(path.join(recordDir, file), "utf8"),
          `${file}: the production run is read-only`,
        ).toBe(expected);
      }
    },
  );

  it("red direction — a second row with the same name reddens the exactly-once clause", () => {
    const recordDir = plantedTaughtRegistry((xml) =>
      xml.replace(
        "</Registry>",
        `  <Row name="C-TAUGHT-RULES" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F210</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
      ),
    );
    expect(() => expectTaughtRowInvariants(walkTaughtRow(recordDir))).toThrow(/exactly once across the registry layers/);
  });

  it("red direction — a Pays token outside the six reddens the exact-set clause", () => {
    const recordDir = plantedTaughtRegistry((xml) =>
      xml.replace("<Pays>F210 F196 F199 F188 F233 F234</Pays>", "<Pays>F210 F196 F199 F188 F233 F234 F205</Pays>"),
    );
    expect(() => expectTaughtRowInvariants(walkTaughtRow(recordDir))).toThrow(/exactly the six tokens/);
  });

  it("red direction — a StatusText naming a token outside Pays reddens the row's prose law", () => {
    const recordDir = plantedTaughtRegistry((xml) =>
      xml.replace(
        "Ordered; the row is minted live by the plan and paid by the close move.",
        "Ordered. Closed with F205.",
      ),
    );
    expect(() => expectTaughtRowInvariants(walkTaughtRow(recordDir))).toThrow(/no F token|Closed-with/);
  });

  it("red direction — a duplicated carrier reddens the at-most-once clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    const live = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
    writeFileSync(
      path.join(recordDir, "findings.xml"),
      live.replace(
        "</Findings>",
        `  <Finding id="f210-duplicate" token="F210" status="live">\n    <Title>### F210 duplicate</Title>\n    <Body>duplicated carrier</Body>\n  </Finding>\n</Findings>`,
      ),
    );
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return [...walkNodes(parsed.root!)].filter((node) => node.tag === "Finding" && node.attributes.token === "F210");
    });
    expect(carriers.length, "the duplicated copy carries F210 twice").toBe(2);
    expect(() => expectTaughtCarrierRelations(recordDir)).toThrow(/at most one Finding element carries the token/);
  });

  it(
    "red direction — a minted token missing from the extended baseline reddens the payer-derivation baseline; the shipped extension with all six greens over the same derivation (generous timeout)",
    () => {
      const isolated = isolatedRoot();
      mkdirSync(path.join(isolated, ".ngrace", "changes", "archive", "C-TAUGHT-RULES"), { recursive: true });
      const derived = derivePayerMap(isolated, [
        {
          name: "C-TAUGHT-RULES",
          pays: "F210 F196 F199 F188 F233 F234",
          statusText: "Ordered; the row is minted live by the plan and paid by the close move.",
        },
      ]);
      expect(
        [...derived.keys()],
        "the derivation over the isolated archive root mints exactly the row's six tokens in order",
      ).toEqual(["F210", "F196", "F199", "F188", "F233", "F234"]);
      const gapped: Record<string, string | undefined> = {
        F210: "C-TAUGHT-RULES",
        F196: "C-TAUGHT-RULES",
        F188: "C-TAUGHT-RULES",
        F233: "C-TAUGHT-RULES",
        F234: "C-TAUGHT-RULES",
        F199: undefined,
      };
      expect(() => {
        for (const [token] of derived) {
          expect(derived.get(token), token).toBe(gapped[token]);
        }
      }).toThrow();
    },
  );

  it(
    "C-FLUSH-TWO-WAVES flush invariant: every flushed id is exactly once across its genre's pair with its status agreeing with the holding file, its token and genre agreeing, its index Entry layer and genre agreeing, and the roots read back (generous timeout)",
    () => {
      // Read-only walk over the delivered record with the shipped parser.
      // The walk over both whole trees is the duplicate check. No fixed
      // expectation of which file holds a flushed id — the relation
      // survives the record's own payment cycle by construction.
      const flushedFindings = ["f230", "f235", "f236", "f237"];
      const flushedDecisions = ["d38"];
      const indexParsed = parseGraceXmlArtifact(
        "decisions.xml",
        readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"),
      );
      expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
      for (const id of flushedFindings) {
        const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
          const parsed = parseGraceXmlArtifact(
            file,
            readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
          );
          expect(parsed.root, `${file} parses`).not.toBeNull();
          return [...walkNodes(parsed.root!)]
            .filter((node) => node.tag === "Finding" && node.attributes.id === id)
            .map((node) => ({ file, node }));
        });
        expect(
          carriers.length,
          `${id}: exactly one Finding element across the findings pair (got ${carriers.length})`,
        ).toBe(1);
        const { file, node } = carriers[0]!;
        const expectedStatus = file === "findings.xml" ? "live" : "retired";
        expect(
          node.attributes.status,
          `${id}: the carrier's status agrees with the holding file (${file})`,
        ).toBe(expectedStatus);
        expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`F${id.slice(1)}`);
        const entries = [...walkNodes(indexParsed.root!)].filter(
          (entry) => entry.tag === "Entry" && entry.attributes.id === id,
        );
        expect(entries.length, `${id}: exactly one Entry for the id (a duplicate would walk two)`).toBe(1);
        expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("finding");
        expect(
          entries[0]!.attributes.layer,
          `${id}: the Entry's layer agrees with the holding file`,
        ).toBe(expectedStatus);
      }
      for (const id of flushedDecisions) {
        const carriers = (["rulings.xml", "rulings-retired.xml"] as const).flatMap((file) => {
          const parsed = parseGraceXmlArtifact(
            file,
            readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
          );
          expect(parsed.root, `${file} parses`).not.toBeNull();
          return [...walkNodes(parsed.root!)]
            .filter((node) => node.tag === "Decision" && node.attributes.id === id)
            .map((node) => ({ file, node }));
        });
        expect(
          carriers.length,
          `${id}: exactly one Decision element across the rulings pair (got ${carriers.length})`,
        ).toBe(1);
        const { file, node } = carriers[0]!;
        const expectedStatus = file === "rulings.xml" ? "live" : "retired";
        expect(
          node.attributes.status,
          `${id}: the carrier's status agrees with the holding file (${file})`,
        ).toBe(expectedStatus);
        expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`D${id.slice(1)}`);
        const entries = [...walkNodes(indexParsed.root!)].filter(
          (entry) => entry.tag === "Entry" && entry.attributes.id === id,
        );
        expect(entries.length, `${id}: exactly one Entry for the id (a duplicate would walk two)`).toBe(1);
        expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("decision");
        expect(
          entries[0]!.attributes.layer,
          `${id}: the Entry's layer agrees with the holding file`,
        ).toBe(expectedStatus);
      }
      // The read-back arithmetic, exactly as the shipped roots-invariant test
      // uses the exported newlineCount: base equals the whole-file line count
      // read back, and base + headroom = ceiling — findings root and rulings
      // root both.
      const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
      const findingsRoot = parseGraceXmlArtifact("findings.xml", findingsText).root!;
      const fBase = Number(findingsRoot.attributes.base);
      const fHeadroom = Number(findingsRoot.attributes.headroom);
      const fCeiling = Number(findingsRoot.attributes.ceiling);
      expect(fBase, "findings.xml: base equals the file's newlineCount").toBe(newlineCount(findingsText));
      expect(fBase + fHeadroom, "findings.xml: base + headroom = ceiling").toBe(fCeiling);
      const rulingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "rulings.xml"), "utf8");
      const rulingsRoot = parseGraceXmlArtifact("rulings.xml", rulingsText).root!;
      const rBase = Number(rulingsRoot.attributes.base);
      const rHeadroom = Number(rulingsRoot.attributes.headroom);
      const rCeiling = Number(rulingsRoot.attributes.ceiling);
      expect(rBase, "rulings.xml: base equals the file's newlineCount").toBe(newlineCount(rulingsText));
      expect(rBase + rHeadroom, "rulings.xml: base + headroom = ceiling").toBe(rCeiling);
    },
  );

  it(
    "C-FLUSH-TWO-WAVES payment absence: the shipped derivation mints nothing to C-FLUSH-TWO-WAVES (the bundle pays nothing), the production validator returns zero findings read-only, and a planted row over an isolated root mints its tokens",
    () => {
      const staged = ["F230", "F235", "F236", "F237", "D38"];
      // The real derivation over the real archive and both registry layers:
      // the payment set of this bundle is exactly empty — none of the staged
      // tokens is minted by any row.
      const realRows: Array<{ name: string; pays: string; statusText: string }> = [];
      for (const file of ["registry.xml", "registry-retired.xml"] as const) {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        expect(parsed.root, `${file} parses`).not.toBeNull();
        for (const candidate of parsed.root!.children.filter((child) => child.tag === "Row")) {
          const kind = candidate.attributes.kind ?? "chartered";
          if (kind !== "chartered" && kind !== "historical") {
            continue;
          }
          realRows.push({
            name: candidate.attributes.name ?? "",
            pays: childText(candidate, "Pays") ?? "",
            statusText: childText(candidate, "StatusText") ?? "",
          });
        }
      }
      const derived = derivePayerMap(REPO_ROOT, realRows);
      // payment-invariant: this bundle pays nothing; other bundles may later
      // pay these tokens (F225's class, payer-map dimension)
      const allRegistryRowNames: string[] = [];
      for (const file of ["registry.xml", "registry-retired.xml"] as const) {
        const parsed = parseGraceXmlArtifact(
          file,
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
        );
        for (const candidate of parsed.root!.children.filter((child) => child.tag === "Row")) {
          allRegistryRowNames.push(candidate.attributes.name ?? "");
        }
      }
      expect(
        allRegistryRowNames,
        'no Row in either registry layer carries name="C-FLUSH-TWO-WAVES"',
      ).not.toContain("C-FLUSH-TWO-WAVES");
      for (const [token, payer] of derived) {
        expect(
          payer,
          `${token}: the production payer map does not name C-FLUSH-TWO-WAVES as payer`,
        ).not.toBe("C-FLUSH-TWO-WAVES");
      }
      // A read-only production run of the shipped validator: zero findings
      // on the production record, and every record byte unchanged by the call.
      const recordFiles = [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
      ];
      const before = new Map(
        recordFiles.map((file) => [file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8")]),
      );
      const production = validateRecordRetirement({
        repoRoot: REPO_ROOT,
        recordDir: path.join(REPO_ROOT, RECORD_REL),
      });
      expect(production, "the shipped validator returns zero findings on the production record").toEqual([]);
      for (const file of recordFiles) {
        const expected = before.get(file);
        if (expected === undefined) throw new Error(`${file}: missing pre-run snapshot`);
        expect(
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
          `${file}: the production run is read-only`,
        ).toBe(expected);
      }
      // The discriminating direction, so the absence is not vacuously empty:
      // the same derivation over an isolated archive root carrying a planted
      // row mints the planted tokens. The fixture archive mirrors the real
      // membership the claim needs; the production archive is never written
      // by any test.
      const isolatedRepo = isolatedRoot();
      mkdirSync(path.join(isolatedRepo, ".ngrace", "changes", "archive", "C-FLUSH-TWO-WAVES"), { recursive: true });
      const isolatedMap = derivePayerMap(isolatedRepo, [
        { name: "C-FLUSH-TWO-WAVES", pays: "F230 F235 F236 F237", statusText: "" },
      ]);
      expect(
        [...isolatedMap.entries()],
        "the isolated derivation mints exactly the planted row's tokens for C-FLUSH-TWO-WAVES",
      ).toEqual([
        ["F230", "C-FLUSH-TWO-WAVES"],
        ["F235", "C-FLUSH-TWO-WAVES"],
        ["F236", "C-FLUSH-TWO-WAVES"],
        ["F237", "C-FLUSH-TWO-WAVES"],
      ]);
    },
  );
});

/**
 * C-APPLY-VERB row invariant (AC-RECORD-ROW). The walk reads both registry
 * layers at test time and expects the row exactly once — no fixed expectation
 * of which file holds it, so the relation survives the close's own move.
 */
function cApplyVerbRowViolations(layers: Array<{ file: string; xml: string }>): string[] {
  const holdingStatus = (file: string): "live" | "retired" => (file === "registry.xml" ? "live" : "retired");
  const rows: Array<{ file: string; status: string; kind: string; pays: string; charter: string; statusText: string }> = [];
  for (const { file, xml } of layers) {
    const parsed = parseGraceXmlArtifact(file, xml);
    if (!parsed.root) return [`${file}: unparsable`];
    for (const row of parsed.root.children.filter((child) => child.tag === "Row")) {
      if ((row.attributes.name ?? "") !== "C-APPLY-VERB") continue;
      rows.push({
        file,
        status: row.attributes.status ?? "",
        kind: row.attributes.kind ?? "",
        pays: childText(row, "Pays") ?? "",
        charter: childText(row, "Charter") ?? "",
        statusText: childText(row, "StatusText") ?? "",
      });
    }
  }
  const violations: string[] = [];
  if (rows.length !== 1) {
    violations.push(`expected exactly one C-APPLY-VERB row across both registry layers, found ${rows.length}`);
    return violations;
  }
  const row = rows[0]!;
  if (row.status !== holdingStatus(row.file)) {
    violations.push(`${row.file}: row status ${row.status} disagrees with the holding file`);
  }
  if (row.kind !== "chartered") {
    violations.push(`${row.file}: row kind ${row.kind} is not chartered`);
  }
  const paysTokens = [...row.pays.matchAll(/F\d+(?:\.\d+)*/g)].map((match) => match[0]);
  if (paysTokens.join(",") !== "F224") {
    violations.push(`${row.file}: Pays names ${paysTokens.join(", ") || "(nothing)"}, not exactly F224`);
  }
  if (!/searched before minting/i.test(row.charter)) {
    violations.push(`${row.file}: Charter lacks the searched-before-minting statement`);
  }
  if (/F\d+/.test(row.charter)) {
    violations.push(`${row.file}: Charter names an F-token`);
  }
  if (/F\d+/.test(row.statusText)) {
    violations.push(`${row.file}: StatusText names an F-token`);
  }
  if (/Closed with/i.test(row.statusText)) {
    violations.push(`${row.file}: StatusText contains a Closed-with sentence`);
  }
  return violations;
}

function parseRegistryLayers(recordDir: string): Array<{ file: string; xml: string }> {
  return ["registry.xml", "registry-retired.xml"].map((file) => ({
    file,
    xml: readFileSync(path.join(recordDir, file), "utf8"),
  }));
}

describe("C-APPLY-VERB T-006 record-row", () => {
  it(
    "the chartered row exists exactly once across both registry layers with its status agreeing with the holding file and its payment cells naming exactly F224",
    () => {
      const violations = cApplyVerbRowViolations(parseRegistryLayers(path.join(REPO_ROOT, RECORD_REL)));
      expect(violations, violations.join("; ")).toEqual([]);
    },
  );
});

describe("C-APPLY-VERB T-006 record-row red direction", () => {
  it("a second row with the same name reddens the walk on a mutated copy of whichever layer holds the row", () => {
    const layers = parseRegistryLayers(path.join(REPO_ROOT, RECORD_REL));
    const holding = layers.find(({ xml }) => /<Row name="C-APPLY-VERB"/.test(xml));
    expect(holding, "the holding layer is found at test time").toBeDefined();
    const status = holding!.file === "registry.xml" ? "live" : "retired";
    const mutatedXml = holding!.xml.replace(
      "</Registry>",
      `  <Row name="C-APPLY-VERB" status="${status}" kind="chartered"><Number></Number><Charter>Probe copy only.</Charter><Pays>F224</Pays><StatusText>Probe copy only.</StatusText></Row>\n</Registry>`,
    );
    const violations = cApplyVerbRowViolations([
      { file: holding!.file, xml: mutatedXml },
      ...layers.filter((layer) => layer.file !== holding!.file),
    ]);
    expect(violations.length, violations.join("; ")).toBeGreaterThan(0);
    expect(violations.join("; ")).toMatch(/exactly one/);
  });

  it("a Pays token other than F224 reddens the walk on a mutated copy", () => {
    const layers = parseRegistryLayers(path.join(REPO_ROOT, RECORD_REL));
    const holding = layers.find(({ xml }) => /<Row name="C-APPLY-VERB"/.test(xml));
    expect(holding).toBeDefined();
    const mutatedXml = holding!.xml.replace("<Pays>F224</Pays>", "<Pays>F225</Pays>");
    expect(mutatedXml, "the mutation landed").not.toBe(holding!.xml);
    const violations = cApplyVerbRowViolations([
      { file: holding!.file, xml: mutatedXml },
      ...layers.filter((layer) => layer.file !== holding!.file),
    ]);
    expect(violations.join("; ")).toMatch(/not exactly F224/);
  });

  it("a StatusText naming a token outside Pays reddens the walk on a mutated copy", () => {
    const layers = parseRegistryLayers(path.join(REPO_ROOT, RECORD_REL));
    const holding = layers.find(({ xml }) => /<Row name="C-APPLY-VERB"/.test(xml));
    expect(holding).toBeDefined();
    const mutatedXml = holding!.xml.replace(
      /(<Row name="C-APPLY-VERB"[\s\S]*?)<StatusText>[^<]*<\/StatusText>/,
      "$1<StatusText>Ordered; the row is minted live by the plan and paid by the close's move, and a probe names F210 here.</StatusText>",
    );
    expect(mutatedXml, "the mutation landed").not.toBe(holding!.xml);
    const violations = cApplyVerbRowViolations([
      { file: holding!.file, xml: mutatedXml },
      ...layers.filter((layer) => layer.file !== holding!.file),
    ]);
    expect(violations.join("; ")).toMatch(/StatusText names an F-token/);
  });
});

// ---------------------------------------------------------------------------
// C-FLUSH-AND-TEACH T-001: the flush-invariant walk over the three staged
// findings this bundle flushes. The walk reads both findings files and the
// index at test time, so a duplicate or a layer mismatch reds regardless of
// which file holds the element (F238/F237-safe: no layer named in advance).
// ---------------------------------------------------------------------------

const CFT_FLUSHED = ["f238", "f239", "f241"] as const;

function expectFlushedFindingInvariants(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const id of CFT_FLUSHED) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.id === id)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${id}: exactly one Finding element across the findings pair (got ${carriers.length})`,
    ).toBe(1);
    const { file, node } = carriers[0]!;
    const expectedStatus = file === "findings.xml" ? "live" : "retired";
    expect(
      node.attributes.status,
      `${id}: the carrier's status agrees with the holding file (${file})`,
    ).toBe(expectedStatus);
    expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`F${id.slice(1)}`);
    const entries = [...walkNodes(indexParsed.root!)].filter(
      (entry) => entry.tag === "Entry" && entry.attributes.id === id,
    );
    expect(entries.length, `${id}: exactly one Entry for the id (a duplicate would walk two)`).toBe(1);
    expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("finding");
    expect(
      entries[0]!.attributes.layer,
      `${id}: the Entry's layer agrees with the holding file`,
    ).toBe(expectedStatus);
  }
  const findingsText = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
  const findingsRoot = parseGraceXmlArtifact("findings.xml", findingsText).root!;
  expect(Number(findingsRoot.attributes.base), "findings.xml: base equals the file's newlineCount").toBe(
    newlineCount(findingsText),
  );
  expect(
    Number(findingsRoot.attributes.base) + Number(findingsRoot.attributes.headroom),
    "findings.xml: base + headroom = ceiling",
  ).toBe(Number(findingsRoot.attributes.ceiling));
}

describe("C-FLUSH-AND-TEACH flush invariant", () => {
  it(
    "f238, f239 and f241 each exist exactly once across the findings pair with status, token, index genre and index layer agreeing with the holding file, and the findings root reads back (generous timeout)",
    () => {
      expectFlushedFindingInvariants(path.join(REPO_ROOT, RECORD_REL));
    },
  );
});

// ---------------------------------------------------------------------------
// C-FLUSH-AND-TEACH T-004: the chartered row's walk, carrier relations, the
// imported citation/preservation assertions, and the named red directions.
// Every red fixture mutates whichever layer holds the row (F237/F238-safe).
// ---------------------------------------------------------------------------

const CFT_ROW_FIVE = ["F236", "F237", "F238", "F239", "F241"] as const;

type CftRowHit = {
  file: string;
  status: string;
  kind: string;
  pays: string;
  charter: string;
  statusText: string;
};

function walkCftRow(recordDir: string): CftRowHit[] {
  const hits: CftRowHit[] = [];
  for (const file of ["registry.xml", "registry-retired.xml"] as const) {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    for (const row of childNodes(parsed.root!, "Row")) {
      if (row.attributes.name !== "C-FLUSH-AND-TEACH") {
        continue;
      }
      hits.push({
        file,
        status: row.attributes.status ?? "",
        kind: row.attributes.kind ?? "",
        pays: (childText(row, "Pays") ?? "").trim(),
        charter: childText(row, "Charter") ?? "",
        statusText: childText(row, "StatusText") ?? "",
      });
    }
  }
  return hits;
}

function expectCftRowInvariants(hits: CftRowHit[]): void {
  expect(
    hits.length,
    `the C-FLUSH-AND-TEACH row exists exactly once across the registry layers (got ${hits.length})`,
  ).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.status, "the row's status agrees with the holding file").toBe(holding);
  expect(hit.kind, "the row is chartered").toBe("chartered");
  expect(hit.pays, "Pays names exactly the five tokens in that order").toBe("F236 F237 F238 F239 F241");
  expect(hit.charter, "the Charter records the mint search").toContain("Searched before minting");
  expect(hit.charter.match(/\bF[0-9]/g), "the Charter names no F token").toBeNull();
  expect(hit.statusText.match(/\bF[0-9]/), "the StatusText names no F token").toBeNull();
  expect(/closed with/i.test(hit.statusText), "the StatusText carries no Closed-with sentence").toBe(false);
}

function expectCftCarrierRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of CFT_ROW_FIVE) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(
        carrier.node.attributes.status,
        `${token}: the carrier's status agrees with the holding file (${carrier.file})`,
      ).toBe(expectedStatus);
      if (carrier.file === "findings-retired.xml") {
        expect(
          childText(carrier.node, "PaidBy"),
          `${token}: a retired carrier carries PaidBy C-FLUSH-AND-TEACH`,
        ).toBe("C-FLUSH-AND-TEACH");
      }
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(
        entries[0]!.attributes.layer,
        `${token}: the carrier's index Entry layer agrees with the holding file`,
      ).toBe(expectedStatus);
    }
  }
}

/** Isolated copy of the two registry layers, optionally mutated, never the production record. */
function plantedCftRegistry(mutateHolder?: (xml: string) => string): string {
  const root = isolatedRoot();
  const recordDir = path.join(root, RECORD_REL);
  mkdirSync(recordDir, { recursive: true });
  for (const file of ["registry.xml", "registry-retired.xml"] as const) {
    const source = readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8");
    const holdsRow = source.includes('name="C-FLUSH-AND-TEACH"');
    writeFileSync(path.join(recordDir, file), holdsRow ? (mutateHolder?.(source) ?? source) : source);
  }
  return recordDir;
}

describe("C-FLUSH-AND-TEACH row", () => {
  it(
    "row invariant: exactly once across the registry layers, status agreeing with the holding file, kind chartered, Pays exactly F236 F237 F238 F239 F241 in that order, Charter carrying the searched-before-minting statement with no F token, StatusText naming no F token and no Closed-with sentence (generous timeout)",
    () => {
      expectCftRowInvariants(walkCftRow(path.join(REPO_ROOT, RECORD_REL)));
    },
  );

  it(
    "carrier relations and imported validators: each of the five tokens, when a Finding carries it, exists exactly once across both findings files, status and index layer agreeing, PaidBy C-FLUSH-AND-TEACH if retired — and validateStubAndIndex and proveRecordPreservation return zero findings read-only on the production record (generous timeout)",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      expectCftCarrierRelations(recordDir);
      const recordFiles = [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
      ];
      const before = new Map(
        recordFiles.map((file) => [file, readFileSync(path.join(recordDir, file), "utf8")]),
      );
      const production = validateRecordRetirement({ repoRoot: REPO_ROOT, recordDir });
      expect(production, "the shipped validator returns zero findings on the production record").toEqual([]);
      expect(
        validateStubAndIndex(path.join(recordDir, "decisions.md")),
        "validateStubAndIndex returns zero findings read-only",
      ).toEqual([]);
      expect(
        proveRecordPreservation(recordDir),
        "proveRecordPreservation returns zero findings read-only",
      ).toEqual([]);
      for (const file of recordFiles) {
        expect(
          readFileSync(path.join(recordDir, file), "utf8"),
          `${file}: the production runs are read-only`,
        ).toBe(before.get(file)!);
      }
    },
  );

  it("red direction — a second row with the same name reddens the exactly-once clause (mutating whichever layer holds the row)", () => {
    const recordDir = plantedCftRegistry((xml) =>
      xml.replace(
        "</Registry>",
        `  <Row name="C-FLUSH-AND-TEACH" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F236</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
      ),
    );
    expect(() => expectCftRowInvariants(walkCftRow(recordDir))).toThrow(/exactly once across the registry layers/);
  });

  it("red direction — a Pays token outside the five reddens the exact-set clause", () => {
    const recordDir = plantedCftRegistry((xml) =>
      xml.replace("<Pays>F236 F237 F238 F239 F241</Pays>", "<Pays>F236 F237 F238 F239 F241 F230</Pays>"),
    );
    expect(() => expectCftRowInvariants(walkCftRow(recordDir))).toThrow(/exactly the five tokens/);
  });

  it("red direction — a StatusText naming a token outside Pays reddens the row's prose law", () => {
    const recordDir = plantedCftRegistry((xml) =>
      xml.replace(
        /(<Row name="C-FLUSH-AND-TEACH"[\s\S]*?)<StatusText>[^<]*<\/StatusText>/,
        "$1<StatusText>Ordered. Closed with F230.</StatusText>",
      ),
    );
    expect(() => expectCftRowInvariants(walkCftRow(recordDir))).toThrow(/no F token|Closed-with/);
  });

  it("red direction — a duplicated carrier reddens the at-most-once clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"] as const) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    const live = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
    writeFileSync(
      path.join(recordDir, "findings.xml"),
      live.replace(
        "</Findings>",
        `  <Finding id="f236-duplicate" token="F236" status="live">\n    <Title>### F236 duplicate</Title>\n    <Body>duplicated carrier</Body>\n  </Finding>\n</Findings>`,
      ),
    );
    expect(() => expectCftCarrierRelations(recordDir)).toThrow(/at most one Finding element carries the token/);
  });
});

// ---------------------------------------------------------------------------
// C-PAYMENT-INTEGRITY: the payments' carrier and row walks. The carrier
// relation is payment-invariant (carrier-absent green, no layer pin, no payer
// pin); the row walk is exactly-once with the holder's status. Red fixtures
// mutate whichever layer holds the row. Written red-first: the row walk reds
// before the rows exist.
// ---------------------------------------------------------------------------

const CPI_PAYERS: Record<string, string> = {
  F185: "C-RETIRE-AND-CODIFY",
  F198: "C-PAYMENT-RECORD-2",
  F197: "C-PAYMENT-INTEGRITY",
  F244: "C-PAYMENT-INTEGRITY",
};

// The row's Pays clause is payment-invariant: it requires the tokens the row
// was minted to pay, with no exact-set pin, so a later lawful retired-row append
// (F244 on C-PAYMENT-INTEGRITY) stays green where an exact set expires
// (F225/F238's class).
const CPI_ROWS: Array<{ name: string; kind: string; requiredPays: string[] }> = [
  { name: "C-PAYMENT-RECORD-2", kind: "historical", requiredPays: ["F198"] },
  { name: "C-PAYMENT-INTEGRITY", kind: "chartered", requiredPays: ["F197"] },
];

function expectCpiCarrierAndRowRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of Object.keys(CPI_PAYERS)) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(carrier.node.attributes.status, `${token}: the carrier's status agrees with the holding file`).toBe(
        expectedStatus,
      );
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(entries[0]!.attributes.layer, `${token}: the carrier's index Entry layer agrees with the holding file`).toBe(
        expectedStatus,
      );
      if (expectedStatus === "retired") {
        expect(childText(carrier.node, "PaidBy"), `${token}: a retired carrier carries PaidBy ${CPI_PAYERS[token]}`).toBe(
          CPI_PAYERS[token],
        );
      }
    }
  }
  for (const spec of CPI_ROWS) {
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return childNodes(parsed.root!, "Row")
        .filter((row) => row.attributes.name === spec.name)
        .map((row) => ({ file, node: row }));
    });
    expect(
      hits.length,
      `${spec.name}: exactly one Row across the registry layers (got ${hits.length})`,
    ).toBe(1);
    const hit = hits[0]!;
    const holding = hit.file === "registry.xml" ? "live" : "retired";
    expect(hit.node.attributes.status, `${spec.name}: the row's status agrees with the holding file`).toBe(holding);
    expect(hit.node.attributes.kind, `${spec.name}: kind`).toBe(spec.kind);
    const paysTokens = (childText(hit.node, "Pays") ?? "").trim().split(/\s+/).filter(Boolean);
    for (const required of spec.requiredPays) {
      expect(paysTokens, `${spec.name}: Pays names ${required}`).toContain(required);
    }
  }
}

describe("C-PAYMENT-INTEGRITY carrier and row relations", () => {
  it(
    "F185, F198 and F197 each exist at most once across the findings pair with status and index layer agreeing and PaidBy matching the payer when retired, and C-PAYMENT-RECORD-2 and C-PAYMENT-INTEGRITY each exist exactly once across the registry layers with status agreeing and Pays exactly F198 / F197 (generous timeout)",
    () => {
      expectCpiCarrierAndRowRelations(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a second C-PAYMENT-INTEGRITY row reddens the exactly-once clause on a mutated copy of whichever layer holds it", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes('name="C-PAYMENT-INTEGRITY"')) continue;
      writeFileSync(
        path.join(recordDir, file),
        held.replace(
          "</Registry>",
          `  <Row name="C-PAYMENT-INTEGRITY" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F197</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
        ),
      );
    }
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return childNodes(parsed.root!, "Row").filter((row) => row.attributes.name === "C-PAYMENT-INTEGRITY");
    });
    expect(hits.length, "the mutated copy carries two C-PAYMENT-INTEGRITY rows").toBe(2);
    expect(() => expectCpiCarrierAndRowRelations(recordDir)).toThrow(/exactly one Row across the registry layers/);
  });
});

// ---------------------------------------------------------------------------
// C-GUARD-RATCHET: the flush's carrier and row walks. Payment-invariant:
// carrier-absent green, no layer pin, no payer pin; the row walk is
// exactly-once with the holder's status and a Pays that names its required
// tokens. Red fixtures mutate whichever layer holds the row (F229/F237's
// state-independent form).
// ---------------------------------------------------------------------------

const CGR_FINDING_PAYERS: Record<string, string> = {
  F222: "C-GUARD-RATCHET",
  F223: "C-GUARD-RATCHET",
};

const CGR_DECISION_IDS = ["d39"];

const CGR_ROW = { name: "C-GUARD-RATCHET", kind: "chartered", requiredPays: ["F222", "F223"] };

function expectCgrCarrierAndRowRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of Object.keys(CGR_FINDING_PAYERS)) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(carrier.node.attributes.status, `${token}: the carrier's status agrees with the holding file`).toBe(
        expectedStatus,
      );
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(entries[0]!.attributes.layer, `${token}: the carrier's index Entry layer agrees with the holding file`).toBe(
        expectedStatus,
      );
      if (expectedStatus === "retired") {
        expect(childText(carrier.node, "PaidBy"), `${token}: a retired carrier carries PaidBy ${CGR_FINDING_PAYERS[token]}`).toBe(
          CGR_FINDING_PAYERS[token],
        );
      }
    }
  }
  for (const id of CGR_DECISION_IDS) {
    const carriers = (["rulings.xml", "rulings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Decision" && node.attributes.id === id)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${id}: at most one Decision element carries the id across the two rulings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "rulings.xml" ? "live" : "retired";
      expect(carrier.node.attributes.status, `${id}: the carrier's status agrees with the holding file`).toBe(
        expectedStatus,
      );
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === id,
      );
      expect(entries.length, `${id}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(entries[0]!.attributes.layer, `${id}: the carrier's index Entry layer agrees with the holding file`).toBe(
        expectedStatus,
      );
      for (const coded of childNodes(carrier.node, "CodifiedIn")) {
        expect(coded.attributes.kind, `${id}: the CodifiedIn carries a kind`).toBeDefined();
        if (coded.attributes.kind === "test-suite") {
          expect(
            existsSync(path.join(REPO_ROOT, (coded.text ?? "").trim())),
            `${id}: the CodifiedIn test-suite path exists`,
          ).toBe(true);
        }
      }
    }
  }
  const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    return childNodes(parsed.root!, "Row")
      .filter((row) => row.attributes.name === CGR_ROW.name)
      .map((row) => ({ file, node: row }));
  });
  expect(
    hits.length,
    `${CGR_ROW.name}: exactly one Row across the registry layers (got ${hits.length})`,
  ).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.node.attributes.status, `${CGR_ROW.name}: the row's status agrees with the holding file`).toBe(holding);
  expect(hit.node.attributes.kind, `${CGR_ROW.name}: kind`).toBe(CGR_ROW.kind);
  const paysTokens = (childText(hit.node, "Pays") ?? "").trim().split(/\s+/).filter(Boolean);
  for (const required of CGR_ROW.requiredPays) {
    expect(paysTokens, `${CGR_ROW.name}: Pays names ${required}`).toContain(required);
  }
  const statusText = childText(hit.node, "StatusText") ?? "";
  for (const token of statusText.match(/F[0-9]+/g) ?? []) {
    expect(paysTokens, `${CGR_ROW.name}: StatusText names no F token outside Pays (${token})`).toContain(token);
  }
}

describe("C-GUARD-RATCHET carrier and row relations", () => {
  it(
    "F222 and F223 each exist at most once across the findings pair with status and index layer agreeing and PaidBy C-GUARD-RATCHET when retired, d39 at most once across the rulings pair with its index layer agreeing, and the C-GUARD-RATCHET row exactly once across the registry layers with status agreeing, kind chartered, Pays naming F222 and F223, and a StatusText naming no token outside Pays (generous timeout)",
    () => {
      expectCgrCarrierAndRowRelations(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a second C-GUARD-RATCHET row reddens the exactly-once clause on a mutated copy of whichever layer holds it", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "rulings.xml", "rulings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${CGR_ROW.name}"`)) continue;
      writeFileSync(
        path.join(recordDir, file),
        held.replace(
          "</Registry>",
          `  <Row name="${CGR_ROW.name}" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F222 F223</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
        ),
      );
    }
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return childNodes(parsed.root!, "Row").filter((row) => row.attributes.name === CGR_ROW.name);
    });
    expect(hits.length, `the mutated copy carries two ${CGR_ROW.name} rows`).toBe(2);
    expect(() => expectCgrCarrierAndRowRelations(recordDir)).toThrow(/exactly one Row across the registry layers/);
  });
});

// ---------------------------------------------------------------------------
// C-REVIEW-SELF-SCOPE-2 T-002: the payer row and the two carriers it pays.
// ---------------------------------------------------------------------------

const CSELF_FINDING_PAYERS: Record<string, string> = {
  F240: "C-REVIEW-SELF-SCOPE-2",
  F245: "C-REVIEW-SELF-SCOPE-2",
};

const CSELF_ROW = { name: "C-REVIEW-SELF-SCOPE-2", kind: "chartered", requiredPays: ["F240", "F245"] };

function expectCselfCarrierAndRowRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of Object.keys(CSELF_FINDING_PAYERS)) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(carrier.node.attributes.status, `${token}: the carrier's status agrees with the holding file`).toBe(
        expectedStatus,
      );
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(entries[0]!.attributes.layer, `${token}: the carrier's index Entry layer agrees with the holding file`).toBe(
        expectedStatus,
      );
      if (expectedStatus === "retired") {
        expect(childText(carrier.node, "PaidBy"), `${token}: a retired carrier carries PaidBy ${CSELF_FINDING_PAYERS[token]}`).toBe(
          CSELF_FINDING_PAYERS[token],
        );
      }
    }
  }
  const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    return childNodes(parsed.root!, "Row")
      .filter((row) => row.attributes.name === CSELF_ROW.name)
      .map((row) => ({ file, node: row }));
  });
  expect(
    hits.length,
    `${CSELF_ROW.name}: exactly one Row across the registry layers (got ${hits.length})`,
  ).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.node.attributes.status, `${CSELF_ROW.name}: the row's status agrees with the holding file`).toBe(holding);
  expect(hit.node.attributes.kind, `${CSELF_ROW.name}: kind`).toBe(CSELF_ROW.kind);
  const paysTokens = (childText(hit.node, "Pays") ?? "").trim().split(/\s+/).filter(Boolean);
  for (const required of CSELF_ROW.requiredPays) {
    expect(paysTokens, `${CSELF_ROW.name}: Pays names ${required}`).toContain(required);
  }
  const statusText = childText(hit.node, "StatusText") ?? "";
  for (const token of statusText.match(/F[0-9]+/g) ?? []) {
    expect(paysTokens, `${CSELF_ROW.name}: StatusText names no F token outside Pays (${token})`).toContain(token);
  }
}

describe("C-REVIEW-SELF-SCOPE-2 carrier and row relations", () => {
  it(
    "F240 and F245 each exist at most once across the findings pair with status and index layer agreeing and PaidBy C-REVIEW-SELF-SCOPE-2 when retired, and the C-REVIEW-SELF-SCOPE-2 row exactly once across the registry layers with status agreeing, kind chartered, Pays naming F240 and F245, and a StatusText naming no token outside Pays (generous timeout)",
    () => {
      expectCselfCarrierAndRowRelations(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a second C-REVIEW-SELF-SCOPE-2 row reddens the exactly-once clause on a mutated copy of whichever layer holds it", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${CSELF_ROW.name}"`)) continue;
      writeFileSync(
        path.join(recordDir, file),
        held.replace(
          "</Registry>",
          `  <Row name="${CSELF_ROW.name}" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F240 F245</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
        ),
      );
    }
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return childNodes(parsed.root!, "Row").filter((row) => row.attributes.name === CSELF_ROW.name);
    });
    expect(hits.length, `the mutated copy carries two ${CSELF_ROW.name} rows`).toBe(2);
    expect(() => expectCselfCarrierAndRowRelations(recordDir)).toThrow(/exactly one Row across the registry layers/);
  });
});
// ---------------------------------------------------------------------------
// C-TEACH-DRIVE-BEFORE-APPROVE-2 T-001: the flush-invariant carrier walk.
// ---------------------------------------------------------------------------

function expectCtdbaFlushInvariant(recordDir: string): void {
  const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(recordDir, "findings.xml"), "utf8"));
  const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8"));
  const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(recordDir, "decisions.xml"), "utf8"));
  expect(liveParsed.root, "findings.xml parses").not.toBeNull();
  expect(retiredParsed.root, "findings-retired.xml parses").not.toBeNull();
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const id of ["f246", "f247", "f248", "f249"]) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.id === id)
        .map((node) => ({ file, node }));
    });
    expect(carriers.length, `${id}: exactly one Finding element across the findings pair (got ${carriers.length})`).toBe(1);
    const { file, node } = carriers[0]!;
    const expectedStatus = file === "findings.xml" ? "live" : "retired";
    expect(node.attributes.status, `${id}: the carrier's status agrees with the holding file (${file})`).toBe(expectedStatus);
    expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`F${id.slice(1)}`);
    const entries = [...walkNodes(indexParsed.root!)].filter((entry) => entry.tag === "Entry" && entry.attributes.id === id);
    expect(entries.length, `${id}: exactly one Entry for the id`).toBe(1);
    expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("finding");
    expect(entries[0]!.attributes.layer, `${id}: the Entry's layer agrees with the holding file`).toBe(expectedStatus);
  }
  const findingsText = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
  const findingsRoot = parseGraceXmlArtifact("findings.xml", findingsText).root!;
  const base = Number(findingsRoot.attributes.base);
  const headroom = Number(findingsRoot.attributes.headroom);
  const ceiling = Number(findingsRoot.attributes.ceiling);
  expect(base, "findings.xml: base equals the file's newlineCount").toBe(newlineCount(findingsText));
  expect(base + headroom, "findings.xml: base + headroom = ceiling").toBe(ceiling);
}

describe("C-TEACH-DRIVE-BEFORE-APPROVE-2 flush invariant", () => {
  it(
    "the four flushed ids are exactly once across the findings pair with agreeing status, token, index genre and layer, and the findings root satisfies base + headroom = ceiling (generous timeout)",
    () => {
      expectCtdbaFlushInvariant(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a duplicated carrier reddens the at-most-once flush clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    const held = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
    writeFileSync(
      path.join(recordDir, "findings.xml"),
      held.replace("</Findings>", `  <Finding id="f246" token="F246" status="live">\n    <Title>dup</Title>\n    <Body>dup</Body>\n  </Finding>\n</Findings>`),
    );
    expect(() => expectCtdbaFlushInvariant(recordDir)).toThrow(/exactly one Finding element across the findings pair/);
  });
});
// ---------------------------------------------------------------------------
// C-TEACH-DRIVE-BEFORE-APPROVE-2 T-001: the carrier/row walk.
// ---------------------------------------------------------------------------

const CTDBA_FINDING_PAYERS: Record<string, string> = {
  F243: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F246: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F247: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F248: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  F249: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
};

const CTDBA_ROW = {
  name: "C-TEACH-DRIVE-BEFORE-APPROVE-2",
  kind: "chartered",
  requiredPays: ["F243", "F246", "F247", "F248", "F249"],
};

function expectCtdbaCarrierAndRowRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of Object.keys(CTDBA_FINDING_PAYERS)) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(carrier.node.attributes.status, `${token}: the carrier's status agrees with the holding file`).toBe(expectedStatus);
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(entries[0]!.attributes.layer, `${token}: the carrier's index Entry layer agrees with the holding file`).toBe(expectedStatus);
      if (expectedStatus === "retired") {
        expect(childText(carrier.node, "PaidBy"), `${token}: a retired carrier carries PaidBy ${CTDBA_FINDING_PAYERS[token]}`).toBe(CTDBA_FINDING_PAYERS[token]);
      }
    }
  }
  const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    return childNodes(parsed.root!, "Row")
      .filter((row) => row.attributes.name === CTDBA_ROW.name)
      .map((row) => ({ file, node: row }));
  });
  expect(hits.length, `${CTDBA_ROW.name}: exactly one Row across the registry layers (got ${hits.length})`).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.node.attributes.status, `${CTDBA_ROW.name}: the row's status agrees with the holding file`).toBe(holding);
  expect(hit.node.attributes.kind, `${CTDBA_ROW.name}: kind`).toBe(CTDBA_ROW.kind);
  const paysTokens = (childText(hit.node, "Pays") ?? "").trim().split(/\s+/).filter(Boolean);
  for (const required of CTDBA_ROW.requiredPays) {
    expect(paysTokens, `${CTDBA_ROW.name}: Pays names ${required}`).toContain(required);
  }
  const statusText = childText(hit.node, "StatusText") ?? "";
  for (const token of statusText.match(/F[0-9]+/g) ?? []) {
    expect(paysTokens, `${CTDBA_ROW.name}: StatusText names no F token outside Pays (${token})`).toContain(token);
  }
}

describe("C-TEACH-DRIVE-BEFORE-APPROVE-2 carrier and row relations", () => {
  it(
    "F243 F246 F247 F248 F249 each exist at most once across the findings pair with status and index layer agreeing and PaidBy C-TEACH-DRIVE-BEFORE-APPROVE-2 when retired, and the C-TEACH-DRIVE-BEFORE-APPROVE-2 row exactly once across the registry layers with status agreeing, kind chartered, Pays containing the five tokens, and a StatusText naming no token outside Pays (generous timeout)",
    () => {
      expectCtdbaCarrierAndRowRelations(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it(
    "the shipped validateStubAndIndex and proveRecordPreservation return zero on the production record (generous timeout)",
    () => {
      expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md")).length).toBe(0);
      expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL)).length).toBe(0);
    },
  );

  it("red direction — a second C-TEACH-DRIVE-BEFORE-APPROVE-2 row reddens the exactly-once clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${CTDBA_ROW.name}"`)) continue;
      writeFileSync(
        path.join(recordDir, file),
        held.replace(
          "</Registry>",
          `  <Row name="${CTDBA_ROW.name}" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F243 F246 F247 F248 F249</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
        ),
      );
    }
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return childNodes(parsed.root!, "Row").filter((row) => row.attributes.name === CTDBA_ROW.name);
    });
    expect(hits.length, `the mutated copy carries two ${CTDBA_ROW.name} rows`).toBe(2);
    expect(() => expectCtdbaCarrierAndRowRelations(recordDir)).toThrow(/exactly one Row across the registry layers/);
  });

  it("red direction — a StatusText naming a token outside Pays reddens the prose law", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${CTDBA_ROW.name}"`)) continue;
      const rowStart = held.indexOf(`<Row name="${CTDBA_ROW.name}"`);
      const rowEnd = held.indexOf("</Row>", rowStart);
      const rowBlock = held.slice(rowStart, rowEnd);
      expect(rowBlock.includes("<StatusText>"), "the mutation targets the row's StatusText").toBe(true);
      writeFileSync(
        path.join(recordDir, file),
        held.slice(0, rowStart) + rowBlock.replace("<StatusText>", "<StatusText>F999 ") + held.slice(rowEnd),
      );
    }
    expect(() => expectCtdbaCarrierAndRowRelations(recordDir)).toThrow(/StatusText names no F token outside Pays/);
  });
});

const CHBI_ROW_NAME = "C-HASHED-BUNDLE-IDS-2";

function expectChbiCarrierAndRowRelations(recordDir: string): void {
  const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    return childNodes(parsed.root!, "Row")
      .filter((row) => row.attributes.name === CHBI_ROW_NAME)
      .map((row) => ({ file, node: row }));
  });
  expect(hits.length, `${CHBI_ROW_NAME}: exactly one Row across the registry layers (got ${hits.length})`).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.node.attributes.status, `${CHBI_ROW_NAME}: the row's status agrees with the holding file`).toBe(holding);
  expect(hit.node.attributes.kind, `${CHBI_ROW_NAME}: kind`).toBe("chartered");
  const paysTokens = (childText(hit.node, "Pays") ?? "").trim().split(/\s+/).filter(Boolean);
  expect(paysTokens, `${CHBI_ROW_NAME}: Pays is empty`).toHaveLength(0);
  const statusText = childText(hit.node, "StatusText") ?? "";
  for (const token of statusText.match(/F[0-9]+/g) ?? []) {
    expect(paysTokens, `${CHBI_ROW_NAME}: StatusText names no F token outside Pays (${token})`).toContain(token);
  }
}

function expectD38Codification(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(recordDir, "decisions.xml"), "utf8"));
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  const carriers = (["rulings.xml", "rulings-retired.xml"] as const).flatMap((file) => {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    return childNodes(parsed.root!, "Decision")
      .filter((node) => node.attributes.id === "d38")
      .map((node) => ({ file, node }));
  });
  expect(carriers.length, "D38: exactly one Decision across the rulings layers").toBe(1);
  const carrier = carriers[0]!;
  const holding = carrier.file === "rulings.xml" ? "live" : "retired";
  expect(carrier.node.attributes.status, "D38: status agrees with the holding file").toBe(holding);
  const entries = childNodes(indexParsed.root!, "Entry").filter((node) => node.attributes.id === "d38");
  expect(entries.length, "D38: the index carries exactly one Entry").toBe(1);
  expect(entries[0]!.attributes.genre, "D38: index genre").toBe("decision");
  expect(entries[0]!.attributes.layer, "D38: index layer agrees with the holding file").toBe(holding);
  if (holding === "retired") {
    const codified = childNodes(carrier.node, "CodifiedIn").filter((node) => node.attributes.kind === "test-suite");
    expect(codified.length, "D38: at least two resolving CodifiedIn test-suite children").toBeGreaterThanOrEqual(2);
    const paths = codified.map((node) => node.text.trim());
    expect(paths).toContain("src/grace-generate.test.ts");
    expect(paths).toContain("src/grace-supersede.test.ts");
  }
}

describe("C-HASHED-BUNDLE-IDS-2 carrier and row relations", () => {
  it(
    "the C-HASHED-BUNDLE-IDS-2 row exists exactly once across the registry layers with status agreeing, kind chartered, an empty Pays, and a StatusText naming no token outside Pays (generous timeout)",
    () => {
      expectChbiCarrierAndRowRelations(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a second C-HASHED-BUNDLE-IDS-2 row reddens the exactly-once clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "rulings.xml", "rulings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${CHBI_ROW_NAME}"`)) continue;
      writeFileSync(
        path.join(recordDir, file),
        held.replace(
          "</Registry>",
          `  <Row name="${CHBI_ROW_NAME}" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays></Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
        ),
      );
    }
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return childNodes(parsed.root!, "Row").filter((row) => row.attributes.name === CHBI_ROW_NAME);
    });
    expect(hits.length, `the mutated copy carries two ${CHBI_ROW_NAME} rows`).toBe(2);
    expect(() => expectChbiCarrierAndRowRelations(recordDir)).toThrow(/exactly one Row across the registry layers/);
  });

  it("red direction — a StatusText naming a token outside Pays reddens the prose law", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "rulings.xml", "rulings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${CHBI_ROW_NAME}"`)) continue;
      const rowStart = held.indexOf(`<Row name="${CHBI_ROW_NAME}"`);
      const rowEnd = held.indexOf("</Row>", rowStart);
      const rowBlock = held.slice(rowStart, rowEnd);
      expect(rowBlock.includes("<StatusText>"), "the mutation targets the row's StatusText").toBe(true);
      writeFileSync(
        path.join(recordDir, file),
        held.slice(0, rowStart) + rowBlock.replace("<StatusText>", "<StatusText>F999 ") + held.slice(rowEnd),
      );
    }
    expect(() => expectChbiCarrierAndRowRelations(recordDir)).toThrow(/StatusText names no F token outside Pays/);
  });
});

describe("D38 codification", () => {
  it(
    "D38 exists exactly once across the rulings pair with status and index layer agreeing, and a retired D38 carries at least two resolving CodifiedIn test-suite children (generous timeout)",
    () => {
      expectD38Codification(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a retired D38 with fewer than two CodifiedIn children reddens the codification clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "rulings.xml", "rulings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    const holders = (["rulings.xml", "rulings-retired.xml"] as const).filter((file) =>
      readFileSync(path.join(recordDir, file), "utf8").includes('<Decision id="d38"'),
    );
    expect(holders.length, "the production record carries D38 in exactly one rulings layer").toBe(1);
    const held = holders[0]!;
    const heldPath = path.join(recordDir, held);
    const heldText = readFileSync(heldPath, "utf8");
    const decision = heldText.match(/<Decision id="d38"[\s\S]*?<\/Decision>\n?/);
    expect(decision, "D38 parses").not.toBeNull();
    const stripped = decision![0].replace(/<CodifiedIn[\s\S]*?<\/CodifiedIn>\s*/g, "");
    if (held === "rulings.xml") {
      writeFileSync(heldPath, heldText.replace(decision![0], ""));
      const retiredPath = path.join(recordDir, "rulings-retired.xml");
      writeFileSync(
        retiredPath,
        readFileSync(retiredPath, "utf8").replace("</Rulings>", `${stripped.replace('status="live"', 'status="retired"')}</Rulings>`),
      );
      const indexPath = path.join(recordDir, "decisions.xml");
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace(/(<Entry id="d38"[^>]*layer=")live(")/, "$1retired$2"),
      );
    } else {
      writeFileSync(heldPath, heldText.replace(decision![0], stripped));
    }
    expect(() => expectD38Codification(recordDir)).toThrow(/at least two resolving CodifiedIn/);
  });
});

// ---------------------------------------------------------------------------
// C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 T-004: the flush-invariant carrier walk.
// ---------------------------------------------------------------------------

function expectPairFlushInvariant(recordDir: string): void {
  const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(recordDir, "findings.xml"), "utf8"));
  const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(recordDir, "findings-retired.xml"), "utf8"));
  const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(recordDir, "decisions.xml"), "utf8"));
  expect(liveParsed.root, "findings.xml parses").not.toBeNull();
  expect(retiredParsed.root, "findings-retired.xml parses").not.toBeNull();
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const id of ["f250", "f251"]) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.id === id)
        .map((node) => ({ file, node }));
    });
    expect(carriers.length, `${id}: exactly one Finding element across the findings pair (got ${carriers.length})`).toBe(1);
    const { file, node } = carriers[0]!;
    const expectedStatus = file === "findings.xml" ? "live" : "retired";
    expect(node.attributes.status, `${id}: the carrier's status agrees with the holding file (${file})`).toBe(expectedStatus);
    expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`F${id.slice(1)}`);
    const entries = [...walkNodes(indexParsed.root!)].filter((entry) => entry.tag === "Entry" && entry.attributes.id === id);
    expect(entries.length, `${id}: exactly one Entry for the id`).toBe(1);
    expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("finding");
    expect(entries[0]!.attributes.layer, `${id}: the Entry's layer agrees with the holding file`).toBe(expectedStatus);
  }
  const findingsText = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
  const findingsRoot = parseGraceXmlArtifact("findings.xml", findingsText).root!;
  const base = Number(findingsRoot.attributes.base);
  const headroom = Number(findingsRoot.attributes.headroom);
  const ceiling = Number(findingsRoot.attributes.ceiling);
  expect(base, "findings.xml: base equals the file's newlineCount").toBe(newlineCount(findingsText));
  expect(base + headroom, "findings.xml: base + headroom = ceiling").toBe(ceiling);
}

describe("C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 flush invariant", () => {
  it(
    "the two flushed ids are exactly once across the findings pair with agreeing status, token, index genre and layer, and the findings root satisfies base + headroom = ceiling (generous timeout)",
    () => {
      expectPairFlushInvariant(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it("red direction — a duplicated carrier reddens the at-most-once flush clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    const held = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
    writeFileSync(
      path.join(recordDir, "findings.xml"),
      held.replace("</Findings>", `  <Finding id="f250" token="F250" status="live">\n    <Title>dup</Title>\n    <Body>dup</Body>\n  </Finding>\n</Findings>`),
    );
    expect(() => expectPairFlushInvariant(recordDir)).toThrow(/exactly one Finding element across the findings pair/);
  });
});

// ---------------------------------------------------------------------------
// C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 T-004: the carrier/row walk.
// ---------------------------------------------------------------------------

const PAIR_FINDING_PAYERS: Record<string, string> = {
  F250: "C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22",
  F251: "C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22",
};

const PAIR_ROW = {
  name: "C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22",
  kind: "chartered",
  requiredPays: ["F250", "F251"],
};

function expectPairCarrierAndRowRelations(recordDir: string): void {
  const indexParsed = parseGraceXmlArtifact(
    "decisions.xml",
    readFileSync(path.join(recordDir, "decisions.xml"), "utf8"),
  );
  expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
  for (const token of Object.keys(PAIR_FINDING_PAYERS)) {
    const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      expect(parsed.root, `${file} parses`).not.toBeNull();
      return [...walkNodes(parsed.root!)]
        .filter((node) => node.tag === "Finding" && node.attributes.token === token)
        .map((node) => ({ file, node }));
    });
    expect(
      carriers.length,
      `${token}: at most one Finding element carries the token across the two findings files (got ${carriers.length})`,
    ).toBeLessThanOrEqual(1);
    for (const carrier of carriers) {
      const expectedStatus = carrier.file === "findings.xml" ? "live" : "retired";
      expect(carrier.node.attributes.status, `${token}: the carrier's status agrees with the holding file`).toBe(expectedStatus);
      const entries = [...walkNodes(indexParsed.root!)].filter(
        (node) => node.tag === "Entry" && node.attributes.id === carrier.node.attributes.id,
      );
      expect(entries.length, `${token}: the index carries exactly one Entry for the carrier's id`).toBe(1);
      expect(entries[0]!.attributes.layer, `${token}: the carrier's index Entry layer agrees with the holding file`).toBe(expectedStatus);
      if (expectedStatus === "retired") {
        expect(childText(carrier.node, "PaidBy"), `${token}: a retired carrier carries PaidBy ${PAIR_FINDING_PAYERS[token]}`).toBe(PAIR_FINDING_PAYERS[token]);
      }
    }
  }
  const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
    const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
    expect(parsed.root, `${file} parses`).not.toBeNull();
    return childNodes(parsed.root!, "Row")
      .filter((row) => row.attributes.name === PAIR_ROW.name)
      .map((row) => ({ file, node: row }));
  });
  expect(hits.length, `${PAIR_ROW.name}: exactly one Row across the registry layers (got ${hits.length})`).toBe(1);
  const hit = hits[0]!;
  const holding = hit.file === "registry.xml" ? "live" : "retired";
  expect(hit.node.attributes.status, `${PAIR_ROW.name}: the row's status agrees with the holding file`).toBe(holding);
  expect(hit.node.attributes.kind, `${PAIR_ROW.name}: kind`).toBe(PAIR_ROW.kind);
  const paysTokens = (childText(hit.node, "Pays") ?? "").trim().split(/\s+/).filter(Boolean);
  for (const required of PAIR_ROW.requiredPays) {
    expect(paysTokens, `${PAIR_ROW.name}: Pays names ${required}`).toContain(required);
  }
  const statusText = childText(hit.node, "StatusText") ?? "";
  for (const token of statusText.match(/F[0-9]+/g) ?? []) {
    expect(paysTokens, `${PAIR_ROW.name}: StatusText names no F token outside Pays (${token})`).toContain(token);
  }
}

describe("C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 carrier and row relations", () => {
  it(
    "F250 and F251 each exist at most once across the findings pair with status and index layer agreeing and PaidBy C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 when retired, and the row exactly once across the registry layers with status agreeing, kind chartered, Pays containing the two tokens, and a StatusText naming no token outside Pays (generous timeout)",
    () => {
      expectPairCarrierAndRowRelations(path.join(REPO_ROOT, RECORD_REL));
    },
  );

  it(
    "the shipped validateStubAndIndex and proveRecordPreservation return zero on the production record (generous timeout)",
    () => {
      expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md")).length).toBe(0);
      expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL)).length).toBe(0);
    },
  );

  it("red direction — a second C-PAIR-AUDIT-MINT-CWD-1-ED6B7D22 row reddens the exactly-once clause", () => {
    const root = isolatedRoot();
    const recordDir = path.join(root, RECORD_REL);
    mkdirSync(recordDir, { recursive: true });
    for (const file of ["registry.xml", "registry-retired.xml", "findings.xml", "findings-retired.xml", "decisions.xml"]) {
      copyFileSync(path.join(REPO_ROOT, RECORD_REL, file), path.join(recordDir, file));
    }
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const held = readFileSync(path.join(recordDir, file), "utf8");
      if (!held.includes(`name="${PAIR_ROW.name}"`)) continue;
      writeFileSync(
        path.join(recordDir, file),
        held.replace(
          "</Registry>",
          `  <Row name="${PAIR_ROW.name}" status="live" kind="chartered">\n    <Number></Number>\n    <Charter>duplicate</Charter>\n    <Pays>F250 F251</Pays>\n    <StatusText>Ordered</StatusText>\n  </Row>\n</Registry>`,
        ),
      );
    }
    const hits = (["registry.xml", "registry-retired.xml"] as const).flatMap((file) => {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8"));
      return childNodes(parsed.root!, "Row").filter((row) => row.attributes.name === PAIR_ROW.name);
    });
    expect(hits.length, `the mutated copy carries two ${PAIR_ROW.name} rows`).toBe(2);
    expect(() => expectPairCarrierAndRowRelations(recordDir)).toThrow(/exactly one Row across the registry layers/);
  });
});

describe("C-TEACH-PLAN-DRIVES-CORRECTIONS-2-1E59AEAA flush invariant", () => {
  it("the two flushed ids are exactly once across the findings pair with status, token, index genre and layer agreeing, and the roots arithmetic holds", () => {
    const flushed = ["f253", "f254"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((n) => n.tag === "Finding" && n.attributes.id === id).map((n) => ({ file, node: n }));
      });
      expect(carriers.length, id).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, id).toBe(expectedStatus);
      expect(node.attributes.token, id).toBe("F" + id.slice(1));
      const entries = [...walkNodes(indexParsed.root!)].filter((e) => e.tag === "Entry" && e.attributes.id === id);
      expect(entries.length, id).toBe(1);
      expect(entries[0]!.attributes.genre, id).toBe("finding");
      expect(entries[0]!.attributes.layer, id).toBe(expectedStatus);
      const body = childText(node, "Body") ?? "";
      const lines = body.split("\n");
      let i = lines.length - 1;
      while (i >= 0 && lines[i]!.trim() === "") i--;
      expect(lines[i]?.trim(), id + " separator tail").not.toBe("---");
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const root = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    expect(Number(root.attributes.base)).toBe(newlineCount(findingsText));
    expect(Number(root.attributes.base) + Number(root.attributes.headroom)).toBe(Number(root.attributes.ceiling));
    expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md"))).toEqual([]);
    expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL))).toEqual([]);
  });

  it("the row is exactly once across the registry layers with Pays containing F253 and F254 and StatusText naming no F token outside Pays", () => {
    const rowName = "C-TEACH-PLAN-DRIVES-CORRECTIONS-2-1E59AEAA";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    expect(pays).toContain("F253");
    expect(pays).toContain("F254");
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA T-001: the flush-invariant walk for the
// three findings this bundle pays, and the row walk. House form copied from the
// C-TEACH-PLAN-DRIVES-CORRECTIONS-2 flush invariant above.
// ---------------------------------------------------------------------------
describe("C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA flush invariant", () => {
  it("f255, f256 and f257 each exist exactly once across the findings pair with status, token, index genre and layer agreeing, no separator tail, and the roots arithmetic holds", () => {
    const flushed = ["f255", "f256", "f257"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((n) => n.tag === "Finding" && n.attributes.id === id).map((n) => ({ file, node: n }));
      });
      expect(carriers.length, id).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, id).toBe(expectedStatus);
      expect(node.attributes.token, id).toBe("F" + id.slice(1));
      const entries = [...walkNodes(indexParsed.root!)].filter((e) => e.tag === "Entry" && e.attributes.id === id);
      expect(entries.length, id).toBe(1);
      expect(entries[0]!.attributes.genre, id).toBe("finding");
      expect(entries[0]!.attributes.layer, id).toBe(expectedStatus);
      const body = childText(node, "Body") ?? "";
      const lines = body.split("\n");
      let i = lines.length - 1;
      while (i >= 0 && lines[i]!.trim() === "") i--;
      expect(lines[i]?.trim(), id + " separator tail").not.toBe("---");
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const root = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    expect(Number(root.attributes.base)).toBe(newlineCount(findingsText));
    expect(Number(root.attributes.base) + Number(root.attributes.headroom)).toBe(Number(root.attributes.ceiling));
    expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md"))).toEqual([]);
    expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL))).toEqual([]);
  });
});

describe("C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA row relations", () => {
  it("the row is exactly once across the registry layers with Pays containing F255, F256 and F257 and StatusText naming no F token outside Pays", () => {
    const rowName = "C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    expect(pays).toContain("F255");
    expect(pays).toContain("F256");
    expect(pays).toContain("F257");
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F T-001: the flush-invariant walk for the
// five findings this bundle pays. House form copied from the
// C-EXPLAIN-ANCHOR-COMMANDS-1-FC0ED3DA flush invariant above.
// ---------------------------------------------------------------------------
describe("C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F flush invariant", () => {
  it("f258, f259, f260, f261 and f262 each exist exactly once across the findings pair with status, token, index genre and layer agreeing, no separator tail, and the roots arithmetic holds", () => {
    const flushed = ["f258", "f259", "f260", "f261", "f262"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((n) => n.tag === "Finding" && n.attributes.id === id).map((n) => ({ file, node: n }));
      });
      expect(carriers.length, id).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, id).toBe(expectedStatus);
      expect(node.attributes.token, id).toBe("F" + id.slice(1));
      const entries = [...walkNodes(indexParsed.root!)].filter((e) => e.tag === "Entry" && e.attributes.id === id);
      expect(entries.length, id).toBe(1);
      expect(entries[0]!.attributes.genre, id).toBe("finding");
      expect(entries[0]!.attributes.layer, id).toBe(expectedStatus);
      const body = childText(node, "Body") ?? "";
      const lines = body.split("\n");
      let i = lines.length - 1;
      while (i >= 0 && lines[i]!.trim() === "") i--;
      expect(lines[i]?.trim(), id + " separator tail").not.toBe("---");
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const root = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    expect(Number(root.attributes.base)).toBe(newlineCount(findingsText));
    expect(Number(root.attributes.base) + Number(root.attributes.headroom)).toBe(Number(root.attributes.ceiling));
    expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md"))).toEqual([]);
    expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL))).toEqual([]);
  });
});

describe("C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F row relations", () => {
  it("the row is exactly once across the registry layers with Pays containing F258, F259, F260, F261 and F262 and StatusText naming no F token outside Pays", () => {
    const rowName = "C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    expect(pays).toContain("F258");
    expect(pays).toContain("F259");
    expect(pays).toContain("F260");
    expect(pays).toContain("F261");
    expect(pays).toContain("F262");
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// C-STATUS-TEST-TIMEOUT-1-E7DA46E8 T-001: the flush-invariant walk for F263.
// House form copied from the C-TEACH-COPY-DRIVES-LINEAGE-1 flush invariant above.
// ---------------------------------------------------------------------------
describe("C-STATUS-TEST-TIMEOUT-1-E7DA46E8 flush invariant", () => {
  it("f263 exists exactly once across the findings pair with status, token, index genre and layer agreeing, no separator tail, and the roots arithmetic holds", () => {
    const flushed = ["f263"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((n) => n.tag === "Finding" && n.attributes.id === id).map((n) => ({ file, node: n }));
      });
      expect(carriers.length, id).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, id).toBe(expectedStatus);
      expect(node.attributes.token, id).toBe("F" + id.slice(1));
      const entries = [...walkNodes(indexParsed.root!)].filter((e) => e.tag === "Entry" && e.attributes.id === id);
      expect(entries.length, id).toBe(1);
      expect(entries[0]!.attributes.genre, id).toBe("finding");
      expect(entries[0]!.attributes.layer, id).toBe(expectedStatus);
      const body = childText(node, "Body") ?? "";
      const lines = body.split("\n");
      let i = lines.length - 1;
      while (i >= 0 && lines[i]!.trim() === "") i--;
      expect(lines[i]?.trim(), id + " separator tail").not.toBe("---");
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const root = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    expect(Number(root.attributes.base)).toBe(newlineCount(findingsText));
    expect(Number(root.attributes.base) + Number(root.attributes.headroom)).toBe(Number(root.attributes.ceiling));
    expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md"))).toEqual([]);
    expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL))).toEqual([]);
  });
});


describe("C-STATUS-TEST-TIMEOUT-1-E7DA46E8 row relations", () => {
  it("the row is exactly once across the registry layers with Pays containing F263 and StatusText naming no F token outside Pays", () => {
    const rowName = "C-STATUS-TEST-TIMEOUT-1-E7DA46E8";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    expect(pays).toContain("F263");
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});

describe("C-SCRIPTS-ADOPTION-2-36DEB1BD flush relations", () => {
  it("F264 is exactly once across the findings pair with its status, token and index Entry agreeing", () => {
    const flushed = ["f264"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    expect(liveParsed.root, "findings.xml parses").not.toBeNull();
    expect(retiredParsed.root, "findings-retired.xml parses").not.toBeNull();
    expect(indexParsed.root, "decisions.xml parses").not.toBeNull();
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((node) => node.tag === "Finding" && node.attributes.id === id).map((node) => ({ file, node }));
      });
      expect(carriers.length, `${id}: exactly one Finding element across the findings pair (got ${carriers.length})`).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, `${id}: the carrier's status agrees with the holding file (${file})`).toBe(expectedStatus);
      expect(node.attributes.token, `${id}: the carrier's token agrees with the id`).toBe(`F${id.slice(1)}`);
      const entries = [...walkNodes(indexParsed.root!)].filter((entry) => entry.tag === "Entry" && entry.attributes.id === id);
      expect(entries.length, `${id}: exactly one Entry for the id (duplicate would walk two)`).toBe(1);
      expect(entries[0]!.attributes.genre, `${id}: the Entry's genre agrees`).toBe("finding");
      expect(entries[0]!.attributes.layer, `${id}: the Entry's layer agrees with the holding file`).toBe(expectedStatus);
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const findingsRoot = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    const base = Number(findingsRoot.attributes.base);
    const headroom = Number(findingsRoot.attributes.headroom);
    const ceiling = Number(findingsRoot.attributes.ceiling);
    expect(base, "findings.xml: base equals the file's newlineCount").toBe(newlineCount(findingsText));
    expect(base + headroom, "findings.xml: base + headroom = ceiling").toBe(ceiling);
  });
});

describe("C-SCRIPTS-ADOPTION-2-36DEB1BD row relations", () => {
  it("the chartered row is live exactly once, pays F242 and F264, and carries both searched-before-minting halves", () => {
    const rowName = "C-SCRIPTS-ADOPTION-2-36DEB1BD";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    expect(pays).toContain("F242");
    expect(pays).toContain("F264");
    const charter = childText(node as never, "Charter") ?? "";
    expect(charter).toContain("mint-search: 1 active, 0 archive prior bundle(s) share slug SCRIPTS-ADOPTION");
    expect(charter).toContain("scripts");
    expect(charter).toContain("tsconfig.json");
    expect(charter).toContain(".ngrace-lint.json");
    expect(charter).toContain("scripts/release-check.ts");
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});

/** Every .xml file in a copied record, found by walking the directory, never by a name chosen in advance. */
function recordXmlFilesIn(root: string): Array<{ name: string; file: string; xml: string }> {
  const dir = path.join(root, RECORD_REL);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".xml"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return { name, file, xml: readFileSync(file, "utf8") };
    });
}

/** Locates a record file by walking the copied record for an element, never by a file name. */
function recordFileHolding(
  root: string,
  tag: string,
  where?: (node: GraceXmlNode) => boolean,
): { name: string; file: string; xml: string } {
  for (const entry of recordXmlFilesIn(root)) {
    const parsed = parseGraceXmlArtifact(entry.name, entry.xml).root;
    if (parsed && [...walkNodes(parsed)].some((node) => node.tag === tag && (where ? where(node) : true))) {
      return entry;
    }
  }
  throw new Error(`no copied record file carries <${tag}>`);
}

function schemaCodes(file: string, filename: string, xml: string): string[] {
  return recordSchemaViolations(file, parseGraceXmlArtifact(filename, xml).root).map((v) => v.code);
}

describe("record schema and canonical serializer (C-RECORD-SCHEMA-2)", () => {
  it("refuses a write-mode run on a planted nested Finding, before any write", () => {
    const root = isolatedRoot();
    const nested = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 - live</Title>
    <Body>body
      <Finding id="f9" token="F9" status="live"><Title>### F9</Title><Body>nested</Body></Finding>
    </Body>
  </Finding>
</Findings>
`;
    writeHappy(root, { findings: nested });
    const before = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const result = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/record-shape-(same-tag-nested|genre-not-direct-child)/);
    expect(readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8")).toBe(before);
  });

  it("reports the schema violations for a missing required child and an unexpected child", () => {
    const root = isolatedRoot();
    writeHappy(root, {
      findings: `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1</Title>
    <Bogus>no body</Bogus>
  </Finding>
</Findings>
`,
    });
    const file = path.join(root, RECORD_REL, "findings.xml");
    const xml = readFileSync(file, "utf8");
    const codes = recordSchemaViolations(file, parseGraceXmlArtifact(file, xml).root).map((v) => v.code);
    expect(codes).toContain("record-schema-unexpected-child");
    expect(codes).toContain("record-schema-missing-child");
    expect(() => assertRecordSchema(file, xml)).toThrow(/record schema/);
  });

  it("is idempotent: serialize(serialize(x)) is byte-equal to serialize(x) over the seven goldens and a non-canonical document", () => {
    const goldenDir = path.join(REPO_ROOT, "scripts/fixtures/record-parse/golden");
    const names = [
      "findings.xml",
      "findings-retired.xml",
      "rulings.xml",
      "rulings-retired.xml",
      "registry.xml",
      "registry-retired.xml",
      "decisions.xml",
    ];
    for (const name of names) {
      const file = path.join(goldenDir, name);
      const once = serializeRecordDocument(file, readFileSync(file, "utf8"));
      expect(serializeRecordDocument(file, once), `${name}: idempotent`).toBe(once);
    }
    const drift = `<Findings base="1" headroom="1" ceiling="2">
    <Finding id="f1" token="F1" status="live">
        <Title>### F1</Title>
      <Body>body</Body>
    </Finding>
</Findings>
`;
    const once = serializeRecordDocument("fixture-findings.xml", drift);
    expect(once).toContain("\n  <Finding");
    expect(serializeRecordDocument("fixture-findings.xml", once)).toBe(once);
  });

  it("is canonical at rest over the seven live record files", () => {
    const recordDir = path.join(REPO_ROOT, RECORD_REL);
    for (const name of [
      "findings.xml",
      "findings-retired.xml",
      "rulings.xml",
      "rulings-retired.xml",
      "registry.xml",
      "registry-retired.xml",
      "decisions.xml",
    ]) {
      const file = path.join(recordDir, name);
      const xml = readFileSync(file, "utf8");
      expect(serializeRecordDocument(file, xml), `${name}: canonical at rest`).toBe(xml);
    }
  });

  it("reddens canonical-at-rest when a non-canonical byte is planted in a copy", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const file = path.join(root, RECORD_REL, "findings.xml");
    const planted = readFileSync(file, "utf8").replace('  <Finding id="f1"', '    <Finding id="f1"');
    writeFileSync(file, planted);
    expect(serializeRecordDocument(file, planted)).not.toBe(planted);
  });

  it("canonicalizes declared attribute order — a Row with kind first is not canonical", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "Row");
    const mutated = entry.xml.replace(
      /<Row name="([^"]*)" status="([^"]*)" kind="([^"]*)">/,
      '<Row kind="$3" name="$1" status="$2">',
    );
    expect(mutated, "the plant must change the open tag").not.toBe(entry.xml);
    const once = serializeRecordDocument(entry.file, mutated);
    expect(once).not.toBe(mutated);
    expect(once, "the canonical open tag is restored").toBe(entry.xml);
  });

  it("canonicalizes declared attribute order — an Entry with layer first is not canonical", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "Entry");
    const mutated = entry.xml.replace(
      /<Entry id="([^"]*)" token="([^"]*)" genre="([^"]*)" layer="([^"]*)" \/>/,
      '<Entry layer="$4" id="$1" token="$2" genre="$3" />',
    );
    expect(mutated).not.toBe(entry.xml);
    const once = serializeRecordDocument(entry.file, mutated);
    expect(once).not.toBe(mutated);
    expect(once).toContain('<Entry id="f1" token="F1" genre="finding" layer="live" />');
  });

  it("emits exactly one trailing newline after the root close tag, whatever the input carried", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "Row");
    const one = serializeRecordDocument(entry.file, entry.xml.replace(/\n$/, ""));
    expect(one.endsWith("\n")).toBe(true);
    expect(one.endsWith("\n\n")).toBe(false);
    expect(serializeRecordDocument(entry.file, `${entry.xml}\n`), "two newlines normalize to one").toBe(entry.xml);
  });

  it("emits an empty Successor self-closing, not as an empty pair", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "Row");
    const mutated = entry.xml.replace(/(\n\s*)<\/Row>/, "$1  <Successor></Successor>$1</Row>");
    expect(mutated).toContain("<Successor></Successor>");
    const once = serializeRecordDocument(entry.file, mutated);
    expect(once).toContain("<Successor />");
    expect(once).not.toContain("<Successor></Successor>");
  });

  it("reports an out-of-order child — Pays before Charter", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "Charter");
    const mutated = entry.xml.replace(
      /(<Charter>[\s\S]*?<\/Charter>\n)(\s*<Pays>[\s\S]*?<\/Pays>\n)/,
      "$2$1",
    );
    expect(mutated).not.toBe(entry.xml);
    expect(schemaCodes(entry.file, entry.name, mutated)).toContain("record-schema-child-order");
  });

  it("reports an out-of-order child — Title before PaidBy on a retired Finding", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "PaidBy");
    const mutated = entry.xml.replace(
      /(\s*<PaidBy>[\s\S]*?<\/PaidBy>\n)(\s*<Title>[\s\S]*?<\/Title>\n)/,
      "$2$1",
    );
    expect(mutated).not.toBe(entry.xml);
    expect(schemaCodes(entry.file, entry.name, mutated)).toContain("record-schema-child-order");
  });

  it("reports an out-of-order child — Body before Title on a live Finding", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const entry = recordFileHolding(root, "Finding", (node) => node.attributes.status === "live");
    const mutated = entry.xml.replace(
      /(\s*<Title>[\s\S]*?<\/Title>\n)(\s*<Body>[\s\S]*?<\/Body>\n)/,
      "$2$1",
    );
    expect(mutated).not.toBe(entry.xml);
    expect(schemaCodes(entry.file, entry.name, mutated)).toContain("record-schema-child-order");
  });

  it("declares zero schema violations over the seven live record files and the seven goldens", () => {
    const dirs = [
      path.join(REPO_ROOT, RECORD_REL),
      path.join(REPO_ROOT, "scripts/fixtures/record-parse/golden"),
    ];
    for (const dir of dirs) {
      for (const name of [
        "findings.xml",
        "findings-retired.xml",
        "rulings.xml",
        "rulings-retired.xml",
        "registry.xml",
        "registry-retired.xml",
        "decisions.xml",
      ]) {
        const file = path.join(dir, name);
        const xml = readFileSync(file, "utf8");
        expect(recordSchemaViolations(file, parseGraceXmlArtifact(file, xml).root), `${file}: schema`).toEqual([]);
      }
    }
  });

  it("derives headroom through one floored function on both paths", () => {
    expect(FINDINGS_HEADROOM_MULTIPLIER).toBe(7);
    expect(RULINGS_HEADROOM_MULTIPLIER).toBe(7);
    expect(recordHeadroom([10, 21], RULINGS_HEADROOM_MULTIPLIER)).toBe(Math.floor(7 * median([10, 21])));
    expect(recordHeadroom([10, 21], RULINGS_HEADROOM_MULTIPLIER)).toBe(108);
  });
});

describe("repository-boundary refusal (C-RECORD-SCHEMA-2 T-002)", () => {
  it("refuses a cwd with no .ngrace/ — the repository boundary is undefined", () => {
    const outside = isolatedRoot();
    const result = runValidatorInProcess(outside, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("record-outside-repository-boundary");
  });

  it("refuses a partial copy of the record directory passed from the repository root", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const outside = isolatedRoot();
    const partial = path.join(outside, "R");
    cpSync(path.join(root, RECORD_REL), partial, { recursive: true });
    expect(() => resolveRecordDirWithinBoundary(root, partial)).toThrow(
      /record-outside-repository-boundary/,
    );
  });

  it("accepts the whole-repository copy run from inside the copy", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const result = runValidatorInProcess(root, [RECORD_REL]);
    expect(result.status).toBe(0);
  });
});

describe("separator sweep (C-RECORD-SCHEMA-2 T-003)", () => {
  it("detects the separator on the whitespace-stripped tail across the three shapes", () => {
    expect(bodyEndsWithSeparator("text\n\n---")).toBe(true);
    expect(bodyEndsWithSeparator("text\n\n---\n")).toBe(true);
    expect(bodyEndsWithSeparator("text\n\n---\n\n")).toBe(true);
    expect(bodyEndsWithSeparator("text\n")).toBe(false);
    expect(bodyEndsWithSeparator("text\n\n--- more\n")).toBe(false);
  });

  it("stripBodySeparator removes the blank gap and the --- line, keeping one trailing newline", () => {
    expect(stripBodySeparator("\ntext\n\n---\n")).toBe("\ntext\n");
    expect(stripBodySeparator("\ntext\n\n---\n\n")).toBe("\ntext\n");
    expect(stripBodySeparator("\ntext\n\n---")).toBe("\ntext\n");
    expect(stripBodySeparator("\ntext\n")).toBe("\ntext\n");
  });

  it("finds a separator body by walking the layers, and none in the swept production record", () => {
    const root = isolatedRoot();
    writeHappy(root, {
      findings: `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 - live</Title>
    <Body>text

---</Body>
  </Finding>
</Findings>
`,
    });
    const fixture = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const fixtureRoot = parseGraceXmlArtifact("findings.xml", fixture).root!;
    const found = [...walkNodes(fixtureRoot)].filter(
      (n: GraceXmlNode) =>
        (n.tag === "Finding" || n.tag === "Decision") &&
        bodyEndsWithSeparator(xmlDecode(childText(n, "Body") ?? "")),
    );
    expect(found.length).toBe(1);

    const recordDir = path.join(REPO_ROOT, RECORD_REL);
    for (const file of ["findings.xml", "findings-retired.xml", "rulings.xml", "rulings-retired.xml"]) {
      const xml = readFileSync(path.join(recordDir, file), "utf8");
      const parsedRoot = parseGraceXmlArtifact(file, xml).root!;
      const hits = [...walkNodes(parsedRoot)].filter(
        (n: GraceXmlNode) =>
          (n.tag === "Finding" || n.tag === "Decision") &&
          bodyEndsWithSeparator(xmlDecode(childText(n, "Body") ?? "")),
      );
      expect(hits.length, `${file}: no separator tail`).toBe(0);
    }
  });

  it("is canonical-at-rest and preservation-green over the seven live record files after the sweep", () => {
    const recordDir = path.join(REPO_ROOT, RECORD_REL);
    for (const name of [
      "findings.xml",
      "findings-retired.xml",
      "rulings.xml",
      "rulings-retired.xml",
      "registry.xml",
      "registry-retired.xml",
      "decisions.xml",
    ]) {
      const file = path.join(recordDir, name);
      const xml = readFileSync(file, "utf8");
      expect(serializeRecordDocument(file, xml), `${name}: canonical at rest after the sweep`).toBe(xml);
    }
    expect(proveRecordPreservation(recordDir)).toEqual([]);
  });
});

describe("flush (C-RECORD-SCHEMA-2 T-004)", () => {
  it("D40, F252, F265 and the C-RECORD-SCHEMA-2 row exist exactly once across their layers after the flush", () => {
    const recordDir = path.join(REPO_ROOT, RECORD_REL);
    const countToken = (token: string): number => {
      let n = 0;
      for (const file of ["findings.xml", "findings-retired.xml", "rulings.xml", "rulings-retired.xml"]) {
        const root = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8")).root!;
        n += [...walkNodes(root)].filter((x: GraceXmlNode) => x.attributes.token === token).length;
      }
      return n;
    };
    const countRow = (name: string): number => {
      let n = 0;
      for (const file of ["registry.xml", "registry-retired.xml"]) {
        const root = parseGraceXmlArtifact(file, readFileSync(path.join(recordDir, file), "utf8")).root!;
        n += [...walkNodes(root)].filter((x: GraceXmlNode) => x.attributes.name === name).length;
      }
      return n;
    };
    expect(countToken("D40"), "D40 exactly once across the rulings layers").toBe(1);
    expect(countToken("F252"), "F252 exactly once across the findings layers").toBe(1);
    expect(countToken("F265"), "F265 exactly once across the findings layers").toBe(1);
    expect(countRow("C-RECORD-SCHEMA-2-0785BD5E"), "the row exactly once across the registry layers").toBe(1);
  });
});


// ---------------------------------------------------------------------------
// C-TEST-TIMEOUT-CEILING-2-7AD2A006 T-002: the flush-invariant walk for F266
// and F267. No per-test pin: the suite runs under `bun test --timeout=0`.
// ---------------------------------------------------------------------------
describe("C-TEST-TIMEOUT-CEILING-2-7AD2A006 flush invariant", () => {
  it("f266 and f267 each exist exactly once across the findings pair with status, token, index genre and layer agreeing, no separator tail, and the roots arithmetic holds", () => {
    const flushed = ["f266", "f267"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((n) => n.tag === "Finding" && n.attributes.id === id).map((n) => ({ file, node: n }));
      });
      expect(carriers.length, id).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, id).toBe(expectedStatus);
      expect(node.attributes.token, id).toBe("F" + id.slice(1));
      const entries = [...walkNodes(indexParsed.root!)].filter((e) => e.tag === "Entry" && e.attributes.id === id);
      expect(entries.length, id).toBe(1);
      expect(entries[0]!.attributes.genre, id).toBe("finding");
      expect(entries[0]!.attributes.layer, id).toBe(expectedStatus);
      const body = childText(node, "Body") ?? "";
      const lines = body.split("\n");
      let i = lines.length - 1;
      while (i >= 0 && lines[i]!.trim() === "") i--;
      expect(lines[i]?.trim(), id + " separator tail").not.toBe("---");
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const root = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    expect(Number(root.attributes.base)).toBe(newlineCount(findingsText));
    expect(Number(root.attributes.base) + Number(root.attributes.headroom)).toBe(Number(root.attributes.ceiling));
    const indexText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8");
    const indexRoot = parseGraceXmlArtifact("decisions.xml", indexText).root!;
    expect(Number(indexRoot.attributes.base)).toBe([...walkNodes(indexRoot)].filter((e) => e.tag === "Entry" && e.attributes.layer === "live").length);
    expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md"))).toEqual([]);
    expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL))).toEqual([]);
  });
});

describe("C-TEST-TIMEOUT-CEILING-2-7AD2A006 row relations", () => {
  it("the row is exactly once across the registry layers with Pays containing F266 and F267 and StatusText naming no F token outside Pays", () => {
    const rowName = "C-TEST-TIMEOUT-CEILING-2-7AD2A006";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    expect(pays).toContain("F266");
    expect(pays).toContain("F267");
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD T-001: the flush-invariant walk for the
// eight findings this bundle pays. House form copied from the
// C-TEACH-COPY-DRIVES-LINEAGE-1-B695D12F flush invariant above.
// ---------------------------------------------------------------------------
describe("C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD flush invariant", () => {
  it("f268, f269, f271, f272, f273, f274, f275 and f276 each exist exactly once across the findings pair with status, token, index genre and layer agreeing, no separator tail, and the roots arithmetic holds", () => {
    const flushed = ["f268", "f269", "f271", "f272", "f273", "f274", "f275", "f276"];
    const liveParsed = parseGraceXmlArtifact("findings.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8"));
    const retiredParsed = parseGraceXmlArtifact("findings-retired.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings-retired.xml"), "utf8"));
    const indexParsed = parseGraceXmlArtifact("decisions.xml", readFileSync(path.join(REPO_ROOT, RECORD_REL, "decisions.xml"), "utf8"));
    for (const id of flushed) {
      const carriers = (["findings.xml", "findings-retired.xml"] as const).flatMap((file) => {
        const parsed = file === "findings.xml" ? liveParsed : retiredParsed;
        return [...walkNodes(parsed.root!)].filter((n) => n.tag === "Finding" && n.attributes.id === id).map((n) => ({ file, node: n }));
      });
      expect(carriers.length, id).toBe(1);
      const { file, node } = carriers[0]!;
      const expectedStatus = file === "findings.xml" ? "live" : "retired";
      expect(node.attributes.status, id).toBe(expectedStatus);
      expect(node.attributes.token, id).toBe("F" + id.slice(1));
      const entries = [...walkNodes(indexParsed.root!)].filter((e) => e.tag === "Entry" && e.attributes.id === id);
      expect(entries.length, id).toBe(1);
      expect(entries[0]!.attributes.genre, id).toBe("finding");
      expect(entries[0]!.attributes.layer, id).toBe(expectedStatus);
      const body = childText(node, "Body") ?? "";
      const lines = body.split("\n");
      let i = lines.length - 1;
      while (i >= 0 && lines[i]!.trim() === "") i--;
      expect(lines[i]?.trim(), id + " separator tail").not.toBe("---");
    }
    const findingsText = readFileSync(path.join(REPO_ROOT, RECORD_REL, "findings.xml"), "utf8");
    const root = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    expect(Number(root.attributes.base)).toBe(newlineCount(findingsText));
    expect(Number(root.attributes.base) + Number(root.attributes.headroom)).toBe(Number(root.attributes.ceiling));
    expect(validateStubAndIndex(path.join(REPO_ROOT, RECORD_REL, "decisions.md"))).toEqual([]);
    expect(proveRecordPreservation(path.join(REPO_ROOT, RECORD_REL))).toEqual([]);
  });
});


describe("C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD row relations", () => {
  it("the row is exactly once across the registry layers with Pays containing F268, F269, F271, F272, F273, F274, F275 and F276 and StatusText naming no F token outside Pays", () => {
    const rowName = "C-TEACH-CLOSE-DRIVES-PINS-1-B0BC7FBD";
    const rows: Array<{ file: string; node: { attributes: Record<string, string> } }> = [];
    for (const file of ["registry.xml", "registry-retired.xml"] as const) {
      const parsed = parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"));
      for (const node of walkNodes(parsed.root!)) {
        if (node.tag === "Row" && node.attributes.name === rowName) rows.push({ file, node });
      }
    }
    expect(rows.length).toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status).toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node as never, "Pays") ?? "";
    for (const token of ["F268", "F269", "F271", "F272", "F273", "F274", "F275", "F276"]) {
      expect(pays).toContain(token);
    }
    const statusText = childText(node as never, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});

// C-RECORD-FLUSH-VERB-2-6BB9DF5A T-002: the --flush mode, the codify-only
// invocation and its refusals, driven on isolated roots; the production record
// is never written by these tests. The fixture selects F999, which the record
// never holds, so the test is independent of the production flush's state.
describe("C-RECORD-FLUSH-VERB-2-6BB9DF5A flush mode", () => {
  function flushRoot(): string {
    const root = isolatedRoot();
    cpSync(path.join(REPO_ROOT, RECORD_REL), path.join(root, RECORD_REL), { recursive: true });
    // The fixture is deterministic across record states: plant a live, uncodified
    // decision (the codify-only invocation's target) in the copied record.
    const rulingsPath = path.join(root, RECORD_REL, "rulings.xml");
    const fixtureDecision = '  <Decision id="d-fixture" token="D-FIXTURE" status="live">\n    <Title>## D-FIXTURE — fixture</Title>\n    <Body>fixture decision</Body>\n  </Decision>\n';
    writeFileSync(rulingsPath, readFileSync(rulingsPath, "utf8").replace("</Rulings>", fixtureDecision + "</Rulings>"));
    const indexFixture = path.join(root, RECORD_REL, "decisions.xml");
    writeFileSync(indexFixture, readFileSync(indexFixture, "utf8").replace("</RecordIndex>", '  <Entry id="d-fixture" token="D-FIXTURE" genre="decision" layer="live" />\n</RecordIndex>'));
    plant(root, ".ngrace/scratch/staged-findings.md", '<a id="f999" name="f999"></a>\n### F999 — clone-faithful fixture **[verified]**\n\nInline fixture body; the fixture sources no repository path, so it is independent of the record and of the staged buffer.\n\n---\n\n<a id="d99" name="d99"></a>\n## D99 — decision-path fixture **[verified]**\n\nFixture decision body; the fixture sources no repository path, so it is independent of the record and of the staged buffer.\n\n---\n');
    mkdirSync(path.join(root, ".ngrace/changes/active/C-FIXTURE-1-00000000"), { recursive: true });
    return root;
  }
  const parse = (root: string, file: string) =>
    parseGraceXmlArtifact(file, readFileSync(path.join(root, RECORD_REL, file), "utf8")).root!;
  const rowsOf = (root: string) =>
    [...walkNodes(parse(root, "registry.xml"))].filter((n) => n.tag === "Row" && n.attributes.name === "C-FIXTURE-1-00000000");
  const allText = (root: string) =>
    ["findings.xml", "rulings.xml", "registry.xml", "decisions.xml"].map((f) => readFileSync(path.join(root, RECORD_REL, f), "utf8")).join("");

  it("--flush writes the selected finding and the row, and the codify-only invocation writes one CodifiedIn without re-minting", () => {
    const root = flushRoot();
    const flush = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--finding", "F999", "--pays", "F999", "--mint-search", "1 active, 0 archive", "--status-text", "fixture"]);
    expect(flush.status, flush.stderr).toBe(0);
    expect([...walkNodes(parse(root, "findings.xml"))].filter((n) => n.tag === "Finding" && n.attributes.token === "F999").length, "F999 flushed").toBe(1);
    expect(rowsOf(root).length, "one row after the flush").toBe(1);
    expect(childText(rowsOf(root)[0]!, "Pays")).toContain("F999");
    for (const file of ["findings.xml", "rulings.xml", "registry.xml", "decisions.xml"]) {
      const m = /base="(\d+)" headroom="(\d+)" ceiling="(\d+)"/.exec(readFileSync(path.join(root, RECORD_REL, file), "utf8").split("\n")[0]!);
      expect(Number(m![1]) + Number(m![2]), file).toBe(Number(m![3]));
    }
    const cod = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--codify", "D-FIXTURE:test-suite:scripts/validate-record-retirement.test.ts", "--mint-search", "1 active, 0 archive"]);
    expect(cod.status, cod.stderr).toBe(0);
    expect(rowsOf(root).length, "the row is not re-minted").toBe(1);
    const tgt = [...walkNodes(parse(root, "rulings.xml"))].find((n) => n.tag === "Decision" && n.attributes.token === "D-FIXTURE")!;
    expect(childNodes(tgt, "CodifiedIn").length, "exactly one CodifiedIn").toBe(1);
  });

  it("C-RECORD-DECISION-FLUSH-1-368E01F2 --decision writes the decision element and its index Entry together", () => {
    const root = flushRoot();
    const flush = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--decision", "D99", "--mint-search", "1 active, 0 archive", "--status-text", "fixture"]);
    expect(flush.status, flush.stderr).toBe(0);
    expect(flush.stdout, "the success line names the decision token").toContain("D99");
    const decisions = [...walkNodes(parse(root, "rulings.xml"))].filter((n) => n.tag === "Decision" && n.attributes.token === "D99");
    expect(decisions.length, "D99 exactly once in rulings.xml").toBe(1);
    expect(decisions[0]!.attributes.id).toBe("d99");
    expect(decisions[0]!.attributes.status).toBe("live");
    const entries = [...walkNodes(parse(root, "decisions.xml"))].filter((n) => n.tag === "Entry" && n.attributes.id === "d99");
    expect(entries.length, "one index Entry").toBe(1);
    expect(entries[0]!.attributes.genre).toBe("decision");
    expect(entries[0]!.attributes.layer).toBe("live");
    for (const file of ["findings.xml", "rulings.xml", "registry.xml", "decisions.xml"]) {
      const text = readFileSync(path.join(root, RECORD_REL, file), "utf8");
      expect(serializeRecordDocument(file, text), `${file} canonical at rest`).toBe(text);
      const m = /base="(\d+)" headroom="(\d+)" ceiling="(\d+)"/.exec(text.split("\n")[0]!);
      expect(Number(m![1]) + Number(m![2]), `${file} base + headroom = ceiling`).toBe(Number(m![3]));
    }
  });

  it("C-RECORD-DECISION-FLUSH-1-368E01F2 --decision with --codify chains the codify off the appended decision, writing both", () => {
    const root = flushRoot();
    const flush = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--decision", "D99", "--codify", "d-fixture:test-suite:scripts/validate-record-retirement.test.ts", "--mint-search", "1 active, 0 archive", "--status-text", "fixture"]);
    expect(flush.status, flush.stderr).toBe(0);
    expect(flush.stdout, "the success line names the decision token").toContain("D99");
    const decisions = [...walkNodes(parse(root, "rulings.xml"))].filter((n) => n.tag === "Decision" && n.attributes.token === "D99");
    expect(decisions.length, "D99 present; the codify did not drop the appended decision").toBe(1);
    const tgt = [...walkNodes(parse(root, "rulings.xml"))].find((n) => n.tag === "Decision" && n.attributes.token === "D-FIXTURE")!;
    expect(childNodes(tgt, "CodifiedIn").length, "exactly one CodifiedIn on the codify target").toBe(1);
    const entries = [...walkNodes(parse(root, "decisions.xml"))].filter((n) => n.tag === "Entry" && n.attributes.id === "d99");
    expect(entries.length, "one index Entry for d99").toBe(1);
    expect(entries[0]!.attributes.genre).toBe("decision");
    expect(entries[0]!.attributes.layer).toBe("live");
  });

  it("C-RECORD-DECISION-FLUSH-1-368E01F2 refuses a genre-mismatched selection before any write, both directions", () => {
    const root = flushRoot();
    const files = ["findings.xml", "findings-retired.xml", "rulings.xml", "rulings-retired.xml", "registry.xml", "registry-retired.xml", "decisions.xml"];
    const snap = () => files.map((f) => readFileSync(path.join(root, RECORD_REL, f), "utf8"));
    const before = snap();
    const findingFlag = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--finding", "D99", "--mint-search", "1 active, 0 archive"]);
    expect(findingFlag.status, findingFlag.stderr).not.toBe(0);
    expect(findingFlag.stderr).toContain("flush-selection-genre-mismatch");
    const decisionFlag = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--decision", "F999", "--mint-search", "1 active, 0 archive"]);
    expect(decisionFlag.status, decisionFlag.stderr).not.toBe(0);
    expect(decisionFlag.stderr).toContain("flush-selection-genre-mismatch");
    expect(snap(), "all four record files byte-identical across both refusals").toEqual(before);
  });

  it("--flush re-derives every live root itself, with no --rewrite-roots, after the entries flush and the codify-only invocation", () => {
    const root = flushRoot();
    // Normalise the fixture's roots first, so the read-back below can only fail
    // because of what the flush itself fails to re-derive.
    const seed = runValidatorInProcess(root, ["--rewrite-roots", RECORD_REL]);
    expect(seed.status, seed.stderr).toBe(0);
    const readBack = (file: string) => {
      const text = readFileSync(path.join(root, RECORD_REL, file), "utf8");
      const node = parseGraceXmlArtifact(file, text).root!;
      const metric = file === "registry.xml"
        ? childNodes(node, "Row").filter((row) => row.attributes.status !== "retired").length
        : file === "decisions.xml"
          ? childNodes(node, "Entry").filter((entry) => entry.attributes.layer !== "retired").length
          : newlineCount(text);
      return { node, metric };
    };
    const assertRootsReadBack = (stage: string) => {
      for (const file of ["findings.xml", "rulings.xml", "registry.xml", "decisions.xml"]) {
        const { node, metric } = readBack(file);
        const base = Number(node.attributes.base);
        const headroom = Number(node.attributes.headroom);
        const ceiling = Number(node.attributes.ceiling);
        expect(base, `${stage}: ${file} base equals its shipped metric read back`).toBe(metric);
        expect(base + headroom, `${stage}: ${file} base + headroom = ceiling`).toBe(ceiling);
      }
    };
    assertRootsReadBack("control after --rewrite-roots");

    const flush = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--finding", "F999", "--pays", "F999", "--mint-search", "1 active, 0 archive", "--status-text", "fixture"]);
    expect(flush.status, flush.stderr).toBe(0);
    assertRootsReadBack("after the entries flush, with no --rewrite-roots");

    const cod = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--codify", "D-FIXTURE:test-suite:scripts/validate-record-retirement.test.ts", "--mint-search", "1 active, 0 archive"]);
    expect(cod.status, cod.stderr).toBe(0);
    assertRootsReadBack("after the codify-only invocation, with no --rewrite-roots");
  });

  it("--flush writes every record file through the engine's writeRecordXml, never a local writeFileSync", () => {
    const body = /function flushRecord\([\s\S]*?\n\}\n/.exec(readFileSync(SCRIPT, "utf8"))![0];
    expect(body, "the flush routes its writes through writeRecordXml").toContain("writeRecordXml(");
    expect(body, "no record write bypasses writeRecordXml").not.toContain("writeFileSync(");
  });

  it("--flush refuses before any write: flush-row-exists, flush-codify-exists, flush-mint-search-malformed", () => {
    const root = flushRoot();
    expect(runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--finding", "F999", "--pays", "F999", "--mint-search", "1 active, 0 archive"]).status).toBe(0);
    const before = allText(root).length;
    const exists = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--finding", "F999", "--pays", "F999", "--mint-search", "1 active, 0 archive"]);
    expect(exists.status).not.toBe(0);
    expect(exists.stderr).toContain("flush-row-exists");
    expect(runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--codify", "D-FIXTURE:test-suite:x", "--mint-search", "1 active, 0 archive"]).status).toBe(0);
    const recod = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--codify", "D-FIXTURE:test-suite:x", "--mint-search", "1 active, 0 archive"]);
    expect(recod.status).not.toBe(0);
    expect(recod.stderr).toContain("flush-codify-exists");
    const malformed = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", "C-FIXTURE-1-00000000", "--mint-search", "bad"]);
    expect(malformed.status).not.toBe(0);
    expect(malformed.stderr).toContain("flush-mint-search-malformed");
    expect(allText(root).length).toBeGreaterThan(before);
  });
});

// C-TEACHING-INCREMENT-2-4E28E16C T-001: the `--taught` annotation writer on
// `--flush` and its guard cluster, driven on isolated fixture roots (never the
// production record). The plan's Atomic Mechanism Exception applies: one
// mechanism, one guard cluster, one recorded fail.
describe("C-TEACHING-INCREMENT-2-4E28E16C T-001 --taught writer", () => {
  const CHANGE = "C-FIXTURE-1-00000000";
  const SKILL_REL = "skills/ngrace/ngrace-execute/SKILL.md";
  function taughtRoot(): string {
    const root = isolatedRoot();
    cpSync(path.join(REPO_ROOT, RECORD_REL), path.join(root, RECORD_REL), { recursive: true });
    const rulingsPath = path.join(root, RECORD_REL, "rulings.xml");
    const fixtureDecision = '  <Decision id="d-fixture" token="D-FIXTURE" status="live">\n    <Title>## D-FIXTURE — fixture</Title>\n    <Body>fixture decision</Body>\n  </Decision>\n';
    writeFileSync(rulingsPath, readFileSync(rulingsPath, "utf8").replace("</Rulings>", fixtureDecision + "</Rulings>"));
    const indexFixture = path.join(root, RECORD_REL, "decisions.xml");
    writeFileSync(indexFixture, readFileSync(indexFixture, "utf8").replace("</RecordIndex>", '  <Entry id="d-fixture" token="D-FIXTURE" genre="decision" layer="live" />\n</RecordIndex>'));
    plant(root, ".ngrace/scratch/staged-findings.md", '<a id="f999" name="f999"></a>\n### F999 — fixture **[verified]**\n\nFixture body written literally; sources no repository path.\n\n---\n');
    plant(root, SKILL_REL, '# ngrace-execute (fixture)\n\n<execution_rules>\nrule body carrying the execution_rules home.\n</execution_rules>\n\n<cursor_kinds>\n<kind id="attempt">attempt body carrying cursor_kinds.</kind>\n</cursor_kinds>\n');
    mkdirSync(path.join(root, ".ngrace/changes/active", CHANGE), { recursive: true });
    return root;
  }
  const FILES = ["findings.xml", "rulings.xml", "decisions.xml", "registry.xml"] as const;
  const snapshot = (root: string) => FILES.map((f) => readFileSync(path.join(root, RECORD_REL, f), "utf8"));
  const mint = (root: string) =>
    runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--finding", "F999", "--pays", "F999", "--mint-search", "1 active, 0 archive", "--status-text", "fixture"]);
  const taughtOn = (root: string) => {
    const rootNode = parseGraceXmlArtifact("rulings.xml", readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8")).root!;
    const target = [...walkNodes(rootNode)].find((n) => n.tag === "Decision" && n.attributes.id === "d-fixture")!;
    return childNodes(target, "TaughtIn");
  };

  it("(a) --flush --taught writes exactly one TaughtIn on the named decision, exit 0", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    const r = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `d-fixture:${SKILL_REL}:execution_rules`, "--mint-search", "1 active, 0 archive"]);
    expect(r.status, r.stderr).toBe(0);
    const taught = taughtOn(root);
    expect(taught.length, "exactly one TaughtIn").toBe(1);
    expect(taught[0]!.attributes.path).toBe(SKILL_REL);
    expect(taught[0]!.attributes.section).toBe("execution_rules");
    expect(taught[0]!.text, "element text is the section").toBe("execution_rules");
  });

  it("(b) a non-decision target refuses flush-taught-absent with the four files byte-identical", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    const before = snapshot(root);
    const r = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `F999:${SKILL_REL}:execution_rules`, "--mint-search", "1 active, 0 archive"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("flush-taught-absent");
    expect(snapshot(root), "four files byte-identical").toEqual(before);
  });

  it("(c) an absent skill path refuses and names it, four files byte-identical", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    const before = snapshot(root);
    const missing = "skills/ngrace/ngrace-execute/NOPE.md";
    const r = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `d-fixture:${missing}:execution_rules`, "--mint-search", "1 active, 0 archive"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(missing);
    expect(snapshot(root)).toEqual(before);
  });

  it("(d) an absent section refuses and names it, four files byte-identical", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    const before = snapshot(root);
    const r = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `d-fixture:${SKILL_REL}:nope_section`, "--mint-search", "1 active, 0 archive"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("nope_section");
    expect(snapshot(root)).toEqual(before);
  });

  it("(e) a byte-identical duplicate refuses, four files byte-identical", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    const args = ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `d-fixture:${SKILL_REL}:execution_rules`, "--mint-search", "1 active, 0 archive"];
    expect(runValidatorInProcess(root, args).status).toBe(0);
    const before = snapshot(root);
    const dup = runValidatorInProcess(root, args);
    expect(dup.status).not.toBe(0);
    expect(snapshot(root)).toEqual(before);
  });

  it("(f) a second, different path/section on the same decision is admitted", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    expect(runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `d-fixture:${SKILL_REL}:execution_rules`, "--mint-search", "1 active, 0 archive"]).status).toBe(0);
    const second = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--taught", `d-fixture:${SKILL_REL}:cursor_kinds`, "--mint-search", "1 active, 0 archive"]);
    expect(second.status, second.stderr).toBe(0);
    expect(taughtOn(root).length, "two TaughtIn children (schema multiplicity)").toBe(2);
  });

  it("(g) the --taught value is not read as a positional", () => {
    const root = taughtRoot();
    expect(mint(root).status).toBe(0);
    const r = runValidatorInProcess(root, ["--flush", "--taught", `d-fixture:${SKILL_REL}:execution_rules`, "--change", CHANGE, "--mint-search", "1 active, 0 archive", RECORD_REL]);
    expect(r.status, r.stderr).toBe(0);
    expect(taughtOn(root).length, "the record dir resolved from the single positional").toBe(1);
  });
});

// C-TEACHING-INCREMENT-2-4E28E16C T-002: flushRecord must write data-derived
// replacements literally, never as String.replace replacement patterns. The
// regression subject names the failure ("replacement pattern") and is driven on
// an isolated fixture root.
describe("C-TEACHING-INCREMENT-2-4E28E16C T-002 replacement pattern", () => {
  const CHANGE = "C-FIXTURE-1-00000000";
  const seq = "$" + "`";
  function patternRoot(): string {
    const root = isolatedRoot();
    cpSync(path.join(REPO_ROOT, RECORD_REL), path.join(root, RECORD_REL), { recursive: true });
    plant(root, ".ngrace/scratch/staged-findings.md", `<a id="f998" name="f998"></a>\n### F998 — replacement pattern fixture **[verified]**\n\nBody carrying a replacement sequence ${seq} literally. Sources no repository path.\n\n---\n\n<a id="f997" name="f997"></a>\n### F997 — second fixture **[verified]**\n\nSecond fixture body, carrying no sequence.\n\n---\n`);
    mkdirSync(path.join(root, ".ngrace/changes/active", CHANGE), { recursive: true });
    return root;
  }

  it("a finding body carrying the replacement sequence round-trips literally beside a second finding", () => {
    const root = patternRoot();
    const r = runValidatorInProcess(root, ["--flush", RECORD_REL, "--change", CHANGE, "--finding", "F998", "--finding", "F997", "--pays", "F998 F997", "--mint-search", "1 active, 0 archive", "--status-text", "fixture"]);
    expect(r.status, r.stderr).toBe(0);
    const findingsText = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const rootNode = parseGraceXmlArtifact("findings.xml", findingsText).root!;
    for (const token of ["F998", "F997"]) {
      const hits = [...walkNodes(rootNode)].filter((n) => n.tag === "Finding" && n.attributes.token === token);
      expect(hits.length, `${token} lands exactly once`).toBe(1);
    }
    expect(findingsText, "the sequence is written literally").toContain(seq);
  });
});

// C-RECORD-DECISION-FLUSH-1-368E01F2 T-001: the index-versus-genre presence
// relation `record-index-orphan` at rest, consumed by the validator, --retire and
// --flush through the one `refuseStructural`; the clean fixture and the
// production record satisfy it.
describe("C-RECORD-DECISION-FLUSH-1-368E01F2 T-001 index presence", () => {
  const ORPHAN_ENTRY =
    '  <Entry id="d-orphan" token="D-ORPHAN" genre="decision" layer="live" />\n';
  const RECORD_FILES = [
    "findings.xml",
    "findings-retired.xml",
    "rulings.xml",
    "rulings-retired.xml",
    "registry.xml",
    "registry-retired.xml",
    "decisions.xml",
  ];
  function withOrphan(): string {
    const root = isolatedRoot();
    writeHappy(root);
    const index = readFileSync(path.join(root, RECORD_REL, "decisions.xml"), "utf8");
    plant(root, `${RECORD_REL}/decisions.xml`, index.replace("</RecordIndex>", ORPHAN_ENTRY + "</RecordIndex>"));
    return root;
  }
  const snapshot = (root: string) => RECORD_FILES.map((f) => readFileSync(path.join(root, RECORD_REL, f), "utf8"));

  it("a planted index Entry with no holding element reddens record-index-orphan, and --retire refuses before any write", () => {
    const root = withOrphan();
    const before = snapshot(root);
    const v = runValidatorInProcess(root, [RECORD_REL]);
    expect(v.status).not.toBe(0);
    expect(v.stderr).toContain("record-index-orphan");
    const r = runValidatorInProcess(root, ["--retire", RECORD_REL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("record-index-orphan");
    expect(snapshot(root), "no record file changed").toEqual(before);
  });

  it("--flush refuses record-index-orphan before any write", () => {
    const root = withOrphan();
    const before = snapshot(root);
    const fl = runValidatorInProcess(root, [
      "--flush",
      RECORD_REL,
      "--change",
      "C-FIXTURE-1-00000000",
      "--finding",
      "F1",
      "--mint-search",
      "0 active, 0 archive",
    ]);
    expect(fl.status).not.toBe(0);
    expect(fl.stderr).toContain("record-index-orphan");
    expect(snapshot(root)).toEqual(before);
  });

  it("the clean fixture and the production record both stay green under the relation", () => {
    const root = isolatedRoot();
    writeHappy(root);
    const ok = runValidatorInProcess(root, [RECORD_REL]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("record-retirement: ok");
    const prod = runValidatorInProcess(REPO_ROOT, [RECORD_REL]);
    expect(prod.status, prod.stderr).toBe(0);
    expect(prod.stdout).toContain("record-retirement: ok");
  });
});

// C-RECORD-FLUSH-VERB-2-6BB9DF5A T-003: the dogfood flush's elements, exists-once
// across the pairs and layers, with the root relations read back. This is a real
// ledger pair: the walks are red before the verb runs on the production record.
describe("C-RECORD-FLUSH-VERB-2-6BB9DF5A dogfood", () => {
  const root = (file: string) => parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8")).root!;
  it("C-RECORD-FLUSH-VERB-2-6BB9DF5A: F277, F278 and the row exist exactly once across their layers", () => {
    for (const token of ["F277", "F278"]) {
      const hits = [...walkNodes(root("findings.xml")), ...walkNodes(root("findings-retired.xml"))].filter(
        (n) => n.tag === "Finding" && n.attributes.token === token,
      );
      expect(hits.length, `${token} exactly once across the findings pair`).toBe(1);
    }
    const rows = [...walkNodes(root("registry.xml")), ...walkNodes(root("registry-retired.xml"))].filter(
      (n) => n.tag === "Row" && n.attributes.name === "C-RECORD-FLUSH-VERB-2-6BB9DF5A",
    );
    expect(rows.length, "the row exactly once across the registry layers").toBe(1);
    for (const token of ["F228", "F277", "F278"]) {
      expect(childText(rows[0]!, "Pays"), `Pays contains ${token}`).toContain(token);
    }
    for (const file of ["findings.xml", "rulings.xml", "registry.xml", "decisions.xml"]) {
      const m = /base="(\d+)" headroom="(\d+)" ceiling="(\d+)"/.exec(readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8").split("\n")[0]!);
      expect(Number(m![1]) + Number(m![2]), `${file} base + headroom = ceiling`).toBe(Number(m![3]));
    }
  });
});

// C-CLONE-FAITHFUL-TESTS-1-D68520A2 T-002: F279 and the row exist exactly once
// across their layers, the index Entry layer agrees with the holding file, and
// the row Pays F279 with no F token outside Pays in StatusText. No per-test pin.
describe("C-CLONE-FAITHFUL-TESTS-1-D68520A2 row relations", () => {
  it("f279 and the row exist exactly once across their layers with the index layer agreeing and Pays containing F279", () => {
    const record = (file: string) => parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8")).root!;
    const carriers = [
      ...[...walkNodes(record("findings.xml"))].filter((n) => n.tag === "Finding" && n.attributes.id === "f279").map((n) => ({ file: "findings.xml", node: n })),
      ...[...walkNodes(record("findings-retired.xml"))].filter((n) => n.tag === "Finding" && n.attributes.id === "f279").map((n) => ({ file: "findings-retired.xml", node: n })),
    ];
    expect(carriers.length, "f279 exactly once across the findings pair").toBe(1);
    const holder = carriers[0]!;
    const layer = holder.file === "findings.xml" ? "live" : "retired";
    expect(holder.node.attributes.status, "status agrees with the holding file").toBe(layer);
    expect(holder.node.attributes.token, "token agrees with the id").toBe("F279");
    const entries = [...walkNodes(record("decisions.xml"))].filter((e) => e.tag === "Entry" && e.attributes.id === "f279");
    expect(entries.length, "one index Entry").toBe(1);
    expect(entries[0]!.attributes.genre, "finding genre").toBe("finding");
    expect(entries[0]!.attributes.layer, "index layer agrees").toBe(layer);
    const body = childText(holder.node, "Body") ?? "";
    const lines = body.split("\n");
    let i = lines.length - 1;
    while (i >= 0 && lines[i]!.trim() === "") i--;
    expect(lines[i]?.trim(), "no separator tail").not.toBe("---");
    const rows = ["registry.xml", "registry-retired.xml"].flatMap((file) =>
      [...walkNodes(record(file))].filter((n) => n.tag === "Row" && n.attributes.name === "C-CLONE-FAITHFUL-TESTS-1-D68520A2").map((n) => ({ file, node: n })),
    );
    expect(rows.length, "the row exactly once across the registry layers").toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status, "row status agrees with the holding file").toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    const pays = childText(node, "Pays") ?? "";
    expect(pays, "Pays contains F279").toContain("F279");
    const statusText = childText(node, "StatusText") ?? "";
    expect(statusText.includes("Closed with")).toBe(false);
    const outside = (statusText.match(/\bF\d+(?:\.\d+)*\b/g) ?? []).filter((t) => !pays.includes(t));
    expect(outside).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-TEST-TIME-BUDGET-2-3EC1F016 T-005 — in-process validator: capture isolation
// and a bounded spawn count. A leaked buffer is a false green.
// ---------------------------------------------------------------------------

const SELF_TEST_PATH = path.join(import.meta.dir, "validate-record-retirement.test.ts");

describe("C-TEST-TIME-BUDGET-2-3EC1F016 in-process validator", () => {
  it("isolates capture between calls and keeps exactly one spawn site", () => {
    const ok = isolatedRoot();
    writeHappy(ok);
    const realLog = console.log;
    const first = runValidatorInProcess(ok);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("record-retirement: ok");
    // the seam is restored after the call
    expect(console.log).toBe(realLog);

    // a second call observes only its own output — no buffer leaked from the first
    const bad = isolatedRoot();
    const second = runValidatorInProcess(bad);
    expect(second.status).not.toBe(0);
    expect(second.stdout).not.toContain("record-retirement: ok");
    expect(second.stderr).toContain("record-retirement");

    // bounded spawns: one spawn site remains, for the exit-code/CWD contract
    const source = readFileSync(SELF_TEST_PATH, "utf8");
    expect((source.match(/spawnSync\("bun", \[SCRIPT/g) ?? []).length).toBe(1);
  });
});

// C-RECORD-DECISION-FLUSH-1-368E01F2 T-004: the payer-map ratchet. Once this
// bundle's row is an archive directory carrying `Pays F289`, `derivePayerMap`
// mints F289 and the production walk expects `baseline[F289] ??
// bundleMinted[F289]`; the entry is the deliberate ratchet, and `D41` is not
// minted because the derivation matches `F` tokens only.
describe("C-RECORD-DECISION-FLUSH-1-368E01F2 T-004 payer ratchet", () => {
  it("F289 derives to this bundle from an archived row, and the map carries it so the production walk stays green", () => {
    const root = isolatedRoot();
    mkdirSync(path.join(root, ".ngrace", "changes", "archive", "C-RECORD-DECISION-FLUSH-1-368E01F2"), { recursive: true });
    const row = { name: "C-RECORD-DECISION-FLUSH-1-368E01F2", pays: "F289", statusText: "" };
    const derived = derivePayerMap(root, [row]);
    expect(derived.get("F289"), "the derivation mints F289 from the archived row").toBe("C-RECORD-DECISION-FLUSH-1-368E01F2");
    const baseline: Record<string, string> = JSON.parse(readFileSync(path.join(import.meta.dir, "fixtures", "record-parse", "baseline-probes.json"), "utf8")).payerMapBaseline.map;
    expect(derived.get("F289"), "the walk's expectation baseline[F289] ?? bundleMinted[F289]").toBe(baseline["F289"] ?? bundleMinted["F289"]);
    expect(bundleMinted["F289"], "a stale id would red the same walk, so the entry is pinned to this bundle").toBe("C-RECORD-DECISION-FLUSH-1-368E01F2");
    expect(derivePayerMap(root, [{ ...row, pays: "D41" }]).has("D41"), "a D token is not minted").toBe(false);
  });
});

// C-RECORD-DECISION-FLUSH-1-368E01F2 T-005: the applied-archive relation walk
// for `AC-ROW-F289-D41`. It keys on the charter row's presence so it is green in
// the execution tree (the row is minted by the close, not by the tasks) and
// discriminating in the applied-archive state: once the row exists, F289 must be
// retired with its PaidBy, D41 live with no CodifiedIn, and every index Entry
// layer must agree with its holding file.
describe("C-RECORD-DECISION-FLUSH-1-368E01F2 T-005 applied-archive relations", () => {
  const rowName = "C-RECORD-DECISION-FLUSH-1-368E01F2";
  const root = (file: string) =>
    parseGraceXmlArtifact(file, readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8")).root!;
  const nodes = (file: string, tag: string, match: (n: GraceXmlNode) => boolean) =>
    [...walkNodes(root(file))].filter((n) => n.tag === tag && match(n));

  it("once the charter row exists, F289 is retired with PaidBy, D41 is live without CodifiedIn, the row is chartered and pays F289, and the index layers agree", () => {
    const rows = ["registry.xml", "registry-retired.xml"].flatMap((file) =>
      nodes(file, "Row", (n) => n.attributes.name === rowName).map((n) => ({ file, node: n })),
    );
    if (rows.length === 0) {
      // pre-close: the close mints the row, so the walk is vacuously green here
      return;
    }
    expect(rows.length, "the row exactly once across the registry layers").toBe(1);
    const { file, node } = rows[0]!;
    expect(node.attributes.status, "the row's status agrees with its layer").toBe(file === "registry.xml" ? "live" : "retired");
    expect(node.attributes.kind).toBe("chartered");
    expect(childText(node, "Pays"), "Pays contains F289").toContain("F289");
    const f289 = ["findings.xml", "findings-retired.xml"].flatMap((f) =>
      nodes(f, "Finding", (n) => n.attributes.id === "f289").map((n) => ({ file: f, node: n })),
    );
    expect(f289.length, "F289 exactly once across the findings pair").toBe(1);
    expect(f289[0]!.node.attributes.status, "F289 is retired").toBe("retired");
    expect(childText(f289[0]!.node, "PaidBy"), "F289's PaidBy names this bundle").toBe(rowName);
    const d41 = ["rulings.xml", "rulings-retired.xml"].flatMap((f) =>
      nodes(f, "Decision", (n) => n.attributes.id === "d41").map((n) => ({ file: f, node: n })),
    );
    expect(d41.length, "D41 exactly once across the rulings pair").toBe(1);
    expect(d41[0]!.node.attributes.status, "D41 stays live (no resolving CodifiedIn)").toBe("live");
    expect(childNodes(d41[0]!.node, "CodifiedIn").length, "D41 carries no CodifiedIn").toBe(0);
    const holders: Array<[string, "live" | "retired"]> = [
      ["f289", f289[0]!.file === "findings.xml" ? "live" : "retired"],
      ["d41", d41[0]!.file === "rulings.xml" ? "live" : "retired"],
    ];
    for (const [id, layer] of holders) {
      const entries = nodes("decisions.xml", "Entry", (n) => n.attributes.id === id);
      expect(entries.length, `one index Entry for ${id}`).toBe(1);
      expect(entries[0]!.attributes.layer, `${id} index layer agrees with the holding file`).toBe(layer);
    }
  });
});

// C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92 T-004: the payer-map ratchet for F288.
// Once this bundle's row is an archive directory carrying `Pays F288`,
// `derivePayerMap` mints F288 and the production walk at :2222 expects
// `baseline[F288] ?? bundleMinted[F288]`; the entry is the deliberate ratchet, and
// a stale `-1` id reds the same walk.
describe("C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92 T-004 payer ratchet", () => {
  it("F288 derives to this successor from an archived row, and the map carries it; absent and stale entries red the walk", () => {
    const root = isolatedRoot();
    mkdirSync(path.join(root, ".ngrace", "changes", "archive", "C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92"), { recursive: true });
    const row = { name: "C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92", pays: "F288", statusText: "" };
    const derived = derivePayerMap(root, [row]);
    expect(derived.get("F288"), "the derivation mints F288 from the archived row").toBe("C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92");

    const baseline: Record<string, string> = JSON.parse(readFileSync(path.join(import.meta.dir, "fixtures", "record-parse", "baseline-probes.json"), "utf8")).payerMapBaseline.map;
    expect(baseline["F288"], "baseline carries no F288 route").toBeUndefined();
    const expectation = (minted: string | undefined): string | undefined => baseline["F288"] ?? minted;
    expect(derived.get("F288") === expectation(undefined), "an absent entry reds the walk").toBe(false);
    expect(
      derived.get("F288") === expectation("C-CURSOR-EVENT-ID-INTEGRITY-1-A0E753F3"),
      "a stale predecessor id reds the walk",
    ).toBe(false);
    expect(
      derived.get("F288") === expectation("C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92"),
      "the correct successor entry greens the walk",
    ).toBe(true);
    expect(bundleMinted["F288"], "the map carries this successor, not the superseded predecessor").toBe("C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92");
    expect(derivePayerMap(root, [{ ...row, pays: "D41" }]).has("D41"), "a D token is not minted").toBe(false);
  });
});

// C-INSPECTION-SURFACE-1-2628AA2B T-006: the payer-map ratchet for F270 and F291.
// Once this bundle's row is an archive directory carrying `Pays F270 F291`,
// `derivePayerMap` mints both and the production walk at :2226 expects
// `baseline[token] ?? bundleMinted[token]`; absent and stale entries red the walk.
describe("C-INSPECTION-SURFACE-1-2628AA2B T-006 payer ratchet", () => {
  it("F270 and F291 derive to this bundle from an archived row, and the map carries both; absent and stale entries red the walk", () => {
    const root = isolatedRoot();
    mkdirSync(path.join(root, ".ngrace", "changes", "archive", "C-INSPECTION-SURFACE-1-2628AA2B"), { recursive: true });
    const row = { name: "C-INSPECTION-SURFACE-1-2628AA2B", pays: "F270 F291", statusText: "" };
    const derived = derivePayerMap(root, [row]);
    expect(derived.get("F270")).toBe("C-INSPECTION-SURFACE-1-2628AA2B");
    expect(derived.get("F291")).toBe("C-INSPECTION-SURFACE-1-2628AA2B");

    const baseline: Record<string, string> = JSON.parse(
      readFileSync(path.join(import.meta.dir, "fixtures", "record-parse", "baseline-probes.json"), "utf8"),
    ).payerMapBaseline.map;
    for (const token of ["F270", "F291"] as const) {
      expect(baseline[token], `baseline carries no ${token} route`).toBeUndefined();
      const expectation = (minted: string | undefined): string | undefined => baseline[token] ?? minted;
      expect(derived.get(token) === expectation(undefined), `an absent ${token} entry reds the walk`).toBe(false);
      expect(
        derived.get(token) === expectation("C-CURSOR-EVENT-ID-INTEGRITY-2-E18DFE92"),
        `a stale ${token} id reds the walk`,
      ).toBe(false);
      expect(
        derived.get(token) === expectation("C-INSPECTION-SURFACE-1-2628AA2B"),
        `the correct ${token} entry greens the walk`,
      ).toBe(true);
      expect(bundleMinted[token], `${token} is pinned to this bundle`).toBe("C-INSPECTION-SURFACE-1-2628AA2B");
    }
    expect(derivePayerMap(root, [{ ...row, pays: "D41" }]).has("D41"), "a D token is not minted").toBe(false);
  });
});
