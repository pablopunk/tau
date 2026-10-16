import type { ServerFrame } from "@pi-everywhere/protocol";
import { createFakeCore } from "@pi-everywhere/testkit";
import { describe, expect, it } from "vitest";
import { createApi } from "../api";
import { createFakeTransport } from "./fake";

function setup() {
  const api = createApi(createFakeTransport(createFakeCore({ speed: 50, configured: true })));
  const frames: ServerFrame[] = [];
  const socket = api.live.open({
    onOpen: () => {},
    onFrame: (frame) => frames.push(frame),
    onClose: () => {},
  });
  return { api, frames, socket };
}

const until = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((r) => setTimeout(r, 10));
  expect(condition()).toBe(true);
};

describe("fake transport", () => {
  it("serves the REST routes from the fake core", async () => {
    const { api, socket } = setup();
    const project = await api.projects.add({ path: "/Users/demo/project" });
    expect(await api.projects.list()).toEqual([expect.objectContaining({ kind: "home" }), project]);
    await expect(api.projects.add({ path: "/Users/demo/project" })).rejects.toMatchObject({
      code: "duplicate_project",
    });
    socket.close();
  });

  it("pushes changed frames and ops for subscribed conversations", async () => {
    const { api, frames, socket } = setup();
    const project = await api.projects.add({ path: "/Users/demo/project" });
    const conversation = await api.conversations.start({
      projectId: project.id,
      text: "first",
      requestId: "r0",
    });
    socket.send({ type: "subscribe", conversationId: conversation.id });
    await until(() => frames.some((frame) => frame.type === "ops"));
    await api.conversations.send(conversation.id, { text: "hello", requestId: "r1" });
    await until(() => frames.filter((frame) => frame.type === "ops").length > 3);
    expect(frames.some((frame) => frame.type === "changed")).toBe(true);
    socket.close();
  });

  it("answers a subscribe to an unknown conversation with a retired view", async () => {
    const { frames, socket } = setup();
    socket.send({ type: "subscribe", conversationId: "nope" });
    await until(() => frames.length > 0);
    expect(frames[0]).toEqual({ type: "ops", conversationId: "nope", ops: [["r", null]] });
    socket.close();
  });
});
