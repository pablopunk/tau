import { isBehind } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { describe, expect, it } from "vitest";
import { createApi } from "./api";
import { createFakeTransport } from "./transport/fake";

const apiOf = (options: Parameters<typeof createFakeCore>[0]) =>
  createApi(createFakeTransport(createFakeCore(options)));

describe("api.updates over the fake transport", () => {
  it("answers status with the latest unknown by default, and refresh with the controlled latest", async () => {
    const core = createFakeCore({ currentVersion: "0.1.0" });
    const api = createApi(createFakeTransport(core));
    expect(await api.updates.status()).toMatchObject({ current: "0.1.0", latest: null, behind: false });
    core.updatesControl.setLatest("0.1.2");
    expect(await api.updates.refresh()).toMatchObject({ latest: "0.1.2", behind: true });
    expect(await api.updates.status()).toMatchObject({ latest: "0.1.2", behind: true });
  });

  it("starts known when the fake core is given a latest", async () => {
    const status = await apiOf({ currentVersion: "0.1.2", latestVersion: "0.1.2" }).updates.status();
    expect(status.behind).toBe(false);
  });
});

describe("node versions in web code", () => {
  it("treats an empty tauVersion (never seen) as unknown, not as behind", () => {
    expect(isBehind("", "0.1.2")).toBeUndefined();
    expect(isBehind("0.0.9", "0.1.2")).toBe(true);
  });
});
