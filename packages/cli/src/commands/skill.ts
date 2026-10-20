import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compiled, versionDir } from "../runtime/install-paths";
import { type CommandEnv, processEnv } from "./command-env";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** Built package (`dist/skills/builtin/tau` next to `dist/bin.js`), then the core source tree. */
const DEV_SKILL_PATHS = [
  here("./skills/builtin/tau/SKILL.md"),
  here("../../core/src/skills/builtin/tau/SKILL.md"),
  here("../../../core/src/skills/builtin/tau/SKILL.md"),
];

/** A compiled binary reads `<versionDir>/skills/tau/SKILL.md`. */
const skillPaths = (): string[] =>
  compiled() ? [join(versionDir(), "skills", "tau", "SKILL.md")] : DEV_SKILL_PATHS;

const MISSING_MESSAGE =
  "The tau skill is not bundled in this build. Run `tau --help`: output is JSON, and `--wait` replaces polling.";

async function firstReadable(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      return await readFile(path, "utf8");
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export async function printSkill(env: CommandEnv): Promise<void> {
  const paths = env.skillPaths.length > 0 ? env.skillPaths : skillPaths();
  env.stdout((await firstReadable(paths)) ?? MISSING_MESSAGE);
}

/** `tau skill`: print the bundled SKILL.md. */
export async function runSkill(_argv: readonly string[]): Promise<void> {
  await printSkill(processEnv());
}
