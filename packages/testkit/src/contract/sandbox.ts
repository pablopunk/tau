import { DEFAULT_SANDBOX_SETTINGS, type SandboxSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const FULL: SandboxSettings = { main: false, worktree: true, subagent: true };

export function sandboxCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("sandbox", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[sandbox] default is off everywhere (staging gate)", async () => {
      expect((await target.core.settings.get()).sandbox).toEqual(DEFAULT_SANDBOX_SETTINGS);
      expect(DEFAULT_SANDBOX_SETTINGS).toEqual({ main: false, worktree: false, subagent: false });
    });

    test("[sandbox] setSandbox round trips and can be switched off again", async () => {
      const { core } = target;
      await core.settings.setSandbox(FULL);
      expect((await core.settings.get()).sandbox).toEqual(FULL);
      await core.settings.setSandbox(DEFAULT_SANDBOX_SETTINGS);
      expect((await core.settings.get()).sandbox).toEqual(DEFAULT_SANDBOX_SETTINGS);
    });

    test("[sandbox] each scope sets its flag alone", async () => {
      const { core } = target;
      const partial: SandboxSettings = { main: true, worktree: false, subagent: false };
      await core.settings.setSandbox(partial);
      expect((await core.settings.get()).sandbox).toEqual(partial);
    });

    test("[sandbox] a bad value is rejected and leaves the stored one alone", async () => {
      const { core } = target;
      await core.settings.setSandbox(FULL);
      await rejectsWithCode(
        core.settings.setSandbox({
          main: true,
          worktree: "yes",
          subagent: false,
        } as unknown as SandboxSettings),
        "invalid_request",
      );
      expect((await core.settings.get()).sandbox).toEqual(FULL);
    });
  });
}
