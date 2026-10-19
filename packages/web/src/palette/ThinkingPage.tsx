import { CommandGroup, CommandItem } from "@/components/ui/command";
import { useApi } from "@/nodes/node-context";
import { attempt } from "./attempt";
import { useThreadAgent } from "./use-thread-agent";

/** The palette's thinking level page for the open thread. Must render under that thread's node provider. */
export function ThinkingPage({
  conversationId,
  run,
}: {
  conversationId: string;
  run: (action: () => void) => () => void;
}) {
  const api = useApi();
  const { model, level } = useThreadAgent(conversationId);
  return (
    <CommandGroup heading="Thinking level">
      {(model?.thinkingLevels ?? []).map((candidate) => (
        <CommandItem
          key={candidate}
          value={`thinking ${candidate}`}
          data-checked={candidate === level}
          onSelect={run(
            attempt(() => api.conversations.configure(conversationId, { thinkingLevel: candidate })),
          )}
        >
          {candidate}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
