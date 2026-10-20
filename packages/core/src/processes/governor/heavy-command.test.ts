import { describe, expect, it } from "vitest";
import { isHeavyCommand } from "./heavy-command";

describe("isHeavyCommand", () => {
  it.each([
    "pnpm test",
    "pnpm run build",
    "mise exec -- pnpm check",
    "pnpm -r test",
    "pnpm --filter @tau/core test",
    "FOO=1 vitest run",
    "time cargo build",
    "npx tsc --noEmit",
    "cd x && pnpm lint",
    "echo hi; go test ./...",
    "npm run e2e",
    "docker build .",
    "pnpm exec biome check .",
  ])("heavy: %s", (command) => expect(isHeavyCommand(command)).toBe(true));

  it.each([
    "ls -la",
    "vitest",
    "tsc -w",
    "jest --watchAll",
    "pnpm --filter x test:watch",
    "pnpm dev",
    "pnpm test --watch",
    "pnpm start",
    "git status",
    "pnpm install",
    "pnpm -w test", // known fail-open: -w reads as a watch flag
  ])("not heavy: %s", (command) => expect(isHeavyCommand(command)).toBe(false));
});
