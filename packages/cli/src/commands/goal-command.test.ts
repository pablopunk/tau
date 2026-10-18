import { describe, expect, it } from "vitest";
import { executeApiCommand } from "./run-command";
import { FakeTau, makeHome } from "./test-support";

describe("tau goal", () => {
  it("sets a goal with the condition as the body", async () => {
    const fake = new FakeTau();
    await executeApiCommand("goal", ["set", "t1", "all tests pass"], fake.env(makeHome()));
    expect(fake.calls[0]).toMatchObject({
      method: "PUT",
      path: "/api/conversations/t1/goal",
      body: { condition: "all tests pass" },
    });
  });

  it("shows the goal of a thread", async () => {
    const fake = new FakeTau();
    fake.answers.set("GET /api/conversations/t1/goal", {
      status: 200,
      body: { condition: "x", state: "active" },
    });
    await executeApiCommand("goal", ["show", "t1"], fake.env(makeHome()));
    expect(JSON.parse(fake.stdout[0] as string)).toMatchObject({ condition: "x", state: "active" });
  });

  it("clears the goal of a thread", async () => {
    const fake = new FakeTau();
    await executeApiCommand("goal", ["clear", "t1"], fake.env(makeHome()));
    expect(fake.calls[0]).toMatchObject({ method: "DELETE", path: "/api/conversations/t1/goal" });
  });
});
