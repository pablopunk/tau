import type { ConversationView } from "@tau/protocol";
import { ContextMeter } from "@/components/ui/context-meter";
import { useModels } from "@/lib/queries";
import { contextUsage } from "../composer/context-usage";
import { findModel, readAgent } from "../model/agent";
import { SidebarSection } from "./SidebarSection";

export function ContextSection({ view }: { view: ConversationView }) {
  const models = useModels().data;
  if (!models) return null;
  const current = findModel(readAgent(view), models);
  const usage = current ? contextUsage(view.entries, current.contextWindow) : null;
  if (!usage) return null;
  const percent = Math.round((usage.used / usage.total) * 100);
  return (
    <SidebarSection title="Context">
      <div className="flex items-center gap-2">
        <ContextMeter used={usage.used} total={usage.total} label={usage.label} />
        <p className="text-xs text-muted-foreground">{usage.label}</p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Context used"
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </SidebarSection>
  );
}
