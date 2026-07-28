import path from "node:path";

import { stripRustNoise } from "../scanners/rust-lexer";
import type { LanguageAdapter, LanguageAnalysis } from "../types";

export type Visibility = "pub" | "pub-restricted" | "private";

export type RustItemKind =
  | "fn"
  | "struct"
  | "enum"
  | "trait"
  | "type"
  | "union"
  | "const"
  | "static"
  | "mod"
  | "macro"
  | "use"
  | "impl";

export type RustItem = {
  kind: RustItemKind;
  name: string;
  visibility: Visibility;
};

export type ScanFlags = {
  hasWildcardReExport: boolean;
  directReExportCount: number;
  macroGenerated: boolean;
  hasCfgGatedItem: boolean;
  hasInclude: boolean;
  usesTestFramework: boolean;
  hasMainFn: boolean;
};

const IDENT_START = /[\p{L}_]/u;
const IDENT_CONT = /[\p{L}\p{Nd}_]/u;

function isIdentStart(ch: string | undefined): boolean {
  return Boolean(ch && IDENT_START.test(ch));
}

function isIdentCont(ch: string | undefined): boolean {
  return Boolean(ch && IDENT_CONT.test(ch));
}

function skipWhitespace(src: string, i: number): number {
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function readIdentifier(src: string, i: number): { name: string; next: number } | null {
  // Raw identifier: r#type, r#match — the r# prefix is part of the name.
  const start = i;
  if (src[i] === "r" && src[i + 1] === "#" && isIdentStart(src[i + 2])) {
    i += 2;
  }
  if (!isIdentStart(src[i])) {
    return null;
  }
  let j = i + 1;
  while (j < src.length && isIdentCont(src[j])) {
    j += 1;
  }
  return { name: src.slice(start, j), next: j };
}

function peekWord(src: string, i: number): string | null {
  return readIdentifier(src, i)?.name ?? null;
}

/** Skip balanced <...>, (...), [...], or {...} starting at open char. */
function skipBalanced(src: string, i: number, open: string, close: string): number {
  if (src[i] !== open) {
    return i;
  }
  let depth = 0;
  while (i < src.length) {
    const ch = src[i]!;
    // Angle brackets also appear in `->` and comparisons; for generics we only
    // call this when we know we're at a generic list after a name.
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

/**
 * Skip a generic parameter list after a name. Handles nested <> and lifetimes.
 * Uses depth on '<' / '>' only; skips `'ident` lifetimes so `>` in paths is rare.
 */
function skipGenerics(src: string, i: number): number {
  i = skipWhitespace(src, i);
  if (src[i] !== "<") {
    return i;
  }
  let depth = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "<") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ">") {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        return i;
      }
      continue;
    }
    // Skip string/char noise already stripped; still advance.
    i += 1;
  }
  return i;
}

/**
 * After reading an item name (+ generics), consume until the item is fully past —
 * including multi-line bodies via brace/bracket/paren depth. Never "skip to EOL"
 * when a body can open (Phase 2 Go bug class).
 *
 * Returns the index after the item (past trailing `;` if present).
 */
function skipItemTail(src: string, i: number): number {
  let brace = 0;
  let bracket = 0;
  let paren = 0;
  let sawBodyOrSemi = false;

  while (i < src.length) {
    const ch = src[i]!;

    if (ch === "{") {
      brace += 1;
      sawBodyOrSemi = true;
      i += 1;
      continue;
    }
    if (ch === "}") {
      brace -= 1;
      i += 1;
      if (brace === 0 && bracket === 0 && paren === 0 && sawBodyOrSemi) {
        return i;
      }
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
    if (ch === ";" && brace === 0 && bracket === 0 && paren === 0) {
      return i + 1;
    }
    // Unit struct / type alias without body ends at `;` only; if we never saw
    // `{`/`[` and hit another item keyword-ish at depth 0 after newline... keep going.
    i += 1;
  }
  return i;
}

function readVisibility(src: string, i: number): { kind: Visibility; end: number } {
  i = skipWhitespace(src, i);
  const id = readIdentifier(src, i);
  if (!id || id.name !== "pub") {
    return { kind: "private", end: i };
  }
  let j = skipWhitespace(src, id.next);
  if (src[j] === "(") {
    // pub(crate) / pub(super) / pub(in path)
    j = skipBalanced(src, j, "(", ")");
    return { kind: "pub-restricted", end: j };
  }
  return { kind: "pub", end: id.next };
}

function readBalancedBrackets(src: string, i: number): { text: string; end: number } {
  // i at '#' of #[...] or #![...]
  const start = i;
  i += 1;
  if (src[i] === "!") {
    i += 1;
  }
  if (src[i] !== "[") {
    return { text: src.slice(start, i), end: i };
  }
  const end = skipBalanced(src, i, "[", "]");
  return { text: src.slice(start, end), end };
}

type UseTreeResult = {
  boundNames: string[];
  hasWildcard: boolean;
  end: number;
};

/**
 * Parse a use tree starting at `use` keyword. Handles nested groups and aliases.
 * Multi-line groups are required to work (case 39).
 */
function readUseTree(src: string, i: number): UseTreeResult {
  // i at 'u' of use
  const useId = readIdentifier(src, i);
  let j = skipWhitespace(src, useId?.next ?? i);

  const boundNames: string[] = [];
  let hasWildcard = false;

  function parseTree(at: number): number {
    at = skipWhitespace(src, at);
    if (src[at] === "*") {
      hasWildcard = true;
      return at + 1;
    }
    if (src[at] === "{") {
      at += 1;
      while (at < src.length) {
        at = skipWhitespace(src, at);
        if (src[at] === "}") {
          return at + 1;
        }
        if (src[at] === ",") {
          at += 1;
          continue;
        }
        at = parseTree(at);
        at = skipWhitespace(src, at);
        if (src[at] === ",") {
          at += 1;
        }
      }
      return at;
    }

    // path::segments possibly ending in {group} or as Alias or *
    let lastSeg = "";
    while (at < src.length) {
      at = skipWhitespace(src, at);
      if (src[at] === "*") {
        hasWildcard = true;
        at += 1;
        break;
      }
      if (src[at] === "{") {
        at = parseTree(at);
        break;
      }
      const seg = readIdentifier(src, at);
      if (!seg) {
        break;
      }
      lastSeg = seg.name;
      at = seg.next;
      at = skipWhitespace(src, at);
      if (src[at] === ":" && src[at + 1] === ":") {
        at += 2;
        continue;
      }
      // `as Alias`
      const asKw = readIdentifier(src, at);
      if (asKw?.name === "as") {
        at = skipWhitespace(src, asKw.next);
        const alias = readIdentifier(src, at);
        if (alias) {
          boundNames.push(alias.name);
          at = alias.next;
        }
        break;
      }
      // leaf name
      if (lastSeg) {
        boundNames.push(lastSeg);
      }
      break;
    }
    return at;
  }

  j = parseTree(j);
  j = skipWhitespace(src, j);
  if (src[j] === ";") {
    j += 1;
  }
  return { boundNames, hasWildcard, end: j };
}

/**
 * Skip function signature prefixes: async / const / unsafe / extern "C" before fn.
 * Returns index at `fn` keyword or -1.
 */
function findFnKeyword(src: string, i: number): number {
  let j = skipWhitespace(src, i);
  for (;;) {
    const w = peekWord(src, j);
    if (!w) {
      return -1;
    }
    if (w === "fn") {
      return j;
    }
    if (w === "async" || w === "const" || w === "unsafe") {
      j = skipWhitespace(src, j + w.length);
      continue;
    }
    if (w === "extern") {
      j = skipWhitespace(src, j + w.length);
      if (src[j] === '"') {
        // string already stripped to empty quotes possibly
        j += 1;
        while (j < src.length && src[j] !== '"') {
          j += 1;
        }
        if (src[j] === '"') {
          j += 1;
        }
      }
      j = skipWhitespace(src, j);
      continue;
    }
    return -1;
  }
}

function looksUnbalanced(stripped: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (const ch of stripped) {
    if (ch === "{") braces += 1;
    else if (ch === "}") braces -= 1;
    else if (ch === "(") parens += 1;
    else if (ch === ")") parens -= 1;
    else if (ch === "[") brackets += 1;
    else if (ch === "]") brackets -= 1;
  }
  return braces !== 0 || parens !== 0 || brackets !== 0;
}

/**
 * Scan top-level Rust items from noise-stripped source.
 * Bodies are always depth-tracked — never skipped by line.
 */
export function scanTopLevelItems(stripped: string): { items: RustItem[]; flags: ScanFlags } {
  const items: RustItem[] = [];
  const flags: ScanFlags = {
    hasWildcardReExport: false,
    directReExportCount: 0,
    macroGenerated: false,
    hasCfgGatedItem: false,
    hasInclude: false,
    usesTestFramework: false,
    hasMainFn: false,
  };

  let i = 0;
  let braceDepth = 0;
  let pendingMacroExport = false;
  // Stack of open body contexts for local method capture
  const bodyStack: Array<"impl" | "trait" | "other"> = [];

  try {
    while (i < stripped.length) {
      i = skipWhitespace(stripped, i);
      if (i >= stripped.length) {
        break;
      }

      // Attributes at item position
      if (stripped[i] === "#" && (stripped[i + 1] === "[" || (stripped[i + 1] === "!" && stripped[i + 2] === "["))) {
        const attr = readBalancedBrackets(stripped, i);
        const text = attr.text;
        if (/cfg\s*\(\s*feature/.test(text)) {
          flags.hasCfgGatedItem = true;
        }
        if (/cfg\s*\(\s*test/.test(text) || /#\[test\]/.test(text) || /::test\]/.test(text) || /#\[tokio::test\]/.test(text)) {
          flags.usesTestFramework = true;
        }
        if (text.includes("macro_export")) {
          pendingMacroExport = true;
        }
        i = attr.end;
        continue;
      }

      if (stripped[i] === "{") {
        braceDepth += 1;
        i += 1;
        continue;
      }
      if (stripped[i] === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        if (bodyStack.length > 0 && braceDepth < bodyStack.length) {
          // Pop contexts that closed — approximate: pop one per closing at stack edge
          bodyStack.pop();
        }
        i += 1;
        continue;
      }

      // Inside a body: only harvest fn names from impl/trait as locals
      if (braceDepth > 0) {
        const ctx = bodyStack[bodyStack.length - 1] ?? "other";
        if (ctx === "impl" || ctx === "trait") {
          // Optional visibility then fn
          const vis = readVisibility(stripped, i);
          let j = vis.end;
          j = skipWhitespace(stripped, j);
          const fnAt = findFnKeyword(stripped, j);
          if (fnAt === j || (fnAt >= 0 && fnAt === skipWhitespace(stripped, j))) {
            const fnWord = readIdentifier(stripped, fnAt === j ? j : fnAt);
            if (fnWord?.name === "fn") {
              let k = skipWhitespace(stripped, fnWord.next);
              const name = readIdentifier(stripped, k);
              if (name) {
                items.push({ kind: "fn", name: name.name, visibility: "private" });
                k = skipGenerics(stripped, name.next);
                i = skipItemTail(stripped, k);
                continue;
              }
            }
          }
        }
        i += 1;
        continue;
      }

      // Top-level
      const vis = readVisibility(stripped, i);
      let j = skipWhitespace(stripped, vis.end);
      const word = peekWord(stripped, j);
      if (!word) {
        // Macro invocation: ident! ( [ {
        const id = readIdentifier(stripped, j);
        if (id) {
          let k = skipWhitespace(stripped, id.next);
          if (stripped[k] === "!") {
            k += 1;
            k = skipWhitespace(stripped, k);
            if (id.name === "include") {
              flags.hasInclude = true;
            } else {
              flags.macroGenerated = true;
            }
            if (stripped[k] === "(") {
              i = skipBalanced(stripped, k, "(", ")");
              continue;
            }
            if (stripped[k] === "[") {
              i = skipBalanced(stripped, k, "[", "]");
              continue;
            }
            if (stripped[k] === "{") {
              i = skipBalanced(stripped, k, "{", "}");
              continue;
            }
          }
        }
        i = j + 1;
        continue;
      }

      if (word === "use") {
        const tree = readUseTree(stripped, j);
        if (vis.kind === "pub") {
          if (tree.hasWildcard) {
            flags.hasWildcardReExport = true;
          }
          for (const name of tree.boundNames) {
            items.push({ kind: "use", name, visibility: "pub" });
          }
          flags.directReExportCount += 1;
        }
        i = tree.end;
        continue;
      }

      // fn with optional qualifiers: async / const / unsafe / extern "ABI"
      if (word === "fn" || word === "async" || word === "const" || word === "unsafe" || word === "extern") {
        const fnAt = findFnKeyword(stripped, j);
        if (fnAt >= 0) {
          const fnWord = readIdentifier(stripped, fnAt)!;
          let k = skipWhitespace(stripped, fnWord.next);
          const name = readIdentifier(stripped, k);
          if (name) {
            items.push({ kind: "fn", name: name.name, visibility: vis.kind });
            if (name.name === "main") {
              flags.hasMainFn = true;
            }
            k = skipGenerics(stripped, name.next);
            i = skipItemTail(stripped, k);
            continue;
          }
        }
        // `const NAME` / `static` fall through if not const fn — handled below
        if (word !== "const") {
          i = j + word.length;
          continue;
        }
      }

      if (word === "struct" || word === "enum" || word === "trait" || word === "union" || word === "type") {
        let k = skipWhitespace(stripped, j + word.length);
        const name = readIdentifier(stripped, k);
        if (name) {
          items.push({ kind: word, name: name.name, visibility: vis.kind });
          k = skipGenerics(stripped, name.next);
          // Trait bodies: enter with depth tracking so method names become locals
          // (not exports). Struct/enum/union/type: consume the whole body so
          // fields/variants are never read as module exports (case 33, 36).
          if (word === "trait") {
            let t = k;
            while (t < stripped.length && stripped[t] !== "{" && stripped[t] !== ";") {
              t += 1;
            }
            if (stripped[t] === "{") {
              bodyStack.push("trait");
              braceDepth += 1;
              i = t + 1;
              continue;
            }
            i = t + (stripped[t] === ";" ? 1 : 0);
            continue;
          }
          i = skipItemTail(stripped, k);
          continue;
        }
      }

      if (word === "const" || word === "static") {
        let k = skipWhitespace(stripped, j + word.length);
        const maybeMut = peekWord(stripped, k);
        if (maybeMut === "mut") {
          k = skipWhitespace(stripped, k + 3);
        }
        const name = readIdentifier(stripped, k);
        if (name) {
          items.push({ kind: word, name: name.name, visibility: vis.kind });
          i = skipItemTail(stripped, name.next);
          continue;
        }
      }

      if (word === "mod") {
        let k = skipWhitespace(stripped, j + 3);
        const name = readIdentifier(stripped, k);
        if (name) {
          items.push({ kind: "mod", name: name.name, visibility: vis.kind });
          // Consume inline module body so inner items are not top-level exports
          i = skipItemTail(stripped, name.next);
          continue;
        }
      }

      if (word === "macro_rules") {
        let k = skipWhitespace(stripped, j + word.length);
        if (stripped[k] === "!") {
          k += 1;
        }
        k = skipWhitespace(stripped, k);
        const name = readIdentifier(stripped, k);
        if (name) {
          items.push({
            kind: "macro",
            name: name.name,
            visibility: pendingMacroExport ? "pub" : "private",
          });
          pendingMacroExport = false;
          flags.macroGenerated = true;
          i = skipItemTail(stripped, name.next);
          continue;
        }
      }

      if (word === "impl") {
        // Skip generics/impl header until `{`, then track body for local methods
        let k = j + 4;
        while (k < stripped.length && stripped[k] !== "{") {
          k += 1;
        }
        if (stripped[k] === "{") {
          bodyStack.push("impl");
          braceDepth += 1;
          i = k + 1;
          continue;
        }
        i = k;
        continue;
      }

      // Top-level macro invocation: include!("..."), some_macro! { ... }
      let k = skipWhitespace(stripped, j + word.length);
      if (stripped[k] === "!") {
        k += 1;
        k = skipWhitespace(stripped, k);
        if (word === "include") {
          flags.hasInclude = true;
        } else {
          flags.macroGenerated = true;
        }
        if (stripped[k] === "(") {
          i = skipBalanced(stripped, k, "(", ")");
          continue;
        }
        if (stripped[k] === "[") {
          i = skipBalanced(stripped, k, "[", "]");
          continue;
        }
        if (stripped[k] === "{") {
          i = skipBalanced(stripped, k, "{", "}");
          continue;
        }
      }

      i = j + word.length;
    }
  } catch {
    // degrade in adapter via imbalance / empty
  }

  if (looksUnbalanced(stripped)) {
    // signal via a flag extension — adapter checks balance separately
  }

  return { items, flags };
}

export function createRustAdapter(): LanguageAdapter {
  return {
    id: "rust",
    supports(filePath) {
      return path.extname(filePath) === ".rs";
    },
    analyze(_filePath, text) {
      let stripped = text;
      let items: RustItem[] = [];
      let flags: ScanFlags = {
        hasWildcardReExport: false,
        directReExportCount: 0,
        macroGenerated: false,
        hasCfgGatedItem: false,
        hasInclude: false,
        usesTestFramework: false,
        hasMainFn: false,
      };

      try {
        stripped = stripRustNoise(text);
        const scanned = scanTopLevelItems(stripped);
        items = scanned.items;
        flags = scanned.flags;
      } catch {
        items = [];
      }

      const valueExports = new Set<string>();
      const typeExports = new Set<string>();
      const localSymbols = new Set<string>();
      let localExportCount = 0;

      for (const it of items) {
        localSymbols.add(it.name);

        // pub(crate) / pub(super) / pub(in path) are NOT crate-external exports.
        if (it.visibility !== "pub") {
          continue;
        }

        switch (it.kind) {
          case "fn":
          case "const":
          case "static":
          case "macro":
            valueExports.add(it.name);
            localExportCount += 1;
            break;
          case "struct":
          case "enum":
          case "trait":
          case "type":
          case "union":
          case "mod":
            typeExports.add(it.name);
            localExportCount += 1;
            break;
          case "use":
            valueExports.add(it.name);
            break;
          default:
            break;
        }
      }

      const exports = new Set<string>([...valueExports, ...typeExports]);
      const truncated = looksUnbalanced(stripped);
      const confidence: LanguageAnalysis["exportConfidence"] =
        flags.macroGenerated || flags.hasInclude || flags.hasCfgGatedItem || truncated
          ? "heuristic"
          : "exact";

      return {
        adapterId: "rust",
        exports,
        valueExports,
        typeExports,
        localSymbols,
        exportConfidence: confidence,
        hasDefaultExport: false,
        hasWildcardReExport: flags.hasWildcardReExport,
        hasMainEntrypoint: flags.hasMainFn,
        directReExportCount: flags.directReExportCount,
        localExportCount,
        localImplementationCount: items.filter((item) => item.kind !== "use").length,
        usesTestFramework: flags.usesTestFramework,
      };
    },
  };
}
