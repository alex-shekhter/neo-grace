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
    // through the shipped parser.
    const indexRoot = roots.get("decisions.xml")!;
    const liveEntries = childNodes(indexRoot, "Entry").filter(
      (entry) => entry.attributes.layer === "live",
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

const PAIRING_TEST_NEEDLE = `it("pairs every element of the real record files at their committed bytes"`;

const NUMERIC_LITERAL_SHAPE = /\b\d[\d_]*(?:\.\d+)?\b/g;
const OCCUPANCY_TABLE_SHAPE = /\bexpected\s*:\s*number\b/;
const MODULE_BINDING_SHAPE = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;

/**
 * Regression guard against the occupancy pins the pairing test once carried: the
 * relations need no numbers, so any numeric literal inside the pairing test's body,
 * any `expected: number`-shaped occupancy-table field anywhere in the file, and any
 * module-scope numeric constant referenced from the body is a restored pin. Shapes
 * the scan cannot prove are reported, never passed.
 */
function antiOccupancyFailures(source: string): string[] {
  const failures: string[] = [];
  const span = pairingBodySpan(source);
  if (span === undefined) {
    return ["the pairing test's body span could not be located; the guard refuses what it cannot prove"];
  }
  const body = source.slice(span.start, span.end);
  const scan = scanCode(source);
  const blankBody = scan.blanked.slice(span.start, span.end);
  for (const match of blankBody.matchAll(NUMERIC_LITERAL_SHAPE)) {
    failures.push(`numeric literal ${match[0]} inside the pairing test's body`);
  }
  const tableShape = OCCUPANCY_TABLE_SHAPE.exec(scan.blanked);
  if (tableShape) {
    failures.push(`occupancy-table shape ${tableShape[0]} in the file`);
  }
  for (const binding of source.matchAll(MODULE_BINDING_SHAPE)) {
    const name = binding[1]!;
    if (!new RegExp(`\\b${name}\\b`).test(body)) {
      continue;
    }
    const initializer = moduleBindingInitializer(scan.blanked, binding.index! + binding[0].length);
    if (initializer === undefined) {
      failures.push(`module-scope binding ${name} referenced from the pairing test's body has an unresolvable initializer`);
      continue;
    }
    if (/\d/.test(initializer)) {
      failures.push(`module-scope binding ${name} referenced from the pairing test's body has a numeric initializer`);
    }
  }
  return failures;
}

/** Locates the pairing test's callback body span; undefined when it cannot be proven. */
function pairingBodySpan(source: string): { start: number; end: number } | undefined {
  const openShape = /^\s*,\s*\(\)\s*=>\s*\{/;
  let cursor = source.indexOf(PAIRING_TEST_NEEDLE);
  while (cursor !== -1) {
    const argsStart = cursor + PAIRING_TEST_NEEDLE.length;
    const open = openShape.exec(source.slice(argsStart, argsStart + 16));
    if (open) {
      const bodyOpen = argsStart + open[0].length - 1;
      const end = scanCode(source).braceMatch.get(bodyOpen);
      if (end === undefined) {
        return undefined;
      }
      return { start: bodyOpen + 1, end };
    }
    cursor = source.indexOf(PAIRING_TEST_NEEDLE, cursor + 1);
  }
  return undefined;
}

type CodeScan = { blanked: string; braceMatch: Map<number, number> };

/**
 * Single tokenizer over the file's own TypeScript source: comments and string and
 * template contents are blanked, template interpolations are scanned as code so
 * nested templates stay in sync, regex literals are blanked when an unescaped
 * closing slash occurs on their line, and the matching close brace of every
 * code-mode open brace is recorded. Positions are preserved byte for byte; the
 * pairing span's refusal covers anything the walk cannot prove.
 */
function scanCode(text: string): CodeScan {
  const out = text.split("");
  const braceMatch = new Map<number, number>();
  const openBraces: number[] = [];
  type Frame = { kind: "code"; fromInterpolation: boolean; depth: number } | { kind: "template" };
  const stack: Frame[] = [{ kind: "code", fromInterpolation: false, depth: 0 }];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    const next = text[index + 1];
    if (ch === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        out[index] = " ";
        index++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out[index] = " ";
      out[index + 1] = " ";
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        if (text[index] !== "\n") {
          out[index] = " ";
        }
        index++;
      }
      if (index < text.length) {
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
      }
      continue;
    }
    const frame = stack[stack.length - 1]!;
    if (frame.kind === "template") {
      if (ch === "$" && next === "{") {
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
        stack.push({ kind: "code", fromInterpolation: true, depth: 0 });
        continue;
      }
      if (ch === "`") {
        out[index] = " ";
        index++;
        stack.pop();
        continue;
      }
      if (ch !== "\n") {
        out[index] = " ";
      }
      index++;
      continue;
    }
    if (ch === "/") {
      // regex literal when an unescaped closing slash occurs on the same line
      // (character classes may hold slashes); otherwise a plain code character
      let scanIndex = index + 1;
      let inClass = false;
      let closed = false;
      while (scanIndex < text.length && text[scanIndex] !== "\n") {
        const c = text[scanIndex];
        if (c === "\\") {
          scanIndex += 2;
          continue;
        }
        if (c === "[") {
          inClass = true;
        } else if (c === "]") {
          inClass = false;
        } else if (c === "/" && !inClass) {
          closed = true;
          break;
        }
        scanIndex++;
      }
      if (closed) {
        while (index <= scanIndex) {
          if (text[index] !== "\n") {
            out[index] = " ";
          }
          index++;
        }
        continue;
      }
      index++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[index] = " ";
      index++;
      while (index < text.length && text[index] !== quote) {
        if (text[index] === "\\") {
          out[index] = " ";
          if (index + 1 < text.length) {
            out[index + 1] = " ";
          }
          index += 2;
          continue;
        }
        if (text[index] !== "\n") {
          out[index] = " ";
        }
        index++;
      }
      if (index < text.length) {
        out[index] = " ";
        index++;
      }
      continue;
    }
    if (ch === "`") {
      out[index] = " ";
      index++;
      stack.push({ kind: "template" });
      continue;
    }
    if (ch === "{") {
      frame.depth++;
      openBraces.push(index);
      index++;
      continue;
    }
    if (ch === "}") {
      if (frame.depth > 0) {
        frame.depth--;
        const open = openBraces.pop();
        if (open !== undefined) {
          braceMatch.set(open, index);
        }
      } else if (frame.fromInterpolation) {
        stack.pop();
        out[index] = " ";
        index++;
        continue;
      }
      index++;
      continue;
    }
    index++;
  }
  return { blanked: out.join(""), braceMatch };
}

/** Initializer text of a module-scope binding in blanked source, to its terminating semicolon. */
function moduleBindingInitializer(blanked: string, from: number): string | undefined {
  const end = blanked.indexOf(";", from);
  if (end === -1) {
    return undefined;
  }
  return blanked.slice(from, end).trim();
}
