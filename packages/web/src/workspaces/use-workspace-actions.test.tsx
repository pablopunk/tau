import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppError } from "@tau/protocol";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { NodeApiProvider } from "@/nodes/node-context";
import { useWorkspaceActions } from "./use-workspace-actions";

function setup(merge: () => Promise<unknown>) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockReturnValue(new Promise(() => {}));
  const api = { workspaces: { merge } } as unknown as Api;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <NodeApiProvider api={api}>{children}</NodeApiProvider>
    </QueryClientProvider>
  );
  return { ...renderHook(() => useWorkspaceActions("1"), { wrapper }), invalidate };
}

describe("workspace actions do not wait for advisory status", () => {
  it("finishes a successful action even when refresh never finishes", async () => {
    const { result, invalidate } = setup(async () => undefined);
    await act(async () => expect(await result.current.merge()).toBe(true));
    expect(result.current.pending).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workspace"] });
  });

  it("refreshes after failed mutations without hiding the original error", async () => {
    const { result, invalidate } = setup(async () => {
      throw new AppError("worktree_dirty", "Dirty");
    });
    await act(async () => expect(await result.current.merge()).toBe(false));
    expect(result.current.pending).toBe(false);
    expect(result.current.failure).toEqual({ code: "worktree_dirty", message: "Dirty" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workspace"] });
  });
});
