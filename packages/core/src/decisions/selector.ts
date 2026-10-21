import type { Availability, DecideClient } from "./client";

export type { Availability, DecideClient };

/** Picks the first client matching `preference`; `auto` tries backends in order. */
export function pick(
  preference: "auto" | "typesafe" | "openai",
  clients: readonly DecideClient[],
): DecideClient | undefined {
  if (preference !== "auto") return clients.find((client) => client.id === preference);
  return clients[0];
}
