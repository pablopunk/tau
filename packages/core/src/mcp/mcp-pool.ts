import type { McpConnection } from "./mcp-connection";

export const IDLE_CLOSE_MS = 10 * 60 * 1000;

export type PoolStatus = {
  state: "idle" | "connected" | "error";
  toolCount: number | null;
  error: string | null;
};

type Entry = {
  name: string;
  connection?: McpConnection;
  opening?: Promise<McpConnection>;
  toolCount: number | null;
  error: string | null;
  timer?: NodeJS.Timeout;
};

export interface McpPool {
  acquire(key: string, name: string, open: () => Promise<McpConnection>): Promise<McpConnection>;
  setToolCount(key: string, count: number): void;
  status(key: string): PoolStatus;
  forget(name: string): Promise<void>;
  closeAll(): Promise<void>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createMcpPool(options: { idleMs?: number; onChange?: () => void } = {}): McpPool {
  const idleMs = options.idleMs ?? IDLE_CLOSE_MS;
  const entries = new Map<string, Entry>();
  const changed = () => options.onChange?.();

  async function closeEntry(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entries.delete(key);
    const connection = entry.connection ?? (await entry.opening?.catch(() => undefined));
    await connection?.close().catch(() => undefined);
  }

  function dropClosed(key: string, connection: McpConnection) {
    const entry = entries.get(key);
    if (entry?.connection !== connection) return;
    clearTimeout(entry.timer);
    entries.delete(key);
    changed();
  }

  function scheduleIdleClose(key: string, entry: Entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void closeEntry(key).then(changed);
    }, idleMs);
    entry.timer.unref();
  }

  async function open(key: string, entry: Entry, opener: () => Promise<McpConnection>) {
    try {
      const connection = await opener();
      entry.connection = connection;
      entry.error = null;
      connection.client.onclose = () => dropClosed(key, connection);
      return connection;
    } catch (error) {
      entry.error = messageOf(error);
      throw error;
    } finally {
      entry.opening = undefined;
      changed();
    }
  }

  return {
    async acquire(key, name, opener) {
      const entry = entries.get(key) ?? { name, toolCount: null, error: null };
      entries.set(key, entry);
      if (!entry.connection && !entry.opening) entry.opening = open(key, entry, opener);
      const connection = entry.connection ?? (await entry.opening);
      if (!connection) throw new Error("MCP connection unavailable");
      scheduleIdleClose(key, entry);
      return connection;
    },
    setToolCount(key, count) {
      const entry = entries.get(key);
      if (entry) entry.toolCount = count;
      changed();
    },
    status(key) {
      const entry = entries.get(key);
      if (!entry) return { state: "idle", toolCount: null, error: null };
      if (entry.error !== null) return { state: "error", toolCount: null, error: entry.error };
      return entry.connection
        ? { state: "connected", toolCount: entry.toolCount, error: null }
        : { state: "idle", toolCount: null, error: null };
    },
    async forget(name) {
      const keys = [...entries].filter(([, entry]) => entry.name === name).map(([key]) => key);
      await Promise.all(keys.map(closeEntry));
      changed();
    },
    async closeAll() {
      await Promise.all([...entries.keys()].map(closeEntry));
    },
  };
}
