import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

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
