import { describe, expect, it } from "bun:test";

import { GRAMMAR_INVENTORIES } from "./grammar";
import { NGRACE_ARTIFACT_VERSION } from "./types";
import { renderChangePlan, renderChangeSpec } from "./skeletons";

const CHANGE_ID = "C-SKELETON-PROBE";

function pushSentinel(list: readonly string[], sentinel: string): () => void {
  const mutable = list as unknown as string[];
  const originalLength = mutable.length;
  mutable.push(sentinel);
  return () => {
    mutable.length = originalLength;
  };
}

describe("renderChangeSpec / renderChangePlan live inventory", () => {
  it("exports renderChangeSpec and renderChangePlan", () => {
    expect(typeof renderChangeSpec).toBe("function");
    expect(typeof renderChangePlan).toBe("function");
  });

  it("graceVersion equals the live NGRACE_ARTIFACT_VERSION constant", () => {
    const spec = renderChangeSpec(CHANGE_ID);
    const plan = renderChangePlan(CHANGE_ID);
    expect(spec).toContain(`graceVersion="${NGRACE_ARTIFACT_VERSION}"`);
    expect(plan).toContain(`graceVersion="${NGRACE_ARTIFACT_VERSION}"`);
  });

  it("both emissions share one required-core walk of the live spec inventory", () => {
    const skeleton = renderChangeSpec(CHANGE_ID);
    const teaching = renderChangeSpec(CHANGE_ID, { teaching: true });
    for (const section of GRAMMAR_INVENTORIES.SPEC_REQUIRED_SECTIONS) {
      expect(skeleton).toContain(`<${section}>`);
      expect(teaching).toContain(`<${section}>`);
    }
  });

  it("probe mutation of SPEC_REQUIRED_SECTIONS changes both emissions and restores", () => {
    const sentinel = "SentinelSpecSectionXYZ";
    const restore = pushSentinel(GRAMMAR_INVENTORIES.SPEC_REQUIRED_SECTIONS, sentinel);
    try {
      const skeleton = renderChangeSpec(CHANGE_ID);
      const teaching = renderChangeSpec(CHANGE_ID, { teaching: true });
      expect(skeleton).toContain(`<${sentinel}>`);
      expect(teaching).toContain(`<${sentinel}>`);
    } finally {
      restore();
    }
    const after = renderChangeSpec(CHANGE_ID);
    expect(after).not.toContain(`<${sentinel}>`);
  });

  it("probe mutation of PLAN_REQUIRED_SECTIONS changes both plan emissions and restores", () => {
    const sentinel = "SentinelPlanSectionXYZ";
    const restore = pushSentinel(GRAMMAR_INVENTORIES.PLAN_REQUIRED_SECTIONS, sentinel);
    try {
      const skeleton = renderChangePlan(CHANGE_ID);
      const teaching = renderChangePlan(CHANGE_ID, undefined, { teaching: true });
      expect(skeleton).toContain(`<${sentinel}>`);
      expect(teaching).toContain(`<${sentinel}>`);
    } finally {
      restore();
    }
    const after = renderChangePlan(CHANGE_ID);
    expect(after).not.toContain(`<${sentinel}>`);
  });

  it("probe mutation of TASK_REQUIRED_SECTIONS changes generated T-001 in both plan emissions", () => {
    const sentinel = "SentinelTaskSectionXYZ";
    const restore = pushSentinel(GRAMMAR_INVENTORIES.TASK_REQUIRED_SECTIONS, sentinel);
    try {
      const skeleton = renderChangePlan(CHANGE_ID);
      const teaching = renderChangePlan(CHANGE_ID, undefined, { teaching: true });
      expect(skeleton).toContain(`<${sentinel}>`);
      expect(teaching).toContain(`<${sentinel}>`);
    } finally {
      restore();
    }
    const after = renderChangePlan(CHANGE_ID);
    expect(after).not.toContain(`<${sentinel}>`);
  });

  it("skeleton emission omits teaching sections as live children", () => {
    const spec = renderChangeSpec(CHANGE_ID);
    expect(spec).not.toContain("<Problem>");
    expect(spec).not.toContain("<Assumptions>");
    expect(spec).not.toContain("<DesignReferences>");
    expect(spec).not.toContain("<Clarifications>");
    const plan = renderChangePlan(CHANGE_ID);
    expect(plan).not.toContain("<OutOfPlanScope>");
    expect(plan).toContain("<None />");
  });

  it("teaching emission walks live design-reference tags and interpolates the working form", () => {
    const spec = renderChangeSpec(CHANGE_ID, { teaching: true });
    expect(spec).toContain("<Problem>");
    expect(spec).toContain("<Assumptions>");
    expect(spec).toContain("<DesignReferences>");
    for (const tag of GRAMMAR_INVENTORIES.DESIGN_REFERENCE_CHILD_TAGS) {
      expect(spec).toContain(`<${tag}`);
    }
    expect(spec).toContain(GRAMMAR_INVENTORIES.CLARIFICATION_WORKING_FORM);
    const commentBodies = [...spec.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1] ?? "");
    expect(commentBodies.length).toBeGreaterThan(0);
    for (const body of commentBodies) {
      expect(body.includes("--")).toBe(false);
    }
    const plan = renderChangePlan(CHANGE_ID, spec, { teaching: true });
    expect(plan).toContain("OutOfPlanScope");
    expect(plan).toContain(GRAMMAR_INVENTORIES.CLARIFICATION_WORKING_FORM);
    const planComments = [...plan.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1] ?? "");
    for (const body of planComments) {
      expect(body.includes("--")).toBe(false);
    }
  });
});
