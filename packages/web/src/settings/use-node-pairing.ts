import { type MintedPairing, type Node, PAIRING_TTL_MS } from "@tau/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/error-message";
import { useMintPairing } from "@/lib/queries";
import { useNodes } from "@/nodes";

const TICK_MS = 1000;

/** The node that redeemed this code: one in the list that was not there when the code was minted. */
export function newNode(nodes: readonly Node[], knownIds: ReadonlySet<string>): Node | null {
  return nodes.find((node) => !knownIds.has(node.id)) ?? null;
}

/** The address a node must dial: the origin of the link, or this page when there is no public link. */
export function hubUrlOf(pairing: MintedPairing | null): string {
  if (pairing?.link) return new URL(pairing.link).origin;
  return window.location.origin;
}

/** Mints a node code while `active`, counts down to its expiry and notices the node that links. */
export function useNodePairing(active: boolean) {
  const mint = useMintPairing();
  const { nodes, isLoading } = useNodes();
  const [pairing, setPairing] = useState<MintedPairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const known = useRef<ReadonlySet<string>>(new Set());
  const latest = useRef(nodes);
  latest.current = nodes;
  const { mutateAsync } = mint;

  const create = useCallback(async () => {
    setError(null);
    setPairing(null);
    known.current = new Set(latest.current.map((node) => node.id));
    try {
      setPairing(await mutateAsync({ kind: "node" }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [mutateAsync]);

  const ready = !isLoading;
  useEffect(() => {
    if (!active) setPairing(null);
    else if (ready) void create();
  }, [active, ready, create]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  const linked = pairing ? newNode(nodes, known.current) : null;
  const msLeft = pairing ? Math.max(0, pairing.expiresAt - now) : 0;
  const minted = pairing ? pairing.expiresAt - PAIRING_TTL_MS : 0;
  return {
    pairing,
    error,
    linked,
    msLeft,
    minted,
    expired: pairing !== null && !linked && msLeft === 0,
    create,
  };
}
