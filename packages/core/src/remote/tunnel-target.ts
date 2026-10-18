/** Core is created before the server: the CLI fills this in once the tunnel listener is bound. */
export interface TunnelTargetRef {
  /** Resolves with `127.0.0.1:<port>` after `set`. */
  readonly get: () => Promise<string>;
  readonly set: (port: number) => void;
}

export function createTunnelTargetRef(): TunnelTargetRef {
  let resolve: (target: string) => void = () => undefined;
  const target = new Promise<string>((done) => {
    resolve = done;
  });
  return { get: () => target, set: (port) => resolve(`127.0.0.1:${port}`) };
}
