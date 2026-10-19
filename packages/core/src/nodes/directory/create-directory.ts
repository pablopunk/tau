import type { NodeGroup } from "@tau/protocol";
import { notImplemented } from "../../not-implemented";
import { createDirectoryState } from "./directory-state";
import type { Directory } from "./ports";
import type { DirectoryDepsWithSelf } from "./sign-frames";

const reject = (what: string) => () => Promise.reject(notImplemented(what));
const unsubscribe = () => () => undefined;

/** Placeholder `NodeGroup`: inert (no routes, no tombstones) until owner E fills it. The link layer must not call it while `NODE_CAPABILITIES` is empty. */
export function createInertGroup(): NodeGroup {
  return {
    localAnnounce: reject("NodeGroup.localAnnounce"),
    linkUp: () => undefined,
    linkDown: () => undefined,
    acceptAnnounce: reject("NodeGroup.acceptAnnounce"),
    acceptExpel: reject("NodeGroup.acceptExpel"),
    acceptAck: reject("NodeGroup.acceptAck"),
    expelSet: async () => [],
    acceptExpelSet: reject("NodeGroup.acceptExpelSet"),
    markUnsynced: () => undefined,
    createExpel: reject("NodeGroup.createExpel"),
    route: () => undefined,
    isTombstoned: () => false,
    neighbours: () => [],
    onTopology: unsubscribe,
    onTombstone: unsubscribe,
    recordSkew: () => undefined,
  };
}

/** The `Directory` behind `Core.nodes`: announces, routes, tombstones and expels (see `directory-state.ts`). */
export function createDirectory(deps: DirectoryDepsWithSelf): Directory {
  return createDirectoryState(deps);
}
