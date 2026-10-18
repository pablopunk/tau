import { mkdtempSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Core } from "@tau/protocol";
import { createServer } from "@tau/server";
import { describe, expect, it, vi } from "vitest";
import { parseCliOptions } from "./options";
import { run } from "./run";

function occupy(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve) => {
    const blocker = createNetServer();
    blocker.listen(0, "127.0.0.1", () => {
      const { port } = blocker.address() as { port: number };
      resolve({ port, release: () => new Promise((done) => blocker.close(() => done())) });
    });
  });
}

describe("run with the real server", () => {
  it("skips an occupied port and serves the session cookie exchange on the next one", async () => {
    const { port, release } = await occupy();
    const home = join(mkdtempSync(join(tmpdir(), "tau-cli-real-")), "home");
    const core = { close: vi.fn(async () => undefined) } as unknown as Core;
    const app = await run(parseCliOptions(["--home", home, "--no-open", "--port", String(port)], {}), {
      createCore: async () => core,
      createServer,
      openBrowser: async () => undefined,
      log: () => undefined,
      staticDir: undefined,
    });
    try {
      expect(app?.url).not.toContain(`:${port}/`);
      const response = await fetch(app?.url ?? "", { redirect: "manual" });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toMatch(/^tau_\d+=/);
    } finally {
      await app?.close();
      await release();
    }
  });
});
