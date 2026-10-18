import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStoredPort, resolvePort } from "../lifecycle/port-store";
import { waitForFreeHome } from "../lifecycle/wait-for-lock";
import { createRotatingLog } from "../logging/rotating-log";
import { isTemporaryRunnerEntry } from "./entry-guard";
import { serviceNames } from "./names";
import { captureServicePath } from "./path-capture";

const tempDir = () => mkdtempSync(join(tmpdir(), "tau-basics-"));

describe("serviceNames", () => {
  it("keeps plain names for the default home and hashes any other", () => {
    expect(serviceNames("/h/.tau", "/h/.tau").launchdLabel).toBe("dev.tau.server");
    const dev = serviceNames("/tmp/dev", "/h/.tau");
    expect(dev.launchdLabel).toMatch(/^dev\.tau\.server\.[0-9a-f]{8}$/);
    expect(dev.systemdUnit).toMatch(/^tau-[0-9a-f]{8}\.service$/);
    expect(serviceNames("/tmp/other", "/h/.tau").launchdLabel).not.toBe(dev.launchdLabel);
  });
});

describe("captureServicePath", () => {
  it("puts the mise shims first when the folder exists", () => {
    const shims = "/u/.local/share/mise/shims";
    const path = captureServicePath(
      "/u/.local/share/mise/installs/node/22/bin:/usr/bin",
      "/u",
      () => true,
      ":",
    );
    expect(path).toBe(`${shims}:/u/.local/share/mise/installs/node/22/bin:/usr/bin`);
  });

  it("leaves PATH alone without a shims folder", () => {
    expect(captureServicePath("/a:/b", "/u", () => false, ":")).toBe("/a:/b");
  });
});

describe("isTemporaryRunnerEntry", () => {
  it("flags npx and pnpm dlx caches, not global installs", () => {
    expect(isTemporaryRunnerEntry("/h/.npm/_npx/abc/node_modules/tau/dist/bin.js")).toBe(true);
    expect(isTemporaryRunnerEntry("/h/.cache/pnpm/dlx/xyz/node_modules/tau/bin.js")).toBe(true);
    expect(isTemporaryRunnerEntry("/h/Library/pnpm/.tools/dlx-123/tau/bin.js")).toBe(true);
    expect(isTemporaryRunnerEntry("/usr/local/lib/node_modules/tau/dist/bin.js")).toBe(false);
  });
});

describe("resolvePort", () => {
  it("uses the stored port, and --port wins and updates it", () => {
    const home = tempDir();
    expect(resolvePort(home, undefined)).toBe(4317);
    writeFileSync(join(home, "port"), "5000\n");
    expect(resolvePort(home, undefined)).toBe(5000);
    expect(resolvePort(home, 6000)).toBe(6000);
    expect(readStoredPort(home)).toBe(6000);
  });
});

describe("waitForFreeHome", () => {
  it("keeps waiting while the lock is held, then returns", async () => {
    let held = 3;
    const sleeps: number[] = [];
    const logs: string[] = [];
    await waitForFreeHome("/h", {
      readInstance: async () => (held-- > 0 ? { pid: 7 } : undefined),
      sleep: async (ms) => void sleeps.push(ms),
      log: (message) => logs.push(message),
    });
    expect(sleeps).toEqual([5000, 5000, 5000]);
    expect(logs).toHaveLength(1);
  });
});

describe("createRotatingLog", () => {
  it("rotates at the limit and keeps one old file", () => {
    const dir = tempDir();
    const file = join(dir, "logs", "server.log");
    const log = createRotatingLog(file, 25);
    log.write("0123456789\n");
    log.write("abcdefghi\n");
    log.write("second\n");
    expect(readFileSync(`${file}.1`, "utf8")).toBe("0123456789\nabcdefghi\n");
    expect(readFileSync(file, "utf8")).toBe("second\n");
    log.write("more more more\n");
    log.write("third file text\n");
    expect(readdirSync(join(dir, "logs")).sort()).toEqual(["server.log", "server.log.1"]);
    expect(statSync(file).size).toBeLessThanOrEqual(25);
  });

  it("creates the logs folder", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    createRotatingLog(join(dir, "nested", "server.log")).write("x");
    expect(readFileSync(join(dir, "nested", "server.log"), "utf8")).toBe("x");
  });
});
