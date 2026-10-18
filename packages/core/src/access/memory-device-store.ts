import type { DeviceStore, StoredDevice } from "./ports";

export function createMemoryDeviceStore(initial: readonly StoredDevice[] = []): DeviceStore {
  let devices = [...initial];
  return {
    read: async () => [...devices],
    write: async (next) => {
      devices = [...next];
    },
  };
}
