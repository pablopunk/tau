import { createHash } from "node:crypto";

/** The slice of the SDK this file needs (structural, so only the adapter imports the SDK). */
export interface ProfileStorage {
  profiles(): Promise<ReadonlyArray<string>>;
  save(profile: string, identity: never): Promise<void>;
  remove(profile: string): Promise<void>;
}
export interface ProfileClient {
  tunnel: {
    get(options: { profile: string }): Promise<unknown>;
    remove(options: { profile: string }): Promise<void>;
  };
}

export const profileNameFor = (directory: string): string =>
  `tau-${createHash("sha256").update(directory).digest("hex").slice(0, 8)}`;

const oldNumber = (profile: string, main: string): number | undefined => {
  const match = new RegExp(`^${main}-old-(\\d+)$`).exec(profile);
  return match ? Number(match[1]) : undefined;
};

export interface TunnelProfiles {
  readonly main: string;
  /** Old identities still waiting for `remove()`, oldest first. */
  oldProfiles(): Promise<string[]>;
  /** Keeps the main identity under the next `-old-<n>` name and frees the main profile. */
  retireMain(): Promise<void>;
  /** Tries `remove()` for each old profile; resolves with how many are left. */
  removeOld(): Promise<number>;
}

export function createTunnelProfiles(
  main: string,
  storage: ProfileStorage,
  client: ProfileClient,
): TunnelProfiles {
  const oldProfiles = async () => {
    const all = await storage.profiles();
    return all
      .filter((p) => oldNumber(p, main) !== undefined)
      .sort((a, b) => (oldNumber(a, main) ?? 0) - (oldNumber(b, main) ?? 0));
  };
  return {
    main,
    oldProfiles,
    async retireMain() {
      const identity = await client.tunnel.get({ profile: main });
      if (!identity) return;
      const numbers = (await oldProfiles()).map((p) => oldNumber(p, main) ?? 0);
      await storage.save(`${main}-old-${Math.max(0, ...numbers) + 1}`, identity as never);
      await storage.remove(main);
    },
    async removeOld() {
      for (const profile of await oldProfiles()) {
        try {
          await client.tunnel.remove({ profile });
        } catch {
          // still waiting for the network: retried at the next start and when the tunnel connects
        }
      }
      return (await oldProfiles()).length;
    },
  };
}
