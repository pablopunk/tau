import { readCliVersion } from "../../claude-cli/detect/claude-cli-version";

type Environment = Readonly<Record<string, string | undefined>>;

/** Local only: `TAU_CLAUDE_PATH`, else `claude` on the `PATH`. The SDK's bundled binary never counts as an install. */
export const isClaudeCodeInstalled = async (env: Environment): Promise<boolean> =>
  (await readCliVersion(env)) !== null;
