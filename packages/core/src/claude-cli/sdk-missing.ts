export class ClaudeSdkMissingError extends Error {
  constructor() {
    super("The Claude Agent SDK is not installed.");
    this.name = "ClaudeSdkMissingError";
  }
}

export const isSdkMissing = (error: unknown): boolean => error instanceof ClaudeSdkMissingError;
