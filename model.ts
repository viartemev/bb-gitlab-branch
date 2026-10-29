import { z } from "zod";

export const id = z.number().int().positive();
export const page = z.number().int().min(1).max(10000).default(1);
export const personSchema = z.object({
  name: z.string(),
  username: z.string(),
});
export const pipelineSchema = z.object({
  id,
  status: z.string(),
  sha: z.string(),
  ref: z.string(),
  source: z.string(),
  webUrl: z.string(),
  createdAt: z.string(),
  projectId: id,
  mrProjectId: id.nullable(),
  mrIid: id.nullable(),
});
export const mrSchema = z.object({
  iid: id,
  projectId: id,
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  webUrl: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  sha: z.string(),
  author: personSchema,
  reviewers: z.array(personSchema),
  labels: z.array(z.string()),
  updatedAt: z.string(),
});
export const checkoutSchema = z.object({
  key: z.string(),
  branch: z.string().nullable(),
  remoteBranch: z.string().nullable(),
  head: z.string().nullable(),
  upstreamHead: z.string().nullable(),
  dirty: z.boolean(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  hostname: z.string(),
  projectPath: z.string(),
  projectId: id,
});
export const snapshotSchema = z.object({
  outcome: z.enum(["ready", "not-gitlab", "not-git", "detached"]),
  message: z.string(),
  checkout: checkoutSchema.nullable(),
  mergeRequests: z.array(mrSchema),
  pipelines: z.array(pipelineSchema),
  nextMrPage: z.number().nullable(),
  nextPipelinePage: z.number().nullable(),
  fetchedAt: z.string(),
  warnings: z.array(z.string()),
});
export const mrDetailSchema = z.object({
  mr: mrSchema,
  description: z.string(),
  mergeStatus: z.string(),
  hasConflicts: z.boolean(),
  discussionsResolved: z.boolean(),
  assignees: z.array(personSchema),
  milestone: z.string().nullable(),
  changesCount: z.string(),
  approvals: z.object({
    available: z.boolean(),
    remaining: z.number().nullable(),
    approvedBy: z.array(personSchema),
    message: z.string(),
  }),
  headPipeline: pipelineSchema.nullable(),
});
export const noteSchema = z.object({
  id,
  body: z.string(),
  author: personSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  system: z.boolean(),
  resolvable: z.boolean(),
  resolved: z.boolean(),
  path: z.string().nullable(),
  line: z.number().nullable(),
  outdated: z.boolean(),
  contextRef: z.string().optional(),
  webUrl: z.string(),
});
export const discussionSchema = z.object({
  id: z.string(),
  individual: z.boolean().optional(),
  resolvable: z.boolean().optional(),
  resolved: z.boolean().optional(),
  notes: z.array(noteSchema),
});
export const jobSchema = z.object({
  id,
  name: z.string(),
  stage: z.string(),
  status: z.string(),
  duration: z.number().nullable(),
  webUrl: z.string(),
  allowFailure: z.boolean(),
  artifacts: z.array(z.string()),
  retried: z.boolean().default(false),
});
export const commitSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  createdAt: z.string(),
  webUrl: z.string(),
  parentIds: z.array(z.string()).default([]),
});
export const settingsSchema = z.object({
  hostname: z.string().default(""),
  remote: z.string().default(""),
  token: z.string().optional(),
});
export const hostBase = z.object({
  path: z.string().min(1).max(4096),
  settings: settingsSchema,
});
export const contextInput = z.object({
  threadId: z.string().min(1),
  key: z.string().min(1),
});
export const hostContext = hostBase.extend({ key: z.string().min(1) });
export type Checkout = z.infer<typeof checkoutSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type MergeRequest = z.infer<typeof mrSchema>;
export type MrDetail = z.infer<typeof mrDetailSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;
export type Discussion = z.infer<typeof discussionSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Commit = z.infer<typeof commitSchema>;
export type Settings = z.infer<typeof settingsSchema>;

export function parseRemote(
  raw: string,
): { hostname: string; projectPath: string } | null {
  const value = raw.trim();
  let hostname: string, path: string;
  try {
    if (/^[\w.+-]+@[^/:]+:.+$/.test(value)) {
      const match = value.match(/^[^@]+@([^:]+):(.+)$/)!;
      hostname = match[1]!;
      path = match[2]!;
    } else {
      const url = new URL(value);
      if (!["https:", "http:", "ssh:"].includes(url.protocol)) return null;
      hostname = url.protocol === "ssh:" ? url.hostname : url.host;
      path = url.pathname.replace(/^\//, "");
    }
    path = path.replace(/\.git\/?$/, "").replace(/\/$/, "");
    if (
      !/^[a-z0-9.-]+(?::\d+)?$/i.test(hostname) ||
      path.split("/").length < 2 ||
      path
        .split("/")
        .some((p) => !p || p === "." || p === ".." || /[\s?#\\]/.test(p))
    )
      return null;
    return { hostname: hostname.toLowerCase(), projectPath: path };
  } catch {
    return null;
  }
}

export function safeUrl(value: unknown, hostname: string): string {
  if (typeof value !== "string") return "";
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      u.host.toLowerCase() === hostname.toLowerCase() &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}

export function cleanLog(text: string): string {
  // Strip terminal escapes (including hyperlinks), retaining ordinary Unicode.
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}
