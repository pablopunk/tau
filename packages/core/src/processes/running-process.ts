import { type ChildProcess, spawn } from "node:child_process";
import type { ProcessInfo } from "@tau/protocol";
import { extractLocalUrls } from "./local-urls";
import { type LogFile, openLogFile } from "./log-file";
import { createLogTail, type LogTail } from "./log-tail";

export interface RunningProcess {
  info: ProcessInfo;
  readonly pid: number;
  readonly tail: LogTail;
  readonly exited: Promise<void>;
  stopRequested: boolean;
}

export interface SpawnRequest {
  readonly info: ProcessInfo;
  readonly cwd: string;
  readonly logPath: string;
  readonly onUrls: () => void;
  readonly onExit: () => void;
}

export function spawnRunning(request: SpawnRequest): RunningProcess {
  const child = spawn("/bin/sh", ["-c", request.info.command], {
    cwd: request.cwd,
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
  pipeOutput(child, running, log, request.onUrls);
  const exited = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      running.tail.append(`${error.message}\n`);
      settle(running, null);
      resolve();
    });
    child.once("exit", (code) => {
      settle(running, code);
      resolve();
    });
    child.once("close", () => void log.close());
  });
  return Object.assign(running, { exited: exited.then(request.onExit) });
}

function pipeOutput(child: ChildProcess, running: RunningProcess, log: LogFile, onUrls: () => void) {
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    running.tail.append(text);
    log.append(text);
    if (addUrls(running, text)) onUrls();
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
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
