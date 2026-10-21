import { type ContractModule, runCoreContract } from "@tau/testkit/contract";
import { describe } from "vitest";
import { makeRealTarget, REAL_CORE_IMPLEMENTED } from "./contract-target";

const MODULES: readonly ContractModule[] = [
  "settings",
  "resources",
  "projects",
  "fs",
  "conversations",
  "start",
  "titles-status",
  "lifecycle",
  "retry",
];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  // `[voice-transcribe]` is the foundation stub: agents (a)/(b) implement the pipelines, then drop the tag.
  runCoreContract("real core (faux mode)", makeRealTarget, { pending: ["[voice-transcribe]"] }, MODULES);
});
