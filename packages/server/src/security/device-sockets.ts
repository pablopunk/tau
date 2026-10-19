import type { Core } from "@tau/protocol";
import type { WebSocket } from "ws";

const POLICY_VIOLATION = 1008;
const OWNER = "owner";

/** Open sockets by the device that opened them, so a revoke can cut them at once. */
export interface DeviceSockets {
  /** Forgets the socket when it closes. A socket of an empty `deviceId` is closed at once and `add` answers false: callers must not attach. */
  add(deviceId: string, socket: WebSocket): boolean;
  /** A browser socket piped to `nodeId` (hub-side proxy). Like `add`, plus `closeNode`. */
  addProxied(deviceId: string, nodeId: string, socket: WebSocket): boolean;
  /** Closes every proxied socket of a node (it disconnected or was revoked). */
  closeNode(nodeId: string): void;
  closeDevice(deviceId: string): void;
  /** Closes every socket whose device is not in `liveIds` (the owner is never closed). */
  closeExcept(liveIds: ReadonlySet<string>): void;
  count(deviceId: string): number;
}

export function createDeviceSockets(): DeviceSockets {
  const byDevice = new Map<string, Set<WebSocket>>();
  const byNode = new Map<string, Set<WebSocket>>();
  const closeAll = (sockets: Iterable<WebSocket>) => {
    for (const socket of sockets) socket.close(POLICY_VIOLATION, "revoked");
  };
  const self: DeviceSockets = {
    addProxied(deviceId, nodeId, socket) {
      if (!self.add(deviceId, socket)) return false;
      const set = byNode.get(nodeId) ?? new Set<WebSocket>();
      set.add(socket);
      byNode.set(nodeId, set);
      socket.once("close", () => {
        set.delete(socket);
        if (set.size === 0) byNode.delete(nodeId);
      });
      return true;
    },
    closeNode(nodeId) {
      closeAll([...(byNode.get(nodeId) ?? [])]);
    },
    add(deviceId, socket) {
      if (deviceId === "") {
        socket.close(POLICY_VIOLATION, "unauthorized");
        return false;
      }
      const set = byDevice.get(deviceId) ?? new Set<WebSocket>();
      set.add(socket);
      byDevice.set(deviceId, set);
      socket.once("close", () => {
        set.delete(socket);
        if (set.size === 0) byDevice.delete(deviceId);
      });
      return true;
    },
    closeDevice(deviceId) {
      closeAll([...(byDevice.get(deviceId) ?? [])]);
    },
    closeExcept(liveIds) {
      for (const [deviceId, sockets] of [...byDevice]) {
        if (deviceId !== OWNER && !liveIds.has(deviceId)) closeAll([...sockets]);
      }
    },
    count: (deviceId) => byDevice.get(deviceId)?.size ?? 0,
  };
  return self;
}

/** After any `devices` change: cut the sockets of devices that no longer exist (revoke from the CLI, a new URL). */
export async function closeSocketsOfGoneDevices(core: Core, sockets: DeviceSockets): Promise<void> {
  const devices = await core.access.listDevices();
  sockets.closeExcept(new Set(devices.map((device) => device.id)));
}
