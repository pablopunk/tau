import type { HarnessSettings } from "@earendil-works/pi-durable";
import type { ImageInput } from "@pi-everywhere/protocol";

export type ScenarioStep = { readonly at: number } & (
  | { readonly kind: "send"; readonly text: string; readonly images?: readonly ImageInput[] }
  | { readonly kind: "abort" }
  | { readonly kind: "retry" }
);

export const TINY_PNG: ImageInput = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly steps: readonly ScenarioStep[];
  readonly settings?: HarnessSettings;
  /** Blocks the watch listener once, so the Harness replaces the pending frames with one full view. */
  readonly consumerStall?: { readonly afterFrames: number; readonly ms: number };
  readonly expectsMidStreamReset?: boolean;
}

const send = (text: string, at = 0): ScenarioStep => ({ at, kind: "send", text });

const sendImage = (text: string, images: readonly ImageInput[], at = 0): ScenarioStep => ({
  at,
  kind: "send",
  text,
  images,
});

const FAST_PROGRESS = { partialIntervalMs: 1, outputIntervalMs: 1 };
const QUICK_RETRY = { enabled: true, maxRetries: 2, baseDelayMs: 800 };

export const SCENARIOS: readonly Scenario[] = [
  { name: "text", description: "A plain streamed text answer.", steps: [send("What is a monad?")] },
  { name: "thinking", description: "A thinking block, then the answer.", steps: [send("think")] },
  { name: "read", description: "The read tool.", steps: [send("read notes.txt")] },
  {
    name: "write",
    description: "The write tool.",
    steps: [send("write hello.txt Hello from the faux agent")],
  },
  {
    name: "edit",
    description: "The edit tool, with a diff.",
    steps: [send("edit notes.txt hello => goodbye")],
  },
  { name: "bash", description: "The bash tool, exit code 0.", steps: [send("bash echo hi && ls")] },
  {
    name: "bash-fail",
    description: "The bash tool, exit code 3.",
    steps: [send("bash echo oops >&2; exit 3")],
  },
  {
    name: "error",
    description: "A final model error with no retry.",
    steps: [send("fail")],
  },
  {
    name: "image",
    description: "A message with one image; the faux reply counts the images.",
    steps: [sendImage("image", [TINY_PNG])],
  },
  {
    name: "fail-retry",
    description: "A final model error, then a retry that is answered.",
    steps: [send("fail"), { at: 1500, kind: "retry" }],
  },
  {
    name: "retry-exhausted",
    description: "A retryable model error that keeps failing until the retries run out.",
    steps: [send("overloaded")],
    settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 500 } },
  },
  {
    name: "retry",
    description: "A model error, a visible retry, then success.",
    steps: [send("flaky")],
    settings: { retry: QUICK_RETRY },
  },
  {
    name: "steer",
    description: "A message sent while busy waits in the inbox, then steers the run.",
    steps: [send("bash sleep 1 && echo first"), send("write steered.txt steered", 400)],
  },
  {
    name: "abort",
    description: "A long tool call stopped by abort.",
    steps: [send("bash sleep 10"), { at: 600, kind: "abort" }],
  },
  {
    name: "overflow",
    description:
      "A long tool output read by a slow watcher: the buffer overflows and a full view arrives mid-stream.",
    steps: [send("bash for i in $(seq 1 600); do echo line $i; sleep 0.002; done")],
    settings: { progress: FAST_PROGRESS },
    consumerStall: { afterFrames: 20, ms: 3000 },
    expectsMidStreamReset: true,
  },
];
