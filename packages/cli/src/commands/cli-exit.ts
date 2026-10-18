export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_TIMEOUT = 3;

/** A failure that ends the command with a message on stderr and an exit code. */
export class CliExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = "CliExit";
    this.exitCode = exitCode;
  }
}

export const usageError = (message: string): CliExit => new CliExit(EXIT_USAGE, message);
export const failure = (message: string): CliExit => new CliExit(EXIT_ERROR, message);

export const NOT_RUNNING_MESSAGE = "tau is not running. Run `tau` to start it.";
