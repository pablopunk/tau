export const conversationPath = (projectId: string, conversationId: string) =>
  `/p/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`;

export const newThreadPath = (projectId?: string) =>
  projectId === undefined ? "/new" : `/new?project=${encodeURIComponent(projectId)}`;

export const terminalPath = (projectId: string, conversationId: string, terminalId?: string) =>
  terminalId === undefined
    ? `${conversationPath(projectId, conversationId)}/terminal`
    : `${conversationPath(projectId, conversationId)}/terminal/${encodeURIComponent(terminalId)}`;
