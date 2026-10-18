import { connect } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildProxyV2 } from "./proxy-v2";
import { createTunnelListener, type TunnelListener } from "./tunnel-listener";
import { createTunnelTags } from "./tunnel-tags";

const HOSTNAME = "abc.tunnel.test";
let listener: TunnelListener | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await listener?.close();
  await app?.close();
});

async function start(headerTimeoutMs = 5000) {
  app = Fastify();
  const tags = createTunnelTags();
  app.get("/", async (request: { raw: { socket: import("node:net").Socket } }) => ({
    tagged: tags.tagOf(request.raw.socket) ?? null,
  }));
  await app.ready();
  listener = createTunnelListener({ app, tags, hostname: () => HOSTNAME, headerTimeoutMs });
  return (await listener.start()).port;
}

function talk(port: number, parts: Array<Buffer | string | number>): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString();
    });
    socket.on("close", () => resolve(received));
    socket.on("error", () => undefined);
    (async () => {
      for (const part of parts) {
        if (typeof part === "number") await new Promise((done) => setTimeout(done, part));
        else socket.write(part);
      }
    })();
  });
}

const GET = `GET / HTTP/1.1\r\nHost: ${HOSTNAME}\r\nConnection: close\r\n\r\n`;

describe("tunnel listener", () => {
  it("tags a socket from the header and gives the peer address", async () => {
    const port = await start();
    const response = await talk(port, [buildProxyV2("203.0.113.9", HOSTNAME), GET]);
    expect(response).toContain('"peer":"203.0.113.9"');
  });

  it("accepts the header and the request in one chunk, and the header split in two", async () => {
    const port = await start();
    const header = buildProxyV2("203.0.113.9", HOSTNAME);
    expect(await talk(port, [Buffer.concat([header, Buffer.from(GET)])])).toContain("200");
    expect(await talk(port, [header.subarray(0, 10), 50, header.subarray(10), GET])).toContain("200");
  });

  it("destroys a header split past the timeout", async () => {
    const port = await start(150);
    const header = buildProxyV2("203.0.113.9", HOSTNAME);
    expect(await talk(port, [header.subarray(0, 20), 400, header.subarray(20), GET])).toBe("");
  });

  it("destroys a missing SNI, a wrong SNI and no header", async () => {
    const port = await start();
    expect(await talk(port, [buildProxyV2("203.0.113.9", undefined), GET])).toBe("");
    expect(await talk(port, [buildProxyV2("203.0.113.9", "evil.example"), GET])).toBe("");
    expect(await talk(port, [GET])).toBe("");
  });

  it("serves keep-alive requests on one tagged socket", async () => {
    const port = await start();
    const keepAlive = `GET / HTTP/1.1\r\nHost: ${HOSTNAME}\r\n\r\n`;
    const response = await talk(port, [buildProxyV2("203.0.113.9", HOSTNAME), keepAlive, 100, GET]);
    expect(response.match(/HTTP\/1.1 200/g)).toHaveLength(2);
  });
});
