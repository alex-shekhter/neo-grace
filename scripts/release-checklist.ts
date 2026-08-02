// FILE: scripts/release-checklist.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Collect and report local, git, package, npm-channel, and GitHub Release state without publishing.
//   SCOPE: Static release hygiene plus read-only fetch, pack dry-run, npm dist-tag, and GitHub Release inspection.
//   DEPENDS: [node:fs, node:child_process, scripts/release-check.ts]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   collectCurrentReleaseState - Executes authoritative read-only release-state collectors.
//   tarballContentDigests - Extracts one tarball and hashes every file it contains.
//   main - Prints checklist results and exits nonzero on any missing or inconsistent state.
// END_MODULE_MAP

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectPackedContentErrors,
  collectReleaseProtectionErrors,
  collectReleaseStateErrors,
  type PackContentDigests,
  type ReleaseProtectionState,
  type ReleaseState,
} from "./release-check.ts";

type ChecklistItem = {
  label: string;
  ok: boolean;
  detail: string;
};

function runCapture(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(error)}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listFilesRecursive(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(path.relative(base, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

/**
 * Packs one npm spec, extracts it, and returns `path -> sha256` for every file.
 *
 * `spec` is either a package spec (`@scope/name@1.2.3`, which downloads the published
 * tarball) or empty for the working tree. Returns `{}` when packing or extraction
 * fails, which the validator reports as an unread comparison rather than a pass.
 */
export function tarballContentDigests(spec: string, repoRoot: string): PackContentDigests {
  const workDir = mkdtempSync(path.join(tmpdir(), "ngrace-pack-"));
  try {
    const argv = spec
      ? ["pack", spec, "--pack-destination", workDir, "--silent"]
      : ["pack", "--pack-destination", workDir, "--silent"];
    runCapture("npm", argv, repoRoot);

    const tarball = readdirSync(workDir).find((file) => file.endsWith(".tgz"));
    if (!tarball) return {};

    const extractDir = path.join(workDir, "extracted");
    execFileSync("mkdir", ["-p", extractDir]);
    execFileSync("tar", ["-xzf", path.join(workDir, tarball), "-C", extractDir]);

    const packageDir = path.join(extractDir, "package");
    if (!existsSync(packageDir)) return {};

    const digests: PackContentDigests = {};
    for (const rel of listFilesRecursive(packageDir, packageDir)) {
      digests[rel] = createHash("sha256").update(readFileSync(path.join(packageDir, rel))).digest("hex");
    }
    return digests;
  } catch {
    return {};
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Executes the authoritative non-publishing collectors for the current package version. */
export function collectCurrentReleaseState(repoRoot: string): { state: ReleaseState; packJson: string } {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version?: string };
  const version = pkg.version?.trim();
  if (!version) throw new Error("package.json version is missing.");
  const expectedTag = `v${version}`;

  runCapture("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"], repoRoot);
  const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot).trim();
  const head = runCapture("git", ["rev-parse", "HEAD"], repoRoot).trim();
  const originMain = runCapture("git", ["rev-parse", "origin/main"], repoRoot).trim();
  let tagCommit: string | undefined;
  const remoteTag = runCapture("git", ["ls-remote", "--tags", "origin", `refs/tags/${expectedTag}`], repoRoot).trim();
  if (remoteTag) {
    runCapture("git", ["fetch", "--force", "--no-tags", "origin", `refs/tags/${expectedTag}:refs/tags/${expectedTag}`], repoRoot);
    tagCommit = runCapture("git", ["rev-parse", `${expectedTag}^{commit}`], repoRoot).trim();
  }

  const packJson = runCapture("npm", ["pack", "--dry-run", "--json"], repoRoot);
  const pack = JSON.parse(packJson) as Array<{ shasum?: string; files?: Array<{ path?: string }> }>;
  const packedFiles = pack[0]?.files?.map((entry) => entry.path).filter((entry): entry is string => typeof entry === "string") ?? [];
  const localPackShasum = pack[0]?.shasum ?? "";
  const npmDistTags = JSON.parse(
    runCapture("npm", ["view", "@neograce/cli", "dist-tags", "--json"], repoRoot),
  ) as Record<string, string>;
  const npmPackageShasum = JSON.parse(
    runCapture("npm", ["view", `@neograce/cli@${version}`, "dist.shasum", "--json"], repoRoot),
  ) as string;
  const githubRelease = JSON.parse(
    runCapture("gh", ["release", "view", expectedTag, "--repo", "alex-shekhter/neo-grace", "--json", "tagName,isPrerelease"], repoRoot),
  ) as { tagName: string; isPrerelease: boolean };

  const localPackContent = tarballContentDigests("", repoRoot);
  const publishedPackContent = tarballContentDigests(`@neograce/cli@${version}`, repoRoot);

  return {
    state: {
      version, expectedTag, branch, head, originMain, tagCommit, packedFiles,
      localPackShasum, npmPackageShasum, localPackContent, publishedPackContent,
      npmDistTags, githubRelease,
    },
    packJson,
  };
}

/** Collects GitHub environment, branch protection, and release-tag ruleset state. */
export function collectCurrentReleaseProtectionState(repoRoot: string): ReleaseProtectionState {
  const environment = JSON.parse(runCapture("gh", ["api", "repos/alex-shekhter/neo-grace/environments/stable-release"], repoRoot)) as {
    protection_rules?: Array<{ type?: string; reviewers?: unknown[] }>;
    deployment_branch_policy?: { custom_branch_policies?: boolean };
  };
  const deploymentPolicies = JSON.parse(runCapture("gh", ["api", "repos/alex-shekhter/neo-grace/environments/stable-release/deployment-branch-policies"], repoRoot)) as {
    branch_policies?: Array<{ name?: string; type?: string }>;
  };
  const branch = JSON.parse(runCapture("gh", ["api", "repos/alex-shekhter/neo-grace/branches/main/protection"], repoRoot)) as {
    required_status_checks?: { contexts?: string[]; checks?: Array<{ context?: string }> };
    enforce_admins?: { enabled?: boolean };
    allow_force_pushes?: { enabled?: boolean };
    allow_deletions?: { enabled?: boolean };
  };
  const rulesetSummaries = JSON.parse(runCapture("gh", ["api", "repos/alex-shekhter/neo-grace/rulesets"], repoRoot)) as Array<{
    id?: number;
  }>;
  const rulesets = rulesetSummaries.flatMap((summary) => {
    if (!summary.id) return [];
    return [JSON.parse(runCapture("gh", ["api", `repos/alex-shekhter/neo-grace/rulesets/${summary.id}`], repoRoot)) as {
      target?: string;
      enforcement?: string;
      conditions?: { ref_name?: { include?: string[] } };
      rules?: Array<{ type?: string }>;
    }];
  }) as Array<{
    target?: string;
    enforcement?: string;
    conditions?: { ref_name?: { include?: string[] } };
    rules?: Array<{ type?: string }>;
  }>;
  const reviewerRule = environment.protection_rules?.find((rule) => rule.type === "required_reviewers");
  const requiredStatusChecks = [
    ...(branch.required_status_checks?.contexts ?? []),
    ...(branch.required_status_checks?.checks ?? []).map((check) => check.context).filter((context): context is string => Boolean(context)),
  ];
  const releaseTagRulesetActive = rulesets.some((ruleset) => {
    const includesReleaseTags = ruleset.conditions?.ref_name?.include?.some((pattern) => pattern === "refs/tags/v*" || pattern === "~ALL") ?? false;
    const ruleTypes = new Set(ruleset.rules?.map((rule) => rule.type));
    return ruleset.target === "tag"
      && ruleset.enforcement === "active"
      && includesReleaseTags
      && ruleTypes.has("deletion")
      && ruleTypes.has("non_fast_forward");
  });
  return {
    stableEnvironmentExists: true,
    stableEnvironmentRequiredReviewers: reviewerRule?.reviewers?.length ?? 0,
    stableEnvironmentUsesCustomPolicies: environment.deployment_branch_policy?.custom_branch_policies === true,
    stableEnvironmentAllowsMain: deploymentPolicies.branch_policies?.some((policy) => policy.type === "branch" && policy.name === "main") ?? false,
    stableEnvironmentAllowsReleaseTags: deploymentPolicies.branch_policies?.some((policy) => policy.type === "tag" && policy.name === "v*") ?? false,
    mainBranchProtected: true,
    mainRequiredStatusChecks: [...new Set(requiredStatusChecks)],
    mainEnforceAdmins: branch.enforce_admins?.enabled === true,
    mainAllowsForcePushes: branch.allow_force_pushes?.enabled === true,
    mainAllowsDeletions: branch.allow_deletions?.enabled === true,
    releaseTagRulesetActive,
  };
}

export function main(repoRoot = process.cwd()): number {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version?: string;
    scripts?: Record<string, string>;
    files?: string[];
  };
  const version = packageJson.version ?? "unknown";
  const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const changelogVersions = [...changelog.matchAll(/^##\s+<small>([^\s]+)\s+\(/gm)].map((match) => match[1]!);
  const duplicateVersions = changelogVersions.filter((entry, index) => changelogVersions.indexOf(entry) !== index);

  const checklist: ChecklistItem[] = [
    {
      label: "Current version is documented in CHANGELOG.md",
      ok: new RegExp(`^##\\s+<small>${escapeRegExp(version)}\\s+\\(`, "m").test(changelog),
      detail: `Expected CHANGELOG.md entry for ${version}.`,
    },
    {
      label: "CHANGELOG.md has no duplicate release headers",
      ok: duplicateVersions.length === 0,
      detail: `Duplicate versions: ${[...new Set(duplicateVersions)].join(", ") || "none"}.`,
    },
    {
      label: "neo-grace rc.0 historical publication failure is documented",
      ok: changelog.includes("v4.0.0-rc.0 was not published to npm") && changelog.includes("tag is retained"),
      detail: "Expected the retained rc.0 tag and failed/unpublished candidate note.",
    },
    {
      label: "Validation workflow exists",
      ok: existsSync(path.join(repoRoot, ".github/workflows/validate.yml")),
      detail: "Expected .github/workflows/validate.yml to exist.",
    },
    {
      label: "CI validation script exists",
      ok: Boolean(packageJson.scripts?.["validate:ci"]),
      detail: "Expected package.json script validate:ci.",
    },
    {
      label: "Release validation includes dedicated CLI validation",
      ok: Boolean(packageJson.scripts?.["validate:release"]?.includes("validate:cli") && packageJson.scripts?.["validate:release"]?.includes("validate:packed")),
      detail: "Expected package.json validate:release to invoke validate:cli and validate:packed.",
    },
    {
      label: "Publish workflow exists",
      ok: existsSync(path.join(repoRoot, ".github/workflows/publish.yml")),
      detail: "Expected .github/workflows/publish.yml to exist.",
    },
    {
      label: "Published CLI excludes test sources and fixtures",
      ok: Boolean(packageJson.files?.includes("!src/**/*.test.ts") && packageJson.files?.includes("!src/artifact/test-fixtures.ts")),
      detail: "Expected package.json files exclusions for test sources and GRACE fixture builders.",
    },
  ];

  try {
    const protectionErrors = collectReleaseProtectionErrors(collectCurrentReleaseProtectionState(repoRoot));
    checklist.push({
      label: "Stable environment, main branch, and v* release tags are protected",
      ok: protectionErrors.length === 0,
      detail: protectionErrors.join("; ") || "Validated stable-release main/v* deployment policies, main protection, and active v* tag ruleset.",
    });
  } catch (error) {
    checklist.push({
      label: "GitHub release protections were collected",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { state, packJson } = collectCurrentReleaseState(repoRoot);
    const stateErrors = collectReleaseStateErrors(state);
    const packErrors = collectPackedContentErrors(packJson);
    const publishedFileCount = Object.keys(state.publishedPackContent).length;
    const framingNote = state.localPackShasum && state.npmPackageShasum
      && state.localPackShasum !== state.npmPackageShasum
      ? ` Archive digests differ (local ${state.localPackShasum.slice(0, 12)}, published ${state.npmPackageShasum.slice(0, 12)}) — tar/gzip framing is packer-specific and is not compared.`
      : "";
    checklist.push({
      label: "Git tag, ancestry, npm channel, and GitHub Release state are consistent",
      ok: stateErrors.length === 0,
      detail: stateErrors.join("; ")
        || `Validated ${state.expectedTag}; ${publishedFileCount} published files match this tree byte for byte.${framingNote}`,
    });
    checklist.push({
      label: "npm pack dry-run contains only approved runtime package files",
      ok: packErrors.length === 0,
      detail: packErrors.join("; ") || `${state.packedFiles.length} packed files inspected.`,
    });
  } catch (error) {
    checklist.push({
      label: "Network-backed and packed release state was collected",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  console.log("## Release Checklist");
  console.log(`**Version**: ${version}`);
  for (const item of checklist) {
    console.log(`- [${item.ok ? "x" : " "}] ${item.label}`);
    if (!item.ok) console.log(`  ${item.detail}`);
  }
  console.log("\n### Recommended Commands");
  console.log("- bun run validate:ci");
  console.log("- bun run validate:release");
  console.log("- bun run validate:packed");
  console.log("- bun run release:checklist");

  return checklist.every((item) => item.ok) ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
