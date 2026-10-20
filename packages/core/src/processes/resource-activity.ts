import type { ResourceActivity, ResourceCommand } from "@tau/protocol";
import type { ProcessService, SlotInfo } from "./process-service";

interface TitleLookup {
  find(id: string): Promise<{ title: string } | undefined>;
}

/** The processes' heavy-command list with each thread's title, for the Resources panel. */
export async function resourceActivityOf(
  processes: Pick<ProcessService, "resourceActivity">,
  conversations: TitleLookup,
): Promise<ResourceActivity> {
  const { holders, waiting } = processes.resourceActivity();
  const describe = async (slot: SlotInfo): Promise<ResourceCommand> => ({
    entryId: slot.entryId,
    conversationId: slot.conversationId,
    conversationTitle: (await conversations.find(slot.conversationId).catch(() => undefined))?.title ?? "",
    command: slot.command,
    since: slot.since,
  });
  return { holders: await Promise.all(holders.map(describe)), waiting: await Promise.all(waiting.map(describe)) };
}
