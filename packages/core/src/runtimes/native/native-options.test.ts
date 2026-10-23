import { describe, expect, it } from "vitest";
import {
  buildNativeOptions,
  DEFAULT_SETTING_SOURCES,
  settingSourcesNotice,
  sourcesOf,
  TAU_INSTRUCTIONS,
} from "./native-options";
import type { NativeCanUseTool } from "./permissions";

const ctx = { threadId: "1", cwd: "/work/tree" };

describe("buildNativeOptions", () => {
  it("uses Claude Code's own tools and prompt, asks through canUseTool and never bypasses", async () => {
    const options = buildNativeOptions(ctx);

    expect(options).toMatchObject({
      cwd: "/work/tree",
      tools: { type: "preset", preset: "claude_code" },
      systemPrompt: { type: "preset", preset: "claude_code", append: TAU_INSTRUCTIONS },
      permissionMode: "default",
    });
    expect(TAU_INSTRUCTIONS).toContain("Tau");
    expect(options.allowedTools).toBeUndefined();
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(JSON.stringify(options)).not.toMatch(/bypass/i);
    expect(options.disallowedTools).toEqual(["AskUserQuestion"]);
    const canUseTool = options.canUseTool as NativeCanUseTool;
    expect(
      await canUseTool("Bash", {}, { signal: new AbortController().signal, toolUseID: "t" }),
    ).toMatchObject({
      behavior: "deny",
    });
  });

  it("loads the user, project and local settings by default and accepts an override", () => {
    expect(buildNativeOptions(ctx).settingSources).toEqual(["user", "project", "local"]);
    expect(buildNativeOptions(ctx).settingSources).toEqual([...DEFAULT_SETTING_SOURCES]);
    expect(buildNativeOptions({ ...ctx, settingSources: [] }).settingSources).toEqual([]);
    expect(buildNativeOptions({ ...ctx, settingSources: ["project"] }).settingSources).toEqual(["project"]);
  });

  it("uses the given canUseTool", () => {
    const canUseTool: NativeCanUseTool = async (_name, input) => ({ behavior: "allow", updatedInput: input });
    expect(buildNativeOptions({ ...ctx, canUseTool }).canUseTool).toBe(canUseTool);
  });

  it("does not share the default source list with callers", () => {
    const sources = buildNativeOptions(ctx).settingSources as string[];
    sources.push("extra");
    expect(buildNativeOptions(ctx).settingSources).toEqual(["user", "project", "local"]);
  });
});

describe("settingSourcesNotice", () => {
  const init = {
    type: "system",
    subtype: "init",
    skills: ["review", "deploy"],
    plugins: [{ name: "maze-agents", path: "/Users/me/.claude/plugins/secret-path" }],
    tools: ["Read", "Bash", "Edit"],
    cwd: "/work/tree",
  };

  it("names the sources, skills and plugins and counts the tools, nothing else", () => {
    const notice = settingSourcesNotice("op1", ["user", "project", "local"], init);

    expect(notice).toEqual({
      type: "notice",
      key: "settings-sources:op1",
      code: "settings-sources",
      text: "Claude Code settings loaded from: user, project, local. Skills (2): review, deploy. Plugins (1): maze-agents. Tools: 3.",
    });
    expect(JSON.stringify(notice)).not.toContain("secret-path");
  });

  it("stays silent without sources or for other messages", () => {
    expect(settingSourcesNotice("op1", [], init)).toBeUndefined();
    expect(settingSourcesNotice("op1", ["user"], { type: "assistant" })).toBeUndefined();
    expect(settingSourcesNotice("op1", ["user"], "init")).toBeUndefined();
  });

  it("bounds the list of names", () => {
    const skills = Array.from({ length: 50 }, (_, index) => `skill-${index}-${"x".repeat(100)}`);
    const notice = settingSourcesNotice("op1", ["user"], { ...init, skills });
    const text = notice?.type === "notice" ? notice.text : "";
    expect(text).toContain("Skills (50)");
    expect(text).toContain("and 30 more");
    expect(text.length).toBeLessThan(1500);
  });

  it("reads the requested sources from options", () => {
    expect(sourcesOf({ settingSources: ["user", 3, "local"] })).toEqual(["user", "local"]);
    expect(sourcesOf({})).toEqual([]);
  });
});
