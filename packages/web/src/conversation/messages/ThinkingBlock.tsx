import { Brain, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "./Markdown";

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Collapsible className="group/thinking">
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md py-0.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform group-data-[state=open]/thinking:rotate-90"
        />
        <Brain aria-hidden className="size-3.5" />
        <span>{streaming ? "Thinking…" : "Thought"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Markdown className="mt-1 border-l-2 pl-3 text-sm text-muted-foreground">{text}</Markdown>
      </CollapsibleContent>
    </Collapsible>
  );
}
