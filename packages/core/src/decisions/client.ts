/** Availability of a fast-compaction decision backend. */
export type Availability = "ready" | "unavailable" | "unknown";

/** A calibrated yes/no decision backend for fast compaction. */
export interface DecideClient {
  readonly id: "typesafe" | "openai";
  /** Cheap capability probe. Never rejects. */
  check(): Promise<Availability>;
  /** One predicate question over shared input → calibrated 0..1. */
  predicate(input: string, instructions: string): Promise<number>;
}
