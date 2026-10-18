import { COMMAND_NOUNS } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import { type CommandHandler, commandTable, resolveCommand, UnknownCommandError } from "./main";
import { commandWordOf } from "./options";

function spies() {
  const bare = vi.fn<CommandHandler>(async () => undefined);
  const table = Object.fromEntries(
    Object.keys(commandTable).map((word) => [word, vi.fn<CommandHandler>(async () => undefined)]),
  );
  return { bare, table };
}

describe("resolveCommand", () => {
  it("sends `serve --port 1` to serve with the flags", () => {
    const { bare, table } = spies();
    const { handler, argv } = resolveCommand(["serve", "--port", "1"], table, bare);
    expect(handler).toBe(table.serve);
    expect(argv).toEqual(["--port", "1"]);
  });

  it("sends bare `tau` and server flags alone to the bare handler", () => {
    const { bare, table } = spies();
    expect(resolveCommand([], table, bare).handler).toBe(bare);
    const flagged = resolveCommand(["--port", "9000", "--no-open"], table, bare);
    expect(flagged.handler).toBe(bare);
    expect(flagged.argv).toEqual(["--port", "9000", "--no-open"]);
  });

  it("knows every lifecycle word, `skill`, and every table noun", () => {
    const words = [
      "serve",
      "start",
      "stop",
      "restart",
      "status",
      "open",
      "logs",
      "service",
      "skill",
      ...COMMAND_NOUNS,
    ];
    for (const word of words) expect(commandTable[word], word).toBeTypeOf("function");
  });

  it("gives a noun the argv after it, flags included", () => {
    const { bare, table } = spies();
    const { handler, argv } = resolveCommand(
      ["threads", "start", "--project", "p1", "Fix it", "--wait"],
      table,
      bare,
    );
    expect(handler).toBe(table.threads);
    expect(argv).toEqual(["start", "--project", "p1", "Fix it", "--wait"]);
  });

  it("sends --help alone to help and rejects an unknown word", () => {
    const { bare, table } = spies();
    expect(resolveCommand(["--help"], table, bare).handler).toBe(table.help);
    expect(() => resolveCommand(["bogus"], table, bare)).toThrow(UnknownCommandError);
  });

  it("finds the word after a server flag with a value", () => {
    expect(commandWordOf(["--home", "/h", "start"])).toEqual({ word: "start", rest: ["--home", "/h"] });
  });
});
