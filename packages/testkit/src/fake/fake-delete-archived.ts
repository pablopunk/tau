import { type Core, unmergedWarningFor } from "@pi-everywhere/protocol";
import type { FakeConversation } from "./fake-conversation";
import { hasUnmergedWork } from "./fake-workspaces";

interface DeleteArchivedContext {
  readonly live: () => FakeConversation[];
  readonly remove: (conversation: FakeConversation) => Promise<void>;
  readonly announce: (conversation: FakeConversation) => void;
}

const isArchivedTopLevel = (conversation: FakeConversation) =>
  conversation.archivedAt !== null && conversation.parentId === null;

export function createFakeDeleteArchived(
  ctx: DeleteArchivedContext,
): Core["conversations"]["deleteArchived"] {
  return async ({ force }) => {
    const result: { deleted: string[]; kept: { id: string; reason: string }[] } = { deleted: [], kept: [] };
    for (const conversation of ctx.live().filter(isArchivedTopLevel)) {
      if (conversation.isBusy()) {
        result.kept.push({ id: conversation.id, reason: "The thread is running." });
      } else if (!force && hasUnmergedWork(conversation)) {
        result.kept.push({ id: conversation.id, reason: unmergedWarningFor(conversation.workspace.branch) });
      } else {
        await ctx.remove(conversation);
        ctx.announce(conversation);
        result.deleted.push(conversation.id);
      }
    }
    return result;
  };
}
