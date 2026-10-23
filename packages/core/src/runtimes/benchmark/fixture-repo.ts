import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureRepoSpec } from "./config";

const GIT_IDENTITY = [
  "-c",
  "user.name=benchmark",
  "-c",
  "user.email=benchmark@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

const gitEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
});

const git = (cwd: string, args: readonly string[]): void => {
  execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, env: gitEnv(), stdio: "ignore" });
};

const contentOf = (index: number, bytes: number): string => {
  const line = `product-recovery/v1 seed=15158 file=${index}\n`;
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
};

/** The same files and bytes every time: no randomness, no timestamps in the content. */
export function createFixtureRepo(path: string, spec: FixtureRepoSpec): void {
  mkdirSync(path, { recursive: false });
  const perDirectory = Math.ceil(spec.files / spec.directories);
  for (let index = 0; index < spec.files; index += 1) {
    const directory = join(path, `dir-${Math.floor(index / perDirectory)}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `file-${index}.txt`), contentOf(index, spec.bytesPerFile));
  }
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["config", "core.hooksPath", "/dev/null"]);
  git(path, ["config", "core.attributesFile", "/dev/null"]);
  git(path, ["add", "-A"]);
  git(path, ["commit", "-q", "-m", "synthetic fixture"]);
}

export const copyFixtureRepo = (from: string, to: string): void => cpSync(from, to, { recursive: true });
