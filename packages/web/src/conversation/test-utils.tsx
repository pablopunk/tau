import type { ConversationView } from "@pi-everywhere/protocol";
import { type FixtureName, finalView, fixtures, fixtureViews } from "@pi-everywhere/testkit";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { Conversation } from "./Conversation";
import type { LiveClient } from "./live-client";
import { LiveClientProvider } from "./live-client-context";

export type ViewListener = (view: ConversationView | null) => void;

export interface StubLiveClient extends LiveClient {
  push(view: ConversationView | null): void;
  readonly subscribedIds: string[];
}

export function createStubLiveClient(initial?: ConversationView | null): StubLiveClient {
  const listeners = new Set<ViewListener>();
  const subscribedIds: string[] = [];
  return {
    subscribe(conversationId, onView) {
      subscribedIds.push(conversationId);
      listeners.add(onView);
      if (initial !== undefined) onView(initial);
      return () => listeners.delete(onView);
    },
    onChanged: () => () => {},
    onStatus: () => () => {},
    status: "open",
    close: vi.fn(),
    push: (view) => {
      for (const listener of [...listeners]) listener(view);
    },
    subscribedIds,
  };
}

export function renderConversation(client: LiveClient, id = "2") {
  return render(
    <LiveClientProvider client={client}>
      <Conversation id={id} />
    </LiveClientProvider>,
  );
}

export function renderView(view: ConversationView | null) {
  return renderConversation(createStubLiveClient(view));
}

/** The first view of a recorded fixture that satisfies `predicate`; fails the test if none does. */
export function viewWhere(
  name: FixtureName,
  predicate: (view: ConversationView) => boolean,
): ConversationView {
  const found = fixtureViews(fixtures[name]).find(
    (view): view is ConversationView => view !== null && predicate(view),
  );
  if (!found) throw new Error(`no view of fixture ${name} matches`);
  return found;
}

export function endOf(name: FixtureName): ConversationView {
  const view = finalView(fixtures[name]);
  if (!view) throw new Error(`fixture ${name} ends retired`);
  return view;
}

export function liveDoc(view: ConversationView): Record<string, unknown> {
  return (view.docs["pi.live"] ?? {}) as Record<string, unknown>;
}
