import { type ContractModule, runCoreContract } from "@tau/testkit/contract";
import { describe } from "vitest";
import { makeRealTarget, REAL_CORE_IMPLEMENTED } from "./contract-target";

const MODULES: readonly ContractModule[] = [
  "files",
  "skills",
  "workspaces",
  "checkpoints",
  "fork",
  "queue",
  "subagents",
  "processes",
  "terminals",
];

describe.skipIf(!REAL_CORE_IMPLEMENTED)("real core", () => {
  // Queue-remake receipts land per release: the real core returns the frozen
  // shapes with stub snapshots until R2 implements the server-side behavior.
  runCoreContract(
    "real core (faux mode)",
    makeRealTarget,
    { pending: ["[send-now]", "[cancel-restore]", "[cancel-refs]", "[cancel-validation]"] },
    MODULES,
  );
});
