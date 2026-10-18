import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const miseShimsOf = (osHome: string) => join(osHome, ".local", "share", "mise", "shims");

/** The user's PATH with the mise shims folder first, so a removed tool version does not break agents. */
export function captureServicePath(
  pathValue: string,
  osHome: string,
  exists: (path: string) => boolean = existsSync,
  separator: string = delimiter,
): string {
  const shims = miseShimsOf(osHome);
  const entries = pathValue.split(separator).filter((entry) => entry !== "" && entry !== shims);
  return (exists(shims) ? [shims, ...entries] : entries).join(separator);
}
