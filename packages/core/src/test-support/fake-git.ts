import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCRIPT = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "git version 2.0.0"; exit 0; fi
echo "$@" > "$FAKE_GIT_DIR/args"
sleep 600 &
echo $! > "$FAKE_GIT_DIR/sleeper.pid"
echo $$ > "$FAKE_GIT_DIR/git.pid"
wait
`;

export interface FakeGit {
  /** A directory to put first on PATH. */
  readonly bin: string;
  readonly stateDir: string;
  /** An environment where `git clone` hangs until it is killed. */
  env(base: Readonly<Record<string, string | undefined>>): Record<string, string | undefined>;
}

/** A `git` that answers `--version` and hangs on anything else, recording its pids and arguments. */
export async function installFakeGit(root: string): Promise<FakeGit> {
  const bin = join(root, "fake-bin");
  const stateDir = join(root, "fake-git-state");
  await mkdir(bin, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(bin, "git"), SCRIPT);
  await chmod(join(bin, "git"), 0o755);
  return {
    bin,
    stateDir,
    env: (base) => ({ ...base, PATH: `${bin}:${base.PATH ?? ""}`, FAKE_GIT_DIR: stateDir }),
  };
}

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
