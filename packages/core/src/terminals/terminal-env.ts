import { delimiter, join } from "node:path";

const ALLOWED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TMPDIR",
  "SSH_AUTH_SOCK",
  "EDITOR",
  "VISUAL",
  "DISPLAY",
]);
const ALLOWED_PREFIXES = ["LC_", "XDG_"];

const isAllowed = (name: string) =>
  ALLOWED.has(name) || ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix));

/** The whole environment of a terminal shell: an allow-list of tau's, never a token or secret. */
export function terminalEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  home: string,
  conversationId: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && isAllowed(name)) env[name] = value;
  }
  env.SHELL = env.SHELL || "/bin/sh";
  env.PATH = [join(home, "bin"), env.PATH ?? ""].filter(Boolean).join(delimiter);
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TAU_HOME = home;
  env.TAU_THREAD_ID = conversationId;
  return env;
}
