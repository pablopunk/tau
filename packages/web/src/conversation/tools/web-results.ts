export interface WebResult {
  readonly title: string;
  readonly url: string;
}

const SOURCE_LINE = /^\s*\d+\.\s+(.+)\n\s+(https?:\/\/\S+)/gm;

export function parseWebResults(text: string): WebResult[] {
  return [...text.matchAll(SOURCE_LINE)].map((match) => ({ title: match[1] ?? "", url: match[2] ?? "" }));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function sizeLabel(characters: number): string {
  if (characters < 1000) return `${characters} chars`;
  return `${(characters / 1000).toFixed(characters < 10_000 ? 1 : 0)}k chars`;
}

export function queriesOf(args: Record<string, unknown> | undefined): string {
  const list = args?.queries;
  if (Array.isArray(list)) return list.filter((item) => typeof item === "string").join(", ");
  return typeof args?.query === "string" ? args.query : "";
}

export function urlsOf(args: Record<string, unknown> | undefined): string {
  const list = args?.urls;
  if (Array.isArray(list)) return list.filter((item) => typeof item === "string").join(", ");
  return typeof args?.url === "string" ? args.url : "";
}

const SOURCES_DIVIDER = /\n*---\n+\*\*Sources:\*\*[\s\S]*$/;
const TRAILING_NOTES = /\n---\n[\s\S]*$/;

export function answerOf(text: string): string {
  return text.replace(SOURCES_DIVIDER, "").replace(TRAILING_NOTES, "").trim();
}
