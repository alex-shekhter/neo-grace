import path from "node:path";

import { stripGoNoise } from "../scanners/go-lexer";
import type { LanguageAdapter, LanguageAnalysis } from "../types";

export type GoDeclKind = "func" | "method" | "type" | "var" | "const";

export type GoDeclaration = {
  kind: GoDeclKind;
  name: string;
  exported: boolean;
  receiver?: string;
};

type GoFileFacts = {
  packageName: string;
  hasBuildConstraint: boolean;
  importsC: boolean;
  importsTesting: boolean;
  hasTestFunc: boolean;
  hasMainFunc: boolean;
};

const IDENT_START = /\p{L}|_/u;
const IDENT_CONT = /\p{L}|\p{Nd}|_/u;

function isExportedName(name: string): boolean {
  const first = name[0];
  if (!first) return false;
  // Go export rule: first character is uppercase Unicode letter.
  return first !== first.toLowerCase() && first === first.toUpperCase() && /\p{L}/u.test(first);
}

function isIdentStart(ch: string | undefined): boolean {
  return Boolean(ch && IDENT_START.test(ch));
}

function isIdentCont(ch: string | undefined): boolean {
  return Boolean(ch && IDENT_CONT.test(ch));
}

function skipWhitespace(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i]!)) {
    i += 1;
  }
  return i;
}

function readIdentifier(src: string, i: number): { name: string; next: number } | null {
  if (!isIdentStart(src[i])) {
    return null;
  }
  let j = i + 1;
  while (j < src.length && isIdentCont(src[j])) {
    j += 1;
  }
  return { name: src.slice(i, j), next: j };
}

function peekWord(src: string, i: number): string | null {
  const id = readIdentifier(src, i);
  return id?.name ?? null;
}

/** Skip a balanced [...] generic parameter list immediately after an identifier. */
function skipGenericParams(src: string, i: number): number {
  i = skipWhitespace(src, i);
  if (src[i] !== "[") {
    return i;
  }
  let depth = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        return i;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function skipBalanced(src: string, i: number, open: string, close: string): number {
  if (src[i] !== open) {
    return i;
  }
  let depth = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === open) {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        return i;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function skipToEndOfLine(src: string, i: number): number {
  while (i < src.length && src[i] !== "\n") {
    i += 1;
  }
  return i;
}

/**
 * Advance past one grouped-declaration entry, consuming any body it opens.
 * Leaving the group's own closing `)` for the main loop (paren depth 0).
 * Unlike skipToEndOfLine, multi-line struct/interface/composite-literal bodies
 * do not leak field names as further group entries.
 */
function skipGroupedEntry(src: string, i: number): number {
  let brace = 0;
  let bracket = 0;
  let paren = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "{") {
      brace += 1;
    } else if (ch === "}") {
      brace -= 1;
    } else if (ch === "[") {
      bracket += 1;
    } else if (ch === "]") {
      bracket -= 1;
    } else if (ch === "(") {
      paren += 1;
    } else if (ch === ")") {
      // Depth 0 here is the group's own closing paren: leave it for the main loop.
      if (paren === 0 && brace === 0 && bracket === 0) {
        return i;
      }
      paren -= 1;
    } else if (ch === "\n" && brace === 0 && bracket === 0 && paren === 0) {
      return i + 1;
    }
    i += 1;
  }
  return i;
}

/**
 * Skip a function signature after the name (and optional generics): parameters,
 * optional result list/type, until `{` or newline for body-less declarations.
 * Leaves `i` at the `{` so brace-depth tracking owns the body, or past `;`/EOL.
 */
function skipFuncSignature(src: string, i: number): number {
  i = skipWhitespace(src, i);
  if (src[i] === "(") {
    i = skipBalanced(src, i, "(", ")");
  }
  i = skipWhitespace(src, i);
  // Result: (T, U) or single type / identifier path
  if (src[i] === "(") {
    i = skipBalanced(src, i, "(", ")");
  } else if (src[i] === "*" || isIdentStart(src[i]) || src[i] === "[" || src[i] === "<") {
    // Approximate: advance until `{`, `;`, or newline at paren depth 0
    let paren = 0;
    let bracket = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === "(") {
        paren += 1;
        i += 1;
        continue;
      }
      if (ch === ")") {
        paren -= 1;
        i += 1;
        continue;
      }
      if (ch === "[") {
        bracket += 1;
        i += 1;
        continue;
      }
      if (ch === "]") {
        bracket -= 1;
        i += 1;
        continue;
      }
      if (paren === 0 && bracket === 0 && (ch === "{" || ch === ";" || ch === "\n")) {
        break;
      }
      i += 1;
    }
  }
  return i;
}

function isStartOfLogicalLine(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (src[j] === " " || src[j] === "\t")) {
    j -= 1;
  }
  return j < 0 || src[j] === "\n" || src[j] === "(";
}

function pushDecl(
  decls: GoDeclaration[],
  kind: GoDeclKind,
  name: string,
  receiver?: string,
): void {
  if (!name || name === "_") {
    return;
  }
  decls.push({
    kind,
    name,
    exported: isExportedName(name),
    ...(receiver !== undefined ? { receiver } : {}),
  });
}

/**
 * Scan top-level package declarations from noise-stripped Go source.
 * Never throws: truncated or unusual input yields a partial declaration list.
 */
export function scanTopLevelDeclarations(stripped: string): GoDeclaration[] {
  const decls: GoDeclaration[] = [];
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let groupKind: "type" | "var" | "const" | null = null;
  let recovered = true;

  try {
    while (i < stripped.length) {
      const ch = stripped[i]!;

      if (ch === "{") {
        braceDepth += 1;
        i += 1;
        continue;
      }
      if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        i += 1;
        continue;
      }

      if (braceDepth > 0) {
        i += 1;
        continue;
      }

      if (ch === "(") {
        parenDepth += 1;
        i += 1;
        continue;
      }
      if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        if (parenDepth === 0) {
          groupKind = null;
        }
        i += 1;
        continue;
      }

      // Grouped declaration bodies: var ( A = 1 \n B = 2 )
      if (parenDepth > 0 && groupKind !== null) {
        if (isStartOfLogicalLine(stripped, i) && isIdentStart(ch)) {
          const id = readIdentifier(stripped, i);
          if (id && id.name !== "_") {
            // Skip iota / type-only lines that begin with a keyword-like form:
            // only treat as a declaration name if not a Go keyword.
            if (!["type", "var", "const", "func", "package", "import"].includes(id.name)) {
              pushDecl(decls, groupKind, id.name);
            }
            i = skipGroupedEntry(stripped, id.next);
            continue;
          }
        }
        i += 1;
        continue;
      }

      const word = peekWord(stripped, i);
      if (!word) {
        i += 1;
        continue;
      }

      if (word === "package") {
        i = skipToEndOfLine(stripped, i + word.length);
        continue;
      }

      if (word === "import") {
        let j = skipWhitespace(stripped, i + word.length);
        if (stripped[j] === "(") {
          // Parenthesized import block — track via parenDepth by advancing into it.
          parenDepth += 1;
          j += 1;
          i = j;
          // Consume until matching close paren without treating contents as decls.
          let depth = 1;
          while (j < stripped.length && depth > 0) {
            if (stripped[j] === "(") depth += 1;
            else if (stripped[j] === ")") depth -= 1;
            j += 1;
          }
          parenDepth = Math.max(0, parenDepth - 1);
          i = j;
          continue;
        }
        // Single import spec
        i = skipToEndOfLine(stripped, j);
        continue;
      }

      if (word === "func") {
        let j = skipWhitespace(stripped, i + 4);
        if (stripped[j] === "(") {
          // Method: func (r *Recv) Name[T any](...)
          const recvStart = j + 1;
          j = skipBalanced(stripped, j, "(", ")");
          const receiver = stripped.slice(recvStart, j - 1).trim();
          j = skipWhitespace(stripped, j);
          const id = readIdentifier(stripped, j);
          if (id) {
            j = skipGenericParams(stripped, id.next);
            pushDecl(decls, "method", id.name, receiver);
            j = skipFuncSignature(stripped, j);
            i = j;
            continue;
          }
          i = j;
          continue;
        }

        const id = readIdentifier(stripped, j);
        if (id) {
          j = skipGenericParams(stripped, id.next);
          pushDecl(decls, "func", id.name);
          j = skipFuncSignature(stripped, j);
          i = j;
          continue;
        }
        i = j;
        continue;
      }

      if (word === "type" || word === "var" || word === "const") {
        let j = skipWhitespace(stripped, i + word.length);
        if (stripped[j] === "(") {
          groupKind = word;
          parenDepth += 1;
          i = j + 1;
          continue;
        }

        // Single or multi-name form: var A, B = 1, 2 / type Name struct{} / const X = 1
        while (j < stripped.length) {
          j = skipWhitespace(stripped, j);
          const id = readIdentifier(stripped, j);
          if (!id) {
            break;
          }
          pushDecl(decls, word, id.name);
          j = skipWhitespace(stripped, id.next);
          if (stripped[j] === ",") {
            j += 1;
            continue;
          }
          break;
        }

        // Skip remainder of declaration until next top-level-ish boundary.
        // Type bodies use braces tracked by the main loop; advance to `{` or EOL/`(` group end.
        while (j < stripped.length) {
          const c = stripped[j]!;
          if (c === "{") {
            i = j;
            break;
          }
          if (c === "\n" && parenDepth === 0) {
            // Could be multi-line type/var; peek ahead for continuation is hard —
            // for single-line forms EOL ends; if next non-space is `{` keep going.
            let k = j + 1;
            k = skipWhitespace(stripped, k);
            if (stripped[k] === "{") {
              j = k;
              continue;
            }
            i = j + 1;
            break;
          }
          if (c === ";") {
            i = j + 1;
            break;
          }
          j += 1;
          i = j;
        }
        continue;
      }

      i += word.length;
    }
  } catch {
    recovered = false;
  }

  // Attach a soft flag for the adapter via a non-enumerable property when recovery failed.
  if (!recovered) {
    (decls as GoDeclaration[] & { incomplete?: boolean }).incomplete = true;
  }
  return decls;
}

function collectFileFacts(rawText: string, stripped: string, decls: GoDeclaration[]): GoFileFacts {
  const hasBuildConstraint = /^\s*\/\/go:build\s/m.test(rawText) || /^\s*\/\/\s*\+build\s/m.test(rawText);
  const packageMatch = stripped.match(/^\s*package\s+(\w+)/m);
  const packageName = packageMatch?.[1] ?? "";

  // Import specs for "C" and "testing" — match common forms including parenthesized blocks.
  const importsC = /import\s+(?:\w+\s+)?"C"|import\s*\(\s*(?:[^)]*\n)?\s*(?:\w+\s+)?"C"/.test(rawText)
    || /import\s*\([^)]*"C"[^)]*\)/s.test(rawText);
  const importsTesting = /import\s+(?:\.\s+|\w+\s+)?"testing"|import\s*\([^)]*"testing"[^)]*\)/s.test(rawText);

  const hasTestFunc = decls.some(
    (d) => d.kind === "func" && /^(Test|Benchmark|Fuzz|Example)/.test(d.name),
  );
  const hasMainFunc = packageName === "main" && decls.some((d) => d.kind === "func" && d.name === "main");

  return {
    packageName,
    hasBuildConstraint,
    importsC,
    importsTesting,
    hasTestFunc,
    hasMainFunc,
  };
}

function looksTruncated(stripped: string): boolean {
  // Unbalanced braces/parens indicate truncated or incomplete source.
  // Multi-line signatures (idiomatic Go) must not force heuristic confidence —
  // balance alone catches real truncation (e.g. `func Broken(`).
  let braces = 0;
  let parens = 0;
  for (const ch of stripped) {
    if (ch === "{") braces += 1;
    else if (ch === "}") braces -= 1;
    else if (ch === "(") parens += 1;
    else if (ch === ")") parens -= 1;
  }
  return braces !== 0 || parens !== 0;
}

export function createGoAdapter(): LanguageAdapter {
  return {
    id: "go",
    supports(filePath) {
      return path.extname(filePath) === ".go";
    },
    analyze(filePath, text) {
      // Never throw: unparseable Go degrades to heuristic with partial recovery.
      let stripped = text;
      let decls: GoDeclaration[] = [];
      try {
        stripped = stripGoNoise(text);
        decls = scanTopLevelDeclarations(stripped);
      } catch {
        decls = [];
      }

      const facts = collectFileFacts(text, stripped, decls);
      const valueExports = new Set<string>();
      const typeExports = new Set<string>();
      const localSymbols = new Set<string>();

      for (const d of decls) {
        // Methods are never package-level exports (Go export unit is the package identifier).
        if (d.kind === "method") {
          localSymbols.add(d.name);
          continue;
        }

        if (d.exported) {
          if (d.kind === "type") {
            typeExports.add(d.name);
          } else {
            valueExports.add(d.name);
          }
        }
        localSymbols.add(d.name);
      }

      const exports = new Set<string>([...valueExports, ...typeExports]);
      const truncated = looksTruncated(stripped);
      const incomplete = Boolean((decls as GoDeclaration[] & { incomplete?: boolean }).incomplete);
      const exportConfidence: LanguageAnalysis["exportConfidence"] =
        facts.hasBuildConstraint || facts.importsC || truncated || incomplete
          ? "heuristic"
          : "exact";

      return {
        adapterId: "go",
        exports,
        valueExports,
        typeExports,
        localSymbols,
        exportConfidence,
        hasDefaultExport: false,
        hasWildcardReExport: false,
        hasMainEntrypoint: facts.hasMainFunc,
        directReExportCount: 0,
        localExportCount: exports.size,
        localImplementationCount: decls.filter((d) => d.kind !== "method").length,
        usesTestFramework: facts.importsTesting || facts.hasTestFunc,
      };
    },
  };
}
