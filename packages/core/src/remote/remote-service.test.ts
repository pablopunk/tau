import type { Change } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createFakeRemoteAdapter } from "./fake-adapter";
import { createRemoteService } from "./remote-service";

function setup() {
  const adapter = createFakeRemoteAdapter(() => 1000);
  const changes = createChangeEmitter();
  const seen: Change[] = [];
  changes.subscribe((change) => seen.push(change));
  const settings = { setRemoteEnabled: vi.fn(async () => undefined) };
  const access = { clearAll: vi.fn(async () => undefined) };
  const service = createRemoteService({ adapter, settings, access, changes });
  return { adapter, seen, settings, access, api: service.api };
}

describe("remote service over the fake adapter", () => {
  it("stores the switch and announces on enable", async () => {
    const { api, settings, seen } = setup();
    expect((await api.enable()).state).toBe("online");
    expect(settings.setRemoteEnabled).toHaveBeenCalledWith(true);
    expect(seen).toContainEqual({ resource: "remote" });
  });

  it("keeps devices and the URL when turned off, clears devices when a new URL is made", async () => {
    const { api, access, adapter } = setup();
    const first = await api.enable();
    const off = await api.disable();
    expect(off).toMatchObject({ state: "off", url: first.url });
    expect(access.clearAll).not.toHaveBeenCalled();
    expect((await api.enable()).url).toBe(first.url);
    adapter.push({ state: "reconnecting", canRecreate: true });
    const next = await api.recreate();
    expect(access.clearAll).toHaveBeenCalledTimes(1);
    expect(next.url).not.toBe(first.url);
  });

  it("refuses a new URL before ten minutes offline", async () => {
    const { api } = setup();
    await api.enable();
    await expect(api.recreate()).rejects.toMatchObject({ code: "invalid_request" });
  });
});
