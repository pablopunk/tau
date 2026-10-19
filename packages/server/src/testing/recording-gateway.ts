import type { WebSocket } from "ws";
import type { NodeGateway } from "../nodes/gateway";
import { createStubGateway } from "./stub-gateway";

export interface RecordingGateway extends NodeGateway {
  /** Sizes of every message the link sockets received. */
  readonly received: number[];
  readonly links: Map<string, WebSocket>;
}

/** Keeps link sockets open and answers `pong` to a text `ping`; for tests until owner G's multiplexer exists. */
export function createRecordingGateway(): RecordingGateway {
  const received: number[] = [];
  const links = new Map<string, WebSocket>();
  return {
    ...createStubGateway(),
    received,
    links,
    acceptLink(nodeId, socket) {
      links.set(nodeId, socket);
      socket.on("message", (data, isBinary) => {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
        received.push(bytes.length);
        if (!isBinary && bytes.toString() === "ping") socket.send("pong");
      });
    },
  };
}
