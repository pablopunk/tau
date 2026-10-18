import type { Core } from "@tau/protocol";
import type { WebSocket } from "ws";

const POLICY_VIOLATION = 1008;
const OWNER = "owner";

/** Open sockets by the device that opened them, so a revoke can cut them at once. */
export interface DeviceSockets {
  /** Forgets the socket when it closes. A socket of an empty `deviceId` is closed at once and `add` answers false: callers must not attach. */
  add(deviceId: string, socket: WebSocket): boolean;
  /** A browser socket piped to `machineId` (hub-side proxy). Like `add`, plus `closeMachine`. */
  addProxied(deviceId: string, machineId: string, socket: WebSocket): boolean;
  /** Closes every proxied socket of a machine (it disconnected or was revoked). */
  closeMachine(machineId: string): void;
  closeDevice(deviceId: string): void;
  /** Closes every socket whose device is not in `liveIds` (the owner is never closed). */
  closeExcept(liveIds: ReadonlySet<string>): void;
  count(deviceId: string): number;
}

export function createDeviceSockets(): DeviceSockets {
  const byDevice = new Map<string, Set<WebSocket>>();
  const byMachine = new Map<string, Set<WebSocket>>();
  const closeAll = (sockets: Iterable<WebSocket>) => {
    for (const socket of sockets) socket.close(POLICY_VIOLATION, "revoked");
  };
  const self: DeviceSockets = {
    addProxied(deviceId, machineId, socket) {
      if (!self.add(deviceId, socket)) return false;
      const set = byMachine.get(machineId) ?? new Set<WebSocket>();
      set.add(socket);
      byMachine.set(machineId, set);
      socket.once("close", () => {
        set.delete(socket);
        if (set.size === 0) byMachine.delete(machineId);
      });
      return true;
    },
    closeMachine(machineId) {
      closeAll([...(byMachine.get(machineId) ?? [])]);
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
