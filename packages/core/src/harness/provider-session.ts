import { type ConversationId, type Harness, ProviderDoc } from "@earendil-works/pi-durable";
import { BACKGROUND } from "./open";

/** The id Pi hands to `streamSimple` as `sessionId`. Undefined for a thread that never made a request. */
export async function providerSessionOf(harness: Harness, id: string): Promise<string | undefined> {
  if (!/^[1-9]\d*$/.test(id)) return undefined;
  const state = await harness
    .snapshot(ProviderDoc, Number(id) as ConversationId, BACKGROUND)
    .catch(() => undefined);
  return state?.sessionId;
}
