import type { ImageInput, QueuedMessage, WhenBusy } from "@tau/protocol";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { scopeTarget } from "@/lib/node-keys";
import { markAction, markConfirm, markLiveReflect } from "@/lib/timings";
import { useApi, useNodeId } from "@/nodes/node-context";
import { restoreSnapshotsToComposer, restoreToComposer } from "../composer/restore";
import { isUserItem, STEER_COPY } from "./queued-mode";

const DELIVERED_NOTICE = "Too late to change: the agent already received that message.";

/**
 * One atomic `sendNow(conversationId, itemId)` RPC: the server snapshots,
 * aborts, and re-admits the chosen item ahead of every survivor. The client
 * never mints requestIds here and never moves queue rows optimistically —
 * ordering lives server-side (abort/withdraw/re-admit may not honor a faked
 * order).
 *
 * Mode switch (Steer/Queue) is one in-place `setQueuedMode` RPC: the server
 * flips the inbox item's mode under its own id, so the row updates without
 * unmounting (no cancel + re-send, no new submission, no reorder). Nothing
 * is withdrawn, so a failure loses nothing and restores nothing.
 *
 * One busy flag disables every queued-item button while any action is in
 * flight: no double-click double-admit (F3). Unselected user items come back
 * from the server response into the composer, never from the client draft.
 */
export function QueuedItemActions({
  conversationId,
  item,
  busy,
  onBusyChange,
}: {
  conversationId: string;
  item: QueuedMessage;
  /** Shared in-flight flag across every queued-item row: while any action runs, all buttons disable. */
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const api = useApi();
  const nodeId = useNodeId();
  const [failed, setFailed] = useState(false);
  const disabled = busy;

  const run = async (action: (conversations: Api["conversations"]) => Promise<void>) => {
    if (busy) return;
    onBusyChange(true);
    setFailed(false);
    try {
      await action(api.conversations);
    } catch (error) {
      setFailed(true);
      toast.error(errorMessage(error));
    } finally {
      onBusyChange(false);
    }
  };

  const sendNow = () =>
    run(async (rpc) => {
      const token = markAction("queue-send-now");
      const target = scopeTarget(conversationId, nodeId);
      const result = await rpc.sendNow(conversationId, String(item.id));
      markConfirm(token, result, "send-now");
      // Unselected items survive server-side; the user ones return here for
      // the composer. Restore post-success only: the client draft races the
      // withdraw and lacks FileRefs.
      restoreSnapshotsToComposer(target, result.restored);
      markLiveReflect("queue-send-now", result, token);
    });

  const cancel = () =>
    run(async (rpc) => {
      const token = markAction("queue-cancel");
      const target = scopeTarget(conversationId, nodeId);
      const result = await rpc.cancelQueued(conversationId, String(item.id));
      if (!result.cancelled) {
        toast.info(DELIVERED_NOTICE);
        return;
      }
      markConfirm(token, {}, "cancel");
      // Pre-contract nodes return no snapshot: fall back to the row content.
      if (result.restored.length > 0) restoreSnapshotsToComposer(target, result.restored);
      else restoreToComposer(target, { text: item.text, images: item.images.map(toImageInput) });
      markLiveReflect("queue-cancel", {}, token);
    });

  const changeMode = (mode: WhenBusy) => {
    if (item.mode === mode) return;
    return run(async (rpc) => {
      const token = markAction("queue-mode-change");
      const result = await rpc.setQueuedMode(conversationId, String(item.id), mode);
      if (!result.switched) {
        toast.info(DELIVERED_NOTICE);
        return;
      }
      markConfirm(token, {}, "queue-mode-change");
      markLiveReflect("queue-mode-change", {}, token);
    });
  };

  if (!isUserItem(item)) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => void sendNow()}
        title={STEER_COPY}
      >
        Send now
      </Button>
      <Button
        type="button"
        variant={item.mode === "steer" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={item.mode === "steer"}
        disabled={disabled}
        onClick={() => void changeMode("steer")}
        title={STEER_COPY}
      >
        Steer
      </Button>
      <Button
        type="button"
        variant={item.mode === "followUp" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={item.mode === "followUp"}
        disabled={disabled}
        onClick={() => void changeMode("followUp")}
      >
        Queue
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => void cancel()}>
        Cancel
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          Failed — try again
        </span>
      ) : null}
    </>
  );
}

function toImageInput({ mimeType, data }: QueuedMessage["images"][number]): ImageInput {
  return { mimeType: mimeType as ImageInput["mimeType"], data };
}
