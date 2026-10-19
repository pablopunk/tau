import type { Relay, RelayDeps } from "./ports";

/** TODO(F): see `RelayDeps`. A placeholder: nothing is flooded, nothing is relayed. */
export function createRelay(_deps: RelayDeps): Relay {
  return {
    start: () => () => undefined,
    floodExpel: async () => undefined,
  };
}
