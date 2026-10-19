import type { QueuedMessage } from "@tau/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDraft } from "../composer/drafts";
import { stopAndRestore } from "./stop-restore";

const queued = (id: number, text: string): QueuedMessage => ({ id, mode: "followUp", text, images: [] });

function api(abort: ReturnType<typeof vi.fn>) {
  return { conversations: { abort } } as never;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("stopAndRestore", () => {
  it("puts the withdrawn queued messages back in the prompt box, in order", async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    await stopAndRestore(api(abort), "c1", undefined, [queued(1, "first"), queued(2, "second")]);
    expect(abort).toHaveBeenCalledWith("c1");
    expect(loadDraft("c1")).toBe("first\n\nsecond");
  });

  it("scopes the draft per node", async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    await stopAndRestore(api(abort), "c1", "m1", [queued(1, "first")]);
    expect(loadDraft("m:m1:c1")).toBe("first");
    expect(loadDraft("c1")).toBe("");
  });

  it("leaves the draft alone when nothing was queued", async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    await stopAndRestore(api(abort), "c1", undefined, []);
    expect(abort).toHaveBeenCalledWith("c1");
    expect(loadDraft("c1")).toBe("");
  });

  it("does not restore when the stop fails", async () => {
    const abort = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(stopAndRestore(api(abort), "c1", undefined, [queued(1, "first")])).rejects.toThrow(
      "offline",
    );
    expect(loadDraft("c1")).toBe("");
  });
});
