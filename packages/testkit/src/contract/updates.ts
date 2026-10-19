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

    test("[updates-job] status carries canUpdate, install and an idle job", async () => {
      const status = await target.core.updates.status();
      expect(typeof status.canUpdate).toBe("boolean");
      expect(["run", "manual", "none"]).toContain(status.install.mode);
      expect(status.job).toEqual({ state: "idle", target: null, error: null, logTail: null });
    });

    test("[updates-job] start for a version that is not the latest is update_unsupported", async () => {
      await expect(target.core.updates.start({ target: "99.0.0", force: false })).rejects.toMatchObject({
        code: "update_unsupported",
      });
    });
  });
}
