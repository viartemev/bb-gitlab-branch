import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFakePluginHost,
  makeThreadResponse,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

test("server resolves the thread environment's machine and keeps settings out of frontend results", async () => {
  const snapshot = {
    outcome: "not-gitlab",
    message: "No GitLab remote",
    checkout: null,
    mergeRequests: [],
    pipelines: [],
    nextMrPage: null,
    nextPipelinePage: null,
    fetchedAt: new Date().toISOString(),
    warnings: [],
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "gitlab-branch",
    experimental_hostEntry: true,
    settings: { token: "secret", hostname: "gitlab.example.test" },
    sdk: {
      threads: {
        get: async () => makeThreadResponse({ environmentId: "env_remote" }),
      },
      environments: {
        get: async () =>
          ({
            id: "env_remote",
            hostId: "host_remote",
            path: "/remote/worktree",
          }) as any,
      },
    },
    experimental_callHostRpc: async () => snapshot,
  });
  try {
    await plugin(bb);
    const result = await harness.behavior.callRpc("snapshot", {
      threadId: "t1",
    });
    assert.equal(JSON.stringify(result).includes("secret"), false);
    const call = harness.experimental_hostRpcCalls[0]!;
    assert.equal(call.hostId, "host_remote");
    assert.equal((call.input as any).path, "/remote/worktree");
    assert.equal((call.input as any).settings.token, "secret");
    await assert.rejects(
      harness.behavior.callRpc("jobs", {
        threadId: "t1",
        key: "k",
        projectId: "../bad",
        pipelineId: 1,
      }),
    );
    await assert.rejects(
      harness.behavior.callRpc("discussions", {
        threadId: "t1",
        key: "k",
        projectId: 1,
        iid: 2,
        page: 0,
      }),
    );
    await assert.rejects(
      harness.behavior.setSettings({ hostname: "https://gitlab.example.test" }),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
test("no environment produces an actionable error without host calls", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "gitlab-branch",
    experimental_hostEntry: true,
    sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: null }) },
    },
  });
  try {
    await plugin(bb);
    await assert.rejects(
      harness.behavior.callRpc("snapshot", { threadId: "t1" }),
      /окружения/,
    );
    assert.equal(harness.experimental_hostRpcCalls.length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});
test("uses only public SDK imports", async () => {
  const report = await experimental_scanPublicSdkOnly(process.cwd(), {
    allow: [/^(react|react-dom\/client|jsdom|@testing-library\/react)$/],
  });
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.privateDependencies, []);
});
