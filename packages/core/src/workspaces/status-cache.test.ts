import { describe, expect, it, vi } from "vitest";
import { createStatusCache } from "./status-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("advisory status cache", () => {
  it("deduplicates flights and expires five seconds after completion", async () => {
    let now = 0;
    const cache = createStatusCache<number>(() => now);
    const pending = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(2);
    const first = cache.get("a", load);
    const second = cache.get("a", load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    now = 10_000;
    pending.resolve(1);
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    now = 14_999;
    expect(await cache.get("a", load)).toBe(1);
    now = 15_000;
    expect(await cache.get("a", load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache errors", async () => {
    const cache = createStatusCache<number>();
    const load = vi.fn().mockRejectedValueOnce(new Error("git failed")).mockResolvedValue(2);
    await expect(cache.get("a", load)).rejects.toThrow("git failed");
    expect(await cache.get("a", load)).toBe(2);
  });

  it("fences invalidated flights without deleting a newer flight", async () => {
    const cache = createStatusCache<number>();
    const old = deferred<number>();
    const fresh = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const first = cache.get("a", load);
    await Promise.resolve();
    cache.invalidate();
    const second = cache.get("a", load);
    await Promise.resolve();
    old.resolve(1);
    await Promise.resolve();
    const third = cache.get("a", load);
    fresh.resolve(2);
    expect(await Promise.all([first, second, third])).toEqual([2, 2, 2]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cache.get("a", load)).toBe(2);
  });

  it("bounds settled entries", async () => {
    const cache = createStatusCache<number>();
    const load = vi.fn().mockResolvedValue(1);
    for (let i = 0; i < 257; i++) await cache.get(String(i), load);
    await cache.get("0", load);
    expect(load).toHaveBeenCalledTimes(258);
  });
});
