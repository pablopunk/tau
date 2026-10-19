import { NODE_LINK_PATH } from "@tau/protocol";

/** `https://host` dials `wss://host/api/nodes/link`; a loopback hub `http://127.0.0.1:<port>` dials `ws://`. */
export function linkUrlOf(hubUrl: string): string {
  const url = new URL(hubUrl);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}${NODE_LINK_PATH}`;
}

export const originOf = (hubUrl: string): string => new URL(hubUrl).origin;

/** The frame's `query` has no leading `?` (the hub splits the URL there); both forms are accepted. */
export function targetOf(path: string, query: string): string {
  const bare = query.startsWith("?") ? query.slice(1) : query;
  return bare === "" ? path : `${path}?${bare}`;
}
