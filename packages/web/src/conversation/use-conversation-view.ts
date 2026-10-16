import type { ConversationView } from "@pi-everywhere/protocol";
import { useEffect, useState } from "react";
import { useLiveClient } from "./live-client-context";

/** `loading`: no base frame yet. `gone`: the view is retired or the conversation does not exist. */
export type ConversationViewState =
  | { readonly status: "loading" }
  | { readonly status: "gone" }
  | { readonly status: "ready"; readonly view: ConversationView };

const LOADING: ConversationViewState = { status: "loading" };

export function useConversationView(conversationId: string): ConversationViewState {
  const client = useLiveClient();
  const [state, setState] = useState<{ id: string; value: ConversationViewState }>({
    id: conversationId,
    value: LOADING,
  });
  useEffect(() => {
    setState({ id: conversationId, value: LOADING });
    return client.subscribe(conversationId, (view) => {
      setState({ id: conversationId, value: view ? { status: "ready", view } : { status: "gone" } });
    });
  }, [client, conversationId]);
  return state.id === conversationId ? state.value : LOADING;
}
