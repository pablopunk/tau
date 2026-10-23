import { emptyHandoffLosses, type HandoffPreview } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { helpText } from "./help";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome, nativeSummary } from "./test-support";

const PREVIEW_PATH = "GET /api/conversations/t1/handoff-preview";
const HANDOFF_PATH = "POST /api/conversations/t1/handoff";

const readyPreview: HandoffPreview = {
  canHandoff: true,
  losses: { ...emptyHandoffLosses(), imagesOmitted: 2, turnsDropped: 3, exportedChars: 321 },
  preview: "User: fix the build",
};

const blockedPreview: HandoffPreview = {
  canHandoff: false,
  reason: "this thread is running; wait for it to finish or stop it first",
  losses: emptyHandoffLosses(),
  preview: "",
};

const handoffCalls = (fake: FakeTau) => fake.calls.filter((call) => call.method === "POST");

const exitOf = async (promise: Promise<unknown>): Promise<CliExit> => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CliExit);
  return error as CliExit;
};

describe("tau threads handoff", () => {
  it("is a dry run by default: prints the preview and the losses, exits 0 and creates nothing", async () => {
    const fake = new FakeTau();
    fake.answers.set(PREVIEW_PATH, { status: 200, body: readyPreview });

    await executeApiCommand("threads", ["handoff", "t1"], fake.env(makeHome()));

    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/conversations/t1/handoff-preview",
    ]);
    const output = fake.stdout.join("\n");
    expect(output).toContain("Thread t1 can be handed off.");
    expect(output).toContain("images omitted 2");
    expect(output).toContain("turns dropped 3");
    expect(output).toContain("Exported characters: 321.");
    expect(output).toContain("User: fix the build");
    expect(output).toContain("Nothing was created.");
    expect(output).toContain("--yes");
  });

  it("still only previews, and says why, when the thread cannot be handed off", async () => {
    const fake = new FakeTau();
    fake.answers.set(PREVIEW_PATH, { status: 200, body: blockedPreview });

    await executeApiCommand("threads", ["handoff", "t1", "--instruction", "go"], fake.env(makeHome()));

    expect(handoffCalls(fake)).toEqual([]);
    expect(fake.stdout.join("\n")).toContain("cannot be handed off: this thread is running");
    expect(fake.stdout.join("\n")).not.toContain("Add --yes");
  });

  it("with --yes performs the handoff and prints the new thread like threads start does", async () => {
    const fake = new FakeTau();
    const created = nativeSummary("t2", {
      title: "Handoff: one",
      forkOf: { conversationId: "t1", entryId: "9" },
    });
    fake.answers.set(HANDOFF_PATH, { status: 201, body: created });

    await executeApiCommand(
      "threads",
      ["handoff", "t1", "--instruction", "Continue the work", "--yes"],
      fake.env(makeHome()),
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/conversations/t1/handoff",
      body: { instruction: "Continue the work" },
    });
    expect(fake.calls[0]?.body).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.parse(fake.stdout[0] as string)).toMatchObject({ id: "t2", executor: "claude-code" });
  });

  it("sends no instruction when none is given and a fresh requestId each time", async () => {
    const fake = new FakeTau();
    fake.answers.set(HANDOFF_PATH, { status: 201, body: nativeSummary("t2") });

    await executeApiCommand("threads", ["handoff", "t1", "--yes"], fake.env(makeHome()));
    await executeApiCommand("threads", ["handoff", "t1", "--yes"], fake.env(makeHome()));

    const bodies = fake.calls.map((call) => call.body as Record<string, string>);
    expect(bodies[0]).not.toHaveProperty("instruction");
    expect(bodies[0]?.requestId).not.toBe(bodies[1]?.requestId);
  });

  it("fails with exit 1 and the server's reason when the handoff is refused", async () => {
    const fake = new FakeTau();
    fake.answers.set(HANDOFF_PATH, {
      status: 409,
      body: { error: { code: "thread_busy", message: "this thread is running" } },
    });

    const exit = await exitOf(executeApiCommand("threads", ["handoff", "t1", "--yes"], fake.env(makeHome())));

    expect(exit.exitCode).toBe(1);
    expect(exit.message).toBe("thread_busy: this thread is running");
  });

  it("exits 2 on a usage error before any request", async () => {
    const fake = new FakeTau();
    const home = makeHome();

    for (const argv of [
      ["handoff"],
      ["handoff", "a", "b"],
      ["handoff", "t1", "--instruction"],
      ["handoff", "t1", "--nope"],
    ]) {
      const exit = await exitOf(executeApiCommand("threads", argv, fake.env(home)));
      expect(exit.exitCode).toBe(2);
    }
    const long = await exitOf(
      executeApiCommand("threads", ["handoff", "t1", "--instruction", "x".repeat(4001)], fake.env(home)),
    );
    expect(long.exitCode).toBe(2);
    expect(fake.calls).toEqual([]);
  });

  it("is listed in the threads help and has its own help text", async () => {
    const fake = new FakeTau();

    await executeApiCommand("threads", ["handoff", "--help"], fake.env(makeHome()));

    expect(helpText("threads")).toContain("handoff <id>");
    expect(fake.stdout[0]).toContain("handoff <id>");
    expect(fake.calls).toEqual([]);
  });
});
