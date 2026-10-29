# GitLab Branch for BB

A thread side panel that follows the current worktree's GitLab branch. Works
with GitLab.com and self-managed GitLab, including machines reached through BB.

## Interface

The compact overview shows factual GitLab merge status, CI results, approval
counts and blocking-discussion flags, without generated summaries or readiness
recommendations. Description and participants
are collapsed by default. CI combines branch and MR history and renders ordered
stages with parallel jobs, semantic colors, a stage navigator and inline job logs.
Stage order comes from a read-only GitLab GraphQL query; when unavailable, jobs
are still grouped but no stage-order connectors are invented.

Commits render actual parent relationships, including merges. Discussions use
collapsible threads, unresolved-first ordering, full-text/author/file search,
file filters, counts scoped to loaded pages, and explicit load-more/load-all
controls. Search and expanded threads survive refresh. GitLab-generated actions
are separated under “История MR”, with an explanation.

## Features

- Actual local branch, HEAD, upstream SHA, dirty files and local ahead/behind
  (relative to locally available upstream refs; this plugin never fetches).
- Merge request selection, description, author/reviewers/assignees, labels,
  milestone, merge status, conflicts, approvals and head pipeline.
- Paginated review discussions and replies with file/line positions, resolution,
  outdated-diff markers, unresolved and system-event filters.
- Branch and MR pipelines, jobs, stages, durations, artifacts listed with links,
  and bounded readable job traces. Pipeline SHA is compared to local HEAD.
- Published branch commit history, refresh, and 30-second polling while visible.
- Insert a review comment, MR or job log into the chat draft, without auto-send.
- Read-only `gitlab_branch` tool and `bb gitlab-branch branch [--thread <id>]` command.

## Install

Requires BB 0.48+, Git and `glab` on the environment machine.

```sh
npm install --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install .
```

Authenticate on the machine that holds the worktree with `glab auth login`.
In BB open **Plugins → GitLab Branch**. For ordinary GitLab hostnames no settings
are needed. For a custom hostname (e.g. code.company.com), enter it without a
scheme or path. Set Remote only to override automatic upstream/origin discovery.
An optional secret PAT with read_api can be saved in the native plugin settings
(the hostname must be explicitly configured when a PAT is used);
it never goes to frontend results or process arguments. VPN and corporate CA
trust must work for glab on the environment machine. TLS verification is not disabled.

Open **GitLab** from the thread header or the side panel's tab selector. The
plugin can be installed while a GitHub repository is open; it shows an explicit
non-GitLab state until you open a GitLab worktree.

## Scope and limitations

The plugin only reads GitLab. Sending comments, resolving discussions, retrying
jobs and merging are deliberately separate future actions. Every detail read
checks the checkout identity; a stale branch or commit is rejected. Data already
fetched can age until the next refresh; the last successful refresh is visible.
Approvals may be unavailable by edition, version or permissions. Standard fork
MRs are discovered in the fork's parent project and validated against source
project and remote branch. GitLab installed under a URL subpath is not supported.

All lists have explicit pagination. Discussion filters apply to loaded pages.
Discussion previews strip Markdown formatting; thread-level resolution is
authoritative. Plain comments without a resolution flag are a separate category.
Sync shows the exact local clock time of the last branch refresh. Job log states
distinguish not-started, skipped, erased and unavailable traces. In particular,
if GitLab reports a stored trace artifact but returns zero bytes from the trace
API, the panel reports that discrepancy and provides refresh and GitLab links.
It cannot retrieve log contents that the instance does not return.

Job traces are cleaned of terminal escapes and capped at the last 48,000
characters; glab output is capped at 8 MiB. Full logs, artifacts and downstream
pipeline navigation remain available through GitLab links. Large comments and
MR descriptions are bounded; context insertion explicitly marks shortened text.
The plugin does not export credentials or raw remote URLs in errors.

## Development

`npm run typecheck`, `npm test`, `npm run build`. Tests use the public BB backend
and frontend harnesses and fixture-backed GitLab API responses. Host code uses
Node child_process with argument arrays (no shell); REST reads use GET and the
GraphQL stage-order query uses POST, never mutations.

### Visual development

`preview/` contains a fixture-backed browser preview (no credentials or real
requests) for 320/420/680 px panels, light/dark themes and failed/running/ready
MRs. Build `preview/main.tsx` with esbuild, aliasing `@get-bb/plugin-sdk/app` to
`preview/sdk.tsx`, and serve that directory. Preview bundles are not committed.

The selected MR pipeline is shown only after MR details have loaded. Initial
loading is neutral; refresh retains the last known MR pipeline instead of
temporarily displaying a branch pipeline. Branch pipelines remain available
in the CI/CD selector once MR data is ready.
