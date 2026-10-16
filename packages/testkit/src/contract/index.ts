import { describe } from "vitest";
import { chatCases } from "./chat";
import { conversationCases } from "./conversations";
import { projectCases } from "./projects";
import { settingsAndProviderCases } from "./settings-provider";
import type { MakeContractTarget } from "./types";

export type { ContractTarget, MakeContractTarget } from "./types";

/**
 * Behavior every `Core` must have. Run against the testkit fake (testkit's own test) and against the real core
 * in faux mode (core's test). `makeTarget` is called once per test and must give an empty, independent core.
 */
export function runCoreContract(name: string, makeTarget: MakeContractTarget): void {
  describe(`Core contract: ${name}`, () => {
    settingsAndProviderCases(makeTarget);
    projectCases(makeTarget);
    conversationCases(makeTarget);
    chatCases(makeTarget);
  });
}
