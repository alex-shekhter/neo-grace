/**
 * Character scanner that blanks Go comments and string/rune literal bodies
 * while preserving length and every newline. Structural tokens and identifiers
 * outside literals survive for the declaration scanner.
 *
 * This must remain a character scanner, not a line regex: line-based matching
 * falsely accepts declarations inside strings/comments and mishandles raw strings.
 */

/**
 * Replaces comment bodies and string/rune literal contents with spaces,
 * preserving every newline so byte offsets and line numbers stay stable.
 */
export function stripGoNoise(source: string): string {
  const out = new Array<string>(source.length);
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;

    // Line comment: // ...
    if (ch === "/" && source[i + 1] === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }

    // Block comment: /* ... */ (Go block comments do not nest)
    if (ch === "/" && source[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          break;
        }
        out[i] = source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    // Interpreted string: "..."
    if (ch === '"') {
      out[i] = '"';
      i += 1;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "\n") {
          // Bare newline terminates an invalid interpreted string; do not hang.
          out[i] = "\n";
          i += 1;
          break;
        }
        if (c === "\\") {
          out[i] = " ";
          i += 1;
          if (i < source.length) {
            out[i] = source[i] === "\n" ? "\n" : " ";
            i += 1;
          }
          continue;
        }
        if (c === '"') {
          out[i] = '"';
          i += 1;
          break;
        }
        out[i] = " ";
        i += 1;
      }
      continue;
    }

    // Raw string: `...` — blank body but preserve newlines for line numbering.
    if (ch === "`") {
      out[i] = "`";
      i += 1;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "`") {
          out[i] = "`";
          i += 1;
          break;
        }
        out[i] = c === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    // Rune literal: '...'
    if (ch === "'") {
      out[i] = "'";
      i += 1;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "\n") {
          out[i] = "\n";
          i += 1;
          break;
        }
        if (c === "\\") {
          out[i] = " ";
          i += 1;
          if (i < source.length) {
            out[i] = source[i] === "\n" ? "\n" : " ";
            i += 1;
          }
          continue;
        }
        if (c === "'") {
          out[i] = "'";
          i += 1;
          break;
        }
        out[i] = " ";
        i += 1;
      }
      continue;
    }

    out[i] = ch;
    i += 1;
  }

  return out.join("");
}
