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
  return (
    <SidebarSection sectionId="context" title="Context">
      <div className="flex items-center gap-2">
        <ContextMeter used={usage.used} total={usage.total} label={usage.label} />
        <p className="text-xs text-muted-foreground">{usage.label}</p>
      </div>
    </SidebarSection>
  );
}
