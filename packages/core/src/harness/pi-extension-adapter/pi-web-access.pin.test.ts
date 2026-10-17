import { describe, expect, it } from "vitest";

const PI_WEB_ACCESS_ENTRY = "pi-web-access/dist/index.js";

type RegisteredTool = {
  name: string;
  description: string;
  parameters: { properties?: Record<string, unknown>; required?: string[] };
  execute: (...args: unknown[]) => Promise<unknown>;
};

const noop = () => undefined;

function fakeExtensionApi(tools: RegisteredTool[]) {
  const registerTool = (tool: RegisteredTool) => void tools.push(tool);
  return new Proxy(
    { registerTool },
    { get: (target, key) => (key in target ? target[key as "registerTool"] : noop) },
  );
}

async function loadToolsFromPiWebAccess(): Promise<RegisteredTool[]> {
  const module = (await import(PI_WEB_ACCESS_ENTRY)) as { default: (api: unknown) => void };
  const tools: RegisteredTool[] = [];
  module.default(fakeExtensionApi(tools));
  return tools;
}

describe("pi-web-access through a fake ExtensionAPI (no network)", () => {
  it("registers its tools with TypeBox parameters and an execute function", async () => {
    const tools = await loadToolsFromPiWebAccess();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "fetch_content",
      "get_search_content",
      "source_check",
      "web_search",
    ]);
    for (const tool of tools) {
      expect(typeof tool.execute).toBe("function");
      expect(tool.parameters.properties).toBeDefined();
    }
  });
});
