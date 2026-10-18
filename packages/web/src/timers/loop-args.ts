import type { LoopInput } from "@tau/protocol";

export type LoopCommand = { action: "stop" } | { action: "start"; input: LoopInput } | { action: "usage" };

export const LOOP_USAGE = "Usage: /loop [5m] <prompt>, or /loop stop. Intervals: 5m, 2h, 1d (at least 1m).";

const INTERVAL = /^\d+[mhd]$/;

/** `/loop 5m check the build`, `/loop check the build` (the agent paces itself), `/loop stop`. */
export function parseLoopArgs(args: string): LoopCommand {
  const text = args.trim();
  if (text === "") return { action: "usage" };
  if (text.toLowerCase() === "stop") return { action: "stop" };
  const [first = "", ...rest] = text.split(/\s+/);
  if (!INTERVAL.test(first)) return { action: "start", input: { prompt: text } };
  const prompt = rest.join(" ").trim();
  return prompt === "" ? { action: "usage" } : { action: "start", input: { every: first, prompt } };
}
