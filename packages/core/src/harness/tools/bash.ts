import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { defineTool } from "@earendil-works/pi-durable";
import type { BashExecution } from "@earendil-works/pi-durable/tools";
import { Type } from "typebox";
import { indexEntryOfCall, isGoverned } from "../../processes/governor/governed";
import { stopMessage } from "../../processes/governor/governor-text";
import type { ForegroundOutcome, ForegroundRun } from "../../processes/process-types";
import type { ToolServicesRef } from "./tool-file";

/** The tool default; bang commands reuse it as their fixed kill timeout. */
export const DEFAULT_TIMEOUT_SECONDS = 120;
export const MAX_TIMEOUT_SECONDS = 600;
const MAX_LINES = 2000;
const MAX_KB = 50;

const BashParameters = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default 120, maximum 600)" })),
});

const BashStructuredOutput = Type.Object({
  output: Type.String({ description: "Combined stdout and stderr: the retained tail, as the model sees it" }),
  truncated: Type.Boolean({ description: "Whether earlier output was dropped" }),
  fullOutputPath: Type.Optional(
    Type.String({ description: "File with the complete output, when it was kept" }),
  ),
  exitCode: Type.Optional(Type.Number({ description: "Absent while the command runs on in the background" })),
  processId: Type.Optional(Type.String({ description: "The background process the command became" })),
});

export type PrepareBash = (execution: BashExecution, conversationId: string) => void;

export interface TauBashOptions {
  readonly services: ToolServicesRef;
  readonly prepare: PrepareBash;
}

const FALLBACK_SHELL = "/bin/sh";

let resolvedBash: string | undefined;

function findBash(): string {
  if (existsSync("/bin/bash")) return "/bin/bash";
  const found = spawnSync("which", ["bash"], { encoding: "utf8" }).stdout.trim();
  return found || FALLBACK_SHELL;
}

/** `/bin/bash` where there is one, else the first `bash` on the PATH, else `sh`. */
export function bashPath(): string {
  resolvedBash ??= findBash();
  return resolvedBash;
}

async function requireDirectory(cwd: string) {
  const info = await stat(cwd).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`);
}

function validateTimeout(timeout: number | undefined) {
  if (timeout === undefined) return;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }
  if (timeout > MAX_TIMEOUT_SECONDS)
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
}

export const backgroundedText = (processId: string) =>
  `The user moved this command to the background; it keeps running as process ${processId}. ` +
  "You will be told when it exits. Read its output with process_logs, or end it with process_stop.";

/** What a caller does to the wait: end it by a time limit or by an abort. The time limit starts at spawn. */
function guard(run: ForegroundRun, timeout: number | undefined, abortSignal: AbortSignal | undefined) {
  let timedOut = false;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopForAbort = () => void run.stop("user");
  if (timeout !== undefined) {
    void run.admitted.then(() => {
      if (released) return;
      timer = setTimeout(() => {
        timedOut = true;
        void run.stop("timeout");
      }, timeout * 1000);
    });
  }
  if (abortSignal?.aborted) stopForAbort();
  abortSignal?.addEventListener("abort", stopForAbort, { once: true });
  return {
    timedOut: () => timedOut,
    release() {
      released = true;
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener("abort", stopForAbort);
    },
  };
}

/**
 * The `bash` tool, run through the process service so that, while it runs, the user can send the very same process to
 * the background: the call then returns at once and the command lives on, announced when it exits.
 */
export const createTauBashTool = ({ services, prepare }: TauBashOptions) =>
  defineTool({
    name: "bash",
    description: `Execute a bash command in the current working directory. Returns combined stdout and stderr. Output is truncated to last ${MAX_LINES} lines or ${MAX_KB}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters: BashParameters,
    structuredOutputSchema: BashStructuredOutput,
    outputLimits: { retain: "tail" },
    async execute({ command, timeout }, api, context) {
      validateTimeout(timeout);
      const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_SECONDS;
      const cwd = api.env?.cwd ?? process.cwd();
      await requireDirectory(cwd);
      const execution: BashExecution = { command, cwd, env: {}, inheritEnv: true };
      const conversationId = String(api.conversationId);
      prepare(execution, conversationId);
      const processes = services.current().processes;
      let waiting = true;
      const settings = processes.resourceSettings();
      const governed = await isGoverned(settings, indexEntryOfCall(api, context));
      const run = await processes.runForeground({
        conversationId,
        callId: api.callId,
        cwd: execution.cwd,
        command: execution.command,
        env: execution.env,
        shell: bashPath(),
        ...(governed && { governed }),
        // A command's stragglers can write after the call settled; the call no longer takes output then.
        onOutput: (text) => {
          if (!waiting) return;
          try {
            api.output(text);
          } catch {
            waiting = false;
          }
        },
      });
      const watch = guard(run, effectiveTimeout, context.abortSignal);
      let handedOver = false;
      let keepLog = false;
      try {
        let outcome: ForegroundOutcome;
        try {
          outcome = await run.outcome;
        } finally {
          watch.release();
          waiting = false;
        }
        const retained = api.retainedOutput();
        keepLog = retained.truncated;
        if (outcome.kind === "background") {
          handedOver = true;
          const text = backgroundedText(outcome.info.id);
          return {
            output: [{ type: "text", text: retained.text ? `${retained.text}\n\n${text}` : text }],
            structuredOutput: {
              output: retained.text,
              truncated: retained.truncated,
              processId: outcome.info.id,
            },
            details: { processId: outcome.info.id, backgrounded: true },
          };
        }
        const timeoutText = `Command timed out after ${effectiveTimeout} seconds`;
        if (outcome.stopReason === "memory") {
          throw new Error(stopMessage("memory", settings.memoryLimitMb, timeoutText));
        }
        if (watch.timedOut()) throw new Error(timeoutText);
        if (outcome.stopRequested) {
          throw new Error(stopMessage(outcome.stopReason ?? "user", settings.memoryLimitMb, timeoutText));
        }
        const exitCode = outcome.exitCode ?? 1;
        const structuredOutput = {
          output: retained.text,
          truncated: retained.truncated,
          ...(retained.truncated && { fullOutputPath: run.logPath }),
          exitCode,
        };
        if (retained.truncated) {
          api.diagnostic({ severity: "info", code: "full_output", message: `Full output: ${run.logPath}` });
        }
        if (exitCode === 0) return { structuredOutput };
        return {
          structuredOutput,
          isError: true,
          diagnostics: [
            { severity: "error", code: "exit_code", message: `Command exited with code ${exitCode}` },
          ],
        };
      } finally {
        if (!handedOver) await run.release(keepLog);
      }
    },
  });
