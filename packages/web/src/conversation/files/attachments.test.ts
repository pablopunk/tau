import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileRoomLeft,
  formatFileSize,
  loadFileAttachments,
  newFileAttachment,
  saveFileAttachments,
} from "./attachments";

const ref = (overrides = {}) => ({
  name: "notes.txt",
  path: "uploads/00000000-0000-4000-8000-000000000000",
  size: 5,
  ...overrides,
});

beforeEach(() => window.localStorage.clear());

describe("file attachments", () => {
  it("persists only FileRefs under their own key, apart from image attachments", () => {
    window.localStorage.setItem("tau:attachments:t1", JSON.stringify([{ mimeType: "image/png", data: "AQID" }]));
    saveFileAttachments("t1", [newFileAttachment(ref())]);
    expect(window.localStorage.getItem("tau:file-attachments:t1")).toBe(JSON.stringify([ref()]));
    expect(window.localStorage.getItem("tau:attachments:t1")).toContain("AQID");
    expect(loadFileAttachments("t1")).toHaveLength(1);
  });

  it("drops a corrupt entry and starts empty", () => {
    window.localStorage.setItem("tau:file-attachments:t2", JSON.stringify([{ name: "no-path" }]));
    expect(loadFileAttachments("t2")).toEqual([]);
    expect(window.localStorage.getItem("tau:file-attachments:t2")).toBeNull();
  });

  it("drops a ref that fails shape validation", () => {
    window.localStorage.setItem(
      "tau:file-attachments:t3",
      JSON.stringify([ref({ size: -1 })]),
    );
    expect(loadFileAttachments("t3")).toEqual([]);
  });

  it("removes the key when the last file goes", () => {
    saveFileAttachments("t1", [newFileAttachment(ref())]);
    saveFileAttachments("t1", []);
    expect(window.localStorage.getItem("tau:file-attachments:t1")).toBeNull();
    expect(loadFileAttachments("t1")).toEqual([]);
  });

  it("keeps the in-memory copy when storage is unavailable", () => {
    const files = [newFileAttachment(ref())];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      saveFileAttachments("t1", files);
    } finally {
      vi.restoreAllMocks();
    }
    expect(loadFileAttachments("t1")).toEqual(files);
  });

  it("counts room against the shared per-message limit", () => {
    expect(fileRoomLeft([])).toBe(8);
    expect(fileRoomLeft([newFileAttachment(ref())])).toBe(7);
  });

  it("formats sizes for the chip", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
