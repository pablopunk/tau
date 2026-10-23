import { type Core, describeExecutors, type RuntimeDescriptorList } from "@tau/protocol";
import { RETAINED_REASON } from "./runtimes/native/native-mode";
import type { NativeService } from "./runtimes/native/service";

type NativeFacts = Pick<NativeService, "capabilities" | "creationEnabled">;

const withRetainedReason = (list: RuntimeDescriptorList): RuntimeDescriptorList => ({
  executors: list.executors.map((item) =>
    item.executor === "claude-code" ? { ...item, reason: RETAINED_REASON } : item,
  ),
});

function describeNode(native: NativeFacts | undefined): RuntimeDescriptorList {
  if (!native) return describeExecutors(undefined);
  if (native.creationEnabled) return describeExecutors(native.capabilities);
  return withRetainedReason(describeExecutors(undefined));
}

export function createRuntimesApi(native: NativeFacts | undefined): Core["runtimes"] {
  return { list: async () => describeNode(native) };
}
