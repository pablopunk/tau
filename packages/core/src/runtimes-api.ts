import { type Core, describeExecutors } from "@tau/protocol";
import type { NativeService } from "./runtimes/native/service";

export function createRuntimesApi(native: Pick<NativeService, "capabilities"> | undefined): Core["runtimes"] {
  return { list: async () => describeExecutors(native?.capabilities) };
}
