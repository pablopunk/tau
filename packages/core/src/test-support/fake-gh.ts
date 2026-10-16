import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type FakeGhStatus =
  | { state: "connected"; login: string; gitProtocol: "https" | "ssh"; tokenSource: string }
  | { state: "not_logged_in" }
  | { state: "error"; message: string };

/** One element of the JSON the real repos call projects with its `--jq`. */
export interface FakeGhRepo {
  full_name: string;
  private: boolean;
  pushed_at: string;
  clone_url: string;
  ssh_url: string;
  description: string | null;
}

export interface FakeGhConfig {
  status: FakeGhStatus;
  repos: FakeGhRepo[];
}

export const CONNECTED_AS_DEMO: FakeGhStatus = {
  state: "connected",
  login: "demo",
  gitProtocol: "https",
  tokenSource: "keyring",
};

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "fake-gh", "gh");

/** Where the fake `gh` script lives; copy or reference it from a directory put on PATH. */
export const fakeGhScriptPath = () => SCRIPT;

/**
 * Writes `<directory>/bin/gh` and `<directory>/gh-config.json`. Put `<directory>/bin` first on the PATH and set
 * `FAKE_GH_CONFIG` to the returned `configFile` (and `FAKE_GH_LOG` to record each argv as a JSON line).
 */
export function installFakeGh(directory: string, config: FakeGhConfig) {
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  copyFileSync(SCRIPT, join(bin, "gh"));
  chmodSync(join(bin, "gh"), 0o755);
  const configFile = join(directory, "gh-config.json");
  writeFileSync(configFile, JSON.stringify(config));
  return { bin, configFile };
}
