import { NODE_LINK_PATH } from "@tau/protocol";

/** `https://host` dials `wss://host/api/nodes/link`; a loopback node `http://127.0.0.1:<port>` dials `ws://`. */
export function linkUrlOf(peerUrl: string): string {
  const url = new URL(peerUrl);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}${NODE_LINK_PATH}`;
}

export const originOf = (peerUrl: string): string => new URL(peerUrl).origin;
