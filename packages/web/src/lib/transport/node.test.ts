import { LIVE_PATH, terminalStreamPath } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../api";
import { createNodeTransport } from "./node";

const urls: string[] = [];

class FakeSocket extends EventTarget {
  constructor(url: string) {
    super();
    urls.push(url);
  }
  close() {}
  send() {}
}

beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("node transport", () => {
  it("adds /api/n/<id> to requests", async () => {
    const api = createApi(createNodeTransport("m1"));
    await api.conversations.list("p 1");
    expect(urls).toEqual(["/api/n/m1/api/projects/p%201/conversations"]);
  });

  it("encodes the node id once", async () => {
    await createApi(createNodeTransport("a b/c")).projects.list();
    expect(urls).toEqual(["/api/n/a%20b%2Fc/api/projects"]);
  });

  it("adds it to the live socket and to terminal streams, with the page's scheme and host", () => {
    const api = createApi(createNodeTransport("m1"));
    api.live.open({ onOpen() {}, onFrame() {}, onClose() {} });
    api.terminals.openStream("t1", { onOpen() {}, onMessage() {}, onClose() {} });
    const origin = `ws://${window.location.host}`;
    expect(urls).toEqual([`${origin}/api/n/m1${LIVE_PATH}`, `${origin}/api/n/m1${terminalStreamPath("t1")}`]);
  });

  it("leaves the local transport's URLs untouched", async () => {
    const { createHttpTransport } = await import("./http");
    const api = createApi(createHttpTransport());
    await api.projects.list();
    api.live.open({ onOpen() {}, onFrame() {}, onClose() {} });
    expect(urls[0]).toBe("/api/projects");
    expect(urls[1]).toBe(`ws://${window.location.host}${LIVE_PATH}`);
  });
});
