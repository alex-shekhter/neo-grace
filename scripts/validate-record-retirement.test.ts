import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  isFirstRulingsRewrite,
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

  it("probe 1: split-shaped fixture predicate is true and --retire persists the 7-times formula ceiling even when larger", () => {
    const root = isolatedRoot();
    const parts = splitShapedParts();
    writeHappy(root, parts);
    const counts = h2LineCounts(parts.rulings);
    const persisted = rootAttrs(parts.rulings);
    expect(
      isFirstRulingsRewrite({
        persistedBase: persisted.base,
        persistedHeadroom: persisted.headroom,
        persistedCeiling: persisted.ceiling,
        liveH2DecisionLineCounts: counts,
      }),
    ).toBe(true);
    const result = runValidator(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const written = rootAttrs(after);
    const afterCounts = h2LineCounts(after);
    const newBase = newlineCount(after);
    const newHeadroom = 7 * median(afterCounts);
    expect(written.headroom).toBe(newHeadroom);
    expect(written.base).toBe(newBase);
    expect(written.ceiling).toBe(newBase + newHeadroom);
    expect(written.ceiling).toBeGreaterThan(persisted.ceiling);
    expect(
      isFirstRulingsRewrite({
        persistedBase: written.base,
        persistedHeadroom: written.headroom,
        persistedCeiling: written.ceiling,
        liveH2DecisionLineCounts: afterCounts,
      }),
    ).toBe(false);
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
    expect(
      isFirstRulingsRewrite({
        persistedBase: base,
        persistedHeadroom: headroom,
        persistedCeiling: ceiling,
        liveH2DecisionLineCounts: counts,
      }),
    ).toBe(false);
    const result = runValidator(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const written = rootAttrs(after);
    expect(written.ceiling).toBe(ceiling);
    expect(written.ceiling).toBeLessThan(newlineCount(after) + 7 * median(h2LineCounts(after)));
    expect(written.headroom).toBe(written.ceiling - written.base);
  });

  it("probe 4: no-op --retire on a split-shaped fixture leaves attributes unchanged so the predicate stays true", () => {
    const root = isolatedRoot();
    const parts = splitShapedParts();
    parts.registryRetired = happyParts().registryRetired;
    writeHappy(root, parts);
    const before = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    const persisted = rootAttrs(before);
    expect(
      isFirstRulingsRewrite({
        persistedBase: persisted.base,
        persistedHeadroom: persisted.headroom,
        persistedCeiling: persisted.ceiling,
        liveH2DecisionLineCounts: h2LineCounts(before),
      }),
    ).toBe(true);
    const result = runValidator(root, ["--retire"]);
    expect(result.status).toBe(0);
    const after = readFileSync(path.join(root, RECORD_REL, "rulings.xml"), "utf8");
    expect(after).toBe(before);
    expect(
      isFirstRulingsRewrite({
        persistedBase: persisted.base,
        persistedHeadroom: persisted.headroom,
        persistedCeiling: persisted.ceiling,
        liveH2DecisionLineCounts: h2LineCounts(after),
      }),
    ).toBe(true);
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
