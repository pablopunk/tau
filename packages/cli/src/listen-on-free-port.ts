const MAX_PORT_ATTEMPTS = 100;
const MAX_PORT = 65535;

function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE";
}

/** Tries `preferred`, then the next ports, until `start` succeeds. */
export async function listenOnFreePort<T>(
  preferred: number,
  start: (port: number) => Promise<T>,
): Promise<T> {
  const last = Math.min(preferred + MAX_PORT_ATTEMPTS - 1, MAX_PORT);
  for (let port = preferred; port <= last; port++) {
    try {
      return await start(port);
    } catch (error) {
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw new Error(`No free port between ${preferred} and ${last}`);
}
