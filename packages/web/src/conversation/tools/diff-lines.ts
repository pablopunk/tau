export type DiffLineKind = "add" | "remove" | "hunk" | "context";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

const FILE_HEADER = /^(---|\+\+\+) /;

function kindOf(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

/** Works for a unified patch and for the tool's numbered diff (`-1 old`, `+1 new`). */
export function parseDiff(text: string): DiffLine[] {
  return text
    .split("\n")
    .filter((line, index, lines) => !FILE_HEADER.test(line) && !(index === lines.length - 1 && line === ""))
    .map((line) => ({ kind: kindOf(line), text: line }));
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "remove").length,
  };
}
