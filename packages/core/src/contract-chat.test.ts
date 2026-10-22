import { type ContractModule, runCoreContract } from "@tau/testkit/contract";
import { describe } from "vitest";
import { makeRealTarget, REAL_CORE_IMPLEMENTED } from "./contract-target";

const MODULES: readonly ContractModule[] = [
  "configure",
  "clone",
  "chat",
  "todos",
  "github",
  "icons",
  "sidebar-data",
  "provider",
  "login",
  "compact",
];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  // `[bang]`: real core admits `!` as a display-only app.bang entry, never a
  // verbatim pi.user entry (the fake keeps the legacy behavior).
  runCoreContract("real core (faux mode)", makeRealTarget, { pending: ["[bang]"] }, MODULES);
});
