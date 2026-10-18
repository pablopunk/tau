import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpService, type McpService } from "./mcp-service";

const ECHO_SERVER = fileURLToPath(new URL("./test-support/echo-server.mjs", import.meta.url));
const echoConfig = (name: string, env: Record<string, string> = {}): McpServerConfig => ({
  name,
  command: process.execPath,
  args: [ECHO_SERVER],
  env,
});

describe("McpService against a stdio test server", () => {
  let projectDir: string;
  let settings: McpServerConfig[];
  let changes: number;
  let service: McpService;

  const make = (idleMs?: number) =>
    createMcpService({
      settingsServers: async () => settings,
      projectPathOf: async () => projectDir,
      emitChange: () => void changes++,
      idleMs,
    });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "mcp-service-"));
    settings = [echoConfig("echo", { TOKEN: "secret-value" })];
    changes = 0;
    service = make();
  });
  afterEach(async () => {
    await service.closeAll();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("connects lazily, lists matching tools and calls one", async () => {
    expect((await service.servers(null))[0]).toMatchObject({ name: "echo", state: "idle", toolCount: null });
    const found = await service.search("p", "repeat");
    expect(found.map((tool) => `${tool.server}/${tool.name}`)).toEqual(["echo/echo"]);
    expect(found[0]?.inputSchema).toMatchObject({ required: ["text"] });
    expect((await service.servers("p"))[0]).toMatchObject({ state: "connected", toolCount: 2, error: null });
    expect(changes).toBeGreaterThan(0);
    const result = await service.call("p", "echo", "echo", { text: "hi" });
    expect(result).toMatchObject({ content: [{ type: "text", text: "echo: hi" }] });
  });

  it("passes env to the server and never returns it in statuses", async () => {
    const result = await service.call("p", "echo", "token", {});
    expect(result).toMatchObject({ content: [{ text: "secret-value" }] });
    expect(JSON.stringify(await service.servers("p"))).not.toContain("secret-value");
  });

  it("lists project .mcp.json servers beside settings servers", async () => {
    await writeFile(
      join(projectDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { local: { command: process.execPath, args: [ECHO_SERVER] } } }),
    );
    const statuses = await service.servers("p");
    expect(statuses.map((status) => `${status.source}:${status.name}`)).toEqual([
      "settings:echo",
      "project:local",
    ]);
    expect(await service.call("p", "local", "echo", { text: "x" })).toMatchObject({
      content: [{ text: "echo: x" }],
    });
  });

  it("reports a failing server as an error status and a tool error", async () => {
    settings = [{ name: "dead", command: "definitely-not-a-command-xyz", args: [], env: {} }];
    await expect(service.search("p", "")).rejects.toThrow(/dead/);
    expect((await service.servers("p"))[0]).toMatchObject({ state: "error" });
    await expect(service.call("p", "nope", "echo", {})).rejects.toThrow(/No MCP server named/);
  });

  it("closes a connection after the idle time and reconnects on demand", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await service.closeAll();
      service = make(50);
      await service.search("p", "");
      expect((await service.servers("p"))[0]?.state).toBe("connected");
      await vi.advanceTimersByTimeAsync(60);
      expect((await service.servers("p"))[0]?.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
    expect(await service.call("p", "echo", "echo", { text: "again" })).toMatchObject({
      content: [{ text: "echo: again" }],
    });
  });

  it("drops a pooled connection when the server is forgotten", async () => {
    await service.search("p", "");
    await service.forget("echo");
    expect((await service.servers("p"))[0]?.state).toBe("idle");
  });
});
