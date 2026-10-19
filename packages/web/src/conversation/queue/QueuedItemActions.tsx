import type { ImageInput, QueuedMessage } from "@tau/protocol";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { scopeTarget } from "@/lib/node-keys";
import { useApi, useNodeId } from "@/nodes/node-context";
import { restoreToComposer } from "../composer/restore";
import { queuedModeLabel } from "./queued-mode";

const DELIVERED_NOTICE = "Too late to cancel: the agent already received that message.";

function toImageInput({ mimeType, data }: QueuedMessage["images"][number]): ImageInput {
  return { mimeType: mimeType as ImageInput["mimeType"], data };
}

async function cancel(api: Api, nodeId: string | undefined, conversationId: string, item: QueuedMessage) {
  try {
    const { cancelled } = await api.conversations.cancelQueued(conversationId, String(item.id));
    if (!cancelled) return void toast.info(DELIVERED_NOTICE);
    restoreToComposer(scopeTarget(conversationId, nodeId), {
      text: item.text,
      images: item.images.map(toImageInput),
    });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export function QueuedItemActions({ conversationId, item }: { conversationId: string; item: QueuedMessage }) {
  const api = useApi();
  const nodeId = useNodeId();
  return (
    <>
      <Badge variant="secondary">{queuedModeLabel(item.mode)}</Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void cancel(api, nodeId, conversationId, item)}
      >
        Cancel
      </Button>
    </>
  );
}
