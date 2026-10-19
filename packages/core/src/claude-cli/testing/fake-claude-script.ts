import type { FakeConnectorRun } from "./fake-claude-connectors";

export interface FakeToolUse {
  /** A `tau` tool name, or with `connector` the tool name inside that server (`list_teams`). */
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
  /** Set: the fake CLI runs this call itself (a connector). The next steps follow with no input, as the real CLI does. */
  readonly connector?: FakeConnectorRun;
  /** Set with `connector`: a CLI built-in such as `ToolSearch`, named as is and always active. */
  readonly builtin?: boolean;
}

export interface FakeRateLimit {
  readonly status: "allowed" | "allowed_warning" | "rejected";
  readonly fiveHour: number;
  readonly resetsAt?: number;
}

/** One model API message, or a side effect between two of them. */
export type FakeStep =
  | { readonly kind: "text"; readonly text: string; readonly thinking?: string }
  | { readonly kind: "tools"; readonly calls: readonly FakeToolUse[]; readonly text?: string }
  | { readonly kind: "error"; readonly code: string; readonly text?: string }
  | { readonly kind: "rateLimit"; readonly limit: FakeRateLimit };

/** Steps for one turn: the model keeps going through the list until a `text` or `error` step ends it. */
/** `hasTools` is false for one-shot calls (titles, compaction, the goal judge). */
export type FakeScript = (turnIndex: number, firstUserText: string, hasTools: boolean) => readonly FakeStep[];

export const scriptOf =
  (turns: readonly (readonly FakeStep[])[]): FakeScript =>
  (turnIndex) =>
    turns[Math.min(turnIndex, turns.length - 1)] ?? [{ kind: "text", text: "ok" }];

export const sayOk: FakeScript = () => [{ kind: "text", text: "ok" }];
