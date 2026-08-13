import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderChangePlan, renderChangeSpec } from "../src/artifact/skeletons";

const TEMPLATE_PATHS = {
  specCanonical: path.join("skills", "ngrace", "ngrace-spec", "references", "change-spec-template.xml"),
  planCanonical: path.join("skills", "ngrace", "ngrace-plan", "references", "change-plan-template.xml"),
  specPackaged: path.join("plugins", "ngrace", "skills", "ngrace", "ngrace-spec", "references", "change-spec-template.xml"),
  planPackaged: path.join("plugins", "ngrace", "skills", "ngrace", "ngrace-plan", "references", "change-plan-template.xml"),
} as const;

function teachingEmissions(): { spec: string; plan: string } {
  const spec = renderChangeSpec("C-CHANGE-ID", { teaching: true });
  const plan = renderChangePlan("C-CHANGE-ID", spec, { teaching: true });
  return { spec, plan };
}

function expectedFor(relative: string, emissions: { spec: string; plan: string }): string {
  return relative.includes("change-spec-template") ? emissions.spec : emissions.plan;
}

/** Return non-zero when any spec/plan template is missing or differs from the teaching emission. */
export function checkSkeletonTemplates(root: string): number {
  const emissions = teachingEmissions();
  for (const relative of Object.values(TEMPLATE_PATHS)) {
    const file = path.join(root, relative);
    if (!existsSync(file)) {
      return 1;
    }
    if (readFileSync(file, "utf8") !== expectedFor(relative, emissions)) {
      return 1;
    }
  }
  return 0;
}

export function writeSkeletonTemplates(root: string): void {
  const emissions = teachingEmissions();
  for (const relative of Object.values(TEMPLATE_PATHS)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, expectedFor(relative, emissions));
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  if (process.argv.includes("check")) {
    process.exitCode = checkSkeletonTemplates(root);
  } else {
    writeSkeletonTemplates(root);
  }
}
