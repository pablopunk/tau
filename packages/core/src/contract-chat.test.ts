import { type ContractModule, runCoreContract } from "@tau/testkit/contract";
import { describe } from "vitest";
import { makeRealTarget, REAL_CORE_IMPLEMENTED } from "./contract-target";

const MODULES: readonly ContractModule[] = [
  "configure",
  "clone",
  "chat",
  "github",
  "icons",
  "sidebar-data",
  "provider",
  "login",
  "compact",
];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  runCoreContract("real core (faux mode)", makeRealTarget, {}, MODULES);
});
