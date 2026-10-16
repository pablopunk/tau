const MAX_TITLE_LENGTH = 80;

export function titleFromFirstMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_TITLE_LENGTH
    ? oneLine
    : `${oneLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}
