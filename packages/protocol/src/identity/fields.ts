/** Free text (a name, a path) enters a signed payload percent-encoded, so it can never hold the `|` separator. */
export const encodeField = (value: string): string => encodeURIComponent(value);
export const decodeField = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

/** A non-negative safe integer from a decimal field, or `undefined`. */
export function parseCount(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,16}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
