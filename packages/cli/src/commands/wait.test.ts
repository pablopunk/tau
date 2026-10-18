import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome, summary, viewWith } from "./test-support";
import { assessThread } from "./wait";

function setup(first: Parameters<typeof summary>[1], queued: readonly string[] = []) {
  const fake = new FakeTau();
  fake.summaries = [summary("t1", first)];
  fake.views.set("t1", viewWith("the answer", queued));
  return { fake, env: fake.env(makeHome()) };
}

describe("assessThread", () => {
  const view = viewWith("done text");

  it("is done only when idle, a run ended after R0, the queue is empty and no child runs", () => {
    const idle = [summary("t1", { lastRunEndedAt: 20 })];
    expect(assessThread(idle, "t1", view, 10)).toEqual({ state: "done", answer: "done text" });
    expect(assessThread(idle, "t1", view, 20).state).toBe("waiting");
    expect(assessThread(idle, "t1", view, undefined).state).toBe("done");
    expect(assessThread(idle, "t1", viewWith("x", ["queued"]), 10).state).toBe("waiting");
    const running = [summary("t1", { status: "running", lastRunEndedAt: 20 })];
    expect(assessThread(running, "t1", view, 10).state).toBe("waiting");
    expect(assessThread(idle, "t1", viewWith("midway", [], true), 10).state).toBe("waiting");
  });

  it("treats a null R0 as any finished run", () => {
    expect(assessThread([summary("t1")], "t1", view, null).state).toBe("waiting");
    expect(assessThread([summary("t1", { lastRunEndedAt: 1 })], "t1", view, null).state).toBe("done");
  });

  it("waits for a running grandchild", () => {
    const all = [
      summary("t1", { lastRunEndedAt: 20 }),
      summary("c1", { parentId: "t1", agentStatus: "done" }),
      summary("g1", { parentId: "c1", agentStatus: "running" }),
    ];
    expect(assessThread(all, "t1", view, 10).state).toBe("waiting");
  });
});

describe("--wait against a scripted server", () => {
  it("send: already idle with an old run does not finish until a new run ends", async () => {
    const { fake, env } = setup({ lastRunEndedAt: 10 });
    const done = executeApiCommand("threads", ["send", "t1", "hi", "--wait"], env);
    await fake.quiet();
    expect(fake.stdout.join("")).not.toContain("the answer");
    fake.summaries = [summary("t1", { status: "running", lastRunEndedAt: 10 })];
    fake.pushChanged();
    await fake.quiet();
    fake.summaries = [summary("t1", { lastRunEndedAt: 20 })];
    fake.pushChanged();
    await done;
    expect(fake.stdout.at(-1)).toBe("\nthe answer");
    expect(fake.socketHeaders[0]).toMatchObject({ authorization: expect.stringMatching(/^Bearer /) });
  });

  it("send: a message queued behind a running run counts as not done", async () => {
    const { fake, env } = setup({ status: "running", lastRunEndedAt: 10 }, ["next"]);
    const done = executeApiCommand("threads", ["send", "t1", "hi", "--wait"], env);
    await fake.quiet();
    fake.summaries = [summary("t1", { lastRunEndedAt: 20 })];
    fake.pushChanged();
    await fake.quiet();
    expect(fake.stdout.join("")).not.toContain("the answer");
    fake.pushView("t1", viewWith("the answer"));
    await done;
    expect(fake.stdout.at(-1)).toBe("\nthe answer");
  });

  it("send: does not print an answer from a view that has not caught up with the ended run", async () => {
    const { fake, env } = setup({ lastRunEndedAt: 10 });
    fake.views.set("t1", viewWith("midway", [], true));
    const done = executeApiCommand("threads", ["send", "t1", "hi", "--wait"], env);
    await fake.quiet();
    fake.summaries = [summary("t1", { lastRunEndedAt: 20 })];
    fake.pushChanged();
    await fake.quiet();
    expect(fake.stdout.join("")).not.toContain("midway");
    fake.pushView("t1", viewWith("the final answer"));
    await done;
    expect(fake.stdout.at(-1)).toBe("\nthe final answer");
  });

  it("start: waits for a child that runs after the parent goes idle", async () => {
    const fake = new FakeTau();
    fake.answers.set("POST /api/conversations", { status: 201, body: summary("t1") });
    fake.summaries = [
      summary("t1", { lastRunEndedAt: 20 }),
      summary("c1", { parentId: "t1", agentStatus: "running" }),
    ];
    fake.views.set("t1", viewWith("the answer"));
    const done = executeApiCommand(
      "threads",
      ["start", "go", "--project", "p1", "--wait"],
      fake.env(makeHome()),
    );
    await fake.quiet();
    expect(fake.stdout.join("")).not.toContain("the answer");
    fake.summaries = [
      summary("t1", { lastRunEndedAt: 20 }),
      summary("c1", { parentId: "t1", agentStatus: "done" }),
    ];
    fake.pushChanged();
    await done;
    expect(fake.stdout.at(-1)).toBe("\nthe answer");
  });

  it("exits 3 on timeout", async () => {
    const { env } = setup({ status: "running" });
    const error = await executeApiCommand(
      "threads",
      ["send", "t1", "hi", "--wait", "--timeout", "0.05"],
      env,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliExit);
    expect((error as CliExit).exitCode).toBe(3);
  });

  it("exits 1 and prints the error when the thread ends in error", async () => {
    const { fake, env } = setup({ status: "error", lastRunEndedAt: 20 });
    fake.views.set("t1", {
      entries: [
        {
          id: 1,
          kind: "pi.assistant",
          model: [{ role: "assistant", content: [], errorMessage: "model exploded" }],
        },
      ],
      docs: {},
    } as never);
    const error = await executeApiCommand("threads", ["wait", "t1"], env).catch((caught: unknown) => caught);
    expect((error as CliExit).exitCode).toBe(1);
    expect((error as CliExit).message).toBe("model exploded");
  });

  it("threads wait prints the answer without needing a new run", async () => {
    const { fake, env } = setup({ lastRunEndedAt: 5 });
    await executeApiCommand("threads", ["wait", "t1"], env);
    expect(fake.stdout).toEqual(["the answer"]);
  });

  it("threads read prints the transcript, last N", async () => {
    const { fake, env } = setup({});
    await executeApiCommand("threads", ["read", "t1", "--last", "1"], env);
    expect(fake.stdout).toEqual(["assistant: the answer"]);
  });
});
