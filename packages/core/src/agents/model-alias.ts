import { AppError, type ModelRef } from "@tau/protocol";

export interface ModelAliasContext {
  readonly parent: ModelRef;
  readonly fast: ModelRef | undefined;
  readonly connected: readonly ModelRef[];
}

/**
 * Subagents stay on the parent's provider. `inherit` or empty: the parent's model. `fast`: the settings fast model
 * when it is on the parent's provider, else the parent's model. `provider/modelId` of another provider and aliases
 * with no match throw a tool error that lists the parent provider's models.
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

const byVersionDescending = (a: ModelRef, b: ModelRef) =>
  naturalCompare(b.modelId, a.modelId) || refId(a).localeCompare(refId(b));

const listOptions = (models: readonly ModelRef[]) =>
  models.slice(0, MAX_LISTED_OPTIONS).map(refId).join(", ") || "none";

const noMatchError = (requested: string, models: readonly ModelRef[]) =>
  new AppError(
    "invalid_request",
    `No connected model matches "${requested}". Options: ${listOptions(models)}.`,
  );

const otherProviderError = (provider: string, models: readonly ModelRef[]) =>
  new AppError(
    "invalid_request",
    `Subagents use the parent's provider (${provider}). Options: ${listOptions(models)}.`,
  );

const startsWithOtherProvider = (lower: string, provider: string) =>
  lower.includes("/") && !lower.startsWith(`${provider.toLowerCase()}/`);

export const resolveModelAlias: ResolveModelAlias = (requested, { parent, fast, connected }) => {
  const input = (requested ?? "").trim();
  const lower = input.toLowerCase();
  if (lower === "" || lower === "inherit") return parent;
  if (lower === "fast") return fast?.provider === parent.provider ? fast : parent;
  const own = connected.filter((ref) => ref.provider === parent.provider);
  const exact = connected.find((ref) => refId(ref).toLowerCase() === lower);
  if (exact && exact.provider !== parent.provider) throw otherProviderError(parent.provider, own);
  if (exact) return exact;
  const [best] = own.filter((ref) => containsText(ref, lower)).sort(byVersionDescending);
  if (best) return best;
  if (startsWithOtherProvider(lower, parent.provider)) throw otherProviderError(parent.provider, own);
  throw noMatchError(input, own);
};
