import { AppError, ERROR_STATUS, type ErrorCode } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./testing/harness";

let ctx: TestServer;
afterEach(async () => {
  await ctx.server.close();
  await ctx.core.close();
});

const NEW_CODES: ReadonlyArray<ErrorCode> = [
  "thread_busy",
  "merge_conflict",
  "base_dirty",
  "not_on_base",
  "worktree_dirty",
  "has_unmerged_work",
];

async function startThread(text: string, workspace: "worktree" | "checkout" = "worktree") {
  const project = await ctx.core.projects.add({ path: "/Users/demo/project" });
  const response = await ctx.request({
    method: "POST",
    url: "/api/conversations",
    payload: { projectId: project.id, text, requestId: `r-${text}`, workspace },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; workspace: { mode: string; branch: string | null } };
}

async function settle(id: string, until: (kinds: string[]) => boolean) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const checkpoints = (await ctx.request({ url: `/api/conversations/${id}/checkpoints` })).json();
    if (until(checkpoints.map((item: { kind: string }) => item.kind))) return checkpoints;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the run");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settled = (id: string) => settle(id, (kinds) => kinds.includes("after"));

describe("MVP5 error codes", () => {
  it.each(NEW_CODES)("maps %s to 409 with its message", async (code) => {
    expect(ERROR_STATUS[code]).toBe(409);
    const core = createFakeCore({ configured: true });
    core.workspaces.merge = async () => {
      throw new AppError(code, `boom ${code}`);
    };
    ctx = await startTestServer({ core });
    const response = await ctx.request({ method: "POST", url: "/api/conversations/1/workspace/merge" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code, message: `boom ${code}` } });
  });
});

describe("settings routes", () => {
  it("stores the message mode and the workspace default", async () => {
    ctx = await startTestServer();
    const mode = await ctx.request({
      method: "PUT",
      url: "/api/settings/message-mode",
      payload: { mode: "queue" },
    });
    const place = await ctx.request({
      method: "PUT",
      url: "/api/settings/workspace-default",
      payload: { mode: "checkout" },
    });
    expect([mode.statusCode, place.statusCode]).toEqual([204, 204]);
    expect((await ctx.request({ url: "/api/settings" })).json()).toMatchObject({
      messageMode: "queue",
      workspaceDefault: "checkout",
    });
  });

  it("rejects an unknown mode", async () => {
    ctx = await startTestServer();
    const response = await ctx.request({
      method: "PUT",
      url: "/api/settings/message-mode",
      payload: { mode: "sometimes" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("workspace routes", () => {
  it("starts a thread with a workspace and reads its status", async () => {
    ctx = await startTestServer();
    const thread = await startThread("hello");
    expect(thread.workspace).toMatchObject({ mode: "worktree", branch: expect.stringMatching(/^pi\//) });
    await settled(thread.id);
    const status = await ctx.request({ url: `/api/conversations/${thread.id}/workspace` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ canMerge: true, dirtyFiles: [] });
  });

  it("answers invalid_request for a checkout thread and not_found for an unknown one", async () => {
    ctx = await startTestServer();
    const thread = await startThread("hello", "checkout");
    const checkout = await ctx.request({ url: `/api/conversations/${thread.id}/workspace` });
    expect(checkout.statusCode).toBe(400);
    expect(checkout.json().error.code).toBe("invalid_request");
    const unknown = await ctx.request({ url: "/api/conversations/nope/workspace" });
    expect(unknown.statusCode).toBe(404);
  });

  it("merges, then opens a pull request", async () => {
    ctx = await startTestServer();
    const thread = await startThread("hello");
    await settled(thread.id);
    const merged = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/workspace/merge`,
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().workspace).toMatchObject({ state: "merged" });
    const pr = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/workspace/pull-request`,
    });
    expect(pr.json().workspace.pullRequestUrl).toEqual(expect.any(String));
  });

  it("refuses to merge a dirty worktree and removes it with force=true", async () => {
    ctx = await startTestServer();
    const thread = await startThread("write a file");
    await settled(thread.id);
    const merge = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/workspace/merge`,
    });
    expect(merge.statusCode).toBe(409);
    expect(merge.json().error.code).toBe("worktree_dirty");
    const guarded = await ctx.request({ method: "DELETE", url: `/api/conversations/${thread.id}/workspace` });
    expect(guarded.json().error.code).toBe("has_unmerged_work");
    const forced = await ctx.request({
      method: "DELETE",
      url: `/api/conversations/${thread.id}/workspace?force=true`,
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().workspace.state).toBe("removed");
  });

  it("guards deleting a thread with unmerged work unless force=true", async () => {
    ctx = await startTestServer();
    const thread = await startThread("write a file");
    await settled(thread.id);
    const guarded = await ctx.request({ method: "DELETE", url: `/api/conversations/${thread.id}` });
    expect(guarded.statusCode).toBe(409);
    const forced = await ctx.request({ method: "DELETE", url: `/api/conversations/${thread.id}?force=true` });
    expect(forced.statusCode).toBe(204);
  });
});

describe("checkpoint, fork and queue routes", () => {
  it("lists checkpoints and a file diff, and rejects an unsafe path", async () => {
    ctx = await startTestServer();
    const thread = await startThread("write a file", "checkout");
    const checkpoints = await settled(thread.id);
    const after = checkpoints.find((item: { kind: string }) => item.kind === "after");
    const base = `/api/conversations/${thread.id}/checkpoints/${encodeURIComponent(after.id)}/diff`;
    const diff = await ctx.request({ url: `${base}?path=${after.files[0].path}` });
    expect(diff.statusCode).toBe(200);
    expect(diff.json().diff).toContain(after.files[0].path);
    expect((await ctx.request({ url: `${base}?path=../x` })).json().error.code).toBe("invalid_request");
    expect((await ctx.request({ url: base })).statusCode).toBe(400);
  });

  it("previews a rewind, rewinds, and forks", async () => {
    ctx = await startTestServer();
    const thread = await startThread("write a file", "checkout");
    const [before] = await settled(thread.id);
    const body = { entryId: before.entryId };
    const preview = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/rewind/preview`,
      payload: body,
    });
    expect(preview.json().changes.length).toBeGreaterThan(0);
    const rewind = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/rewind`,
      payload: body,
    });
    expect(rewind.statusCode).toBe(200);
    expect(rewind.json()).toMatchObject({
      draft: "write a file",
      conversation: { forkOf: { entryId: before.entryId } },
    });
    const fork = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/fork`,
      payload: body,
    });
    expect(fork.statusCode).toBe(201);
    expect(fork.json().title).toMatch(/^Fork of /);
  });

  it("rejects a fork without an entry id", async () => {
    ctx = await startTestServer();
    const thread = await startThread("hello", "checkout");
    const response = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/fork`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("queues a follow-up message and cancels it", async () => {
    ctx = await startTestServer({ fake: { speed: 1 } });
    const thread = await startThread("bash sleep 30", "checkout");
    const send = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/messages`,
      payload: { text: "later", requestId: "q1", whenBusy: "followUp" },
    });
    expect(send.statusCode).toBe(204);
    const cancel = await ctx.request({ method: "DELETE", url: `/api/conversations/${thread.id}/queue/1001` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toEqual({ cancelled: true });
    const again = await ctx.request({ method: "DELETE", url: `/api/conversations/${thread.id}/queue/1001` });
    expect(again.json()).toEqual({ cancelled: false });
  });

  it("rejects an unknown whenBusy value", async () => {
    ctx = await startTestServer();
    const thread = await startThread("hello", "checkout");
    const response = await ctx.request({
      method: "POST",
      url: `/api/conversations/${thread.id}/messages`,
      payload: { text: "x", requestId: "q2", whenBusy: "maybe" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("process routes", () => {
  it("lists, reads the logs of, and stops a process", async () => {
    ctx = await startTestServer();
    const thread = await startThread("bg node server.js", "checkout");
    const list = await ctx.request({ url: `/api/conversations/${thread.id}/processes` });
    const [info] = list.json();
    expect(info).toMatchObject({ command: "node server.js", state: "running", conversationId: thread.id });
    const logs = await ctx.request({ url: `/api/processes/${info.id}/logs?tail=1` });
    expect(logs.statusCode).toBe(200);
    expect(typeof logs.json().logs).toBe("string");
    expect((await ctx.request({ url: `/api/processes/${info.id}/logs` })).statusCode).toBe(200);
    const stop = await ctx.request({ method: "DELETE", url: `/api/processes/${info.id}` });
    expect(stop.statusCode).toBe(204);
    expect((await ctx.request({ url: `/api/conversations/${thread.id}/processes` })).json()[0].state).toBe(
      "killed",
    );
  });

  it("answers not_found for an unknown process and rejects a bad tail", async () => {
    ctx = await startTestServer();
    expect((await ctx.request({ url: "/api/processes/nope/logs" })).statusCode).toBe(404);
    expect((await ctx.request({ method: "DELETE", url: "/api/processes/nope" })).statusCode).toBe(404);
    expect((await ctx.request({ url: "/api/processes/nope/logs?tail=0" })).statusCode).toBe(400);
  });
});

describe("mcp routes", () => {
  const STDIO = { name: "files", command: "node", args: ["a.js"], env: { TOKEN: "secret" } };

  it("saves, lists and removes a server without leaking secrets", async () => {
    ctx = await startTestServer();
    const put = await ctx.request({ method: "PUT", url: "/api/mcp/servers/files", payload: STDIO });
    expect(put.statusCode).toBe(204);
    const list = await ctx.request({ url: "/api/mcp/servers" });
    expect(list.json()).toEqual([
      { name: "files", source: "settings", transport: "stdio", state: "idle", toolCount: null, error: null },
    ]);
    expect(list.body).not.toContain("secret");
    const removed = await ctx.request({ method: "DELETE", url: "/api/mcp/servers/files" });
    expect(removed.statusCode).toBe(204);
    expect((await ctx.request({ url: "/api/mcp/servers" })).json()).toEqual([]);
  });

  it("takes the name from the path and accepts an http server", async () => {
    ctx = await startTestServer();
    const http = { name: "ignored", url: "https://example.com/mcp", headers: {} };
    await ctx.request({ method: "PUT", url: "/api/mcp/servers/docs", payload: http });
    expect((await ctx.request({ url: "/api/mcp/servers" })).json()).toMatchObject([
      { name: "docs", transport: "http" },
    ]);
  });

  it("rejects a server with neither command nor url and an unknown project", async () => {
    ctx = await startTestServer();
    const bad = await ctx.request({ method: "PUT", url: "/api/mcp/servers/x", payload: { name: "x" } });
    expect(bad.statusCode).toBe(400);
    expect((await ctx.request({ url: "/api/mcp/servers?projectId=nope" })).statusCode).toBe(404);
  });
});
