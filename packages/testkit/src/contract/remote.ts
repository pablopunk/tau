import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function remoteCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("remote", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[remote] starts off, turns on with a stable https URL and announces it", async () => {
      const { core } = target;
      expect(await core.remote.status()).toMatchObject({ state: "off", url: null });
      const { changes, stop } = collectChanges(core);
      const on = await core.remote.enable();
      stop();
      expect(["starting", "online"]).toContain(on.state);
      expect((await core.settings.get()).remote).toEqual({ enabled: true });
      expect(changes).toContainEqual({ resource: "remote" });
    });

    test("[remote] turning it off clears the URL and every linked device", async () => {
      const { core } = target;
      await core.remote.enable();
      const minted = await core.access.mintPairing({ kind: "device" });
      const device = await core.access.redeemPairing({
        code: minted.code,
        deviceName: "Phone",
        peer: "203.0.113.7",
      });
      const off = await core.remote.disable();
      expect(off).toMatchObject({ state: "off", url: null });
      expect(await core.access.verifyDevice(device.secret)).toBeUndefined();
      expect((await core.settings.get()).remote).toEqual({ enabled: false });
    });

    test("[remote] a new URL is refused unless the tunnel has been offline for ten minutes", async () => {
      const { core } = target;
      await core.remote.enable();
      await rejectsWithCode(core.remote.recreate(), "invalid_request");
    });
  });
}
