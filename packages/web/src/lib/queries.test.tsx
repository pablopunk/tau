import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes/node-context";
import type { Api } from "./api";
import {
  approvalsOptions,
  checkpointsOptions,
  goalOptions,
  processesOptions,
  queryKeys,
  timersOptions,
  useApprovals,
  useCheckpoints,
  useGoal,
  useProcesses,
  useTimers,
  useWorkspaceStatus,
  workspaceStatusOptions,
} from "./queries";

const conversationId = "thread-1";

function createApi() {
  const methods = {
    workspaces: { status: vi.fn().mockResolvedValue(null) },
    conversations: { checkpoints: vi.fn().mockResolvedValue([]) },
    processes: { list: vi.fn().mockResolvedValue([]) },
    timers: { list: vi.fn().mockResolvedValue([]) },
    approvals: { list: vi.fn().mockResolvedValue([]) },
    goals: { get: vi.fn().mockResolvedValue(null) },
  };
  return { api: methods as unknown as Api, methods };
}

function renderQuery(hook: () => unknown, api: Api) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <NodeApiProvider api={api}>{children}</NodeApiProvider>
    </QueryClientProvider>
  );
  renderHook(hook, { wrapper });
}

type ApiMethods = ReturnType<typeof createApi>["methods"];
type HookCase = {
  name: string;
  run: (id: string) => unknown;
  assertFetched: (methods: ApiMethods, id: string) => void;
};

const hookCases: HookCase[] = [
  {
    name: "workspace status",
    run: useWorkspaceStatus,
    assertFetched: (methods, id) =>
      expect(methods.workspaces.status).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
  },
  {
    name: "checkpoints",
    run: useCheckpoints,
    assertFetched: (methods, id) => expect(methods.conversations.checkpoints).toHaveBeenCalledWith(id),
  },
  {
    name: "processes",
    run: useProcesses,
    assertFetched: (methods, id) => expect(methods.processes.list).toHaveBeenCalledWith(id),
  },
  {
    name: "timers",
    run: useTimers,
    assertFetched: (methods, id) => expect(methods.timers.list).toHaveBeenCalledWith(id),
  },
  {
    name: "approvals",
    run: useApprovals,
    assertFetched: (methods, id) => expect(methods.approvals.list).toHaveBeenCalledWith(id),
  },
  {
    name: "goal",
    run: useGoal,
    assertFetched: (methods, id) => expect(methods.goals.get).toHaveBeenCalledWith(id),
  },
];

describe("per-thread query options", () => {
  it("uses the matching query key for each query factory", () => {
    const { api } = createApi();
    expect(workspaceStatusOptions(api, conversationId).queryKey).toEqual(queryKeys.workspace(conversationId));
    expect(checkpointsOptions(api, conversationId).queryKey).toEqual(queryKeys.checkpoints(conversationId));
    expect(processesOptions(api, conversationId).queryKey).toEqual(queryKeys.processes(conversationId));
    expect(timersOptions(api, conversationId).queryKey).toEqual(queryKeys.timers(conversationId));
    expect(approvalsOptions(api, conversationId).queryKey).toEqual(queryKeys.approvals(conversationId));
    expect(goalOptions(api, conversationId).queryKey).toEqual(queryKeys.goal(conversationId));
  });

  it("keeps workspace status cancellation and staleness options", () => {
    const { api } = createApi();
    const options = workspaceStatusOptions(api, conversationId);
    expect(options.staleTime).toBe(5_000);
  });

  it.each(hookCases)("$name fetches through its shared query options", async ({ run, assertFetched }) => {
    const { api, methods } = createApi();
    renderQuery(() => run(conversationId), api);
    await waitFor(() => assertFetched(methods, conversationId));
  });
});
