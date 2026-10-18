import { connect, type Socket } from "node:net";
import { createFakeCore, type FakeCore } from "@tau/testkit";
import type { MachineGateway } from "../machines/gateway";
import { buildProxyV2 } from "../security/proxy-v2";
import { startTestServer, type TestServer } from "./harness";

export const TUNNEL_HOSTNAME = "fake-1.tunnel.test";
export const TUNNEL_PEER = "203.0.113.7";

export interface TunnelRequest {
  readonly method?: string;
  readonly path: string;
  /** Default: the tunnel hostname. */
  readonly host?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** Default: the tunnel hostname. */
  readonly sni?: string;
  readonly peer?: string;
}

export interface TunnelResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body: string;
}

export interface TunneledServer extends TestServer {
  readonly core: FakeCore;
  readonly tunnelPort: number;
  /** One HTTP request over a socket the tunnel listener tagged (what a visitor through the tunnel is). */
  tunnel(request: TunnelRequest): Promise<TunnelResponse>;
  /** A socket with a PROXY v2 header already written, for WebSocket clients (`createConnection`). */
  tunnelSocket(options?: { sni?: string; peer?: string }): Socket;
  /** Links a device through the core and returns its cookie header. */
  linkDevice(name?: string): Promise<{ cookie: string; deviceId: string }>;
  /** Links a machine through the core and returns its secret (a Bearer, never a cookie). */
  linkMachine(name?: string): Promise<{ secret: string; deviceId: string }>;
}

function parseResponse(raw: string): TunnelResponse {
  const [head = "", ...rest] = raw.split("\r\n\r\n");
  const [statusLine = "", ...lines] = head.split("\r\n");
  const headers: Record<string, string | string[]> = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    const name = line.slice(0, index).toLowerCase();
    const value = line.slice(index + 1).trim();
    const previous = headers[name];
    headers[name] = previous === undefined ? value : [...[previous].flat(), value];
  }
  return { status: Number(statusLine.split(" ")[1] ?? 0), headers, body: rest.join("\r\n\r\n") };
}

function rawHttp(request: TunnelRequest): string {
  const body = request.body ?? "";
  const headers: Record<string, string> = {
    host: request.host ?? TUNNEL_HOSTNAME,
    connection: "close",
    ...(body !== "" && { "content-length": String(Buffer.byteLength(body)) }),
    ...request.headers,
  };
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  return `${request.method ?? "GET"} ${request.path} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n${body}`;
}

export function openTunnelSocket(port: number, options: { sni?: string; peer?: string } = {}): Socket {
  const socket = connect(port, "127.0.0.1");
  socket.write(buildProxyV2(options.peer ?? TUNNEL_PEER, options.sni ?? TUNNEL_HOSTNAME));
  return socket;
}

function exchange(socket: Socket, text: string): Promise<string> {
  return new Promise((resolve) => {
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
    });
    socket.on("close", () => resolve(received));
    socket.on("error", () => undefined);
    socket.write(text);
  });
}

async function waitUntilTunnelHostKnown(server: TestServer, port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const socket = openTunnelSocket(port);
    const response = parseResponse(await exchange(socket, rawHttp({ path: "/api/health" })));
    if (response.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`The tunnel hostname never reached the guard (${server.server.port})`);
}

/** A server whose fake core has remote on (hostname `TUNNEL_HOSTNAME`), plus helpers to speak through its tunnel listener. */
export async function startTunneledServer(
  options: { staticDir?: string; gateway?: MachineGateway } = {},
): Promise<TunneledServer> {
  const core = createFakeCore({ configured: true, speed: 1000, remote: true });
  const base = await startTestServer({ core, staticDir: options.staticDir, gateway: options.gateway });
  const { tunnelPort } = base.server;
  await waitUntilTunnelHostKnown(base, tunnelPort);
  return {
    ...base,
    core,
    tunnelPort,
    tunnel: async (request) => {
      const socket = openTunnelSocket(tunnelPort, { sni: request.sni, peer: request.peer });
      return parseResponse(await exchange(socket, rawHttp(request)));
    },
    tunnelSocket: (socketOptions) => openTunnelSocket(tunnelPort, socketOptions),
    async linkMachine(name = "Homelab") {
      const minted = await core.access.mintPairing({ kind: "machine" });
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: name,
        peer: TUNNEL_PEER,
      });
      return { secret: redeemed.secret, deviceId: redeemed.deviceId };
    },
    async linkDevice(name = "Safari on iPhone") {
      const minted = await core.access.mintPairing({ kind: "device" });
      const redeemed = await core.access.redeemPairing({
        code: minted.code,
        deviceName: name,
        peer: TUNNEL_PEER,
      });
      return { cookie: `tau_device=${redeemed.secret}`, deviceId: redeemed.deviceId };
    },
  };
}
