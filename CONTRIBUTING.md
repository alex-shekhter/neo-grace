# Day-to-day workflow

Short version of how work moves through this repository. For release mechanics in full,
see [RELEASING.md](./RELEASING.md).

`main` is protected: pull requests only, required checks must pass, and the branch must be
up to date before merging. `git push origin main` will be rejected — that is deliberate.

## Ordinary change

**These are two separate flows. Starting a branch happens once; committing and pushing happen
many times.** They are written apart because reading them as one block is how you end up running
branch-creation commands on a branch that already exists — see the warning below.

### Flow 1 — starting a branch (once)

```bash
git switch main && git pull
git switch -c fix/short-description        # or feat/, docs/, chore/, test/
```

### Flow 2 — while working on that branch (repeat as often as you like)

```bash
git status                                 # confirm where you are and what is staged
bun run validate:ci                        # or validate:release — see below
git add -A
git commit -m "fix: describe the change"   # Conventional Commits, enforced by commitlint
git push                                   # first push only: git push -u origin <branch>
```

> **Do not re-run Flow 1 to resume work.** `git switch -c <existing-branch>` fails with
> *"a branch named … already exists"*, and forcing past it (`-B`, or deleting the branch first)
> gives you a branch at `main` with **none of your commits**. To resume, just `git switch` to the
> branch — or check `git rev-parse --abbrev-ref HEAD` and discover you were already on it.
>
> Before assuming you have something to commit, run `git status`. A clean tree plus
> `git rev-list --count main..HEAD` greater than zero means the work is already committed and
> only needs pushing.

### Which validate script before pushing

| Situation | Command | Why |
|---|---|---|
| Ordinary change | `bun run validate:ci` | typecheck, tests, `validate:cli`, marketplace, examples |
| You touched `package.json`, either manifest, `openpackage.yml`, `README.md`'s version line, or the published file list | `bun run validate:release` | adds **`release:check`** and **`validate:packed`**, which `validate:ci` does not run |

`validate:ci` is named for what *CI* runs, not for everything worth running. Renames and version
bumps break packaging and release tooling before they break tests, so a branch that touches the
release surface needs `validate:release` even though CI will pass without it.

Open the PR against **`alex-shekhter/neo-grace`** — GitHub defaults the base to
`osovv/grace-marketplace` because this is a fork, and it gets this wrong every time.

Wait for `validate`, `dart-adapter` and `windows-compatibility`, then merge. Approvals are
set to 0 because GitHub does not let you approve your own pull request.

**If `main` moved while your PR was open**, GitHub will ask you to update the branch before
merging. Do it — the alternative is merging a branch whose checks ran against a stale base,
which is how a fix once got left out of a release here.

### Squash merging and long branches

Squash is the norm here and stays the norm. It costs the most on a branch carrying many
well-formed commits, because `scripts/release-summary.ts` builds changelog prose from commit
metadata and a squash gives it one message instead of many.

So when a branch is long, **the squash message is doing the work of every commit it replaces.**
Write it deliberately, and if any commit on the branch was marked `!` or carried a
`BREAKING CHANGE:` footer, carry that footer into the squash body — otherwise the breaking change
exists in the diff and nowhere in the history.

## After the merge — checking a branch landed, then deleting it

**Do not trust `git branch --merged main`.** PRs here are squash-merged, so the merge
writes a *new* commit and the original branch is never an ancestor of `main`. A fully
landed branch is reported as unmerged forever, which is how four stale branches once
accumulated here — every one of them already in `main`.

Ask instead whether the branch's **content** differs from `main`:

```bash
git fetch origin && git switch main && git pull

git diff --stat main..<branch>       # empty output → tree identical to main, landed
git log --oneline main..<branch>     # commits main does not have, by SHA
```

`git diff` is the answer that matters; `git log` almost always lists something after a
squash merge and on its own proves nothing. When the diff is not empty, read its direction
before assuming work is stranded — a landed branch that `main` has since moved past shows
the *old* lines as additions:

```bash
git diff main..<branch> | grep -E '^\+' | grep -v '^\+\+\+'
```

If everything there is a superseded version of something `main` already has, the branch is
spent. Then delete it in both places:

```bash
git branch -d <branch>                  # -D if squash-merged; -d will refuse
git push origin --delete <branch>       # skip if the remote is already [gone]
git fetch --prune                       # drop tracking refs for deleted remote branches
```

`git branch -vv` marks a branch whose remote is gone with `[origin/<name>: gone]` — that is
usually the fastest signal that a PR merged and GitHub deleted the head branch for you.

`git fetch --prune` only removes refs whose **remote branch no longer exists**. It will
never clear the `upstream/*` refs, because those branches are alive in the fork parent —
see [Upstream](#upstream).

Optional: GitHub's **Settings → General → Pull Requests → Automatically delete head
branches** removes the remote branch on merge, so the `[gone]` marker appears without you
doing anything. It never touches local branches, so the cleanup above is still manual.

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

`skills/ngrace/*` is canonical; `plugins/ngrace/skills/ngrace/*` is the packaged mirror.
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

`git branch -a` lists several `upstream/*` branches. They are not ours and `git fetch
--prune` will never clear them — they are an accurate mirror of a repository someone else
owns, and the lines have diverged (upstream is on `4.0.x`). To track only `upstream/main`:

```bash
git config remote.upstream.fetch '+refs/heads/main:refs/remotes/upstream/main'
git for-each-ref --format='%(refname)' refs/remotes/upstream \
  | grep -v 'refs/remotes/upstream/main$' \
  | xargs -n1 git update-ref -d
```

Both steps are needed. Narrowing the refspec alone changes nothing, and neither does
adding `--prune` to the fetch: prune only removes refs inside the refspec's destination
namespace, and the old refs now fall outside it. The second command deletes them directly;
after that, `git fetch upstream` brings back only `main`.
