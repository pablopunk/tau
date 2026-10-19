import { spawnCommand } from "./command-runner";
import { fakeHooksAllowed } from "./fake-hooks";
import { fetchLatestVersion } from "./latest-version";

/**
 * Where core learns the latest published version. `TAU_FAKE_LATEST` is a test hook (e2e): its value is the
 * answer, so no npm runs. It is honoured only when `home` is under the temp dir.
 */
export function latestVersionSource(
  env: NodeJS.ProcessEnv = process.env,
  home: string | undefined = env.TAU_HOME,
): () => Promise<string> {
  const fake = env.TAU_FAKE_LATEST;
  if (fake && fakeHooksAllowed(home)) return async () => fake;
  return () => fetchLatestVersion(spawnCommand, process.execPath);
}
