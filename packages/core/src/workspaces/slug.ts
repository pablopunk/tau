const MAX_SLUG_LENGTH = 40;

const trimDashes = (text: string) => text.replace(/^-+|-+$/g, "");

export function slugFrom(message: string): string {
  const words = trimDashes(
    trimDashes(message.toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, MAX_SLUG_LENGTH),
  );
  return words === "" ? "thread" : words;
}

const withSuffix = (slug: string, number: number) => {
  const suffix = `-${number}`;
  return `${trimDashes(slug.slice(0, MAX_SLUG_LENGTH - suffix.length))}${suffix}`;
};

export async function firstFreeSlug(
  slug: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(slug))) return slug;
  for (let number = 2; ; number += 1) {
    const candidate = withSuffix(slug, number);
    if (!(await isTaken(candidate))) return candidate;
  }
}
