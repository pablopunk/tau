import {
  CREDIT_WINDOW_BYTES,
  decodeDataFrame,
  encodeDataFrame,
  type LinkFrame,
  ROUTE_TTL_START,
  STEP2_CAPABILITIES,
} from "@tau/protocol";
import { generateNodeKeys, nodeIdOf, signRequestHeader } from "@tau/protocol/identity";
import { createFakeCore } from "@tau/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { viaNode } from "../../testing/two-nodes";
import { type IncomingOpen, LinkMux } from "../link-mux";
import { createLinkRegistry, type RegisteredLink } from "../link-registry";
import { clockOffsetMs } from "./clock";
import { createClosers } from "./closers";
import { createForwarder } from "./forward";
import { relayStream } from "./relay-pair";
import { connectChain, startChain, startChainNode } from "./test-chain";
import { createLocalVerifier } from "./verify-local";

afterEach(() => {
  vi.unstubAllEnvs();
});

interface FakeSocket {
  readonly OPEN: 1;
  readyState: 1;
  bufferedAmount: 0;
  sent: Array<string | Uint8Array>;
  send(data: string | Uint8Array): void;
}
const fakeSocket = (): FakeSocket => {
  const socket: FakeSocket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    send: (data) => void socket.sent.push(data),
  };
  return socket;
};
const mux = (role: "dialler" | "acceptor", socket: FakeSocket) =>
  new LinkMux(role, socket as unknown as WebSocket, {
    incoming: () => undefined,
    violation: () => undefined,
  });
const controls = (socket: FakeSocket): LinkFrame[] =>
  socket.sent.filter((data): data is string => typeof data === "string").map((text) => JSON.parse(text));
const binaries = (socket: FakeSocket): Uint8Array[] =>
  socket.sent.filter((data): data is Uint8Array => typeof data !== "string");

describe("r2: trail and ttl", () => {
  const core = createFakeCore({ configured: true });
  const link = (nodeId: string): RegisteredLink =>
    ({ nodeId, capabilities: STEP2_CAPABILITIES, mux: mux("acceptor", fakeSocket()) }) as RegisteredLink;
  const forwarder = createForwarder({ core, registry: createLinkRegistry(core), closers: createClosers() });
  const frame = (extra: Partial<IncomingOpen>): IncomingOpen =>
    ({
      type: "request",
      id: 2,
      method: "GET",
      path: "/api/projects",
      query: "",
      via: "",
      dest: "D",
      origin: "O",
      trail: ["O"],
      ttl: ROUTE_TTL_START,
      ...extra,
    }) as IncomingOpen;

  it("dies at the receiver when the trail holds its own id", () => {
    const refusal = forwarder.forward(link("X"), "ME", frame({ trail: ["O", "ME", "X"] }));
    expect(refusal?.reason).toBe("ttl or loop");
  });
  it("dies at the receiver when ttl is spent", () => {
    expect(forwarder.forward(link("O"), "ME", frame({ ttl: 0 }))?.reason).toBe("ttl or loop");
  });
  it("refuses a trail whose last hop is not the link it came on, and an origin that is not trail[0]", () => {
    expect(forwarder.forward(link("Z"), "ME", frame({}))?.reason).toBe("bad trail");
    expect(forwarder.forward(link("O"), "ME", frame({ origin: "Q" }))?.reason).toBe("bad origin");
  });
});

describe("r4: per-hop credit", () => {
  const open = {
    type: "open",
    id: 2,
    path: "/api/live",
    query: "",
    via: "",
    dest: "D",
    origin: "O",
    trail: ["O"],
    ttl: 15,
  } as IncomingOpen;
  const dataTo = (inMux: LinkMux, id: number, size: number) =>
    inMux.receiveBinary(encodeDataFrame({ id, end: false, text: false, payload: new Uint8Array(size) }));
  const setup = () => {
    const inSocket = fakeSocket();
    const outSocket = fakeSocket();
    const inMux = mux("acceptor", inSocket);
    const outMux = mux("dialler", outSocket);
    return { inSocket, outSocket, inMux, outMux };
  };

  it("rewrites the id, forwards ready, and returns credit upstream after the send", () => {
    const { inSocket, outSocket, inMux, outMux } = setup();
    relayStream({ inMux, outMux, frame: open, onGone: () => undefined });
    const outOpen = controls(outSocket)[0] as IncomingOpen;
    expect(outOpen.type).toBe("open");
    expect(outOpen.id).not.toBe(open.id);
    dataTo(inMux, open.id, 1000);
    expect(binaries(outSocket)).toHaveLength(0);
    outMux.receiveControl({ type: "ready", id: outOpen.id });
    expect(controls(inSocket)).toContainEqual({ type: "ready", id: open.id });
    expect(binaries(outSocket)).toHaveLength(1);
    expect(decodeDataFrame(binaries(outSocket)[0] as Uint8Array)?.id).toBe(outOpen.id);
    expect(controls(inSocket).filter((frame) => frame.type === "credit")).toEqual([
      { type: "credit", id: open.id, bytes: 1000 },
    ]);
  });

  it("holds at most one window while the outgoing link gives no credit", () => {
    const { inSocket, outSocket, inMux, outMux } = setup();
    relayStream({ inMux, outMux, frame: open, onGone: () => undefined });
    const outId = (controls(outSocket)[0] as IncomingOpen).id;
    outMux.receiveControl({ type: "ready", id: outId });
    for (let index = 0; index < CREDIT_WINDOW_BYTES / 16384; index++) dataTo(inMux, open.id, 16 * 1024);
    const forwarded = binaries(outSocket).length;
    expect(forwarded * 16 * 1024).toBeLessThanOrEqual(CREDIT_WINDOW_BYTES);
    expect(controls(inSocket).filter((frame) => frame.type === "credit")).toHaveLength(forwarded);
  });

  it("closes 1013 on both hops after 60 s without credit; another stream is unaffected", () => {
    const { inSocket, outSocket, inMux, outMux } = setup();
    const gone = vi.fn();
    relayStream({ inMux, outMux, frame: open, onGone: gone });
    const quiet = { ...open, id: 4 } as IncomingOpen;
    relayStream({ inMux, outMux, frame: quiet, onGone: () => undefined });
    const outId = (controls(outSocket)[0] as IncomingOpen).id;
    outMux.receiveControl({ type: "ready", id: outId });
    for (let index = 0; index <= CREDIT_WINDOW_BYTES / 16384; index++) dataTo(inMux, open.id, 16 * 1024);
    const later = Date.now() + 61_000;
    inMux.checkStalled(later);
    outMux.checkStalled(later);
    const closes = (socket: FakeSocket) => controls(socket).filter((frame) => frame.type === "close");
    expect(closes(inSocket)).toMatchObject([{ id: open.id, code: 1013 }]);
    expect(closes(outSocket)).toMatchObject([{ id: outId, code: 1013 }]);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(inMux.streams.has(quiet.id)).toBe(true);
  });

  it("propagates a close from either side", () => {
    const { inSocket, outSocket, inMux, outMux } = setup();
    relayStream({ inMux, outMux, frame: open, onGone: () => undefined });
    const outId = (controls(outSocket)[0] as IncomingOpen).id;
    outMux.receiveControl({ type: "close", id: outId, code: 1011, reason: "boom" });
    expect(controls(inSocket)).toContainEqual({ type: "close", id: open.id, code: 1011, reason: "boom" });
    expect(inMux.streams.size).toBe(0);
    expect(outMux.streams.size).toBe(0);
  });
});

describe("r7: the request header window and replay", () => {
  const origin = generateNodeKeys();
  const dest = nodeIdOf(generateNodeKeys().publicKey);
  const core = createFakeCore({ configured: true });
  const base = { dest, method: "GET", path: "/api/projects", query: "", via: "" };
  const frameAt = (at: number): IncomingOpen =>
    ({ type: "request", id: 2, ...base, ...signRequestHeader(origin, base, at) }) as IncomingOpen;
  const verifier = (clock: number) => createLocalVerifier(core, () => clock, clock - 1_000_000);
  const now = 10_000_000;

  it("refuses a ts beyond 120 s with clock_skew and accepts one inside", () => {
    expect(verifier(now).verify(frameAt(now - 100_000), dest)).toBeUndefined();
    expect(verifier(now).verify(frameAt(now + 121_000), dest)?.reason).toBe("clock_skew");
    expect(verifier(now).verify(frameAt(now - 121_000), dest)?.reason).toBe("clock_skew");
  });
  it("refuses a replay inside the window and a swapped field", () => {
    const once = verifier(now);
    const frame = frameAt(now);
    expect(once.verify(frame, dest)).toBeUndefined();
    expect(once.verify(frame, dest)?.reason).toBe("refused: replay");
    expect(once.verify({ ...frame, path: "/api/other" }, dest)?.reason).toBe("refused: mismatch");
  });
  it("reads TAU_FAKE_CLOCK_OFFSET_MS", () => {
    expect(clockOffsetMs({})).toBe(0);
    expect(clockOffsetMs({ TAU_FAKE_CLOCK_OFFSET_MS: "300000" })).toBe(300_000);
  });
});

describe("r7: through a real chain", () => {
  it("refuses a request from a node whose clock is 5 minutes off with clock_skew", async () => {
    vi.stubEnv("TAU_FAKE_CLOCK_OFFSET_MS", "300000");
    const a = await startChainNode("Alpha");
    vi.unstubAllEnvs();
    const [b, c] = await Promise.all([startChainNode("Bravo"), startChainNode("Charlie")]);
    try {
      await connectChain(a, b, c);
      const response = await a.ctx.request({ url: viaNode(c, "/api/projects") });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("clock_skew");
      expect(c.control.skews.at(-1)?.[0]).toBe(a.nodeId);
    } finally {
      await Promise.all([a.stop(), b.stop(), c.stop()]);
    }
  });

  it("works with clocks in step (control)", async () => {
    const chain = await startChain();
    try {
      expect((await chain.a.ctx.request({ url: viaNode(chain.c, "/api/projects") })).statusCode).toBe(200);
      expect(chain.c.control.skews).toHaveLength(1);
    } finally {
      await chain.stop();
    }
  });
});
