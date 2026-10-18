import { describe, expect, it } from "vitest";
import { editDistance, highlightRanges } from "./search-rank";
import { dynamicEntries, SETTINGS_INDEX, searchSettings } from "./settings-index";

const idsFor = (query: string, entries = SETTINGS_INDEX) => searchSettings(query, entries).map((r) => r.id);

describe("settings ranking", () => {
  it("ranks a label word prefix first", () => {
    expect(idsFor("appear")[0]).toBe("appearance");
    expect(idsFor("fast")[0]).toBe("fast-model");
  });

  it("finds settings through keywords and synonyms", () => {
    expect(idsFor("dark mode")[0]).toBe("appearance");
    expect(idsFor("theme")[0]).toBe("appearance");
    expect(idsFor("steer")[0]).toBe("message-mode");
    expect(idsFor("interrupt")[0]).toBe("message-mode");
    expect(idsFor("worktree")[0]).toBe("workspace-default");
    expect(idsFor("checkout")[0]).toBe("workspace-default");
    expect(idsFor("mcp")[0]).toBe("mcp-servers");
    expect(idsFor("connector")[0]).toBe("mcp-servers");
    expect(idsFor("reasoning")).toContain("default-model");
  });

  it("forgives typos within reason", () => {
    expect(idsFor("notifcations")[0]).toBe("notifications");
    expect(idsFor("apperance")[0]).toBe("appearance");
    expect(idsFor("wroktree")[0]).toBe("workspace-default");
    expect(idsFor("zzzzzz")).toEqual([]);
  });

  it("requires every word to match", () => {
    expect(idsFor("dark banana")).toEqual([]);
  });

  it("indexes providers, projects, servers and models by name", () => {
    const entries = [
      ...SETTINGS_INDEX,
      ...dynamicEntries({
        providers: [
          { id: "openrouter", name: "OpenRouter", methods: [], keyUrl: "", connection: null } as never,
        ],
        projects: [{ id: "p1", name: "Zebra app" } as never],
        mcpServers: [{ name: "files", transport: "stdio" } as never],
        models: [
          {
            provider: "anthropic",
            modelId: "claude-x",
            name: "Claude X",
            providerName: "Anthropic",
          } as never,
        ],
      }),
    ];
    expect(idsFor("openrouter", entries)[0]).toBe("provider:openrouter");
    expect(idsFor("api key", entries)).toContain("provider:openrouter");
    expect(idsFor("zebra", entries)[0]).toBe("project:p1");
    expect(idsFor("files", entries)[0]).toBe("mcp:files");
    expect(searchSettings("claude-x", entries)[0]).toMatchObject({
      section: "models",
      target: "default-model",
    });
  });
});

describe("helpers", () => {
  it("measures edit distance with swaps", () => {
    expect(editDistance("form", "from")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("marks matched text", () => {
    expect(highlightRanges("Default model", "mod")).toEqual([[8, 11]]);
  });
});
