import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import type { ContractTarget, MakeContractTarget } from "./types";

export function updatesCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("updates", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[updates] status never throws and is not behind while the latest is unknown", async () => {
      const status = await target.core.updates.status();
      expect(typeof status.current).toBe("string");
      expect(status.latest).toBeNull();
      expect(status.checkedAt).toBeNull();
      expect(status.behind).toBe(false);
    });

    test("[updates] refresh keeps the last good value and never rejects when the registry is unreachable", async () => {
      const status = await target.core.updates.refresh();
      expect(status.latest).toBeNull();
      expect(status.behind).toBe(false);
    });
  });
}
