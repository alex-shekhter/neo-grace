import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import ts from "typescript";

import { childText, cloneXmlNode, parseGraceXmlArtifact, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

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
