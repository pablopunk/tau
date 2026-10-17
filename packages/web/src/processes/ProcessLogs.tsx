import { useEffect, useRef } from "react";
import { useLiveProcessLogs } from "./use-live-process-logs";

export function ProcessLogs({ processId, live }: { processId: string; live: boolean }) {
  const logs = useLiveProcessLogs(processId, live);
  const box = useRef<HTMLPreElement>(null);
  const text = logs.data ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the text changes
  useEffect(() => {
    const element = box.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [text]);
  return (
    <figure aria-label="Process logs">
      <pre
        ref={box}
        className="max-h-64 overflow-auto rounded-md border bg-background px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words"
      >
        {text || "No output yet."}
      </pre>
    </figure>
  );
}
