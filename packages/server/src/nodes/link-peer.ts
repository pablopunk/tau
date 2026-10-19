import { createHash } from "node:crypto";
import {
  AppError,
  type Core,
  type HelloFrame,
  LINK_CLOSE_POLICY,
  LINK_OFFLINE_AFTER_MS,
  LINK_PING_INTERVAL_MS,
  type LinkFrame,
  type LinkRole,
} from "@tau/protocol";
import type { RawData, WebSocket } from "ws";
import { sanitiseVia } from "./device-labels";
import type { LinkFacts } from "./duplicate-links";
import type { GatewayRequest, GatewayResponse, GatewayStreamRequest } from "./gateway";
import { clipReason, parseControlFrame, toBytes, wireCloseCode } from "./link-frames";
import { buildHello, buildProof, checkHello, checkProof } from "./link-handshake";
import { type IncomingOpen, LinkMux } from "./link-mux";
import type { LinkRegistry, RegisteredLink } from "./link-registry";
import type { PeerClosed, PeerHandle, PeerInfo } from "./peer-seam";
import { requestOverLink } from "./request-client";
import { serveRequest } from "./request-responder";
import { pipeSocketOverLink } from "./socket-client";
import { serveStream } from "./socket-responder";

const TICK_MS = 1000;
const HEARTBEAT_EVERY_MS = 1000;
const HANDSHAKE_MS = 10_000;
const FORCE_CLOSE_MS = 5000;
const GOING_AWAY = 1001;
const INTERNAL = 1011;
const NODE_OFFLINE = "This node is offline.";
const REMOVAL_REASONS: ReadonlySet<string> = new Set(["disconnect", "forget", "revoked"]);

/** What a link needs from the server it lives in. */
export interface PeerServer {
  readonly core: Core;
  /** The bound port (`RunningServer.port`): the responder calls this server on loopback. */
  readonly port: number;
  /** The server's own master token for those calls. */
  readonly token: string;
  readonly registry: LinkRegistry;
}

export interface LinkPeer extends PeerHandle, RegisteredLink {}

export interface CreateLinkPeerOptions {
  readonly socket: WebSocket;
  readonly role: LinkRole;
  readonly server: PeerServer;
  readonly peer: PeerInfo;
}

export const secretKeyOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");

interface Queued {
  readonly data: RawData;
  readonly isBinary: boolean;
}

/**
 * One symmetric node link, whoever dialled: the handshake, the stream table and the pings; the gateway for requests
 * to the remote node and the responder for requests from it.
 */
export function createLinkPeer(options: CreateLinkPeerOptions): LinkPeer {
  return new Peer(options);
}

class Peer implements LinkPeer {
  readonly closed: Promise<PeerClosed>;
  private readonly mux: LinkMux;
  private readonly socket: WebSocket;
  private readonly startedAt = Date.now();
  private ownHello: HelloFrame | undefined;
  private ownNodeId = "";
  private ownLinkProtocol = "";
  private peerHello: HelloFrame | undefined;
  private gotProof = false;
  private admitted = false;
  private registered = false;
  private established = false;
  private ended = false;
  private byeReceived = false;
  private removed = false;
  private holding = true;
  private lastFrameAt = Date.now();
  private lastPingAt = Date.now();
  private lastHeartbeatAt = 0;
  private readonly inbox: Queued[] = [];
  private readonly ticker: NodeJS.Timeout;
  private resolveClosed: (closed: PeerClosed) => void = () => undefined;

  constructor(private readonly options: CreateLinkPeerOptions) {
    this.socket = options.socket;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.mux = new LinkMux(options.role, this.socket, {
      incoming: (frame) => this.serve(frame),
      violation: (reason) => this.close(LINK_CLOSE_POLICY, reason),
    });
    this.socket.on("message", (data, isBinary) => this.receive(data, isBinary));
    this.socket.on("close", (code, reason) => this.onSocketClosed(code, reason.toString()));
    this.socket.on("error", () => undefined);
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.ticker.unref();
    void this.begin();
  }

  get role(): LinkRole {
    return this.options.role;
  }

  get peerId(): string {
    return this.options.peer.peerId;
  }

  get nodeId(): string {
    return this.peerHello?.nodeId ?? "";
  }

  facts(): LinkFacts {
    const dialler = this.role === "dialler";
    return {
      direction: dialler ? "dialled" : "accepted",
      diallerId: dialler ? this.ownNodeId : this.nodeId,
      secretKey: this.options.peer.secretKey,
      silentMs: Date.now() - this.lastFrameAt,
    };
  }

  request(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.established || this.ended) return Promise.reject(new AppError("not_found", NODE_OFFLINE));
    return requestOverLink(this.mux, { ...request, via: sanitiseVia(request.via) });
  }

  openStream(request: GatewayStreamRequest, socket: WebSocket): void {
    if (!this.established || this.ended) return void socket.close(1013, "node offline");
    pipeSocketOverLink(this.mux, { ...request, via: sanitiseVia(request.via) }, socket);
  }

  /** Sends `bye` first when told to, then closes the socket; every proxied stream ends with the link. */
  close(code = 1000, reason = "closing", bye = false): void {
    if (bye) {
      this.removed = this.removed || REMOVAL_REASONS.has(reason);
      this.sendJson({ type: "bye", reason: reason.slice(0, 120) });
    }
    if (this.socket.readyState === this.socket.OPEN || this.socket.readyState === this.socket.CONNECTING) {
      this.socket.close(wireCloseCode(code), clipReason(reason));
      setTimeout(() => this.socket.terminate(), FORCE_CLOSE_MS).unref();
    }
  }

  private async begin(): Promise<void> {
    try {
      const self = await this.options.server.core.nodes.self();
      this.ownNodeId = self.nodeId;
      this.ownLinkProtocol = self.linkProtocol;
      this.ownHello = buildHello(self);
      await this.opened();
      this.sendJson(this.ownHello);
    } catch {
      return this.close(INTERNAL, "identity unavailable");
    }
    this.release();
  }

  /** A dialler may attach while its socket is still connecting: the first frame waits for the open. */
  private opened(): Promise<void> {
    if (this.socket.readyState !== this.socket.CONNECTING) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("open", () => resolve());
      this.socket.once("close", () => resolve());
    });
  }

  private sendJson(frame: LinkFrame): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  /** Held while an async handshake step runs, so frames keep their order. */
  private release(): void {
    this.holding = false;
    while (!this.holding && this.inbox.length > 0 && !this.ended) {
      const next = this.inbox.shift() as Queued;
      this.process(next.data, next.isBinary);
    }
  }

  private receive(data: RawData, isBinary: boolean): void {
    if (this.ended) return;
    const now = Date.now();
    this.lastFrameAt = now;
    if (this.registered && now - this.lastHeartbeatAt >= HEARTBEAT_EVERY_MS) {
      this.lastHeartbeatAt = now;
      this.options.server.core.nodes.heartbeat(this.nodeId);
    }
    if (this.holding) this.inbox.push({ data, isBinary });
    else this.process(data, isBinary);
  }

  private process(data: RawData, isBinary: boolean): void {
    const bytes = toBytes(data);
    if (isBinary) {
      if (!this.established) return void this.close(LINK_CLOSE_POLICY, "data before the handshake");
      return void this.mux.receiveBinary(bytes);
    }
    const frame = parseControlFrame(bytes);
    if (!frame) return void this.close(LINK_CLOSE_POLICY, "bad frame");
    this.control(frame);
  }

  private control(frame: LinkFrame): void {
    switch (frame.type) {
      case "ping":
        return void this.sendJson({ type: "pong" });
      case "pong":
        return;
      case "bye":
        return void this.onBye(frame.reason);
      case "hello":
        return void this.onHello(frame);
      case "proof":
        return void this.onProof(frame);
      default:
        if (!this.established) return void this.close(LINK_CLOSE_POLICY, "frame before the handshake");
        this.mux.receiveControl(frame);
    }
  }

  private onBye(reason: string): void {
    this.byeReceived = true;
    const disconnected = reason === "disconnect" && this.options.role === "acceptor" && this.registered;
    if (disconnected) {
      this.removed = true;
      void this.options.server.core.nodes.disconnect(this.nodeId).catch(() => undefined);
    }
    this.close(1000, "bye received");
  }

  private onHello(hello: HelloFrame): void {
    if (this.peerHello) return void this.close(LINK_CLOSE_POLICY, "second hello");
    const own = { nodeId: this.ownNodeId, linkProtocol: this.ownLinkProtocol };
    const check = checkHello(hello, own, this.options.peer.pinnedNodeId);
    if (!check.ok) return void this.close(check.code, check.reason);
    this.peerHello = hello;
    this.holding = true;
    void this.answer(hello);
  }

  private async answer(hello: HelloFrame): Promise<void> {
    try {
      this.sendJson(await buildProof(this.options.server.core, { nodeId: this.ownNodeId }, hello));
    } catch {
      return this.close(INTERNAL, "cannot sign");
    }
    this.release();
  }

  private onProof(proof: Extract<LinkFrame, { type: "proof" }>): void {
    if (!this.peerHello || !this.ownHello) return void this.close(LINK_CLOSE_POLICY, "proof before hello");
    if (this.gotProof) return void this.close(LINK_CLOSE_POLICY, "second proof");
    const check = checkProof(proof, this.ownHello, this.peerHello);
    if (!check.ok) return void this.close(check.code, check.reason);
    this.gotProof = true;
    this.holding = true;
    void this.establish(this.peerHello);
  }

  private async establish(hello: HelloFrame): Promise<void> {
    const { core, registry } = this.options.server;
    const admission = registry.admit(this);
    if (!admission.ok) return this.close(admission.code, admission.reason);
    this.admitted = true;
    try {
      await core.nodes.register(
        this.peerId,
        nodeInfoOf(hello),
        this.role === "dialler" ? "dialled" : "accepted",
      );
      this.registered = true;
      core.nodes.heartbeat(hello.nodeId);
    } catch {
      return this.close(INTERNAL, "register failed");
    }
    this.established = true;
    this.release();
  }

  private serve(frame: IncomingOpen): void {
    const context = { mux: this.mux, port: this.options.server.port, token: this.options.server.token };
    if (frame.type === "request") serveRequest(context, frame);
    else serveStream(context, frame);
  }

  private tick(): void {
    const now = Date.now();
    if (!this.established) {
      if (now - this.startedAt >= HANDSHAKE_MS) this.close(LINK_CLOSE_POLICY, "handshake timeout");
      return;
    }
    if (now - this.lastFrameAt >= LINK_OFFLINE_AFTER_MS) return void this.close(GOING_AWAY, "no frames");
    if (now - this.lastPingAt >= LINK_PING_INTERVAL_MS) {
      this.lastPingAt = now;
      this.sendJson({ type: "ping" });
      this.options.server.core.nodes.heartbeat(this.nodeId);
    }
    this.mux.checkStalled(now);
  }

  private onSocketClosed(code: number, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.ticker);
    this.mux.end();
    const { core, registry } = this.options.server;
    if (this.admitted && registry.release(this) && this.registered && !this.removed) {
      core.nodes.markOffline(this.nodeId);
      if (this.role === "dialler")
        core.nodes.reportLink(this.nodeId, { state: "reconnecting", message: null, since: Date.now() });
    }
    this.resolveClosed({ code, reason, linked: this.established, bye: this.byeReceived });
  }
}

function nodeInfoOf(hello: HelloFrame) {
  return {
    name: hello.name,
    os: hello.os,
    tauVersion: hello.tauVersion,
    protocolVersion: hello.protocolVersion,
    linkProtocol: hello.linkProtocol,
    capabilities: hello.capabilities,
    nodeId: hello.nodeId,
    publicKey: hello.publicKey,
  };
}
