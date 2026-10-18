import {
  AppError,
  type Approval,
  type ApprovalDecision,
  type Change,
  type ClaudeConnectorSettings,
  type Core,
} from "@tau/protocol";
import type { FakeConversation } from "./fake-conversation";

export interface FakeConnectorsContext {
  readonly emit: (change: Change) => void;
  readonly now: () => number;
  readonly requireConversation: (id: string) => FakeConversation;
}

export interface FakeApprovalSeed {
  readonly server: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
}

export interface FakeConnectors {
  readonly settings: () => ClaudeConnectorSettings;
  setSettings(value: ClaudeConnectorSettings): void;
  readonly approvals: Core["approvals"];
  /** Puts a tool call that waits for the user into a thread, as the real core does for a write tool. */
  seedApproval(conversationId: string, seed: FakeApprovalSeed): Approval;
}

const cliToolNameOf = (approval: Approval): string => `mcp__claude_ai_${approval.server}__${approval.tool}`;

/** In memory: a decision removes the approval, and `allow_always` stores the tool in the settings. */
export function createFakeConnectors(ctx: FakeConnectorsContext): FakeConnectors {
  let settings: ClaudeConnectorSettings = { enabled: [], alwaysAllow: [] };
  const pending = new Map<string, Approval[]>();
  let nextId = 1;
  const pendingOf = (conversationId: string) => pending.get(conversationId) ?? [];
  const announce = (conversationId: string) => ctx.emit({ resource: "approvals", conversationId });

  function remove(conversationId: string, toolUseId: string): Approval {
    const found = pendingOf(conversationId).find((approval) => approval.toolUseId === toolUseId);
    if (!found) throw new AppError("not_found", "No such tool call is waiting.");
    pending.set(
      conversationId,
      pendingOf(conversationId).filter((approval) => approval !== found),
    );
    return found;
  }

  const alwaysAllow = (approval: Approval) => {
    const name = cliToolNameOf(approval);
    if (!settings.alwaysAllow.includes(name))
      settings = { ...settings, alwaysAllow: [...settings.alwaysAllow, name] };
  };

  return {
    settings: () => ({ enabled: [...settings.enabled], alwaysAllow: [...settings.alwaysAllow] }),
    setSettings: (value) => {
      settings = { enabled: [...value.enabled], alwaysAllow: [...value.alwaysAllow] };
    },
    approvals: {
      async list(conversationId) {
        ctx.requireConversation(conversationId);
        return pendingOf(conversationId).map((approval) => ({ ...approval }));
      },
      async decide(conversationId: string, toolUseId: string, decision: ApprovalDecision) {
        ctx.requireConversation(conversationId);
        const approval = remove(conversationId, toolUseId);
        if (decision === "allow_always") alwaysAllow(approval);
        announce(conversationId);
      },
    },
    seedApproval(conversationId, seed) {
      ctx.requireConversation(conversationId);
      const approval: Approval = {
        toolUseId: `toolu_fake_approval_${nextId++}`,
        conversationId,
        server: seed.server,
        tool: seed.tool,
        arguments: { ...seed.arguments },
        requestedAt: ctx.now(),
      };
      pending.set(conversationId, [...pendingOf(conversationId), approval]);
      announce(conversationId);
      return approval;
    },
  };
}
