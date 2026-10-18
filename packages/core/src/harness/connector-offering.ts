import type { AgentChange, Harness, ToolRegistration } from "@earendil-works/pi-durable";
import type { ClaudeConnector, ClaudeConnectorSettings, ModelRef } from "@tau/protocol";
import { CONNECTOR_TOOL_NAME } from "../claude-cli/connectors/names";
import { CLAUDE_CLI_PROVIDER_ID } from "../claude-cli/provider";
import { scanAppConversations } from "./conversation-index";
import { BACKGROUND } from "./open";

export type ModelToolsChange = Pick<AgentChange, "modelTools">;

export const CONNECTOR_TOOL_REFERENCE = { name: CONNECTOR_TOOL_NAME } as ToolRegistration;

export interface ConnectorOffering {
  /** The `modelTools` change that offers `claude_connector` (or clears the offer) for a thread on `model`. */
  modelToolsFor(model: ModelRef | undefined): Promise<ModelToolsChange>;
  /** Whether a thread on `model` is offered the tool right now. */
  isOffered(model: ModelRef | undefined): Promise<boolean>;
  /** Settings changed: offers or withdraws the tool in every live thread. */
  resyncAll(): Promise<void>;
}

export interface ConnectorOfferingDeps {
  readonly harness: Harness;
  readonly settings: () => Promise<ClaudeConnectorSettings>;
  readonly connectors: () => readonly ClaudeConnector[] | null;
}

const isClaudeCliModel = (model: ModelRef | undefined): boolean => model?.provider === CLAUDE_CLI_PROVIDER_ID;

const isUsable = (known: readonly ClaudeConnector[] | null, name: string): boolean =>
  known === null || known.some((server) => server.name === name && server.status === "connected");

const offerChange: ModelToolsChange = { modelTools: { add: [CONNECTOR_TOOL_REFERENCE] } };
const withdrawChange: ModelToolsChange = { modelTools: null };

export function createConnectorOffering(deps: ConnectorOfferingDeps): ConnectorOffering {
  const hasChosenServer = async (): Promise<boolean> => {
    const { enabled } = await deps.settings();
    const known = deps.connectors();
    return enabled.some((name) => isUsable(known, name));
  };

  const isOffered = async (model: ModelRef | undefined) =>
    isClaudeCliModel(model) && (await hasChosenServer());

  async function syncThread(id: number): Promise<void> {
    const conversation = await deps.harness.conversation(id as never, BACKGROUND);
    if (!conversation) return;
    const agent = await conversation.agent(BACKGROUND);
    const wanted = await isOffered(agent.model);
    const has = agent.tools.some((tool) => tool.name === CONNECTOR_TOOL_NAME);
    if (wanted !== has) await conversation.configure(wanted ? offerChange : withdrawChange, BACKGROUND);
  }

  return {
    isOffered,
    modelToolsFor: async (model) => ((await isOffered(model)) ? offerChange : withdrawChange),
    async resyncAll() {
      for (const { id, meta } of await scanAppConversations(deps.harness)) {
        if (meta.deletedAt !== undefined) continue;
        await syncThread(Number(id)).catch((error) => console.error("tau: could not sync connectors", error));
      }
    },
  };
}
