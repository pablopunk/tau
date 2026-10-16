const HELPER_KEY = "credential.https://github.com.helper";

const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const isGithubHttps = (url: string) =>
  URL.canParse(url) && new URL(url).protocol === "https:" && new URL(url).hostname === "github.com";

/** Clears any stale helper, then lets git ask gh for the token; the app never sees it. */
export function credentialHelperArgs(url: string, ghPath: string | undefined, connected: boolean): string[] {
  if (!connected || ghPath === undefined || !isGithubHttps(url)) return [];
  return ["-c", `${HELPER_KEY}=`, "-c", `${HELPER_KEY}=!${shellQuote(ghPath)} auth git-credential`];
}
