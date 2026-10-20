import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const FULL: ResourceSettings = {
  levels: { main: "background", worktree: "balanced", subagent: "off" },
};

export function resourceCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("resources", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[resources] default is Off everywhere", async () => {
      expect((await target.core.settings.get()).resources).toEqual(DEFAULT_RESOURCE_SETTINGS);
      expect(DEFAULT_RESOURCE_SETTINGS).toEqual({
        levels: { main: "off", worktree: "off", subagent: "off" },
      });
    });

    test("[resources] setResources round trips and can be switched off again", async () => {
      const { core } = target;
      await core.settings.setResources(FULL);
      expect((await core.settings.get()).resources).toEqual(FULL);
      await core.settings.setResources(DEFAULT_RESOURCE_SETTINGS);
      expect((await core.settings.get()).resources).toEqual(DEFAULT_RESOURCE_SETTINGS);
    });

    test("[resources] each scope sets its level alone", async () => {
      const { core } = target;
      const partial = {
        ...DEFAULT_RESOURCE_SETTINGS,
        levels: { main: "balanced", worktree: "off", subagent: "off" } as const,
      };
      await core.settings.setResources(partial);
      expect((await core.settings.get()).resources).toEqual(partial);
    });

    test("[resources] a bad level is rejected and leaves the stored one alone", async () => {
      const { core } = target;
      await core.settings.setResources(FULL);
      await rejectsWithCode(
        core.settings.setResources({
          levels: { main: "ludicrous", worktree: "off", subagent: "off" },
        } as unknown as ResourceSettings),
        "invalid_request",
      );
      expect((await core.settings.get()).resources).toEqual(FULL);
    });

    test("[resources] support reports platform, memory enforcement and priority", async () => {
      expect(await target.core.settings.resourceSupport()).toEqual({
        platform: expect.stringMatching(/^(linux|macos|other)$/),
        memoryEnforcement: expect.stringMatching(/^(kernel|polled|none)$/),
        prioritySupported: expect.any(Boolean),
        sameCgroupOnly: expect.any(Boolean),
        note: expect.toBeOneOf([null, expect.any(String)]),
      });
    });

    test("[resources] activity is empty and stopResourceCommand rejects an id it does not list", async () => {
      const { core } = target;
      expect(await core.settings.resourceActivity()).toEqual({ holders: [], waiting: [] });
      await rejectsWithCode(core.settings.stopResourceCommand("process-nope"), "not_found");
    });
  });
}
