import type { ClaudeConnector } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { ConnectorOffering } from "./connector-offering";

const keyOf = (connectors: readonly ClaudeConnector[]): string =>
  connectors
    .map((server) => `${server.name}=${server.status}`)
    .sort()
    .join("|");

/** Re-offers or withdraws `claude_connector` in every thread when the known connector list changes. */
export function resyncWhenConnectorsChange(
  changes: Pick<ChangeEmitter, "subscribe">,
  provider: { claudeConnectors(): readonly ClaudeConnector[] | null },
  offering: Pick<ConnectorOffering, "resyncAll">,
): () => void {
  let last: string | undefined;
  let running: Promise<void> = Promise.resolve();
  return changes.subscribe((change) => {
    if (change.resource !== "providers") return;
    const connectors = provider.claudeConnectors();
    if (connectors === null) return;
    const key = keyOf(connectors);
    if (key === last) return;
    last = key;
    running = running
      .then(() => offering.resyncAll())
      .catch((error) => console.error("tau: could not resync connectors", error));
  });
}
