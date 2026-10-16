import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";
import { createSerialQueue } from "../home/serial-queue";

type CredentialFile = Record<string, Credential>;

function parseCredentialFile(text: string | undefined): CredentialFile {
  if (text === undefined || text.trim() === "") return {};
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("credentials.json must hold a JSON object");
  }
  return value as CredentialFile;
}

/**
 * Provider credentials in one 0600 JSON file. Every write goes through one queue (the file holds all providers, so a
 * per-provider queue would lose updates) and replaces the file atomically.
 */
export class FileCredentialStore implements CredentialStore {
  readonly #path: string;
  readonly #enqueue = createSerialQueue();

  constructor(path: string) {
    this.#path = path;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.#load())[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const file = await this.#load();
    return Object.entries(file).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.#enqueue(async () => {
      const file = await this.#load();
      const next = await fn(file[providerId]);
      if (next === undefined) return file[providerId];
      await this.#save({ ...file, [providerId]: next });
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.#enqueue(async () => {
      const { [providerId]: _removed, ...rest } = await this.#load();
      await this.#save(rest);
    });
  }

  async #load(): Promise<CredentialFile> {
    return parseCredentialFile(await readFileIfPresent(this.#path));
  }

  #save(file: CredentialFile): Promise<void> {
    return writeFileAtomic(this.#path, `${JSON.stringify(file, null, 2)}\n`);
  }
}
