/**
 * Character scanner that blanks Rust comments and string/char literal bodies
 * while preserving length and every newline.
 *
 * Critical differences from the Go lexer:
 * - Block comments NEST (inner open/close pairs increase depth).
 * - Apostrophe may start a lifetime or a char literal; disambiguate before blanking.
 * - Raw strings use r-hash forms (r#...#, r##...##, etc.).
 *
 * Do not copy-paste stripGoNoise: a non-nesting block-comment loop is a silent bug.
 */

function isIdentStart(ch: string | undefined): boolean {
  return Boolean(ch && /[\p{L}_]/u.test(ch));
}

function isIdentCont(ch: string | undefined): boolean {
  return Boolean(ch && /[\p{L}\p{Nd}_]/u.test(ch));
}

/**
 * Lifetime: `'a`, `'static`, `'_` — after `'` an identifier that is NOT closed
 * by a following `'`. Char literals: `'x'`, `'\''`, `'\n'`, `'\u{1F600}'`.
 */
function looksLikeLifetime(source: string, i: number): boolean {
  // i points at '
  let j = i + 1;
  if (j >= source.length) {
    return false;
  }
  // Empty char or escape is never a lifetime.
  if (source[j] === "\\") {
    return false;
  }
  if (!isIdentStart(source[j])) {
    return false;
  }
  j += 1;
  while (j < source.length && isIdentCont(source[j])) {
    j += 1;
  }
  // Lifetime if next char is not a closing quote (char literal ends with ').
  return source[j] !== "'";
}

/**
 * Replaces comment bodies and string/char literal contents with spaces,
 * preserving every newline so byte offsets and line numbers stay stable.
 */
export function stripRustNoise(source: string): string {
  const out = new Array<string>(source.length);
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    // Line comment: // /// //!
    if (ch === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }

    // Nested block comments: /* ... /* ... */ ... */
    if (ch === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "/" && source[i + 1] === "*") {
          out[i] = " ";
          out[i + 1] = " ";
          depth += 1;
          i += 2;
          continue;
        }
        if (source[i] === "*" && source[i + 1] === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          depth -= 1;
          i += 2;
          continue;
        }
        out[i] = source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    // Raw string: r"..."  r#"..."#  r##"..."##  (also br"..." / cr"..." after b/c prefix handled below)
    if (ch === "r" && (next === '"' || next === "#")) {
      // Only treat as raw string when r is not part of a larger identifier.
      const prev = i > 0 ? source[i - 1] : "";
      if (!isIdentCont(prev) && prev !== "") {
        // fall through if mid-identifier — rare for 'r'
      }
      if (i === 0 || !isIdentCont(source[i - 1])) {
        out[i] = "r";
        i += 1;
        let hashCount = 0;
        while (i < source.length && source[i] === "#") {
          out[i] = "#";
          hashCount += 1;
          i += 1;
        }
        if (i < source.length && source[i] === '"') {
          out[i] = '"';
          i += 1;
          while (i < source.length) {
            if (source[i] === '"') {
              let k = 0;
              while (k < hashCount && source[i + 1 + k] === "#") {
                k += 1;
              }
              if (k === hashCount) {
                out[i] = '"';
                i += 1;
                for (let h = 0; h < hashCount; h += 1) {
                  out[i] = "#";
                  i += 1;
                }
                break;
              }
            }
            out[i] = source[i] === "\n" ? "\n" : " ";
            i += 1;
          }
          continue;
        }
        // Not a raw string after all (e.g. identifier rfoo) — already wrote 'r', continue.
        continue;
      }
    }

    // Byte string / byte raw string: b"..." or br#"..."#
    if (ch === "b" && (next === '"' || (next === "r" && (source[i + 2] === '"' || source[i + 2] === "#")))) {
      if (i === 0 || !isIdentCont(source[i - 1])) {
        if (next === "r") {
          out[i] = "b";
          i += 1;
          // Fall into raw-string handling by not special-casing: rewrite as if at 'r'
          // by processing r... from current i
          continue;
        }
        out[i] = "b";
        i += 1;
        // fall through to " handling at current i
        continue;
      }
    }

    // Normal string
    if (ch === '"') {
      out[i] = '"';
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

    // Lifetime or char literal
    if (ch === "'") {
      if (looksLikeLifetime(source, i)) {
        out[i] = "'";
        i += 1;
        // Copy lifetime identifier verbatim.
        while (i < source.length && isIdentCont(source[i])) {
          out[i] = source[i]!;
          i += 1;
        }
        continue;
      }
      // Char literal
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
          if (i < source.length && source[i] === "u" && source[i + 1] === "{") {
            // \u{...}
            out[i] = " ";
            i += 1;
            out[i] = " ";
            i += 1;
            while (i < source.length && source[i] !== "}") {
              out[i] = source[i] === "\n" ? "\n" : " ";
              i += 1;
            }
            if (i < source.length && source[i] === "}") {
              out[i] = " ";
              i += 1;
            }
            continue;
          }
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
