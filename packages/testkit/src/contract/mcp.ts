import type { McpServerConfig } from "@pi-everywhere/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { addProject, collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const STDIO: McpServerConfig = {
  name: "files",
  command: "node",
  args: ["server.js"],
  env: { TOKEN: "secret" },
};
const HTTP: McpServerConfig = {
  name: "docs",
  url: "https://example.com/mcp",
  headers: { Authorization: "Bearer x" },
};

export function mcpCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("mcp", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[mcp] saves, lists and removes settings servers, and announces each change", async () => {
      const { core } = target;
      const { changes, stop } = collectChanges(core);
      await core.mcp.save(STDIO);
      await core.mcp.save(HTTP);
      expect(await core.mcp.servers(null)).toEqual([
        {
          name: "files",
          source: "settings",
          transport: "stdio",
          state: "idle",
          toolCount: null,
          error: null,
        },
        { name: "docs", source: "settings", transport: "http", state: "idle", toolCount: null, error: null },
      ]);
      await core.mcp.remove("files");
      await core.mcp.remove("files");
      stop();
      expect((await core.mcp.servers(null)).map((server) => server.name)).toEqual(["docs"]);
      expect(changes).toContainEqual({ resource: "mcp" });
    });

    test("[mcp] replaces a server saved under the same name", async () => {
      const { core } = target;
      await core.mcp.save(STDIO);
      await core.mcp.save({ ...HTTP, name: "files" });
      expect(await core.mcp.servers(null)).toMatchObject([{ name: "files", transport: "http" }]);
    });

    test("[mcp] never returns env or header values", async () => {
      const { core } = target;
      await core.mcp.save(STDIO);
      await core.mcp.save(HTTP);
      expect(JSON.stringify(await core.mcp.servers(null))).not.toMatch(/secret|Bearer/);
    });

    test("[mcp] lists servers for a known project and rejects an unknown one", async () => {
      const { core } = target;
      const project = await addProject(target);
      await core.mcp.save(STDIO);
      expect((await core.mcp.servers(project.id)).map((server) => server.name)).toContain("files");
      await rejectsWithCode(core.mcp.servers("nope"), "not_found");
    });

    test("[mcp] keeps servers after a restart", async () => {
      if (!target.reopen) return;
      await target.core.mcp.save(STDIO);
      const reopened = await target.reopen();
      expect((await reopened.mcp.servers(null)).map((server) => server.name)).toEqual(["files"]);
    });
  });
}
