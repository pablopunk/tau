import { type ContractModule, runCoreContract } from "@tau/testkit/contract";
import { describe } from "vitest";
import { makeRealTarget, REAL_CORE_IMPLEMENTED } from "./contract-target";

const MODULES: readonly ContractModule[] = [
  "mcp",
  "timers",
  "monitors",
  "goals",
  "claude-cli",
  "claude-connectors",
  "access",
  "remote",
  "nodes",
  "nodes-group",
  "updates",
  "runtimes",
];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  runCoreContract("real core (faux mode)", makeRealTarget, {}, MODULES);
});
