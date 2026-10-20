import type { UpdaterPort } from "@tau/protocol";
import { cliEntry } from "../cli-entry";
import { realContext } from "../service/context";
import { cliVersion } from "../version";
import { installRootOfThisTau } from "./install-root";
import { releasePlatformOf } from "./platform";
import { createUpdater } from "./updater";

/** The updater of this process; runs the `systemctl --version` probe once, so await it before `createCore`. */
export async function createRealUpdater(home: string, version: string = cliVersion()): Promise<UpdaterPort> {
  return createUpdater({
    home,
    version,
    context: realContext(),
    cli: cliEntry(),
    installRoot: installRootOfThisTau(),
    platformKey: releasePlatformOf(),
    foreground: !process.argv.includes("--service"),
  });
}
