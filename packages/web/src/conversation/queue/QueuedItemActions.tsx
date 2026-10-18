import type { ImageInput, QueuedMessage } from "@tau/protocol";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { restoreToComposer } from "../composer/restore";
import { queuedModeLabel } from "./queued-mode";

const DELIVERED_NOTICE = "Too late to cancel: the agent already received that message.";

function toImageInput({ mimeType, data }: QueuedMessage["images"][number]): ImageInput {
  return { mimeType: mimeType as ImageInput["mimeType"], data };
}

async function cancel(conversationId: string, item: QueuedMessage) {
  try {
    const { cancelled } = await api.conversations.cancelQueued(conversationId, String(item.id));
    if (!cancelled) return void toast.info(DELIVERED_NOTICE);
    restoreToComposer(conversationId, { text: item.text, images: item.images.map(toImageInput) });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export function QueuedItemActions({ conversationId, item }: { conversationId: string; item: QueuedMessage }) {
  return (
    <>
      <Badge variant="secondary">{queuedModeLabel(item.mode)}</Badge>
      <Button type="button" variant="ghost" size="sm" onClick={() => void cancel(conversationId, item)}>
        Cancel
      </Button>
    </>
  );
}
