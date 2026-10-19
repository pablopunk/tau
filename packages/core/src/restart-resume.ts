import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationStore } from "./harness/conversation-store";

type Interrupted = { readonly at: number; readonly ids: readonly string[] };

export interface RestartResumeDeps {
  readonly file: string;
  readonly conversations: Pick<ConversationStore, "busyIds" | "retry">;
  readonly now: () => number;
  readonly log?: (message: string, error?: unknown) => void;
}

export interface RestartResume {
  /** Called when the server begins to shut down: remembers which threads were mid-run, so no Stop is mistaken for a restart. */
  markRunning(): Promise<void>;
  /** Retries every thread that was mid-run at the last shutdown, once. Never throws. */
  resumeAtStartup(): Promise<void>;
}

function readInterrupted(file: string): Interrupted | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Interrupted>;
    if (typeof parsed.at !== "number" || !Array.isArray(parsed.ids)) return undefined;
    return { at: parsed.at, ids: parsed.ids.filter((id): id is string => typeof id === "string") };
  } catch {
    return undefined;
  }
}

function writeInterrupted(file: string, record: Interrupted): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export function createRestartResume(deps: RestartResumeDeps): RestartResume {
  const { file, conversations, now } = deps;
  const log = deps.log ?? ((message, error) => console.error(message, error));
  return {
    async markRunning() {
      const ids = await conversations.busyIds();
      if (ids.length > 0) writeInterrupted(file, { at: now(), ids });
    },
    async resumeAtStartup() {
      const interrupted = readInterrupted(file);
      rmSync(file, { force: true });
      if (!interrupted) return;
      for (const id of interrupted.ids) {
        try {
          await conversations.retry(id, { requestId: `restart-resume-${interrupted.at}-${id}` }, now());
        } catch (error) {
          log(`tau: could not resume thread ${id} after the restart`, error);
        }
      }
    },
  };
}
