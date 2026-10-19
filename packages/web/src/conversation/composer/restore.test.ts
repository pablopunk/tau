import { MAX_IMAGES_PER_MESSAGE } from "@tau/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAttachments, newAttachment, saveAttachments } from "../images/attachments";
import { loadDraft, saveDraft } from "./drafts";
import { onComposerRestore, restoreQueuedToComposer, restoreToComposer } from "./restore";

const png = (data: string) => ({ mimeType: "image/png" as const, data });

beforeEach(() => {
  window.localStorage.clear();
  saveAttachments("c1", []);
  saveAttachments("c2", []);
});

describe("restoreToComposer", () => {
  it("fills an empty draft", () => {
    restoreToComposer("c1", { text: "cancelled", images: [] });
    expect(loadDraft("c1")).toBe("cancelled");
  });

  it("keeps what was already typed, below the restored text", () => {
    saveDraft("c1", "typing now");
    restoreToComposer("c1", { text: "cancelled", images: [] });
    expect(loadDraft("c1")).toBe("cancelled\n\ntyping now");
  });

  it("keeps the draft when the cancelled message has no text", () => {
    saveDraft("c1", "typing now");
    restoreToComposer("c1", { text: "", images: [png("a")] });
    expect(loadDraft("c1")).toBe("typing now");
  });

  it("appends images after the attached ones", () => {
    saveAttachments("c1", [newAttachment(png("old"))]);
    restoreToComposer("c1", { text: "x", images: [png("new")] });
    expect(loadAttachments("c1").map((item) => item.image.data)).toEqual(["old", "new"]);
  });

  it("caps images at the per-message limit", () => {
    const full = Array.from({ length: MAX_IMAGES_PER_MESSAGE - 1 }, (_, i) => newAttachment(png(`o${i}`)));
    saveAttachments("c1", full);
    restoreToComposer("c1", { text: "x", images: [png("a"), png("b")] });
    expect(loadAttachments("c1")).toHaveLength(MAX_IMAGES_PER_MESSAGE);
  });

  it("notifies only the listener of that target", () => {
    const one = vi.fn();
    const two = vi.fn();
    const off1 = onComposerRestore("c1", one);
    const off2 = onComposerRestore("c2", two);
    restoreToComposer("c1", { text: "x", images: [] });
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
    off1();
    off2();
    restoreToComposer("c1", { text: "y", images: [] });
    expect(one).toHaveBeenCalledTimes(1);
  });
});

describe("restoreQueuedToComposer", () => {
  const queued = (id: number, text: string) => ({
    id,
    mode: "followUp" as const,
    text,
    images: [],
  });

  it("does nothing when nothing was queued", () => {
    const listener = vi.fn();
    const off = onComposerRestore("c1", listener);
    restoreQueuedToComposer("c1", []);
    expect(loadDraft("c1")).toBe("");
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("keeps queued order ahead of the draft", () => {
    saveDraft("c1", "typing now");
    restoreQueuedToComposer("c1", [queued(1, "first"), queued(2, "second")]);
    expect(loadDraft("c1")).toBe("first\n\nsecond\n\ntyping now");
  });

  it("restores images in queued order", () => {
    restoreQueuedToComposer("c1", [
      { ...queued(1, "a"), images: [{ type: "image" as const, mimeType: "image/png", data: "a" }] },
      { ...queued(2, "b"), images: [{ type: "image" as const, mimeType: "image/png", data: "b" }] },
    ]);
    expect(loadDraft("c1")).toBe("a\n\nb");
    expect(loadAttachments("c1").map((item) => item.image.data)).toEqual(["a", "b"]);
  });
});
