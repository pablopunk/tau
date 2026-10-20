import type { AgentStatus } from "@tau/protocol";
import { ListChecks, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MorphText } from "@/components/ui/morph-text";
import { RelativeTime } from "@/components/ui/relative-time";
import { StatusChip } from "@/components/ui/status-chip";
import type { ToolStatus } from "@/conversation/model/tool-state";
import { ToolCard } from "@/conversation/tools/ToolCard";
import { AgentStatusBadge } from "@/sidebar/subagents/AgentStatusBadge";

const TICK_MS = 2000;
const TOOL: ToolStatus[] = ["pending", "running", "done", "error"];
const AGENT: AgentStatus[] = ["running", "done", "failed", "stopped"];
const CONNECTION = [
  { tone: "neutral", label: "Off" },
  { tone: "busy", label: "Connecting…" },
  { tone: "success", label: "Online" },
  { tone: "error", label: "Reconnecting" },
] as const;
const MINUTE = 60_000;
const AGES = [10_000, MINUTE, 5 * MINUTE, 59 * MINUTE, 3 * 60 * MINUTE, 26 * 60 * MINUTE];

function useStep() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((current) => current + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return step;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b py-3">
      <span className="w-40 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** `?fake=morph`: every MorphText spot changing value every two seconds. */
export function MorphDemo() {
  const step = useStep();
  const connection = CONNECTION[step % CONNECTION.length];
  const done = step % 6;
  const now = Date.now();
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-1 text-lg font-semibold">Torph in tau</h1>
      <p className="mb-4 text-sm text-muted-foreground">Everything below changes every {TICK_MS / 1000}s.</p>
      <Row label="Tool card status">
        <ToolCard
          icon={<Terminal />}
          title="Bash"
          subtitle="echo hi && ls"
          status={TOOL[step % TOOL.length] ?? "done"}
          openWhileActive={false}
        />
      </Row>
      <Row label="Agent status">
        <AgentStatusBadge status={AGENT[step % AGENT.length]} />
      </Row>
      <Row label="Process state">
        <Badge variant={step % 2 ? "secondary" : "default"}>
          <MorphText>{step % 2 ? "exited 0" : "running"}</MorphText>
        </Badge>
      </Row>
      <Row label="Connection chip">
        {connection ? (
          <StatusChip tone={connection.tone}>
            <MorphText>{connection.label}</MorphText>
          </StatusChip>
        ) : null}
      </Row>
      <Row label="Todo progress">
        <span className="inline-flex items-center gap-2 text-sm">
          <ListChecks className="size-4" />
          <MorphText>{`${done}/5`}</MorphText>
        </span>
      </Row>
      <Row label="Sidebar time">
        <RelativeTime at={now - (AGES[step % AGES.length] ?? 0)} now={now} animate className="text-xs" />
      </Row>
    </main>
  );
}
