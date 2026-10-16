const MAX_TITLE_LENGTH = 80;
const IMAGE_ONLY_TITLE = "Image";
const LEADING_TITLE_LABEL = /^title\s*:\s*/i;
const SURROUNDING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

function capTitle(oneLine: string): string {
  return oneLine.length <= MAX_TITLE_LENGTH
    ? oneLine
    : `${oneLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function titleFromFirstMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return capTitle(oneLine) || IMAGE_ONLY_TITLE;
}

/** Returns undefined when the model produced nothing usable. */
export function titleFromModelAnswer(answer: string): string | undefined {
  const firstLine = answer.trim().split(/\r?\n/, 1)[0] ?? "";
  const cleaned = firstLine
    .trim()
    .replace(SURROUNDING_QUOTES, "")
    .replace(LEADING_TITLE_LABEL, "")
    .replace(SURROUNDING_QUOTES, "")
    .trim();
  return cleaned === "" ? undefined : capTitle(cleaned);
}
