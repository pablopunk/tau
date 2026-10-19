import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateService, MIN_REFRESH_GAP_MS, REFRESH_EVERY_MS } from "./update-service";

let clock = 1_000;
const setup = (current: string, fetchLatest: () => Promise<string>) => {
  const latestVersion = vi.fn(fetchLatest);
  const service = createUpdateService({ currentVersion: current, latestVersion, now: () => clock });
  return { service, latestVersion };
};

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000;
});
afterEach(() => vi.useRealTimers());

describe("update service", () => {
  it("first status never blocks: latest null, then known after the background fetch", async () => {
    const { service } = setup("0.1.0", async () => "0.1.2");
    expect(await service.status()).toMatchObject({
      current: "0.1.0",
      latest: null,
      checkedAt: null,
      behind: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await service.status()).toMatchObject({
      current: "0.1.0",
      latest: "0.1.2",
      checkedAt: 1_000,
      behind: true,
    });
    service.stop();
  });

  it("refresh within 60 s returns the cache without spawning; after it, fetches", async () => {
    const { service, latestVersion } = setup("0.1.0", async () => "0.1.2");
    await service.status();
    await vi.advanceTimersByTimeAsync(0);
    await service.refresh();
    expect(latestVersion).toHaveBeenCalledTimes(1);
    clock += MIN_REFRESH_GAP_MS;
    await service.refresh();
    expect(latestVersion).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it("refresh is single-flight", async () => {
    let release: (v: string) => void = () => undefined;
    const { service, latestVersion } = setup("0.1.0", () => new Promise<string>((r) => (release = r)));
    const a = service.refresh();
    const b = service.refresh();
    await vi.advanceTimersByTimeAsync(0);
    release("0.2.0");
    expect((await a).latest).toBe("0.2.0");
    expect((await b).latest).toBe("0.2.0");
    expect(latestVersion).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("offline keeps the last good value and its age", async () => {
    let fail = false;
    const { service } = setup("0.1.0", async () => {
      if (fail) throw new Error("offline");
      return "0.1.5";
    });
    await service.refresh();
    fail = true;
    clock += MIN_REFRESH_GAP_MS;
    const status = await service.refresh();
    expect(status).toMatchObject({ current: "0.1.0", latest: "0.1.5", checkedAt: 1_000, behind: true });
    service.stop();
  });

  it("stays null when never known", async () => {
    const { service } = setup("0.1.0", () => Promise.reject(new Error("offline")));
    expect((await service.refresh()).latest).toBeNull();
    service.stop();
  });

  it("a dev build ahead of latest is not behind", async () => {
    const { service } = setup("0.3.0", async () => "0.2.0");
    expect((await service.refresh()).behind).toBe(false);
    service.stop();
  });

  it("refreshes every 6 h and stops on stop()", async () => {
    const { service, latestVersion } = setup("0.1.0", async () => "0.1.2");
    await service.status();
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS);
    expect(latestVersion).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 2);
    expect(latestVersion).toHaveBeenCalledTimes(2);
  });
});
