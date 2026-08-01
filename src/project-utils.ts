// START_MODULE_CONTRACT
//   PURPOSE: Governed-file discovery and markup analysis
//   SCOPE: Scanning, contracts, language routing, and graph projections
//   DEPENDS: none
//   LINKS: M-PROJECT-UTILS
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FileBlockRecord
//   FileContractRecord
//   FileFieldSection
//   FileListItem
//   FileMarkupRecord
//   GovernedFileAnalysis
//   GovernedFileAnalysisOptions
//   MarkerEvidenceOptions
//   TextSection
//   analyzeGovernedFile
//   collectCodeFiles
//   collectNearMissMarkerIssues
//   findSection
//   hasGraceMarkers
//   hasRuntimeMarkerEvidence
//   lineNumberAt
//   normalizeRelative
//   parseGovernedFile
//   parseMarkerBlockName
//   readTextIfExists
//   stripCommentPrefix
//   stripQuotedStrings
// END_MODULE_MAP
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ANCHOR_PATTERNS } from "./artifact/types";
import { ADAPTER_BACKED_EXTENSIONS, isGovernedCodeExtension, LANGUAGE_ADAPTERS } from "./language-registry";
import { emissionPatternsFor } from "./lint/emission-patterns";
import { LanguageRuntimeMissingError, type LanguageAnalysis, type LintIssue, type MapMode, type ModuleRole } from "./lint/types";

export type TextSection = {
  content: string;
  startLine: number;
  endLine: number;
};

export type FileFieldSection = {
  fields: Record<string, string>;
  startLine: number;
  endLine: number;
};

export type FileListItem = {
  label: string;
  symbolName?: string;
  line: number;
};

export type FileContractRecord = {
  name: string;
  fields: Record<string, string>;
  startLine: number;
  endLine: number;
};

export type FileBlockRecord = {
  name: string;
  startLine: number;
  endLine: number;
};

export type FileMarkupRecord = {
  path: string;
  moduleContract: FileFieldSection | null;
  moduleMap: FileListItem[];
  changeSummary: FileFieldSection | null;
  contracts: FileContractRecord[];
  blocks: FileBlockRecord[];
  /** M-* and DF-* anchors from LINKS (not V-M-*). */
  linkedModuleIds: string[];
  /** M-* anchors from DEPENDS. */
  dependsModuleIds: string[];
  /** V-M-* anchors from LINKS. */
  linkedVerificationIds: string[];
};

/** Parsed markup plus optional language analysis for one governed file. */
export type GovernedFileAnalysis = {
  record: FileMarkupRecord;
  language: LanguageAnalysis | null;
  issues: LintIssue[];
};

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);


export function normalizeRelative(root: string, filePath: string) {
  return (path.relative(root, filePath) || ".").replaceAll(path.sep, "/");
}

export function lineNumberAt(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

export function readTextIfExists(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

/**
 * Blank string and template-literal contents while preserving newlines and
 * non-string source structure. Handles template interpolations `${...}` so a
 * nested backtick inside `${}` does not terminate the outer template early
 * (corpus-re-03 / A3.3).
 */
/**
 * Blank string and template-literal contents so markers inside quotes are not
 * mistaken for real markup. Comment and string state are tracked in one pass
 * (corr 145): quotes inside line or block comments do not open a span, and
 * comment openers inside a string do not start a comment. Comment text is
 * preserved so real markers and A8 near-misses in comments remain visible.
 *
 * Line comments: double-slash only (not hash or double-dash — those are
 * operators in TS/JS). Block comments: slash-star … star-slash — quotes inside
 * do not open strings; body is kept.
 */
export function stripQuotedStrings(text: string) {
  let result = "";
  let i = 0;

  const blankChar = (char: string) => {
    result += char === "\n" ? "\n" : " ";
  };

  /** Strip one quoted span starting at `i` where text[i] is the opening quote. */
  const stripQuoted = (openQuote: '"' | "'" | "`") => {
    blankChar(text[i]!);
    i += 1;
    let escaped = false;
    while (i < text.length) {
      const char = text[i]!;
      if (escaped) {
        escaped = false;
        blankChar(char);
        i += 1;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        blankChar(char);
        i += 1;
        continue;
      }
      // Template interpolation: blank ${...} without treating nested quotes as
      // the end of the outer template.
      if (openQuote === "`" && char === "$" && text[i + 1] === "{") {
        blankChar("$");
        blankChar("{");
        i += 2;
        let depth = 1;
        while (i < text.length && depth > 0) {
          const c = text[i]!;
          if (c === '"' || c === "'" || c === "`") {
            stripQuoted(c);
            continue;
          }
          if (c === "{") {
            depth += 1;
            blankChar(c);
            i += 1;
            continue;
          }
          if (c === "}") {
            depth -= 1;
            blankChar(c);
            i += 1;
            continue;
          }
          blankChar(c);
          i += 1;
        }
        continue;
      }
      if (char === openQuote) {
        blankChar(char);
        i += 1;
        return;
      }
      blankChar(char);
      i += 1;
    }
  };

  // normal | line_comment | block_comment — strings handled by stripQuoted.
  type OutsideString = "normal" | "line_comment" | "block_comment";
  let outside: OutsideString = "normal";

  while (i < text.length) {
    const char = text[i]!;

    if (outside === "line_comment") {
      result += char;
      if (char === "\n") {
        outside = "normal";
      }
      i += 1;
      continue;
    }

    if (outside === "block_comment") {
      result += char;
      if (char === "*" && text[i + 1] === "/") {
        result += "/";
        i += 2;
        outside = "normal";
        continue;
      }
      i += 1;
      continue;
    }

    // outside === "normal"
    if (char === "/" && text[i + 1] === "/") {
      result += "//";
      i += 2;
      outside = "line_comment";
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      result += "/*";
      i += 2;
      outside = "block_comment";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      stripQuoted(char);
      continue;
    }
    result += char;
    i += 1;
  }

  return result;
}

export function hasGraceMarkers(text: string) {
  const searchable = stripQuotedStrings(text);
  // Negative lookbehind-free: reject near-misses like START_MODULE_CONTRACTX
  // (adversarial probe during Phase 2) while still matching START_BLOCK_* names.
  // Near-misses are still reported as markup.near-miss-marker (A8) without
  // making the file governed.
  return searchable
    .split("\n")
    .some((line) =>
      /^(\s*)(\/\/|#|--|;+|\*)\s*(?:START_MODULE_CONTRACT(?![A-Za-z0-9_])|START_MODULE_MAP(?![A-Za-z0-9_])|START_CONTRACT:|START_BLOCK_[A-Z0-9_]+|START_CHANGE_SUMMARY(?![A-Za-z0-9_]))/
        .test(line),
    );
}

/** Fixed marker names that must match exactly (or with non-identifier trailing text). */
const EXACT_MARKER_PREFIXES = [
  "START_MODULE_CONTRACT",
  "END_MODULE_CONTRACT",
  "START_MODULE_MAP",
  "END_MODULE_MAP",
  "START_CHANGE_SUMMARY",
  "END_CHANGE_SUMMARY",
] as const;

/**
 * Near-miss marker comments (A8): a comment body that is *marker-shaped* — the
 * marker token plus at most one following name token — but not a parseable
 * marker. Multi-token prose that merely mentions a marker name stays quiet
 * (false-positive fix on JSDoc/prose lines).
 *
 * Families: exact-prefix glued suffixes (START_MODULE_CONTRACTX), unparseable
 * START/END_BLOCK_ names, unparseable START/END_CONTRACT shapes. File stays
 * ungoverned; the warning keeps typo'd markers loud without re-governing.
 *
 * START_CONTRACT / END_CONTRACT stay out of EXACT_MARKER_PREFIXES so the
 * legitimate colon form is never an identifier-continuation hit.
 */
export function collectNearMissMarkerIssues(filePath: string, text: string): LintIssue[] {
  const searchable = stripQuotedStrings(text);
  const issues: LintIssue[] = [];
  const lines = searchable.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(/^(\s*)(\/\/|#|--|;+|\*)\s*(\S.*)$/);
    if (!match) {
      continue;
    }
    const body = match[3]!.trim();
    // Marker-shaped only: one token (glued marker) or marker + one name. Prose
    // with more tokens is not a near-miss attempt.
    const tokens = body.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 2) {
      continue;
    }
    const first = tokens[0]!;
    const lineNumber = index + 1;
    let reported = false;

    for (const prefix of EXACT_MARKER_PREFIXES) {
      if (
        first.length > prefix.length
        && first.startsWith(prefix)
        && /^[A-Za-z0-9_]+$/.test(first.slice(prefix.length))
      ) {
        issues.push(markupIssue(
          "warning",
          "markup.near-miss-marker",
          filePath,
          lineNumber,
          `Comment looks like a semantic marker but is not exact: '${first}'. `
            + `Did you mean ${prefix}? This file is not governed by this line.`,
        ));
        reported = true;
        break;
      }
    }

    // Contract-block family (parseMarkerEvent): exact shape is START|END_CONTRACT: <name>.
    // Keep out of EXACT_MARKER_PREFIXES so "// START_CONTRACT: IC-X" is never a prefix hit.
    // Bare "// START_CONTRACT:" is governed by hasGraceMarkers; leave those to markup errors.
    if (!reported && /^(START|END)_CONTRACT/.test(first)) {
      const validContract = /^(START|END)_CONTRACT:\s*[A-Za-z0-9_$.-]+$/.test(body);
      if (!validContract) {
        issues.push(markupIssue(
          "warning",
          "markup.near-miss-marker",
          filePath,
          lineNumber,
          `Contract marker is not parseable: '${body}'. `
            + `Use START_CONTRACT: Name or END_CONTRACT: Name with Name matching [A-Za-z0-9_$.-]+. `
            + `This line does not govern the file.`,
        ));
        reported = true;
      }
    }

    if (!reported) {
      const block = first.match(/^(START|END)_BLOCK_(.*)$/);
      if (block && tokens.length === 1) {
        const blockName = block[2]!;
        // Parser requires [A-Z0-9_]+ (project-utils parseMarkerEvent); lowercase never parses.
        if (blockName.length === 0 || !/^[A-Z0-9_]+$/.test(blockName)) {
          issues.push(markupIssue(
            "warning",
            "markup.near-miss-marker",
            filePath,
            lineNumber,
            `Block marker name is not parseable: '${first}'. `
              + `Use ${block[1]}_BLOCK_NAME with NAME matching [A-Z0-9_]+. This line does not govern the file.`,
          ));
        }
      }
    }
  }
  return issues;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCommentOnlyLine(line: string) {
  return /^\s*(\/\/|#|--|;+|\*)/.test(line);
}

function looksLikeEvidenceEmission(line: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(line));
}

/** Optional path so marker evidence can use language-aware emission patterns. */
export type MarkerEvidenceOptions = {
  filePath?: string;
};

/** Extracts the semantic block name encoded at the end of a required log marker. */
export function parseMarkerBlockName(marker: string) {
  const match = marker.match(/\[([^\]]+)\]\s*$/);
  return match?.[1]?.startsWith("BLOCK_") ? match[1].slice("BLOCK_".length) : undefined;
}

/**
 * Returns true when a required marker is emitted directly or through a same-file
 * identifier assigned to that exact marker. Identifier-aware boundaries keep
 * names such as marker$ distinct from marker$Other.
 *
 * When `options.filePath` is provided, emission detection is language-aware
 * (Rust tracing!/println!, Go slog/zap/zerolog, etc.). Without a path, the
 * union of all patterns is used so unknown-language code is not permanently blocked.
 */
export function hasRuntimeMarkerEvidence(
  text: string,
  marker: string,
  options: MarkerEvidenceOptions = {},
) {
  const patterns = emissionPatternsFor(options.filePath ? path.extname(options.filePath) : undefined);
  const lines = text.split("\n");
  if (lines.some((line) => !isCommentOnlyLine(line) && line.includes(marker) && looksLikeEvidenceEmission(line, patterns))) {
    return true;
  }

  const identifiers = new Set<string>();
  for (const line of lines) {
    if (isCommentOnlyLine(line)) {
      continue;
    }
    for (const quote of ['"', "'", "`"]) {
      const assignmentPattern = new RegExp(
        `([A-Za-z_$][A-Za-z0-9_$]*)\\s*(?::[^=\\n]+)?=\\s*${escapeRegExp(`${quote}${marker}${quote}`)}`,
        "g",
      );
      for (const match of line.matchAll(assignmentPattern)) {
        identifiers.add(match[1]!);
      }
    }
  }

  return [...identifiers].some((identifier) => {
    const identifierUse = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(identifier)}(?![A-Za-z0-9_$])`);
    return lines.some((line) => !isCommentOnlyLine(line) && looksLikeEvidenceEmission(line, patterns) && identifierUse.test(line));
  });
}

export function collectCodeFiles(
  root: string,
  ignoredDirs: string[],
  currentDir = root,
  /** Project-declared extra extensions from `.ngrace-lint.json` `codeExtensions`. */
  projectExtensions?: readonly string[],
): string[] {
  const files: string[] = [];
  const ignoredDirSet = new Set([...DEFAULT_IGNORED_DIRS, ...ignoredDirs]);
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirSet.has(entry.name)) {
        continue;
      }

      files.push(...collectCodeFiles(root, ignoredDirs, path.join(currentDir, entry.name), projectExtensions));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(currentDir, entry.name);
    if (isGovernedCodeExtension(path.extname(filePath), projectExtensions)) {
      files.push(filePath);
    }
  }

  return files;
}

export function stripCommentPrefix(line: string) {
  return line.replace(/^\s*(\/\/|#|--|;+|\*)?\s*/, "");
}

export function findSection(text: string, startMarker: string, endMarker: string) {
  const lines = text.split("\n");
  const startIndex = lines.findIndex((line) => stripCommentPrefix(line).trim() === startMarker);
  if (startIndex < 0) {
    return null;
  }
  const relativeEnd = lines.slice(startIndex + 1).findIndex((line) => stripCommentPrefix(line).trim() === endMarker);
  if (relativeEnd < 0) {
    return null;
  }
  const endIndex = startIndex + 1 + relativeEnd;

  return {
    content: lines.slice(startIndex + 1, endIndex).join("\n"),
    startLine: startIndex + 1,
    endLine: endIndex + 1,
  } satisfies TextSection;
}

/** Parses MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY, scoped contracts, and semantic blocks. */
export function parseGovernedFile(root: string, filePath: string, text: string): FileMarkupRecord {
  const moduleContract = parseFieldSection(findSection(text, "START_MODULE_CONTRACT", "END_MODULE_CONTRACT"));
  const linkTokens = splitList(moduleContract?.fields.LINKS);
  return {
    path: normalizeRelative(root, filePath),
    moduleContract,
    moduleMap: parseListSection(findSection(text, "START_MODULE_MAP", "END_MODULE_MAP")),
    changeSummary: parseFieldSection(findSection(text, "START_CHANGE_SUMMARY", "END_CHANGE_SUMMARY")),
    contracts: parseScopedFieldSections(text),
    blocks: parseBlocks(text),
    // M-* and DF-* only — V-M-* must not leak into linkedModuleIds (G-11).
    linkedModuleIds: linkTokens.filter(
      (item) => ANCHOR_PATTERNS.module.test(item) || ANCHOR_PATTERNS.dataFlow.test(item),
    ),
    dependsModuleIds: splitList(moduleContract?.fields.DEPENDS).filter((item) => ANCHOR_PATTERNS.module.test(item)),
    linkedVerificationIds: linkTokens.filter((item) => ANCHOR_PATTERNS.verification.test(item)),
  };
}

/** Options for analyzeGovernedFile; optional so existing 3-arg callers stay valid. */
export type GovernedFileAnalysisOptions = {
  unverifiedLanguages?: readonly string[];
  /** Project-declared extra extensions from `.ngrace-lint.json` `codeExtensions`. */
  codeExtensions?: readonly string[];
};

/** Validates structural markup, module-map semantics, and adapter-backed language analysis. */
export function analyzeGovernedFile(
  root: string,
  filePath: string,
  text: string,
  options: GovernedFileAnalysisOptions = {},
): GovernedFileAnalysis {
  const record = parseGovernedFile(root, filePath, text);
  const issues = validateMarkerStructure(filePath, text);
  const contract = record.moduleContract;
  if (!contract) {
    issues.push(markupIssue("error", "markup.missing-module-contract", filePath, 1, "Governed files require one MODULE_CONTRACT section."));
  } else {
    for (const field of ["PURPOSE", "SCOPE", "DEPENDS", "LINKS"]) {
      if (!contract.fields[field]?.trim()) {
        issues.push(markupIssue("error", "markup.missing-contract-field", filePath, contract.startLine, `MODULE_CONTRACT requires non-empty ${field}.`));
      }
    }
    issues.push(...validateDuplicateContractFields(filePath, text, contract.startLine));
  }

  const role = parseRole(contract?.fields.ROLE);
  const mapMode = parseMapMode(contract?.fields.MAP_MODE);
  if (contract?.fields.ROLE && !role) {
    issues.push(markupIssue("error", "markup.invalid-role", filePath, contract.startLine, `Unsupported ROLE '${contract.fields.ROLE}'.`));
  }
  if (contract?.fields.MAP_MODE && !mapMode) {
    issues.push(markupIssue("error", "markup.invalid-map-mode", filePath, contract.startLine, `Unsupported MAP_MODE '${contract.fields.MAP_MODE}'.`));
  }

  const effectiveRole = role ?? inferRole(filePath);
  const effectiveMapMode = mapMode ?? defaultMapMode(effectiveRole);
  if (role && mapMode && defaultMapMode(role) !== mapMode) {
    issues.push(markupIssue("error", "markup.role-map-mode-mismatch", filePath, contract?.startLine ?? 1, `${role} files require MAP_MODE ${defaultMapMode(role)}, not ${mapMode}.`));
  }
  validateMapShape(filePath, record, effectiveMapMode, issues);

  const extension = path.extname(filePath);
  const adapter = ADAPTER_BACKED_EXTENSIONS.has(extension)
    ? LANGUAGE_ADAPTERS.find((candidate) => candidate.supports(filePath))
    : undefined;
  let language: LanguageAnalysis | null = null;
  if (adapter) {
    try {
      language = adapter.analyze(filePath, text);
    } catch (error) {
      issues.push(markupIssue(
        "error",
        error instanceof LanguageRuntimeMissingError ? "analysis.runtime-missing" : "analysis.adapter-failed",
        filePath,
        1,
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  if (!adapter) {
    const claimsParity = effectiveMapMode === "EXPORTS" || effectiveMapMode === "LOCALS";
    const acknowledged = new Set(options.unverifiedLanguages ?? []).has(extension);
    if (claimsParity && isGovernedCodeExtension(extension, options.codeExtensions) && !acknowledged) {
      issues.push(markupIssue(
        "warning",
        "analysis.no-adapter",
        filePath,
        contract?.startLine ?? 1,
        `MODULE_MAP ${effectiveMapMode} parity is not verified for ${extension} files. `
          + `GRACE has no export adapter for this language; treat MODULE_MAP as unverified `
          + `documentation. Acknowledge per repo with .ngrace-lint.json `
          + `{ "unverifiedLanguages": ["${extension}"] }.`,
      ));
    }
  }

  if (language) {
    if (language.exportConfidence === "heuristic") {
      issues.push(markupIssue("warning", "analysis.heuristic-confidence", filePath, contract?.startLine ?? 1, `${language.adapterId} analysis is heuristic and cannot prove exact MODULE_MAP parity.`));
    }
    validateMapParity(filePath, record, effectiveMapMode, language, issues);
  }

  return { record, language, issues };
}

function parseFieldSection(section: TextSection | null): FileFieldSection | null {
  if (!section) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const line of section.content.split("\n")) {
    const match = stripCommentPrefix(line).trim().match(/^([A-Z_]+):\s*(.*)$/);
    if (match) {
      fields[match[1]!] = match[2]!.trim();
    }
  }
  return { fields, startLine: section.startLine, endLine: section.endLine };
}

function parseListSection(section: TextSection | null): FileListItem[] {
  if (!section) {
    return [];
  }
  return section.content.split("\n")
    .map((line, index) => {
      const label = stripCommentPrefix(line).trim();
      const symbolName = label.match(/^(?:[-*]\s*)?((?:[$_]|\p{ID_Start})(?:[$_]|\p{ID_Continue})*|default)(?=\s|$)/u)?.[1];
      return { label, symbolName, line: section.startLine + index };
    })
    .filter((item) => item.label.length > 0);
}

function parseScopedFieldSections(text: string): FileContractRecord[] {
  const sections: FileContractRecord[] = [];
  const lines = text.split("\n");
  for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
    const start = stripCommentPrefix(lines[startIndex]!).trim().match(/^START_CONTRACT:\s*([A-Za-z0-9_$.-]+)$/);
    if (!start) {
      continue;
    }
    const name = start[1]!;
    const relativeEnd = lines.slice(startIndex + 1).findIndex((line) => stripCommentPrefix(line).trim() === `END_CONTRACT: ${name}`);
    if (relativeEnd < 0) {
      continue;
    }
    const endIndex = startIndex + 1 + relativeEnd;
    const parsed = parseFieldSection({
      content: lines.slice(startIndex + 1, endIndex).join("\n"),
      startLine: startIndex + 1,
      endLine: endIndex + 1,
    });
    sections.push({
      name,
      fields: parsed?.fields ?? {},
      startLine: startIndex + 1,
      endLine: endIndex + 1,
    });
    startIndex = endIndex;
  }
  return sections;
}

function parseBlocks(text: string): FileBlockRecord[] {
  const blocks: FileBlockRecord[] = [];
  const openBlocks: Array<{ name: string; startLine: number }> = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const marker = stripCommentPrefix(lines[index]!).trim();
    const start = marker.match(/^START_BLOCK_([A-Z0-9_]+)$/);
    if (start?.[1]) {
      openBlocks.push({ name: start[1], startLine: index + 1 });
      continue;
    }

    const end = marker.match(/^END_BLOCK_([A-Z0-9_]+)$/);
    const open = openBlocks.at(-1);
    if (!end?.[1] || !open || open.name !== end[1]) {
      continue;
    }

    openBlocks.pop();
    blocks.push({ name: open.name, startLine: open.startLine, endLine: index + 1 });
  }
  return blocks.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
}

function splitList(text?: string): string[] {
  const authored = (text ?? "").trim();
  const normalized = authored.startsWith("[") && authored.endsWith("]")
    ? authored.slice(1, -1).trim()
    : authored;
  return normalized.split(",").map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== "none");
}

type MarkerEvent = { direction: "start" | "end"; family: string; name: string; key: string; line: number };

function validateMarkerStructure(file: string, text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const completed = new Set<string>();
  const openMarkers: MarkerEvent[] = [];
  // Same searchable surface as hasGraceMarkers: markers inside string/template
  // literals are documentation or fixtures, not structure (corr 144 / full coverage).
  const lines = stripQuotedStrings(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const event = parseMarkerEvent(stripCommentPrefix(lines[index]!).trim(), index + 1);
    if (!event) {
      continue;
    }
    if (event.direction === "start") {
      const open = openMarkers.at(-1);
      if (openMarkers.some((marker) => marker.key === event.key)) {
        if (open) {
          issues.push(markupIssue("error", "markup.overlapping-markers", file, event.line, `${event.key} starts before ${open.key} ends.`));
        }
        issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} has a duplicate start marker.`));
        continue;
      }
      if (open && !(open.family === "block" && event.family === "block")) {
        issues.push(markupIssue("error", "markup.overlapping-markers", file, event.line, `${event.key} starts before ${open.key} ends.`));
        if (open.key === event.key) {
          issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} has a duplicate start marker.`));
        }
        continue;
      }
      if (completed.has(event.key)) {
        issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} is declared more than once.`));
      }
      openMarkers.push(event);
      continue;
    }
    const open = openMarkers.at(-1);
    if (!open) {
      issues.push(markupIssue("error", "markup.reversed-marker", file, event.line, `${event.key} ends without a preceding matching start marker.`));
      continue;
    }
    if (open.key !== event.key) {
      issues.push(markupIssue("error", "markup.mismatched-marker", file, event.line, `${event.key} does not match open marker ${open.key}.`));
      continue;
    }
    completed.add(event.key);
    openMarkers.pop();
  }
  for (const open of openMarkers) {
    issues.push(markupIssue("error", "markup.missing-end-marker", file, open.line, `${open.key} is missing its end marker.`));
  }
  return issues;
}

function parseMarkerEvent(line: string, lineNumber: number): MarkerEvent | null {
  const fixed = [
    ["START_MODULE_CONTRACT", "start", "module-contract"],
    ["END_MODULE_CONTRACT", "end", "module-contract"],
    ["START_MODULE_MAP", "start", "module-map"],
    ["END_MODULE_MAP", "end", "module-map"],
    ["START_CHANGE_SUMMARY", "start", "change-summary"],
    ["END_CHANGE_SUMMARY", "end", "change-summary"],
  ] as const;
  for (const [marker, direction, family] of fixed) {
    if (line === marker) {
      return { direction, family, name: family, key: family, line: lineNumber };
    }
  }
  const contract = line.match(/^(START|END)_CONTRACT:\s*([A-Za-z0-9_$.-]+)$/);
  if (contract) {
    return { direction: contract[1] === "START" ? "start" : "end", family: "contract", name: contract[2]!, key: `contract:${contract[2]}`, line: lineNumber };
  }
  const block = line.match(/^(START|END)_BLOCK_([A-Z0-9_]+)$/);
  if (block) {
    return { direction: block[1] === "START" ? "start" : "end", family: "block", name: block[2]!, key: `block:${block[2]}`, line: lineNumber };
  }
  return null;
}

function validateDuplicateContractFields(file: string, text: string, startLine: number): LintIssue[] {
  const section = findSection(text, "START_MODULE_CONTRACT", "END_MODULE_CONTRACT");
  if (!section) {
    return [];
  }
  const seen = new Set<string>();
  const issues: LintIssue[] = [];
  section.content.split("\n").forEach((line, index) => {
    const field = stripCommentPrefix(line).trim().match(/^([A-Z_]+):/)?.[1];
    if (!field) {
      return;
    }
    if (seen.has(field)) {
      issues.push(markupIssue("error", "markup.duplicate-contract-field", file, startLine + index, `MODULE_CONTRACT repeats ${field}.`));
    }
    seen.add(field);
  });
  return issues;
}

function parseRole(value?: string): ModuleRole | undefined {
  return (["RUNTIME", "TEST", "BARREL", "CONFIG", "TYPES", "SCRIPT"] as const).find((role) => role === value?.trim().toUpperCase());
}

function parseMapMode(value?: string): MapMode | undefined {
  return (["EXPORTS", "LOCALS", "SUMMARY", "NONE"] as const).find((mode) => mode === value?.trim().toUpperCase());
}

function inferRole(filePath: string): ModuleRole {
  const normalized = filePath.replaceAll("\\", "/");
  if (/(^|\/)(?:__tests__|tests)(\/|$)|\.(?:test|spec)\.[^.]+$/.test(normalized)) {
    return "TEST";
  }
  return "RUNTIME";
}

function defaultMapMode(role: ModuleRole): MapMode {
  return ({ RUNTIME: "EXPORTS", TEST: "LOCALS", BARREL: "SUMMARY", CONFIG: "NONE", TYPES: "EXPORTS", SCRIPT: "LOCALS" } as const)[role];
}

function validateMapShape(file: string, record: FileMarkupRecord, mapMode: MapMode, issues: LintIssue[]): void {
  if (mapMode === "NONE" && record.moduleMap.length > 0) {
    issues.push(markupIssue("error", "markup.module-map-forbidden", file, record.moduleMap[0]!.line, "MAP_MODE NONE requires an empty or omitted MODULE_MAP."));
  } else if (mapMode !== "NONE" && record.moduleMap.length === 0) {
    issues.push(markupIssue("error", "markup.module-map-missing", file, record.moduleContract?.startLine ?? 1, `MAP_MODE ${mapMode} requires a non-empty MODULE_MAP.`));
  }
  if (mapMode === "SUMMARY") {
    for (const item of record.moduleMap) {
      if (!/(?:\s+-\s+|:\s+)\S/.test(item.label)) {
        issues.push(markupIssue("error", "markup.summary-item-undescribed", file, item.line, `SUMMARY item '${item.label}' requires a description.`));
      }
    }
  }
}

function validateMapParity(file: string, record: FileMarkupRecord, mapMode: MapMode, language: LanguageAnalysis, issues: LintIssue[]): void {
  if (mapMode !== "EXPORTS" && mapMode !== "LOCALS") {
    return;
  }
  const expected = mapMode === "EXPORTS" ? language.exports : language.localSymbols;
  const listed = new Set(record.moduleMap.map((item) => item.symbolName).filter((symbol): symbol is string => Boolean(symbol)));
  const missing = [...expected].filter((symbol) => !listed.has(symbol)).sort();
  const extra = [...listed].filter((symbol) => !expected.has(symbol)).sort();
  if (missing.length === 0 && extra.length === 0) {
    return;
  }
  const severity = language.exportConfidence === "exact" ? "error" : "warning";
  issues.push(markupIssue(
    severity,
    language.exportConfidence === "exact" ? "markup.module-map-mismatch" : "analysis.heuristic-map-mismatch",
    file,
    record.moduleMap[0]?.line ?? record.moduleContract?.startLine ?? 1,
    `MODULE_MAP ${mapMode} mismatch. Missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`,
  ));
}

function markupIssue(severity: LintIssue["severity"], code: string, file: string, line: number, message: string): LintIssue {
  return { severity, code, file, line, message };
}
