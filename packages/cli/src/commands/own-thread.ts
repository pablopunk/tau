import { type ConversationSummary, lineageOf } from "@tau/protocol";
import { failure } from "./cli-exit";
import { callRoute, type Server } from "./client";
import type { CommandEnv } from "./command-env";

export { lineageOf };

export const GUARDED_COMMANDS: readonly string[] = ["threads delete", "threads archive"];

/** An agent must not delete or archive the thread it runs in, or a thread above it. */
export async function assertNotOwnLineage(
  server: Server,
  env: CommandEnv,
  command: string,
  threadId: string,
): Promise<void> {
  const ownId = env.env.TAU_THREAD_ID;
  if (!ownId) return;
  const all = (await callRoute(server, "listAllConversations", {}, env)) as ConversationSummary[];
  if (lineageOf(all, ownId).has(threadId)) {
    throw failure(`Refusing \`tau ${command}\`: ${threadId} is your own thread or one of its parents.`);
  }
}
