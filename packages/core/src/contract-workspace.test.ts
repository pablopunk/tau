import { describe } from "vitest";
import { type ContractModule, runCoreContract } from "@tau/testkit/contract";
import { makeRealTarget, REAL_CORE_IMPLEMENTED } from "./contract-target";

const MODULES: readonly ContractModule[] = ["files", "skills", "workspaces", "checkpoints", "fork", "queue", "subagents", "processes", "terminals"];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  runCoreContract("real core (faux mode)", makeRealTarget, {}, MODULES);
});
