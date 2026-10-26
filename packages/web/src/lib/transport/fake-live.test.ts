import { decodeServerFrame, type ServerFrame } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { describe, expect, it, vi } from "vitest";
import { createFakeTransport, type FakeLiveSocket } from "./fake";

describe("fake live socket", () => {
  it("emits a watch-failed frame that decodes as a server frame, then resubscribes fresh", async () => {
    const core = createFakeCore({ configured: true, fs: { "/fake/demo": "directory" } });
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    const project = await core.projects.add({ path: "/fake/demo" });
    const conversation = await core.conversations.start({
      projectId: project.id,
      text: "hello",
      requestId: "watch-fail-1",
    });
    const transport = createFakeTransport(core);
    const frames: ServerFrame[] = [];
    let socket!: FakeLiveSocket;
    const opened = new Promise<void>((resolve) => {
      socket = transport.live.open({
        onOpen: () => resolve(),
        onFrame: (frame) => frames.push(frame),
        onClose: () => {},
      }) as FakeLiveSocket;
    });
    await opened;
    socket.send({ type: "subscribe", conversationId: conversation.id });
    await vi.waitFor(() => {
      expect(frames.some((frame) => frame.type === "ops")).toBe(true);
    });
    expect(typeof socket.failWatch).toBe("function");

    socket.failWatch(conversation.id, "listener_error");
    await vi.waitFor(() => {
      expect(frames.some((frame) => frame.type === "watch-failed")).toBe(true);
    });
    const failed = frames.find((frame) => frame.type === "watch-failed");
    expect(failed).toEqual({
      type: "watch-failed",
      conversationId: conversation.id,
      error: "listener_error",
    });
    expect(decodeServerFrame(JSON.stringify(failed))).toEqual(failed);

    socket.send({ type: "subscribe", conversationId: conversation.id });
    const opsCount = () => frames.filter((frame) => frame.type === "ops").length;
    const before = opsCount();
    await vi.waitFor(() => {
      expect(opsCount()).toBeGreaterThan(before);
    });
    socket.close();
    await core.close();
  });
});
