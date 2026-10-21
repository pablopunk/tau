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
  // `[voice-transcribe]` stays pending on the real core: local transcription
  // needs the ~670MB model download, so only the fake loopback runs it here.
  // Real transcription is covered by transcriber unit tests (injected worker)
  // plus manual validation against a downloaded model.
  runCoreContract("real core (faux mode)", makeRealTarget, { pending: ["[voice-transcribe]"] }, MODULES);
});
