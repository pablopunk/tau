/**
 * Owner C implements bare `tau`: install, repair, start, open the browser.
 * Until then it keeps today's behavior and serves in the foreground.
 */
export async function runBare(
  argv: readonly string[],
  serveInForeground: (argv: readonly string[]) => Promise<void>,
) {
  await serveInForeground(argv);
}
