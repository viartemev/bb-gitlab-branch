import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
registerHooks({
  load(url, ctx, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "export default {}", shortCircuit: true }
      : next(url, ctx);
  },
});
const checkout = {
  key: "checkout1",
  branch: "feature/task",
  remoteBranch: "feature/task",
  head: "local123",
  upstreamHead: "remote123",
  dirty: true,
  ahead: 1,
  behind: 0,
  hostname: "gitlab.example.test",
  projectPath: "team/project",
  projectId: 10,
};
const mr = {
  iid: 7,
  projectId: 10,
  title: "Feature checkout",
  state: "opened",
  draft: false,
  webUrl: "https://gitlab.example.test/team/project/-/merge_requests/7",
  sourceBranch: "feature/task",
  targetBranch: "main",
  sha: "remote123",
  author: { name: "Alex", username: "alex" },
  reviewers: [],
  labels: [],
  updatedAt: "2026-10-29T10:00:00Z",
};
const pipeline = {
  id: 50,
  projectId: 10,
  status: "failed",
  sha: "remote123",
  ref: "feature/task",
  source: "push",
  webUrl: "https://gitlab.example.test/team/project/-/pipelines/50",
  createdAt: "2026-10-29T10:00:00Z",
  mrProjectId: null,
  mrIid: null,
};
const snapshot = {
  outcome: "ready",
  message: "",
  checkout,
  mergeRequests: [mr],
  pipelines: [pipeline],
  nextMrPage: null,
  nextPipelinePage: null,
  fetchedAt: "2026-10-29T10:00:00Z",
  warnings: [],
};
const note = {
  id: 1,
  body: "**Check timeout handling**",
  author: { name: "Sam", username: "sam" },
  createdAt: "2026-10-29T10:00:00Z",
  updatedAt: "",
  system: false,
  resolvable: true,
  resolved: false,
  path: "src/api.ts",
  line: 15,
  outdated: false,
  webUrl: `${mr.webUrl}#note_1`,
};
test("compact panel supports stage graphs, persistent paginated reviews, search, logs and commit graph", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://bb.example.test",
  });
  Object.defineProperties(globalThis, {
    window: { value: dom.window, configurable: true },
    document: { value: dom.window.document, configurable: true },
    navigator: { value: dom.window.navigator, configurable: true },
    HTMLElement: { value: dom.window.HTMLElement, configurable: true },
    MutationObserver: {
      value: dom.window.MutationObserver,
      configurable: true,
    },
  });
  const { loadPluginApp, renderSlot } = await import(
    "@get-bb/plugin-sdk/testing/app"
  );
  const { fireEvent, waitFor } = await import("@testing-library/react");
  const app = await loadPluginApp(() => import("../app"));
  const { GitLabTab } = await import("../app");
  assert.equal(app.tabs[0]!.component, GitLabTab);
  assert.equal(app.threadActions[0]!.placement, "header");
  let version = 0;
  let traceReads = 0;
  const requestedPages: number[] = [];
  const slot = renderSlot(
    { component: GitLabTab },
    { threadId: "t1", environment: { id: "env1" } },
    {
      pluginId: "gitlab-branch",
      composer: {
        scope: { kind: "thread", threadId: "t1" },
        text: "Investigate",
      },
      rpc: {
        snapshot: () => ({
          ...snapshot,
          fetchedAt: `2026-10-29T10:00:0${version++}Z`,
        }),
        mr: () => ({
          mr,
          description: "Description",
          mergeStatus: "ci_must_pass",
          hasConflicts: false,
          discussionsResolved: false,
          assignees: [],
          milestone: null,
          changesCount: "3",
          approvals: {
            available: true,
            remaining: 1,
            approvedBy: [],
            message: "",
          },
          headPipeline: pipeline,
        }),
        discussions: (input) => {
          const page = (input as any).page;
          requestedPages.push(page);
          return page === 1
            ? {
                items: [
                  { id: "d1", notes: [{ ...note, resolved: true }] },
                  {
                    id: "event",
                    notes: [
                      {
                        ...note,
                        id: 99,
                        system: true,
                        body: "changed reviewer",
                      },
                    ],
                  },
                ],
                next: 2,
              }
            : {
                items: [
                  {
                    id: "d2",
                    notes: [
                      { ...note, id: 2, body: "Handle cancellation" },
                      {
                        ...note,
                        id: 3,
                        body: "Added abort signal",
                        author: { name: "Alex", username: "alex" },
                      },
                    ],
                  },
                ],
                next: null,
              };
        },
        pipelines: () => ({ items: [pipeline], next: null }),
        jobs: () => ({
          items: [
            {
              id: 59,
              name: "compile",
              stage: "build",
              status: "success",
              duration: 5,
              webUrl: "",
              allowFailure: false,
              retried: false,
              artifacts: [],
            },
            {
              id: 60,
              name: "unit",
              stage: "test",
              status: "failed",
              duration: 10,
              webUrl: "https://gitlab.example.test/job/60",
              allowFailure: false,
              retried: false,
              artifacts: ["report.xml"],
            },
          ],
          next: null,
          stageOrder: ["build", "test"],
        }),
        trace: () =>
          ++traceReads === 1
            ? {
                text: "",
                truncated: false,
                totalCharacters: 0,
                state: "unavailable",
                message:
                  "GitLab сообщает о сохранённом логе, но API вернул пустой ответ.",
              }
            : {
                text: "Test failed: timeout",
                truncated: false,
                totalCharacters: 20,
                state: "available",
                message: "",
              },
        commits: () => ({
          items: [
            {
              id: "remote123",
              title: "Fix checkout",
              author: "Alex",
              createdAt: "",
              webUrl: "",
              parentIds: ["previous"],
            },
            {
              id: "previous",
              title: "Initial checkout",
              author: "Sam",
              createdAt: "",
              webUrl: "",
              parentIds: [],
            },
          ],
          next: null,
        }),
      },
    },
  );
  try {
    await slot.findByText("Ожидание успешного CI");
    assert.equal(Boolean(slot.queryByText("Нужно исправить CI")), false);
    assert.ok(slot.getByText(/Синхронизация:/));
    assert.ok(slot.getByText(/MR remote12/));
    assert.equal(
      slot.getByText("Description").closest("details")?.open,
      false,
      "description starts collapsed",
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Обсудить MR с агентом" }),
    );
    await waitFor(() => assert.match(slot.inspection.composer.text, /MR !7/));
    fireEvent.click(slot.getByRole("button", { name: "Обсуждения" }));
    await slot.findByText("Check timeout handling");
    fireEvent.click(slot.getByRole("button", { name: /Не решены/ }));
    assert.equal(slot.queryByText("Check timeout handling"), null);
    fireEvent.click(slot.getAllByRole("button", { name: "Загрузить все" })[0]!);
    await slot.findByText("Handle cancellation");
    await slot.findByText("Added abort signal");
    const textarea = slot.getByRole("textbox", { name: "Поиск обсуждений" });
    fireEvent.change(textarea, { target: { value: "abort signal" } });
    assert.ok(slot.getByText("Added abort signal"));
    fireEvent.click(slot.getByRole("button", { name: "Обновить GitLab" }));
    await waitFor(() =>
      assert.equal(requestedPages.filter((p) => p === 2).length, 2),
    );
    assert.equal((textarea as HTMLInputElement).value, "abort signal");
    assert.ok(
      slot.getByText("Added abort signal"),
      "refresh preserves expanded replies",
    );
    const agentButtons = slot.getAllByRole("button", {
      name: "В запрос агенту",
    });
    fireEvent.click(agentButtons[0]!);
    await waitFor(() =>
      assert.match(slot.inspection.composer.text, /src\/api.ts:15/),
    );
    assert.equal(slot.queryByText("Системные события"), null);
    assert.ok(slot.getByText(/История MR/));
    fireEvent.click(slot.getByRole("button", { name: "CI/CD" }));
    await slot.findByRole("region", { name: "Стадия build" });
    const stages = slot.container.querySelectorAll(".gl-stage-heading strong");
    assert.deepEqual(
      [...stages].map((n) => n.textContent),
      ["build", "test"],
    );
    fireEvent.click(slot.getByRole("button", { name: "unit" }));
    await slot.findByText(/API вернул пустой ответ/);
    assert.equal(
      Boolean(slot.queryByRole("button", { name: "Разобрать с агентом" })),
      false,
    );
    fireEvent.click(slot.getByRole("button", { name: "Обновить лог" }));
    await slot.findByText("Test failed: timeout");
    fireEvent.click(slot.getByRole("button", { name: "Разобрать с агентом" }));
    await waitFor(() =>
      assert.match(
        slot.inspection.composer.text,
        /pipeline #50, SHA remote123/,
      ),
    );
    fireEvent.click(slot.getByRole("button", { name: "Коммиты" }));
    await slot.findByText("Fix checkout");
    assert.equal(slot.container.querySelectorAll(".gl-commit-node").length, 2);
    assert.equal(
      slot.container.querySelectorAll(".gl-commit-graph path").length,
      2,
    );
    assert.equal(slot.inspection.composer.submits.length, 0);
    assert.equal(slot.inspection.navigateCalls.length, 0);
  } finally {
    slot.lifecycle.unmount();
    dom.window.close();
  }
});

test("MR pipeline status waits for MR data and stays stable during refresh", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://bb.example.test",
  });
  for (const name of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "MutationObserver",
  ])
    Object.defineProperty(globalThis, name, {
      value: name === "window" ? dom.window : (dom.window as any)[name],
      configurable: true,
    });
  const { renderSlot } = await import("@get-bb/plugin-sdk/testing/app");
  const { fireEvent, waitFor, act } = await import("@testing-library/react");
  const { GitLabTab } = await import("../app");
  let finishMr!: (value: any) => void;
  let failMr!: (reason: Error) => void;
  let mrReads = 0;
  let snapshots = 0;
  const jobRequests: any[] = [];
  const mrPipeline = {
    ...pipeline,
    id: 51,
    status: "manual",
    source: "merge_request_event",
    mrProjectId: 10,
    mrIid: 7,
  };
  const detail = {
    mr,
    description: "",
    mergeStatus: "ci_must_pass",
    hasConflicts: false,
    discussionsResolved: true,
    assignees: [],
    milestone: null,
    changesCount: "1",
    approvals: { available: true, remaining: 0, approvedBy: [], message: "" },
    headPipeline: mrPipeline,
  };
  const slot = renderSlot(
    { component: GitLabTab },
    { threadId: "t1", environment: { id: "env1" } },
    {
      pluginId: "gitlab-branch",
      rpc: {
        snapshot: () => ({
          ...snapshot,
          fetchedAt: `2026-10-29T10:00:0${snapshots++}Z`,
        }),
        mr: () => {
          mrReads++;
          return new Promise((resolve, reject) => {
            finishMr = resolve;
            failMr = reject;
          });
        },
        pipelines: () => ({ items: [mrPipeline], next: null }),
        jobs: (input) => {
          jobRequests.push(input);
          return { items: [], next: null, stageOrder: [] };
        },
      },
    },
  );
  try {
    await waitFor(() => assert.equal(mrReads, 1));
    assert.ok(slot.getByText("Загружаем…"));
    assert.equal(slot.queryByText("Ошибка"), null);
    assert.equal(
      jobRequests.length,
      0,
      "never load jobs for a provisional branch pipeline",
    );
    fireEvent.click(slot.getByRole("button", { name: "CI/CD" }));
    await slot.findByText("Загружаем пайплайны MR…");
    assert.equal(
      slot.queryByRole("combobox", { name: "Выбрать пайплайн" }),
      null,
    );
    assert.equal(jobRequests.length, 0);
    await act(async () => finishMr(detail));
    await waitFor(() => assert.ok(jobRequests.length > 0));
    assert.ok(
      jobRequests.every(
        (r) => r.pipelineId === 51 && r.mrProjectId === 10 && r.mrIid === 7,
      ),
    );
    assert.equal(
      (
        slot.getByRole("combobox", {
          name: "Выбрать пайплайн",
        }) as HTMLSelectElement
      ).value,
      "10:51",
    );
    fireEvent.click(slot.getByRole("button", { name: "Обзор" }));
    await slot.findAllByText("#51");
    fireEvent.click(slot.getByRole("button", { name: "Обновить GitLab" }));
    await waitFor(() => assert.equal(mrReads, 2));
    assert.ok(
      slot.getAllByText("#51").length,
      "keep the last known MR pipeline while refreshing",
    );
    assert.equal(slot.queryByText("#50"), null);
    await act(async () => failMr(new Error("GitLab unavailable")));
    await slot.findByText("GitLab unavailable");
    assert.ok(
      slot.getAllByText("#51").length,
      "a failed refresh cannot replace the MR pipeline with a branch pipeline",
    );
  } finally {
    slot.lifecycle.unmount();
    dom.window.close();
  }
});
