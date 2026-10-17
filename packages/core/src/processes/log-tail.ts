export const TAIL_LIMIT_BYTES = 1024 * 1024;

export interface LogTail {
  append(chunk: string): void;
  text(): string;
}

export function createLogTail(limit = TAIL_LIMIT_BYTES): LogTail {
  let content = "";
  return {
    append(chunk) {
      content += chunk;
      if (content.length > limit) content = content.slice(content.length - limit);
    },
    text: () => content,
  };
}

export const lastLines = (text: string, count: number): string => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-Math.max(1, count)).join("\n");
};
