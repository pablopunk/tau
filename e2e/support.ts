import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONNECTED_AS_DEMO, type FakeGhRepo, installFakeGh } from "../packages/core/src/test-support/fake-gh";

export const PORT = 4399;
const ROOT_VARIABLE = "TAU_E2E_ROOT";

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "E2E",
  GIT_AUTHOR_EMAIL: "e2e@example.com",
  GIT_COMMITTER_NAME: "E2E",
  GIT_COMMITTER_EMAIL: "e2e@example.com",
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: { ...process.env, ...GIT_IDENTITY }, stdio: "ignore" });

const FAVICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

function createBareRepository(path: string, scratch: string) {
  mkdirSync(scratch);
  git(scratch, "init", "-q", "-b", "main");
  writeFileSync(join(scratch, "README.md"), "# e2e\n");
  writeFileSync(join(scratch, "favicon.png"), FAVICON_PNG);
  git(scratch, "add", ".");
  git(scratch, "commit", "-q", "-m", "first");
  git(scratch, "clone", "-q", "--bare", scratch, path);
}

export const WITH_COPY = "e2e/with-local-copy";
export const WITHOUT_COPY = "e2e/without-local-copy";

/** The repos the fake `gh` lists: each clones from its own local bare repository. */
export const fakeGhRepos = (withCopyBare: string, withoutCopyBare: string): FakeGhRepo[] =>
  [
    { full_name: WITH_COPY, bare: withCopyBare },
    { full_name: WITHOUT_COPY, bare: withoutCopyBare },
  ].map(({ full_name, bare }, index) => ({
    full_name,
    private: index === 1,
    pushed_at: new Date(Date.UTC(2026, 0, 2 - index)).toISOString(),
    clone_url: bare,
    ssh_url: bare,
    description: null,
  }));

function createWithCopyRepository(root: string) {
  const bare = join(root, "with-copy.git");
  createBareRepository(bare, join(root, "scratch-with-copy"));
  const projects = join(root, "state", "projects");
  mkdirSync(projects, { recursive: true });
  git(projects, "clone", "-q", bare, "with-copy");
  return bare;
}

function createDemoRepository(root: string) {
  const repo = join(root, "demo-repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# demo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
}

/** Playwright loads the config in every worker, so the temp root is created once and shared through the environment. */
export function e2eRoot(): string {
  const existing = process.env[ROOT_VARIABLE];
  if (existing) return existing;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-e2e-")));
  mkdirSync(join(root, "home"));
  createBareRepository(join(root, "remote.git"), join(root, "scratch"));
  createDemoRepository(root);
  const withoutCopy = join(root, "without-copy.git");
  createBareRepository(withoutCopy, join(root, "scratch-without-copy"));
  installFakeGh(join(root, "gh"), {
    status: CONNECTED_AS_DEMO,
    repos: fakeGhRepos(createWithCopyRepository(root), withoutCopy),
  });
  process.env[ROOT_VARIABLE] = root;
  return root;
}

/** The user's HOME: the Home project folder, where the agent writes files. */
export const homeDir = () => join(e2eRoot(), "home");
export const stateDir = () => join(e2eRoot(), "state");
export const demoRepository = () => join(e2eRoot(), "demo-repo");
export const bareRepository = () => join(e2eRoot(), "remote.git");
export const projectsDir = () => join(stateDir(), "projects");
export const tokenFile = () => join(stateDir(), "token");

export const fakeGhBin = () => join(e2eRoot(), "gh", "bin");

export const serverEnvironment = () => ({
  PATH: `${fakeGhBin()}:${process.env.PATH ?? ""}`,
  FAKE_GH_CONFIG: join(e2eRoot(), "gh", "gh-config.json"),
  ...GIT_IDENTITY,
  HOME: homeDir(),
  OPENROUTER_API_KEY: "",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  OPENCODE_API_KEY: "",
  TAU_ALLOW_FILE_CLONES: "1",
  TAU_FAKE_CLAUDE_CLI: "1",
  TAU_FAKE_REMOTE: "1",
});
