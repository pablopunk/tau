import { type Device, type MintedPairing, PAIRING_TTL_MS } from "@tau/protocol";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/error-message";
import { useDevices, useMintPairing } from "@/lib/queries";

const TICK_MS = 1000;

/** The device that redeemed this code: a non-machine device created after the code was minted. */
export function linkedDevice(
  devices: readonly Device[] | undefined,
  pairing: MintedPairing | null,
): Device | null {
  if (!pairing || !devices) return null;
  const mintedAt = pairing.expiresAt - PAIRING_TTL_MS;
  return devices.find((device) => device.kind !== "machine" && device.createdAt >= mintedAt) ?? null;
}

/** Mints a code while `active`, counts down to its expiry and notices the device that links. */
export function usePairing(active: boolean) {
  const mint = useMintPairing();
  const devices = useDevices().data;
  const [pairing, setPairing] = useState<MintedPairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { mutateAsync } = mint;

  const create = useCallback(async () => {
    setError(null);
    setPairing(null);
    try {
      setPairing(await mutateAsync({ kind: "device" }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [mutateAsync]);

  useEffect(() => {
    if (active) void create();
    else setPairing(null);
  }, [active, create]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  const linked = linkedDevice(devices, pairing);
  const msLeft = pairing ? Math.max(0, pairing.expiresAt - now) : 0;
  return { pairing, error, linked, msLeft, expired: pairing !== null && !linked && msLeft === 0, create };
}
