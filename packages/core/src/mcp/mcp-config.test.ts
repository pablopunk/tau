import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findServer, mergeServers, parseMcpJson, readProjectServers } from "./mcp-config";

const CLAUDE_FORMAT = JSON.stringify({
  mcpServers: {
    files: { command: "node", args: ["a.js"], env: { TOKEN: "x" } },
    docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer y" } },
    broken: { nothing: true },
  },
});

describe("mcp config", () => {
  const dirs: string[] = [];
  afterEach(() => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

  it("parses Claude Code .mcp.json stdio and http servers and skips invalid ones", () => {
    expect(parseMcpJson(CLAUDE_FORMAT)).toEqual([
      { name: "files", command: "node", args: ["a.js"], env: { TOKEN: "x" } },
      { name: "docs", url: "https://example.com/mcp", headers: { Authorization: "Bearer y" } },
    ]);
  });

  it("reads nothing from a missing or invalid file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-config-"));
    dirs.push(dir);
    expect(await readProjectServers(dir)).toEqual([]);
    await writeFile(join(dir, ".mcp.json"), "{nope");
    expect(await readProjectServers(dir)).toEqual([]);
    await writeFile(join(dir, ".mcp.json"), CLAUDE_FORMAT);
    expect((await readProjectServers(dir)).map((server) => server.name)).toEqual(["files", "docs"]);
  });

  it("merges both sources and lets the project win a call by name", () => {
    const settings = [{ name: "files", command: "a", args: [], env: {} }];
    const project = [{ name: "files", command: "b", args: [], env: {} }];
    const merged = mergeServers(settings, project);
    expect(merged.map((server) => server.source)).toEqual(["settings", "project"]);
    expect(findServer(merged, "files")?.source).toBe("project");
    expect(findServer(merged, "nope")).toBeUndefined();
  });
});
