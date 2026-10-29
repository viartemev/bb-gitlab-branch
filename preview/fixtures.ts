const now = new Date().toISOString();
const person = { name: "Алексей Петров", username: "alexey" };
export let scenario = "failed";
export function setScenario(value: string) {
  scenario = value;
}
const sha = "c43e9a71f026e99d09837d76b8f9abef71354902";
export const mr = {
  iid: 248,
  projectId: 10,
  title: "Исправить повторную обработку заказа при таймауте",
  state: "opened",
  draft: false,
  webUrl: "https://gitlab.example.test/team/orders/-/merge_requests/248",
  sourceBranch: "fix/order-retry-timeout",
  targetBranch: "develop",
  sha,
  author: person,
  reviewers: [
    { name: "Мария Смирнова", username: "maria" },
    { name: "Иван Козлов", username: "ivan" },
  ],
  labels: ["backend", "bug"],
  updatedAt: now,
};
export function pipeline() {
  return {
    id: 18342,
    projectId: 10,
    status:
      scenario === "ready"
        ? "success"
        : scenario === "running"
          ? "running"
          : "failed",
    sha,
    ref: mr.sourceBranch,
    source: "merge_request_event",
    webUrl: "https://gitlab.example.test/team/orders/-/pipelines/18342",
    createdAt: new Date(Date.now() - 18 * 60000).toISOString(),
    mrProjectId: 10,
    mrIid: 248,
  };
}
function note(id: number, body: string, options: any = {}) {
  return {
    id,
    body,
    author: { name: "Мария Смирнова", username: "maria" },
    createdAt: new Date(Date.now() - (id + 20) * 60000).toISOString(),
    updatedAt: now,
    system: false,
    resolvable: true,
    resolved: false,
    path: "src/orders/retry-handler.ts",
    line: 42,
    outdated: false,
    webUrl: `${mr.webUrl}#note_${id}`,
    ...options,
  };
}
const discussions = Array.from({ length: 65 }, (_, i) => ({
  id: `thread${i}`,
  notes: [
    note(
      i * 3 + 1,
      [
        "Нужно отменять предыдущий запрос перед повтором, иначе возможна двойная обработка заказа.",
        "А что произойдёт, если ответ придёт после истечения таймаута? Добавь тест на этот сценарий.",
        "Предлагаю вынести задержку в конфигурацию. Сейчас она дублируется в двух обработчиках.",
        "Здесь больше не нужен отдельный retry — его уже делает клиент.",
      ][i % 4]!,
      {
        resolved: i % 3 === 0,
        path:
          i % 4 === 1
            ? "tests/orders/retry.test.ts"
            : "src/orders/retry-handler.ts",
        line: 42 + i,
        outdated: i % 7 === 0,
      },
    ),
    ...(i % 2 === 0
      ? [
          note(
            i * 3 + 2,
            "Добавил отмену через AbortController и проверку повторного вызова.",
            { author: person, resolved: i % 3 === 0 },
          ),
          note(i * 3 + 3, "Спасибо! Проверю после зелёного CI.", {
            resolved: i % 3 === 0,
          }),
        ]
      : []),
  ],
}));
const events = [
  {
    id: "event1",
    notes: [
      note(999, "назначил(а) ревьюером Ивана Козлова", {
        system: true,
        author: person,
      }),
    ],
  },
  {
    id: "event2",
    notes: [
      note(1000, "добавил(а) 2 коммита", { system: true, author: person }),
    ],
  },
];
function jobs() {
  return [
    { id: 1, name: "dependencies", stage: "prepare", status: "success" },
    { id: 2, name: "docker-image", stage: "build", status: "success" },
    { id: 3, name: "typecheck", stage: "build", status: "success" },
    {
      id: 4,
      name: "unit-tests",
      stage: "test",
      status:
        scenario === "ready"
          ? "success"
          : scenario === "running"
            ? "running"
            : "failed",
    },
    {
      id: 5,
      name: "integration-tests",
      stage: "test",
      status: scenario === "running" ? "running" : "success",
    },
    { id: 6, name: "lint", stage: "test", status: "success" },
    {
      id: 7,
      name: "dependency-audit",
      stage: "security",
      status: scenario === "running" ? "pending" : "success",
    },
    {
      id: 8,
      name: "sast",
      stage: "security",
      status: scenario === "running" ? "created" : "success",
    },
    {
      id: 9,
      name: "review-app",
      stage: "deploy",
      status:
        scenario === "ready"
          ? "success"
          : scenario === "running"
            ? "created"
            : "skipped",
    },
    { id: 10, name: "production", stage: "deploy", status: "manual" },
  ].map((j) => ({
    ...j,
    duration: 34 + j.id * 6,
    webUrl: `https://gitlab.example.test/team/orders/-/jobs/${j.id}`,
    allowFailure: false,
    retried: false,
    artifacts: j.stage === "test" ? ["junit.xml"] : [],
  }));
}
export async function call(name: string, args: any): Promise<any> {
  await new Promise((r) => setTimeout(r, 40));
  if (name === "snapshot")
    return {
      outcome: "ready",
      message: "",
      checkout: {
        key: "sample",
        branch: mr.sourceBranch,
        remoteBranch: mr.sourceBranch,
        head: sha,
        upstreamHead: sha,
        dirty: scenario !== "ready",
        ahead: 0,
        behind: 0,
        hostname: "gitlab.example.test",
        projectPath: "commerce/backend/orders",
        projectId: 10,
      },
      mergeRequests: [mr],
      pipelines: [
        pipeline(),
        {
          ...pipeline(),
          id: 18321,
          status: "success",
          createdAt: new Date(Date.now() - 120 * 60000).toISOString(),
        },
      ],
      nextMrPage: null,
      nextPipelinePage: null,
      fetchedAt: now,
      warnings: [],
    };
  if (name === "mr")
    return {
      mr,
      description:
        "Исправляет повторную обработку заказа при медленном ответе сервиса оплаты.\n\nДобавлена отмена запросов, таймаут вынесен в конфигурацию и покрыт тестами.",
      mergeStatus:
        scenario === "ready"
          ? "mergeable"
          : scenario === "running"
            ? "ci_still_running"
            : "ci_must_pass",
      hasConflicts: false,
      discussionsResolved: scenario === "ready",
      assignees: [person],
      milestone: "Ноябрь 2026",
      changesCount: "8",
      approvals: {
        available: true,
        remaining: scenario === "ready" ? 0 : 1,
        approvedBy: [{ name: "Иван Козлов", username: "ivan" }],
        message: "",
      },
      headPipeline: pipeline(),
    };
  if (name === "jobs")
    return {
      items: jobs(),
      next: null,
      stageOrder: ["prepare", "build", "test", "security", "deploy"],
    };
  if (name === "pipelines") return { items: [pipeline()], next: null };
  if (name === "trace")
    return {
      text: "$ pnpm test --filter orders\n\n PASS  retry-handler.spec.ts (12 tests)\n FAIL  order-processing.spec.ts\n\n  × should cancel the first request before retry\n\n    Expected: 1 request\n    Received: 2 requests\n\n      42 | await processOrder(order)\n    > 43 | expect(requests).toHaveLength(1)\n         |                  ^\n\nTest Files  1 failed | 14 passed\nTests       1 failed | 127 passed\n\nERROR: Job failed: exit code 1",
      truncated: false,
      totalCharacters: 455,
    };
  if (name === "discussions") {
    const list = [...discussions, ...events],
      start = (args.page - 1) * 20;
    return {
      items: list.slice(start, start + 20),
      next: start + 20 < list.length ? args.page + 1 : null,
    };
  }
  if (name === "commits")
    return {
      items: [
        {
          id: sha,
          title: "Отменять запрос перед повторной отправкой",
          author: person.name,
          parentIds: ["b15e9a713"],
          createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
        },
        {
          id: "b15e9a713",
          title: "Merge branch 'develop' into fix/order-retry-timeout",
          author: person.name,
          parentIds: ["a81246f1", "df83b101"],
          createdAt: new Date(Date.now() - 50 * 60000).toISOString(),
        },
        {
          id: "a81246f1",
          title: "Добавить тест на повторную обработку заказа",
          author: person.name,
          parentIds: ["980d7c22"],
          createdAt: new Date(Date.now() - 70 * 60000).toISOString(),
        },
        {
          id: "df83b101",
          title: "Обновить клиент сервиса оплаты",
          author: "Иван Козлов",
          parentIds: ["980d7c22"],
          createdAt: new Date(Date.now() - 90 * 60000).toISOString(),
        },
        {
          id: "980d7c22",
          title: "Вынести таймаут в конфигурацию",
          author: person.name,
          parentIds: ["811fa022"],
          createdAt: new Date(Date.now() - 140 * 60000).toISOString(),
        },
        {
          id: "811fa022",
          title: "Добавить backoff для повторных запросов",
          author: "Мария Смирнова",
          parentIds: ["720adc11"],
          createdAt: new Date(Date.now() - 240 * 60000).toISOString(),
        },
      ].map((c) => ({
        ...c,
        webUrl: `https://gitlab.example.test/team/orders/-/commit/${c.id}`,
      })),
      next: null,
    };
  throw Error(`Unknown fixture ${name}`);
}
