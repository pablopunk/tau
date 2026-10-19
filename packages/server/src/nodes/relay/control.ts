import {
  CAPABILITY_ANNOUNCE,
  type Core,
  EXPEL_SYNC_TIMEOUT_MS,
  type ExpelFrame,
  type ExpelOutcome,
  type LinkFrame,
} from "@tau/protocol";
import type { LinkRegistry, RegisteredLink } from "../link-registry";
import type { Announcer } from "./announce";
import type { Closers } from "./closers";
import { flood } from "./flood";
import { POLICY, REFUSAL_REASONS } from "./refusals";

const REMOVED = 4003;

/** Cuts the link to `target` (bye first) and every stream that is its, or from it. */
export function cutNode(registry: LinkRegistry, closers: Closers, target: string): void {
  registry.linkOf(target)?.close(REMOVED, "node removed", true);
  closers.closeWhere(
    (closer) => closer.origin === target || closer.first === target,
    POLICY,
    REFUSAL_REASONS.node_removed,
  );
}

/** This node was expelled: every link and relayed stream is cut, the group no longer carries it. */
export function cutEverything(registry: LinkRegistry, closers: Closers): void {
  for (const link of registry.links()) link.close(REMOVED, "node removed", true);
  closers.closeWhere(() => true, POLICY, REFUSAL_REASONS.node_removed);
}

export const expelTarget = (frame: ExpelFrame): string => frame.payload.split("|")[1] ?? "";

/** The `announce`, `expel`, `expel-ack` and `expel-sync` frames: handed to `core.nodes.group`, flooded as it says. */
export function createControl(deps: {
  core: Core;
  registry: LinkRegistry;
  announcer: Announcer;
  closers: Closers;
}) {
  const { core, registry } = deps;
  const group = () => core.nodes.group;
  const syncTimers = new Map<string, NodeJS.Timeout>();

  const stopTimer = (nodeId: string) => {
    const timer = syncTimers.get(nodeId);
    if (timer) clearTimeout(timer);
    syncTimers.delete(nodeId);
  };

  async function afterExpel(outcome: ExpelOutcome, frame: ExpelFrame, from: RegisteredLink): Promise<void> {
    if (outcome.reflood) await flood(registry, frame, from.nodeId);
    if (outcome.ack) await flood(registry, outcome.ack);
    if (!outcome.fresh) return;
    if (outcome.selfExpelled) cutEverything(registry, deps.closers);
    else if (outcome.target) cutNode(registry, deps.closers, outcome.target);
  }

  async function handle(link: RegisteredLink, frame: LinkFrame): Promise<void> {
    switch (frame.type) {
      case "announce": {
        const outcome = await group().acceptAnnounce(frame, link.nodeId);
        if (outcome.accepted && outcome.forwardTtl !== undefined)
          await flood(registry, { ...frame, ttl: outcome.forwardTtl }, link.nodeId);
        return;
      }
      case "expel":
        return afterExpel(await group().acceptExpel(frame, link.nodeId), frame, link);
      case "expel-ack": {
        const outcome = await group().acceptAck(frame, link.nodeId);
        if (outcome.reflood) await flood(registry, frame, link.nodeId);
        return;
      }
      case "expel-sync": {
        const outcomes = await group().acceptExpelSet(frame.expels, link.nodeId);
        stopTimer(link.nodeId);
        for (const [index, outcome] of outcomes.entries())
          await afterExpel(outcome, frame.expels[index] as ExpelFrame, link);
        return deps.announcer.sendTo(link);
      }
      default:
        return;
    }
  }

  return {
    established(link: RegisteredLink): void {
      if (!link.capabilities.includes(CAPABILITY_ANNOUNCE)) return;
      group().linkUp(link.nodeId);
      const timer = setTimeout(() => {
        syncTimers.delete(link.nodeId);
        group().markUnsynced(link.nodeId);
        deps.announcer.schedule();
      }, EXPEL_SYNC_TIMEOUT_MS);
      timer.unref();
      syncTimers.set(link.nodeId, timer);
      void group()
        .expelSet()
        .then((expels) => link.sendFrame({ type: "expel-sync", expels }))
        .then(() => deps.announcer.sendTo(link))
        .catch(() => undefined);
    },
    closed(link: RegisteredLink): void {
      stopTimer(link.nodeId);
      if (!link.capabilities.includes(CAPABILITY_ANNOUNCE)) return;
      group().linkDown(link.nodeId);
      deps.announcer.schedule();
    },
    control(link: RegisteredLink, frame: LinkFrame): void {
      if (!link.capabilities.includes(CAPABILITY_ANNOUNCE)) return;
      handle(link, frame).catch(() => undefined);
    },
    stop(): void {
      for (const nodeId of [...syncTimers.keys()]) stopTimer(nodeId);
    },
  };
}
