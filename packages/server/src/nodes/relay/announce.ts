import { ANNOUNCE_COALESCE_MS, ANNOUNCE_INTERVAL_MS, CAPABILITY_ANNOUNCE, type Core } from "@tau/protocol";
import type { LinkRegistry, RegisteredLink } from "../link-registry";
import { flood } from "./flood";

/** Our own announce: on a change (leading edge, then at most one per 2 s, trailing) and every 15 s. */
export function createAnnouncer(deps: { core: Core; registry: LinkRegistry; now: () => number }) {
  let last = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | undefined;
  let interval: NodeJS.Timeout | undefined;

  const sendAll = async (): Promise<void> => {
    last = deps.now();
    const frame = await deps.core.nodes.group.localAnnounce().catch(() => undefined);
    if (frame) await flood(deps.registry, frame);
  };
  const schedule = (): void => {
    if (timer) return;
    const wait = Math.max(0, last + ANNOUNCE_COALESCE_MS - deps.now());
    timer = setTimeout(() => {
      timer = undefined;
      void sendAll();
    }, wait);
    timer.unref();
  };
  return {
    schedule,
    async sendTo(link: RegisteredLink): Promise<void> {
      if (!link.capabilities.includes(CAPABILITY_ANNOUNCE)) return;
      const frame = await deps.core.nodes.group.localAnnounce().catch(() => undefined);
      if (frame) await link.sendFrame(frame);
    },
    start(): () => void {
      interval = setInterval(() => void sendAll(), ANNOUNCE_INTERVAL_MS);
      interval.unref();
      return () => {
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        timer = undefined;
      };
    },
  };
}
export type Announcer = ReturnType<typeof createAnnouncer>;
