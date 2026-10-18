export interface FakeToolUse {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
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
export type FakeScript = (turnIndex: number, firstUserText: string) => readonly FakeStep[];

export const scriptOf =
  (turns: readonly (readonly FakeStep[])[]): FakeScript =>
  (turnIndex) =>
    turns[Math.min(turnIndex, turns.length - 1)] ?? [{ kind: "text", text: "ok" }];

export const sayOk: FakeScript = () => [{ kind: "text", text: "ok" }];
