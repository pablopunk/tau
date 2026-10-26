import { AppError, type Approval, type ApprovalDecision, NATIVE_APPROVAL_SERVER } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import { cliToolNameOf } from "../claude-cli/connectors/names";
import type { SettingsStore } from "../home/settings-store";
import type { ApprovalRequest, Approvals, ApprovalVerdict } from "./approvals-port";

export interface ApprovalsDeps {
  readonly settings: Pick<SettingsStore, "get" | "setClaudeConnectors">;
  readonly changes: ChangeEmitter;
  readonly conversationOfSession: (piSessionId: string) => Promise<string | undefined>;
}

interface Pending {
  readonly approval: Approval;
  readonly settle: (verdict: ApprovalVerdict) => void;
}

const ALLOWED: ApprovalVerdict = { allowed: true };
const DENIED_BY_USER: ApprovalVerdict = { allowed: false, message: "The user denied this tool call." };
const DENIED_BY_STOP: ApprovalVerdict = { allowed: false, message: "The user stopped the thread." };
const DENIED_UNKNOWN_THREAD: ApprovalVerdict = { allowed: false, message: "This session has no thread." };
const DENIED_ABORTED: ApprovalVerdict = { allowed: false, message: "The tool call was cancelled." };

const isAlwaysAllowed = async (deps: ApprovalsDeps, cliToolName: string): Promise<boolean> =>
  (await deps.settings.get()).claudeConnectors.alwaysAllow.includes(cliToolName);

async function rememberAlwaysAllowed(deps: ApprovalsDeps, cliToolName: string): Promise<void> {
  const current = (await deps.settings.get()).claudeConnectors;
  if (current.alwaysAllow.includes(cliToolName)) return;
  await deps.settings.setClaudeConnectors({
    ...current,
    alwaysAllow: [...current.alwaysAllow, cliToolName],
  });
}

const isNative = (server: string): boolean => server === NATIVE_APPROVAL_SERVER;

const verdictOf = (decision: ApprovalDecision): ApprovalVerdict =>
  decision === "deny" ? DENIED_BY_USER : ALLOWED;

export function createApprovals(deps: ApprovalsDeps): Approvals {
  const pendingByConversation = new Map<string, Map<string, Pending>>();

  const pendingOf = (conversationId: string) => pendingByConversation.get(conversationId);

  const announce = (conversationId: string) => deps.changes.emit({ resource: "approvals", conversationId });

  function remove(conversationId: string, toolUseId: string): Pending | undefined {
    const pending = pendingOf(conversationId)?.get(toolUseId);
    if (!pending) return undefined;
    pendingOf(conversationId)?.delete(toolUseId);
    if (pendingOf(conversationId)?.size === 0) pendingByConversation.delete(conversationId);
    announce(conversationId);
    return pending;
  }

  function add(conversationId: string, pending: Pending): void {
    const forConversation = pendingOf(conversationId) ?? new Map<string, Pending>();
    forConversation.set(pending.approval.toolUseId, pending);
    pendingByConversation.set(conversationId, forConversation);
    announce(conversationId);
  }

  function park(conversationId: string, request: ApprovalRequest): Promise<ApprovalVerdict> {
    return new Promise((resolve) => {
      const { toolUseId } = request;
      const onAbort = () => {
        if (remove(conversationId, toolUseId)) resolve(DENIED_ABORTED);
      };
      const settle = (verdict: ApprovalVerdict) => {
        request.signal.removeEventListener("abort", onAbort);
        resolve(verdict);
      };
      const approval: Approval = {
        toolUseId,
        conversationId,
        server: request.server,
        tool: request.tool,
        arguments: request.arguments,
        requestedAt: Date.now(),
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      add(conversationId, { approval, settle });
    });
  }

  async function request(input: ApprovalRequest): Promise<ApprovalVerdict> {
    try {
      if (input.signal.aborted) return DENIED_ABORTED;
      if (!isNative(input.server) && (await isAlwaysAllowed(deps, cliToolNameOf(input)))) return ALLOWED;
      const conversationId = await deps.conversationOfSession(input.piSessionId);
      if (conversationId === undefined) return DENIED_UNKNOWN_THREAD;
      if (input.signal.aborted) return DENIED_ABORTED;
      return await park(conversationId, input);
    } catch {
      return DENIED_ABORTED;
    }
  }

  return {
    request,
    list: (conversationId) =>
      [...(pendingOf(conversationId)?.values() ?? [])].map((pending) => pending.approval),
    async decide(conversationId, toolUseId, decision) {
      const pending = remove(conversationId, toolUseId);
      if (!pending) throw new AppError("not_found", "No such tool call is waiting.");
      if (decision === "allow_always" && !isNative(pending.approval.server)) {
        await rememberAlwaysAllowed(deps, cliToolNameOf(pending.approval)).catch((error) => {
          console.error("Could not store the always-allowed tool", error);
        });
      }
      pending.settle(verdictOf(decision));
    },
    denyAll(conversationId) {
      for (const toolUseId of [...(pendingOf(conversationId)?.keys() ?? [])]) {
        remove(conversationId, toolUseId)?.settle(DENIED_BY_STOP);
      }
    },
    hasPending: (conversationId) => (pendingOf(conversationId)?.size ?? 0) > 0,
    isAlwaysAllowed: (cliToolName) => isAlwaysAllowed(deps, cliToolName),
  };
}
