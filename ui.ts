import type { Commit, Discussion, Job, MrDetail, Pipeline } from "./model";

export type Tone = "good" | "bad" | "active" | "warn" | "muted";
export function statusInfo(status: string): {
  label: string;
  tone: Tone;
  symbol: string;
} {
  const states: Record<string, [string, Tone, string]> = {
    success: ["Успешно", "good", "check"],
    passed: ["Успешно", "good", "check"],
    failed: ["Ошибка", "bad", "x"],
    error: ["Ошибка", "bad", "x"],
    running: ["Выполняется", "active", "spin"],
    pending: ["В очереди", "warn", "clock"],
    created: ["Ожидает", "muted", "circle"],
    preparing: ["Подготовка", "active", "spin"],
    waiting_for_resource: ["Ожидает ресурс", "warn", "clock"],
    scheduled: ["Запланировано", "warn", "clock"],
    manual: ["Нужен запуск", "warn", "play"],
    blocked: ["Нужен запуск", "warn", "play"],
    canceled: ["Отменено", "muted", "slash"],
    canceling: ["Отмена", "muted", "spin"],
    skipped: ["Пропущено", "muted", "skip"],
    warning: ["С предупреждением", "warn", "alert"],
    merged: ["Слит", "good", "merge"],
    opened: ["Открыт", "active", "branch"],
    closed: ["Закрыт", "muted", "x"],
    resolved: ["Решено", "good", "check"],
    unresolved: ["Не решено", "warn", "message"],
  };
  const [label, tone, symbol] = states[status] ?? [
    status || "Нет данных",
    "muted",
    "circle",
  ];
  return { label, tone, symbol };
}

export function mergeStatusLabel(value: string) {
  const labels: Record<string, string> = {
    mergeable: "Слияние доступно",
    can_be_merged: "Слияние доступно",
    cannot_be_merged: "Слияние недоступно",
    ci_must_pass: "Ожидание успешного CI",
    ci_still_running: "CI выполняется",
    discussions_not_resolved: "Есть открытые обсуждения",
    not_approved: "Ожидание одобрений",
    need_rebase: "Требуется rebase",
    checking: "Проверяется",
    unchecked: "Не проверен",
    preparing: "Подготовка",
    requested_changes: "Запрошены изменения",
    blocked_status: "Заблокировано",
    approvals_syncing: "Одобрения обновляются",
    external_status_checks: "Внешние проверки",
    not_open: "MR не открыт",
    draft_status: "Черновик",
    conflict: "Конфликты",
  };
  return labels[value] ?? (value || "Нет данных");
}
export function clockTime(value: string) {
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleTimeString("ru", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
}
export function markdownPreview(source: string): string {
  return source
    .replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, "$1")
    .replace(/~~~[^\n]*\n([\s\S]*?)(?:~~~|$)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(
      /^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm,
      "",
    )
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ")
    .replace(/(\*\*|__|~~)([\s\S]*?)\1/g, "$2")
    .replace(/(^|[\s(])([*_])([^\n]+?)\2(?=[\s).,!?:;]|$)/g, "$1$3")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/<https?:\/\/([^>]+)>/g, "$1")
    .replace(/<\/?(?:details|summary|div|p|br|span|h[1-6]|strong|em|b|i|ul|ol|li|pre|code|table|thead|tbody|tr|th|td|blockquote)(?:\s[^>]*|\s*)>/gi, " ")
    .replace(/\\([\\`*_{}\[\]()#+.!>~-])/g, "$1")
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[
          name
        ] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function latestJobs(items: Job[]): Job[] {
  const map = new Map<string, Job>();
  for (const j of items) {
    if (j.retried) continue;
    const key = `${j.stage}\0${j.name}`,
      previous = map.get(key);
    if (!previous || previous.id < j.id) map.set(key, j);
  }
  return [...map.values()];
}
export function stageStatus(jobs: Job[]): string {
  if (jobs.some((j) => j.status === "failed" && !j.allowFailure))
    return "failed";
  if (
    jobs.some((j) => ["running", "preparing", "canceling"].includes(j.status))
  )
    return "running";
  if (jobs.some((j) => ["pending", "waiting_for_resource"].includes(j.status)))
    return "pending";
  if (jobs.some((j) => j.status === "created")) return "created";
  if (jobs.some((j) => j.status === "manual" || j.status === "scheduled"))
    return "manual";
  if (jobs.some((j) => j.status === "failed" && j.allowFailure))
    return "warning";
  if (jobs.some((j) => j.status === "canceled")) return "canceled";
  return jobs.some((j) => j.status === "success") ? "success" : "skipped";
}
export function groupStages(items: Job[], order: string[]) {
  const groups = new Map<string, Job[]>();
  for (const job of latestJobs(items))
    groups.set(job.stage, [...(groups.get(job.stage) ?? []), job]);
  const names = [...new Set([...order, ...groups.keys()])];
  return names.map((name) => ({
    name,
    jobs: (groups.get(name) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    status: groups.has(name) ? stageStatus(groups.get(name)!) : "created",
  }));
}
export function pipelineIdentity(p: Pipeline) {
  return `${p.projectId}:${p.id}`;
}
export function combinePipelines(...lists: Pipeline[][]): Pipeline[] {
  const map = new Map<string, Pipeline>();
  for (const list of lists)
    for (const p of list)
      if (!map.has(pipelineIdentity(p))) map.set(pipelineIdentity(p), p);
  return [...map.values()].sort((a, b) => b.id - a.id);
}
export function threadNotes(thread: Discussion) {
  return thread.notes.filter((n) => !n.system);
}
export function threadState(
  thread: Discussion,
): "open" | "resolved" | "comment" {
  const notes = threadNotes(thread);
  if (
    !thread.individual &&
    thread.resolvable !== false &&
    typeof thread.resolved === "boolean"
  )
    return thread.resolved ? "resolved" : "open";
  const root = notes.find((n) => n.resolvable);
  return root ? (root.resolved ? "resolved" : "open") : "comment";
}
export function filterThreads(
  items: Discussion[],
  filter: string,
  query: string,
  file: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return items
    .filter((d) => {
      const notes = threadNotes(d);
      return (
        notes.length > 0 &&
        (filter === "all" || threadState(d) === filter) &&
        (!file || notes.some((n) => n.path === file)) &&
        (!search ||
          notes.some((n) =>
            `${n.body} ${n.author.name} ${n.author.username} ${n.path ?? ""}`
              .toLocaleLowerCase()
              .includes(search),
          ))
      );
    })
    .sort((a, b) => {
      const rank = { open: 0, comment: 1, resolved: 2 };
      const priority = rank[threadState(a)] - rank[threadState(b)];
      const latest = (d: Discussion) =>
        Math.max(0, ...threadNotes(d).map((n) => Date.parse(n.createdAt) || 0));
      return priority || latest(b) - latest(a);
    });
}
export function groupByFile(threads: Discussion[]): [string, Discussion[]][] {
  const groups = new Map<string, Discussion[]>();
  for (const d of threads) {
    const path = threadNotes(d)[0]?.path ?? "";
    groups.set(path, [...(groups.get(path) ?? []), d]);
  }
  const open = (list: Discussion[]) =>
    list.some((d) => threadState(d) === "open") ? 0 : 1;
  return [...groups].sort(
    ([pa, a], [pb, b]) =>
      open(a) - open(b) || Number(!pa) - Number(!pb) || pa.localeCompare(pb),
  );
}
export function countLabel(count: number, words: [string, string, string]) {
  const n = Math.abs(count),
    last = n % 10,
    teen = n % 100;
  return `${count} ${teen >= 11 && teen <= 14 ? words[2] : last === 1 ? words[0] : last >= 2 && last <= 4 ? words[1] : words[2]}`;
}
export function relativeTime(value: string, now = Date.now()): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч. назад`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)} дн. назад`;
  return new Date(value).toLocaleDateString("ru", {
    day: "numeric",
    month: "short",
  });
}

export type GraphRow = {
  lane: number;
  width: number;
  edges: {
    from: number;
    to: number;
    start: "top" | "node";
    end: "bottom" | "node";
  }[];
};
/** Draw only actual parent relationships. A missing parent continues beyond the loaded range. */
export function commitGraph(commits: Commit[]): GraphRow[] {
  let lanes: string[] = [];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.id);
    const newLane = lane < 0;
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(commit.id);
    }
    const before = [...lanes];
    const after = lanes.filter((_, i) => i !== lane);
    const parents = [...new Set(commit.parentIds ?? [])].filter(
      (p) => p !== commit.id,
    );
    let insertion = Math.min(lane, after.length);
    for (const parent of parents)
      if (!after.includes(parent)) after.splice(insertion++, 0, parent);
    const edges: GraphRow["edges"] = [];
    before.forEach((id, i) => {
      if (id === commit.id && !newLane)
        edges.push({ from: i, to: lane, start: "top", end: "node" });
      else {
        const next = after.indexOf(id);
        if (next >= 0)
          edges.push({ from: i, to: next, start: "top", end: "bottom" });
      }
    });
    for (const parent of parents)
      edges.push({
        from: lane,
        to: after.indexOf(parent),
        start: "node",
        end: "bottom",
      });
    rows.push({ lane, width: Math.max(before.length, after.length, 1), edges });
    lanes = after;
  }
  const width = Math.max(1, ...rows.map((r) => r.width));
  return rows.map((row) => ({ ...row, width }));
}
