import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  RULINGS_PROVENANCE_CEILING,
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
    "AC-PAYMENT-SET: production retired registry holds the four historical names; payment-set tokens are retired with stamped PaidBy; both F27.1 elements moved; a second --retire writes no byte",
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

      const f21Live = liveFindingHits.filter((f) => f.token === "F21");
      expect(f21Live.map((f) => f.id).sort()).toEqual(["f21", "f21-correction"]);

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
      const second = runValidator(REPO_ROOT, ["--retire"]);
      expect(second.status).toBe(0);
      for (let i = 0; i < productionFiles.length; i++) {
        expect(readFileSync(productionFiles[i]!, "utf8")).toBe(before[i]);
      }

      const validate = runValidator(REPO_ROOT);
      expect(validate.status).toBe(0);
      expect(validate.stdout).toContain("record-retirement: ok");
    },
    60_000,
  );

  it(
    "AC-TAG-AND-RETIRE: production D5.1 D7 D9 D18 are retired with named CodifiedIn; D24 untouched; second --retire writes no byte",
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
      const second = runValidator(REPO_ROOT, ["--retire"]);
      expect(second.status).toBe(0);
      for (let i = 0; i < productionFiles.length; i++) {
        expect(readFileSync(productionFiles[i]!, "utf8")).toBe(before[i]);
      }
      const validate = runValidator(REPO_ROOT);
      expect(validate.status).toBe(0);
      expect(validate.stdout).toContain("record-retirement: ok");
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
