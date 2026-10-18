import type { ConversationView } from "./view";

/** Renders a view as plain text for `tau threads read` and `--wait`. Owner A implements it. */
export function viewToText(_view: ConversationView, _options: { readonly last?: number } = {}): string {
  throw new Error("viewToText is not implemented");
}
