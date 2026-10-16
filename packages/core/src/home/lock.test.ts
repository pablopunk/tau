import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { acquireHomeLock, HomeLockedError, readLiveLockInfo } from "./lock";

const tempDir = useTempDir();
const DEAD_PID = 2 ** 22 + 12345;

async function lockPath(): Promise<string> {
  return join(await tempDir(), "lock");
}

describe("home lock", () => {
  it("lets one process in, and refuses a second while it is held", async () => {
    const path = await lockPath();
    const lock = await acquireHomeLock(path);
    const second = await acquireHomeLock(path).catch((error) => error);
    expect(second).toBeInstanceOf(HomeLockedError);
    expect(second.info.pid).toBe(process.pid);
    await lock.release();
  });

  it("can be taken again after release", async () => {
    const path = await lockPath();
    await (await acquireHomeLock(path)).release();
    await (await acquireHomeLock(path)).release();
  });

  it("reports the URL its owner published", async () => {
    const path = await lockPath();
    const lock = await acquireHomeLock(path);
    await lock.publishUrl("http://127.0.0.1:4317/?token=abc");
    expect(await readLiveLockInfo(path)).toEqual({
      pid: process.pid,
      url: "http://127.0.0.1:4317/?token=abc",
    });
    const refused = await acquireHomeLock(path).catch((error) => error);
    expect(refused.info.url).toBe("http://127.0.0.1:4317/?token=abc");
    await lock.release();
  });

  it("takes over a lock left by a dead process", async () => {
    const path = await lockPath();
    await writeFile(path, JSON.stringify({ pid: DEAD_PID }));
    expect(await readLiveLockInfo(path)).toBeUndefined();
    const lock = await acquireHomeLock(path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ pid: process.pid });
    await lock.release();
  });

  it("takes over a lock file that is garbage", async () => {
    const path = await lockPath();
    await writeFile(path, "not json");
    await (await acquireHomeLock(path)).release();
  });
});
