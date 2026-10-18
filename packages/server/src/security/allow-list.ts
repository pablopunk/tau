export interface AllowList {
  readonly localHosts: ReadonlySet<string>;
  readonly localOrigins: ReadonlySet<string>;
  /** The tunnel hostname without a port (an https `Host` has none), or `undefined` while remote is off. */
  tunnelHostname(): string | undefined;
  setTunnelHostname(hostname: string | undefined): void;
}

const LOCAL_NAMES = ["127.0.0.1", "localhost"] as const;

export function allowListForPort(port: number): AllowList {
  let tunnel: string | undefined;
  return {
    localHosts: new Set(LOCAL_NAMES.map((name) => `${name}:${port}`)),
    localOrigins: new Set(LOCAL_NAMES.map((name) => `http://${name}:${port}`)),
    tunnelHostname: () => tunnel,
    setTunnelHostname: (hostname) => {
      tunnel = hostname?.toLowerCase();
    },
  };
}

export function isAllowedLocalHost(list: AllowList, host: string | undefined): boolean {
  return host !== undefined && list.localHosts.has(host.toLowerCase());
}

export function isAllowedLocalOrigin(list: AllowList, origin: string | undefined): boolean {
  return origin !== undefined && list.localOrigins.has(origin.toLowerCase());
}

/** On a tagged socket the only Host is exactly the tunnel hostname. */
export function isTunnelHost(list: AllowList, host: string | undefined): boolean {
  const hostname = list.tunnelHostname();
  return hostname !== undefined && host?.toLowerCase() === hostname;
}

/** On a tagged socket the only Origin is `https://<hostname>`. */
export function isTunnelOrigin(list: AllowList, origin: string | undefined): boolean {
  const hostname = list.tunnelHostname();
  return hostname !== undefined && origin?.toLowerCase() === `https://${hostname}`;
}

/** The hostname of a tunnel URL, lowercased; `undefined` for no URL. */
export function hostnameOfUrl(url: string | null): string | undefined {
  return url === null ? undefined : new URL(url).hostname.toLowerCase();
}
