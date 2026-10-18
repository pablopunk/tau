import { isAppError } from "@tau/protocol";

export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
