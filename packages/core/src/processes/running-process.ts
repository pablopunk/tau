import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import { StringDecoder } from "node:string_decoder";
import type { ProcessInfo } from "@tau/protocol";
import { createLineSplitter } from "./line-splitter";
import { extractLocalUrls } from "./local-urls";
import { type LogFile, openLogFile } from "./log-file";
import { createLogTail, type LogTail, lastLines } from "./log-tail";

export interface RunningProcess {
  info: ProcessInfo;
  readonly pid: number;
  readonly tail: LogTail;
  readonly exited: Promise<void>;
  stopRequested: boolean;
  /** What a shell reports: the exit code, or 128 plus the signal number. Unset when the command never started. */
  shellStatus?: number;
}

export interface SpawnRequest {
  readonly info: ProcessInfo;
  readonly cwd: string;
  readonly logPath: string;
  readonly onUrls: () => void;
  readonly onExit: (info: ProcessInfo, details: ExitDetails) => void;
  readonly onLine?: (stream: OutputStream, line: string) => void;
  /** Every chunk of output as it arrives, both streams. */
  readonly onChunk?: (text: string) => void;
  /** Default `/bin/sh`. */
  readonly shell?: string;
  /** Added to the environment of this process. */
  readonly env?: Readonly<Record<string, string>>;
}

export type OutputStream = "stdout" | "stderr";

export const EXIT_TAIL_LINES = 20;

export interface ExitDetails {
  readonly exitCode: number | null;
  readonly stopRequested: boolean;
  readonly logTail: string;
}

export function spawnRunning(request: SpawnRequest): RunningProcess {
  const child = spawn(request.shell ?? "/bin/sh", ["-c", request.info.command], {
    cwd: request.cwd,
    ...(request.env === undefined ? {} : { env: { ...process.env, ...request.env } }),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = openLogFile(request.logPath);
  const running: RunningProcess = {
    info: request.info,
    pid: child.pid ?? 0,
    tail: createLogTail(),
    stopRequested: false,
    exited: Promise.resolve(),
  };
  const splitters = pipeOutput(child, running, log, request);
  const finish = (code: number | null, signal: NodeJS.Signals | null = null) => {
    for (const splitter of splitters) splitter.flush();
    settle(running, code);
    const status = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : undefined);
    if (status !== undefined) running.shellStatus = status;
    return {
      exitCode: code,
      stopRequested: running.stopRequested,
      logTail: lastLines(running.tail.text(), EXIT_TAIL_LINES),
    };
  };
  let details: ExitDetails | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      const message = `${error.message}\n`;
      running.tail.append(message);
      log.append(message);
      request.onChunk?.(message);
      details = finish(null);
      resolve();
    });
    child.once("exit", (code, signal) => {
      details ??= finish(code, signal);
      resolve();
    });
    child.once("close", () => void log.close());
  });
  return Object.assign(running, {
    exited: exited.then(() => request.onExit(running.info, details as ExitDetails)),
  });
}

function pipeOutput(child: ChildProcess, running: RunningProcess, log: LogFile, request: SpawnRequest) {
  const splitterFor = (stream: OutputStream) => createLineSplitter((line) => request.onLine?.(stream, line));
  const stdout = splitterFor("stdout");
  const stderr = splitterFor("stderr");
  const onChunk = (splitter: ReturnType<typeof splitterFor>) => {
    const decoder = new StringDecoder("utf8");
    return (chunk: Buffer) => handle(decoder.write(chunk), splitter);
  };
  const handle = (text: string, splitter: ReturnType<typeof splitterFor>) => {
    if (text === "") return;
    running.tail.append(text);
    log.append(text);
    if (addUrls(running, text)) request.onUrls();
    request.onChunk?.(text);
    splitter.push(text);
  };
  child.stdout?.on("data", onChunk(stdout));
  child.stderr?.on("data", onChunk(stderr));
  return [stdout, stderr];
}

function addUrls(running: RunningProcess, text: string): boolean {
  const fresh = extractLocalUrls(text).filter((url) => !running.info.urls.includes(url));
  if (fresh.length === 0) return false;
  running.info = { ...running.info, urls: [...new Set([...running.info.urls, ...fresh])] };
  return true;
}

function settle(running: RunningProcess, code: number | null) {
  const killed = running.stopRequested || code === null;
  running.info = { ...running.info, state: killed ? "killed" : "exited", exitCode: killed ? null : code };
}
