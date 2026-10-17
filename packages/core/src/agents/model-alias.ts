import type { ModelRef } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";

export interface ModelAliasContext {
  readonly parent: ModelRef;
  readonly fast: ModelRef | undefined;
  readonly connected: readonly ModelRef[];
}

/**
 * `inherit` or empty: the parent's model. `fast`: the settings fast model. `provider/modelId`: that model when
 * connected. Anything else is an alias (`sonnet`, `opus`, any substring): prefer the parent's provider, then the
 * highest version by natural sort. Throws a tool error that lists the options when nothing matches.
 */
export type ResolveModelAlias = (requested: string | undefined, context: ModelAliasContext) => ModelRef;

export const resolveModelAlias: ResolveModelAlias = () => {
  throw notImplemented("model alias resolver");
};
