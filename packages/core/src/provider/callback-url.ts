export const CALLBACK_URL_PREFIX = "http://127.0.0.1:1455/auth/callback";

export function callbackUrlProblem(pasted: string): string | null {
  if (!URL.canParse(pasted)) return "Paste the full callback URL from the browser.";
  const url = new URL(pasted);
  const expected = new URL(CALLBACK_URL_PREFIX);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    return `The pasted callback URL must start with ${CALLBACK_URL_PREFIX}`;
  }
  return null;
}
