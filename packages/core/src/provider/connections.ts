import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ProviderInfo } from "@tau/protocol";
import type { ClaudeCliService } from "../claude-cli/service";
import { isClaudeCliReady } from "../claude-cli/status";
import { type KeyProviderEntry, type ProviderEntry, primaryPiId } from "./providers-table";

export type Connection = ProviderInfo["connection"];

export interface ConnectionReader {
  /** The stored credential first; only without one, the environment key. Faux mode ignores the environment. */
  read(entry: ProviderEntry): Promise<Connection>;
  /** Raw key for a key provider, stored first then env; `undefined` in faux mode without a stored key. */
  keyOf(entry: KeyProviderEntry): Promise<string | undefined>;
  /** The saved key could not be checked (offline); reported as `valid: null` until the process restarts. */
  markUnchecked(entry: ProviderEntry): void;
  markChecked(entry: ProviderEntry): void;
}

export function createConnectionReader(deps: {
  credentials: CredentialStore;
  models: Models;
  faux: boolean;
  claudeCli: ClaudeCliService;
  env: Readonly<Record<string, string | undefined>>;
}): ConnectionReader {
  const unchecked = new Set<string>();
  const envChecks = new Map<string, Promise<boolean | null>>();

  function checkEnvKeyOnce(entry: KeyProviderEntry, key: string): Promise<boolean | null> {
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

  async function readEnvKey(entry: KeyProviderEntry): Promise<string | undefined> {
    if (entry.piProviders.length === 0) return deps.env[entry.envVar] || undefined;
    const auth = await deps.models.getAuth(primaryPiId(entry)).catch(() => undefined);
    return auth?.auth.apiKey;
  }

  async function readEnvironmentConnection(entry: KeyProviderEntry): Promise<Connection> {
    const key = await readEnvKey(entry);
    if (!key) return null;
    return { method: "api_key", source: "env", valid: await checkEnvKeyOnce(entry, key) };
  }

  function readCliConnection(): Connection {
    const status = deps.claudeCli.status();
    if (!status || !isClaudeCliReady(status)) return null;
    return { method: "claude_cli", source: "cli", valid: true };
  }

  return {
    async keyOf(entry) {
      const stored = await deps.credentials.read(primaryPiId(entry));
      if (stored?.type === "api_key" && stored.key) return stored.key;
      if (deps.faux) return undefined;
      return readEnvKey(entry);
    },
    async read(entry) {
      if (entry.kind === "cli") return readCliConnection();
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
