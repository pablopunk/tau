import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PREVIEW_LINES = 40;

export interface OutputBlockProps {
  readonly text: string;
  readonly label: string;
  /** Which end of long output is kept in the preview: command output ends with the interesting part. */
  readonly keep?: "start" | "end";
  readonly className?: string;
}

function previewOf(lines: readonly string[], keep: "start" | "end"): string[] {
  return keep === "end" ? lines.slice(-PREVIEW_LINES) : lines.slice(0, PREVIEW_LINES);
}

export function OutputBlock({ text, label, keep = "start", className }: OutputBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.replace(/\n$/, "").split("\n");
  const hidden = lines.length - PREVIEW_LINES;
  const shown = expanded || hidden <= 0 ? lines : previewOf(lines, keep);
  return (
    <figure aria-label={label} className="space-y-1.5">
      <pre
        className={cn(
          "max-h-96 overflow-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words",
          className,
        )}
      >
        {shown.join("\n")}
      </pre>
      {hidden > 0 ? (
        <Button variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </Button>
      ) : null}
    </figure>
  );
}
