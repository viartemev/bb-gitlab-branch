import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  useRpc,
  useComposer,
  Markdown,
  UrlLink,
  experimental_useTabVisible,
  type ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, codeContextOutput } from "./contract";
import type { z } from "zod";
import type {
  Snapshot,
  MergeRequest,
  MrDetail,
  Pipeline,
  Discussion,
  Job,
  Commit,
  Checkout,
} from "./model";
import {
  statusInfo,
  mergeStatusLabel,
  markdownPreview,
  clockTime,
  latestJobs,
  groupStages,
  pipelineIdentity,
  combinePipelines,
  threadNotes,
  threadState,
  filterThreads,
  groupByFile,
  relativeTime,
  commitGraph,
  countLabel,
  type Tone,
} from "./ui";
import { usePages } from "./use-pages";
import "./app.css";

const short = (sha: string | null) => sha?.slice(0, 8) ?? "—";
const fullDate = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("ru")
    : "";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Tab = "overview" | "discussions" | "pipelines" | "commits";
type Context = { threadId: string; contextKey: string; refresh: string };
type CodeContextResult = z.infer<typeof codeContextOutput>;

export function Glyph({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const paths: Record<string, ReactNode> = {
    check: <path d="m5 12 4 4 10-10" />,
    x: <path d="m6 6 12 12M6 18 18 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    spin: <path d="M20 12a8 8 0 1 1-8-8" />,
    circle: <circle cx="12" cy="12" r="7" />,
    slash: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m6 18 12-12" />
      </>
    ),
    skip: (
      <>
        <path d="m7 7 7 5-7 5ZM17 6v12" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    alert: (
      <>
        <path d="m12 3 10 18H2ZM12 9v4M12 17h.01" />
      </>
    ),
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10M18 8c0 6-12 2-12 7" />
      </>
    ),
    merge: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="5" r="2" />
        <path d="M6 7v10M18 7c0 4-12 4-12 8" />
      </>
    ),
    message: (
      <path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" />
    ),
    refresh: (
      <>
        <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7M21 3l-11 11M10 3H4v17h16v-6" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    arrow: <path d="M3 12h18m-6-6 6 6-6 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    code: (
      <>
        <path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18" />
      </>
    ),
  };
  return (
    <svg
      className={`gl-icon ${name === "spin" ? "gl-spin" : ""} ${className}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.circle}
    </svg>
  );
}
function Status({
  value,
  label,
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const info = statusInfo(value);
  return (
    <span
      className={`gl-status gl-tone-${info.tone}`}
      title={compact ? undefined : info.label}
    >
      <Glyph name={info.symbol} />
      {!compact && <span>{label ?? info.label}</span>}
    </span>
  );
}
function Link({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return href ? (
    <UrlLink
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </UrlLink>
  ) : (
    <span className={className}>{children}</span>
  );
}
function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return text ? (
    <div role="alert" className="gl-error">
      <Glyph name="alert" />
      <span>{text}</span>
      {retry && <button onClick={retry}>Повторить</button>}
    </div>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="gl-empty">{children}</div>;
}
function Time({ value }: { value: string }) {
  return (
    <time dateTime={value} title={fullDate(value)}>
      {relativeTime(value)}
    </time>
  );
}
function Pages({
  state,
  noun = "записей",
  all = false,
}: {
  state: {
    items: unknown[];
    next: number | null;
    busy: boolean;
    all: boolean;
    error: string;
    more(): void;
    loadAll(): void;
    retry(): void;
    stop(): void;
  };
  noun?: string;
  all?: boolean;
}) {
  return (
    <>
      <ErrorBox text={state.error} retry={state.retry} />
      <div className="gl-page-footer">
        <span className="gl-muted" role="status">
          {state.busy && <Glyph name="spin" />} {state.items.length} {noun}
          {state.next !== null ? "+" : ""}
          {state.busy ? " · загружаем…" : ""}
        </span>
        {state.busy && state.all ? (
          <button onClick={state.stop}>Остановить</button>
        ) : (
          state.next !== null && (
            <div className="gl-row">
              <button disabled={state.busy} onClick={state.more}>
                Ещё 20
              </button>
              {all && (
                <button disabled={state.busy} onClick={state.loadAll}>
                  Загрузить все
                </button>
              )}
            </div>
          )
        )}
      </div>
    </>
  );
}

export function GitLabTab(props: ExperimentalThreadTabProps) {
  return (
    <BranchPanel
      key={`${props.threadId}:${props.environment?.id}`}
      {...props}
    />
  );
}
function BranchPanel({ threadId, environment }: ExperimentalThreadTabProps) {
  const rpc = useRpc<typeof rpcContract>(),
    visible = experimental_useTabVisible();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview"),
    [selected, setSelected] = useState("");
  const [mrPage, setMrPage] = useState(1);
  const generation = useRef(0),
    loading = useRef(false),
    previousKey = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (!environment || loading.current) return;
    const token = ++generation.current;
    loading.current = true;
    setBusy(true);
    try {
      const next = await rpc.call("snapshot", {
        threadId,
        mrPage,
        pipelinePage: 1,
      });
      if (token !== generation.current) return;
      const key = next.checkout?.key ?? next.outcome;
      if (previousKey.current !== key) {
        previousKey.current = key;
        setMrPage(1);
        setSelected("");
      }
      setSnapshot(next);
      setError("");
      setSelected((old) =>
        next.mergeRequests.some((m) => `${m.projectId}:${m.iid}` === old)
          ? old
          : (() => {
              const mr =
                next.mergeRequests.find((m) => m.state === "opened") ??
                next.mergeRequests[0];
              return mr ? `${mr.projectId}:${mr.iid}` : "";
            })(),
      );
    } catch (e) {
      if (token === generation.current) setError(message(e));
    } finally {
      if (token === generation.current) {
        loading.current = false;
        setBusy(false);
      }
    }
  }, [rpc, threadId, environment?.id, mrPage]);
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const tick = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      generation.current++;
      loading.current = false;
    };
  }, [visible, refresh]);
  const c = snapshot?.checkout;
  const mr =
    snapshot?.mergeRequests.find(
      (m) => `${m.projectId}:${m.iid}` === selected,
    ) ?? null;
  const identity = c && mr ? `${c.key}:${mr.projectId}:${mr.iid}` : "";
  const [mrState, setMrState] = useState<{
    identity: string;
    detail: MrDetail | null;
    error: string;
  }>({ identity: "", detail: null, error: "" });
  useEffect(() => {
    let alive = true;
    if (!c || !mr) return;
    void rpc
      .call("mr", {
        threadId,
        key: c.key,
        projectId: mr.projectId,
        iid: mr.iid,
      })
      .then(
        (detail) => {
          if (alive) setMrState({ identity, detail, error: "" });
        },
        (e) => {
          if (alive)
            setMrState((s) => ({
              identity,
              detail: s.identity === identity ? s.detail : null,
              error: message(e),
            }));
        },
      );
    return () => {
      alive = false;
    };
  }, [rpc, threadId, identity, snapshot?.fetchedAt]);
  const detail = mrState.identity === identity ? mrState.detail : null;
  const context: Context = {
    threadId,
    contextKey: c?.key ?? "",
    refresh: snapshot?.fetchedAt ?? "",
  };
  // A branch pipeline is not a provisional MR pipeline: wait for the selected
  // MR before showing a status or requesting jobs with its provenance.
  const mrError = mrState.identity === identity ? mrState.error : "";
  const pipelineLoading = Boolean(mr && !detail && !mrError);
  const latest = mr
    ? (detail?.headPipeline ?? null)
    : (snapshot?.pipelines[0] ?? null);
  return (
    <section className="gl-panel" aria-label="GitLab текущей ветки">
      <header className="gl-topbar">
        <div className="gl-topbar-title">
          <Glyph name="branch" />
          <strong>{c?.branch ?? "GitLab"}</strong>
        </div>
        <button
          className="gl-icon-button"
          aria-label="Обновить GitLab"
          title="Обновить · автоматически каждые 30 секунд"
          disabled={busy || !environment}
          onClick={() => void refresh()}
        >
          <Glyph name={busy ? "spin" : "refresh"} />
        </button>
      </header>
      {c && (
        <div className="gl-repo-row">
          <Link href={`https://${c.hostname}/${c.projectPath}`}>
            {c.projectPath}
          </Link>
          <code title={`Локальный HEAD: ${c.head}`}>{short(c.head)}</code>
        </div>
      )}
      <ErrorBox text={error} retry={() => void refresh()} />
      {!environment && <Empty>Откройте тред с рабочим Git-репозиторием.</Empty>}
      {!snapshot && busy && (
        <Empty>
          <Glyph name="spin" /> Подключаемся к GitLab…
        </Empty>
      )}
      {snapshot?.message && <Empty>{snapshot.message}</Empty>}
      {snapshot?.warnings.map((w) => (
        <ErrorBox key={w} text={w} />
      ))}
      {c && snapshot && (
        <>
          <div className="gl-mr-strip">
            {mr ? (
              <>
                <Link href={mr.webUrl}>!{mr.iid}</Link>
                <Status value={mr.state} />
                <span
                  className="gl-target"
                  title={`${mr.sourceBranch} → ${mr.targetBranch}`}
                >
                  <Glyph name="arrow" />
                  {mr.targetBranch}
                </span>
                {mr.draft && <span className="gl-tag">Черновик</span>}
              </>
            ) : (
              <span className="gl-muted">У ветки пока нет MR</span>
            )}
            {(snapshot.mergeRequests.length > 1 ||
              mrPage > 1 ||
              snapshot.nextMrPage) && (
              <details className="gl-mr-picker">
                <summary>Другой MR</summary>
                <label>
                  Merge Request
                  <select
                    aria-label="Merge Request"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {snapshot.mergeRequests.map((m) => (
                      <option
                        key={`${m.projectId}:${m.iid}`}
                        value={`${m.projectId}:${m.iid}`}
                      >
                        !{m.iid} · {m.title} · {statusInfo(m.state).label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="gl-row">
                  <button
                    disabled={busy || mrPage === 1}
                    onClick={() => setMrPage((p) => p - 1)}
                  >
                    Назад
                  </button>
                  <span className="gl-muted">Стр. {mrPage}</span>
                  <button
                    disabled={busy || !snapshot.nextMrPage}
                    onClick={() => setMrPage(snapshot.nextMrPage!)}
                  >
                    Далее
                  </button>
                </div>
              </details>
            )}
          </div>
          <nav className="gl-tabs" aria-label="Разделы GitLab">
            {(
              [
                ["overview", "Обзор"],
                ["pipelines", "CI/CD"],
                ["discussions", "Обсуждения"],
                ["commits", "Коммиты"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
                {id === "pipelines" && latest && (
                  <Status value={latest.status} compact />
                )}
                {id === "discussions" &&
                  detail &&
                  !detail.discussionsResolved && (
                    <span
                      className="gl-attention-dot"
                      title="Есть нерешённые замечания"
                    />
                  )}
              </button>
            ))}
          </nav>
          <div className="gl-content" key={c.key}>
            <ErrorBox
              text={mrState.identity === identity ? mrState.error : ""}
              retry={() => void refresh()}
            />
            {tab === "overview" && (
              <Overview
                {...context}
                checkout={c}
                mr={mr}
                detail={detail}
                latest={latest}
                pipelineLoading={pipelineLoading}
                go={setTab}
              />
            )}
            {tab === "pipelines" && pipelineLoading && (
              <Empty>
                <Glyph name="spin" /> Загружаем пайплайны MR…
              </Empty>
            )}
            {tab === "pipelines" && (!mr || detail) && (
              <Pipelines
                key={identity || c.key}
                {...context}
                checkout={c}
                mr={mr}
                detail={detail}
                snapshot={snapshot}
              />
            )}
            {tab === "discussions" &&
              (mr ? (
                <Discussions key={identity} {...context} mr={mr} />
              ) : (
                <Empty>Обсуждения появятся в Merge Request.</Empty>
              ))}
            {tab === "commits" && <Commits {...context} head={c.head} />}
          </div>
          <footer className="gl-sync">
            <span className={`gl-sync-dot ${error ? "gl-sync-error" : ""}`} />
            <span>
              {error ? "Последняя синхронизация" : "Синхронизация"}:{" "}
              <time
                dateTime={snapshot.fetchedAt}
                title={fullDate(snapshot.fetchedAt)}
              >
                {clockTime(snapshot.fetchedAt)}
              </time>{" "}
              · авто 30 с
            </span>
          </footer>
        </>
      )}
    </section>
  );
}

function Overview({
  checkout: c,
  mr,
  detail,
  latest,
  pipelineLoading,
  go,
  ...ctx
}: Context & {
  checkout: Checkout;
  mr: MergeRequest | null;
  detail: MrDetail | null;
  latest: Pipeline | null;
  pipelineLoading: boolean;
  go: (tab: Tab) => void;
}) {
  const composer = useComposer();
  return (
    <>
      {mr && <h1 className="gl-mr-title">{mr.title}</h1>}
      {!mr && (
        <Empty>
          Создайте MR в GitLab, чтобы видеть ревью и готовность к слиянию. CI и
          история ветки уже доступны.
        </Empty>
      )}
      <div className="gl-summary-list">
        {detail && (
          <div className="gl-summary-row">
            <span>
              <Glyph name="merge" />
              Слияние
            </span>
            <span
              className={
                detail.hasConflicts ||
                !["mergeable", "can_be_merged"].includes(detail.mergeStatus)
                  ? "gl-tone-warn"
                  : ""
              }
            >
              {detail.hasConflicts
                ? "Конфликты"
                : mergeStatusLabel(detail.mergeStatus)}
            </span>
          </div>
        )}
        <button className="gl-summary-row" onClick={() => go("pipelines")}>
          <span>
            <Glyph name="play" />
            Пайплайн
          </span>
          <span>
            {latest ? (
              <>
                <Status value={latest.status} />
                <code>#{latest.id}</code>
              </>
            ) : pipelineLoading ? (
              "Загружаем…"
            ) : mr && !detail ? (
              "Нет данных"
            ) : (
              "Нет запусков"
            )}
            <Glyph name="chevron" />
          </span>
        </button>
        {detail && (
          <>
            <button
              className="gl-summary-row"
              onClick={() => go("discussions")}
            >
              <span>
                <Glyph name="message" />
                Блокирующие обсуждения
              </span>
              <span
                className={
                  !detail.discussionsResolved ? "gl-tone-warn" : "gl-muted"
                }
              >
                {detail.discussionsResolved ? "Нет" : "Не решены · открыть"}
                <Glyph name="chevron" />
              </span>
            </button>
            <div className="gl-summary-row">
              <span>
                <Glyph name="check" />
                Одобрения
              </span>
              <span>
                {detail.approvals.available
                  ? `${detail.approvals.approvedBy.length} получено${detail.approvals.remaining !== null ? ` · осталось ${detail.approvals.remaining}` : ""}`
                  : "Недоступны"}
              </span>
            </div>
          </>
        )}
      </div>
      {(c.dirty ||
        (c.ahead !== null && c.ahead > 0) ||
        (mr?.sha && mr.sha !== c.head)) && (
        <div className="gl-local-notice">
          <Glyph name="code" />
          <div>
            <strong>Рабочая копия</strong>
            <span>
              {[
                c.dirty ? "Есть изменения в файлах" : "",
                c.ahead
                  ? `${countLabel(c.ahead, ["коммит", "коммита", "коммитов"])} не отправлено`
                  : "",
                mr?.sha && mr.sha !== c.head
                  ? `MR ${short(mr.sha)} · локально ${short(c.head)}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      )}
      {latest && (
        <div className="gl-overview-pipeline">
          <div className="gl-section-heading">
            <h2>Последний запуск</h2>
            <button className="gl-text-button" onClick={() => go("pipelines")}>
              Все пайплайны <Glyph name="chevron" />
            </button>
          </div>
          <PipelineGraph
            key={pipelineIdentity(latest)}
            {...ctx}
            pipeline={latest}
            head={c.head}
            dirty={c.dirty}
            compact
            onExpand={() => go("pipelines")}
          />
        </div>
      )}
      {detail && (
        <details className="gl-fold">
          <summary>
            Описание и участники{" "}
            <span className="gl-muted">
              {detail.changesCount ? `${detail.changesCount} файлов` : ""}
            </span>
          </summary>
          <div className="gl-fold-body">
            <dl>
              <dt>Автор</dt>
              <dd>{detail.mr.author.name}</dd>
              <dt>Ревьюеры</dt>
              <dd>
                {detail.mr.reviewers.map((p) => p.name).join(", ") ||
                  "Не назначены"}
              </dd>
              {detail.assignees.length > 0 && (
                <>
                  <dt>Исполнители</dt>
                  <dd>{detail.assignees.map((p) => p.name).join(", ")}</dd>
                </>
              )}
              {detail.approvals.approvedBy.length > 0 && (
                <>
                  <dt>Одобрили</dt>
                  <dd>
                    {detail.approvals.approvedBy.map((p) => p.name).join(", ")}
                  </dd>
                </>
              )}
              {detail.milestone && (
                <>
                  <dt>Milestone</dt>
                  <dd>{detail.milestone}</dd>
                </>
              )}
              {detail.mr.labels.length > 0 && (
                <>
                  <dt>Метки</dt>
                  <dd>
                    {detail.mr.labels.map((l) => (
                      <span key={l} className="gl-tag">
                        {l}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
            {detail.description ? (
              <Markdown content={detail.description} />
            ) : (
              <p className="gl-muted">Описание не заполнено.</p>
            )}
          </div>
        </details>
      )}
      {mr && (
        <div className="gl-bottom-actions">
          <button
            onClick={() =>
              composer.insert(
                `Разбери GitLab MR !${mr.iid}: ${mr.webUrl}\n${mr.sourceBranch} → ${mr.targetBranch}; SHA ${mr.sha}.\n${detail?.description.slice(0, 12000) ?? ""}${(detail?.description.length ?? 0) > 12000 ? "\n[Описание сокращено]" : ""}`,
                { at: "end", block: true },
              )
            }
          >
            <Glyph name="message" />
            Обсудить MR с агентом
          </button>
          <Link href={mr.webUrl}>
            Открыть в GitLab <Glyph name="external" />
          </Link>
        </div>
      )}
    </>
  );
}

function Pipelines({
  checkout,
  mr,
  detail,
  snapshot,
  ...ctx
}: Context & {
  checkout: Checkout;
  mr: MergeRequest | null;
  detail: MrDetail | null;
  snapshot: Snapshot;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(
    (page: number) =>
      mr
        ? rpc.call("pipelines", {
            threadId: ctx.threadId,
            key: ctx.contextKey,
            projectId: mr.projectId,
            iid: mr.iid,
            page,
          })
        : Promise.resolve({ items: [] as Pipeline[], next: null }),
    [rpc, ctx.threadId, ctx.contextKey, mr?.projectId, mr?.iid],
  );
  const mrPipelines = usePages<Pipeline>(load, ctx.refresh);
  const [extra, setExtra] = useState<Pipeline[]>([]),
    [next, setNext] = useState(snapshot.nextPipelinePage),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const items = combinePipelines(
    detail?.headPipeline ? [detail.headPipeline] : [],
    mrPipelines.items,
    snapshot.pipelines,
    extra,
  );
  const [selected, setSelected] = useState("");
  const selectedPipeline =
    items.find((p) => pipelineIdentity(p) === selected) ??
    detail?.headPipeline ??
    items[0];
  async function moreBranch() {
    if (!next || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await rpc.call("snapshot", {
        threadId: ctx.threadId,
        mrPage: 1,
        pipelinePage: next,
      });
      if (!alive.current) return;
      if (result.checkout?.key !== ctx.contextKey)
        throw new Error("Ветка изменилась. Обновите панель.");
      setExtra((old) => combinePipelines(result.pipelines, old));
      setNext(result.nextPipelinePage);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="gl-section-heading">
        <h2>
          Пайплайны{" "}
          <span className="gl-count">
            {items.length}
            {next || mrPipelines.next ? "+" : ""}
          </span>
        </h2>
        <span className="gl-muted">ветка и MR вместе</span>
      </div>
      {items.length > 0 && (
        <label className="gl-pipeline-select">
          <span className="gl-sr-only">Выбрать пайплайн</span>
          <select
            aria-label="Выбрать пайплайн"
            value={selectedPipeline ? pipelineIdentity(selectedPipeline) : ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {items.map((p) => (
              <option key={pipelineIdentity(p)} value={pipelineIdentity(p)}>
                #{p.id} · {statusInfo(p.status).label} · {short(p.sha)} ·{" "}
                {fullDate(p.createdAt)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedPipeline ? (
        <PipelineGraph
          key={pipelineIdentity(selectedPipeline)}
          {...ctx}
          pipeline={selectedPipeline}
          head={checkout.head}
          dirty={checkout.dirty}
        />
      ) : (
        <Empty>
          {mrPipelines.busy
            ? "Загружаем пайплайны…"
            : "У этой ветки ещё нет пайплайнов."}
        </Empty>
      )}
      <ErrorBox text={error} retry={() => void moreBranch()} />
      <ErrorBox text={mrPipelines.error} retry={mrPipelines.retry} />
      {(next || mrPipelines.next) && (
        <details className="gl-fold">
          <summary>Более ранние запуски</summary>
          <div className="gl-row gl-fold-body">
            {next && (
              <button disabled={busy} onClick={() => void moreBranch()}>
                {busy ? "Загрузка…" : "Ещё 20 из ветки"}
              </button>
            )}
            {mrPipelines.next && (
              <button disabled={mrPipelines.busy} onClick={mrPipelines.more}>
                Ещё 20 из MR
              </button>
            )}
          </div>
        </details>
      )}
    </>
  );
}

function PipelineGraph({
  pipeline,
  head,
  dirty,
  compact = false,
  onExpand,
  ...ctx
}: Context & {
  pipeline: Pipeline;
  head: string | null;
  dirty: boolean;
  compact?: boolean;
  onExpand?: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>(),
    composer = useComposer();
  const graphRef = useRef<HTMLDivElement>(null);
  const load = useCallback(
    (page: number) =>
      rpc.call("jobs", {
        threadId: ctx.threadId,
        key: ctx.contextKey,
        projectId: pipeline.projectId,
        pipelineId: pipeline.id,
        page,
        mrProjectId: pipeline.mrProjectId,
        mrIid: pipeline.mrIid,
      }),
    [
      rpc,
      ctx.threadId,
      ctx.contextKey,
      pipeline.projectId,
      pipeline.id,
      pipeline.mrProjectId,
      pipeline.mrIid,
    ],
  );
  const jobs = usePages<Job>(load, ctx.refresh, true),
    stages = groupStages(jobs.items, jobs.stageOrder ?? []);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null),
    [log, setLog] = useState<{
      text: string;
      truncated: boolean;
      state?: string;
      message?: string;
    } | null>(null),
    [logBusy, setLogBusy] = useState(false),
    [logError, setLogError] = useState("");
  const seq = useRef(0);
  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );
  async function selectJob(job: Job, force = false) {
    if (!force && selectedJob?.id === job.id) {
      seq.current++;
      setSelectedJob(null);
      setLog(null);
      setLogBusy(false);
      return;
    }
    const token = ++seq.current;
    setSelectedJob(job);
    setLog(null);
    setLogError("");
    setLogBusy(true);
    try {
      const response = await rpc.call("trace", {
        threadId: ctx.threadId,
        key: ctx.contextKey,
        projectId: pipeline.projectId,
        pipelineId: pipeline.id,
        jobId: job.id,
        mrProjectId: pipeline.mrProjectId,
        mrIid: pipeline.mrIid,
      });
      if (token === seq.current) setLog(response);
    } catch (e) {
      if (token === seq.current) setLogError(message(e));
    } finally {
      if (token === seq.current) setLogBusy(false);
    }
  }
  const failed = latestJobs(jobs.items).filter(
    (j) => j.status === "failed" && !j.allowFailure,
  );
  return (
    <div className={`gl-pipeline-view ${compact ? "gl-pipeline-compact" : ""}`}>
      <div className="gl-pipeline-heading">
        <Status value={pipeline.status} />
        <Link href={pipeline.webUrl}>
          #{pipeline.id} <Glyph name="external" />
        </Link>
        <span className="gl-muted">
          <Time value={pipeline.createdAt} />
        </span>
      </div>
      <div className="gl-pipeline-meta">
        <code>{short(pipeline.sha)}</code>
        <span>
          {pipeline.source === "merge_request_event"
            ? "Merge Request"
            : pipeline.source === "push"
              ? "Push"
              : pipeline.source}
        </span>
        <span
          className="gl-muted"
          title={
            pipeline.sha !== head
              ? "Другой SHA, чем локальный HEAD"
              : dirty
                ? "Локальные изменения не проверены"
                : "Запущен для локального HEAD"
          }
        >
          {pipeline.sha !== head
            ? "Другой SHA"
            : dirty
              ? "Без локальных изменений"
              : "Текущий HEAD"}
        </span>
      </div>
      <ErrorBox text={jobs.error} retry={jobs.retry} />
      {jobs.busy && (
        <div className="gl-loading-line" role="status">
          <Glyph name="spin" />
          Загружаем задачи{jobs.items.length ? ` · ${jobs.items.length}` : ""}…
        </div>
      )}
      {stages.length > 0 && (
        <div
          className={`gl-stage-map ${jobs.stageOrder?.length ? "gl-stage-ordered" : ""}`}
          aria-label="Краткое состояние стадий"
        >
          {stages.map((stage, index) => (
            <button
              className="gl-stage-step"
              key={stage.name}
              aria-label={`Показать стадию ${stage.name}: ${statusInfo(stage.status).label}`}
              onClick={() => {
                if (onExpand) onExpand();
                else
                  graphRef.current
                    ?.querySelectorAll<HTMLElement>(".gl-stage")
                    [
                      index
                    ]?.scrollIntoView?.({ block: "nearest", inline: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
              }}
            >
              <Status value={stage.status} compact />
              <span>{stage.name}</span>
            </button>
          ))}
        </div>
      )}
      {!compact && stages.length > 0 && (
        <div
          ref={graphRef}
          className="gl-stage-scroll"
          tabIndex={0}
          aria-label="Стадии пайплайна"
        >
          <div
            className={`gl-stage-graph ${jobs.stageOrder?.length ? "gl-stage-ordered" : ""}`}
          >
            {stages.map((stage) => (
              <section
                className="gl-stage"
                key={stage.name}
                aria-label={`Стадия ${stage.name}`}
              >
                <div className="gl-stage-heading">
                  <Status value={stage.status} compact />
                  <strong>{stage.name}</strong>
                  <span className="gl-count">{stage.jobs.length || ""}</span>
                </div>
                <div className="gl-stage-jobs">
                  {stage.jobs.map((job) => (
                    <button
                      key={job.id}
                      className={`gl-job-node gl-job-${statusInfo(job.status).tone} ${selectedJob?.id === job.id ? "is-selected" : ""}`}
                      onClick={() => void selectJob(job)}
                      aria-expanded={selectedJob?.id === job.id}
                    >
                      <Status value={job.status} compact />
                      <span>{job.name}</span>
                      {job.allowFailure && (
                        <span
                          className="gl-optional"
                          aria-hidden="true"
                        >
                          !
                        </span>
                      )}
                    </button>
                  ))}
                  {!stage.jobs.length && (
                    <span className="gl-muted">
                      {jobs.busy ? "Загрузка…" : "Нет задач"}
                    </span>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      {!jobs.busy && !jobs.items.length && !jobs.error && (
        <Empty>В пайплайне пока нет задач.</Empty>
      )}
      {!compact && stages.length > 0 && (
        <div className="gl-graph-legend">
          <span>
            <Status value="success" compact />
            Успешно
          </span>
          <span>
            <Status value="failed" compact />
            Ошибка
          </span>
          <span>
            <Status value="running" compact />В работе
          </span>
          <span>
            <Status value="manual" compact />
            Ручной запуск
          </span>
        </div>
      )}
      {failed.length > 0 && !selectedJob && (
        <button
          className="gl-failed-action"
          onClick={() => void selectJob(failed[0]!)}
        >
          <Glyph name="x" />
          {failed.length === 1
            ? `Открыть лог: ${failed[0]!.name}`
            : `${failed.length} упавших задач · открыть первую`}
          <Glyph name="chevron" />
        </button>
      )}
      {selectedJob && (
        <div className="gl-log-drawer">
          <div className="gl-log-heading">
            <div>
              <Status value={selectedJob.status} compact />
              <strong>{selectedJob.name}</strong>
            </div>
            <button
              className="gl-text-button"
              disabled={logBusy}
              onClick={() => void selectJob(selectedJob, true)}
            >
              <Glyph name="refresh" />
              Обновить лог
            </button>
            <button
              className="gl-icon-button"
              aria-label="Закрыть лог"
              onClick={() => {
                seq.current++;
                setSelectedJob(null);
                setLogBusy(false);
              }}
            >
              <Glyph name="x" />
            </button>
          </div>
          <div className="gl-job-meta">
            {selectedJob.stage} · #{selectedJob.id}
            {selectedJob.duration !== null
              ? ` · ${Math.round(selectedJob.duration)} сек.`
              : ""}
            {selectedJob.allowFailure ? " · не блокирует пайплайн" : ""}
            <Link href={selectedJob.webUrl}>
              В GitLab <Glyph name="external" />
            </Link>
          </div>
          <ErrorBox
            text={logError}
            retry={() => {
              void selectJob(selectedJob, true);
            }}
          />
          {logBusy && (
            <div className="gl-loading-line">
              <Glyph name="spin" />
              Загружаем лог…
            </div>
          )}
          {log && (
            <>
              {log.truncated && (
                <div className="gl-log-tail">
                  Последние 48 000 символов · полный лог в GitLab
                </div>
              )}
              {log.text.trim() ? (
                <pre tabIndex={0}>{log.text}</pre>
              ) : (
                <div
                  className={`gl-log-empty ${log.state === "unavailable" ? "gl-tone-warn" : "gl-muted"}`}
                  role="status"
                >
                  {log.message ||
                    "GitLab вернул пустой ответ. Откройте задачу в GitLab."}
                </div>
              )}
              {log.text.trim() && (
                <button
                  className="gl-assistant-action"
                  onClick={() =>
                    composer.insert(
                      `Разбери GitLab job ${selectedJob.name} (#${selectedJob.id}), pipeline #${pipeline.id}, SHA ${pipeline.sha}: ${selectedJob.webUrl}\n${log.truncated ? "Последняя часть лога:\n" : "Лог:\n"}${log.text}`,
                      { at: "end", block: true },
                    )
                  }
                >
                  <Glyph name="message" />
                  Разобрать с агентом
                </button>
              )}
            </>
          )}
          {selectedJob.artifacts.length > 0 && (
            <div className="gl-artifacts">
              Артефакты: {selectedJob.artifacts.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Discussions({ mr, ...ctx }: Context & { mr: MergeRequest }) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(
    (page: number) =>
      rpc.call("discussions", {
        threadId: ctx.threadId,
        key: ctx.contextKey,
        projectId: mr.projectId,
        iid: mr.iid,
        page,
      }),
    [rpc, ctx.threadId, ctx.contextKey, mr.projectId, mr.iid],
  );
  const state = usePages<Discussion>(load, ctx.refresh);
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [file, setFile] = useState("");
  const comments = state.items.filter((d) => threadNotes(d).length > 0),
    history = state.items.flatMap((d) => d.notes.filter((n) => n.system));
  const open = comments.filter((d) => threadState(d) === "open").length,
    resolved = comments.filter((d) => threadState(d) === "resolved").length;
  const plainComments = comments.filter(
    (d) => threadState(d) === "comment",
  ).length;
  const files = [
    ...new Set(
      comments.flatMap((d) =>
        threadNotes(d)
          .map((n) => n.path)
          .filter((p): p is string => Boolean(p)),
      ),
    ),
  ].sort();
  const filtered = filterThreads(state.items, filter, query, file);
  const groups = groupByFile(filtered);
  return (
    <>
      <div className="gl-review-toolbar">
        <div className="gl-filter-tabs" aria-label="Фильтр обсуждений">
          {[
            ["all", "Все", comments.length],
            ["open", "Не решены", open],
            ["resolved", "Решены", resolved],
            ...(plainComments
              ? [["comment", "Комментарии", plainComments]]
              : []),
          ].map(([id, label, count]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(String(id))}
            >
              {label}
              <span>
                {count}
                {state.next !== null ? "+" : ""}
              </span>
            </button>
          ))}
        </div>
        <label className="gl-search">
          <Glyph name="search" />
          <input
            aria-label="Поиск обсуждений"
            placeholder="Текст, автор или файл"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="gl-icon-button"
              aria-label="Очистить поиск"
              onClick={() => setQuery("")}
            >
              <Glyph name="x" />
            </button>
          )}
        </label>
        {files.length > 1 && (
          <select
            aria-label="Файл обсуждения"
            value={file}
            onChange={(e) => setFile(e.target.value)}
          >
            <option value="">Все файлы</option>
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="gl-discussion-count">
        <span>
          {filtered.length} из {comments.length} загруженных обсуждений
          {state.next !== null ? " · есть ещё" : ""}
        </span>
        {state.next !== null && (
          <button
            className="gl-text-button"
            disabled={state.busy && !state.all}
            onClick={state.all ? state.stop : state.loadAll}
          >
            {state.all ? "Остановить" : "Загрузить все"}
          </button>
        )}
      </div>
      {plainComments > 0 && (
        <p className="gl-pagination-hint">
          Комментарии — отдельные сообщения без отметки «решено». В счётчик
          нерешённых обсуждений они не входят.
        </p>
      )}
      {groups.map(([path, threads]) => (
        <section className="gl-file-group" key={path}>
          <header className="gl-file-heading">
            <code title={path}>{path || "Общие комментарии к MR"}</code>
            <span className="gl-muted">
              {threads.filter((d) => threadState(d) === "open").length > 0
                ? `${threads.filter((d) => threadState(d) === "open").length} не решено · `
                : ""}
              {countLabel(threads.length, [
                "обсуждение",
                "обсуждения",
                "обсуждений",
              ])}
            </span>
          </header>
          {threads.map((d) => (
            <ReviewThread key={d.id} discussion={d} mr={mr} ctx={ctx} />
          ))}
        </section>
      ))}
      {!state.busy && !filtered.length && (
        <Empty>
          {query || file || filter !== "all" ? (
            <>
              Ничего не найдено среди загруженных обсуждений.
              <button
                className="gl-text-button"
                onClick={() => {
                  setQuery("");
                  setFile("");
                  setFilter("all");
                }}
              >
                Сбросить фильтры
              </button>
            </>
          ) : (
            "Комментариев пока нет."
          )}
          {state.next !== null && (
            <span>
              Загрузите следующие страницы, чтобы проверить остальные.
            </span>
          )}
        </Empty>
      )}
      <Pages state={state} noun="веток и событий" all />
      {state.next !== null && (
        <p className="gl-pagination-hint">
          Поиск и счётчики учитывают загруженные страницы. «Загрузить все»
          охватит всё ревью.
        </p>
      )}
      {history.length > 0 && (
        <details className="gl-fold gl-history">
          <summary>
            История MR{" "}
            <span className="gl-count">
              {history.length}
              {state.next !== null ? "+" : ""}
            </span>
          </summary>
          <p className="gl-muted">
            Изменения статуса, назначений и другие действия в GitLab. Это не
            комментарии ревьюеров.
          </p>
          {history.map((n) => (
            <div className="gl-history-item" key={n.id}>
              <span className="gl-history-dot" />
              <div>
                <strong>{n.author.name}</strong>
                <Markdown content={n.body} />
                <Time value={n.createdAt} />
              </div>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
function CodeContext({
  ctx,
  mr,
  note,
}: {
  ctx: Context;
  mr: MergeRequest;
  note: Discussion["notes"][number];
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; value: CodeContextResult }
    | { status: "error" }
  >({ status: "loading" });
  useEffect(() => {
    if (!note.path || note.line === null || !note.contextRef) return;
    let live = true;
    setState({ status: "loading" });
    rpc
      .call("codeContext", {
        threadId: ctx.threadId,
        key: ctx.contextKey,
        projectId: mr.projectId,
        iid: mr.iid,
        filePath: note.path,
        ref: note.contextRef,
        line: note.line,
      })
      .then((value) => live && setState({ status: "ready", value }))
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [rpc, ctx.threadId, ctx.contextKey, mr.projectId, mr.iid, note]);
  if (!note.path || note.line === null || !note.contextRef) return null;
  if (state.status === "loading")
    return <p className="gl-muted">Загружаю код…</p>;
  if (state.status === "error" || !state.value.available)
    return (
      <p className="gl-muted">
        {state.status === "ready"
          ? state.value.message
          : "Не удалось загрузить код."}
      </p>
    );
  return (
    <div className="gl-code-context" aria-label="Код вокруг замечания">
      {note.outdated && (
        <div className="gl-muted">Показана ревизия, к которой оставлено замечание</div>
      )}
      <pre>
        {state.value.lines.map((l) => (
          <div
            key={l.n}
            className={l.n === state.value.highlight ? "is-target" : ""}
          >
            <span className="gl-code-n">{l.n}</span>
            <span>{l.text || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
function ReviewThread({
  discussion,
  mr,
  ctx,
}: {
  discussion: Discussion;
  mr: MergeRequest;
  ctx: Context;
}) {
  const notes = threadNotes(discussion),
    first = notes[0]!,
    status = threadState(discussion),
    composer = useComposer();
  const [expanded, setExpanded] = useState(status === "open");
  const stateValue =
    status === "open" ? "unresolved" : status === "resolved" ? "resolved" : "";
  return (
    <article
      className={`gl-review-thread ${status === "resolved" ? "is-resolved" : ""}`}
    >
      <button
        className="gl-thread-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className={`gl-avatar ${status === "open" ? "gl-avatar-warn" : ""}`}
        >
          {first.author.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="gl-thread-summary">
          <span className="gl-thread-who">
            <strong>{first.author.name}</strong>
            <Time value={first.createdAt} />
            {stateValue && <Status value={stateValue} compact />}
          </span>
          <span
            className="gl-thread-subject"
            title={first.path ?? "Комментарий к MR"}
          >
            {first.path
              ? `${first.path.split("/").pop()}${first.line !== null ? `:${first.line}` : ""}`
              : "Комментарий к MR"}
            {first.outdated ? " · старый diff" : ""}
          </span>
          {!expanded && (
            <span className="gl-thread-preview">
              {markdownPreview(first.body)}
            </span>
          )}
          <span className="gl-thread-footer">
            {notes.length > 1
              ? countLabel(notes.length - 1, ["ответ", "ответа", "ответов"])
              : "Без ответов"}
            {status === "open"
              ? " · не решено"
              : status === "resolved"
                ? " · решено"
                : ""}
          </span>
        </span>
        <Glyph name="chevron" className={expanded ? "gl-chevron-open" : ""} />
      </button>
      {expanded && (
        <div className="gl-thread-conversation">
          <CodeContext ctx={ctx} mr={mr} note={first} />
          {notes.map((n, index) => (
            <div className="gl-note" key={n.id}>
              {index > 0 && (
                <div className="gl-note-author">
                  <span className="gl-avatar gl-avatar-small">
                    {n.author.name.slice(0, 1).toUpperCase()}
                  </span>
                  <strong>{n.author.name}</strong>
                  <Time value={n.createdAt} />
                </div>
              )}
              <Markdown content={n.body} />
              <div className="gl-note-actions">
                <Link href={n.webUrl}>
                  В GitLab <Glyph name="external" />
                </Link>
                <button
                  className="gl-text-button"
                  onClick={() =>
                    composer.insert(
                      `Разбери замечание в GitLab MR !${mr.iid}: ${n.webUrl}\n${n.path ? `${n.path}:${n.line ?? ""}\n` : ""}${n.author.name}:\n${n.body.slice(0, 12000)}${n.body.length > 12000 ? "\n[Комментарий сокращён]" : ""}`,
                      { at: "end", block: true },
                    )
                  }
                >
                  <Glyph name="message" />В запрос агенту
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Commits({ head, ...ctx }: Context & { head: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(
    (page: number) =>
      rpc.call("commits", {
        threadId: ctx.threadId,
        key: ctx.contextKey,
        page,
      }),
    [rpc, ctx.threadId, ctx.contextKey],
  );
  const state = usePages<Commit>(load, ctx.refresh),
    graph = commitGraph(state.items);
  return (
    <>
      <div className="gl-section-heading">
        <h2>История ветки</h2>
        <span className="gl-muted">Новые сверху</span>
      </div>
      <p className="gl-caption">
        Опубликованные коммиты · линии показывают родителей и слияния
      </p>
      <div className="gl-commit-list">
        {state.items.map((c, index) => {
          const row = graph[index]!;
          return (
            <article className="gl-commit-row" key={c.id}>
              <svg
                width={16 * row.width + 12}
                height="60"
                viewBox={`0 0 ${16 * row.width + 12} 60`}
                className="gl-commit-graph"
                aria-hidden="true"
              >
                {row.edges.map((edge, i) => {
                  const x1 = 12 + edge.from * 16,
                    x2 = 12 + edge.to * 16,
                    y1 = edge.start === "top" ? 0 : 24,
                    y2 = edge.end === "bottom" ? 60 : 24;
                  return (
                    <path
                      key={i}
                      d={
                        x1 === x2
                          ? `M${x1} ${y1}V${y2}`
                          : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
                      }
                      className={`gl-graph-lane-${edge.from % 4}`}
                    />
                  );
                })}
                <circle
                  cx={12 + row.lane * 16}
                  cy="24"
                  r="4"
                  className={`gl-commit-node gl-graph-lane-${row.lane % 4}`}
                />
              </svg>
              <div className="gl-commit-body">
                <div className="gl-commit-title" title={c.title}>
                  <Link href={c.webUrl}>{c.title}</Link>
                  {c.id === head && <span className="gl-head-tag">HEAD</span>}
                  {c.parentIds.length > 1 && (
                    <span
                      className="gl-tag"
                      title="Коммит с несколькими родителями"
                    >
                      merge
                    </span>
                  )}
                </div>
                <div className="gl-commit-meta">
                  <Link href={c.webUrl}>
                    <code>{short(c.id)}</code>
                  </Link>
                  <span>{c.author}</span>
                  <Time value={c.createdAt} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!state.busy && !state.items.length && <Empty>Коммиты не найдены.</Empty>}
      <Pages state={state} noun="коммитов" />
      {state.items.length > 0 && state.next !== null && (
        <p className="gl-caption">
          История продолжается ниже. Загрузите более ранние коммиты.
        </p>
      )}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "branch",
    title: "GitLab",
    icon: "GitBranch",
    layout: "flush",
    component: GitLabTab,
  });
  app.slots.experimental_threadAction({
    id: "open-gitlab",
    title: "GitLab текущей ветки",
    icon: "GitBranch",
    group: "gitlab",
    placement: "header",
    item: ({ thread, experimental_panel }) =>
      thread.environment
        ? {
            label: "GitLab",
            icon: "GitBranch",
            run: () => {
              experimental_panel.openTab({
                tab: {
                  id: "branch",
                  context: { kind: "thread" },
                  availability: "fixed",
                },
              });
            },
          }
        : null,
  });
});
