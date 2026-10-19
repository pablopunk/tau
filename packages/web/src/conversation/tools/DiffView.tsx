import { cn } from "@/lib/utils";
import { type DiffLine, type DiffLineKind, parseDiff } from "./diff-lines";

const LINE_STYLES: Record<DiffLineKind, string> = {
  add: "bg-success/15 text-foreground",
  remove: "bg-destructive/15 text-foreground",
  hunk: "text-muted-foreground",
  context: "text-muted-foreground",
};

const LINE_MARKERS: Record<DiffLineKind, string> = {
  add: "Added",
  remove: "Removed",
  hunk: "Section",
  context: "",
};

function Line({ line }: { line: DiffLine }) {
  return (
    <div className={cn("whitespace-pre px-3", LINE_STYLES[line.kind])}>
      <span className="sr-only">{LINE_MARKERS[line.kind]} </span>
      {line.text || " "}
    </div>
  );
}

/** `contained` caps the height and scrolls inside the box; otherwise the diff flows with the page and only scrolls sideways. */
export function DiffView({ diff, contained = true }: { diff: string; contained?: boolean }) {
  const lines = parseDiff(diff);
  return (
    <figure
      aria-label="Diff"
      className={cn(
        "rounded-md border bg-background py-1 font-mono text-xs leading-5",
        contained ? "max-h-96 overflow-auto" : "overflow-x-auto overflow-y-hidden",
      )}
    >
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the diff is static text and lines have no identity
        <Line key={index} line={line} />
      ))}
    </figure>
  );
}
