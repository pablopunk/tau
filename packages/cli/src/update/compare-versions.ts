const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;
const WITH_PRE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const isPlainVersion = (text: string): boolean => PLAIN.test(text);

function parts(version: string): { core: number[]; prerelease: boolean } {
  const match = WITH_PRE.exec(version);
  if (!match) throw new Error(`Not a version: ${version}`);
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: version.includes("-") };
}

/** Negative when `a < b`, 0 when equal, positive when `a > b`. A prerelease is below its release. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index++) {
    const diff = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return Number(right.prerelease) - Number(left.prerelease);
}
