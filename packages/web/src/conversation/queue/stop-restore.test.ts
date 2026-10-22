import type { QueuedMessage } from "@tau/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDraft } from "../composer/drafts";
import { loadFileAttachments } from "../files/attachments";
import { stopAndRestore } from "./stop-restore";

const queued = (id: number, text: string): QueuedMessage =>
  ({ id, mode: "followUp", text, images: [], entryKind: "pi.user" }) as QueuedMessage;
const notice = (id: number, text: string): QueuedMessage =>
  ({ id, mode: "followUp", text, images: [], entryKind: "app.bang" }) as QueuedMessage;
function api(abort: ReturnType<typeof vi.fn>) {
  return { conversations: { abort } } as never;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("stopAndRestore", () => {
  it("restores the server snapshot, never the client draft", async () => {
    const abort = vi.fn().mockResolvedValue({
      restored: [
        { text: "survivor", files: [] },
        { text: "with file", files: [{ name: "a.txt", path: "a.txt", size: 1 }] },
      ],
    });
    await stopAndRestore(api(abort), "c1", undefined, [queued(1, "stale client text")]);
    expect(abort).toHaveBeenCalledWith("c1");
    expect(loadDraft("c1")).toBe("survivor\n\nwith file");
    expect(loadFileAttachments("c1").map((file) => file.ref.name)).toEqual(["a.txt"]);
  });

  it("never restores notification items to the draft", async () => {
    const abort = vi.fn().mockResolvedValue({ restored: [] });
    await stopAndRestore(api(abort), "c1", undefined, [queued(1, "user text"), notice(2, "exited 0")]);
    // Pre-contract fallback: the passed snapshot is filtered to user items only.
    const fallback = vi.fn().mockResolvedValue(undefined);
    await stopAndRestore(api(fallback), "c2", undefined, [queued(1, "user text"), notice(2, "exited 0")]);
    expect(loadDraft("c1")).toBe("");
    expect(loadDraft("c2")).toBe("user text");
  });

  it("scopes the draft per node", async () => {
    const abort = vi.fn().mockResolvedValue({ restored: [{ text: "first", files: [] }] });
    await stopAndRestore(api(abort), "c1", "m1", [queued(1, "first")]);
    expect(loadDraft("n:m1:c1")).toBe("first");
    expect(loadDraft("c1")).toBe("");
  });

  it("leaves the draft alone when nothing was queued", async () => {
    const abort = vi.fn().mockResolvedValue({ restored: [] });
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
