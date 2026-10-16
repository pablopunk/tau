export const conversationPath = (projectId: string, conversationId: string) =>
  `/p/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`;
