import type { ConversationView } from "@tau/protocol";
import { useEffect, useState } from "react";
import type { LiveClient } from "./live-client";
import { useLiveClient } from "./live-client-context";

/** `loading`: no base frame yet. `gone`: the view is retired or the conversation does not exist. */
export type ConversationViewState =
  | { readonly status: "loading" }
  | { readonly status: "gone" }
  | { readonly status: "ready"; readonly view: ConversationView };

const LOADING: ConversationViewState = { status: "loading" };

/** What the client already holds for this conversation, so a revisit shows it on the first render instead of a skeleton. */
function heldView(client: LiveClient, conversationId: string): ConversationViewState {
  const view = client.peek(conversationId);
  return view ? { status: "ready", view } : LOADING;
}

export function useConversationView(conversationId: string): ConversationViewState {
  const client = useLiveClient();
  const [state, setState] = useState<{ id: string; value: ConversationViewState }>(() => ({
    id: conversationId,
    value: heldView(client, conversationId),
  }));
  useEffect(() => {
    setState({ id: conversationId, value: heldView(client, conversationId) });
    return client.subscribe(conversationId, (view) => {
      setState({ id: conversationId, value: view ? { status: "ready", view } : { status: "gone" } });
    });
  }, [client, conversationId]);
  return state.id === conversationId ? state.value : heldView(client, conversationId);
}
