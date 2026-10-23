import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: { TAU_CLAUDE_PATH: "/nonexistent/claude-for-tests" },
  },
});
