import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import ts from "typescript";

import { childNodes, childText, cloneXmlNode, COMMENT_WELL_FORMED_PATH_ALLOWLIST, computeElementSpans, parseGraceXmlArtifact, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

describe("neo-grace XML parser adapter", () => {
  it("returns xml.parse diagnostics for malformed XML instead of throwing", () => {
    const result = parseGraceXmlArtifact("broken.xml", `<NgraceRequirements graceVersion="1.0"><Open></NgraceRequirements>`);

    expect(result.root).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("xml.parse");
  });

  it("preserves dynamic semantic tags exactly", () => {
    const result = parseGraceXmlArtifact(
      "graph.xml",
      `<NgraceGraphDocument graceVersion="1.0"><GD-MAIN><M-AUTH-SESSION><Links><DF-AUTH-TOKEN-FLOW /></Links></M-AUTH-SESSION></GD-MAIN></NgraceGraphDocument>`,
    );

    expect(result.issues).toHaveLength(0);
    expect([...walkNodes(result.root!)].map((node) => node.tag)).toEqual([
      "NgraceGraphDocument",
      "GD-MAIN",
      "M-AUTH-SESSION",
      "Links",
      "DF-AUTH-TOKEN-FLOW",
    ]);
  });

  it("treats CDATA as text rather than structural GRACE anchors", () => {
    const result = parseGraceXmlArtifact(
      "plan.xml",
      `<NgraceChangePlan graceVersion="1.0" status="approved"><C-EXAMPLE><Snippet><![CDATA[<M-SHOULD-NOT-WALK />]]></Snippet></C-EXAMPLE></NgraceChangePlan>`,
    );

    expect(result.issues).toHaveLength(0);
    expect(childText(result.root!.children[0]!.children[0]!, "missing")).toBeUndefined();
    expect([...walkNodes(result.root!)].map((node) => node.tag)).toEqual(["NgraceChangePlan", "C-EXAMPLE", "Snippet"]);
    expect(result.root!.children[0]!.children[0]!.text).toBe("<M-SHOULD-NOT-WALK />");
  });

  it("represents root attributes separately from child tags", () => {
    const result = parseGraceXmlArtifact(
      "spec.xml",
      `<NgraceChangeSpec graceVersion="1.0" status="approved"><C-EXAMPLE><Summary>Ship it.</Summary></C-EXAMPLE></NgraceChangeSpec>`,
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root?.tag).toBe("NgraceChangeSpec");
    expect(result.root?.attributes).toEqual({ graceVersion: "1.0", status: "approved" });
    expect(result.root?.children.map((child) => child.tag)).toEqual(["C-EXAMPLE"]);
  });

  it("reads XML artifacts from disk and reports missing files", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace4-xml-"));
    const file = path.join(root, "artifact.xml");
    writeFileSync(file, `<NgraceTechnology graceVersion="1.0"><Runtime>Bun</Runtime></NgraceTechnology>`);

    expect(childText(readGraceXmlArtifact(file).root!, "Runtime")).toBe("Bun");
    expect(readGraceXmlArtifact(path.join(root, "missing.xml")).issues[0]?.code).toBe("xml.missing-file");
  });
});

const ADJACENT_HYPHENS = "--";

function xmlComment(body: string): string {
  return `<!--${body}-->`;
}

function planDocument(inner: string): string {
  return `<NgraceChangePlan graceVersion="1.0" status="draft"><C-EXAMPLE>${inner}<Summary>ok</Summary></C-EXAMPLE></NgraceChangePlan>`;
}

function requirementsDocument(inner: string): string {
  return `<NgraceRequirements graceVersion="1.0">${inner}<ProjectName>demo</ProjectName></NgraceRequirements>`;
}

describe("C-ARTIFACT-VALIDITY T-001 comment-body well-formedness", () => {
  it("emits xml.comment-not-well-formed at error on a plan and a non-plan, keeps a root, and does not emit xml.parse", () => {
    const plantedComment = xmlComment(` note ${ADJACENT_HYPHENS} inside `);
    const plan = parseGraceXmlArtifact("plan.xml", planDocument(plantedComment));
    const requirements = parseGraceXmlArtifact("requirements.xml", requirementsDocument(plantedComment));

    for (const result of [plan, requirements]) {
      expect(result.root).not.toBeNull();
      expect(result.issues.map((issue) => issue.code)).not.toContain("xml.parse");
      const commentIssue = result.issues.find((issue) => issue.code === "xml.comment-not-well-formed");
      expect(commentIssue).toBeDefined();
      expect(commentIssue?.severity).toBe("error");
    }
  });

  it("does not emit xml.comment-not-well-formed when comments omit the sequence", () => {
    const result = parseGraceXmlArtifact("plan.xml", planDocument(xmlComment(" a legal comment with one - hyphen ")));
    expect(result.root).not.toBeNull();
    expect(result.issues.map((issue) => issue.code)).not.toContain("xml.comment-not-well-formed");
  });

  it("does not emit xml.comment-not-well-formed for two adjacent hyphen characters in element text", () => {
    const result = parseGraceXmlArtifact(
      "requirements.xml",
      requirementsDocument(`<Note>legal ${ADJACENT_HYPHENS} in text</Note>`),
    );
    expect(result.root).not.toBeNull();
    expect(result.issues.map((issue) => issue.code)).not.toContain("xml.comment-not-well-formed");
  });

  it("does not emit xml.comment-not-well-formed for CDATA that merely resembles a comment", () => {
    const result = parseGraceXmlArtifact(
      "plan.xml",
      planDocument(`<Snippet><![CDATA[${xmlComment(` ${ADJACENT_HYPHENS} `)}]]></Snippet>`),
    );
    expect(result.root).not.toBeNull();
    expect(result.issues.map((issue) => issue.code)).not.toContain("xml.comment-not-well-formed");
  });
});

const SPEC_COMMENT_WELL_FORMED_PATH_ALLOWLIST = [
  ".ngrace/changes/archive/C-CALIBRATION-COMMAND-EVIDENCE/plan.xml",
  ".ngrace/changes/archive/C-DECLARED-WRITES/plan.xml",
  ".ngrace/changes/archive/C-ESCALATION-HONESTY/plan.xml",
  ".ngrace/changes/archive/C-EXECUTION-CONTRACT/plan.xml",
  ".ngrace/changes/archive/C-FLAG-HONESTY/plan.xml",
  ".ngrace/changes/archive/C-GRAMMAR-SEAM/plan.xml",
  ".ngrace/changes/archive/C-LEGIBLE-FAILURE/plan.xml",
  ".ngrace/changes/archive/C-RECOVER-FOLDABLE/plan.xml",
  ".ngrace/changes/archive/C-REPORT-HONESTY/plan.xml",
] as const;

describe("C-ARTIFACT-VALIDITY T-001 closed path allowlist", () => {
  const planted = planDocument(xmlComment(` note ${ADJACENT_HYPHENS} inside `));
  const listedRelative = SPEC_COMMENT_WELL_FORMED_PATH_ALLOWLIST[5];
  const unlistedRelative = ".ngrace/changes/archive/C-NOT-ALLOWLISTED/plan.xml";

  it("exports COMMENT_WELL_FORMED_PATH_ALLOWLIST equal to the spec list", () => {
    expect([...COMMENT_WELL_FORMED_PATH_ALLOWLIST]).toEqual([...SPEC_COMMENT_WELL_FORMED_PATH_ALLOWLIST]);
  });

  it("emits xml.comment-not-well-formed for an unlisted archived path under relative and absolute file strings", () => {
    const relative = parseGraceXmlArtifact(unlistedRelative, planted);
    const absolute = parseGraceXmlArtifact(path.join("/var/tmp/neo-grace", unlistedRelative), planted);

    for (const result of [relative, absolute]) {
      expect(result.root).not.toBeNull();
      const commentIssue = result.issues.find((issue) => issue.code === "xml.comment-not-well-formed");
      expect(commentIssue).toBeDefined();
      expect(commentIssue?.severity).toBe("error");
    }
  });

  it("admits a listed path under relative, absolute, and backslash file strings", () => {
    const relative = parseGraceXmlArtifact(listedRelative, planted);
    const absolute = parseGraceXmlArtifact(path.join("/var/tmp/neo-grace", listedRelative), planted);
    const backslash = parseGraceXmlArtifact(listedRelative.replaceAll("/", "\\"), planted);

    for (const result of [relative, absolute, backslash]) {
      expect(result.root).not.toBeNull();
      expect(result.issues.map((issue) => issue.code)).not.toContain("xml.comment-not-well-formed");
    }
  });
});

const COMMENT_ERROR_SHAPES = [
  "XML comment",
  "two adjacent hyphen characters",
  "rewrite the comment body",
] as const;

function assertCommentErrorTeaches(message: string): void {
  const indices = COMMENT_ERROR_SHAPES.map((shape) => {
    const idx = message.indexOf(shape);
    expect(idx).toBeGreaterThanOrEqual(0);
    return idx;
  });
  expect(indices[0]).toBeLessThan(indices[1]!);
  expect(indices[1]).toBeLessThan(indices[2]!);
  const before = message.slice(0, indices[0]);
  expect(before.toLowerCase()).not.toContain("failed to parse");
  expect(before.toLowerCase()).not.toContain("unreadable");
  expect(before.toLowerCase()).not.toContain("could not be parsed");
}

describe("C-ARTIFACT-VALIDITY T-001 comment error teaches", () => {
  it("emitted xml.comment-not-well-formed message names comment location, the forbidden sequence, and the repair first", () => {
    const result = parseGraceXmlArtifact(
      "plan.xml",
      planDocument(xmlComment(` note ${ADJACENT_HYPHENS} inside `)),
    );
    const commentIssue = result.issues.find((issue) => issue.code === "xml.comment-not-well-formed");
    expect(commentIssue).toBeDefined();
    assertCommentErrorTeaches(commentIssue!.message);
  });
});

describe("cloneXmlNode", () => {
  function sampleTree(): GraceXmlNode {
    return {
      tag: "Parent",
      attributes: { a: "1" },
      children: [
        {
          tag: "Child",
          attributes: { k: "v" },
          children: [{ tag: "Grandchild", attributes: { g: "2" }, children: [], text: "leaf" }],
          text: "hello",
        },
      ],
      text: "parent-text",
    };
  }

  it("returns a recursive structural clone, not a shared tree", () => {
    const input = sampleTree();
    const grandchild = input.children[0]!.children[0]!;
    const cloned = cloneXmlNode(input);

    // identity: returned node is not the input
    expect(cloned).not.toBe(input);
    // children recursively cloned (grandchild identity is the recursive check)
    expect(cloned.children).not.toBe(input.children);
    expect(cloned.children[0]).not.toBe(input.children[0]);
    expect(cloned.children[0]!.children[0]).not.toBe(grandchild);
    // attribute records shallow-copied at every level
    expect(cloned.attributes).not.toBe(input.attributes);
    expect(cloned.children[0]!.attributes).not.toBe(input.children[0]!.attributes);
    expect(cloned.children[0]!.children[0]!.attributes).not.toBe(grandchild.attributes);
    // tag and text preserved
    expect(cloned.tag).toBe("Parent");
    expect(cloned.text).toBe("parent-text");
    expect(cloned.children[0]!.tag).toBe("Child");
    expect(cloned.children[0]!.text).toBe("hello");
    expect(cloned.children[0]!.children[0]!.tag).toBe("Grandchild");
    expect(cloned.children[0]!.children[0]!.text).toBe("leaf");
    expect(cloned.attributes).toEqual({ a: "1" });
    expect(cloned.children[0]!.attributes).toEqual({ k: "v" });
    expect(cloned.children[0]!.children[0]!.attributes).toEqual({ g: "2" });

    cloned.attributes.a = "mutated";
    cloned.children[0]!.attributes.k = "mutated";
    cloned.children[0]!.text = "mutated-text";
    cloned.children[0]!.children[0]!.text = "mutated-leaf";
    cloned.children.push({ tag: "New", attributes: {}, children: [], text: "" });
    expect(input.attributes.a).toBe("1");
    expect(input.children[0]!.attributes.k).toBe("v");
    expect(input.children[0]!.text).toBe("hello");
    expect(grandchild.text).toBe("leaf");
    expect(input.children).toHaveLength(1);
  });
});

/**
 * Body-shaped single-definition scan (C-SUBSTANCE-OVER-NAME T-001).
 * Binders are holes: the function's own name is never part of the match.
 * Collection does not filter by identifier; a copy named anything is a hit.
 */
type StructuralCloneHit = {
  file: string;
  binder: string;
  exported: boolean;
};

function unwrapExpr(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function isIdent(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function isParamProp(node: ts.Expression, param: string, prop: string): boolean {
  const expr = unwrapExpr(node);
  return ts.isPropertyAccessExpression(expr) && isIdent(expr.expression, param) && expr.name.text === prop;
}

function isSpreadOfParamAttributes(node: ts.Expression, param: string): boolean {
  const expr = unwrapExpr(node);
  if (!ts.isObjectLiteralExpression(expr) || expr.properties.length !== 1) return false;
  const only = expr.properties[0];
  return only !== undefined && ts.isSpreadAssignment(only) && isParamProp(only.expression, param, "attributes");
}

function isSelfCall(node: ts.Expression, self: string, argName: string): boolean {
  const expr = unwrapExpr(node);
  return (
    ts.isCallExpression(expr) &&
    expr.arguments.length === 1 &&
    isIdent(expr.expression, self) &&
    isIdent(expr.arguments[0]!, argName)
  );
}

function isChildrenMapOfSelf(node: ts.Expression, param: string, self: string): boolean {
  const expr = unwrapExpr(node);
  if (!ts.isCallExpression(expr) || expr.arguments.length !== 1) return false;
  const callee = unwrapExpr(expr.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "map") return false;
  if (!isParamProp(callee.expression, param, "children")) return false;
  const arg = unwrapExpr(expr.arguments[0]!);
  if (isIdent(arg, self)) return true;
  if (!ts.isArrowFunction(arg) || arg.parameters.length !== 1) return false;
  const paramName = arg.parameters[0]!.name;
  if (!ts.isIdentifier(paramName)) return false;
  if (ts.isBlock(arg.body)) {
    if (arg.body.statements.length !== 1) return false;
    const stmt = arg.body.statements[0]!;
    return ts.isReturnStatement(stmt) && stmt.expression !== undefined && isSelfCall(stmt.expression, self, paramName.text);
  }
  return isSelfCall(arg.body, self, paramName.text);
}

function objectLiteralFromBody(body: ts.ConciseBody | undefined): ts.ObjectLiteralExpression | undefined {
  if (!body) return undefined;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1) return undefined;
    const stmt = body.statements[0]!;
    if (!ts.isReturnStatement(stmt) || !stmt.expression) return undefined;
    const returned = unwrapExpr(stmt.expression);
    return ts.isObjectLiteralExpression(returned) ? returned : undefined;
  }
  const expr = unwrapExpr(body);
  return ts.isObjectLiteralExpression(expr) ? expr : undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function matchesCloneShape(obj: ts.ObjectLiteralExpression, param: string, self: string): boolean {
  if (obj.properties.length !== 4) return false;
  const seen = new Set<string>();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) return false;
    const key = propertyNameText(prop.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    switch (key) {
      case "tag":
        if (!isParamProp(prop.initializer, param, "tag")) return false;
        break;
      case "attributes":
        if (!isSpreadOfParamAttributes(prop.initializer, param)) return false;
        break;
      case "children":
        if (!isChildrenMapOfSelf(prop.initializer, param, self)) return false;
        break;
      case "text":
        if (!isParamProp(prop.initializer, param, "text")) return false;
        break;
      default:
        return false;
    }
  }
  return seen.has("tag") && seen.has("attributes") && seen.has("children") && seen.has("text");
}

function soleParamName(params: readonly ts.ParameterDeclaration[]): string | undefined {
  if (params.length !== 1) return undefined;
  const name = params[0]!.name;
  return ts.isIdentifier(name) ? name.text : undefined;
}

function functionLikeMatches(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
  self: string,
): boolean {
  const param = soleParamName(node.parameters);
  if (!param) return false;
  const obj = objectLiteralFromBody(node.body);
  return obj !== undefined && matchesCloneShape(obj, param, self);
}

function hasExportKeyword(node: ts.Node): boolean {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  ) ?? false;
}

function collectFromText(file: string, text: string): StructuralCloneHit[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: StructuralCloneHit[] = [];

  function consider(
    node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
    binder: string | undefined,
    exported: boolean,
  ) {
    if (!binder) return;
    if (functionLikeMatches(node, binder)) {
      hits.push({ file, binder, exported });
    }
  }

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node)) {
      consider(node, node.name?.text, hasExportKeyword(node));
    } else if (ts.isMethodDeclaration(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      consider(node, name, false);
    } else if (ts.isVariableStatement(node)) {
      const exported = hasExportKeyword(node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = unwrapExpr(decl.initializer);
        if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) {
          consider(init, decl.name.text, exported);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hits;
}

function listSrcTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSrcTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function collectFromSrc(): StructuralCloneHit[] {
  const srcRoot = path.resolve(import.meta.dir, "..");
  const hits: StructuralCloneHit[] = [];
  for (const file of listSrcTsFiles(srcRoot)) {
    hits.push(...collectFromText(file, readFileSync(file, "utf8")));
  }
  return hits;
}

describe("structural-clone single definition (body-shaped)", () => {
  it("collectFromText is identifier-insensitive: cloneXmlNode and duplicateNode are both hits", () => {
    const text = `
      function cloneXmlNode(node) {
        return {
          tag: node.tag,
          attributes: { ...node.attributes },
          children: node.children.map(cloneXmlNode),
          text: node.text,
        };
      }
      const duplicateNode = (node) => ({
        tag: node.tag,
        attributes: { ...node.attributes },
        children: node.children.map(duplicateNode),
        text: node.text,
      });
    `;
    const hits = collectFromText("synthetic.ts", text);
    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.binder).sort()).toEqual(["cloneXmlNode", "duplicateNode"]);
  });

  it("src/ contains exactly one structural-clone definition, the export in xml.ts", () => {
    const hits = collectFromSrc();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.file.replaceAll("\\", "/")).toMatch(/src\/artifact\/xml\.ts$/);
    expect(hits[0]!.exported).toBe(true);
    expect(hits[0]!.binder).toBe("cloneXmlNode");
  });
});

// ---------------------------------------------------------------------------
// C-RECORD-PARSE T-002: the parser-derived source-span capability.
// ---------------------------------------------------------------------------

function spanOf(
  spans: ReturnType<typeof computeElementSpans>,
  node: GraceXmlNode | undefined,
): { openStart: number; openEnd: number; closeStart: number | null; closeEnd: number | null } {
  if (!node) {
    throw new Error("test bug: expected node is missing from the parsed tree");
  }
  const span = spans.get(node);
  if (!span) {
    throw new Error("test bug: computeElementSpans returned no span for a parsed element");
  }
  return span;
}

describe("computeElementSpans", () => {
  it("returns hand-computed open and close byte ranges on a synthetic document", () => {
    const text = `<Root a="b"><Kid>text</Kid><!-- note --><Kid x="1">more</Kid></Root>`;
    const parsed = parseGraceXmlArtifact("synthetic.xml", text);
    expect(parsed.root).not.toBeNull();
    const spans = computeElementSpans(text, parsed);

    const root = spanOf(spans, parsed.root!);
    expect(text.slice(root.openStart, root.openEnd)).toBe(`<Root a="b">`);
    expect(text.slice(root.closeStart!, root.closeEnd!)).toBe(`</Root>`);

    const kids = parsed.root!.children.filter((child) => child.tag === "Kid");
    expect(kids).toHaveLength(2);
    const first = spanOf(spans, kids[0]);
    expect(first.openStart).toBe(text.indexOf("<Kid>"));
    expect(text.slice(first.openStart, first.openEnd)).toBe("<Kid>");
    expect(text.slice(first.closeStart!, first.closeEnd!)).toBe("</Kid>");

    const second = spanOf(spans, kids[1]);
    expect(text.slice(second.openStart, second.openEnd)).toBe("<Kid x=\"1\">");
    expect(second.openStart).toBe(text.indexOf("<Kid x=\"1\">"));
  });

  it("carries open ranges only for self-closing elements", () => {
    const text = `<Root><Entry id="e1" /><Entry id="e2"/><Pair></Pair></Root>`;
    const parsed = parseGraceXmlArtifact("synthetic.xml", text);
    const spans = computeElementSpans(text, parsed);
    const entries = parsed.root!.children.filter((child) => child.tag === "Entry");
    for (const entry of entries) {
      const span = spanOf(spans, entry);
      expect(span.closeStart).toBeNull();
      expect(span.closeEnd).toBeNull();
      expect(text.slice(span.openStart, span.openEnd)).toMatch(/^\u003cEntry id="e\d" ?\/>$/);
    }
    const pair = spanOf(spans, parsed.root!.children.find((c) => c.tag === "Pair"));
    expect(text.slice(pair.openStart, pair.openEnd)).toBe("<Pair>");
    expect(text.slice(pair.closeStart!, pair.closeEnd!)).toBe("</Pair>");
  });

  it("locates parsed attributes inside their element's open-tag bytes", () => {
    const text = `<Root><Finding id="f1" token="F1" status="live"><Body>id="f1" appears here as prose</Body></Finding></Root>`;
    const parsed = parseGraceXmlArtifact("synthetic.xml", text);
    const spans = computeElementSpans(text, parsed);
    const finding = parsed.root!.children[0]!;
    const span = spanOf(spans, finding);
    const openTag = text.slice(span.openStart, span.openEnd);
    for (const name of Object.keys(finding.attributes)) {
      expect(openTag, name).toMatch(new RegExp(`[\\s]${name}[\\s]*=`));
    }
    // the prose occurrence sits outside the open tag: the open tag ends before it
    expect(text.indexOf(`id="f1" appears`)).toBeGreaterThan(span.openEnd);
  });

  it("survives angle brackets inside quoted attribute values (quote-aware open-tag scan)", () => {
    const text = `<Root><Entry note="a /> b" /><Entry ok="1" /></Root>`;
    const parsed = parseGraceXmlArtifact("synthetic.xml", text);
    const spans = computeElementSpans(text, parsed);
    const first = spanOf(spans, parsed.root!.children[0]);
    expect(text.slice(first.openStart, first.openEnd)).toBe("<Entry note=\"a /> b\" />");
    expect(first.closeStart).toBeNull();
  });

  it("raises the loud error when the source scan and the parser disagree on element counts", () => {
    // a comment carries a fake open tag the parser never yields
    const text = `<Root><!-- <Ghost> --><Ghost a="b" /></Root>`;
    const parsed = parseGraceXmlArtifact("synthetic.xml", text);
    expect(parsed.root).not.toBeNull();
    expect(() => computeElementSpans(text, parsed)).toThrow(/pairing disagreement for tag Ghost/);
  });

  it("raises the loud error when a parsed attribute is not inside its open-tag bytes", () => {
    // same tag, same count, different attributes: the parsed tree is verified
    // against the exact source bytes it claims to describe
    const parsed = parseGraceXmlArtifact("synthetic.xml", `<Root><Ghost a="b" /></Root>`);
    const otherText = `<Root><Ghost c="d" /></Root>`;
    expect(() => computeElementSpans(otherText, parsed)).toThrow(
      /parsed attribute "a" is not found inside the element's open-tag bytes/,
    );
  });

  it("raises the loud error when a self-closing open tag carries parser children", () => {
    const parsed = parseGraceXmlArtifact("synthetic.xml", `<Root><Ghost><Inner /></Ghost></Root>`);
    // tag counts agree in both documents; the pairing walk is what refuses
    const flatText = `<Root><Ghost /><Inner /></Root>`;
    expect(() => computeElementSpans(flatText, parsed)).toThrow(
      /the source scan reads a self-closing open tag but the parser has 1 child element/,
    );
  });

  it("raises the loud error when a non-self-closing element has no close tag in the source", () => {
    const parsed = parseGraceXmlArtifact("synthetic.xml", `<Root><Ghost>body</Ghost></Root>`);
    const openOnlyText = `<Root><Ghost>body</Ghos></Root>`;
    expect(() => computeElementSpans(openOnlyText, parsed)).toThrow(
      /no <\/Ghost> close tag after byte/,
    );
  });

  it("pairs every element of the real record files at their committed bytes", () => {
    const recordDir = path.resolve(import.meta.dir, "..", "..", "docs", "plans", "active", "RM-GOVERNED-PATH");
    const cases: Array<[file: string, tag: string]> = [
      ["findings.xml", "Finding"],
      ["findings-retired.xml", "Finding"],
      ["rulings.xml", "Decision"],
      ["rulings-retired.xml", "Decision"],
      ["registry.xml", "Row"],
      ["registry-retired.xml", "Row"],
      ["decisions.xml", "Entry"],
    ];
    const roots = new Map<string, GraceXmlNode>();
    const identitiesByFile = new Map<string, Set<string>>();
    for (const [file, tag] of cases) {
      const text = readFileSync(path.join(recordDir, file), "utf8");
      const parsed = parseGraceXmlArtifact(file, text);
      expect(parsed.root, file).not.toBeNull();
      roots.set(file, parsed.root!);
      const spans = computeElementSpans(text, parsed);
      const nodes = childNodes(parsed.root!, tag);
      const [firstGenreChild] = nodes;
      expect(firstGenreChild, `${file}:${tag} carries at least one element`).toBeDefined();
      const identityAttribute = tag === "Row" ? "name" : "id";
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const node of nodes) {
        const span = spans.get(node);
        expect(span, `${file}:${tag}`).toBeDefined();
        const identity = node.attributes[identityAttribute];
        expect(identity, `${file}:${tag} carries its ${identityAttribute} identity`).toBeDefined();
        if (seen.has(identity)) {
          duplicates.push(identity);
        } else {
          seen.add(identity);
        }
        if (file === "decisions.xml") {
          expect(span!.closeStart, "index Entries are self-closing: open range only").toBeNull();
        }
      }
      identitiesByFile.set(file, seen);
      expect(duplicates, `${file} duplicate ${tag} identities`).toEqual([]);
    }
    // conservation: for each live and retired genre pair the identity sets are
    // disjoint, so every element lives in exactly one layer.
    const genrePairs: Array<[liveFile: string, retiredFile: string]> = [
      ["findings.xml", "findings-retired.xml"],
      ["rulings.xml", "rulings-retired.xml"],
      ["registry.xml", "registry-retired.xml"],
    ];
    for (const [liveFile, retiredFile] of genrePairs) {
      const overlaps = [...identitiesByFile.get(liveFile)!].filter((identity) =>
        identitiesByFile.get(retiredFile)!.has(identity),
      );
      expect(overlaps, `${liveFile} and ${retiredFile} identity sets are disjoint`).toEqual([]);
    }
    // index bookkeeping: the persisted base equals the live Entry count read back
    // through the shipped parser, under the shipped engine's own predicate — every
    // direct Entry child whose layer attribute is anything other than retired.
    const indexRoot = roots.get("decisions.xml")!;
    const liveEntries = childNodes(indexRoot, "Entry").filter(
      (entry) => entry.attributes.layer !== "retired",
    );
    expect(
      Number(indexRoot.attributes.base),
      "decisions.xml base equals its live Entry children",
    ).toBe(liveEntries.length);
  }, 60_000);

  it(
    "regression guard: the pairing test carries no transcribed record element count in any form — keyed on the count forms, refusing what it cannot prove",
    () => {
      const self = readFileSync(
        path.join(import.meta.dir, path.basename(new URL(import.meta.url).pathname)),
        "utf8",
      );
      expect(antiOccupancyFailures(self)).toEqual([]);
    },
  );
});

const PAIRING_TEST_TITLE = "pairs every element of the real record files at their committed bytes";

const GUARD_REFUSAL = "the pairing test's body span could not be located; the guard refuses what it cannot prove";

/**
 * Regression guard against the occupancy pins the pairing test once carried: the
 * relations need no numbers, so any numeric literal inside the pairing test's body,
 * any `expected: number`-shaped occupancy-table field anywhere in the file, and any
 * module-scope binding with a numeric initializer referenced from the body is a
 * restored pin. The scan reads guarded source with the TypeScript parser the file
 * already imports: numeric literals are the parser's numeric-literal nodes, so
 * string and comment prose cannot fire and separator, exponent and hexadecimal
 * forms are seen; the occupancy-table shape is read from interface and type-literal
 * property signatures and from labeled-tuple members, so the same prose inside a
 * string literal is not a hit; module-scope bindings are visited at every declarator
 * of every top-level variable statement — destructured names and non-first
 * declarators included — and each initializer is examined in full as an expression
 * node, so a number behind an internal semicolon or brace is seen. An identifier
 * occurrence in the body — a property name included — counts as a reference, and a
 * locally shadowed name is not distinguished from an outer binding
 * (over-approximate, never under). Shapes the scan cannot prove are reported,
 * never passed.
 */
function antiOccupancyFailures(source: string): string[] {
  const failures: string[] = [];
  const sourceFile = ts.createSourceFile("guarded-source.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const body = pairingCallbackBody(sourceFile);
  if (body === undefined) {
    return [GUARD_REFUSAL];
  }
  for (const literal of numericLiteralsIn(body)) {
    failures.push(`numeric literal ${literal} inside the pairing test's body`);
  }
  for (const shape of occupancyTableShapes(sourceFile)) {
    failures.push(`occupancy-table shape ${shape} in the file`);
  }
  const referenced = identifiersIn(body);
  for (const binding of moduleScopeBindings(sourceFile)) {
    if (!referenced.has(binding.name) || !binding.numericInitializer) continue;
    failures.push(`module-scope binding ${binding.name} referenced from the pairing test's body has a numeric initializer`);
  }
  return failures;
}

function visitSubtree(node: ts.Node, visit: (child: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    visitSubtree(child, visit);
  });
}

/** Locates the pairing test's callback body block; undefined when it cannot be proven. */
function pairingCallbackBody(sourceFile: ts.SourceFile): ts.Block | undefined {
  let found: ts.Block | undefined;
  visitSubtree(sourceFile, (node) => {
    if (found !== undefined || !ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "it") return;
    const title = node.arguments[0];
    if (title === undefined || !ts.isStringLiteral(title) || title.text !== PAIRING_TEST_TITLE) return;
    const callback = node.arguments[1];
    if (callback === undefined || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) return;
    found = callback.body;
  });
  return found;
}

function numericLiteralsIn(body: ts.Block): string[] {
  const literals: string[] = [];
  visitSubtree(body, (node) => {
    if (ts.isNumericLiteral(node)) {
      literals.push(node.text);
    }
  });
  return literals;
}

function identifiersIn(body: ts.Block): Set<string> {
  const names = new Set<string>();
  visitSubtree(body, (node) => {
    if (ts.isIdentifier(node)) {
      names.add(node.text);
    }
  });
  return names;
}

function expectedNumberType(typeNode: ts.TypeNode | undefined): boolean {
  let current = typeNode;
  while (current !== undefined && ts.isParenthesizedTypeNode(current)) {
    current = current.type;
  }
  return current?.kind === ts.SyntaxKind.NumberKeyword;
}

function occupancyTableShapes(sourceFile: ts.SourceFile): string[] {
  const shapes: string[] = [];
  visitSubtree(sourceFile, (node) => {
    if (!ts.isPropertySignature(node) && !ts.isNamedTupleMember(node)) return;
    const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
    if (name !== "expected") return;
    if (expectedNumberType(node.type)) {
      shapes.push("expected: number");
    }
  });
  return shapes;
}

function declaredBindingNames(nameNode: ts.BindingName, into: string[]): void {
  if (ts.isIdentifier(nameNode)) {
    into.push(nameNode.text);
    return;
  }
  for (const element of nameNode.elements) {
    if (ts.isOmittedExpression(element)) continue;
    declaredBindingNames(element.name, into);
  }
}

function moduleScopeBindings(sourceFile: ts.SourceFile): Array<{ name: string; numericInitializer: boolean }> {
  const bindings: Array<{ name: string; numericInitializer: boolean }> = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const numericInitializer = subtreeHasNumericLiteral(declaration.initializer);
      const names: string[] = [];
      declaredBindingNames(declaration.name, names);
      for (const name of names) {
        bindings.push({ name, numericInitializer });
      }
    }
  }
  return bindings;
}

function subtreeHasNumericLiteral(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  let found = false;
  visitSubtree(node, (child) => {
    if (ts.isNumericLiteral(child)) {
      found = true;
    }
  });
  return found;
}

const GUARD_GREEN_FIXTURE = `describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    const nodes = readNodes();
    expect(nodes).toBeDefined();
  });
});`;

const GUARD_INLINE_LITERAL_FIXTURE = `describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    const nodes = readNodes();
    expect(nodes).toHaveLength(3);
  });
});`;

const GUARD_SNEAKY_INITIALIZER_FIXTURE = `const SNEAKY = (() => {
  const setup = "x";
  return 195;
})();
describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    expect(typeof SNEAKY).toBe("number");
  });
});`;

const GUARD_DESTRUCTED_BINDING_FIXTURE = `const { DESTRUCTED_PIN, UNREFERENCED_PIN } = { DESTRUCTED_PIN: 195, UNREFERENCED_PIN: 195 };
describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    expect(DESTRUCTED_PIN).toBeDefined();
  });
});`;

const GUARD_SECOND_DECLARATOR_FIXTURE = `const FIRST_PIN = 195, SECOND_PIN = 195;
describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    expect(SECOND_PIN).toBeDefined();
  });
});`;

const GUARD_TABLE_INTERFACE_FIXTURE = `interface PairingRow {
  file: string;
  expected: number;
}
describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    expect(readNodes()).toBeDefined();
  });
});`;

const GUARD_TABLE_TUPLE_FIXTURE = `type PairingRows = Array<[file: string, expected: number]>;
describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    expect(readNodes()).toBeDefined();
  });
});`;

const GUARD_TABLE_PROSE_FIXTURE = `describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    const note = "the retired table once carried expected: number";
    expect(note).toBeDefined();
  });
});`;

const GUARD_ASYNC_CALLBACK_FIXTURE = `describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", async () => {
    const nodes = readNodes();
    expect(nodes).toBeDefined();
  }, 60_000);
});`;

const GUARD_STRING_PROSE_FIXTURE = `describe("pairing guard fixture", () => {
  it("${PAIRING_TEST_TITLE}", () => {
    // the retired pin read 195 from a table nobody restored
    const text = readFileSync(recordPath, "utf8");
    expect(text).toBeDefined();
  });
});`;

const GUARD_UNLOCATABLE_CALLBACK_FIXTURE = `const PAIRING_TITLE = "${PAIRING_TEST_TITLE}";
describe("pairing guard fixture", () => {
  it(PAIRING_TITLE, () => {
    const nodes = readNodes();
    expect(nodes).toBeDefined();
  });
});`;

describe("anti-occupancy guard discriminating directions", () => {
  it("passes a pairing body with no numeric literals and no numeric module bindings", () => {
    expect(antiOccupancyFailures(GUARD_GREEN_FIXTURE)).toEqual([]);
  });

  it("fails on an inline numeric literal inside the pairing body", () => {
    expect(antiOccupancyFailures(GUARD_INLINE_LITERAL_FIXTURE)).toEqual([
      "numeric literal 3 inside the pairing test's body",
    ]);
  });

  it("fails on a numeric initializer behind an internal semicolon referenced from the body", () => {
    expect(antiOccupancyFailures(GUARD_SNEAKY_INITIALIZER_FIXTURE)).toEqual([
      "module-scope binding SNEAKY referenced from the pairing test's body has a numeric initializer",
    ]);
  });

  it("fails on a destructured numeric binding referenced from the body and skips its unreferenced sibling", () => {
    expect(antiOccupancyFailures(GUARD_DESTRUCTED_BINDING_FIXTURE)).toEqual([
      "module-scope binding DESTRUCTED_PIN referenced from the pairing test's body has a numeric initializer",
    ]);
  });

  it("fails on a non-first-declarator numeric binding referenced from the body and skips the first declarator", () => {
    expect(antiOccupancyFailures(GUARD_SECOND_DECLARATOR_FIXTURE)).toEqual([
      "module-scope binding SECOND_PIN referenced from the pairing test's body has a numeric initializer",
    ]);
  });

  it("flags the occupancy-table shape in interface and labeled-tuple form, and not its prose mention inside a string", () => {
    expect(antiOccupancyFailures(GUARD_TABLE_INTERFACE_FIXTURE)).toEqual([
      "occupancy-table shape expected: number in the file",
    ]);
    expect(antiOccupancyFailures(GUARD_TABLE_TUPLE_FIXTURE)).toEqual([
      "occupancy-table shape expected: number in the file",
    ]);
    expect(antiOccupancyFailures(GUARD_TABLE_PROSE_FIXTURE)).toEqual([]);
  });

  it("passes an async callback and never fires on the timeout argument outside the body", () => {
    expect(antiOccupancyFailures(GUARD_ASYNC_CALLBACK_FIXTURE)).toEqual([]);
  });

  it("never fires on a digit inside a string literal or a comment inside the body", () => {
    expect(antiOccupancyFailures(GUARD_STRING_PROSE_FIXTURE)).toEqual([]);
  });

  it("reports its refusal when the pairing callback cannot be located", () => {
    expect(antiOccupancyFailures(GUARD_UNLOCATABLE_CALLBACK_FIXTURE)).toEqual([GUARD_REFUSAL]);
  });
});