import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface ServiceNames {
  readonly launchdLabel: string;
  readonly systemdUnit: string;
  readonly taskName: string;
}

const hashOf = (home: string) => createHash("sha256").update(resolve(home)).digest("hex").slice(0, 8);

/** The default home keeps the plain names; any other home gets its own, so dev homes never replace the user's service. */
export function serviceNames(home: string, defaultHome: string): ServiceNames {
  if (resolve(home) === resolve(defaultHome)) {
    return { launchdLabel: "dev.tau.server", systemdUnit: "tau.service", taskName: "tau" };
  }
  const hash = hashOf(home);
  return {
    launchdLabel: `dev.tau.server.${hash}`,
    systemdUnit: `tau-${hash}.service`,
    taskName: `tau-${hash}`,
  };
}
