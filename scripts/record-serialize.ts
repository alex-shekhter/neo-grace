#!/usr/bin/env bun
/**
 * Canonical serializer and declared shape schema for the RM-GOVERNED-PATH
 * record. D40 step (1).
 *
 * The serializer emits one canonical form: two spaces of indent per depth, a
 * close tag at its open tag's indent, canonical attribute order per element
 * type, entity-escaping of `&` `<` `>` `"`, exactly one trailing newline after
 * the root close tag, and one declared empty form per element. Body prose — the
 * bytes of every text node — passes through verbatim; only structural
 * inter-element whitespace and the canonical empty form are rewritten. The
 * schema is the engine's contract, not a snapshot of the corpus.
 *
 * The empty form is declared, not inferred from bytes: an element with no
 * child elements and empty text is emitted self-closing when the schema
 * declares it an optional child or the childless genre element (`Entry`,
 * `Successor`, `PaidBy` on the live layer, `CodifiedIn`, `TaughtIn`), and keeps
 * its open/close pair when the schema declares it a required child. A required
 * leaf's emptiness is data — `<Number></Number>` appears on rows with no
 * number, and the canonical form does not rewrite it to `<Number />`.
 */

import {
  computeElementSpans,
  parseGraceXmlArtifact,
  type GraceXmlNode,
  type XmlElementSpan,
} from "../src/artifact/xml.ts";

export type RecordSchema = {
  root: string;
  rootAttrs: string[];
  child: string;
  childAttrs: string[];
  /** The declared child tag sequence, as a regex over concatenated tag names. */
  childOrder: string;
  required: string[];
  optional: string[];
};

/** Per record-file shape. Retired siblings carry no root attributes. */
export const RECORD_SCHEMA: Record<string, RecordSchema> = {
  "findings.xml": {
    root: "Findings",
    rootAttrs: ["base", "headroom", "ceiling"],
    child: "Finding",
    childAttrs: ["id", "token", "status"],
    childOrder: "^(PaidBy)?TitleBody$",
    required: ["Title", "Body"],
    optional: ["PaidBy"],
  },
  "findings-retired.xml": {
    root: "Findings",
    rootAttrs: [],
    child: "Finding",
    childAttrs: ["id", "token", "status"],
    childOrder: "^(PaidBy)?TitleBody$",
    required: ["PaidBy", "Title", "Body"],
    optional: [],
  },
  "rulings.xml": {
    root: "Rulings",
    rootAttrs: ["base", "headroom", "ceiling"],
    child: "Decision",
    childAttrs: ["id", "token", "status"],
    childOrder: "^TitleBody(CodifiedIn|TaughtIn)*$",
    required: ["Title", "Body"],
    optional: ["CodifiedIn", "TaughtIn"],
  },
  "rulings-retired.xml": {
    root: "Rulings",
    rootAttrs: [],
    child: "Decision",
    childAttrs: ["id", "token", "status"],
    childOrder: "^TitleBody(CodifiedIn|TaughtIn)*$",
    required: ["Title", "Body"],
    optional: ["CodifiedIn", "TaughtIn"],
  },
  "registry.xml": {
    root: "Registry",
    rootAttrs: ["base", "headroom", "ceiling"],
    child: "Row",
    childAttrs: ["name", "status", "kind"],
    childOrder: "^NumberCharterPaysStatusText(Successor)?$",
    required: ["Number", "Charter", "Pays", "StatusText"],
    optional: ["Successor"],
  },
  "registry-retired.xml": {
    root: "Registry",
    rootAttrs: [],
    child: "Row",
    childAttrs: ["name", "status", "kind"],
    childOrder: "^NumberCharterPaysStatusText(Successor)?$",
    required: ["Number", "Charter", "Pays", "StatusText"],
    optional: ["Successor"],
  },
  "decisions.xml": {
    root: "RecordIndex",
    rootAttrs: ["base", "headroom", "ceiling"],
    child: "Entry",
    childAttrs: ["id", "token", "genre", "layer"],
    childOrder: "^$",
    required: [],
    optional: [],
  },
};

/**
 * The canonical attribute order per element type. A tag absent from this table
 * declares no attributes; any attribute on such an element is a schema
 * violation, never silently dropped.
 */
export const RECORD_ATTRIBUTE_ORDER: Record<string, string[]> = {
  Findings: ["base", "headroom", "ceiling"],
  Rulings: ["base", "headroom", "ceiling"],
  Registry: ["base", "headroom", "ceiling"],
  RecordIndex: ["base", "headroom", "ceiling"],
  Finding: ["id", "token", "status"],
  Decision: ["id", "token", "status"],
  Row: ["name", "status", "kind"],
  Entry: ["id", "token", "genre", "layer"],
  CodifiedIn: ["kind"],
  TaughtIn: ["path", "section"],
};

export type SchemaViolation = { code: string; message: string };

function hasSameTagDescendant(node: GraceXmlNode): boolean {
  for (const child of node.children) {
    for (const descendant of walk(child)) {
      if (descendant.tag === node.tag) {
        return true;
      }
    }
  }
  return false;
}

function* walk(node: GraceXmlNode): Generator<GraceXmlNode> {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

function label(node: GraceXmlNode): string {
  return `id="${node.attributes.id ?? node.attributes.name ?? "?"}"`;
}

/**
 * The declared schema check. The expected root, its attribute set (present on
 * live roots, absent on retired siblings), the single genre element as a direct
 * child, no same-tag nesting, the genre element's attribute set, its children
 * in the declared order, no unexpected child, and no undeclared attribute on a
 * nested leaf.
 */
export function recordSchemaViolations(file: string, root: GraceXmlNode | null): SchemaViolation[] {
  const schema = RECORD_SCHEMA[file.split("/").pop() ?? file];
  if (!schema) {
    return [];
  }
  const violations: SchemaViolation[] = [];
  if (!root) {
    return violations;
  }
  if (root.tag !== schema.root) {
    violations.push({
      code: "record-shape-wrong-root",
      message: `${file}: root element is <${root.tag}>; expected <${schema.root}>`,
    });
  }
  for (const attr of Object.keys(root.attributes)) {
    if (!schema.rootAttrs.includes(attr)) {
      violations.push({
        code: "record-schema-unexpected-root-attribute",
        message: `${file}: root <${root.tag}> carries unexpected attribute ${attr}`,
      });
    }
  }
  for (const attr of schema.rootAttrs) {
    if (!(attr in root.attributes)) {
      violations.push({
        code: "record-schema-missing-root-attribute",
        message: `${file}: live root <${root.tag}> is missing ${attr}`,
      });
    }
  }
  const stack: Array<{ node: GraceXmlNode; parent: GraceXmlNode | null }> = [{ node: root, parent: null }];
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (node !== root && node.tag === schema.child) {
      if (parent !== root) {
        violations.push({
          code: "record-shape-genre-not-direct-child",
          message: `${file}: <${node.tag}> appears nested inside <${parent?.tag ?? "?"}>; genre elements must be direct children of the root`,
        });
      }
      if (hasSameTagDescendant(node)) {
        violations.push({
          code: "record-shape-same-tag-nested",
          message: `${file}: <${node.tag}> carries a same-tag descendant; genre elements do not nest`,
        });
      }
      for (const attr of Object.keys(node.attributes)) {
        if (!schema.childAttrs.includes(attr)) {
          violations.push({
            code: "record-schema-unexpected-attribute",
            message: `${file}: <${node.tag}> ${label(node)} carries unexpected attribute ${attr}`,
          });
        }
      }
      for (const attr of schema.childAttrs) {
        if (!(attr in node.attributes)) {
          violations.push({
            code: "record-schema-missing-attribute",
            message: `${file}: <${node.tag}> is missing required attribute ${attr}`,
          });
        }
      }
      const tags = node.children.map((c) => c.tag);
      const unexpected = tags.filter((tag) => !schema.required.includes(tag) && !schema.optional.includes(tag));
      for (const tag of unexpected) {
        violations.push({
          code: "record-schema-unexpected-child",
          message: `${file}: <${node.tag}> ${label(node)} carries unexpected child <${tag}>`,
        });
      }
      for (const tag of schema.required) {
        if (!tags.includes(tag)) {
          violations.push({
            code: "record-schema-missing-child",
            message: `${file}: <${node.tag}> ${label(node)} is missing required child <${tag}>`,
          });
        }
      }
      const allRequiredPresent = schema.required.every((tag) => tags.includes(tag));
      if (unexpected.length === 0 && allRequiredPresent && !new RegExp(schema.childOrder).test(tags.join(""))) {
        violations.push({
          code: "record-schema-child-order",
          message: `${file}: <${node.tag}> ${label(node)} carries children in the order [${tags.join(", ")}]; the declared order is ${schema.childOrder}`,
        });
      }
    }
    for (const attr of Object.keys(node.attributes)) {
      if (node === root || node.tag === schema.child) {
        continue;
      }
      const declared = RECORD_ATTRIBUTE_ORDER[node.tag] ?? [];
      if (!declared.includes(attr)) {
        violations.push({
          code: "record-schema-unexpected-attribute",
          message: `${file}: <${node.tag}> carries unexpected attribute ${attr}`,
        });
      }
    }
    for (const child of node.children) {
      stack.push({ node: child, parent: node });
    }
  }
  return violations;
}

function escapeAttributeValue(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * An element with no children and empty text is emitted self-closing when the
 * schema declares it an optional child or the childless genre element; a
 * required child keeps its open/close pair because its emptiness is data.
 */
function selfClosingWhenEmpty(tag: string, schema: RecordSchema | undefined): boolean {
  if (schema && tag === schema.child) {
    return true;
  }
  if (schema && schema.required.includes(tag)) {
    return false;
  }
  if (schema && schema.optional.includes(tag)) {
    return true;
  }
  return tag === "Entry";
}

/** Re-emits an open tag from its parsed attributes in the declared canonical order. */
function emitOpenTag(node: GraceXmlNode): string {
  const names = Object.keys(node.attributes);
  if (names.length === 0) {
    return `<${node.tag}>`;
  }
  const declared = RECORD_ATTRIBUTE_ORDER[node.tag];
  if (!declared) {
    throw new Error(
      `record engine: <${node.tag}> carries attributes (${names.join(", ")}) but the declared schema declares none for it`,
    );
  }
  for (const name of names) {
    if (!declared.includes(name)) {
      throw new Error(`record engine: <${node.tag}> carries undeclared attribute ${name}; refusing to drop it`);
    }
  }
  const ordered = declared.filter((name) => name in node.attributes);
  return `<${node.tag}${ordered.map((name) => ` ${name}="${escapeAttributeValue(node.attributes[name]!)}"`).join("")}>`;
}

/** Refuses (throws) before any write when the document violates the schema. */
export function assertRecordSchema(file: string, xml: string): void {
  const parsed = parseGraceXmlArtifact(file, xml);
  const violations = recordSchemaViolations(file, parsed.root);
  if (violations.length > 0) {
    throw new Error(
      `record engine: ${file} violates the declared record schema; refusing to write (${violations[0]!.code}: ${violations[0]!.message})`,
    );
  }
}

/**
 * The canonical serializer: read, re-emit every open tag in canonical attribute
 * order, normalise inter-element whitespace at every depth, normalise the
 * canonical empty form, and emit exactly one trailing newline after the root
 * close tag. Text nodes and close tags pass through verbatim.
 */
export function serializeRecordDocument(file: string, xml: string): string {
  const parsed = parseGraceXmlArtifact(file, xml);
  const root = parsed.root;
  if (!root) {
    throw new Error(`record engine: the serializer could not parse ${file}`);
  }
  const schema = RECORD_SCHEMA[file.split("/").pop() ?? file];
  const spans = computeElementSpans(xml, parsed);
  const rootSpan = spans.get(root);
  if (!rootSpan) {
    throw new Error(`record engine: the serializer could not span the root of ${file}`);
  }
  if (rootSpan.closeStart === null || rootSpan.closeEnd === null) {
    throw new Error(`record engine: the root of ${file} is self-closing; the serializer cannot emit a document`);
  }
  const out: string[] = [emitOpenTag(root)];

  const emitChildren = (node: GraceXmlNode, depth: number): void => {
    const nodeSpan = spans.get(node)!;
    const regionStart = nodeSpan.openEnd;
    const regionEnd = nodeSpan.closeStart!;
    const units: Array<
      { start: number; end: number; comment: string } | { start: number; end: number; span: XmlElementSpan; child: GraceXmlNode }
    > = [];
    for (const child of node.children) {
      const span = spans.get(child);
      if (!span) {
        throw new Error(`record engine: the serializer could not span a child of ${file}`);
      }
      units.push({ start: span.openStart, end: span.closeEnd ?? span.openEnd, span, child });
    }
    for (const match of xml.matchAll(/<!--[\s\S]*?-->/g)) {
      const start = match.index;
      const end = start + match[0]!.length;
      if (start < regionStart || end > regionEnd) {
        continue;
      }
      const inside = units.some((unit) => start < unit.end && unit.start < end);
      if (inside) {
        continue;
      }
      units.push({ start, end, comment: match[0]! });
    }
    units.sort((a, b) => a.start - b.start);
    let cursor = regionStart;
    const indent = "  ".repeat(depth);
    for (const unit of units) {
      if (xml.slice(cursor, unit.start).trim() !== "") {
        throw new Error(
          `record engine: the serializer found non-whitespace between units of ${file}; refusing to drop it`,
        );
      }
      out.push(`\n${indent}`);
      if ("comment" in unit) {
        out.push(unit.comment);
      } else {
        emitElement(unit.child, depth, unit.span);
      }
      cursor = unit.end;
    }
    if (xml.slice(cursor, regionEnd).trim() !== "") {
      throw new Error(
        `record engine: the serializer found non-whitespace before the close tag of ${file}; refusing to drop it`,
      );
    }
  };

  const emitElement = (node: GraceXmlNode, depth: number, span: XmlElementSpan): void => {
    const open = emitOpenTag(node);
    if (node.children.length > 0) {
      out.push(open);
      emitChildren(node, depth + 1);
      out.push(`\n${"  ".repeat(depth)}</${node.tag}>`);
      return;
    }
    const textBytes = span.closeStart === null ? "" : xml.slice(span.openEnd, span.closeStart);
    if (textBytes.trim() === "") {
      out.push(selfClosingWhenEmpty(node.tag, schema) ? `${open.slice(0, -1)} />` : `${open}</${node.tag}>`);
      return;
    }
    out.push(open);
    out.push(textBytes);
    out.push(`</${node.tag}>`);
  };

  emitChildren(root, 1);
  out.push(`\n</${root.tag}>`);
  const tail = xml.slice(rootSpan.closeEnd);
  if (tail.trim() !== "") {
    throw new Error(
      `record engine: the serializer found non-whitespace after the root close tag of ${file}; refusing to drop it`,
    );
  }
  out.push("\n");
  return out.join("");
}
