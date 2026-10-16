import { cn } from "@/lib/utils";

export function UserMessage({ text, pending = false }: { text: string; pending?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-secondary-foreground",
          pending && "border border-dashed bg-transparent text-muted-foreground",
        )}
      >
        {text}
      </div>
    </div>
  );
}
