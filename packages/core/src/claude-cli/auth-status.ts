import { execFile } from "node:child_process";
import type { ClaudeAuthStatus } from "./sdk-types";

const AUTH_STATUS_TIMEOUT_MS = 5_000;

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Keeps only the four fields tau may read: never the email, ids or tokens. */
export function parseAuthStatus(stdout: string): ClaudeAuthStatus {
  const raw: unknown = JSON.parse(stdout);
  if (typeof raw !== "object" || raw === null) throw new Error("claude auth status printed no object");
  const fields = raw as Record<string, unknown>;
  return {
    loggedIn: fields.loggedIn === true,
    authMethod: stringOrNull(fields.authMethod),
    subscriptionType: stringOrNull(fields.subscriptionType),
    orgName: stringOrNull(fields.orgName),
  };
}

const claudeBinary = (env: Readonly<Record<string, string | undefined>>): string =>
  env.TAU_CLAUDE_PATH ?? "claude";

/** A logged-out CLI exits 1 but still prints the JSON, so a non-zero exit with output is an answer. */
export function runAuthStatus(env: Readonly<Record<string, string | undefined>>): Promise<ClaudeAuthStatus> {
  return new Promise((resolve, reject) => {
    execFile(
      claudeBinary(env),
      ["auth", "status", "--json"],
      { timeout: AUTH_STATUS_TIMEOUT_MS, env: { ...env } },
      (error, stdout) => {
        if (stdout.trim() !== "") {
          try {
            resolve(parseAuthStatus(stdout));
          } catch (parseError) {
            reject(parseError);
          }
          return;
        }
        reject(error ?? new Error("claude auth status printed nothing"));
      },
    );
  });
}
