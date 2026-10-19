import { createContext, useContext } from "react";

const ToolConversationContext = createContext<string | undefined>(undefined);

/** The thread whose tool calls render below; `undefined` where a transcript has no thread of its own. */
export const ToolConversationProvider = ToolConversationContext.Provider;

export const useToolConversationId = (): string | undefined => useContext(ToolConversationContext);
