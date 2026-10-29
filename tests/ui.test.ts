import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitGraph,
  stageStatus,
  groupStages,
  latestJobs,
  filterThreads,
  groupByFile,
  mergeStatusLabel,
  markdownPreview,
  clockTime,
  threadState,
  combinePipelines,
} from "../ui";
import type { Commit, Job, Discussion, MrDetail, Pipeline } from "../model";
const job = (
  id: number,
  name: string,
  stage: string,
  status: string,
  allowFailure = false,
): Job => ({
  id,
  name,
  stage,
  status,
  allowFailure,
  retried: false,
  duration: null,
  webUrl: "",
  artifacts: [],
});
test("stage graph honors server order and keeps parallel jobs together", () => {
  const stages = groupStages(
    [
      job(3, "lint", "test", "success"),
      job(1, "compile", "build", "success"),
      job(2, "unit", "test", "failed"),
    ],
    ["build", "test", "deploy"],
  );
  assert.deepEqual(
    stages.map((s) => s.name),
    ["build", "test", "deploy"],
  );
  assert.equal(stages[1]?.jobs.length, 2);
  assert.equal(stages[1]?.status, "failed");
});
test("allowed failures warn without turning a stage into a blocker; running and manual states stay distinct", () => {
  assert.equal(
    stageStatus([
      job(1, "lint", "test", "failed", true),
      job(2, "unit", "test", "success"),
    ]),
    "warning",
  );
  assert.equal(
    stageStatus([
      job(1, "lint", "test", "failed", true),
      job(2, "unit", "test", "running"),
    ]),
    "running",
  );
  assert.equal(stageStatus([job(1, "ship", "deploy", "manual")]), "manual");
});
test("retry history cannot make an already successful job look failed", () => {
  const previous = { ...job(1, "unit", "test", "failed"), retried: true };
  assert.deepEqual(
    latestJobs([previous, job(2, "unit", "test", "success")]).map((j) => j.id),
    [2],
  );
});
const commit = (id: string, parentIds: string[]): Commit => ({
  id,
  parentIds,
  title: id,
  author: "Sam",
  createdAt: "",
  webUrl: "",
});
test("commit graph follows fork and merge parent relationships, not date adjacency", () => {
  const graph = commitGraph([
    commit("a", ["b", "c"]),
    commit("b", ["d"]),
    commit("c", ["d"]),
    commit("d", []),
  ]);
  assert.equal(graph[0]?.edges.filter((e) => e.start === "node").length, 2);
  assert.equal(
    graph[0]?.edges.some((e) => e.start === "top"),
    false,
  );
  assert.equal(graph[2]?.edges.find((e) => e.start === "node")?.to, 0);
  assert.equal(graph[3]?.edges.filter((e) => e.end === "bottom").length, 0);
  assert.equal(
    graph.every((g) => g.width === 2),
    true,
  );
});
test("unrelated commits never receive an invented connecting edge", () => {
  const graph = commitGraph([commit("a", []), commit("b", [])]);
  assert.equal(graph[0]?.edges.length, 0);
  assert.equal(graph[1]?.edges.length, 0);
});
const note = {
  id: 1,
  body: "Проверь отмену запроса",
  author: { name: "Sam", username: "sam" },
  createdAt: "",
  updatedAt: "",
  system: false,
  resolvable: true,
  resolved: false,
  path: "src/api.ts",
  line: 10,
  outdated: false,
  webUrl: "",
};
test("threads group by file: files with open threads first, general comments last", () => {
  const thread = (
    id: number,
    path: string | null,
    resolved: boolean,
  ): Discussion => ({
    id: String(id),
    individual: false,
    resolvable: true,
    resolved,
    notes: [{ ...note, id, path, line: path ? 1 : null, resolved }],
  });
  const groups = groupByFile([
    thread(1, null, false),
    thread(2, "b.ts", true),
    thread(3, "z.ts", false),
    thread(4, "a.ts", true),
    thread(5, "z.ts", false),
  ]);
  assert.deepEqual(
    groups.map(([p, t]) => [p, t.length]),
    [
      ["z.ts", 2],
      ["", 1],
      ["a.ts", 1],
      ["b.ts", 1],
    ],
  );
});
test("discussion search includes replies and author names and excludes MR activity", () => {
  const items: Discussion[] = [
    {
      id: "a",
      notes: [
        note,
        {
          ...note,
          id: 2,
          body: "Fixed the timeout",
          author: { name: "Alex", username: "alex" },
        },
      ],
    },
    { id: "b", notes: [{ ...note, id: 3, system: true }] },
    { id: "c", notes: [{ ...note, id: 4, resolved: true, path: "src/ui.ts" }] },
  ];
  assert.deepEqual(
    filterThreads(items, "open", "timeout", "").map((i) => i.id),
    ["a"],
  );
  assert.deepEqual(
    filterThreads(items, "all", "Alex", "").map((i) => i.id),
    ["a"],
  );
  assert.deepEqual(
    filterThreads(items, "resolved", "", "src/ui.ts").map((i) => i.id),
    ["c"],
  );
  assert.equal(filterThreads(items, "all", "", "").length, 2);
});
test("overview uses direct GitLab status labels instead of recommendations", () => {
  assert.equal(mergeStatusLabel("ci_must_pass"), "Ожидание успешного CI");
  assert.equal(mergeStatusLabel("mergeable"), "Слияние доступно");
  assert.equal(mergeStatusLabel("custom_status"), "custom_status");
});

test("branch and MR pipeline lists are combined without duplicates, retaining MR provenance", () => {
  const p = { id: 7, projectId: 10, mrIid: 3, mrProjectId: 10 } as Pipeline;
  const rows = combinePipelines(
    [p],
    [{ ...p, mrIid: null, mrProjectId: null }],
    [{ ...p, id: 8 }],
  );
  assert.deepEqual(
    rows.map((p) => p.id),
    [8, 7],
  );
  assert.equal(rows[1]?.mrIid, 3);
});

test("review preview removes Markdown formatting but preserves readable text and code", () => {
  assert.equal(
    markdownPreview(
      "## **Важно**\n- [Документация](https://example.test) и `abort_signal`\n> ~~старый~~ *новый* подход",
    ),
    "Важно Документация и abort_signal старый новый подход",
  );
  assert.equal(
    markdownPreview("```suggestion\nreturn cancel_request();\n```"),
    "return cancel_request();",
  );
});
test("thread-level resolution is authoritative and plain comments have a separate category", () => {
  const base = { id: "thread", notes: [note] };
  assert.equal(
    threadState({
      ...base,
      individual: false,
      resolvable: true,
      resolved: true,
    }),
    "resolved",
  );
  assert.equal(
    threadState({
      ...base,
      individual: false,
      resolvable: true,
      resolved: false,
      notes: [{ ...note, resolved: true }],
    }),
    "open",
  );
  assert.equal(
    threadState({
      ...base,
      individual: true,
      resolvable: false,
      notes: [{ ...note, resolvable: false }],
    }),
    "comment",
  );
});
test("sync timestamp displays an explicit clock rather than perpetual just now", () => {
  assert.match(clockTime("2026-10-29T10:23:45Z"), /\d{2}:23:45/);
  assert.equal(clockTime("invalid"), "—");
});

test("Markdown preview retains literal generic types in inline code",()=>{
 assert.equal(markdownPreview('Use `List<Foo>` and <details><summary>details</summary>body</details>'),'Use List<Foo> and details body');
});
