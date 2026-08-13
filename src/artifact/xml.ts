// START_MODULE_CONTRACT
//   PURPOSE: GraceXmlNode model, artifact XML parse/read, and node utilities
//   SCOPE: Parse and read .ngrace XML into GraceXmlNode; traverse, clone, and inspect nodes
//   DEPENDS: none
//   LINKS: M-GRAMMAR
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   COMMENT_WELL_FORMED_PATH_ALLOWLIST
//   GraceXmlNode
//   ParsedGraceXmlArtifact
//   childNodes
//   childText
//   cloneXmlNode
//   createGraceXmlParser
//   hasForbiddenAttributes
//   parseGraceXmlArtifact
//   readGraceXmlArtifact
//   walkNodes
// END_MODULE_MAP
import { existsSync, readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { NgraceIssue } from "./types";

const ATTRIBUTE_NODE = ":@";
const ATTRIBUTE_PREFIX = "@_";
const TEXT_NODE = "#text";
const CDATA_NODE = "#cdata";
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const ADJACENT_HYPHENS = "--";

/** Frozen closed path allowlist for xml.comment-not-well-formed (option 3). */
export const COMMENT_WELL_FORMED_PATH_ALLOWLIST = [
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

const COMMENT_NOT_WELL_FORMED_MESSAGE =
  "XML comment is not well-formed: the comment body contains two adjacent hyphen characters; rewrite the comment body so it does not contain that sequence.";

type OrderedXmlEntry = Record<string, unknown>;

/** Parsed XML node preserving the original tag name and child order. */
export type GraceXmlNode = {
  tag: string;
  attributes: Record<string, string>;
  children: GraceXmlNode[];
  text: string;
};

/** Parsed GRACE XML artifact root plus diagnostics. */
export type ParsedGraceXmlArtifact = {
  file: string;
  root: GraceXmlNode | null;
  issues: NgraceIssue[];
};

/** Parser configured for dynamic GRACE tag names and explicit attributes. */
export function createGraceXmlParser(): XMLParser {
  return new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    textNodeName: TEXT_NODE,
    cdataPropName: CDATA_NODE,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });
}

/** Parses one XML artifact string into a normalized root node and parse diagnostics. */
export function parseGraceXmlArtifact(file: string, text: string): ParsedGraceXmlArtifact {
  const validationResult = XMLValidator.validate(text, {
    allowBooleanAttributes: true,
  });

  if (validationResult !== true) {
    const error = validationResult.err;
    return {
      file,
      root: null,
      issues: [
        {
          severity: "error",
          code: "xml.parse",
          file,
          line: error.line,
          message: error.msg,
        },
      ],
    };
  }

  try {
    const parsed = createGraceXmlParser().parse(text);
    const root = normalizeParsedRoot(parsed);

    if (!root) {
      return {
        file,
        root: null,
        issues: [
          {
            severity: "error",
            code: "xml.parse",
            file,
            message: "XML artifact does not contain a root element.",
          },
        ],
      };
    }

    return { file, root, issues: collectCommentWellFormednessIssues(file, text) };
  } catch (error) {
    return {
      file,
      root: null,
      issues: [
        {
          severity: "error",
          code: "xml.parse",
          file,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function normalizeAllowlistPath(file: string): string {
  const slashes = file.replaceAll("\\", "/");
  return slashes.startsWith("./") ? slashes.slice(2) : slashes;
}

function isCommentWellFormedAllowlisted(file: string): boolean {
  const n = normalizeAllowlistPath(file);
  return COMMENT_WELL_FORMED_PATH_ALLOWLIST.some((entry) => {
    const e = normalizeAllowlistPath(entry);
    return n === e || n.endsWith(`/${e}`);
  });
}

function collectCommentWellFormednessIssues(file: string, text: string): NgraceIssue[] {
  if (isCommentWellFormedAllowlisted(file)) {
    return [];
  }

  let index = 0;
  while (index < text.length) {
    const cdataAt = text.indexOf(CDATA_OPEN, index);
    const commentAt = text.indexOf(COMMENT_OPEN, index);
    if (cdataAt === -1 && commentAt === -1) {
      break;
    }
    if (cdataAt !== -1 && (commentAt === -1 || cdataAt < commentAt)) {
      const cdataClose = text.indexOf(CDATA_CLOSE, cdataAt + CDATA_OPEN.length);
      if (cdataClose === -1) {
        break;
      }
      index = cdataClose + CDATA_CLOSE.length;
      continue;
    }

    const bodyStart = commentAt + COMMENT_OPEN.length;
    const commentClose = text.indexOf(COMMENT_CLOSE, bodyStart);
    if (commentClose === -1) {
      break;
    }
    const body = text.slice(bodyStart, commentClose);
    if (body.includes(ADJACENT_HYPHENS)) {
      return [
        {
          severity: "error",
          code: "xml.comment-not-well-formed",
          file,
          message: COMMENT_NOT_WELL_FORMED_MESSAGE,
        },
      ];
    }
    index = commentClose + COMMENT_CLOSE.length;
  }

  return [];
}

/** Reads and parses one XML artifact from disk. Missing files produce a validation issue. */
export function readGraceXmlArtifact(file: string): ParsedGraceXmlArtifact {
  if (!existsSync(file)) {
    return {
      file,
      root: null,
      issues: [
        {
          severity: "error",
          code: "xml.missing-file",
          file,
          message: `XML artifact not found: ${file}`,
        },
      ],
    };
  }

  return parseGraceXmlArtifact(file, readFileSync(file, "utf8"));
}

/** Returns direct children whose tag exactly matches the requested name. */
export function childNodes(node: GraceXmlNode, tag: string): GraceXmlNode[] {
  return node.children.filter((child) => child.tag === tag);
}

/** Returns the first direct child text value for the requested tag. */
export function childText(node: GraceXmlNode, tag: string): string | undefined {
  return childNodes(node, tag)[0]?.text;
}

/** Walks all descendants depth-first, including the starting node. */
export function* walkNodes(node: GraceXmlNode): Iterable<GraceXmlNode> {
  yield node;
  for (const child of node.children) {
    yield* walkNodes(child);
  }
}

/** Deep structural clone: tag, text, shallow-copied attributes, recursive children. */
export function cloneXmlNode(node: GraceXmlNode): GraceXmlNode {
  return {
    tag: node.tag,
    attributes: { ...node.attributes },
    children: node.children.map(cloneXmlNode),
    text: node.text,
  };
}

/** Returns true when the node has any attributes other than the allowed list. */
export function hasForbiddenAttributes(node: GraceXmlNode, allowed: ReadonlySet<string>): boolean {
  return Object.keys(node.attributes).some((attribute) => !allowed.has(attribute));
}

function normalizeParsedRoot(parsed: unknown): GraceXmlNode | null {
  if (!Array.isArray(parsed)) {
    return null;
  }

  for (const entry of parsed) {
    const node = normalizeElementEntry(entry);
    if (node) {
      return node;
    }
  }

  return null;
}

function normalizeElementEntry(entry: unknown): GraceXmlNode | null {
  if (!isXmlEntry(entry)) {
    return null;
  }

  const tag = Object.keys(entry).find((key) => key !== ATTRIBUTE_NODE && key !== TEXT_NODE && key !== CDATA_NODE);
  if (!tag) {
    return null;
  }

  const rawChildren = entry[tag];
  const attributes = normalizeAttributes(entry[ATTRIBUTE_NODE]);
  const children: GraceXmlNode[] = [];
  const textParts: string[] = [];

  if (Array.isArray(rawChildren)) {
    for (const childEntry of rawChildren) {
      if (!isXmlEntry(childEntry)) {
        continue;
      }

      const directText = childEntry[TEXT_NODE];
      if (typeof directText === "string") {
        textParts.push(directText);
      }

      const directCdata = childEntry[CDATA_NODE];
      if (Array.isArray(directCdata)) {
        textParts.push(extractSpecialText(directCdata));
      }

      const child = normalizeElementEntry(childEntry);
      if (child) {
        children.push(child);
      }
    }
  } else if (typeof rawChildren === "string") {
    textParts.push(rawChildren);
  }

  return {
    tag,
    attributes,
    children,
    text: textParts.join(""),
  };
}

function normalizeAttributes(rawAttributes: unknown): Record<string, string> {
  if (!isXmlEntry(rawAttributes)) {
    return {};
  }

  const attributes: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(rawAttributes)) {
    const name = rawName.startsWith(ATTRIBUTE_PREFIX) ? rawName.slice(ATTRIBUTE_PREFIX.length) : rawName;
    attributes[name] = rawValue == null ? "" : String(rawValue);
  }

  return attributes;
}

function extractSpecialText(entries: unknown[]): string {
  return entries
    .map((entry) => {
      if (!isXmlEntry(entry)) {
        return "";
      }
      const text = entry[TEXT_NODE];
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function isXmlEntry(value: unknown): value is OrderedXmlEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
