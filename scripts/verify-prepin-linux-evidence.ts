import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

const TITLE_CLEANUP = "AC-CLEANUP-BOUNDED pre-pin control: b53d13d deletes the recycled replacement";
const TITLE_RECLAIM = "AC-CANDIDATE-RECLAIM-EXCLUSIVE pre-pin control: b53d13d unlinks the recycled replacement";

type GhRun = { databaseId: number; headSha: string; status: string; conclusion: string };
type ParsedCase = { name: string; body: string };

function fail(message: string): never {
  throw new Error(message);
}

function parseTestCases(xml: string): ParsedCase[] {
  const cases: ParsedCase[] = [];
  const close = "</testcase>";
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<testcase", cursor);
    if (start < 0) break;
    const tagEnd = xml.indexOf(">", start);
    if (tagEnd < 0) fail("unclosed testcase tag");
    const opening = xml.slice(start, tagEnd + 1);
    const name = /\bname="([^"]*)"/.exec(opening)?.[1] ?? "";
    if (opening.endsWith("/>")) {
      cases.push({ name, body: "" });
      cursor = tagEnd + 1;
      continue;
    }
    let depth = 1;
    let scan = tagEnd + 1;
    while (depth > 0) {
      const nextOpen = xml.indexOf("<testcase", scan);
      const nextClose = xml.indexOf(close, scan);
      if (nextClose < 0) fail("unclosed testcase element");
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        scan = nextOpen + "<testcase".length;
      } else {
        depth -= 1;
        if (depth === 0) {
          cases.push({ name, body: xml.slice(tagEnd + 1, nextClose) });
          cursor = nextClose + close.length;
        } else {
          scan = nextClose + close.length;
        }
      }
    }
  }
  return cases;
}

function forbiddenChild(body: string): boolean {
  return /<(skipped|failure|error)\b/.test(body);
}

describe("prepin linux evidence", () => {
  it("accepts the newest successful exact-head prepin-behavior-junit artifact", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    expect(head.status, head.stderr ?? "").toBe(0);
    const sha = (head.stdout ?? "").trim();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // gh run list --commit <sha> --workflow validate.yml --limit 20 --json databaseId,headSha,status,conclusion
    const listed = spawnSync("gh", [
      "run", "list",
      "--commit", sha,
      "--workflow", "validate.yml",
      "--limit", "20",
      "--json", "databaseId,headSha,status,conclusion",
    ], { encoding: "utf8" });
    if (listed.error || listed.status !== 0) fail(`gh run list failed: ${listed.error?.message ?? listed.stderr ?? ""}`);
    const runs = JSON.parse(listed.stdout ?? "") as GhRun[];
    if (!Array.isArray(runs)) fail("gh run list did not return a list");
    const match = runs.find((run) => run.headSha === sha);
    if (!match) fail("no gh run for HEAD");
    expect(match.status).toBe("completed");
    expect(match.conclusion).toBe("success");
    const dir = mkdtempSync(path.join(tmpdir(), "prepin-evidence-"));
    try {
      const downloaded = spawnSync("gh", [
        "run", "download", String(match.databaseId),
        "--name", "prepin-behavior-junit",
        "--dir", dir,
      ], { encoding: "utf8" });
      if (downloaded.error || downloaded.status !== 0) {
        fail(`gh run download failed: ${downloaded.error?.message ?? downloaded.stderr ?? ""}`);
      }
      const headFile = path.join(dir, "prepin-behavior-head.txt");
      const junitFile = path.join(dir, "prepin-behavior-junit.xml");
      expect(existsSync(headFile)).toBe(true);
      expect(existsSync(junitFile)).toBe(true);
      expect(readFileSync(headFile, "utf8").trim()).toBe(sha);
      const cases = parseTestCases(readFileSync(junitFile, "utf8"));
      for (const title of [TITLE_CLEANUP, TITLE_RECLAIM]) {
        const found = cases.filter((item) => item.name === title);
        expect(found.length).toBe(1);
        expect(forbiddenChild(found[0]?.body ?? "")).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
