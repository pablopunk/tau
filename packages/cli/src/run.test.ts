import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Core } from "@tau/protocol";
import type { CreateServer } from "@tau/server";
import { describe, expect, it, vi } from "vitest";
import { parseCliOptions } from "./options";
import { type RunDependencies, run } from "./run";

const newHome = () => join(mkdtempSync(join(tmpdir(), "tau-cli-")), "home");

function fakeDependencies(overrides: Partial<RunDependencies> = {}) {
  const logs: string[] = [];
  const coreClose = vi.fn(async (): Promise<void> => undefined);
  const core = { close: coreClose } as unknown as Core;
  const serverClose = vi.fn(async () => undefined);
  const createCore = vi.fn(async ({ home }: { home: string }) => {
    mkdirSync(home, { recursive: true });
    const lockFile = join(home, "lock");
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid }));
    coreClose.mockImplementation(async () => rmSync(lockFile, { force: true }));
    return core;
  });
  const createServer = vi.fn<CreateServer>(async ({ port, token }) => ({
    app: {} as never,
    port,
    tunnelPort: 0,
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: serverClose,
  }));
  const openBrowser = vi.fn(async () => undefined);
  const dependencies: RunDependencies = {
    createCore,
    createServer,
    openBrowser,
    log: (message) => logs.push(message),
    staticDir: "/static",
    ...overrides,
  };
  return { dependencies, logs, core, createCore, createServer, openBrowser, serverClose };
}

const optionsFor = (home: string, ...flags: string[]) => parseCliOptions(["--home", home, ...flags], {});

describe("run", () => {
  it("creates the core, serves, prints the tokened URL and opens the browser", async () => {
    const home = newHome();
    const { dependencies, logs, createCore, createServer, openBrowser } = fakeDependencies();
    const app = await run(optionsFor(home, "--faux", "--port", "5000"), dependencies);

    expect(createCore).toHaveBeenCalledWith(
      expect.objectContaining({ home, faux: true, tunnelTarget: expect.any(Function) }),
    );
    expect(createServer).toHaveBeenCalledWith(expect.objectContaining({ port: 5000, staticDir: "/static" }));
    expect(app?.url).toMatch(/^http:\/\/127\.0\.0\.1:5000\/\?token=.{32,}$/);
    expect(logs.join("\n")).toContain(app?.url);
    expect(openBrowser).toHaveBeenCalledWith(app?.url);
  });

  it("starts the link client with the frozen options and stops it before the server", async () => {
    const home = newHome();
    const order: string[] = [];
    const stop = vi.fn(async () => void order.push("link"));
    const startLinkClient = vi.fn(() => ({ stop }));
    const { dependencies, core, serverClose } = fakeDependencies({ startLinkClient });
    serverClose.mockImplementation(async () => void order.push("server"));
    const app = await run(optionsFor(home, "--port", "5001"), dependencies);
    expect(startLinkClient).toHaveBeenCalledWith({
      port: 5001,
      token: expect.stringMatching(/.{32,}/),
      hubFile: expect.objectContaining({
        read: expect.any(Function),
        write: expect.any(Function),
        delete: expect.any(Function),
      }),
      core,
    });
    await app?.close();
    expect(order).toEqual(["link", "server"]);
  });

  it("does not open the browser with --no-open", async () => {
    const { dependencies, openBrowser } = fakeDependencies();
    await run(optionsFor(newHome(), "--no-open"), dependencies);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("keeps running when the browser cannot be opened", async () => {
    const { dependencies, logs } = fakeDependencies({
      openBrowser: async () => {
        throw new Error("no browser");
      },
    });
    expect(await run(optionsFor(newHome()), dependencies)).toBeDefined();
    expect(logs.join("\n")).toContain("Could not open the browser (no browser)");
  });

  it("persists the token with mode 0600 and reuses it", async () => {
    const home = newHome();
    const first = fakeDependencies();
    await (await run(optionsFor(home), first.dependencies))?.close();
    expect(statSync(join(home, "token")).mode & 0o777).toBe(0o600);
    const token = readFileSync(join(home, "token"), "utf8").trim();

    const second = fakeDependencies();
    const app = await run(optionsFor(home), second.dependencies);
    expect(app?.url).toContain(`token=${token}`);
  });

  it("falls back to the next free port", async () => {
    const { dependencies, createServer } = fakeDependencies();
    createServer.mockImplementation(async ({ port, token }) => {
      if (port < 4319) throw Object.assign(new Error("in use"), { code: "EADDRINUSE" });
      return {
        app: {} as never,
        port,
        tunnelPort: 0,
        origin: "",
        url: `http://127.0.0.1:${port}/?token=${token}`,
        close: async () => undefined,
      };
    });
    const app = await run(optionsFor(newHome(), "--port", "4317"), dependencies);
    expect(app?.url).toContain(":4319/");
    expect(createServer).toHaveBeenCalledTimes(3);
  });

  it("closes the core and rethrows when the server fails for another reason", async () => {
    const { dependencies, createServer, core } = fakeDependencies();
    createServer.mockRejectedValue(new Error("boom"));
    await expect(run(optionsFor(newHome()), dependencies)).rejects.toThrow("boom");
    expect(core.close).toHaveBeenCalled();
  });

  it("prints the running URL with the token and exits when another instance holds the home", async () => {
    const home = newHome();
    const first = fakeDependencies();
    const running = await run(optionsFor(home, "--port", "6000"), first.dependencies);

    const second = fakeDependencies();
    const result = await run(optionsFor(home, "--port", "6001"), second.dependencies);
    expect(result).toBeUndefined();
    expect(second.logs.join("\n")).toContain(running?.url);
    expect(second.createCore).not.toHaveBeenCalled();
    expect(second.openBrowser).not.toHaveBeenCalled();
  });

  it("ignores the record of a dead process", async () => {
    const home = newHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "lock"), JSON.stringify({ pid: 2 ** 31 - 2, url: "http://127.0.0.1:1" }));
    const second = fakeDependencies();
    expect(await run(optionsFor(home), second.dependencies)).toBeDefined();
    expect(second.createCore).toHaveBeenCalled();
  });

  it("close stops the server and the core and releases the home", async () => {
    const home = newHome();
    const { dependencies, serverClose, core } = fakeDependencies();
    const app = await run(optionsFor(home), dependencies);
    await app?.close();
    expect(serverClose).toHaveBeenCalled();
    expect(core.close).toHaveBeenCalled();
    const next = fakeDependencies();
    expect(await run(optionsFor(home), next.dependencies)).toBeDefined();
  });
});

describe("run update wiring", () => {
  it("passes the cli version and the latest-version source to core", async () => {
    const { dependencies, createCore } = fakeDependencies();
    const latestVersion = async () => "9.9.9";
    await run(optionsFor(newHome(), "--faux", "--port", "5001"), {
      ...dependencies,
      version: "1.2.3",
      latestVersion,
    });
    expect(createCore).toHaveBeenCalledWith(
      expect.objectContaining({ currentVersion: "1.2.3", latestVersion }),
    );
  });
});
