export interface AllowList {
  readonly hosts: ReadonlySet<string>;
  readonly origins: ReadonlySet<string>;
}

const LOCAL_NAMES = ["127.0.0.1", "localhost"] as const;

export function allowListForPort(port: number): AllowList {
  return {
    hosts: new Set(LOCAL_NAMES.map((name) => `${name}:${port}`)),
    origins: new Set(LOCAL_NAMES.map((name) => `http://${name}:${port}`)),
  };
}

export function isAllowedHost(list: AllowList, host: string | undefined): boolean {
  return host !== undefined && list.hosts.has(host.toLowerCase());
}

export function isAllowedOrigin(list: AllowList, origin: string | undefined): boolean {
  return origin !== undefined && list.origins.has(origin.toLowerCase());
}
