import type { Tool } from "@earendil-works/pi-ai";
import type { ClaudeInput } from "../claude-input";
import type { ClaudeEffort, ClaudeQuery } from "../sdk-types";
import { type CallMap, createCallMap } from "./deferred";
import type { Turn } from "./turn";

/** The normalized state after one finished Pi stream. */
export interface Checkpoint {
  readonly length: number;
  readonly hash: string;
  readonly sdkUuid: string | null;
}

/** What the SDK session has seen: the last checkpoint, or the delivered messages after an abort or error. */
export interface Head {
  readonly length: number;
  readonly hash: string;
}

/** In memory only: `piSessionId` to its SDK session. */
export interface Binding {
  readonly id: string;
  readonly calls: CallMap;
  /** Tool-use ids of the live query that Pi has not answered yet. */
  readonly expected: Set<string>;
  /** Sessions tau created: only these are ever deleted. */
  readonly created: Set<string>;
  sdkSessionId: string | null;
  query: ClaudeQuery | null;
  input: ClaudeInput | null;
  checkpoints: Checkpoint[];
  head: Head | null;
  model: string;
  effort: ClaudeEffort | undefined;
  tools: readonly Tool[];
  listener: Turn | null;
  /** `result` messages still to come for turns that already ended or were interrupted. */
  owedResults: number;
  owedWaiters: (() => void)[];
  /** Resolves when an interrupt has settled; the next call waits for it. */
  settling: Promise<void>;
  idleCancel: (() => void) | null;
  latestResetsAt: number | null;
  /** Runs on the first message of a fresh query: the session id is known then. */
  onFirstMessage: ((sessionId: string) => void) | null;
}

export function createBinding(id: string, model: string): Binding {
  return {
    id,
    calls: createCallMap(),
    expected: new Set(),
    created: new Set(),
    sdkSessionId: null,
    query: null,
    input: null,
    checkpoints: [],
    head: null,
    model,
    effort: undefined,
    tools: [],
    listener: null,
    owedResults: 0,
    owedWaiters: [],
    settling: Promise.resolve(),
    idleCancel: null,
    latestResetsAt: null,
    onFirstMessage: null,
  };
}
