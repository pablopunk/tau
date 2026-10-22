import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationSummary } from "@tau/protocol";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queries";
import { useThreadListMutation } from "./thread-list-mutations";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const thread = (id: string, title: string, archivedAt: number | null = null): ConversationSummary =>
  ({ id, title, projectId: "p1", archivedAt }) as ConversationSummary;

function setup(
  mutationFn: (variables: { id: string }) => Promise<unknown>,
  transform: (list: ConversationSummary[], variables: { id: string }) => ConversationSummary[],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listKeys = [queryKeys.allConversations] as const;
  client.setQueryData(listKeys[0], [thread("a", "A"), thread("b", "B")]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useThreadListMutation({ listKeys: [...listKeys], mutationFn, transform }), {
    wrapper,
  });
  return { client, hook };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useThreadListMutation", () => {
  it("moves the row instantly, then refetches once settled", async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    const { client, hook } = setup(mutationFn, (list, { id }) => list.filter((item) => item.id !== id));
    const invalidateSpy = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const pending = hook.result.current.mutateAsync({ id: "a" });
    // Optimistic: gone before the round trip resolves.
    await vi.waitFor(() =>
      expect(
        client.getQueryData<ConversationSummary[]>(queryKeys.allConversations)?.map((item) => item.id),
      ).toEqual(["b"]),
    );
    await pending;
    expect(mutationFn).toHaveBeenCalled();
    await vi.waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(1));
  });

  it("rolls back and toasts when the mutation fails", async () => {
    let reject!: (error: Error) => void;
    const mutationFn = vi
      .fn()
      .mockImplementation(() => new Promise<unknown>((_, rejectPromise) => (reject = rejectPromise)));
    const { client, hook } = setup(mutationFn, (list, { id }) => list.filter((item) => item.id !== id));
    // Deferred rejection: the optimistic row is stable until the round trip fails.
    const done = hook.result.current.mutateAsync({ id: "a" });
    const settled = done.catch(() => {});
    await vi.waitFor(() =>
      expect(client.getQueryData<ConversationSummary[]>(queryKeys.allConversations)).toHaveLength(1),
    );
    reject(new Error("offline"));
    await settled;
    await vi.waitFor(() =>
      expect(client.getQueryData<ConversationSummary[]>(queryKeys.allConversations)).toHaveLength(2),
    );
    expect(toast.error).toHaveBeenCalled();
  });

  it("invalidates once for concurrent siblings: no flash of old UI", async () => {
    // Separate observers (rename vs remove) sharing one mutationKey — the real
    // ThreadRow/palette shape. Spam-click applies both instantly, in place.
    let releaseRename!: () => void;
    let releaseRemove!: () => void;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.allConversations, [thread("a", "A"), thread("b", "B")]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const rename = renderHook(
      () =>
        useThreadListMutation({
          listKeys: [queryKeys.allConversations],
          mutationFn: () => new Promise<void>((resolve) => (releaseRename = resolve)),
          transform: (list, { id }: { id: string }) =>
            list.map((item) => (item.id === id ? { ...item, title: `${item.title}!` } : item)),
        }),
      { wrapper },
    );
    const remove = renderHook(
      () =>
        useThreadListMutation({
          listKeys: [queryKeys.allConversations],
          mutationFn: () => new Promise<void>((resolve) => (releaseRemove = resolve)),
          transform: (list, { id }: { id: string }) => list.filter((item) => item.id !== id),
        }),
      { wrapper },
    );
    const invalidateSpy = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    // `mutateAsync` so each settlement can be awaited in order: the first
    // settler sees a sibling still pending and skips; the last refetches.
    const doneRename = rename.result.current.mutateAsync({ id: "a" });
    const doneRemove = remove.result.current.mutateAsync({ id: "b" });
    await vi.waitFor(() =>
      expect(
        client.getQueryData<ConversationSummary[]>(queryKeys.allConversations)?.map((item) => item.title),
      ).toEqual(["A!"]),
    );
    releaseRename();
    await doneRename;
    expect(invalidateSpy).not.toHaveBeenCalled();
    releaseRemove();
    await doneRemove;
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
