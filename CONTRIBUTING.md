# Day-to-day workflow

Short version of how work moves through this repository. For release mechanics in full,
see [RELEASING.md](./RELEASING.md).

`main` is protected: pull requests only, required checks must pass, and the branch must be
up to date before merging. `git push origin main` will be rejected — that is deliberate.

## Ordinary change

```bash
git switch main && git pull
git switch -c fix/short-description        # or feat/, docs/, chore/, test/

# … work …

bun run validate:ci                        # everything CI runs, locally
git commit -m "fix: describe the change"   # Conventional Commits, enforced by commitlint
git push -u origin fix/short-description
```

Open the PR against **`alex-shekhter/neo-grace`** — GitHub defaults the base to
`osovv/grace-marketplace` because this is a fork, and it gets this wrong every time.

Wait for `validate`, `dart-adapter` and `windows-compatibility`, then merge. Approvals are
set to 0 because GitHub does not let you approve your own pull request.

**If `main` moved while your PR was open**, GitHub will ask you to update the branch before
merging. Do it — the alternative is merging a branch whose checks ran against a stale base,
which is how a fix once got left out of a release here.

## Release

Two shapes, and they are not interchangeable.

### Prerelease — `X.Y.Z-rc.N`

One command does everything: bump, commit, tag, push. The tag push triggers the publish
workflow, which publishes under the `rc` dist-tag and leaves `latest` alone.

```bash
git switch -c release/5.1.0-rc.0
RELEASE_SUMMARY="One paragraph describing this release." bun run release:bump 5.1.0-rc.0
```

### Stable — `X.Y.Z`

Two steps with a merge between them. `release:bump` prepares a PR; it deliberately does not
tag before required checks pass.

```bash
git switch main && git pull
git switch -c release/5.1.0
RELEASE_SUMMARY="One paragraph describing this release." bun run release:bump 5.1.0
# review, wait for checks, merge the PR

git switch main && git pull
bun run release:finalize 5.1.0             # tags v5.1.0 → triggers publish
```

**The stable publish then pauses.** `stable-release` requires a reviewer, so the run waits
in Actions until you approve the deployment — nothing reaches npm before you click. Open
the run, click **Review deployments → Approve and deploy**. Prereleases do not pause;
`publish-prerelease` uses no environment.

Immediately after it publishes, while `main` is still exactly the release commit:

```bash
bun run release:checklist                  # only fully passes in this window
```

`release:finalize` only accepts stable versions. Prereleases never use it.

### The release summary

`RELEASE_SUMMARY` must be set **on the same command line** — a separate `export` does not
survive into the next shell. For a long summary, put it in a file outside the repository,
because any unexpected file in the worktree fails the release:

```bash
RELEASE_SUMMARY_FILE=/tmp/summary.txt bun run release:bump 5.1.0
```

Whatever you supply is validated by the same envelope and prose checks applied to
AI-generated summaries — empty summaries and fenced code blocks are rejected.

If `opencode` is installed it writes the summary for you and neither variable is needed.
It is optional; nothing else depends on it.

## What blocks a release, and why

Each of these is a fail-closed gate that stops before anything permanent happens.

| Refusal | Meaning |
|---|---|
| `must run on a non-main branch` | Stable prep prepares a PR; branch first |
| `requires a clean worktree` | Commit or stash; a partial bump is recoverable with `git checkout package.json` |
| `is already published to npm` | Versions are immutable. Bump; never re-tag |
| `Remote tag vX.Y.Z already exists` | Use publish-workflow recovery, not a second finalize |
| `No release summary available` | Set `RELEASE_SUMMARY`, or install `opencode` |
| `Tag "vX.Y.Z" is not allowed to deploy` | The `stable-release` environment has no **tag** rule for `v*` |

## Reading `release:checklist`

It exits non-zero if any item fails, so read the lines rather than the exit code.

**"Git tag, ancestry, npm channel, and GitHub Release state are consistent"** requires
`main`'s tip to *be* the release tag. Merge anything after a release and it is permanently
red for that version — that is the design, not a misconfiguration. Run it in the window
right after `release:finalize`; every other item is meaningful at any time.

Checking out the tag does not help: the check also requires `branch === "main"`, so a
detached HEAD fails a different assertion instead.

## Repository settings this workflow assumes

Changing these breaks the release path; `bun run release:checklist` verifies them.

- **Classic branch protection on `main`** — not a ruleset. `release:checklist` queries
  `/branches/main/protection`, which reports classic protection only. Require a PR
  (0 approvals — GitHub will not let you approve your own), require branches up to date,
  include administrators, block force pushes and deletions, and require exactly these
  status checks: `validate`, `windows-compatibility`, `dart-adapter`.
- **Tag ruleset on `v*`** — a ruleset this time; the checklist reads `/rulesets` for tags.
  Block force pushes and deletions. Published tags are the record of what shipped.
- **Environment `stable-release`** — one required reviewer (you), plus deployment rules for
  branch `main` **and tag `v*`**. The tag rule is separate from the branch rule and is easy
  to miss; without it a tag-triggered deploy is rejected before the job runs.
- **npm trusted publisher** on `@neograce/cli` — GitHub Actions, `alex-shekhter/neo-grace`,
  `publish.yml`, **Environment left blank** so it matches both publish jobs. No token is
  stored anywhere; publishing runs on OIDC and produces a provenance attestation.

### When the settings UI will not cooperate

Adding required status checks through Settings → Branches sometimes offers no editable
control. `gh` reaches the same settings directly:

```bash
printf '{"strict":true,"checks":[{"context":"validate"},{"context":"windows-compatibility"},{"context":"dart-adapter"}]}' \
  | gh api -X PATCH repos/alex-shekhter/neo-grace/branches/main/protection/required_status_checks --input -
```

Read current state the same way, which is faster than clicking through pages:

```bash
gh api repos/alex-shekhter/neo-grace/branches/main/protection
gh api repos/alex-shekhter/neo-grace/environments/stable-release
gh api repos/alex-shekhter/neo-grace/environments/stable-release/deployment-branch-policies
gh api repos/alex-shekhter/neo-grace/rulesets
```

## npm version

CI pins npm to an exact version (`npm@11.17.0` in `publish.yml`), not a range.

Two reasons. Trusted publishing needs npm >= 11.5.1, and a floating range once pulled
npm 12 mid-release, whose changed `npm pack --json` output broke the packed smoke test.
Separately, `release:checklist` compares the local `npm pack` shasum against the published
tarball — `npm pack` is deterministic for a given tree *and npm version*, so that check
only means anything when your local npm matches CI's.

If you upgrade local npm, bump the pin in both publish jobs to match.

## Keeping the skill mirror in sync

`skills/grace/*` is canonical; `plugins/grace/skills/grace/*` is the packaged mirror.
Syncing is **not** automatic. Edit the canonical copy, mirror it, and let
`bun run validate:marketplace` confirm they match — it is part of `validate:ci` and of
every pre-commit hook.

## Upstream

This repository is a fork of [osovv/grace-marketplace](https://github.com/osovv/grace-marketplace).
`upstream` points there and `origin` points at this fork. See [LINEAGE.md](./LINEAGE.md).

```bash
git fetch upstream
git log --oneline main..upstream/main    # what upstream has that we do not
```

Changelog entries at `4.0.4` and below describe work done upstream and are never edited here.
