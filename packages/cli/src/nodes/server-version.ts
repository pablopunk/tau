const partsOf = (version: string): number[] =>
  (version.split("-")[0] ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);

/** `a < b` on `major.minor.patch`; a pre-release tag is ignored. */
export function isOlderVersion(a: string, b: string): boolean {
  const [left, right] = [partsOf(a), partsOf(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

export const UPDATE_COMMAND = "tau update";

/** An older running server cannot read what a newer `tau connect` writes: refuse before anything changes. */
export function olderServerRefusal(running: string | undefined, cli: string): string | undefined {
  if (running === undefined || !isOlderVersion(running, cli)) return undefined;
  return [
    `The tau running here is ${running} and this command is ${cli}. Nothing was linked.`,
    "Update the running tau, then run this command again:",
    `  ${UPDATE_COMMAND}`,
  ].join("\n");
}
