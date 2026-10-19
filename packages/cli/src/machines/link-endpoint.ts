import { MACHINE_LINK_PATH } from "@tau/protocol";

/** `https://host` dials `wss://host/api/machines/link`; a loopback hub `http://127.0.0.1:<port>` dials `ws://`. */
export function linkUrlOf(hubUrl: string): string {
  const url = new URL(hubUrl);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}${MACHINE_LINK_PATH}`;
}

export const originOf = (hubUrl: string): string => new URL(hubUrl).origin;
