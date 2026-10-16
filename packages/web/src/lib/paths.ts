export const conversationPath = (projectId: string, conversationId: string) =>
  `/p/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`;

export const newThreadPath = (projectId?: string) =>
  projectId === undefined ? "/new" : `/new?project=${encodeURIComponent(projectId)}`;
