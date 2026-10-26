export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_TIMEOUT = 3;

/** A failure that ends the command with a message on stderr and an exit code. */
export class CliExit extends Error {
  readonly exitCode: number;

  reported = false;
  readonly code: string;
  readonly source: "protocol" | "cli";
  lifecycle: import("@tau/protocol").RuntimeLifecycle | null = null;
  observation: "response" | "thread-idle" | null = null;

  constructor(exitCode: number, message: string, code?: string, source: "protocol" | "cli" = "cli") {
    super(message);
    this.name = "CliExit";
    this.exitCode = exitCode;
    this.code = code ?? (exitCode === 2 ? "usage" : exitCode === 3 ? "wait_timeout" : "transport_error");
    this.source = source;
  }
}

export const usageError = (message: string): CliExit => new CliExit(EXIT_USAGE, message);
export const failure = (message: string): CliExit => new CliExit(EXIT_ERROR, message);

export const NOT_RUNNING_MESSAGE = "tau is not running. Run `tau` to start it.";
