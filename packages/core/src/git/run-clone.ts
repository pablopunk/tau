import { spawn } from "node:child_process";

const STDERR_TAIL_BYTES = 4096;
export const CLONE_TIMEOUT_MS = 10 * 60_000;

export type CloneOutcome = { ok: true } | { ok: false; error: string };

export interface CloneRun {
  readonly done: Promise<CloneOutcome>;
  /** Kills the whole process group. */
  kill(): void;
}

export interface CloneOptions {
  readonly url: string;
  readonly directory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly allowFileClones: boolean;
  readonly timeoutMs?: number;
  readonly command?: string;
}

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

const protocolFlags = (allowFileClones: boolean) => [
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "protocol.ssh.allow=always",
  ...(allowFileClones ? ["-c", "protocol.file.allow=always"] : []),
];

const quietEnv = (env: CloneOptions["env"]) => ({
  ...env,
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  SSH_ASKPASS_REQUIRE: "never",
});

export function startClone(options: CloneOptions): CloneRun {
  const args = [
    ...protocolFlags(options.allowFileClones),
    "clone",
    "--no-recurse-submodules",
    "--",
    options.url,
    options.directory,
  ];
  const child = spawn(options.command ?? "git", args, {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: quietEnv(options.env),
  });
  let stderr = "";
  let stopReason: string | undefined;
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
  });
  const kill = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const timer = setTimeout(() => {
    stopReason = "Timed out after 10 minutes";
    kill();
  }, options.timeoutMs ?? CLONE_TIMEOUT_MS);
  const done = new Promise<CloneOutcome>((resolve) => {
    child.on("error", (error) => resolve({ ok: false, error: error.message }));
    child.on("close", (code) => {
      if (code === 0 && stopReason === undefined) return resolve({ ok: true });
      resolve({ ok: false, error: stopReason ?? lastLine(stderr) ?? "git clone failed" });
    });
  }).finally(() => clearTimeout(timer));
  return {
    done,
    kill() {
      stopReason ??= "Cancelled";
      kill();
    },
  };
}
