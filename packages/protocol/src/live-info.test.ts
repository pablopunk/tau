import { describe, expect, it } from "vitest";
import { readLive } from "./live-info";
import type { ConversationView } from "./view";

const viewWithInbox = (items: unknown[]) =>
  ({
    entries: [],
    docs: {
      "pi.live": { run: { taskId: "t1" } },
      "pi.inbox": { items },
    },
  }) as unknown as ConversationView;

describe("readLive queued", () => {
  it("reads a text-only queued message stored as a string", () => {
    const view = viewWithInbox([{ id: 1, mode: "followUp", content: "later" }]);
    expect(readLive(view).queued).toMatchObject([
      { id: 1, mode: "followUp", entryKind: "pi.user", text: "later", images: [] },
    ]);
  });

  it("carries the normalized entry kind of the queued item", () => {
    const view = viewWithInbox([
      { id: 1, mode: "followUp", entry: { kind: "app.retry" }, content: "retry" },
      { id: 2, mode: "steer", content: "plain" },
    ]);
    expect(readLive(view).queued).toMatchObject([
      { id: 1, entryKind: "app.retry" },
      { id: 2, entryKind: "pi.user" },
    ]);
  });

  it("reads a queued message with an image stored as content blocks", () => {
    const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" };
    const view = viewWithInbox([{ id: 2, mode: "steer", content: [{ type: "text", text: "look" }, image] }]);
    const [queued] = readLive(view).queued;
    expect(queued?.text).toBe("look");
    expect(queued?.images).toEqual([image]);
  });

  it("reads an image-only queued message with empty text", () => {
    const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" };
    const view = viewWithInbox([{ id: 3, mode: "followUp", content: [image] }]);
    const [queued] = readLive(view).queued;
    expect(queued?.text).toBe("");
    expect(queued?.images).toEqual([image]);
  });
});
