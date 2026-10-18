import { commandOf } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse";

const parse = (command: string, ...argv: string[]) => {
  const def = commandOf(command);
  if (!def) throw new Error(`no command ${command}`);
  return parseCommand(def, argv);
};

describe("parseCommand", () => {
  it("maps positionals to params and body, and fills requestId", () => {
    const { input } = parse("threads send", "t1", "hello there");
    expect(input.params).toEqual({ id: "t1" });
    expect(input.body).toMatchObject({ text: "hello there" });
    expect((input.body as { requestId: string }).requestId).toMatch(/[0-9a-f-]{36}/);
  });

  it("keeps a requestId the user gives", () => {
    const { input } = parse("threads send", "t1", "hi", "--request-id", "mine");
    expect(input.body).toEqual({ text: "hi", requestId: "mine" });
  });

  it("reads flags, a model reference with slashes, and --flag=value", () => {
    const { input } = parse(
      "threads start",
      "go",
      "--project",
      "p1",
      "--model=openrouter/anthropic/claude",
      "--thinking-level",
      "high",
    );
    expect(input.body).toMatchObject({
      text: "go",
      projectId: "p1",
      model: { provider: "openrouter", modelId: "anthropic/claude" },
      thinkingLevel: "high",
    });
  });

  it("turns the literal none into null for a nullable field", () => {
    expect(parse("settings set-default-thinking", "none").input.body).toEqual({ thinkingLevel: null });
    expect(parse("settings set-fast-model", "none").input.body).toEqual({ model: null });
  });

  it("takes a whole-body model reference", () => {
    expect(parse("settings set-default-model", "openrouter/x/y").input.body).toEqual({
      provider: "openrouter",
      modelId: "x/y",
    });
  });

  it("handles --flag and --no-flag for booleans", () => {
    expect(parse("threads delete-archived", "--force", "--yes").input.body).toEqual({ force: true });
    expect(parse("threads delete-archived", "--no-force").input.body).toEqual({ force: false });
    expect(parse("threads delete-archived").input.body).toEqual({ force: false });
  });

  it("sends the query force flag as a string", () => {
    const { input } = parse("threads delete", "t1", "--force", "--yes");
    expect(input.query).toEqual({ force: "true" });
    expect(parse("workspaces remove", "t1", "--no-force").input.query).toEqual({ force: "false" });
  });

  it("uses --project for projectId in a query", () => {
    expect(parse("skills list", "--project", "p9").input.query).toEqual({ projectId: "p9" });
  });

  it("applies fixed fields", () => {
    expect(parse("threads archive", "t1").input.body).toEqual({ archived: true });
    expect(parse("threads unarchive", "t1").input.body).toEqual({ archived: false });
  });

  it("lets --json replace the whole body", () => {
    const { input } = parse("mcp save", "docs", "--json", '{"command":"npx","args":["x"],"env":{}}');
    expect(input.params).toEqual({ name: "docs" });
    expect(input.body).toEqual({ name: "docs", command: "npx", args: ["x"], env: {} });
  });

  it("does not merge flags into --json", () => {
    const { input } = parse("projects add", "/tmp/a", "--json", '{"path":"/tmp/b"}');
    expect(input.body).toEqual({ path: "/tmp/b" });
  });

  it("reads --wait and --timeout on start and send", () => {
    const parsed = parse("threads send", "t1", "hi", "--wait", "--timeout", "5");
    expect(parsed.wait).toBe(true);
    expect(parsed.timeoutSeconds).toBe(5);
  });

  it("exits with usage errors", () => {
    expect(() => parse("threads send", "t1")).toThrow(/Missing <text>/);
    expect(() => parse("threads send", "t1", "a", "b")).toThrow(/Unexpected argument/);
    expect(() => parse("threads rename", "t1", "x", "--nope")).toThrow(/Unknown flag/);
    expect(() => parse("threads start", "go")).toThrow(/projectId/);
    expect(() => parse("settings set-message-mode", "sideways")).toThrow(/Invalid body/);
    expect(() => parse("mcp save", "docs")).toThrow(/--json/);
    expect(() => parse("settings set-default-model", "nomodel")).toThrow(/provider\/modelId/);
  });

  it("treats everything after -- as positionals", () => {
    expect(parse("threads send", "t1", "--", "--not-a-flag").input.body).toMatchObject({
      text: "--not-a-flag",
    });
  });
});
