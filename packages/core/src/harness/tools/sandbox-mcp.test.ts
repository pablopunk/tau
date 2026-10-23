import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { ConversationDoc } from "../conversation-docs";
import { mcpCallToolFile } from "./mcp-call";
import { classifyMcpServer, MCP_UNENFORCED_MARK, mcpDeniedText } from "./sandbox-mcp";
import type { SandboxToolServices, ToolServices } from "./tool-file";

describe("classifyMcpServer", () => {
  it("allows everything when the thread is not sandboxed", () => {
    expect(classifyMcpServer({ scope: undefined, allowlisted: false })).toBe("allowed");
  });

  it("allows an allowlisted server for a sandboxed thread", () => {
    expect(classifyMcpServer({ scope: "worktree", allowlisted: true })).toBe("allowed");
  });

  it("denies an unlisted server for a sandboxed thread, over every scope", () => {
    for (const scope of ["main", "worktree", "subagent"] as const) {
      expect(classifyMcpServer({ scope, allowlisted: false })).toBe("denied");
    }
  });

  it("marks the denial UNENFORCED", () => {
    expect(mcpDeniedText("memory", "worktree")).toContain(MCP_UNENFORCED_MARK);
    expect(mcpDeniedText("memory", "worktree")).toContain("memory");
  });
});

function setup(sandbox: SandboxToolServices | undefined, calls: string[]) {
  const services = {
    mcp: {
      call: async (_projectId: string, server: string) => {
        calls.push(server);
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
    sandbox,
  } as unknown as ToolServices;
  const file = mcpCallToolFile({ current: () => services, set: () => undefined });
  const tool = file.extension.tools?.[0] as unknown as {
    execute(args: unknown, api: unknown, context: Context): Promise<unknown>;
  };
  const api = {
    callId: "toolu_1",
    conversationId: 1,
    snapshot: async (token: unknown) => (token === ConversationDoc ? { projectId: "p1" } : undefined),
  };
  return (server: string) => tool.execute({ server, tool: "read", arguments: {} }, api, BACKGROUND_CONTEXT);
}

describe("mcp_call sandbox scoping", () => {
  it("calls through when no sandbox plumbing is wired", async () => {
    const calls: string[] = [];
    const out = await setup(undefined, calls)("memory");
    expect(calls).toEqual(["memory"]);
    expect(out).toMatchObject({ isError: false });
  });

  it("denies an unlisted server for a sandboxed thread without reaching it", async () => {
    const calls: string[] = [];
    const run = setup(
      {
        scopeOf: async () => "worktree",
        rootOf: async () => "/wt",
        mcpAllowed: async () => false,
      },
      calls,
    );
    const out = (await run("memory")) as { isError: boolean; output: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.output[0]?.text).toContain(MCP_UNENFORCED_MARK);
    expect(calls).toEqual([]);
  });

  it("allows an allowlisted server for a sandboxed thread", async () => {
    const calls: string[] = [];
    const run = setup(
      {
        scopeOf: async () => "subagent",
        rootOf: async () => "/wt",
        mcpAllowed: async (server) => server === "memory",
      },
      calls,
    );
    const out = (await run("memory")) as { isError: boolean };
    expect(out.isError).toBe(false);
    expect(calls).toEqual(["memory"]);
  });

  it("allows everything when the thread is not sandboxed", async () => {
    const calls: string[] = [];
    const run = setup(
      { scopeOf: async () => undefined, rootOf: async () => undefined, mcpAllowed: async () => false },
      calls,
    );
    const out = (await run("memory")) as { isError: boolean };
    expect(out.isError).toBe(false);
    expect(calls).toEqual(["memory"]);
  });

  it("fails closed when the allowlist check throws", async () => {
    const calls: string[] = [];
    const run = setup(
      {
        scopeOf: async () => "main",
        rootOf: async () => "/wt",
        mcpAllowed: async () => {
          throw new Error("store unavailable");
        },
      },
      calls,
    );
    const out = (await run("memory")) as { isError: boolean };
    expect(out.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});
