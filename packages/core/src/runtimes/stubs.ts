import type { WriterState } from "@tau/protocol";
import { AppError, RUNTIME_UNSUPPORTED_REASON, unsupportedCapabilities } from "@tau/protocol";
import type { RuntimeExecutor, RuntimeLifecyclePort, WorkspaceWriterPort } from "./types";

function executorDisabled(): AppError {
  return new AppError("forbidden", `Executor is unavailable: ${RUNTIME_UNSUPPORTED_REASON}`);
}

function rejectDisabled(): Promise<never> {
  return Promise.reject(executorDisabled());
}

async function* observeDisabled(): AsyncGenerator<never> {
  yield* [];
  throw executorDisabled();
}

export function createDisabledNativeExecutor(): RuntimeExecutor {
  return {
    executor: "claude-code",
    admit: rejectDisabled,
    inspect: rejectDisabled,
    observe: observeDisabled,
    cancel: rejectDisabled,
    reconcile: rejectDisabled,
    capabilities: async () => unsupportedCapabilities(RUNTIME_UNSUPPORTED_REASON),
  };
}

const UNKNOWN_WRITER: WriterState = "unknown";

export function createUnknownLifecyclePort(): RuntimeLifecyclePort {
  return { inspectWriter: async () => UNKNOWN_WRITER };
}

export function createUnknownWorkspaceWriterPort(): WorkspaceWriterPort {
  return {
    writersOf: async (workspaceKey) => [{ threadId: workspaceKey, state: UNKNOWN_WRITER }],
  };
}
