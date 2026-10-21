const MAX_TITLE_LENGTH = 80;
const IMAGE_ONLY_TITLE = "Image";
const MAX_FILE_TITLE_LENGTH = 60;
const LEADING_TITLE_LABEL = /^title\s*:\s*/i;
const SURROUNDING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

function capTitle(oneLine: string): string {
  return oneLine.length <= MAX_TITLE_LENGTH
    ? oneLine
    : `${oneLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

function safeFileName(name: string): string | undefined {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\0-\x1f\x7f]+/g, "").trim();
  if (cleaned === "") return undefined;
  const capped = cleaned.length <= MAX_FILE_TITLE_LENGTH ? cleaned : `${cleaned.slice(0, MAX_FILE_TITLE_LENGTH).trimEnd()}…`;
  return capTitle(capped);
}

export function titleFromFirstMessage(text: string, files: readonly { name: string }[] = []): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine !== "") return capTitle(oneLine);
  // A file-only start is titled by its file; images alone keep the image-only title.
  return files.map((file) => safeFileName(file.name)).find((name) => name !== undefined) ?? IMAGE_ONLY_TITLE;
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
