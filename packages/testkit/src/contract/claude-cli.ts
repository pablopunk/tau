import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const CLAUDE_CLI = "claude-cli";
const CLI_STATES = [
  "ready",
  "needs_notice",
  "missing",
  "logged_out",
  "not_plan",
  "blocked",
  "error",
  "sdk_missing",
];

/**
 * MVP9 owner A removes the `claude-cli` tag from the real core's pending list. The real target runs with the
 * fake Agent SDK logged in (`TAU_FAKE_CLAUDE_CLI=1`), so the row starts at `needs_notice`.
 */
export function claudeCliCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("claude cli", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    const row = async () =>
      (await target.core.providers.list()).find((provider) => provider.id === CLAUDE_CLI);

    test("[claude-cli] the row is listed last with a status, no key url and no connection before the notice", async () => {
      const providers = await target.core.providers.list();
      expect(providers.at(-1)?.id).toBe(CLAUDE_CLI);
      const info = await row();
      expect(info?.methods).toEqual(["claude_cli"]);
      expect(info?.connection).toBeNull();
      expect(CLI_STATES).toContain(info?.cli?.state);
      expect(info?.cli?.state).toBe("needs_notice");
      expect(Object.keys(info?.cli ?? {}).sort()).toEqual(
        [
          "cliVersion",
          "connectors",
          "message",
          "org",
          "plan",
          "processCount",
          "sdkCliVersion",
          "state",
          "usage",
        ].sort(),
      );
    });

    test("[claude-cli] no other provider has a cli status", async () => {
      const others = (await target.core.providers.list()).filter((provider) => provider.id !== CLAUDE_CLI);
      expect(others.every((provider) => provider.cli === null)).toBe(true);
    });

    test("[claude-cli] acknowledging the notice records it, connects the row and announces it", async () => {
      const { core } = target;
      expect((await core.settings.get()).claudeCliNoticeAt).toBeNull();
      const { changes, stop } = collectChanges(core);
      const info = await core.providers.acknowledgeClaudeCli();
      stop();
      expect(info).toMatchObject({
        id: CLAUDE_CLI,
        connection: { method: "claude_cli", source: "cli", valid: true },
        cli: { state: "ready" },
      });
      expect(changes).toContainEqual({ resource: "providers" });
      expect((await core.settings.get()).claudeCliNoticeAt).toEqual(expect.any(Number));
    });

    test("[claude-cli] lists the Claude CLI models only after the notice", async () => {
      const { core } = target;
      expect((await core.models.list()).some((model) => model.provider === CLAUDE_CLI)).toBe(false);
      await core.providers.acknowledgeClaudeCli();
      const claudeModels = (await core.models.list()).filter((model) => model.provider === CLAUDE_CLI);
      expect(claudeModels.length).toBeGreaterThan(0);
      expect(claudeModels.every((model) => model.providerName === "Claude CLI")).toBe(true);
    });

    test("[claude-cli] refresh returns the row, announces it and never rejects for a state", async () => {
      const { core } = target;
      const { changes, stop } = collectChanges(core);
      const info = await core.providers.refreshClaudeCli();
      stop();
      expect(info.id).toBe(CLAUDE_CLI);
      expect(CLI_STATES).toContain(info.cli?.state);
      expect(changes).toContainEqual({ resource: "providers" });
    });

    test("[claude-cli] install returns the row and announces it", async () => {
      const { core } = target;
      const { changes, stop } = collectChanges(core);
      const info = await core.providers.installClaudeCliSdk();
      stop();
      expect(info.id).toBe(CLAUDE_CLI);
      expect(CLI_STATES).toContain(info.cli?.state);
      expect(changes).toContainEqual({ resource: "providers" });
    });

    test("[claude-cli] has no key to set or remove", async () => {
      const { core } = target;
      await rejectsWithCode(core.providers.setApiKey(CLAUDE_CLI, "sk-contract-test"), "invalid_request");
      await rejectsWithCode(core.providers.disconnect(CLAUDE_CLI), "invalid_request");
    });
  });
}
