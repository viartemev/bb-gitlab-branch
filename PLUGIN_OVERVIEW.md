## The GitLab branch of your thread, next to your conversation

Open the **GitLab** tab and see the merge request for the branch this thread is working on: its status, approvals, blocking discussions and the latest pipeline. The panel follows the real worktree, so it shows the actual local branch, HEAD and upstream, and tells you when the pipeline checked a different commit than the one you have.

CI is drawn as ordered stages with parallel jobs. Pick a job to read its log inline; a log GitLab cannot return is explained instead of shown as empty. Commits render their real parent relationships, including merges.

Review discussions are grouped by file, with unresolved threads first and the code around each comment shown above it. Search by text, author or file, and load every page when you need a complete count. GitLab's own events are kept apart from reviewer comments. Any comment, merge request or job log can be added to your draft for the agent; nothing is sent for you.

Agents get read-only tools for the branch, merge request, discussions, pipelines, jobs and job logs, plus a `bb gitlab-branch branch` command for the terminal.

## Connection and scope

Needs `git` and an authenticated `glab` on the machine that holds the worktree, and works with GitLab.com and self-managed GitLab. An optional personal access token with `read_api` is stored in BB's secret settings and never reaches the panel or process arguments. TLS verification is never disabled.

The plugin only reads GitLab. It does not comment, resolve discussions, retry jobs or merge. Data stays as fresh as the last refresh, which the panel shows, and the panel refreshes every 30 seconds while visible.
