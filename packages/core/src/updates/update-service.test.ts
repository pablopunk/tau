import type { ConversationSummary, UpdateJob, UpdaterPort } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUpdateService,
  MIN_REFRESH_GAP_MS,
  REFRESH_EVERY_MS,
  type UpdateServiceDeps,
} from "./update-service";

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

  it("autoStart false: no registry call until status()", async () => {
    const { latestVersion, service } = setup("0.1.0", async () => "0.1.2");
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 2);
    expect(latestVersion).not.toHaveBeenCalled();
    service.stop();
  });

  it("re-checks every 15 min with jitter via chained setTimeout and stops on stop()", async () => {
    const latestVersion = vi.fn(async () => "0.1.2");
    const service = createUpdateService({
      currentVersion: "0.1.0",
      latestVersion,
      now: () => clock,
      autoStart: true,
      random: () => 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(latestVersion).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 1.1 - 1);
    expect(latestVersion).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(latestVersion).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 1.1);
    expect(latestVersion).toHaveBeenCalledTimes(3);
    service.stop();
    await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 3);
    expect(latestVersion).toHaveBeenCalledTimes(3);
  });
});

const RUN = { mode: "run", command: null, reason: null } as const;
const idle = { state: "idle", target: null, error: null, logTail: null } as const;

function withUpdater(overrides: Partial<UpdaterPort> = {}, extra: Partial<UpdateServiceDeps> = {}) {
  const updater: UpdaterPort = {
    plan: vi.fn(() => RUN),
    spawn: vi.fn(async () => undefined),
    readJob: vi.fn(async (): Promise<UpdateJob> => idle),
    ...overrides,
  };
  const service = createUpdateService({
    currentVersion: "0.1.0",
    latestVersion: async () => "0.2.0",
    now: () => clock,
    updater,
    ...extra,
  });
  return { service, updater };
}

const running = (over: Partial<ConversationSummary> = {}) =>
  ({
    id: "t1",
    parentId: null,
    archivedAt: null,
    status: "running",
    agentStatus: "idle",
    timers: 0,
    goal: null,
    ...over,
  }) as unknown as ConversationSummary;

describe("update start", () => {
  it("status merges plan and job; canUpdate is the owner view", async () => {
    const { service } = withUpdater();
    await service.refresh();
    expect(await service.status()).toMatchObject({ canUpdate: true, install: RUN, job: idle });
    service.stop();
  });

  it("is update_unsupported without an updater, a manual install, a wrong target or when not behind", async () => {
    const bare = setup("0.1.0", async () => "0.2.0");
    await bare.service.refresh();
    await expect(bare.service.start({ target: "0.2.0", force: false })).rejects.toMatchObject({
      code: "update_unsupported",
    });
    const manual = withUpdater({ plan: () => ({ mode: "manual", command: "x", reason: null }) });
    await manual.service.refresh();
    await expect(manual.service.start({ target: "0.2.0", force: false })).rejects.toMatchObject({
      code: "update_unsupported",
    });
    const ok = withUpdater();
    await ok.service.refresh();
    await expect(ok.service.start({ target: "0.3.0", force: false })).rejects.toMatchObject({
      code: "update_unsupported",
    });
    const same = withUpdater({}, { currentVersion: "0.2.0" });
    await same.service.refresh();
    await expect(same.service.start({ target: "0.2.0", force: false })).rejects.toMatchObject({
      code: "update_unsupported",
    });
    expect(ok.updater.spawn).not.toHaveBeenCalled();
    for (const s of [bare.service, manual.service, ok.service, same.service]) s.stop();
  });

  it("update_busy with running work unless forced", async () => {
    const { service, updater } = withUpdater({}, { listConversations: async () => [running()] });
    await service.refresh();
    await expect(service.start({ target: "0.2.0", force: false })).rejects.toMatchObject({
      code: "update_busy",
    });
    expect(updater.spawn).not.toHaveBeenCalled();
    await service.start({ target: "0.2.0", force: true });
    expect(updater.spawn).toHaveBeenCalledWith({ target: "0.2.0" });
    service.stop();
  });

  it("spawns once and is idempotent while a job is active", async () => {
    let job: UpdateJob = idle;
    const { service, updater } = withUpdater({
      readJob: async () => job,
      spawn: vi.fn(async () => {
        job = { state: "installing", target: "0.2.0", error: null, logTail: null };
      }),
    });
    await service.refresh();
    expect((await service.start({ target: "0.2.0", force: false })).job.state).toBe("installing");
    expect((await service.start({ target: "0.2.0", force: false })).job.state).toBe("installing");
    expect(updater.spawn).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("caches the job read for 1 s and start() invalidates it", async () => {
    const { service, updater } = withUpdater();
    await service.refresh();
    const before = vi.mocked(updater.readJob).mock.calls.length;
    await service.status();
    await service.status();
    expect(vi.mocked(updater.readJob).mock.calls.length).toBe(before);
    clock += 1_000;
    await service.status();
    expect(vi.mocked(updater.readJob).mock.calls.length).toBe(before + 1);
    await service.start({ target: "0.2.0", force: false });
    expect(vi.mocked(updater.readJob).mock.calls.length).toBeGreaterThan(before + 1);
    service.stop();
  });

  it("a job whose target is the running version reads as idle", async () => {
    const { service } = withUpdater({
      readJob: async () => ({ state: "failed", target: "0.1.0", error: "x", logTail: "log" }),
    });
    expect((await service.status()).job).toEqual(idle);
    service.stop();
  });

  it("a failed job for another target stays failed", async () => {
    const failed = { state: "failed", target: "0.2.0", error: "x", logTail: "log" } as const;
    const { service } = withUpdater({ readJob: async () => failed });
    expect((await service.status()).job).toEqual(failed);
    service.stop();
  });
});
