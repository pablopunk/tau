import { describe } from "vitest";
import { type ContractOptions, caseRunner } from "./case-runner";
import { chatCases } from "./chat";
import { cloneCases } from "./clone";
import { compactCases } from "./compact";
import { configureCases } from "./configure";
import { conversationCases } from "./conversations";
import { fileCases } from "./files";
import { fsCases } from "./fs";
import { githubCases } from "./github";
import { iconCases } from "./icons";
import { lifecycleCases } from "./lifecycle";
import { loginCases } from "./login";
import { projectCases } from "./projects";
import { providerCases } from "./providers";
import { retryCases } from "./retry";
import { settingsAndProviderCases } from "./settings-provider";
import { sidebarDataCases } from "./sidebar-data";
import { skillCases } from "./skills";
import { startCases } from "./start";
import { titleAndStatusCases } from "./titles-status";
import type { MakeContractTarget } from "./types";

export type { ContractOptions } from "./case-runner";
export type { ContractTarget, MakeContractTarget } from "./types";

/**
 * Behavior every `Core` must have. Run against the testkit fake (testkit's own test) and against the real core
 * in faux mode (core's test). `makeTarget` is called once per test and must give an empty, independent core.
 * Case names carry a `[tag]`; `options.pending` lists tags a target does not implement yet.
 */
export function runCoreContract(
  name: string,
  makeTarget: MakeContractTarget,
  options: ContractOptions = {},
): void {
  const test = caseRunner(options.pending);
  describe(`Core contract: ${name}`, () => {
    settingsAndProviderCases(makeTarget, test);
    projectCases(makeTarget, test);
    fsCases(makeTarget, test);
    conversationCases(makeTarget, test);
    startCases(makeTarget, test);
    titleAndStatusCases(makeTarget, test);
    lifecycleCases(makeTarget, test);
    retryCases(makeTarget, test);
    configureCases(makeTarget, test);
    cloneCases(makeTarget, test);
    chatCases(makeTarget, test);
    githubCases(makeTarget, test);
    iconCases(makeTarget, test);
    sidebarDataCases(makeTarget, test);
    providerCases(makeTarget, test);
    loginCases(makeTarget, test);
    compactCases(makeTarget, test);
    fileCases(makeTarget, test);
    skillCases(makeTarget, test);
  });
}
