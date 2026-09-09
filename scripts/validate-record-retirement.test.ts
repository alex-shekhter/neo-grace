import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { childNodes, childText, parseGraceXmlArtifact, walkNodes } from "../src/artifact/xml.ts";
import {
  RULINGS_PROVENANCE_CEILING,
  derivePayerMap,
  listArchiveNames,
  liveH2DecisionLineCounts,
  median,
  newlineCount,
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

  it("T-001 min not decorative: hand-shrunk findings persist ceiling = Base_live + H without a findings move", () => {
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
    const baseLive = newlineCount(asRead);
    const result = runValidator(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "findings.xml"), "utf8");
    const written = rootAttrs(after);
    const H = 7 * median(findingLineCounts(after));
    expect(written.ceiling).toBe(baseLive + H);
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
      for (const [token] of derived) {
        expect(baseline[token], `${token} must exist in the baseline map`).toBeDefined();
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
        // The shipped metric read back from the file: the exported
        // newlineCount (whole-file lines) for the three line-budgeted
        // genres; the liveRowCount rule — direct Row children whose status
        // is not retired — over the shipped parser for registry (the rule
        // is mirrored, liveRowCount itself is not exported).
        const metric = file === "registry.xml"
          ? childNodes(root, "Row").filter((row) => row.attributes.status !== "retired").length
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

const GUARD_FLAGS = ["--retire", "--stamp-paid-by", "--split"];

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