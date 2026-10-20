import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCOPE_DIRECTORY = ["node_modules", "@anthropic-ai"];
const NATIVE_PACKAGE_PREFIX = "claude-agent-sdk-";

/** The native `claude` the bundled SDK runs (`claude-agent-sdk-<os>-<arch>[-musl]/claude`), or undefined when none ships. */
export function bundledClaudeBinary(sdkHome: string): string | undefined {
  const scope = join(sdkHome, ...SCOPE_DIRECTORY);
  const packages = existsSync(scope) ? readdirSync(scope) : [];
  return packages
    .filter((name) => name.startsWith(NATIVE_PACKAGE_PREFIX))
    .map((name) => join(scope, name, "claude"))
    .find((file) => existsSync(file));
}
