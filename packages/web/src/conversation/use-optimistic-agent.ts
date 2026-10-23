import type { AgentInfo, ConfigureConversationInput, ModelRef, ThinkingLevel } from "@tau/protocol";
import { useCallback, useEffect, useState } from "react";

/** Safety net: if the view never reflects an accepted change, stop showing the chosen value after this long. */
const REFLECT_GRACE_MS = 3000;

type Chosen = { model?: ModelRef; thinkingLevel?: ThinkingLevel };

const without = (chosen: Chosen, input: ConfigureConversationInput): Chosen => {
  const next = { ...chosen };
  if (input.model !== undefined) delete next.model;
  if (input.thinkingLevel !== undefined) delete next.thinkingLevel;
  return next;
};

/**
 * A model or thinking level picked in the toolbar shows at once instead of after the server's round trip.
 * The chosen value is dropped as soon as the live view shows it, or put back to the real one when the server
 * refuses it.
 */
export function useOptimisticAgent(
  agent: AgentInfo,
  send: (input: ConfigureConversationInput) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const [chosen, setChosen] = useState<Chosen>({});
  useEffect(() => {
    setChosen((current) => {
      const modelShown =
        current.model?.provider === agent.provider && current.model?.modelId === agent.modelId;
      const levelShown = current.thinkingLevel === agent.thinkingLevel;
      if (!modelShown && !levelShown) return current;
      const next = { ...current };
      if (modelShown) delete next.model;
      if (levelShown) delete next.thinkingLevel;
      return next;
    });
  }, [agent.provider, agent.modelId, agent.thinkingLevel]);

  const configure = useCallback(
    (input: ConfigureConversationInput) => {
      setChosen((current) => ({
        ...current,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.thinkingLevel !== undefined && { thinkingLevel: input.thinkingLevel }),
      }));
      send(input).then(
        () => void setTimeout(() => setChosen((current) => without(current, input)), REFLECT_GRACE_MS),
        (error: unknown) => {
          setChosen((current) => without(current, input));
          onError(error);
        },
      );
    },
    [send, onError],
  );

  const shown: AgentInfo = {
    ...agent,
    ...(chosen.model && { provider: chosen.model.provider, modelId: chosen.model.modelId }),
    ...(chosen.thinkingLevel !== undefined && { thinkingLevel: chosen.thinkingLevel }),
  };
  return { agent: shown, configure };
}
