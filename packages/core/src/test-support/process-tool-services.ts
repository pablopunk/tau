import { join } from "node:path";
import { createToolServicesRef } from "../harness/tools/tool-file";
import { createProcessService } from "../processes/process-service";

/** Tool services with only the process service: what the `bash` tool needs. */
export function processToolServices(directory: string) {
  const services = createToolServicesRef();
  const processes = createProcessService({
    home: join(directory, "home"),
    emitChange: () => {},
    stopGraceMs: 300,
  });
  services.set({ processes } as never);
  return services;
}
