import { describe, expect, it } from "vitest";
import { takeContextFlags, targetPath } from "./node-target";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome } from "./test-support";

describe("fixed node context", () => {
  it("uses the existing hub proxy, never a direct peer URL", () => {
    expect(targetPath({ url: "http://hub", token: "t", nodeId: "B /" }, "/api/live")).toBe(
      "/api/n/B%20%2F/api/live",
    );
    expect(targetPath({ url: "http://hub", token: "t" }, "/api/live")).toBe("/api/live");
    expect(takeContextFlags(["send", "7", "go", "--node=B", "--machine"])).toEqual({
      machine: true,
      nodeId: "B",
      rest: ["send", "7", "go"],
    });
    expect(() => takeContextFlags(["--node"])).toThrow("stable node ID");
  });
  it("targets B/7 when A also has 7; errors never retry A", async () => {
    const fake = new FakeTau();
    fake.answers.set("POST /api/n/B/api/conversations/7/messages", {
      status: 502,
      body: { error: { code: "no_route", message: "B disconnected" } },
    });
    await expect(
      executeApiCommand("threads", ["send", "7", "go", "--node", "B", "--machine"], fake.env(makeHome())),
    ).rejects.toMatchObject({ code: "no_route" });
    expect(fake.calls.map((call) => call.path)).toEqual(["/api/n/B/api/conversations/7/messages"]);
    expect(JSON.parse(fake.stdout[0] as string)).toMatchObject({
      nodeId: "B",
      threadId: "7",
      error: { code: "no_route" },
    });
  });
  it("keeps dedicated directory dispatch under the node context", async () => {
    const fake = new FakeTau();
    fake.answers.set("GET /api/n/B/api/nodes/directory", { status: 200, body: [] });
    await executeApiCommand("nodes", ["list", "--node", "B", "--machine"], fake.env(makeHome()));
    expect(fake.calls[0]?.path).toBe("/api/n/B/api/nodes/directory");
  });
});
