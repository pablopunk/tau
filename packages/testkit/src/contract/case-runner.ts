import { it } from "vitest";

export type CaseRunner = (name: string, body: () => Promise<void>) => void;

export interface ContractOptions {
  /** Cases whose name contains one of these tags are registered as `todo`: the target does not implement them yet. */
  readonly pending?: readonly string[];
}

export function caseRunner(pending: readonly string[] = []): CaseRunner {
  return (name, body) => (pending.some((tag) => name.includes(tag)) ? it.todo(name) : it(name, body));
}
