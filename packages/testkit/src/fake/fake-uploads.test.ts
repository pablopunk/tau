import { beforeEach, describe, expect, test } from "vitest";
import { createFakeCore } from "./fake-core";
import { FAKE_UPLOAD_TTL_MS } from "./fake-uploads";

describe("fake uploads", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
  });

  const coreWithUpload = () => {
    const core = createFakeCore({ configured: true, speed: 100, now: () => now });
    return { core, stop: () => core.close() };
  };

  const stage = (core: ReturnType<typeof createFakeCore>) =>
    core.uploads.stage({
      name: "notes.txt",
      mimeType: "text/plain",
      data: Buffer.from("hello").toString("base64"),
    });

  test("a fresh ref sends, an expired one rejects file_expired", async () => {
    const { core, stop } = coreWithUpload();
    try {
      const fresh = await stage(core);
      const conversation = await core.conversations.start({
        projectId: "home",
        text: "read this",
        files: [fresh],
        requestId: "request-1",
      });
      expect(conversation.id).toBeDefined();

      now += FAKE_UPLOAD_TTL_MS + 1;
      await expect(
        core.conversations.send(conversation.id, {
          text: "read it again",
          files: [fresh],
          requestId: "request-2",
        }),
      ).rejects.toMatchObject({ code: "file_expired" });
    } finally {
      await stop();
    }
  });
});
