import { existsSync } from "node:fs";
import { AppError, type ConversationSummary } from "@tau/protocol";

export interface ThreadLookup {
  find(id: string): Promise<ConversationSummary | undefined>;
}

/** The folder a thread's shell starts in. Order: unknown thread, removed workspace, missing folder. */
export async function cwdOf(threads: ThreadLookup, conversationId: string): Promise<string> {
  const thread = await threads.find(conversationId);
  if (!thread) throw new AppError("not_found", "Conversation not found.");
  const { state, path } = thread.workspace;
  if (state === "removed") throw new AppError("invalid_request", "This thread's workspace was removed.");
  if (!existsSync(path)) throw new AppError("invalid_request", "This thread's folder no longer exists.");
  return path;
}
