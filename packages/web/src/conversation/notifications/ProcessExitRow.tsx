import type { ProcessExitData } from "@tau/protocol";
import { LogLines } from "./LogLines";

const codeLabel = (code: ProcessExitData["exitCode"]) => (code === null ? "no exit code" : `exit ${code}`);

export function ProcessExitRow({ data }: { data: ProcessExitData }) {
  const summary = (
    <span className="min-w-0 truncate">
      Process <span className="font-medium">{data.name}</span> exited ({codeLabel(data.exitCode)})
    </span>
  );
  const lines = data.logTail === "" ? [] : data.logTail.split("\n");
  return (
    <div data-testid="process-exit" className="rounded-lg border bg-card text-sm">
      <LogLines lines={lines} summary={summary} />
    </div>
  );
}
