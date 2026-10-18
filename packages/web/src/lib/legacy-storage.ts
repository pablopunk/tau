const legacyKeyOf = (key: string): string =>
  key.replace(/^tau:/, "pi-everywhere:").replace(/^tau-sidebar/, "pie-sidebar");

/** Reads a key, falling back to the value stored before the rename to tau. */
export function readWithLegacy(key: string): string | null {
  return window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKeyOf(key));
}
