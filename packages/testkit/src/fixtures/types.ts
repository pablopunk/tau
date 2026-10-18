import type { Op } from "@tau/protocol";

export interface FixtureFrame {
  /** Milliseconds since the recording started; the first frame is `[["r", view]]` at 0. */
  readonly at: number;
  readonly ops: readonly Op[];
}

export type FixtureStep = { readonly at: number } & (
  | { readonly kind: "send"; readonly text: string; readonly images?: number }
  | { readonly kind: "abort" }
  | { readonly kind: "retry" }
);

export interface Fixture {
  readonly name: string;
  readonly description: string;
  readonly conversationId: string;
  /** Hand-derived from a recorded fixture because the real Harness cannot produce it on demand. */
  readonly synthetic?: boolean;
  readonly steps: readonly FixtureStep[];
  readonly frames: readonly FixtureFrame[];
}
