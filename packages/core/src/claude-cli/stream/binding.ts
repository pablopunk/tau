import type { Tool } from "@earendil-works/pi-ai";
import type { ClaudeInput } from "../claude-input";
import type { ClaudeQuery, ClaudeReasoning, ClaudeSdkMessage } from "../sdk-types";
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
  reasoning: ClaudeReasoning | undefined;
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
  /** Ids of connector calls the CLI runs itself; never in `expected`, never delivered. */
  readonly connectorIds: Set<string>;
  /** Connector calls whose result has not arrived yet. */
  readonly openConnectorIds: Set<string>;
  /** Messages that arrived with no active listener: the next turn drains one API message. */
  inbox: ClaudeSdkMessage[];
  /** A `result` arrived with no active listener and no owed result to consume it. */
  resultSeen: boolean;
  /** The SDK session's last message is a connector `tool_result`. */
  connectorTail: boolean;
  /** An API message of the current attempt reached the turn: a tool may have run, so a retry is unsafe. */
  apiPartSeen: boolean;
  /** The CLI has a turn open: input was pushed and no `result` came yet. */
  cliBusy: boolean;
  pendingApprovals: number;
  /** The connector choice the live query was started with. */
  optionsKey: string;
  interrupting: Promise<void> | null;
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
    reasoning: undefined,
    tools: [],
    listener: null,
    owedResults: 0,
    owedWaiters: [],
    settling: Promise.resolve(),
    idleCancel: null,
    latestResetsAt: null,
    onFirstMessage: null,
    connectorIds: new Set(),
    openConnectorIds: new Set(),
    inbox: [],
    resultSeen: false,
    connectorTail: false,
    apiPartSeen: false,
    cliBusy: false,
    pendingApprovals: 0,
    optionsKey: "",
    interrupting: null,
  };
}
