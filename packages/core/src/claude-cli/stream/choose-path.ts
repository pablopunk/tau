import type { ClaudeEffort } from "../sdk-types";
import type { Binding, Checkpoint } from "./binding";
import type { Entry } from "./normalize";

export type Plan =
  | { readonly kind: "oneShot" }
  | { readonly kind: "rebind" }
  | { readonly kind: "continue"; readonly suffix: readonly Entry[] }
  | { readonly kind: "resume"; readonly suffix: readonly Entry[] }
  | { readonly kind: "resumeAt"; readonly checkpoint: Checkpoint; readonly suffix: readonly Entry[] };

export interface PathInput {
  readonly hasTools: boolean;
  readonly binding: Binding | undefined;
  readonly entries: readonly Entry[];
  readonly hashes: readonly string[];
  readonly effort: ClaudeEffort | undefined;
}

interface Anchor {
  readonly length: number;
  readonly hash: string;
}

const fits = (hashes: readonly string[], anchor: Anchor, count: number) =>
  anchor.length <= count && hashes[anchor.length] === anchor.hash;

const longest = <T extends Anchor>(anchors: readonly T[]): T | undefined =>
  anchors.reduce<T | undefined>(
    (best, next) => (best && best.length >= next.length ? best : next),
    undefined,
  );

const hasForeignEntry = (suffix: readonly Entry[]) =>
  suffix.some(({ message }) => message.role === "system" || message.role === "assistant");

function resumeAtPlan(checkpoint: Checkpoint, entries: readonly Entry[]): Plan {
  const suffix = entries.slice(checkpoint.length);
  return hasForeignEntry(suffix) ? { kind: "rebind" } : { kind: "resumeAt", checkpoint, suffix };
}

function atHeadPlan(input: PathInput, suffix: readonly Entry[]): Plan {
  if (hasForeignEntry(suffix)) return { kind: "rebind" };
  const live = input.binding?.query != null;
  const sameEffort = input.binding?.effort === input.effort;
  return live && sameEffort ? { kind: "continue", suffix } : { kind: "resume", suffix };
}

/** Picks one of the five paths for one Pi request. */
export function choosePath(input: PathInput): Plan {
  const { binding, entries, hashes } = input;
  if (!input.hasTools) return { kind: "oneShot" };
  if (!binding?.sdkSessionId) return { kind: "rebind" };
  const fitting = binding.checkpoints.filter((c) => c.sdkUuid !== null && fits(hashes, c, entries.length));
  const best = longest(fitting);
  const head = binding.head && fits(hashes, binding.head, entries.length) ? binding.head : null;
  if (head && (!best || head.length >= best.length)) {
    const suffix = entries.slice(head.length);
    if (suffix.length > 0) return atHeadPlan(input, suffix);
    const earlier = longest(fitting.filter((c) => c.length < head.length));
    return earlier ? resumeAtPlan(earlier, entries) : { kind: "rebind" };
  }
  return best ? resumeAtPlan(best, entries) : { kind: "rebind" };
}
