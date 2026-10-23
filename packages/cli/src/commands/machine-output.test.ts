import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome, summary, viewWith } from "./test-support";

const frames = (fake: FakeTau) => fake.stdout.map((line) => JSON.parse(line));

describe("NDJSON v1", () => {
  it("keeps --json as body and returns all envelope fields", async () => {
    const fake = new FakeTau();
    await executeApiCommand(
      "settings",
      ["set-projects-folder", "/synthetic", "--json", '{"path":"/synthetic"}', "--machine"],
      fake.env(makeHome()),
    );
    expect(fake.calls[0]?.body).toEqual({ path: "/synthetic" });
    expect(frames(fake)[0]).toEqual({
      version: 1,
      kind: "terminal",
      command: "settings set-projects-folder",
      nodeId: null,
      threadId: null,
      terminalId: null,
      requestId: null,
      submissionId: null,
      entryId: null,
      lifecycle: null,
      observation: "response",
      result: { ok: true },
      error: null,
      event: null,
    });
  });
  it("emits parse errors even without a running server", async () => {
    const fake = new FakeTau();
    await expect(
      executeApiCommand("threads", ["send", "--machine"], fake.env("/nonexistent-synthetic-home")),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(frames(fake)[0]).toMatchObject({ kind: "error", error: { source: "cli", code: "usage" } });
    expect(fake.calls).toHaveLength(0);
  });
  it("preserves protocol codes", async () => {
    const fake = new FakeTau();
    fake.answers.set("POST /api/conversations/7/messages", {
      status: 403,
      body: { error: { code: "forbidden", message: "denied" } },
    });
    await expect(
      executeApiCommand(
        "threads",
        ["send", "7", "go", "--machine", "--request-id", "r7"],
        fake.env(makeHome()),
      ),
    ).rejects.toBeInstanceOf(CliExit);
    expect(frames(fake)[0]).toMatchObject({
      kind: "error",
      threadId: "7",
      requestId: "r7",
      error: { source: "protocol", code: "forbidden" },
    });
  });
  it("never fabricates start submission identity", async () => {
    const fake = new FakeTau();
    fake.answers.set("POST /api/conversations", { status: 201, body: summary("7") });
    await executeApiCommand("threads", ["start", "--project", "p1", "go", "--machine"], fake.env(makeHome()));
    expect(frames(fake)[0]).toMatchObject({
      kind: "receipt",
      threadId: "7",
      submissionId: null,
      lifecycle: null,
    });
  });
  it("wait emits receipt and terminal thread-idle without appended prose", async () => {
    const fake = new FakeTau();
    fake.summaries = [summary("7", { lastRunEndedAt: 2 })];
    fake.views.set("7", viewWith("answer"));
    fake.answers.set("POST /api/conversations", { status: 201, body: summary("7") });
    await executeApiCommand(
      "threads",
      ["start", "--project", "p1", "go", "--machine", "--wait"],
      fake.env(makeHome()),
    );
    expect(frames(fake).map((frame) => frame.kind)).toEqual(["receipt", "terminal"]);
    expect(frames(fake)[1]).toMatchObject({ observation: "thread-idle", result: "answer", lifecycle: null });
  });
  it("never treats --yes as typed node-removal confirmation", async () => {
    const fake = new FakeTau();
    await expect(
      executeApiCommand("nodes", ["remove", "B", "--yes", "--machine"], fake.env(makeHome())),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(fake.calls).toHaveLength(0);
    expect(frames(fake)[0].error.code).toBe("usage");
  });
  it("machine discovery uses the command table without HTTP", async () => {
    const fake = new FakeTau();
    await executeApiCommand("settings", ["discover", "--machine"], fake.env(makeHome()));
    expect(
      frames(fake)[0].result.commands.some((row: { route: string }) => row.route === "updateTodos"),
    ).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("machine observers", () => {
  it("shares remote context for live frames and REST polling", async () => {
    const fake = new FakeTau();
    fake.views.set("7", viewWith("remote answer"));
    fake.answers.set("GET /api/n/B/api/conversations", {
      status: 200,
      body: [summary("7", { lastRunEndedAt: 1 })],
    });
    const base = fake.env(makeHome());
    const urls: string[] = [];
    await executeApiCommand("threads", ["wait", "7", "--node", "B", "--machine"], {
      ...base,
      openSocket: (url, headers) => {
        urls.push(url);
        return base.openSocket(url, headers);
      },
    });
    expect(urls[0]).toContain("/api/n/B/api/live");
    expect(fake.calls.every((call) => call.path.startsWith("/api/n/B/"))).toBe(true);
    expect(frames(fake)[0]).toMatchObject({
      result: "remote answer",
      observation: "thread-idle",
      nodeId: "B",
    });
  });
  it("SIGINT ends observation with 130, not an abort mutation", async () => {
    const fake = new FakeTau();
    fake.summaries = [summary("7", { status: "running" })];
    fake.views.set("7", viewWith("", [], true));
    let interrupt: () => void = () => undefined;
    const run = executeApiCommand(
      "threads",
      ["wait", "7", "--machine"],
      fake.env(makeHome(), {
        onInterrupt: (fn) => {
          interrupt = fn;
          return () => undefined;
        },
      }),
    );
    const rejected = expect(run).rejects.toMatchObject({ exitCode: 130, code: "wait_interrupted" });
    await fake.quiet();
    interrupt();
    await rejected;
    expect(fake.calls.every((call) => call.method === "GET")).toBe(true);
    expect(frames(fake)[0].error.code).toBe("wait_interrupted");
  });
  it("deadline ends observation with 3 without cancelling the run", async () => {
    const fake = new FakeTau();
    fake.summaries = [summary("7", { status: "running" })];
    fake.views.set("7", viewWith("", [], true));
    await expect(
      executeApiCommand("threads", ["wait", "7", "--timeout", "0.01", "--machine"], fake.env(makeHome())),
    ).rejects.toMatchObject({ exitCode: 3, code: "wait_timeout" });
    expect(fake.calls.every((call) => call.method === "GET")).toBe(true);
    expect(frames(fake)[0].error.code).toBe("wait_timeout");
  });
});
