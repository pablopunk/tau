import type { ConversationView } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { collectConversationImages } from "./collect-images";

const screenshot = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };

function viewWith(...entries: unknown[]): ConversationView {
  return { entries } as unknown as ConversationView;
}

describe("collectConversationImages", () => {
  it("collects images the user sent", () => {
    const view = viewWith({
      id: 1,
      kind: "pi.user",
      model: [{ role: "user", content: [{ type: "text", text: "look" }, screenshot] }],
    });
    const images = collectConversationImages(view);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ source: "user", entryId: "1" });
    expect(images[0]?.src).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("collects screenshots the agent read back through tool results", () => {
    const view = viewWith({
      id: 7,
      kind: "pi.tool-result",
      model: [{ role: "toolResult", toolCallId: "call-1", content: [screenshot] }],
    });
    const images = collectConversationImages(view);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ source: "agent", entryId: "7" });
  });

  it("ignores text-only entries", () => {
    const view = viewWith(
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "hi" }] },
      { id: 2, kind: "pi.user", model: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      {
        id: 3,
        kind: "pi.tool-result",
        model: [{ role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok" }] }],
      },
    );
    expect(collectConversationImages(view)).toHaveLength(0);
  });
});
