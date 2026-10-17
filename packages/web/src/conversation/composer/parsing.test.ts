import { describe, expect, it } from "vitest";
import { activeMention, applyMention } from "./mentions";
import { availableCommands, filterCommands, parseSlashCommand, slashQuery } from "./slash-commands";

describe("slash parsing", () => {
  it("opens only while the text is a single slash word", () => {
    expect(slashQuery("/co")).toBe("co");
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/compact more")).toBeNull();
    expect(slashQuery("hi /co")).toBeNull();
  });

  it("filters by prefix and hides commands without a handler", () => {
    const commands = availableCommands({ compact: () => {}, model: () => {}, new: () => {} });
    expect(filterCommands(commands, "").map((c) => c.name)).toEqual(["compact", "new", "model"]);
    expect(filterCommands(commands, "n").map((c) => c.name)).toEqual(["new"]);
  });

  it("parses a command with instructions", () => {
    expect(parseSlashCommand("/compact keep the API notes")).toEqual({
      name: "compact",
      args: "keep the API notes",
    });
    expect(parseSlashCommand("/new")).toEqual({ name: "new", args: "" });
    expect(parseSlashCommand("/unknown x")).toBeNull();
  });
});

describe("mention parsing", () => {
  it("triggers at the start or after whitespace", () => {
    expect(activeMention("@sr", 3)).toEqual({ start: 0, query: "sr" });
    expect(activeMention("look at @src/a", 14)).toEqual({ start: 8, query: "src/a" });
  });

  it("does not trigger inside a word or after a space in the query", () => {
    expect(activeMention("mail me@host", 12)).toBeNull();
    expect(activeMention("@a b", 4)).toBeNull();
  });

  it("replaces the query with the path and a space", () => {
    const trigger = { start: 8, query: "sr" };
    expect(applyMention("look at @sr tail", trigger, 11, "src/a.ts")).toEqual({
      text: "look at @src/a.ts  tail",
      caret: 18,
    });
  });
});
