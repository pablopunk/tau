export interface ConversationProps {
  /** The conversation to show, as in `/p/:projectId/c/:conversationId`. */
  readonly id: string;
}

/** Stub: workstream D renders the transcript, live state and composer here. FROZEN: the props. */
export function Conversation({ id }: ConversationProps) {
  return (
    <div data-testid="conversation" className="p-4 text-sm text-muted-foreground">
      Conversation {id}
    </div>
  );
}
