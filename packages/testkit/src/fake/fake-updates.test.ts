import { describe, expect, it } from "vitest";
import { createFakeCore } from "./fake-core";

const behindCore = (updates = {}) =>
  createFakeCore({ configured: true, currentVersion: "0.9.0", latestVersion: "0.9.1", updates });

describe("fake updates", () => {
  it("walks installing → restarting → done and the version changes", async () => {
    const core = behindCore();
    const first = await core.updates.start({ target: "0.9.1", force: false });
    expect(first.job).toEqual({ state: "installing", target: "0.9.1", error: null, logTail: null });
    expect((await core.updates.start({ target: "0.9.1", force: false })).job.state).toBe("installing");
    core.updatesControl.advance();
    expect((await core.updates.status()).job.state).toBe("restarting");
    core.updatesControl.advance();
    const done = await core.updates.status();
    expect([done.current, done.behind, done.job.state]).toEqual(["0.9.1", false, "idle"]);
  });

  it("ends failed with a log tail", async () => {
    const core = behindCore({ failUpdate: true });
    await core.updates.start({ target: "0.9.1", force: false });
    core.updatesControl.advance();
    expect((await core.updates.status()).job).toMatchObject({ state: "failed", logTail: expect.any(String) });
  });

  it("refuses manual installs, wrong targets and busy work unless forced", async () => {
    await expect(
      behindCore({ install: { mode: "manual", command: "npm i -g x", reason: "npx" } }).updates.start({
        target: "0.9.1",
        force: false,
      }),
    ).rejects.toMatchObject({ code: "update_unsupported" });
    await expect(behindCore().updates.start({ target: "0.9.2", force: false })).rejects.toMatchObject({
      code: "update_unsupported",
    });
    const busy = behindCore({ busy: true });
    await expect(busy.updates.start({ target: "0.9.1", force: false })).rejects.toMatchObject({
      code: "update_busy",
    });
    expect((await busy.updates.start({ target: "0.9.1", force: true })).job.state).toBe("installing");
  });

  it("reports canUpdate from the caller", async () => {
    expect((await behindCore({ canUpdate: false }).updates.status()).canUpdate).toBe(false);
  });
});
