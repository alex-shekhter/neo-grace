import type { GraceXmlNode } from "./xml";

/**
 * Escape text for XML element content.
 *
 * The parser decodes named references (`&amp;` → `&`) but leaves numeric character
 * references (`&#169;`, `&#xA9;`) as literal text. Escaping every `&` therefore turned
 * `&#169;` into `&amp;#169;` and permanently corrupted the author's content on rewrite,
 * so an already-well-formed numeric reference is passed through untouched.
 */
const NUMERIC_CHARACTER_REFERENCE = /^&#(?:[0-9]+|x[0-9a-fA-F]+);/;

function escapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (char === "&") {
      const rest = value.slice(i);
      const match = NUMERIC_CHARACTER_REFERENCE.exec(rest);
      if (match) {
        out += match[0];
        i += match[0].length - 1;
        continue;
      }
      out += "&amp;";
      continue;
    }
    out += char === "<" ? "&lt;" : char === ">" ? "&gt;" : char;
  }
  return out;
}

/** Escape attribute values. */
function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

/**
 * Deterministic XML serializer for GRACE nodes.
 * Used by `ngrace graph split` so moved anchors re-parse identically to the source tree.
 */
export function serializeGraceXmlNode(node: GraceXmlNode): string {
  const attrs = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
  const text = node.text;
  const children = node.children.map((child) => serializeGraceXmlNode(child)).join("");

  if (node.children.length === 0 && !text.trim()) {
    // Prefer empty element form for pure markers (e.g. <M-FOO />).
    if (!text) {
      return `<${node.tag}${attrs} />`;
    }
  }

  if (node.children.length === 0) {
    return `<${node.tag}${attrs}>${escapeText(text)}</${node.tag}>`;
  }

  // Preserve leading text then children (parser may put mixed content in text + children).
  const body = `${text ? escapeText(text) : ""}${children}`;
  return `<${node.tag}${attrs}>${body}</${node.tag}>`;
}

/** Serialize a full document with an XML declaration omitted (GRACE artifacts typically omit it). */
export function serializeGraceXmlDocument(root: GraceXmlNode): string {
  return `${serializeGraceXmlNode(root)}\n`;
}
