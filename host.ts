import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";
import { GitLabReader } from "./gitlab";
import { run } from "./command";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    snapshot: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).snapshot(
        a.mrPage,
        a.pipelinePage,
      ),
    mr: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).mr(
        a.key,
        a.projectId,
        a.iid,
      ),
    discussions: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).discussions(
        a.key,
        a.projectId,
        a.iid,
        a.page,
      ),
    codeContext: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).codeContext(
        a.key,
        a.projectId,
        a.iid,
        a.filePath,
        a.ref,
        a.line,
      ),
    pipelines: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).pipelines(
        a.key,
        a.projectId,
        a.iid,
        a.page,
      ),
    jobs: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).jobs(
        a.key,
        a.projectId,
        a.pipelineId,
        a.page,
        a.mrProjectId,
        a.mrIid,
      ),
    trace: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).trace(
        a.key,
        a.projectId,
        a.pipelineId,
        a.jobId,
        a.mrProjectId,
        a.mrIid,
      ),
    commits: (a, c) =>
      new GitLabReader(a.path, a.settings, run, c.signal).commits(
        a.key,
        a.page,
      ),
  },
});
