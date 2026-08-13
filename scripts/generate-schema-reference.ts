import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderSchemaReference } from "../src/artifact/schema-reference";

const RELATIVE_PATH = path.join("docs", "schema-reference.md");

export function checkSchemaReference(root: string): number {
  const file = path.join(root, RELATIVE_PATH);
  if (!existsSync(file)) {
    return 1;
  }
  const actual = readFileSync(file, "utf8");
  return actual === renderSchemaReference() ? 0 : 1;
}

export function writeSchemaReference(root: string): void {
  const file = path.join(root, RELATIVE_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderSchemaReference());
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  if (process.argv.includes("check")) {
    process.exitCode = checkSchemaReference(root);
  } else {
    writeSchemaReference(root);
  }
}
