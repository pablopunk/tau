import type { ServerFrame } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
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

describe("fake transport: remote access and devices", () => {
  it("turns remote on, links a device through the code, lists it as this device, revokes it", async () => {
    const { api, frames, socket } = setup();
    expect((await api.remote.status()).state).toBe("off");
    const on = await api.remote.enable();
    expect(on).toMatchObject({ state: "online", url: expect.stringMatching(/^https:\/\//) });
    const minted = await api.access.mintPairing({ kind: "device" });
    expect(minted.link).toBe(`${on.url}/pair#${minted.code}`);
    await api.access.redeemPairing({ code: minted.shortCode, deviceName: "Safari on iPhone" });
    const [device] = await api.access.devices();
    expect(device).toMatchObject({ name: "Safari on iPhone", kind: "phone", current: true });
    await until(() => frames.some((frame) => frame.type === "changed"));
    await api.access.revokeDevice(device?.id ?? "");
    expect(await api.access.devices()).toEqual([]);
    expect((await api.remote.disable()).state).toBe("off");
    socket.close();
  });
});

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

describe("fake transport: nodes (Stage 2)", () => {
  it("lists two nodes, one online, and renames and disconnects through the routes", async () => {
    const hub = createFakeCore({ configured: true, nodes: true });
    const api = createApi(createFakeTransport(hub));
    await until(() => true);
    const nodes = await api.nodes.list();
    expect(nodes.map(({ name, status }) => [name, status])).toEqual([
      ["Homelab", "online"],
      ["Work laptop", "offline"],
    ]);
    await api.nodes.rename(nodes[0]?.id ?? "", "NAS");
    expect((await api.nodes.list())[0]?.name).toBe("NAS");
    expect(await api.nodes.hubLink()).toMatchObject({ state: "none" });
    await api.nodes.disconnect(nodes[1]?.id ?? "");
    expect(await api.nodes.list()).toHaveLength(1);
  });

  it("keeps each node's data apart from the hub's and from the other node", async () => {
    const hub = createFakeCore({ configured: true, nodes: true });
    const [first, second] = [...hub.nodeCores.values()];
    await first?.projects.add({ path: "/Users/demo/project" });
    expect(await first?.projects.list()).toHaveLength(2);
    expect(await second?.projects.list()).toHaveLength(1);
    expect(await hub.projects.list()).toHaveLength(1);
  });
});
