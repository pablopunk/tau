import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { startConversation, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

/** Owner B (MVP8) extends these; the real core lists the tag as pending until `monitor` exists. */
export function monitorCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("monitors", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[monitors] a monitor the agent started is listed with kind monitor", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "monitor sleep 60" });
      await waitFor(async () => (await core.processes.list(conversation.id)).length === 1, "the monitor");
      const [info] = await core.processes.list(conversation.id);
      expect(info).toMatchObject({ kind: "monitor", state: "running", command: "sleep 60" });
    });

    test("[monitors] a plain background process has kind process", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "bg sleep 60" });
      await waitFor(async () => (await core.processes.list(conversation.id)).length === 1, "the process");
      expect((await core.processes.list(conversation.id))[0]?.kind).toBe("process");
    });
  });
}
