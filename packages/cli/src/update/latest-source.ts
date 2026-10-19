import { spawnCommand } from "./command-runner";
import { fetchLatestVersion } from "./latest-version";

/**
 * Where core learns the latest published version. `TAU_FAKE_LATEST` is a test hook (e2e): its value is the
 * answer, so no npm runs.
 */
export function latestVersionSource(env: NodeJS.ProcessEnv = process.env): () => Promise<string> {
  const fake = env.TAU_FAKE_LATEST;
  if (fake) return async () => fake;
  return () => fetchLatestVersion(spawnCommand, process.execPath);
}
