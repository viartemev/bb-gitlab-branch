import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostBase,
  hostContext,
  contextInput,
  id,
  page,
  snapshotSchema,
  mrDetailSchema,
  discussionSchema,
  pipelineSchema,
  jobSchema,
  commitSchema,
} from "./model";

const mr = { projectId: id, iid: id };
const codeTarget = {
  filePath: z.string().min(1).max(4096),
  ref: z.string().regex(/^[0-9a-f]{7,64}$/),
  line: z.number().int().min(1),
};
const mrContext = {
  mrProjectId: id.nullable().default(null),
  mrIid: id.nullable().default(null),
};
export const discussionsOutput = z.object({
  items: z.array(discussionSchema),
  next: z.number().nullable(),
});
export const codeContextOutput = z.object({
  lines: z.array(z.object({ n: z.number(), text: z.string() })),
  highlight: z.number(),
  available: z.boolean(),
  message: z.string().default(""),
});
export const pipelinesOutput =z.object({
  items: z.array(pipelineSchema),
  next: z.number().nullable(),
});
export const jobsOutput = z.object({
  items: z.array(jobSchema),
  next: z.number().nullable(),
  stageOrder: z.array(z.string()).default([]),
});
export const commitsOutput = z.object({
  items: z.array(commitSchema),
  next: z.number().nullable(),
});
export const traceOutput = z.object({
  text: z.string(),
  truncated: z.boolean(),
  totalCharacters: z.number(),
  state: z
    .enum(["available", "pending", "empty", "erased", "unavailable"])
    .default("available"),
  message: z.string().default(""),
});
export const hostContract = defineRpcContract({
  snapshot: {
    input: hostBase.extend({ mrPage: page, pipelinePage: page }),
    output: snapshotSchema,
  },
  mr: { input: hostContext.extend(mr), output: mrDetailSchema },
  discussions: {
    input: hostContext.extend({ ...mr, page }),
    output: discussionsOutput,
  },
  codeContext: {
    input: hostContext.extend({ ...mr, ...codeTarget }),
    output: codeContextOutput,
  },
  pipelines: {
    input: hostContext.extend({ ...mr, page }),
    output: pipelinesOutput,
  },
  jobs: {
    input: hostContext.extend({
      projectId: id,
      pipelineId: id,
      page,
      ...mrContext,
    }),
    output: jobsOutput,
  },
  trace: {
    input: hostContext.extend({
      projectId: id,
      pipelineId: id,
      jobId: id,
      ...mrContext,
    }),
    output: traceOutput,
  },
  commits: { input: hostContext.extend({ page }), output: commitsOutput },
});
export const rpcContract = defineRpcContract({
  snapshot: {
    input: z.object({
      threadId: z.string().min(1),
      mrPage: page,
      pipelinePage: page,
    }),
    output: snapshotSchema,
  },
  mr: { input: contextInput.extend(mr), output: mrDetailSchema },
  discussions: {
    input: contextInput.extend({ ...mr, page }),
    output: discussionsOutput,
  },
  codeContext: {
    input: contextInput.extend({ ...mr, ...codeTarget }),
    output: codeContextOutput,
  },
  pipelines: {
    input: contextInput.extend({ ...mr, page }),
    output: pipelinesOutput,
  },
  jobs: {
    input: contextInput.extend({
      projectId: id,
      pipelineId: id,
      page,
      ...mrContext,
    }),
    output: jobsOutput,
  },
  trace: {
    input: contextInput.extend({
      projectId: id,
      pipelineId: id,
      jobId: id,
      ...mrContext,
    }),
    output: traceOutput,
  },
  commits: { input: contextInput.extend({ page }), output: commitsOutput },
});
