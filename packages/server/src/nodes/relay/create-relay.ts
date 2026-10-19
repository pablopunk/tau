import type { ExpelFrame } from "@tau/protocol";
import { createAnnouncer } from "./announce";
import { clockOffsetMs, skewedClock } from "./clock";
import { createClosers } from "./closers";
import { createControl, cutNode, expelTarget } from "./control";
import { flood } from "./flood";
import { createForwarder } from "./forward";
import type { LinkHub } from "./hub";
import { createOrigin } from "./origin";
import type { Relay, RelayDeps } from "./ports";
import { POLICY, REFUSAL_REASONS } from "./refusals";
import { createLocalVerifier } from "./verify-local";

/**
 * The relay of one server: routed frames in, joined streams out, and the announce/expel traffic of the group.
 * The link peers reach it through `registry.hub`; `start()` begins the timers and subscriptions.
 */
export function createRelay(deps: RelayDeps): Relay {
  const { core, registry } = deps;
  const now = skewedClock(deps.now, clockOffsetMs());
  const closers = createClosers();
  const announcer = createAnnouncer({ core, registry, now: deps.now });
  const control = createControl({ core, registry, announcer, closers });
  const forwarder = createForwarder({ core, registry, closers });
  const verifier = createLocalVerifier(core, now, now());
  const origin = createOrigin({ core, registry, now });

  const hub: LinkHub = {
    established: control.established,
    closed: control.closed,
    control: control.control,
    verifyLocal: (_link, ownNodeId, frame) => verifier.verify(frame, ownNodeId),
    forward: forwarder.forward,
    trackLocal(link, frame) {
      const id = frame.id;
      closers.add({
        origin: frame.origin ?? "",
        first: frame.trail?.[0] ?? frame.origin ?? "",
        alive: () => link.mux.streams.has(id),
        close(code, reason) {
          const stream = link.mux.streams.get(id);
          link.mux.sendControl({ type: "close", id, code, reason });
          link.mux.removeStream(id);
          stream?.onClose(code, reason);
        },
      });
    },
    reachable: origin.reachable,
    request: origin.request,
    openStream: origin.openStream,
  };
  registry.hub = hub;

  return {
    start() {
      if (!core.nodes?.group) return () => undefined;
      const stopTimer = announcer.start();
      const offTopology = core.nodes.group.onTopology(announcer.schedule);
      const offTombstone = core.nodes.group.onTombstone((target) =>
        closers.closeWhere(
          (closer) => closer.origin === target || closer.first === target,
          POLICY,
          REFUSAL_REASONS.node_removed,
        ),
      );
      return () => {
        stopTimer();
        offTopology();
        offTombstone();
        control.stop();
      };
    },
    async floodExpel(frame: ExpelFrame) {
      const target = expelTarget(frame);
      await flood(registry, frame);
      cutNode(registry, closers, target);
      await core.nodes.forget(target).catch(() => undefined);
    },
  };
}
