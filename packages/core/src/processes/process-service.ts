import type { ConversationSummary, ProcessInfo } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";

export interface StartProcessRequest {
  readonly conversationId: string;
  readonly cwd: string;
  readonly command: string;
  readonly name?: string;
}

export interface ProcessService {
  /** Spawns in its own process group; a pid file `<home>/processes/<id>.json`. */
  start(request: StartProcessRequest): Promise<ProcessInfo>;
  list(conversationId: string): Promise<ProcessInfo[]>;
  logs(id: string, tail: number): Promise<string>;
  /** SIGTERM, SIGKILL after 5 s. */
  stop(id: string): Promise<void>;
  /** Hub start: kills groups left by an earlier run and marks them `killed`. */
  reapStaleAtStartup(): Promise<void>;
  /** Hub shutdown. */
  stopAll(): Promise<void>;
  /** Thread archive and delete; delete also removes the log files. */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
}

export interface ProcessDeps {
  readonly home: string;
  readonly emitChange: (conversationId: string) => void;
}

const reject = (what: string) => async (): Promise<never> => {
  throw notImplemented(what);
};

export function createProcessService(_deps: ProcessDeps): ProcessService {
  return {
    start: reject("processes.start"),
    list: async () => [],
    logs: reject("processes.logs"),
    stop: reject("processes.stop"),
    reapStaleAtStartup: async () => undefined,
    stopAll: async () => undefined,
    onConversationRemoved: async () => undefined,
  };
}
