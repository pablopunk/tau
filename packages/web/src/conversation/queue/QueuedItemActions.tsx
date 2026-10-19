import type { ImageInput, QueuedMessage, WhenBusy } from "@tau/protocol";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { scopeTarget } from "@/lib/node-keys";
import { useApi, useNodeId } from "@/nodes/node-context";
import { restoreToComposer } from "../composer/restore";
import { newRequestId } from "../use-conversation-actions";
import { stopAndRestore } from "./stop-restore";

const DELIVERED_NOTICE = "Too late to change: the agent already received that message.";

function toImageInput({ mimeType, data }: QueuedMessage["images"][number]): ImageInput {
  return { mimeType: mimeType as ImageInput["mimeType"], data };
}

function sendInputOf(item: QueuedMessage, whenBusy?: WhenBusy) {
  const images = item.images.map(toImageInput);
  return {
    text: item.text,
    ...(images.length > 0 && { images }),
    ...(whenBusy && { whenBusy }),
    requestId: newRequestId(),
  };
}

async function attempt(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

async function cancel(api: Api, nodeId: string | undefined, conversationId: string, item: QueuedMessage) {
  const { cancelled } = await api.conversations.cancelQueued(conversationId, String(item.id));
  if (!cancelled) return void toast.info(DELIVERED_NOTICE);
  restoreToComposer(scopeTarget(conversationId, nodeId), {
    text: item.text,
    images: item.images.map(toImageInput),
  });
}

async function changeMode(api: Api, conversationId: string, item: QueuedMessage, mode: WhenBusy) {
  if (item.mode === mode) return;
  const { cancelled } = await api.conversations.cancelQueued(conversationId, String(item.id));
  if (!cancelled) return void toast.info(DELIVERED_NOTICE);
  await api.conversations.send(conversationId, sendInputOf(item, mode));
}

async function sendNow(
  api: Api,
  nodeId: string | undefined,
  conversationId: string,
  item: QueuedMessage,
  others: readonly QueuedMessage[],
) {
  await stopAndRestore(api, conversationId, nodeId, others);
  await api.conversations.send(conversationId, sendInputOf(item));
}

function ModeButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function QueuedItemActions({
  conversationId,
  item,
  others = [],
}: {
  conversationId: string;
  item: QueuedMessage;
  /** The other queued messages: `Send now` stops the run, which withdraws them. */
  others?: readonly QueuedMessage[];
}) {
  const api = useApi();
  const nodeId = useNodeId();
  return (
    <>
      <ModeButton
        label="Send now"
        onClick={() => void attempt(() => sendNow(api, nodeId, conversationId, item, others))}
      />
      <ModeButton
        label="Steer"
        active={item.mode === "steer"}
        onClick={() => void attempt(() => changeMode(api, conversationId, item, "steer"))}
      />
      <ModeButton
        label="Queue"
        active={item.mode === "followUp"}
        onClick={() => void attempt(() => changeMode(api, conversationId, item, "followUp"))}
      />
      <ModeButton
        label="Cancel"
        onClick={() => void attempt(() => cancel(api, nodeId, conversationId, item))}
      />
    </>
  );
}
