import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { childNodes, childText, computeElementSpans, parseGraceXmlArtifact, walkNodes } from "../src/artifact/xml.ts";
import {
  INDEX_HEADROOM_ENTRIES,
  RULINGS_PROVENANCE_CEILING,
  closedWithTokens,
  derivePayerMap,
  listArchiveNames,
  liveH2DecisionLineCounts,
  median,
  newlineCount,
  validateRecordRetirement,
} from "./validate-record-retirement.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT = path.join(import.meta.dir, "validate-record-retirement.ts");
const RECORD_REL = "docs/plans/active/RM-GOVERNED-PATH";

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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const ok = runValidator(root);
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
    const bad = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("finding-eligible-still-live");
    expect(result.stderr).toContain("C-OLD");
    expect(result.stderr).toContain("retired sibling");
    expect((result.stderr.match(/finding-eligible-still-live/g) ?? []).length).toBe(1);
  });

  it("Closed-with citation reduction expands a range and does not treat mention outside the clause as payment", () => {
    const root = isolatedRoot();
    const parts = happyParts();
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">
  <Finding id="f1" token="F1" status="live">
    <Title>### F1 — live</Title>
    <Body>body one</Body>
  </Finding>
  <Finding id="f100" token="F100" status="live">
    <Title>### F100 — live</Title>
    <Body>body 100</Body>
  </Finding>
  <Finding id="f101" token="F101" status="live">
    <Title>### F101 — live</Title>
    <Body>body 101</Body>
  </Finding>
</Findings>
`;
    parts.registryRetired = `<Registry>
  <Row name="C-OLD" status="retired" kind="chartered">
    <Number>2</Number>
    <Charter>mentions F1 in charter only</Charter>
    <Pays></Pays>
    <StatusText>Delivered. Closed with [F100](#f100)–[F101](#f101). Also names F1 here after the period.</StatusText>
  </Row>
</Registry>
`;
    parts.index = `<RecordIndex base="10" headroom="40" ceiling="1000">
  <Entry id="f1" token="F1" genre="finding" layer="live" />
  <Entry id="f100" token="F100" genre="finding" layer="live" />
  <Entry id="f101" token="F101" genre="finding" layer="live" />
  <Entry id="f2" token="F2" genre="finding" layer="retired" />
  <Entry id="d1" token="D1" genre="decision" layer="live" />
</RecordIndex>
`;
    writeHappy(root, parts);
    const result = runValidator(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('token="F100"');
    expect(result.stderr).toContain('token="F101"');
    expect(result.stderr).not.toContain('token="F1"');
  });

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
    const stamped = runValidator(root, ["--stamp-paid-by"]);
    expect(stamped.status).toBe(0);
    const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const retired = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
    expect(live).toContain("<PaidBy>C-OLD</PaidBy>");
    expect(live).toContain('token="F1"');
    expect(retired).not.toContain('token="F1"');
    const stillRed = runValidator(root);
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
    const result = runValidator(root, ["--retire", RECORD_REL]);
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
    const result = runValidator(root, ["--split"]);
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
    const result = runValidator(root, ["--retire"]);
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
    const first = runValidator(root, ["--retire"]);
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
    const second = runValidator(root, ["--retire"]);
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
    const result = runValidator(root, ["--retire"]);
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
    const first = runValidator(root, ["--retire"]);
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
    const second = runValidator(root, ["--retire"]);
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
    const result = runValidator(root);
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
      `<Findings base="20" headroom="70" ceiling="1000">\n${f("f1", "F1")}\n${f("f2", "F2")}\n</Findings>\n`;
    writeHappy(root, parts);
    const asRead = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const baseLive = newlineCount(asRead);
    const result = runValidator(root, ["--retire"]);
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
    const inner = `${f("f1", "F1")}\n${f("f2", "F2")}`;
    const noAttrs = `<Findings>\n${inner}\n</Findings>\n`;
    const baseLive = newlineCount(noAttrs);
    const H = 7 * median(findingLineCounts(noAttrs));
    const ceilingLow = baseLive + H - 1;
    parts.findings = `<Findings base="${baseLive}" headroom="${H}" ceiling="${ceilingLow}">\n${inner}\n</Findings>\n`;
    writeHappy(root, parts);
    const result = runValidator(root, ["--retire"]);
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
    const result = runValidator(root, ["--retire"]);
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
    expect(runValidator(root).status, "the consistent fixture validates clean").toBe(0);
    const before = snapshotRecord(root);
    const result = runValidator(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status, result.stderr).toBe(0);
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: byte-identical`).toBe(text);
    }
    const second = runValidator(root, ["--rewrite-roots", RECORD_REL]);
    expect(second.status).toBe(0);
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: the second run is again a byte no-op`).toBe(text);
    }
  }, 60_000);

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
    const result = runValidator(root, ["--rewrite-roots", RECORD_REL]);
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
  }, 60_000);

  it("C-ROOT-WINDOW rewrite-roots refusal: a missing ceiling attribute exits 1 with nothing written", () => {
    const root = isolatedRoot();
    const parts = consistentParts();
    parts.registry = parts.registry.replace(/ ceiling="[0-9]+">/, ">");
    writeHappy(root, parts);
    const before = snapshotRecord(root);
    const result = runValidator(root, ["--rewrite-roots", RECORD_REL]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing-ceiling");
    expect(result.stderr).toContain("has no persisted ceiling");
    for (const [name, text] of Object.entries(before)) {
      expect(readFileSync(path.join(root, RECORD_REL, name), "utf8"), `${name}: nothing written`).toBe(text);
    }
  }, 60_000);

  it("C-ROOT-WINDOW rewrite-roots hold: a hand-raised ceiling passes through byte-for-byte — never recomputed and never adopted — while the base is repaired to the read-back", () => {
    const root = isolatedRoot();
    const parts = consistentParts();
    parts.registry = parts.registry.replace(
      /<Registry [^>]*>/,
      '<Registry base="12" headroom="78" ceiling="90">',
    );
    writeHappy(root, parts);
    const before = snapshotRecord(root);
    const result = runValidator(root, ["--rewrite-roots", RECORD_REL]);
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
  }, 60_000);

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
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">\n${f("f1", "F1", 0)}\n${f("f2", "F2", 14)}\n${f("f3", "F3", 15)}\n</Findings>\n`;
    writeHappy(root, parts);
    const asRead = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const baseLive = newlineCount(asRead);
    const result = runValidator(root, ["--retire"]);
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
  }, 60_000);

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
    const first = runValidator(root, ["--retire"]);
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
    const second = runValidator(root, ["--retire"]);
    expect(second.status, second.stderr).toBe(0);
    const rulingsAfterSecond = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(rulingsAfterSecond, "the unmoved rulings genre is byte-identical through both moves").toBe(rulingsBefore);
    const written = rootAttrs(rulingsAfterSecond);
    expect(written.headroom).toBe(written.ceiling - written.base);
    expect(written.base).toBe(newlineCount(rulingsAfterSecond));
  }, 60_000);

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
    const f = (id: string, token: string, body: string) =>
      `  <Finding id="${id}" token="${token}" status="live">\n    <Title>### ${token} — live</Title>\n    <Body>${body}</Body>\n  </Finding>`;
    // pre-existing drift: a blank line and a 4-space indent before f2 (F190's
    // shape) — the move's pass must normalise it away without touching bytes
    parts.findings = `<Findings base="20" headroom="70" ceiling="1000">\n${f("f1", "F1", "body one")}\n\n    ${f("f2", "F2", "body two")}\n${f("f3", "F3", "body three")}\n</Findings>\n`;
    writeHappy(root, parts);
    const beforeXml = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    expect(gapShapesCanonical(beforeXml), "the pre-move fixture carries non-canonical gaps (the drift the pass repairs)").toBe(false);
    const result = runValidator(root, ["--retire"]);
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
  }, 60_000);

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
    const result = runValidator(root, ["--retire"]);
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
    const result = runValidator(root);
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
    const result = runValidator(root);
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
    const result = runValidator(root, ["--retire"]);
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
    const result = runValidator(root, ["--retire"]);
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
    const result = runValidator(root, ["--retire"]);
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
    const validated = runValidator(root);
    expect(validated.status).toBe(0);
    expect(validated.stderr).not.toContain("decision-eligible-still-live");
    const retired = runValidator(root, ["--retire"]);
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
    const moved = runValidator(root, ["--retire"]);
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
    const taught = runValidator(root);
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
    const coded = runValidator(root);
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
    const validated = runValidator(root);
    expect(validated.status).not.toBe(0);
    expect(validated.stderr).toContain("codified-in-unresolved");
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const retired = runValidator(root, ["--retire"]);
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
    const validated = runValidator(root);
    expect(validated.status).not.toBe(0);
    expect(validated.stderr).toContain("codified-in-unresolved");
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const retired = runValidator(root, ["--retire"]);
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
    const both = runValidator(root, ["--retire"]);
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
    const one = runValidator(root2, ["--retire"]);
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
    const result = runValidator(root, ["--retire"]);
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
    const historical = runValidator(historicalRoot);
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
    const sweep = runValidator(sweepRoot);
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
    const chartered = runValidator(charteredRoot);
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
      const result = runValidator(root);
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
    const retired = runValidator(retiredRoot);
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

    const retired = runValidator(insertRoot, ["--retire", RECORD_REL]);
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
    const result = runValidator(root, ["--retire", RECORD_REL]);
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

      const validate = runValidator(REPO_ROOT);
      expect(validate.status).toBe(0);
      expect(validate.stdout).toContain("record-retirement: ok");
    },
    60_000,
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

      const validate = runValidator(REPO_ROOT);
      expect(validate.status).toBe(0);
      expect(validate.stdout).toContain("record-retirement: ok");
    },
    60_000,
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

      const first = runValidator(root, ["--retire"]);
      expect(first.status).toBe(0);
      const retiredFixture = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
      expect(retiredFixture, "the first --retire must move on the fixture").toContain(
        "<PaidBy>C-PROBE-ARCHIVE</PaidBy>",
      );

      const beforeSecond = readAll();
      const second = runValidator(root, ["--retire"]);
      expect(second.status).toBe(0);
      const afterSecond = readAll();
      for (const file of fixtureFiles) {
        expect(afterSecond[file], file).toBe(beforeSecond[file]);
      }

      for (let i = 0; i < productionFiles.length; i++) {
        expect(readFileSync(productionFiles[i]!, "utf8")).toBe(before[i]!);
      }
    },
    60_000,
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
    60_000,
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
    60_000,
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
    60_000,
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
      const controlRetire = runValidator(control, ["--retire", RECORD_REL]);
      expect(controlRetire.status).toBe(0);
      expect(controlRetire.stdout).toContain("moved 3");
      const controlPost = runValidator(control);
      expect(controlPost.status, "the unmodified tag is the control").toBe(0);

      for (const variant of ["single-quoted", "spaced", "reordered"] as const) {
        const root = isolatedRoot();
        buildFixture(root, ["--c-selection-row", `--f21-tag=${variant}`]);
        const retire = runValidator(root, ["--retire", RECORD_REL]);
        expect(retire.status, variant).toBe(0);
        expect(retire.stdout, variant).toContain("moved 3");
        // the element moved to the retired sibling, stamped — the open tag's
        // byte form is preserved, only the status value is spliced
        const expectedOpenTag: Record<(typeof variant), string> = {
          "single-quoted": "<Finding id='f21' token='F21' status='retired'>",
          "spaced": "<Finding id = \"f21\" token = \"F21\" status = \"retired\">",
          "reordered": "<Finding token=\"F21\" status=\"retired\" id=\"f21\">",
        };
        const retired = readFileSync(path.join(root, RECORD_REL, "findings-retired.xml"), "utf8");
        expect(retired, variant).toContain(expectedOpenTag[variant]);
        expect(retired, variant).toContain(`<PaidBy>C-SELECTION</PaidBy>`);
        const live = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
        expect(live, variant).not.toMatch(/<Finding[^>]*id\s*=\s*["']f21["']/);
        // the index layer flipped
        const index = readFileSync(path.join(root, RECORD_REL, "decisions.xml"), "utf8");
        expect(index, variant).toMatch(/<Entry id="f21"[^>]*layer="retired" \/>/);
        // and the moved record validates clean
        const post = runValidator(root);
        expect(post.status, `${variant}: post-move validate`).toBe(0);
      }
    },
    300_000,
  );

  it(
    "C-RECORD-PARSE false-payment probe: an archived spec quoting the payment phrase mints nothing by a prose route, both directions",
    () => {
      // with the parked spec planted as archive event C-PAYMENT-RECORD-3:
      // no finding becomes eligible because a sentence matched a pattern
      const withSpec = isolatedRoot();
      buildFixture(withSpec, ["--parked-spec"]);
      const withResult = runValidator(withSpec);
      expect(withResult.status, "with the parked spec planted").toBe(0);
      expect(withResult.stderr).not.toContain("finding-eligible-still-live");

      // control: the same fixture without the copied spec also validates green,
      // so the test discriminates
      const withoutSpec = isolatedRoot();
      buildFixture(withoutSpec, []);
      const withoutResult = runValidator(withoutSpec);
      expect(withoutResult.status, "without the parked spec").toBe(0);
    },
    300_000,
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
        F205: "C-INDEX-METRIC-2",
        F216: "C-ROOT-WINDOW",
        F182: "C-ROOT-WINDOW",
        F193: "C-ROOT-WINDOW",
        F190: "C-ROOT-WINDOW",
        F225: "C-ROOT-WINDOW",
        F226: "C-ROOT-WINDOW",
        F232: "C-FLUSH-AND-UNPIN",
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
      };
      for (const [token] of derived) {
        expect(derived.get(token), token).toBe(baseline[token] ?? bundleMinted[token]);
      }
    },
    60_000,
  );

  it(
    "C-RECORD-PARSE golden: a fixture --retire writes byte-for-byte the files the shipped engine wrote at capture time",
    () => {
      const root = isolatedRoot();
      buildFixture(root, ["--c-selection-row"]);
      const result = runValidator(root, ["--retire", RECORD_REL]);
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
    300_000,
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
    60_000,
  );

  it("C-RECORD-PARSE shape check: the clean control stays green while each refuse case exits non-zero with its record-shape- code", () => {
    // clean control: the happy fixture has genre elements as direct children
    // of the expected roots and no same-tag nesting
    const clean = isolatedRoot();
    writeHappy(clean);
    expect(runValidator(clean).status).toBe(0);

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
    const wrongResult = runValidator(wrongRoot);
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
    const nestedResult = runValidator(nested);
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
    const sameTagResult = runValidator(sameTag);
    expect(sameTagResult.status).not.toBe(0);
    expect(sameTagResult.stderr).toContain("record-shape-same-tag-nested");
  }, 60_000);

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
    60_000,
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
    60_000,
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
    60_000,
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
    60_000,
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
      // The StatusText carries no F token at all and mints nothing through
      // the Closed-with channel — the shipped closedWithTokens returns the
      // empty list over the delivered text.
      const statusText = childText(row.node, "StatusText") ?? "";
      expect(
        statusText.match(tokenRe) ?? [],
        `the row's StatusText carries no F token at all`,
      ).toEqual([]);
      expect(closedWithTokens(statusText), "closedWithTokens over the delivered StatusText is empty").toEqual([]);
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
        expect(
          readFileSync(path.join(REPO_ROOT, RECORD_REL, file), "utf8"),
          `${file}: the production run is read-only`,
        ).toBe(before.get(file));
      }
    },
    60_000,
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
      const result = runValidator(root);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    },
    60_000,
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
      const result = runValidator(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ceiling-exceeded");
      expect(result.stderr).toContain("live index live-entry count 2 exceeds persisted ceiling 1");
    },
    60_000,
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
      const result = runValidator(root);
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
    60_000,
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
      const result = runValidator(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ceiling-exceeded");
      expect(result.stderr).toContain("move the eligible entry to the retired sibling");
      expect(result.stderr).not.toContain("flip their index Entry layer");
    },
    60_000,
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
      const result = runValidator(fixtureRoot, ["--split"]);
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
    60_000,
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
    60_000,
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
    60_000,
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
    60_000,
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
    60_000,
  );

  it(
    "C-FLUSH-AND-REPAIR payment absence: the shipped derivePayerMap over the real archive and both registry layers mints none of the staged tokens, and the same derivation mints a planted token over an isolated archive root",
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
      expect(
        stagedTokens.filter((token) => productionMap.has(token)),
        "the production payer map mints none of the staged tokens — the payment set of this bundle is exactly empty",
      ).toEqual([]);
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
    60_000,
  );

  it(
    "C-FLUSH-AND-PAY clamp invariant: the persisted findings headroom is the clamp's result — equal to ceiling minus base and below seven times the median live element line count",
    () => {
      const recordDir = path.join(REPO_ROOT, RECORD_REL);
      const findingsXml = readFileSync(path.join(recordDir, "findings.xml"), "utf8");
      const parsed = parseGraceXmlArtifact("findings.xml", findingsXml);
      const root = parsed.root!;
      const base = Number(root.attributes.base);
      const headroom = Number(root.attributes.headroom);
      const ceiling = Number(root.attributes.ceiling);
      // the arithmetic mirrored over the shipped parser because findingLineCounts is not exported
      const spans = computeElementSpans(findingsXml, parsed);
      const liveCounts: number[] = [];
      for (const node of walkNodes(root)) {
        if (node.tag !== "Finding" || node.attributes.status === "retired") {
          continue;
        }
        const span = spans.get(node)!;
        if (span.closeStart === null || span.closeEnd === null) {
          continue;
        }
        liveCounts.push(newlineCount(findingsXml.slice(span.openStart, span.closeEnd)) + 1);
      }
      const product = 7 * median(liveCounts);
      expect(base + headroom, "base plus headroom equals ceiling").toBe(ceiling);
      expect(base, "base equals the file's newlineCount").toBe(newlineCount(findingsXml));
      expect(headroom, "the persisted headroom is below seven times the median live element line count — the clamp binds").toBeLessThan(product);
    },
    60_000,
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
    60_000,
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
    60_000,
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
// bare non-mutating runValidator(REPO_ROOT) calls stay legal. The helper's own
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
    60_000,
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
        expect(
          readFileSync(path.join(recordDir, file), "utf8"),
          `${file}: the production run is read-only`,
        ).toBe(before.get(file));
      }
    },
    60_000,
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
    60_000,
  );
});
