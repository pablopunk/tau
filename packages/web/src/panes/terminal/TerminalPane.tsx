import { Alert, AlertDescription } from "@/components/ui/alert";
import { TerminalView } from "@/components/ui/terminal-view";
import { useTerminalStream } from "./use-terminal-stream";

export const ENDED_TEXT = "This terminal ended";

function EndedNotice({ exitCode }: { exitCode: number | null }) {
  return (
    <Alert role="status" className="rounded-none border-x-0 border-t-0">
      <AlertDescription>
        {ENDED_TEXT}
        {exitCode === null ? "." : ` (exit code ${exitCode}).`}
      </AlertDescription>
    </Alert>
  );
}

/** One attached terminal: the stream, the screen, and the ended state. Remount per terminal id. */
export function TerminalPane({ terminalId, onLeave }: { terminalId: string; onLeave: () => void }) {
  const stream = useTerminalStream(terminalId);
  const ended =
    (stream.state.status === "exited" || stream.state.status === "closed") && stream.state.exitCode !== 0;
  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      {ended ? <EndedNotice exitCode={stream.state.exitCode} /> : null}
      <div className="min-h-0 flex-1">
        <TerminalView
          autoFocus
          onHandle={stream.bind}
          onInput={stream.sendInput}
          onResize={stream.sendResize}
          onLeave={onLeave}
        />
      </div>
    </div>
  );
}
