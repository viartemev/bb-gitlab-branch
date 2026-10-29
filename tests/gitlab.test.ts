import { test } from "node:test";
import assert from "node:assert/strict";
import { GitLabReader } from "../gitlab";
import { parseRemote, safeUrl, cleanLog } from "../model";
import type { Run } from "../command";

const mr = {
  iid: 7,
  project_id: 10,
  source_project_id: 10,
  target_project_id: 10,
  source_branch: "feature/task",
  target_branch: "main",
  sha: "aaa",
  title: "Feature",
  state: "opened",
  web_url: "https://gitlab.example.test/team/project/-/merge_requests/7",
  author: { name: "Alex", username: "alex" },
  reviewers: [],
  labels: [],
  updated_at: "2026-10-29T10:00:00Z",
  diff_refs: { head_sha: "aaa" },
};
const pipeline = {
  id: 50,
  ref: "feature/task",
  sha: "aaa",
  status: "failed",
  source: "push",
  created_at: "2026-10-29T10:00:00Z",
  web_url: "https://gitlab.example.test/team/project/-/pipelines/50",
};
function fixture(
  overrides: {
    remote?: string;
    branch?: string;
    head?: string;
    upstreamRemote?: string;
    merge?: string;
    fork?: number;
    api?: (path: string) => unknown;
  } = {},
) {
  const calls: { command: string; args: string[]; token?: string }[] = [];
  const run: Run = async (command, args, opts) => {
    calls.push({ command, args, token: opts.token });
    if (command === "git") {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel")
        return "/workspace";
      if (args[0] === "symbolic-ref") return overrides.branch ?? "feature/task";
      if (args[0] === "rev-parse")
        return args[2] === "HEAD" ? (overrides.head ?? "aaa") : "aaa";
      if (args[0] === "status") return " M file.ts";
      if (args[0] === "remote" && args.length === 1) return "origin\nupstream";
      if (args[0] === "remote")
        return overrides.remote ?? "git@gitlab.example.test:team/project.git";
      if (args[0] === "rev-list") return "2\t1";
      if (args[0] === "config")
        return args[2]!.endsWith(".remote")
          ? (overrides.upstreamRemote ?? "origin")
          : (overrides.merge ?? "refs/heads/feature/task");
      throw new Error(`Unexpected git ${args.join(" ")}`);
    }
    assert.equal(command, "glab");
    assert.deepEqual(args.slice(0, 5), [
      "api",
      "--hostname",
      "gitlab.example.test",
      "--method",
      "GET",
    ]);
    const endpoint = args[5]!;
    const custom = overrides.api?.(endpoint);
    if (custom !== undefined)
      return typeof custom === "string" ? custom : JSON.stringify(custom);
    if (endpoint === "projects/team%2Fproject")
      return JSON.stringify({
        id: 10,
        ...(overrides.fork
          ? { forked_from_project: { id: overrides.fork } }
          : {}),
      });
    if (endpoint.includes("/approvals"))
      return JSON.stringify({
        approvals_left: 1,
        approved_by: [{ user: { name: "Sam", username: "sam" } }],
      });
    if (endpoint === "projects/10/merge_requests/7") return JSON.stringify(mr);
    if (endpoint === "projects/10/pipelines/50")
      return JSON.stringify(pipeline);
    if (endpoint.includes("/merge_requests?")) return JSON.stringify([mr]);
    if (endpoint.includes("/pipelines?")) return JSON.stringify([pipeline]);
    throw new Error(`Unexpected GitLab endpoint ${endpoint}`);
  };
  return {
    calls,
    reader: new GitLabReader("/workspace", { hostname: "", remote: "" }, run),
    run,
  };
}
test("remote parsing supports nested groups, credentials and SSH ports without leaking credentials", () => {
  assert.deepEqual(
    parseRemote("git@gitlab.example.test:group/sub/project.git"),
    { hostname: "gitlab.example.test", projectPath: "group/sub/project" },
  );
  assert.deepEqual(
    parseRemote("https://oauth2:secret@gitlab.example.test/group/project.git"),
    { hostname: "gitlab.example.test", projectPath: "group/project" },
  );
  assert.deepEqual(
    parseRemote("ssh://git@gitlab.example.test:2222/team/project.git"),
    { hostname: "gitlab.example.test", projectPath: "team/project" },
  );
  assert.equal(parseRemote("file:///secrets"), null);
  assert.equal(parseRemote("../repo"), null);
  assert.equal(safeUrl("javascript:alert(1)", "gitlab.example.test"), "");
  assert.equal(safeUrl("https://evil.test/path", "gitlab.example.test"), "");
  assert.equal(
    safeUrl(
      "https://user:password@gitlab.example.test/path",
      "gitlab.example.test",
    ),
    "",
  );
});
test("snapshot reads actual checkout and remote and preserves SHA mismatch information", async () => {
  const { reader } = fixture();
  const result = await reader.snapshot();
  assert.equal(result.outcome, "ready");
  assert.equal(result.checkout?.dirty, true);
  assert.equal(result.checkout?.ahead, 2);
  assert.equal(result.checkout?.behind, 1);
  assert.equal(result.checkout?.head, "aaa");
  assert.equal(result.mergeRequests[0]?.iid, 7);
  assert.equal(result.pipelines[0]?.status, "failed");
});
test("uses upstream branch name when local branch is renamed", async () => {
  const { reader, calls } = fixture({ branch: "local-task" });
  const d = await reader.snapshot();
  assert.equal(d.checkout?.branch, "local-task");
  assert.equal(d.checkout?.remoteBranch, "feature/task");
  assert.ok(calls.some((c) => c.args[5]?.includes("ref=feature%2Ftask")));
});
test("GitHub checkout never invokes GitLab API", async () => {
  const { reader, calls } = fixture({
    remote: "https://github.com/team/repo.git",
  });
  assert.equal((await reader.snapshot()).outcome, "not-gitlab");
  assert.equal(
    calls.some((c) => c.command === "glab"),
    false,
  );
});
test("detached checkout returns metadata without guessing a branch", async () => {
  const { reader, calls } = fixture({ branch: "" });
  const result = await reader.snapshot();
  assert.equal(result.outcome, "detached");
  assert.equal(result.checkout?.branch, null);
  assert.equal(
    calls.some((c) => c.args[5]?.includes("merge_requests?")),
    false,
  );
});
test("fork discovery reads target project and excludes collisions from other source projects", async () => {
  const { reader } = fixture({
    fork: 99,
    api: (path) =>
      path.startsWith("projects/99/merge_requests?")
        ? [
            { ...mr, project_id: 99 },
            { ...mr, iid: 8, source_project_id: 123 },
          ]
        : undefined,
  });
  const result = await reader.snapshot();
  assert.equal(result.mergeRequests.length, 1);
  assert.equal(result.mergeRequests[0]?.projectId, 99);
});
test("permission errors in CI preserve available MR data with an explicit warning", async () => {
  const { reader } = fixture({
    api: (path) => {
      if (path.includes("/pipelines?")) throw new Error("403 Forbidden");
    },
  });
  const result = await reader.snapshot();
  assert.equal(result.mergeRequests.length, 1);
  assert.equal(result.pipelines.length, 0);
  assert.match(result.warnings[0]!, /403/);
});
test("stale checkout key rejects data reads after commit or branch changes", async () => {
  const first = fixture();
  const key = (await first.reader.snapshot()).checkout!.key;
  const next = fixture({ head: "bbb" });
  await assert.rejects(next.reader.mr(key, 10, 7), /изменились/);
  assert.equal(
    next.calls.some((c) => c.args[5] === "projects/10/merge_requests/7"),
    false,
  );
});
test("MR details degrade gracefully when approvals are unavailable", async () => {
  const { reader } = fixture({
    api: (path) => {
      if (path.endsWith("/approvals")) throw new Error("403");
    },
  });
  const key = (await reader.snapshot()).checkout!.key;
  const d = await reader.mr(key, 10, 7);
  assert.equal(d.approvals.available, false);
  assert.equal(d.mr.iid, 7);
});
test("refuses MR from an unrelated project even when branch names match", async () => {
  const { reader } = fixture({
    api: (path) =>
      path === "projects/20/merge_requests/7"
        ? { ...mr, source_project_id: 20 }
        : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  await assert.rejects(reader.discussions(key, 20, 7, 1), /не относится/);
});
test("discussion pagination retains replies, resolution and outdated diff positions", async () => {
  const { reader } = fixture({
    api: (path) =>
      path.includes("/discussions?")
        ? Array.from({ length: 20 }, (_, n) => ({
            id: String(n),
            notes: [
              {
                id: n + 1,
                body: "Review this",
                author: { name: "Sam", username: "sam" },
                resolvable: true,
                resolved: false,
                position: {
                  new_path: "src/a.ts",
                  new_line: 15,
                  head_sha: "old",
                },
              },
            ],
          }))
        : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const d = await reader.discussions(key, 10, 7, 1);
  assert.equal(d.next, 2);
  assert.equal(d.items[0]?.notes[0]?.outdated, true);
  assert.equal(d.items[0]?.notes[0]?.line, 15);
});
test("code context returns numbered lines around the commented line from the note's revision", async () => {
  const requested: string[] = [];
  const { reader } = fixture({
    api: (path) => {
      if (!path.includes("/repository/files/")) return undefined;
      requested.push(path);
      return Array.from({ length: 20 }, (_, n) => `line ${n + 1}`).join("\n");
    },
  });
  const key = (await reader.snapshot()).checkout!.key;
  const ctx = await reader.codeContext(key, 10, 7, "src/a.ts", "abc1234", 10);
  assert.deepEqual(
    ctx.lines.map((l) => l.n),
    [7, 8, 9, 10, 11, 12, 13],
  );
  assert.equal(ctx.lines[3]?.text, "line 10");
  assert.equal(ctx.available, true);
  assert.match(requested[0]!, /src%2Fa\.ts\/raw\?ref=abc1234$/);
  const gone = await reader.codeContext(key, 10, 7, "src/a.ts", "abc1234", 99);
  assert.equal(gone.available, false);
});
test("note exposes the revision to read: head for new lines, base for deleted ones", async () => {
  const { reader } = fixture({
    api: (path) =>
      path.includes("/discussions?")
        ? [
            {
              id: "1",
              notes: [
                { id: 1, position: { new_line: 3, head_sha: "headsha", base_sha: "basesha" } },
              ],
            },
            {
              id: "2",
              notes: [
                { id: 2, position: { old_line: 4, head_sha: "headsha", base_sha: "basesha" } },
              ],
            },
          ]
        : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const d = await reader.discussions(key, 10, 7, 1);
  assert.equal(d.items[0]?.notes[0]?.contextRef, "headsha");
  assert.equal(d.items[1]?.notes[0]?.contextRef, "basesha");
});
test("trace validates pipeline/job association and bounds cleaned output", async () => {
  const { reader } = fixture({
    api: (path) =>
      path === "projects/10/jobs/60"
        ? { pipeline: { id: 50 } }
        : path.endsWith("/trace")
          ? "\x1b[31m" + "a".repeat(50000) + "\x1b[0m"
          : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const log = await reader.trace(key, 10, 50, 60);
  assert.equal(log.text.length, 48000);
  assert.equal(log.truncated, true);
  assert.equal(log.totalCharacters, 50000);
  assert.equal(log.text.includes("\x1b"), false);
});
test("unrelated job cannot be read through another pipeline", async () => {
  const { reader, calls } = fixture({
    api: (path) =>
      path === "projects/10/jobs/60" ? { pipeline: { id: 51 } } : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  await assert.rejects(reader.trace(key, 10, 50, 60), /не принадлежит/);
  assert.equal(
    calls.some((c) => c.args[5]?.endsWith("/trace")),
    false,
  );
});
test("API credentials stay in child environment rather than CLI arguments", async () => {
  const { run, calls } = fixture();
  await new GitLabReader(
    "/workspace",
    { token: "test-secret", hostname: "gitlab.example.test", remote: "" },
    run,
  ).snapshot();
  assert.equal(
    JSON.stringify(calls.map((c) => c.args)).includes("test-secret"),
    false,
  );
  assert.ok(
    calls.some((c) => c.command === "glab" && c.token === "test-secret"),
  );
});
test("terminal escape cleaning preserves Unicode", () => {
  assert.equal(
    cleanLog("\x1b]8;;https://evil.test\x07Привет\x1b]8;;\x07\n"),
    "Привет\n",
  );
});
test("an explicit PAT cannot be sent to an auto-discovered host", async () => {
  const { run, calls } = fixture();
  await assert.rejects(
    new GitLabReader(
      "/workspace",
      { hostname: "", remote: "", token: "secret" },
      run,
    ).snapshot(),
    /hostname/,
  );
  assert.equal(
    calls.some((c) => c.command === "glab"),
    false,
  );
});
test("merged-result pipeline jobs are validated against source MR and pipeline membership", async () => {
  const { reader } = fixture({
    api: (path) => {
      if (path === "projects/99/pipelines/80")
        return { ...pipeline, id: 80, ref: "refs/merge-requests/7/merge" };
      if (path === "projects/99/merge_requests/7")
        return { ...mr, project_id: 99 };
      if (path.startsWith("projects/99/merge_requests/7/pipelines?"))
        return [{ id: 80, project_id: 99 }];
      if (path.startsWith("projects/99/pipelines/80/jobs?"))
        return [
          {
            id: 81,
            name: "unit",
            stage: "test",
            status: "success",
            artifacts: [],
          },
        ];
    },
  });
  const key = (await reader.snapshot()).checkout!.key;
  assert.equal((await reader.jobs(key, 99, 80, 1, 99, 7)).items[0]?.id, 81);
  await assert.rejects(reader.jobs(key, 99, 80, 1), /принадлежность/);
});

test("pipeline stage order comes from GitLab GraphQL instead of job IDs", async () => {
  const f = fixture({
    api: (path) =>
      path === "projects/10/pipelines/50"
        ? { ...pipeline, iid: 5 }
        : path.includes("/jobs?")
          ? [
              {
                id: 100,
                name: "test",
                stage: "test",
                status: "success",
                artifacts: [],
              },
              {
                id: 200,
                name: "build",
                stage: "build",
                status: "success",
                artifacts: [],
              },
            ]
          : undefined,
  });
  let query = "";
  const run: Run = async (cmd, args, opts) => {
    if (cmd === "glab" && args[1] === "graphql") {
      query = args[7]!;
      return JSON.stringify({
        data: {
          project: {
            pipeline: {
              stages: { nodes: [{ name: "build" }, { name: "test" }] },
            },
          },
        },
      });
    }
    return f.run(cmd, args, opts);
  };
  const reader = new GitLabReader(
    "/workspace",
    { hostname: "", remote: "" },
    run,
  );
  const key = (await reader.snapshot()).checkout!.key;
  const result = await reader.jobs(key, 10, 50, 1);
  assert.deepEqual(result.stageOrder, ["build", "test"]);
  assert.match(query, /stages/);
});
test("commit history retains parent identities for the UI graph", async () => {
  const { reader } = fixture({
    api: (path) =>
      path.includes("/repository/commits?")
        ? [
            {
              id: "a",
              parent_ids: ["b", "c"],
              title: "Merge",
              author_name: "Sam",
            },
          ]
        : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const page = await reader.commits(key, 1);
  assert.deepEqual(page.items[0]?.parentIds, ["b", "c"]);
});

test("manual jobs have no log until started and do not trigger trace fetch", async () => {
  const { reader, calls } = fixture({
    api: (path) =>
      path === "projects/10/jobs/60"
        ? { pipeline: { id: 50 }, status: "manual" }
        : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const log = await reader.trace(key, 10, 50, 60);
  assert.equal(log.state, "pending");
  assert.match(log.message, /не запущена/);
  assert.equal(
    calls.some((c) => c.args[5]?.endsWith("/trace")),
    false,
  );
});
test("empty API trace with a nonempty trace artifact is unavailable, not an empty successful log", async () => {
  const { reader } = fixture({
    api: (path) =>
      path === "projects/10/jobs/60"
        ? {
            pipeline: { id: 50 },
            status: "success",
            artifacts: [{ file_type: "trace", size: 11611 }],
          }
        : path.endsWith("/trace")
          ? ""
          : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const log = await reader.trace(key, 10, 50, 60);
  assert.equal(log.state, "unavailable");
  assert.match(log.message, /11611 байт/);
  assert.equal(log.text, "");
});
test("resolved discussion metadata survives normalization even if note-level state differs", async () => {
  const { reader } = fixture({
    api: (path) =>
      path.includes("/discussions?")
        ? [
            {
              id: "d",
              individual_note: false,
              resolvable: true,
              resolved: true,
              notes: [
                { id: 1, body: "Review", resolvable: true, resolved: false },
              ],
            },
          ]
        : undefined,
  });
  const key = (await reader.snapshot()).checkout!.key;
  const result = await reader.discussions(key, 10, 7, 1);
  assert.equal(result.items[0]?.resolved, true);
  assert.equal(result.items[0]?.individual, false);
});
