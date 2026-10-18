import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationView } from "@tau/protocol";
import type { Fixture } from "./types";

/** The view after each frame of the fixture, as a client applying the frames would see it. `null` once retired. */
export function fixtureViews(fixture: Fixture): (ConversationView | null)[] {
  const views: (ConversationView | null)[] = [];
  let view: ConversationView | null | undefined;
  for (const frame of fixture.frames) {
    view = applyImmutable<ConversationView | null>(view, frame.ops);
    views.push(view);
  }
  return views;
}

export function finalView(fixture: Fixture): ConversationView | null {
  return fixtureViews(fixture).at(-1) ?? null;
}
