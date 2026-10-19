import { realpathSync } from "node:fs";
import type { UpdaterPort } from "@tau/protocol";
import { cliEntry } from "../cli-entry";
import { realContext } from "../service/context";
import { cliVersion } from "../version";
import { createUpdater } from "./updater";

/** The updater of this process; runs the `systemctl --version` probe once, so await it before `createCore`. */
export async function createRealUpdater(home: string, version: string = cliVersion()): Promise<UpdaterPort> {
  const entry = process.argv[1] === undefined ? "" : realpathSync(process.argv[1]);
  return createUpdater({
    home,
    version,
    context: realContext(),
    cli: cliEntry(),
    entry,
    execPath: process.execPath,
    foreground: !process.argv.includes("--service"),
  });
}
