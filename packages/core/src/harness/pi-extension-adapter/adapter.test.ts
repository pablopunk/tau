import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { collectExtensionTools, type PiTool } from "./fake-extension-api";
import { piWebAccessToolFile } from "./pi-extension-adapter";
import { toToolRegistration } from "./tool-conversion";

const searchTool: PiTool = {
  name: "fake_search",
  description: "Search",
  parameters: Type.Object({ query: Type.String() }),
  async execute(callId, params, signal, onUpdate, ctx) {
    onUpdate?.({ content: [{ type: "text", text: "searching" }], details: { phase: "start" } });
    const { cwd } = ctx as { cwd: string };
    return {
      content: [
        { type: "text", text: `${callId}:${(params as { query: string }).query}:${cwd}:${signal?.aborted}` },
      ],
      details: { results: [{ title: "T", url: "https://example.com" }] },
    };
  },
};

function fakeExecutionApi() {
  const output = vi.fn();
  const details = vi.fn(async () => undefined);
  const api = { callId: "call-1", env: { cwd: "/work" }, output, details } as unknown as ToolExecutionApi;
  return { api, output, details };
}

const noAbort = { abortSignal: undefined } as never;

describe("pi extension adapter", () => {
  it("collects tools registered by an extension and ignores every other call", () => {
    const tools = collectExtensionTools((api) => {
      const fake = api as unknown as Record<string, (...args: unknown[]) => unknown>;
      fake.on?.("session_start", () => undefined);
      fake.registerCommand?.("x", {});
      fake.registerShortcut?.("y", {});
      fake.registerTool?.(searchTool);
    });
    expect(tools.map((tool) => tool.name)).toEqual(["fake_search"]);
  });

  it("turns a pi tool into an unsafe-replay registration that maps updates, cwd and results", async () => {
    const registration = toToolRegistration(searchTool);
    expect(registration.replay).toBe("unsafe");
    const { api, output, details } = fakeExecutionApi();
    const result = await registration.execute({ query: "q" }, api, noAbort);
    expect(output).toHaveBeenCalledWith("searching\n");
    expect(details).toHaveBeenCalledWith({ phase: "start" }, noAbort);
    expect(result.output).toEqual([{ type: "text", text: "call-1:q:/work:undefined" }]);
    expect(result.details).toEqual({ results: [{ title: "T", url: "https://example.com" }] });
    expect(result.isError).toBe(false);
  });

  it("registers the real pi-web-access tools without network", () => {
    const file = piWebAccessToolFile({ current: () => never(), set: () => undefined });
    expect(file.implemented).toBe(true);
    const names = (file.extension.tools ?? []).map((tool) => tool.name).sort();
    expect(names).toEqual(["fetch_content", "get_search_content", "source_check", "web_search"]);
  });
});

function never(): never {
  throw new Error("not used");
}
