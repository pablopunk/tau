import { join } from "node:path";
import type { CliCommand } from "../cli-entry";
import type { ServiceContext } from "./context";
import { type ServiceNames, serviceNames } from "./names";
import { captureServicePath } from "./path-capture";

export interface ServiceSpec {
  readonly names: ServiceNames;
  readonly home: string;
  readonly node: string;
  readonly entry: string;
  readonly path: string;
  /** Arguments after `node entry`. */
  readonly args: readonly string[];
}

export const serviceArgs = (home: string, isDefaultHome: boolean): string[] => [
  "serve",
  "--service",
  "--no-open",
  ...(isDefaultHome ? [] : ["--home", home]),
];

export function buildSpec(context: ServiceContext, cli: CliCommand, home: string): ServiceSpec {
  const names = serviceNames(home, context.defaultHome);
  return {
    names,
    home,
    node: cli.command,
    entry: cli.args[0] ?? "",
    path: captureServicePath(context.env.PATH ?? "", context.osHome),
    args: serviceArgs(home, names.launchdLabel === "dev.tau.server"),
  };
}

export const recordFileOf = (home: string) => join(home, "service.json");
export const pidFileOf = (home: string) => join(home, "service.pid");
export const wrapperOf = (home: string) => join(home, "bin", "tau-service.cmd");
