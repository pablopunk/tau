import { type ConversationView, type NativeEvent, nativeEventsOf } from "@tau/protocol";

export const OUTCOME_UNKNOWN_TEXT = "Last run's outcome is unknown. Check the workspace before continuing.";
export const BLOCKED_TEXT = "The run is blocked.";

export interface NativeNotice {
  readonly text: string;
  readonly reason?: string | undefined;
}

type LifecycleEvent = Extract<NativeEvent, { type: "lifecycle" }>;

function lastLifecycleOf(events: readonly NativeEvent[]): LifecycleEvent | undefined {
  const last = events.findLast((event) => event.type === "lifecycle");
  return last?.type === "lifecycle" ? last : undefined;
}

/** What a native thread's last lifecycle asks the user to know; nothing for a healthy or finished run. */
export function nativeNoticeOf(view: ConversationView): NativeNotice | undefined {
  const last = lastLifecycleOf(nativeEventsOf(view));
  if (last?.lifecycle === "outcome-unknown") return { text: OUTCOME_UNKNOWN_TEXT, reason: last.reason };
  if (last?.lifecycle === "blocked") return { text: BLOCKED_TEXT, reason: last.reason };
  return undefined;
}

/** Request ids of the native `user` events: what a pending send is matched against. */
export function nativeRequestIdsOf(view: ConversationView): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const event of nativeEventsOf(view)) if (event.type === "user") ids.add(event.requestId);
  return ids;
}

/** Item keys of user events still waiting in the queue: they show under "Up next", not in the transcript. */
export function queuedNativeUserKeysOf(view: ConversationView): ReadonlySet<string> {
  const events = nativeEventsOf(view);
  const dispositions = new Map<string, string>();
  for (const event of events)
    if (event.type === "queue") dispositions.set(event.requestId, event.disposition);
  const keys = new Set<string>();
  for (const event of events)
    if (event.type === "user" && dispositions.get(event.requestId) === "queued") keys.add(event.key);
  return keys;
}
