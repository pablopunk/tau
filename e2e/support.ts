import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = 4399;
const ROOT_VARIABLE = "PI_EVERYWHERE_E2E_ROOT";

/** Playwright loads the config in every worker, so the temp root is created once and shared through the environment. */
export function e2eRoot(): string {
  const existing = process.env[ROOT_VARIABLE];
  if (existing) return existing;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-everywhere-e2e-")));
  mkdirSync(join(root, "project"));
  process.env[ROOT_VARIABLE] = root;
  return root;
}

export const homeDir = () => join(e2eRoot(), "home");
export const projectDir = () => join(e2eRoot(), "project");
export const tokenFile = () => join(homeDir(), "token");
