import { fakeHooksAllowed, releasesApiOf } from "./fake-hooks";
import { fetchLatestVersion, RELEASES_API } from "./latest-version";
import { releasePlatformOf } from "./platform";

/**
 * Where core learns the latest published version: the GitHub release for this platform. `TAU_FAKE_LATEST` is a
 * test hook (e2e): its value is the answer, so nothing is fetched. It is honoured only when `home` is under the
 * temp dir, like `TAU_RELEASES_API`.
 */
export function latestVersionSource(
  env: NodeJS.ProcessEnv = process.env,
  home: string | undefined = env.TAU_HOME,
): () => Promise<string> {
  const fake = env.TAU_FAKE_LATEST;
  if (fake && fakeHooksAllowed(home)) return async () => fake;
  const api = releasesApiOf(home, RELEASES_API, env);
  return () => fetchLatestVersion(releasePlatformOf(), fetch, api);
}
