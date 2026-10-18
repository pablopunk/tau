import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessInfo } from "@tau/protocol";
import { readFileIfPresent, writeFileAtomic } from "../home/atomic-write";

export interface ProcessRecord {
  readonly info: ProcessInfo;
  readonly pid: number;
}

export interface ProcessFiles {
  pidFile(id: string): string;
  logFile(id: string): string;
  save(record: ProcessRecord): Promise<void>;
  loadAll(): Promise<ProcessRecord[]>;
  readLog(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}

export function createProcessFiles(home: string): ProcessFiles {
  const directory = join(home, "processes");
  const pidFile = (id: string) => join(directory, `${id}.json`);
  const logFile = (id: string) => join(directory, `${id}.log`);
  return {
    pidFile,
    logFile,
    async save(record) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFileAtomic(pidFile(record.info.id), JSON.stringify(record));
    },
    async loadAll() {
      const names = await readdir(directory).catch(() => [] as string[]);
      const records = await Promise.all(
        names.filter((name) => name.endsWith(".json")).map((name) => readRecord(join(directory, name))),
      );
      return records.filter((record): record is ProcessRecord => record !== undefined);
    },
    async readLog(id) {
      return (await readFileIfPresent(logFile(id))) ?? "";
    },
    async remove(id) {
      await Promise.all([rm(pidFile(id), { force: true }), rm(logFile(id), { force: true })]);
    },
  };
}

async function readRecord(path: string): Promise<ProcessRecord | undefined> {
  try {
    const record = JSON.parse((await readFileIfPresent(path)) ?? "") as ProcessRecord;
    return { ...record, info: { ...record.info, kind: record.info.kind ?? "process" } };
  } catch {
    return undefined;
  }
}
