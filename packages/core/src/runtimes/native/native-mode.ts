import { AppError } from "@tau/protocol";
import { readFileIfPresent } from "../../home/atomic-write";
import { runtimeFormatPath } from "../../home/runtime-format-file";

/** `retained`: new native work is refused, yet existing native threads are still reconciled, cancelled and read. */
export type NativeMode = "off" | "active" | "retained";

export const RETAINED_REASON =
  "Claude Code is not installed on this node; existing Claude Code threads are read-only";

export const retainedError = (): AppError => new AppError("invalid_request", RETAINED_REASON);

export async function nativeStateExistsIn(root: string): Promise<boolean> {
  return (await readFileIfPresent(runtimeFormatPath(root))) !== undefined;
}

export function nativeModeOf(facts: { creationEnabled: boolean; stateExists: boolean }): NativeMode {
  if (facts.creationEnabled) return "active";
  return facts.stateExists ? "retained" : "off";
}

export const refusingQuery = (): never => {
  throw retainedError();
};
