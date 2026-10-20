import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const FULL: ResourceSettings = {
  priority: "background",
  heavySlots: 2,
  memoryLimitMb: 4096,
  appliesTo: { main: true, worktrees: true, subagents: false },
};

export function resourceCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("resources", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[resources] default is Off with subagents governed only", async () => {
      expect((await target.core.settings.get()).resources).toEqual(DEFAULT_RESOURCE_SETTINGS);
      expect(DEFAULT_RESOURCE_SETTINGS).toEqual({
        priority: "off",
        heavySlots: null,
        memoryLimitMb: null,
        appliesTo: { main: false, worktrees: false, subagents: true },
      });
    });

    test("[resources] setResources round trips and can be switched off again", async () => {
      const { core } = target;
      await core.settings.setResources(FULL);
      expect((await core.settings.get()).resources).toEqual(FULL);
      await core.settings.setResources(DEFAULT_RESOURCE_SETTINGS);
      expect((await core.settings.get()).resources).toEqual(DEFAULT_RESOURCE_SETTINGS);
    });

    test("[resources] a partial setting is valid: each control works alone", async () => {
      const { core } = target;
      for (const partial of [
        { ...DEFAULT_RESOURCE_SETTINGS, priority: "balanced" as const },
        { ...DEFAULT_RESOURCE_SETTINGS, heavySlots: 1 },
        { ...DEFAULT_RESOURCE_SETTINGS, memoryLimitMb: 64 },
      ]) {
        await core.settings.setResources(partial);
        expect((await core.settings.get()).resources).toEqual(partial);
      }
    });

    test("[resources] heavy slots must be 1 to 64", async () => {
      const { core } = target;
      for (const heavySlots of [0, 65, 1.5, -1]) {
        await rejectsWithCode(core.settings.setResources({ ...FULL, heavySlots }), "invalid_request");
      }
      for (const heavySlots of [1, 64]) await core.settings.setResources({ ...FULL, heavySlots });
    });

    test("[resources] memory limit must be at least 64 MB", async () => {
      const { core } = target;
      for (const memoryLimitMb of [0, 63, 64.5]) {
        await rejectsWithCode(core.settings.setResources({ ...FULL, memoryLimitMb }), "invalid_request");
      }
      await core.settings.setResources({ ...FULL, memoryLimitMb: 64 });
    });

    test("[resources] a rejected value leaves the stored one alone", async () => {
      const { core } = target;
      await core.settings.setResources(FULL);
      await rejectsWithCode(core.settings.setResources({ ...FULL, heavySlots: 0 }), "invalid_request");
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
