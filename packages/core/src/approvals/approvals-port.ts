import type { Approval, ApprovalDecision } from "@tau/protocol";

export interface ApprovalRequest {
  /** The id Pi hands to `streamSimple`; the service maps it to a conversation. */
  readonly piSessionId: string;
  readonly toolUseId: string;
  readonly server: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  /** Aborts when the CLI gives up on the call (Stop, a closed query). */
  readonly signal: AbortSignal;
}

export type ApprovalVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string };

/** The adapter asks, the REST routes and Stop answer. In memory only: a restart drops every pending approval. */
export interface Approvals {
  /** Settles when the user decides, when `signal` aborts (denied) or when Stop denies it. Never rejects. */
  request(request: ApprovalRequest): Promise<ApprovalVerdict>;
  list(conversationId: string): readonly Approval[];
  /** Rejects `not_found` for a call that is not waiting. `allow_always` stores the tool in the settings. */
  decide(conversationId: string, toolUseId: string, decision: ApprovalDecision): Promise<void>;
  /** Stop: denies every pending approval of the thread. */
  denyAll(conversationId: string): void;
  hasPending(conversationId: string): boolean;
  /** Whether a tool name (`mcp__claude_ai_Linear__save_comment`) was always allowed. */
  isAlwaysAllowed(cliToolName: string): Promise<boolean>;
}
