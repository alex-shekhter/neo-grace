import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderChangePlan, renderChangeSpec } from "../src/artifact/skeletons";
import { checkSkeletonTemplates } from "./generate-skeleton-templates";

const TEMPLATE_PATHS = [
  "skills/ngrace/ngrace-spec/references/change-spec-template.xml",
  "skills/ngrace/ngrace-plan/references/change-plan-template.xml",
  "plugins/ngrace/skills/ngrace/ngrace-spec/references/change-spec-template.xml",
  "plugins/ngrace/skills/ngrace/ngrace-plan/references/change-plan-template.xml",
] as const;

const tempRoots: string[] = [];

function isolatedRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "ngrace-skeleton-templates-"));
  tempRoots.push(root);
  return root;
}

function teachingBytes(): { spec: string; plan: string } {
  const spec = renderChangeSpec("C-CHANGE-ID", { teaching: true });
  const plan = renderChangePlan("C-CHANGE-ID", spec, { teaching: true });
  return { spec, plan };
}

function writeAllTemplates(root: string, spec: string, plan: string): void {
  for (const relative of TEMPLATE_PATHS) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, relative.includes("change-spec-template") ? spec : plan);
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("checkSkeletonTemplates", () => {
  it("returns non-zero when a template is missing under an isolated root", () => {
    const root = isolatedRoot();
    expect(checkSkeletonTemplates(root)).not.toBe(0);
    expect(existsSync(path.join(root, TEMPLATE_PATHS[0]))).toBe(false);
  });

  it("returns non-zero when a template differs from the teaching emission", () => {
    const root = isolatedRoot();
    const { spec, plan } = teachingBytes();
    writeAllTemplates(root, spec, plan);
    writeFileSync(path.join(root, TEMPLATE_PATHS[0]), `${spec}<!-- stale -->\n`);
    expect(checkSkeletonTemplates(root)).not.toBe(0);
  });

  it("returns zero when all four templates match the teaching emission", () => {
    const root = isolatedRoot();
    const { spec, plan } = teachingBytes();
    writeAllTemplates(root, spec, plan);
    expect(checkSkeletonTemplates(root)).toBe(0);
  });

  it("does not write missing files in check mode", () => {
    const root = isolatedRoot();
    expect(checkSkeletonTemplates(root)).not.toBe(0);
    for (const relative of TEMPLATE_PATHS) {
      expect(existsSync(path.join(root, relative))).toBe(false);
    }
  });

  it("composes the check token into validate:ci", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["validate:skeleton-templates"]).toContain("generate-skeleton-templates");
    expect(pkg.scripts["validate:skeleton-templates"]).toMatch(/(?:^|\s)check(?:\s|$)/);
    expect(pkg.scripts["validate:ci"]).toContain("validate:skeleton-templates");
  });
});
