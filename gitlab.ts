import { createHash } from "node:crypto";
import {
  cleanLog,
  parseRemote,
  safeUrl,
  type Settings,
  type Checkout,
  type Snapshot,
  type MergeRequest,
  type Pipeline,
  type MrDetail,
  type Discussion,
  type Job,
  type Commit,
} from "./model";
import type { Run } from "./command";

type Raw = Record<string, any>;
const text = (v: unknown, max = 4000): string =>
  typeof v === "string"
    ? v.length > max
      ? `${v.slice(0, max)}\n[Текст сокращён; полная версия в GitLab]`
      : v
    : "";
const people = (v: unknown) => (Array.isArray(v) ? v.map(person) : []);
const person = (p: Raw | null | undefined) => ({
  name: text(p?.name, 200),
  username: text(p?.username, 200),
});
const PAGE_SIZE = 20;
const CONTEXT_RADIUS = 3;
export class GitLabReader {
  constructor(
    readonly path: string,
    readonly settings: Settings,
    readonly run: Run,
    readonly signal?: AbortSignal,
  ) {}
  private git(args: string[], allowFailure = false) {
    return this.run("git", args, {
      cwd: this.path,
      signal: this.signal,
      allowFailure,
    }).then((s) => s.trim());
  }
  private async api(
    hostname: string,
    endpoint: string,
    raw = false,
  ): Promise<any> {
    const result = await this.run(
      "glab",
      ["api", "--hostname", hostname, "--method", "GET", endpoint],
      { cwd: this.path, signal: this.signal, token: this.settings.token },
    );
    if (raw) return result;
    try {
      return JSON.parse(result);
    } catch {
      throw new Error("GitLab returned an invalid API response");
    }
  }
  private list(value: unknown): Raw[] {
    if (!Array.isArray(value))
      throw new Error("GitLab returned an unexpected list response");
    return value;
  }
  private pipeline(
    p: Raw,
    hostname: string,
    projectId: number,
    mrProjectId: number | null = null,
    mrIid: number | null = null,
  ): Pipeline {
    return {
      id: p.id,
      status: text(p.status),
      sha: text(p.sha),
      ref: text(p.ref),
      source: text(p.source),
      webUrl: safeUrl(p.web_url, hostname),
      createdAt: text(p.created_at),
      projectId,
      mrProjectId,
      mrIid,
    };
  }
  private mrSummary(m: Raw, hostname: string): MergeRequest {
    return {
      iid: m.iid,
      projectId: m.project_id ?? m.target_project_id,
      title: text(m.title),
      state: text(m.state),
      draft: Boolean(m.draft ?? m.work_in_progress),
      webUrl: safeUrl(m.web_url, hostname),
      sourceBranch: text(m.source_branch),
      targetBranch: text(m.target_branch),
      sha: text(m.sha),
      author: person(m.author),
      reviewers: people(m.reviewers),
      labels: Array.isArray(m.labels)
        ? m.labels.map((s: unknown) => text(s, 300))
        : [],
      updatedAt: text(m.updated_at),
    };
  }
  async resolve(): Promise<{
    checkout: Checkout | null;
    outcome: Snapshot["outcome"];
    message: string;
    project?: Raw;
  }> {
    if (!(await this.git(["rev-parse", "--show-toplevel"], true)))
      return {
        checkout: null,
        outcome: "not-git",
        message: "В рабочей папке нет Git-репозитория.",
      };
    const [branchValue, headValue, dirty, names] = await Promise.all([
      this.git(["symbolic-ref", "--quiet", "--short", "HEAD"], true),
      this.git(["rev-parse", "--verify", "HEAD"], true),
      this.git(["status", "--porcelain", "--untracked-files=normal"]),
      this.git(["remote"]),
    ]);
    const branch = branchValue || null,
      head = headValue || null;
    const [upstreamRemote, mergeRef, upstreamHead, counts] = branch
      ? await Promise.all([
          this.git(["config", "--get", `branch.${branch}.remote`], true),
          this.git(["config", "--get", `branch.${branch}.merge`], true),
          this.git(["rev-parse", "--verify", "@{upstream}"], true),
          this.git(
            ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            true,
          ),
        ])
      : ["", "", "", ""];
    const candidates = this.settings.remote
      ? [this.settings.remote]
      : [
          ...new Set(
            [upstreamRemote, "origin", ...names.split("\n")].filter(
              (n) => n && n !== ".",
            ),
          ),
        ];
    let remote: ReturnType<typeof parseRemote> = null,
      selectedRemote = "";
    for (const name of candidates) {
      const parsed = parseRemote(
        await this.git(["remote", "get-url", "--", name], true),
      );
      if (!parsed) continue;
      const allowed = this.settings.hostname
        ? parsed.hostname === this.settings.hostname.toLowerCase()
        : /(^|[.-])gitlab([.:-]|$)/i.test(parsed.hostname);
      if (allowed) {
        remote = parsed;
        selectedRemote = name;
        break;
      }
    }
    if (!remote)
      return {
        checkout: null,
        outcome: "not-gitlab",
        message:
          "GitLab remote не найден. Для нестандартного адреса укажите GitLab hostname в настройках плагина.",
      };
    if (this.settings.token && !this.settings.hostname)
      throw new Error(
        "Для PAT укажите GitLab hostname в настройках, чтобы токен использовался только для выбранного сервера.",
      );
    const project = (await this.api(
      remote.hostname,
      `projects/${encodeURIComponent(remote.projectPath)}`,
    )) as Raw;
    if (!Number.isSafeInteger(project.id) || project.id < 1)
      throw new Error("GitLab returned an invalid project ID");
    const [ahead, behind] = counts
      ? counts.split(/\s+/).map(Number)
      : [null, null];
    const remoteBranch =
      selectedRemote === upstreamRemote && mergeRef.startsWith("refs/heads/")
        ? mergeRef.slice(11)
        : branch;
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          this.path,
          remote.hostname,
          project.id,
          branch,
          remoteBranch,
          head,
        ]),
      )
      .digest("hex");
    const checkout: Checkout = {
      key,
      branch,
      remoteBranch,
      head,
      upstreamHead: upstreamHead || null,
      dirty: Boolean(dirty),
      ahead: ahead ?? null,
      behind: behind ?? null,
      hostname: remote.hostname,
      projectPath: remote.projectPath,
      projectId: project.id,
    };
    return {
      checkout,
      project,
      outcome: branch ? "ready" : "detached",
      message: branch
        ? ""
        : "Detached HEAD: показан текущий коммит. Для поиска MR переключитесь на ветку.",
    };
  }
  async checked(key: string): Promise<Checkout> {
    const { checkout } = await this.resolve();
    if (!checkout || checkout.key !== key)
      throw new Error("Ветка или коммит изменились. Обновите панель GitLab.");
    return checkout;
  }
  private async checkedMr(
    c: Checkout,
    projectId: number,
    iid: number,
  ): Promise<Raw> {
    const mr = (await this.api(
      c.hostname,
      `projects/${projectId}/merge_requests/${iid}`,
    )) as Raw;
    if (
      mr.source_project_id !== c.projectId ||
      mr.source_branch !== c.remoteBranch
    )
      throw new Error("Этот MR не относится к текущей ветке.");
    return mr;
  }
  async snapshot(mrPage = 1, pipelinePage = 1): Promise<Snapshot> {
    const { checkout: c, project, outcome, message } = await this.resolve();
    const snapshot: Snapshot = {
      outcome,
      message,
      checkout: c,
      mergeRequests: [],
      pipelines: [],
      nextMrPage: null,
      nextPipelinePage: null,
      fetchedAt: new Date().toISOString(),
      warnings: [],
    };
    if (!c?.remoteBranch) return snapshot;
    const target = project?.forked_from_project?.id ?? c.projectId;
    const results = await Promise.allSettled([
      this.api(
        c.hostname,
        `projects/${target}/merge_requests?scope=all&state=all&source_branch=${encodeURIComponent(c.remoteBranch)}&order_by=updated_at&sort=desc&per_page=${PAGE_SIZE}&page=${mrPage}`,
      ),
      this.api(
        c.hostname,
        `projects/${c.projectId}/pipelines?ref=${encodeURIComponent(c.remoteBranch)}&order_by=id&sort=desc&per_page=${PAGE_SIZE}&page=${pipelinePage}`,
      ),
    ]);
    if (results[0].status === "fulfilled") {
      const rows = this.list(results[0].value);
      snapshot.mergeRequests = rows
        .filter(
          (m) =>
            m.source_project_id === c.projectId &&
            m.source_branch === c.remoteBranch,
        )
        .map((m) => this.mrSummary(m, c.hostname));
      snapshot.nextMrPage = rows.length === PAGE_SIZE ? mrPage + 1 : null;
    } else
      snapshot.warnings.push(
        `MR: ${results[0].reason instanceof Error ? results[0].reason.message : "Не удалось загрузить"}`,
      );
    if (results[1].status === "fulfilled") {
      const rows = this.list(results[1].value);
      snapshot.pipelines = rows.map((p) =>
        this.pipeline(p, c.hostname, c.projectId),
      );
      snapshot.nextPipelinePage =
        rows.length === PAGE_SIZE ? pipelinePage + 1 : null;
    } else
      snapshot.warnings.push(
        `CI: ${results[1].reason instanceof Error ? results[1].reason.message : "Не удалось загрузить"}`,
      );
    snapshot.fetchedAt = new Date().toISOString();
    return snapshot;
  }
  async mr(key: string, projectId: number, iid: number): Promise<MrDetail> {
    const c = await this.checked(key),
      m = await this.checkedMr(c, projectId, iid);
    let approvals: MrDetail["approvals"] = {
      available: false,
      remaining: null,
      approvedBy: [],
      message: "",
    };
    try {
      const a = await this.api(
        c.hostname,
        `projects/${projectId}/merge_requests/${iid}/approvals`,
      );
      approvals = {
        available: true,
        remaining:
          typeof a.approvals_left === "number" ? a.approvals_left : null,
        approvedBy: people(a.approved_by?.map((p: Raw) => p.user)),
        message: "",
      };
    } catch {
      approvals.message =
        "Approvals недоступны для этой версии GitLab или текущих прав.";
    }
    return {
      mr: this.mrSummary(m, c.hostname),
      description: text(m.description, 60000),
      mergeStatus: text(m.detailed_merge_status ?? m.merge_status),
      hasConflicts: Boolean(m.has_conflicts),
      discussionsResolved: Boolean(m.blocking_discussions_resolved),
      assignees: people(m.assignees),
      milestone: m.milestone ? text(m.milestone.title) : null,
      changesCount: String(m.changes_count ?? ""),
      approvals,
      headPipeline: m.head_pipeline
        ? this.pipeline(
            m.head_pipeline,
            c.hostname,
            m.head_pipeline.project_id ?? projectId,
            projectId,
            iid,
          )
        : null,
    };
  }
  async discussions(key: string, projectId: number, iid: number, page: number) {
    const c = await this.checked(key),
      m = await this.checkedMr(c, projectId, iid);
    const rows = this.list(
      await this.api(
        c.hostname,
        `projects/${projectId}/merge_requests/${iid}/discussions?per_page=${PAGE_SIZE}&page=${page}`,
      ),
    );
    const items: Discussion[] = rows.map((d) => ({
      id: String(d.id),
      individual: Boolean(d.individual_note),
      ...(typeof d.resolvable === "boolean"
        ? { resolvable: d.resolvable }
        : {}),
      ...(typeof d.resolved === "boolean" ? { resolved: d.resolved } : {}),
      notes: (Array.isArray(d.notes) ? d.notes : []).map((n: Raw) => ({
        id: n.id,
        body: text(n.body, 60000),
        author: person(n.author),
        createdAt: text(n.created_at),
        updatedAt: text(n.updated_at),
        system: Boolean(n.system),
        resolvable: Boolean(n.resolvable),
        resolved: Boolean(n.resolved),
        path:
          typeof n.position?.new_path === "string"
            ? n.position.new_path
            : typeof n.position?.old_path === "string"
              ? n.position.old_path
              : null,
        line: n.position?.new_line ?? n.position?.old_line ?? null,
        outdated: Boolean(
          n.position?.head_sha &&
            m.diff_refs?.head_sha &&
            n.position.head_sha !== m.diff_refs.head_sha,
        ),
        contextRef: text(
          (n.position?.new_line != null
            ? n.position?.head_sha
            : n.position?.base_sha) ?? "",
          64,
        ),
        webUrl: safeUrl(m.web_url, c.hostname)
          ? `${safeUrl(m.web_url, c.hostname)}#note_${n.id}`
          : "",
      })),
    }));
    return { items, next: rows.length === PAGE_SIZE ? page + 1 : null };
  }
  async codeContext(
    key: string,
    projectId: number,
    iid: number,
    filePath: string,
    ref: string,
    line: number,
  ) {
    const c = await this.checked(key);
    await this.checkedMr(c, projectId, iid);
    const none = (message: string) => ({
      lines: [],
      highlight: line,
      available: false,
      message,
    });
    let source: string;
    try {
      source = await this.api(
        c.hostname,
        `projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`,
        true,
      );
    } catch {
      return none(
        "Не удалось получить файл на этой ревизии. Откройте замечание в GitLab.",
      );
    }
    const all = source.split(/\r?\n/);
    if (line > all.length) return none("Строки больше нет в файле.");
    const from = Math.max(1, line - CONTEXT_RADIUS),
      to = Math.min(all.length, line + CONTEXT_RADIUS);
    return {
      lines: all.slice(from - 1, to).map((t, i) => ({
        n: from + i,
        text: t.length > 300 ? `${t.slice(0, 300)}…` : t,
      })),
      highlight: line,
      available: true,
      message: "",
    };
  }
  async pipelines(key: string, projectId: number, iid: number, page: number) {
    const c = await this.checked(key);
    await this.checkedMr(c, projectId, iid);
    const rows = this.list(
      await this.api(
        c.hostname,
        `projects/${projectId}/merge_requests/${iid}/pipelines?per_page=${PAGE_SIZE}&page=${page}`,
      ),
    );
    return {
      items: rows.map((p) =>
        this.pipeline(p, c.hostname, p.project_id ?? projectId, projectId, iid),
      ),
      next: rows.length === PAGE_SIZE ? page + 1 : null,
    };
  }
  private async checkedPipeline(
    c: Checkout,
    projectId: number,
    pipelineId: number,
    mrProjectId: number | null,
    mrIid: number | null,
  ): Promise<Raw> {
    const p = (await this.api(
      c.hostname,
      `projects/${projectId}/pipelines/${pipelineId}`,
    )) as Raw;
    if (projectId === c.projectId && p.ref === c.remoteBranch) return p;
    // MR pipelines can use synthetic refs and run in a fork's target project.
    // Verify the MR first, then membership using the documented MR pipelines API.
    if (mrProjectId !== null && mrIid !== null) {
      await this.checkedMr(c, mrProjectId, mrIid);
      for (let page = 1; page <= 10; page++) {
        const rows = this.list(
          await this.api(
            c.hostname,
            `projects/${mrProjectId}/merge_requests/${mrIid}/pipelines?per_page=100&page=${page}`,
          ),
        );
        if (
          rows.some(
            (row) =>
              row.id === pipelineId &&
              (row.project_id ?? mrProjectId) === projectId,
          )
        )
          return p;
        if (rows.length < 100) break;
      }
    }
    throw new Error(
      "Не удалось подтвердить принадлежность пайплайна текущей ветке/MR (проверяются первые 1000 пайплайнов MR).",
    );
  }
  async jobs(
    key: string,
    projectId: number,
    pipelineId: number,
    page: number,
    mrProjectId: number | null = null,
    mrIid: number | null = null,
  ) {
    const c = await this.checked(key);
    const pipeline = await this.checkedPipeline(
      c,
      projectId,
      pipelineId,
      mrProjectId,
      mrIid,
    );
    const rows = this.list(
      await this.api(
        c.hostname,
        `projects/${projectId}/pipelines/${pipelineId}/jobs?include_retried=true&per_page=${PAGE_SIZE}&page=${page}`,
      ),
    );
    const items: Job[] = rows.map((j) => ({
      id: j.id,
      name: text(j.name),
      stage: text(j.stage),
      status: text(j.status),
      duration: typeof j.duration === "number" ? j.duration : null,
      webUrl: safeUrl(j.web_url, c.hostname),
      allowFailure: Boolean(j.allow_failure),
      retried: Boolean(j.retried),
      artifacts: Array.isArray(j.artifacts)
        ? j.artifacts.map((a: Raw) => text(a.filename))
        : [],
    }));
    let stageOrder: string[] = [];
    if (page === 1 && pipeline.iid) {
      try {
        const projectPath =
          projectId === c.projectId
            ? c.projectPath
            : (await this.api(c.hostname, `projects/${projectId}`))
                .path_with_namespace;
        const query = `query { project(fullPath: ${JSON.stringify(projectPath)}) { pipeline(iid: ${JSON.stringify(String(pipeline.iid))}) { stages { nodes { name } } } } }`;
        const response = JSON.parse(
          await this.run(
            "glab",
            [
              "api",
              "graphql",
              "--hostname",
              c.hostname,
              "--method",
              "POST",
              "--raw-field",
              `query=${query}`,
            ],
            { cwd: this.path, signal: this.signal, token: this.settings.token },
          ),
        );
        const stages = response.data?.project?.pipeline?.stages?.nodes;
        if (Array.isArray(stages) && !response.errors)
          stageOrder = stages.map((s: Raw) => text(s.name)).filter(Boolean);
      } catch {
        /* Older instances may not expose GraphQL; jobs remain available. */
      }
    }
    return {
      items,
      next: rows.length === PAGE_SIZE ? page + 1 : null,
      stageOrder,
    };
  }
  async trace(
    key: string,
    projectId: number,
    pipelineId: number,
    jobId: number,
    mrProjectId: number | null = null,
    mrIid: number | null = null,
  ) {
    const c = await this.checked(key);
    await this.checkedPipeline(c, projectId, pipelineId, mrProjectId, mrIid);
    const job = await this.api(
      c.hostname,
      `projects/${projectId}/jobs/${jobId}`,
    );
    if (job.pipeline?.id !== pipelineId)
      throw new Error("Job не принадлежит выбранному пайплайну.");
    if (job.erased_at)
      return {
        text: "",
        truncated: false,
        totalCharacters: 0,
        state: "erased" as const,
        message: "Лог этой задачи удалён в GitLab.",
      };
    if (
      [
        "created",
        "pending",
        "manual",
        "scheduled",
        "waiting_for_resource",
      ].includes(job.status)
    )
      return {
        text: "",
        truncated: false,
        totalCharacters: 0,
        state: "pending" as const,
        message: "Задача ещё не запущена. Лог появится после старта.",
      };
    if (job.status === "skipped")
      return {
        text: "",
        truncated: false,
        totalCharacters: 0,
        state: "empty" as const,
        message: "Задача пропущена — лог не создавался.",
      };
    const log = cleanLog(
      await this.api(
        c.hostname,
        `projects/${projectId}/jobs/${jobId}/trace`,
        true,
      ),
    );
    const trimmed = log.trimEnd();
    const reportedTrace = Array.isArray(job.artifacts)
      ? job.artifacts.find((a: Raw) => a.file_type === "trace")
      : null;
    return {
      text: trimmed.slice(-48000),
      truncated: trimmed.length > 48000,
      totalCharacters: log.length,
      state: trimmed
        ? ("available" as const)
        : reportedTrace?.size > 0
          ? ("unavailable" as const)
          : job.status === "running"
            ? ("pending" as const)
            : ("empty" as const),
      message: trimmed
        ? ""
        : reportedTrace?.size > 0
          ? `GitLab сообщает о сохранённом логе (${reportedTrace.size} байт), но API вернул пустой ответ. Откройте задачу в GitLab.`
          : job.status === "running"
            ? "Задача выполняется, но вывод пока не поступил. Нажмите «Обновить лог»."
            : "GitLab вернул пустой лог для этой задачи.",
    };
  }
  async commits(key: string, page: number) {
    const c = await this.checked(key);
    const ref = c.remoteBranch ?? c.head;
    if (!ref) return { items: [], next: null };
    const rows = this.list(
      await this.api(
        c.hostname,
        `projects/${c.projectId}/repository/commits?ref_name=${encodeURIComponent(ref)}&order=topo&per_page=${PAGE_SIZE}&page=${page}`,
      ),
    );
    const items: Commit[] = rows.map((m) => ({
      id: text(m.id),
      title: text(m.title),
      author: text(m.author_name),
      createdAt: text(m.committed_date),
      webUrl: safeUrl(m.web_url, c.hostname),
      parentIds: Array.isArray(m.parent_ids)
        ? m.parent_ids.filter((p: unknown) => typeof p === "string")
        : [],
    }));
    return { items, next: rows.length === PAGE_SIZE ? page + 1 : null };
  }
}
