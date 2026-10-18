import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome, summary } from "./test-support";

const exitOf = async (promise: Promise<unknown>): Promise<CliExit> => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CliExit);
  return error as CliExit;
};

describe("executeApiCommand", () => {
  it("calls the route and prints JSON", async () => {
    const fake = new FakeTau();
    fake.answers.set("GET /api/settings", { status: 200, body: { projectsFolder: "/x" } });
    await executeApiCommand("settings", ["get"], fake.env(makeHome()));
    expect(JSON.parse(fake.stdout[0] as string)).toEqual({ projectsFolder: "/x" });
  });

  it("prints ok for an empty answer", async () => {
    const fake = new FakeTau();
    await executeApiCommand("threads", ["rename", "t1", "New"], fake.env(makeHome()));
    expect(fake.calls[0]).toMatchObject({
      method: "PATCH",
      path: "/api/conversations/t1",
      body: { title: "New" },
    });
    expect(JSON.parse(fake.stdout[0] as string)).toEqual({ ok: true });
  });

  it("prints help from the table", async () => {
    const fake = new FakeTau();
    await executeApiCommand("threads", ["send", "--help"], fake.env(makeHome()));
    expect(fake.stdout[0]).toContain("tau threads send <id> <text>");
    expect(fake.stdout[0]).toContain("--when-busy");
    expect(fake.calls).toEqual([]);
  });

  it("exits 2 on a usage error before any request", async () => {
    const fake = new FakeTau();
    const exit = await exitOf(executeApiCommand("threads", ["send", "t1"], fake.env(makeHome())));
    expect(exit.exitCode).toBe(2);
    expect(fake.calls).toEqual([]);
  });

  it("needs --yes for destructive commands", async () => {
    const fake = new FakeTau();
    const exit = await exitOf(executeApiCommand("threads", ["delete", "t1"], fake.env(makeHome())));
    expect(exit.exitCode).toBe(2);
    expect(exit.message).toContain("--yes");
    await executeApiCommand("threads", ["delete", "t1", "--yes"], fake.env(makeHome()));
    expect(fake.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/conversations/t1" });
  });

  it("refuses to delete or archive its own thread and its parents", async () => {
    const fake = new FakeTau();
    fake.summaries = [
      summary("root"),
      summary("mid", { parentId: "root" }),
      summary("me", { parentId: "mid" }),
      summary("other"),
    ];
    const env = fake.env(makeHome(), { env: { TAU_THREAD_ID: "me" } });
    for (const id of ["me", "mid", "root"]) {
      const exit = await exitOf(executeApiCommand("threads", ["delete", id, "--yes"], env));
      expect(exit.exitCode).toBe(1);
      expect(exit.message).toContain("your own thread");
    }
    await exitOf(executeApiCommand("threads", ["archive", "mid"], env));
    await executeApiCommand("threads", ["archive", "other"], env);
    expect(fake.calls.some((call) => call.method === "PUT" && call.path.endsWith("/other/archived"))).toBe(
      true,
    );
  });
});
