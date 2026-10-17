import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { ConversationDoc } from "../conversation-docs";

export async function projectIdOfCall(api: ToolExecutionApi, context: Context): Promise<string> {
  const meta = await api.snapshot(ConversationDoc, api.conversationId, context);
  if (!meta?.projectId) throw new Error("This conversation has no project.");
  return meta.projectId;
}
