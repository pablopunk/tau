import { beforeEach, describe, expect, it, vi } from "vitest";

const image = (data: string) => ({ mimeType: "image/png" as const, data });

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

async function freshAttachments() {
  return import("./attachments");
}

describe("attachments persistence", () => {
  it("mirrors attachments to localStorage", async () => {
    const { loadAttachments, saveAttachments, newAttachment } = await freshAttachments();
    saveAttachments("new", [newAttachment(image("AQID"))]);
    expect(window.localStorage.getItem("tau:attachments:new")).toContain("AQID");
    expect(loadAttachments("new")).toHaveLength(1);
  });

  it("restores attachments after a fresh module load (refresh)", async () => {
    const first = await freshAttachments();
    first.saveAttachments("new", [first.newAttachment(image("AQID"))]);

    const second = await freshAttachments();
    const restored = second.loadAttachments("new");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.image).toEqual(image("AQID"));
  });

  it("drops corrupt stored attachments", async () => {
    window.localStorage.setItem("tau:attachments:new", "{nope");
    const { loadAttachments } = await freshAttachments();
    expect(loadAttachments("new")).toEqual([]);
  });

  it("clears stored attachments when emptied", async () => {
    const { saveAttachments } = await freshAttachments();
    saveAttachments("new", []);
    expect(window.localStorage.getItem("tau:attachments:new")).toBeNull();
  });
});
