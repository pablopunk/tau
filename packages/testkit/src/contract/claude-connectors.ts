import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const CONNECTOR_KEYS = ["name", "readOnlyCount", "source", "status", "toolCount"];
const CHOICE = {
  enabled: ["claude.ai Linear"],
  alwaysAllow: ["mcp__claude_ai_Linear__save_comment"],
};

/**
 * MVP10: the real core lists the `claude-connectors` tag as pending until owners A and C land. The real target
 * runs with the fake Agent SDK (`TAU_FAKE_CLAUDE_CLI=1`), which lists Linear, Slack and a "needs auth" server.
 */
export function claudeConnectorCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("claude connectors", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[claude-connectors] settings start with no connector and no always-allowed tool", async () => {
      expect((await target.core.settings.get()).claudeConnectors).toEqual({ enabled: [], alwaysAllow: [] });
    });

    test("[claude-connectors] setClaudeConnectors replaces both lists", async () => {
      const { core } = target;
      await core.settings.setClaudeConnectors(CHOICE);
      expect((await core.settings.get()).claudeConnectors).toEqual(CHOICE);
      await core.settings.setClaudeConnectors({ enabled: [], alwaysAllow: [] });
      expect((await core.settings.get()).claudeConnectors).toEqual({ enabled: [], alwaysAllow: [] });
    });

    test("[claude-connectors] the status has no connector list before the notice and a typed list after", async () => {
      const { core } = target;
      const row = async () => (await core.providers.list()).find((provider) => provider.id === "claude-cli");
      expect((await row())?.cli?.connectors).toBeNull();
      await core.providers.acknowledgeClaudeCli();
      const connectors = (await core.providers.refreshClaudeCli()).cli?.connectors;
      expect(connectors?.length).toBeGreaterThan(0);
      for (const connector of connectors ?? []) {
        expect(Object.keys(connector).sort()).toEqual(CONNECTOR_KEYS);
        expect(connector.readOnlyCount).toBeLessThanOrEqual(connector.toolCount);
      }
    });

    test("[claude-connectors] a thread has no approval waiting, and an unknown thread is not found", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      expect(await core.approvals.list(conversation.id)).toEqual([]);
      await rejectsWithCode(core.approvals.list("nope"), "not_found");
    });

    test("[claude-connectors] deciding a call that is not waiting is not found", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await rejectsWithCode(core.approvals.decide(conversation.id, "toolu_none", "allow"), "not_found");
      await rejectsWithCode(core.approvals.decide("nope", "toolu_none", "deny"), "not_found");
    });
  });
}
