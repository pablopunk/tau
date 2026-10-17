import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ProviderInfo } from "@pi-everywhere/protocol";
import { type ProviderEntry, primaryPiId } from "./providers-table";

export type Connection = ProviderInfo["connection"];

export interface ConnectionReader {
  /** The stored credential first; only without one, the environment key. Faux mode ignores the environment. */
  read(entry: ProviderEntry): Promise<Connection>;
  /** The saved key could not be checked (offline); reported as `valid: null` until the process restarts. */
  markUnchecked(entry: ProviderEntry): void;
  markChecked(entry: ProviderEntry): void;
}

export function createConnectionReader(deps: {
  credentials: CredentialStore;
  models: Models;
  faux: boolean;
}): ConnectionReader {
  const unchecked = new Set<string>();
  const envChecks = new Map<string, Promise<boolean | null>>();

  function checkEnvKeyOnce(entry: ProviderEntry, key: string): Promise<boolean | null> {
    const cacheKey = `${entry.id}:${key}`;
    let check = envChecks.get(cacheKey);
    if (!check) {
      check = entry.validate(key).then(
        (result) => (result === "unknown" ? null : result === "valid"),
        () => null,
      );
      envChecks.set(cacheKey, check);
    }
    return check;
  }

  async function readEnvironmentConnection(entry: ProviderEntry): Promise<Connection> {
    const auth = await deps.models.getAuth(primaryPiId(entry)).catch(() => undefined);
    const key = auth?.auth.apiKey;
    if (!key) return null;
    return { method: "api_key", source: "env", valid: await checkEnvKeyOnce(entry, key) };
  }

  return {
    async read(entry) {
      const stored = await deps.credentials.read(primaryPiId(entry));
      if (stored?.type === "oauth") return { method: "chatgpt", source: "file", valid: true };
      if (stored?.key)
        return { method: "api_key", source: "file", valid: unchecked.has(entry.id) ? null : true };
      return deps.faux ? null : readEnvironmentConnection(entry);
    },
    markUnchecked: (entry) => void unchecked.add(entry.id),
    markChecked: (entry) => void unchecked.delete(entry.id),
  };
}
