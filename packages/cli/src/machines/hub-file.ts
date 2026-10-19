import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writePrivateFile } from "../private-files";

/** `<home>/hub.json`: where this tau dials. The one module that owns the file (owner I): `serve.ts` and `tau connect` only call it. */
export interface HubFile {
  readonly hubUrl: string;
  readonly machineSecret: string;
  /** The hub's name (from the link), shown as "Linked to <name>". */
  readonly name: string;
  /** This machine's own name for the hub (`--name`); the hostname when absent. */
  readonly machineName?: string;
}

export interface HubFileStore {
  /** `undefined` when absent or unreadable. */
  read(): Promise<HubFile | undefined>;
  /** Mode 0600, atomic. */
  write(file: HubFile): Promise<void>;
  /** Idempotent. */
  delete(): Promise<void>;
}

export const hubFilePath = (home: string): string => join(home, "hub.json");

function isHubFile(value: unknown): value is HubFile {
  const file = value as Partial<HubFile> | null;
  return (
    typeof file?.hubUrl === "string" &&
    typeof file.machineSecret === "string" &&
    typeof file.name === "string"
  );
}

export function createHubFileStore(home: string): HubFileStore {
  const path = hubFilePath(home);
  return {
    async read() {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        return isHubFile(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    write: (file) => writePrivateFile(path, `${JSON.stringify(file)}\n`),
    delete: () => rm(path, { force: true }),
  };
}
