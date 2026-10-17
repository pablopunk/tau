import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

export const LOG_POLL_MS = 1500;
export const LOG_TAIL_LINES = 200;

export const useLiveProcessLogs = (processId: string, live: boolean) =>
  useQuery({
    queryKey: queryKeys.processLogs(processId, LOG_TAIL_LINES),
    queryFn: () => api.processes.logs(processId, LOG_TAIL_LINES),
    refetchInterval: live ? LOG_POLL_MS : false,
  });
