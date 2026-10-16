import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = 4399;
const ROOT_VARIABLE = "PI_EVERYWHERE_E2E_ROOT";

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "E2E",
  GIT_AUTHOR_EMAIL: "e2e@example.com",
  GIT_COMMITTER_NAME: "E2E",
  GIT_COMMITTER_EMAIL: "e2e@example.com",
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: { ...process.env, ...GIT_IDENTITY }, stdio: "ignore" });

function createBareRepository(path: string, scratch: string) {
  mkdirSync(scratch);
  git(scratch, "init", "-q", "-b", "main");
  writeFileSync(join(scratch, "README.md"), "# e2e\n");
  git(scratch, "add", ".");
  git(scratch, "commit", "-q", "-m", "first");
  git(scratch, "clone", "-q", "--bare", scratch, path);
}

/** Playwright loads the config in every worker, so the temp root is created once and shared through the environment. */
export function e2eRoot(): string {
  const existing = process.env[ROOT_VARIABLE];
  if (existing) return existing;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-everywhere-e2e-")));
  mkdirSync(join(root, "home"));
  createBareRepository(join(root, "remote.git"), join(root, "scratch"));
  process.env[ROOT_VARIABLE] = root;
  return root;
}

/** The user's HOME: the Home project folder, where the agent writes files. */
export const homeDir = () => join(e2eRoot(), "home");
export const stateDir = () => join(e2eRoot(), "state");
export const bareRepository = () => join(e2eRoot(), "remote.git");
export const tokenFile = () => join(stateDir(), "token");

export const serverEnvironment = () => ({
  ...GIT_IDENTITY,
  HOME: homeDir(),
  OPENROUTER_API_KEY: "",
  PI_EVERYWHERE_ALLOW_FILE_CLONES: "1",
});
