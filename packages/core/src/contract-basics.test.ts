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
  "uploads",
];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  runCoreContract("real core (faux mode)", makeRealTarget, {}, MODULES);
});
