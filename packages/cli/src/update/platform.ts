/** The `<os>-<arch>` of a release archive, or undefined where tau ships no binary (Windows, other CPUs). */
export function releasePlatformOf(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  const os = platform === "darwin" || platform === "linux" ? platform : undefined;
  const cpu = arch === "arm64" || arch === "x64" ? arch : undefined;
  return os && cpu ? `${os}-${cpu}` : undefined;
}

export const archiveNameOf = (version: string, platformKey: string): string =>
  `tau-${version}-${platformKey}.tar.gz`;

export const SUMS_NAME = "SHA256SUMS";
