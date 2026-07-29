import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { canonicalizeExistingPath, ProjectPathError, resolveContainedProjectPath } from "./paths";
import {
  ANCHOR_PATTERNS,
  DATA_FLOW_STEP_PROPERTIES,
  INTERFACE_BREAKING_CHANGE_POLICIES,
  MODULE_TYPES,
  type NgraceIssue,
  type NgraceProjectPaths,
} from "./types";
import { childNodes, childText, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

const KNOWN_MODULE_TYPES = new Set<string>(MODULE_TYPES);
const KNOWN_STEP_PROPERTIES = new Set<string>(DATA_FLOW_STEP_PROPERTIES);
const KNOWN_BREAKING_POLICIES = new Set<string>(INTERFACE_BREAKING_CHANGE_POLICIES);

/** One ordered hop on a DF-* data flow. */
export type DataFlowStepRecord = {
  order: number;
  moduleId: string;
  emits?: string;
  contract?: string;
  properties: string[];
};

/** One graph anchor owned by a graph document. */
export type GraphAnchorRecord = {
  id: string;
  kind: "module" | "data-flow" | "interface-contract";
  owner: string;
  file: string;
  text: string;
  links: string[];
  /**
   * Direct <Path> child when authored. Structured so consumers never have to
   * pattern-match the flattened `text`, where a Summary mentioning "Path" is
   * indistinguishable from a real Path element.
   */
  path?: string;
  /** Direct <Type> child for modules (ENTRY_POINT, UI_COMPONENT, …). */
  moduleType?: string;
  /** Declared UI states (ST-*) under <States>, for UI_COMPONENT modules. */
  states?: string[];
  /** Ordered DF-* steps when authored; absent for legacy flat participant sets. */
  steps?: DataFlowStepRecord[];
  /** IC-* Schema path (project-relative). */
  schema?: string;
  /** IC-* Version (semver). */
  version?: string;
  /** IC-* provider module. */
  provider?: string;
  /** IC-* consumer modules. */
  consumers?: string[];
  /** IC-* BreakingChangePolicy. */
  breakingChangePolicy?: string;
};

/** Unified current graph projection independent of physical segmentation. */
export type GraphProjection = {
  documents: Map<string, string>;
  modules: Map<string, GraphAnchorRecord>;
  dataFlows: Map<string, GraphAnchorRecord>;
  interfaceContracts: Map<string, GraphAnchorRecord>;
  issues: NgraceIssue[];
};

/** One aggregate V-M-* verification contract owned by a verification document. */
export type VerificationAnchorRecord = {
  id: string;
  moduleId: string;
  owner: string;
  file: string;
  priority?: string;
  cwd?: string;
  commands: string[];
  scenarios: string[];
  markers: string[];
  traceAssertions: string[];
  accessibilityChecks: string[];
  visualChecks: string[];
  testFiles: string[];
};

/** Unified current verification projection independent of physical segmentation. */
export type VerificationProjection = {
  documents: Map<string, string>;
  entries: Map<string, VerificationAnchorRecord>;
  issues: NgraceIssue[];
};

type OwnerRoute = {
  owner: string;
  authoredPath: string;
  file: string;
  owns: string[];
  valid: boolean;
};

/** Builds and validates the logical graph projection from .ngrace/graph. */
export function buildGraphProjection(paths: NgraceProjectPaths): GraphProjection {
  const projection: GraphProjection = {
    documents: new Map(),
    modules: new Map(),
    dataFlows: new Map(),
    interfaceContracts: new Map(),
    issues: [],
  };

  const routes = readGraphRoutes(paths, projection.issues);
  const expectedAnchors = new Map<string, string>();
  const foundAnchors = new Set<string>();
  reportUnindexedDocuments(paths.graphDir, paths.graphIndex, routes, "graph", projection.issues);

  for (const route of routes) {
    if (projection.documents.has(route.owner)) {
      projection.issues.push(issue("error", "projection.graph.duplicate-document-route", paths.graphIndex, `${route.owner} appears more than once in the graph index.`));
    }
    for (const anchor of route.owns) {
      registerOwnedAnchor(expectedAnchors, anchor, route.owner, paths.graphIndex, "graph", projection.issues);
    }
    if (!route.valid) {
      continue;
    }
    projection.documents.set(route.owner, route.file);

    const artifact = readGraceXmlArtifact(route.file);
    projection.issues.push(...artifact.issues);
    if (!artifact.root) {
      continue;
    }

    const wrappers = artifact.root.children.filter((child) => ANCHOR_PATTERNS.graphDocument.test(child.tag));
    const wrapper = wrappers.find((child) => child.tag === route.owner);
    if (!wrapper) {
      projection.issues.push(
        issue("error", "projection.graph.wrapper-mismatch", route.file, `Graph document must contain matching ${route.owner} wrapper.`),
      );
      continue;
    }

    // Detect nested/grouped sections that hide graph anchors below non-anchor grouping tags
    for (const child of wrapper.children) {
      if (!isTopLevelGraphAnchor(child.tag)) {
        const nestedAnchors = [...walkNodes(child)]
          .filter((n) => n !== child)
          .filter((n) => isTopLevelGraphAnchor(n.tag))
          .map((n) => n.tag);
        if (nestedAnchors.length > 0) {
          projection.issues.push(
            issue("error", "projection.graph.nested-anchors", route.file,
              route.owner + " contains <" + child.tag + "> with nested graph anchors (" + nestedAnchors.join(", ") + "). Graph anchors must be direct children of " + route.owner + ", not nested inside grouping tags."),
          );
        }
      }
    }

    for (const anchor of graphAnchorsInWrapper(wrapper)) {
      foundAnchors.add(anchor.node.tag);
      const expectedOwner = expectedAnchors.get(anchor.node.tag);
      if (!expectedOwner) {
        projection.issues.push(
          issue("error", "projection.graph.unlisted-anchor", route.file, `${anchor.node.tag} is present but missing from graph index.`),
        );
      } else if (expectedOwner !== route.owner) {
        projection.issues.push(
          issue(
            "error",
            "projection.graph.ownership-mismatch",
            route.file,
            `${anchor.node.tag} is owned by ${expectedOwner} in the index but appears under ${route.owner}.`,
          ),
        );
      }

      const map = mapForGraphAnchorKind(projection, anchor.kind);
      if (map.has(anchor.node.tag)) {
        projection.issues.push(issue("error", "projection.graph.duplicate-anchor", route.file, `${anchor.node.tag} appears more than once.`));
        continue;
      }

      const moduleType = anchor.kind === "module" ? childText(anchor.node, "Type")?.trim() : undefined;
      if (moduleType && !KNOWN_MODULE_TYPES.has(moduleType)) {
        projection.issues.push(
          issue(
            "warning",
            "graph.unknown-module-type",
            route.file,
            `${anchor.node.tag} declares Type ${JSON.stringify(moduleType)}; known values are ${MODULE_TYPES.join(", ")}.`,
          ),
        );
      }
      const states = anchor.kind === "module" ? collectModuleStates(anchor.node, route.file, projection.issues) : undefined;
      const steps = anchor.kind === "data-flow"
        ? collectDataFlowSteps(anchor.node, route.file, projection.issues)
        : undefined;
      const contractFields = anchor.kind === "interface-contract"
        ? collectInterfaceContractFields(anchor.node, paths.root, route.file, projection.issues)
        : undefined;
      map.set(anchor.node.tag, {
        id: anchor.node.tag,
        kind: anchor.kind,
        owner: route.owner,
        file: route.file,
        text: aggregateNodeText(anchor.node),
        links: collectGraphLinks(anchor.node),
        ...(childText(anchor.node, "Path")?.trim() ? { path: childText(anchor.node, "Path")!.trim() } : {}),
        ...(moduleType ? { moduleType } : {}),
        ...(states && states.length > 0 ? { states } : {}),
        ...(steps ? { steps } : {}),
        ...(contractFields ?? {}),
      });
    }
  }

  for (const [anchor, owner] of expectedAnchors) {
    if (!foundAnchors.has(anchor)) {
      projection.issues.push(
        issue("error", "projection.graph.missing-anchor", paths.graphIndex, `${anchor} is listed under ${owner} but was not found.`),
      );
    }
  }

  validateDanglingGraphLinks(projection);
  validateInterfaceContractRefs(projection);
  validateDataFlowStepRefs(projection);
  return projection;
}

/** Builds and validates the logical verification projection from .ngrace/verification. */
export function buildVerificationProjection(paths: NgraceProjectPaths, graph: GraphProjection): VerificationProjection {
  const projection: VerificationProjection = {
    documents: new Map(),
    entries: new Map(),
    issues: [],
  };

  const routes = readVerificationRoutes(paths, projection.issues);
  const expectedAnchors = new Map<string, string>();
  const foundAnchors = new Set<string>();
  reportUnindexedDocuments(paths.verificationDir, paths.verificationIndex, routes, "verification", projection.issues);

  for (const route of routes) {
    if (projection.documents.has(route.owner)) {
      projection.issues.push(issue("error", "projection.verification.duplicate-document-route", paths.verificationIndex, `${route.owner} appears more than once in the verification index.`));
    }
    for (const anchor of route.owns) {
      registerOwnedAnchor(expectedAnchors, anchor, route.owner, paths.verificationIndex, "verification", projection.issues);
    }
    if (!route.valid) {
      continue;
    }
    projection.documents.set(route.owner, route.file);

    const artifact = readGraceXmlArtifact(route.file);
    projection.issues.push(...artifact.issues);
    if (!artifact.root) {
      continue;
    }

    const wrappers = artifact.root.children.filter((child) => ANCHOR_PATTERNS.verificationDocument.test(child.tag));
    const wrapper = wrappers.find((child) => child.tag === route.owner);
    if (!wrapper) {
      projection.issues.push(
        issue("error", "projection.verification.wrapper-mismatch", route.file, `Verification document must contain matching ${route.owner} wrapper.`),
      );
      continue;
    }

    // Detect nested/grouped sections that hide verification anchors below non-anchor grouping tags
    for (const child of wrapper.children) {
      if (!ANCHOR_PATTERNS.verification.test(child.tag)) {
        const nestedAnchors = [...walkNodes(child)]
          .filter((n) => n !== child)
          .filter((n) => ANCHOR_PATTERNS.verification.test(n.tag))
          .map((n) => n.tag);
        if (nestedAnchors.length > 0) {
          projection.issues.push(
            issue("error", "projection.verification.nested-anchors", route.file,
              route.owner + " contains <" + child.tag + "> with nested verification anchors (" + nestedAnchors.join(", ") + "). Verification anchors must be direct children of " + route.owner + ", not nested inside grouping tags."),
          );
        }
      }
    }

    for (const node of verificationAnchorsInWrapper(wrapper)) {
      foundAnchors.add(node.tag);
      const expectedOwner = expectedAnchors.get(node.tag);
      if (!expectedOwner) {
        projection.issues.push(
          issue("error", "projection.verification.unlisted-anchor", route.file, `${node.tag} is present but missing from verification index.`),
        );
      } else if (expectedOwner !== route.owner) {
        projection.issues.push(
          issue(
            "error",
            "projection.verification.ownership-mismatch",
            route.file,
            `${node.tag} is owned by ${expectedOwner} in the index but appears under ${route.owner}.`,
          ),
        );
      }

      if (projection.entries.has(node.tag)) {
        projection.issues.push(issue("error", "projection.verification.duplicate-anchor", route.file, `${node.tag} appears more than once.`));
        continue;
      }

      projection.entries.set(node.tag, {
        id: node.tag,
        moduleId: moduleIdForVerification(node.tag),
        owner: route.owner,
        file: route.file,
        priority: collectPriority(node),
        cwd: collectCwd(node, paths.root, route.file, projection.issues),
        commands: collectExactEvidence(node, "Command"),
        scenarios: collectExactEvidence(node, "Scenario"),
        markers: collectExactEvidence(node, "Marker"),
        traceAssertions: collectExactEvidence(node, "TraceAssertion"),
        accessibilityChecks: collectExactEvidence(node, "AccessibilityCheck"),
        visualChecks: collectExactEvidence(node, "VisualCheck"),
        testFiles: collectTestFiles(node, paths.root, route.file, projection.issues),
      });
    }
  }

  for (const [anchor, owner] of expectedAnchors) {
    if (!foundAnchors.has(anchor)) {
      projection.issues.push(
        issue("error", "projection.verification.missing-anchor", paths.verificationIndex, `${anchor} is listed under ${owner} but was not found.`),
      );
    }
  }

  validateModuleVerificationCoverage(graph, projection);
  return projection;
}

function readGraphRoutes(paths: NgraceProjectPaths, issues: NgraceIssue[]): OwnerRoute[] {
  const artifact = readGraceXmlArtifact(paths.graphIndex);
  issues.push(...artifact.issues);
  if (!artifact.root) {
    return [];
  }

  return artifact.root.children
    .flatMap((node) => (node.tag === "GraphDocuments" ? node.children : []))
    .filter((node) => ANCHOR_PATTERNS.graphDocument.test(node.tag))
    .map((node) => routeFromOwnerNode(paths.graceDir, paths.graphDir, paths.graphIndex, node, (anchor) => isGraphAnchor(anchor), issues));
}

function readVerificationRoutes(paths: NgraceProjectPaths, issues: NgraceIssue[]): OwnerRoute[] {
  const artifact = readGraceXmlArtifact(paths.verificationIndex);
  issues.push(...artifact.issues);
  if (!artifact.root) {
    return [];
  }

  return artifact.root.children
    .flatMap((node) => (node.tag === "VerificationDocuments" ? node.children : []))
    .filter((node) => ANCHOR_PATTERNS.verificationDocument.test(node.tag))
    .map((node) => routeFromOwnerNode(paths.graceDir, paths.verificationDir, paths.verificationIndex, node, (anchor) => ANCHOR_PATTERNS.verification.test(anchor), issues));
}

function routeFromOwnerNode(
  graceDir: string,
  allowedDir: string,
  indexFile: string,
  node: GraceXmlNode,
  ownsPredicate: (anchor: string) => boolean,
  issues: NgraceIssue[],
): OwnerRoute {
  const pathNodes = childNodes(node, "Path");
  const rawPath = pathNodes[0]?.text.trim();
  if (!rawPath) {
    issues.push(issue("error", "projection.index.missing-path", indexFile, `${node.tag} route is missing a Path.`));
  } else if (pathNodes.length !== 1) {
    issues.push(issue("error", "projection.index.duplicate-path", indexFile, `${node.tag} route must contain exactly one Path.`));
  }

  let resolvedPath: string | null = null;
  if (rawPath) {
    try {
      resolvedPath = resolveContainedProjectPath(graceDir, rawPath, {
        allowedRoot: allowedDir,
        mode: "existing",
        extension: ".xml",
      }).absolutePath;
    } catch (error) {
      const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
      issues.push(issue("error", "projection.index.invalid-path", indexFile, `${node.tag} Path ${JSON.stringify(rawPath)} is invalid: ${detail}`));
    }
  }

  const owns = node.children
    .flatMap((child) => (child.tag === "Owns" ? child.children : []))
    .filter((child) => ownsPredicate(child.tag))
    .map((child) => child.tag);

  return {
    owner: node.tag,
    authoredPath: rawPath ?? "",
    file: resolvedPath ?? path.join(graceDir, "__invalid-route__", `${node.tag}.xml`),
    owns,
    valid: resolvedPath !== null,
  };
}

function registerOwnedAnchor(
  expectedAnchors: Map<string, string>,
  anchor: string,
  owner: string,
  indexFile: string,
  kind: "graph" | "verification",
  issues: NgraceIssue[],
): void {
  const previousOwner = expectedAnchors.get(anchor);
  if (previousOwner) {
    issues.push(
      issue(
        "error",
        `projection.${kind}.duplicate-route`,
        indexFile,
        `${anchor} is declared more than once under ${previousOwner === owner ? owner : `${previousOwner} and ${owner}`}.`,
      ),
    );
    return;
  }
  expectedAnchors.set(anchor, owner);
}

function graphAnchorsInWrapper(wrapper: GraceXmlNode): Array<{ node: GraceXmlNode; kind: GraphAnchorRecord["kind"] }> {
  return wrapper.children
    .flatMap((node): Array<{ node: GraceXmlNode; kind: GraphAnchorRecord["kind"] }> => {
      if (ANCHOR_PATTERNS.module.test(node.tag)) {
        return [{ node, kind: "module" as const }];
      }
      if (ANCHOR_PATTERNS.dataFlow.test(node.tag)) {
        return [{ node, kind: "data-flow" as const }];
      }
      if (ANCHOR_PATTERNS.interfaceContract.test(node.tag)) {
        return [{ node, kind: "interface-contract" as const }];
      }
      return [];
    });
}

function mapForGraphAnchorKind(
  projection: GraphProjection,
  kind: GraphAnchorRecord["kind"],
): Map<string, GraphAnchorRecord> {
  if (kind === "module") return projection.modules;
  if (kind === "data-flow") return projection.dataFlows;
  return projection.interfaceContracts;
}

function verificationAnchorsInWrapper(wrapper: GraceXmlNode): GraceXmlNode[] {
  return wrapper.children.filter((node) => ANCHOR_PATTERNS.verification.test(node.tag));
}

function collectGraphLinks(node: GraceXmlNode): string[] {
  return [...new Set(
    [...walkNodes(node)]
      .filter((candidate) => candidate !== node)
      .map((candidate) => candidate.tag)
      .filter((tag) => isGraphAnchor(tag)),
  )].sort();
}

function validateDanglingGraphLinks(projection: GraphProjection) {
  const known = knownGraphAnchorIds(projection);
  for (const record of allGraphRecords(projection)) {
    for (const link of record.links) {
      if (!known.has(link)) {
        projection.issues.push(issue("error", "projection.graph.dangling-link", record.file, `${record.id} links to missing ${link}.`));
      }
    }
  }
}

/**
 * Ordered DF-* form: direct <Step order="n"> children. Legacy flat form is any DF
 * without Step children (bare M-* participants) and is accepted unchanged.
 */
function collectDataFlowSteps(
  flowNode: GraceXmlNode,
  file: string,
  issues: NgraceIssue[],
): DataFlowStepRecord[] | undefined {
  const stepNodes = flowNode.children.filter((child) => child.tag === "Step");
  if (stepNodes.length === 0) {
    return undefined;
  }

  const bareParticipants = flowNode.children.filter(
    (child) => ANCHOR_PATTERNS.module.test(child.tag) || ANCHOR_PATTERNS.dataFlow.test(child.tag),
  );
  if (bareParticipants.length > 0) {
    issues.push(
      issue(
        "error",
        "projection.graph.invalid-data-flow-step",
        file,
        `${flowNode.tag} mixes ordered <Step> children with bare participant anchors; use one form only.`,
      ),
    );
  }

  const steps: DataFlowStepRecord[] = [];
  const seenOrders = new Set<number>();

  for (const stepNode of stepNodes) {
    const orderRaw = stepNode.attributes.order?.trim() ?? "";
    const order = Number(orderRaw);
    if (!orderRaw || !Number.isInteger(order) || order < 1) {
      issues.push(
        issue(
          "error",
          "projection.graph.invalid-data-flow-step",
          file,
          `${flowNode.tag} Step requires a positive integer order attribute (got ${JSON.stringify(orderRaw)}).`,
        ),
      );
      continue;
    }
    if (seenOrders.has(order)) {
      issues.push(
        issue(
          "error",
          "projection.graph.invalid-data-flow-step",
          file,
          `${flowNode.tag} has duplicate Step order ${order}.`,
        ),
      );
      continue;
    }
    seenOrders.add(order);

    const modules = stepNode.children.filter((child) => ANCHOR_PATTERNS.module.test(child.tag));
    if (modules.length !== 1) {
      issues.push(
        issue(
          "error",
          "projection.graph.invalid-data-flow-step",
          file,
          `${flowNode.tag} Step order=${order} must name exactly one M-* module (found ${modules.length}).`,
        ),
      );
      continue;
    }
    const moduleId = modules[0]!.tag;

    let contract: string | undefined;
    for (const contractNode of stepNode.children.filter((child) => child.tag === "Contract")) {
      const contracts = contractNode.children.filter((child) => ANCHOR_PATTERNS.interfaceContract.test(child.tag));
      const textContract = contractNode.text.trim();
      if (contracts.length === 1) {
        contract = contracts[0]!.tag;
      } else if (contracts.length === 0 && ANCHOR_PATTERNS.interfaceContract.test(textContract)) {
        contract = textContract;
      } else {
        issues.push(
          issue(
            "error",
            "projection.graph.invalid-data-flow-step",
            file,
            `${flowNode.tag} Step order=${order} Contract must name exactly one IC-* anchor.`,
          ),
        );
      }
    }

    const properties: string[] = [];
    for (const propNode of stepNode.children.filter((child) => child.tag === "Property")) {
      const value = propNode.text.trim();
      if (!value) {
        issues.push(
          issue(
            "error",
            "projection.graph.invalid-data-flow-step",
            file,
            `${flowNode.tag} Step order=${order} Property must not be empty.`,
          ),
        );
        continue;
      }
      if (!KNOWN_STEP_PROPERTIES.has(value)) {
        issues.push(
          issue(
            "error",
            "projection.graph.invalid-data-flow-step",
            file,
            `${flowNode.tag} Step order=${order} Property ${JSON.stringify(value)} is not in {${DATA_FLOW_STEP_PROPERTIES.join(", ")}}.`,
          ),
        );
        continue;
      }
      properties.push(value);
    }

    const emits = childText(stepNode, "Emits")?.trim() || undefined;
    steps.push({ order, moduleId, ...(emits ? { emits } : {}), ...(contract ? { contract } : {}), properties });
  }

  if (seenOrders.size > 0) {
    const max = Math.max(...seenOrders);
    for (let expected = 1; expected <= max; expected += 1) {
      if (!seenOrders.has(expected)) {
        issues.push(
          issue(
            "error",
            "projection.graph.invalid-data-flow-step",
            file,
            `${flowNode.tag} Step order sequence must be contiguous starting at 1 (missing ${expected}).`,
          ),
        );
      }
    }
  }

  return steps.sort((left, right) => left.order - right.order);
}

function collectInterfaceContractFields(
  node: GraceXmlNode,
  projectRoot: string,
  file: string,
  issues: NgraceIssue[],
): Pick<GraphAnchorRecord, "schema" | "version" | "provider" | "consumers" | "breakingChangePolicy"> {
  const schemaRaw = childText(node, "Schema")?.trim() ?? "";
  let schema: string | undefined;
  if (!schemaRaw) {
    issues.push(
      issue(
        "error",
        "projection.graph.invalid-interface-contract",
        file,
        `${node.tag} requires a non-empty <Schema> path.`,
      ),
    );
  } else {
    try {
      // mode "output": containment without requiring existence, so missing vs escape stay distinct.
      const resolved = resolveContainedProjectPath(projectRoot, schemaRaw, { mode: "output" });
      if (!existsSync(resolved.absolutePath) || !statSync(resolved.absolutePath).isFile()) {
        issues.push(
          issue(
            "error",
            "projection.graph.invalid-interface-contract",
            file,
            `${node.tag} Schema ${JSON.stringify(schemaRaw)} does not exist inside the project.`,
          ),
        );
      } else {
        schema = resolved.relativePath;
      }
    } catch (error) {
      const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
      issues.push(
        issue(
          "error",
          "projection.graph.invalid-interface-contract",
          file,
          `${node.tag} Schema ${JSON.stringify(schemaRaw)} is not a contained project path: ${detail}`,
        ),
      );
    }
  }

  const version = childText(node, "Version")?.trim() ?? "";
  if (!version) {
    issues.push(
      issue("error", "projection.graph.invalid-interface-contract", file, `${node.tag} requires a non-empty <Version>.`),
    );
  } else if (!isSemver(version)) {
    issues.push(
      issue(
        "error",
        "projection.graph.invalid-interface-contract",
        file,
        `${node.tag} Version ${JSON.stringify(version)} is not a valid semver (major.minor.patch).`,
      ),
    );
  }

  const providers = collectAnchorChildren(node, "Provider", ANCHOR_PATTERNS.module, file, issues);
  let provider: string | undefined;
  if (providers.length !== 1) {
    issues.push(
      issue(
        "error",
        "projection.graph.invalid-interface-contract",
        file,
        `${node.tag} requires exactly one Provider M-* (found ${providers.length}).`,
      ),
    );
  } else {
    provider = providers[0];
  }

  const consumers = collectAnchorChildren(node, "Consumer", ANCHOR_PATTERNS.module, file, issues);

  const policy = childText(node, "BreakingChangePolicy")?.trim() ?? "";
  if (!policy) {
    issues.push(
      issue(
        "error",
        "projection.graph.invalid-interface-contract",
        file,
        `${node.tag} requires <BreakingChangePolicy> (${INTERFACE_BREAKING_CHANGE_POLICIES.join("|")}).`,
      ),
    );
  } else if (!KNOWN_BREAKING_POLICIES.has(policy)) {
    issues.push(
      issue(
        "error",
        "projection.graph.invalid-interface-contract",
        file,
        `${node.tag} BreakingChangePolicy ${JSON.stringify(policy)} is not in {${INTERFACE_BREAKING_CHANGE_POLICIES.join(", ")}}.`,
      ),
    );
  }

  return {
    ...(schema ? { schema } : {}),
    ...(version ? { version } : {}),
    ...(provider ? { provider } : {}),
    ...(consumers.length > 0 ? { consumers } : {}),
    ...(policy ? { breakingChangePolicy: policy } : {}),
  };
}

/**
 * Collects anchors under `<Provider>` / `<Consumer>`, accepting both the tag form
 * (`<Consumer><M-X /></Consumer>`) and the text form (`<Consumer>M-X</Consumer>`).
 *
 * A child that is not an anchor is an error, not a silent drop: `<Consumer><Module>M-X</Module></Consumer>`
 * would otherwise record zero consumers while the author believes one is declared, and
 * Consumer is zero-or-more so no count check can catch it.
 */
function collectAnchorChildren(
  node: GraceXmlNode,
  sectionTag: string,
  pattern: RegExp,
  file?: string,
  issues?: NgraceIssue[],
): string[] {
  const result: string[] = [];
  for (const section of node.children.filter((child) => child.tag === sectionTag)) {
    for (const child of section.children) {
      if (pattern.test(child.tag)) {
        result.push(child.tag);
      } else if (file && issues) {
        issues.push(
          issue(
            "error",
            "projection.graph.invalid-interface-contract",
            file,
            `${node.tag} <${sectionTag}> does not allow child <${child.tag}>; name a canonical M-* module.`,
          ),
        );
      }
    }
    const text = section.text.trim();
    if (text && pattern.test(text) && !result.includes(text)) {
      result.push(text);
    }
  }
  return result;
}

function validateInterfaceContractRefs(projection: GraphProjection) {
  for (const record of projection.interfaceContracts.values()) {
    if (record.provider && !projection.modules.has(record.provider)) {
      projection.issues.push(
        issue(
          "error",
          "projection.graph.invalid-interface-contract",
          record.file,
          `${record.id} Provider ${record.provider} does not exist in the graph.`,
        ),
      );
    }
    for (const consumer of record.consumers ?? []) {
      if (!projection.modules.has(consumer)) {
        projection.issues.push(
          issue(
            "error",
            "projection.graph.invalid-interface-contract",
            record.file,
            `${record.id} Consumer ${consumer} does not exist in the graph.`,
          ),
        );
      }
    }
  }
}

function validateDataFlowStepRefs(projection: GraphProjection) {
  for (const record of projection.dataFlows.values()) {
    if (!record.steps) continue;
    for (const step of record.steps) {
      if (!projection.modules.has(step.moduleId)) {
        projection.issues.push(
          issue(
            "error",
            "projection.graph.invalid-data-flow-step",
            record.file,
            `${record.id} Step order=${step.order} names missing module ${step.moduleId}.`,
          ),
        );
      }
      if (step.contract && !projection.interfaceContracts.has(step.contract)) {
        projection.issues.push(
          issue(
            "error",
            "projection.graph.invalid-data-flow-step",
            record.file,
            `${record.id} Step order=${step.order} Contract ${step.contract} does not exist.`,
          ),
        );
      }
    }
  }
}

function isSemver(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/.test(
    value,
  );
}

function knownGraphAnchorIds(projection: GraphProjection): Set<string> {
  return new Set([
    ...projection.modules.keys(),
    ...projection.dataFlows.keys(),
    ...projection.interfaceContracts.keys(),
  ]);
}

function allGraphRecords(projection: GraphProjection): GraphAnchorRecord[] {
  return [
    ...projection.modules.values(),
    ...projection.dataFlows.values(),
    ...projection.interfaceContracts.values(),
  ];
}

function isTopLevelGraphAnchor(tag: string): boolean {
  return isGraphAnchor(tag);
}

function validateModuleVerificationCoverage(graph: GraphProjection, verification: VerificationProjection) {
  for (const moduleId of graph.modules.keys()) {
    const expectedVerification = `V-${moduleId}`;
    if (!verification.entries.has(expectedVerification)) {
      verification.issues.push(
        issue("error", "projection.verification.missing-module-coverage", "verification", `${moduleId} requires ${expectedVerification}.`),
      );
    }
  }

  for (const entry of verification.entries.values()) {
    if (!graph.modules.has(entry.moduleId)) {
      verification.issues.push(
        issue("error", "projection.verification.dangling-module", entry.file, `${entry.id} references missing ${entry.moduleId}.`),
      );
    }
  }
}

function collectExactEvidence(
  node: GraceXmlNode,
  tag: "Command" | "Scenario" | "Marker" | "TraceAssertion" | "AccessibilityCheck" | "VisualCheck",
): string[] {
  return [...walkNodes(node)]
    .filter((candidate) => candidate !== node && candidate.tag === tag)
    .map((candidate) => aggregateNodeText(candidate).trim())
    .filter(Boolean);
}

function collectModuleStates(moduleNode: GraceXmlNode, file: string, issues: NgraceIssue[]): string[] {
  const states: string[] = [];
  const seen = new Set<string>();
  for (const section of moduleNode.children.filter((child) => child.tag === "States")) {
    for (const child of section.children) {
      if (!ANCHOR_PATTERNS.uiState.test(child.tag)) {
        if (child.tag !== "None") {
          issues.push(
            issue(
              "error",
              "graph.invalid-module-state",
              file,
              `<States> does not allow child <${child.tag}>; declare canonical ST-* anchors.`,
            ),
          );
        }
        continue;
      }
      if (seen.has(child.tag)) {
        issues.push(issue("error", "graph.duplicate-module-state", file, `${moduleNode.tag} declares duplicate state ${child.tag}.`));
        continue;
      }
      seen.add(child.tag);
      states.push(child.tag);
    }
  }
  return states;
}

/**
 * State evidence matching rule (documented in ngrace-design / explainer):
 * drop the `ST-` prefix, split the remainder on `-` into words, and look for those
 * words appearing consecutively as **whole words** in the evidence text, case-insensitively.
 * The joined compact form is also accepted as a single whole word, so `ST-FOCUS-VISIBLE`
 * is satisfied by both "focus visible" and "focusVisible".
 *
 * Whole words, not substrings: substring matching let "downloading assets" satisfy
 * `ST-LOADING` and "terror scenario" satisfy `ST-ERROR`, reporting coverage that does
 * not exist. A state check that lies about coverage is worse than no state check.
 */
export function stateMatchesEvidence(stateId: string, evidence: string): boolean {
  const body = stateId.replace(/^ST-/, "");
  if (!body) return false;

  const words = evidenceWords(evidence);
  const stateWords = evidenceWords(body);
  if (stateWords.length === 0) return false;

  if (words.includes(stateWords.join(""))) return true;

  for (let start = 0; start + stateWords.length <= words.length; start += 1) {
    if (stateWords.every((word, offset) => words[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/** Lowercases and splits on every non-alphanumeric run, so `focus-visible` and `focusVisible` agree. */
function evidenceWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function aggregateNodeText(node: GraceXmlNode): string {
  return [node.text, ...node.children.map((child) => `${child.tag} ${aggregateNodeText(child)}`)].join(" ").replace(/\s+/g, " ").trim();
}

function moduleIdForVerification(verificationId: string) {
  return verificationId.startsWith("V-") ? verificationId.slice(2) : verificationId;
}

function isGraphAnchor(anchor: string) {
  return (
    ANCHOR_PATTERNS.module.test(anchor)
    || ANCHOR_PATTERNS.dataFlow.test(anchor)
    || ANCHOR_PATTERNS.interfaceContract.test(anchor)
  );
}

function collectPriority(node: GraceXmlNode): string | undefined {
  const priority = childText(node, "Priority")?.trim();
  return priority || undefined;
}

function collectCwd(node: GraceXmlNode, projectRoot: string, file: string, issues: NgraceIssue[]): string | undefined {
  const cwdNodes = childNodes(node, "Cwd");
  if (cwdNodes.length > 1) {
    issues.push(issue("error", "projection.verification.duplicate-cwd", file, `${node.tag} must contain at most one direct Cwd.`));
  }
  const authoredCwd = cwdNodes[0]?.text.trim();
  if (!authoredCwd || authoredCwd === ".") {
    return undefined;
  }
  try {
    const cwd = resolveContainedProjectPath(projectRoot, authoredCwd, { mode: "existing" });
    if (!statSync(cwd.absolutePath).isDirectory()) {
      issues.push(issue("error", "projection.verification.invalid-cwd", file, `${node.tag} Cwd ${JSON.stringify(authoredCwd)} must resolve to a directory.`));
      return undefined;
    }
    return cwd.relativePath;
  } catch (error) {
    const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
    issues.push(issue("error", "projection.verification.invalid-cwd", file, `${node.tag} Cwd ${JSON.stringify(authoredCwd)} is invalid: ${detail}`));
    return undefined;
  }
}

function collectTestFiles(node: GraceXmlNode, projectRoot: string, file: string, issues: NgraceIssue[]): string[] {
  const result: string[] = [];
  for (const tfNode of childNodes(node, "TestFiles")) {
    for (const child of tfNode.children) {
      if (child.tag === "File") {
        const text = aggregateNodeText(child).trim();
        if (!text) {
          continue;
        }
        try {
          result.push(resolveContainedProjectPath(projectRoot, text, { mode: "existing" }).relativePath);
        } catch (error) {
          const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
          issues.push(issue("error", "projection.verification.invalid-test-file", file, `${node.tag} TestFiles/File ${JSON.stringify(text)} is invalid: ${detail}`));
        }
      }
    }
  }
  return result;
}

function reportUnindexedDocuments(
  directory: string,
  indexFile: string,
  routes: OwnerRoute[],
  kind: "graph" | "verification",
  issues: NgraceIssue[],
): void {
  // Route files are resolved via realpath (resolveContainedProjectPath); readdir
  // paths are lexical. On macOS, /var/folders → /private/var/folders, so plain
  // path.resolve identity is insufficient and produces false unindexed-document hits.
  const routedFiles = new Set(routes.filter((route) => route.valid).map((route) => canonicalizeExistingPath(route.file)));
  const canonicalIndex = canonicalizeExistingPath(indexFile);
  for (const file of listXmlFiles(directory)) {
    const canonicalFile = canonicalizeExistingPath(file);
    if (canonicalFile === canonicalIndex || routedFiles.has(canonicalFile)) {
      continue;
    }
    issues.push(issue(
      "error",
      kind === "graph" ? "projection.graph.unindexed-document" : "projection.verification.unindexed-document",
      file,
      `${path.relative(path.dirname(indexFile), file)} exists but is not routed by ${path.basename(indexFile)}.`,
    ));
  }
}

function listXmlFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listXmlFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".xml") ? [entryPath] : [];
  }).sort();
}

function issue(severity: NgraceIssue["severity"], code: string, file: string, message: string): NgraceIssue {
  return { severity, code, file, message };
}
