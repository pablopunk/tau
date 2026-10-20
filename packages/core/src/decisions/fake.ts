import type { Availability, DecideClient } from "./client";

/** Scripted probabilities for tests. No network. */
export function createFakeDecideClient(options: {
  id: DecideClient["id"];
  availability?: Availability;
  probabilities?: readonly number[];
}): DecideClient & { calls: { input: string; instructions: string }[] } {
  const calls: { input: string; instructions: string }[] = [];
  let index = 0;
  return {
    id: options.id,
    calls,
    check: async () => options.availability ?? "ready",
    predicate: async (input: string, instructions: string) => {
      calls.push({ input, instructions });
      const probabilities = options.probabilities ?? [1];
      const value = probabilities[Math.min(index, probabilities.length - 1)] ?? 1;
      index += 1;
      return value;
    },
  };
}
