import { AppError, type ModelRef } from "@pi-everywhere/protocol";

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

const MAX_LISTED_OPTIONS = 10;

const refId = (ref: ModelRef) => `${ref.provider}/${ref.modelId}`;

function naturalCompare(a: string, b: string): number {
  const left = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const right = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const [x, y] = [left[i] as string, right[i] as string];
    const bothNumbers = /^\d/.test(x) && /^\d/.test(y);
    const order = bothNumbers ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

const containsText = (ref: ModelRef, needle: string) => refId(ref).toLowerCase().includes(needle);

const rankByParentThenVersion = (parent: ModelRef) => (a: ModelRef, b: ModelRef) => {
  const providerOrder = Number(b.provider === parent.provider) - Number(a.provider === parent.provider);
  if (providerOrder !== 0) return providerOrder;
  return naturalCompare(b.modelId, a.modelId) || refId(a).localeCompare(refId(b));
};

function noMatchError(requested: string, connected: readonly ModelRef[]) {
  const options = connected.slice(0, MAX_LISTED_OPTIONS).map(refId).join(", ");
  return new AppError(
    "invalid_request",
    `No connected model matches "${requested}". Options: ${options || "none"}.`,
  );
}

export const resolveModelAlias: ResolveModelAlias = (requested, { parent, fast, connected }) => {
  const input = (requested ?? "").trim();
  const lower = input.toLowerCase();
  if (lower === "" || lower === "inherit") return parent;
  if (lower === "fast") return fast ?? parent;
  const exact = connected.find((ref) => refId(ref).toLowerCase() === lower);
  if (exact) return exact;
  const [best] = connected.filter((ref) => containsText(ref, lower)).sort(rankByParentThenVersion(parent));
  if (!best) throw noMatchError(input, connected);
  return best;
};
