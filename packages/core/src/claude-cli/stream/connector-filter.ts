import { CONNECTOR_TOOL_NAME } from "../connectors/names";
import type { Binding } from "./binding";
import type { Entry } from "./normalize";

export const isConnectorResultEntry = (binding: Binding, { message }: Entry): boolean =>
  message.role === "toolResult" &&
  (message.toolName === CONNECTOR_TOOL_NAME || binding.connectorIds.has(message.toolCallId));

export const withoutConnectorResults = (binding: Binding, suffix: readonly Entry[]): Entry[] =>
  suffix.filter((entry) => !isConnectorResultEntry(binding, entry));
