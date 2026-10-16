import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { conversation, renderAt } from "@/sidebar/test-support";
import { MarkSeenWhileOpen } from "./MarkSeenWhileOpen";

vi.mock("@/lib/api", () => ({ api: { conversations: { listAll: vi.fn() } } }));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(api.conversations.listAll).mockResolvedValue([
    conversation({ lastRunEndedAt: Date.now() + 5000 }),
  ]);
});

describe("MarkSeenWhileOpen", () => {
  it("records lastSeenAt for the open thread, past its last run", async () => {
    renderAt("/p/p1/c/c1", <MarkSeenWhileOpen />);

    await waitFor(() => expect(preferences.getLastSeenAt("c1")).toBeGreaterThan(Date.now() + 4000));
  });

  it("records nothing outside a thread", async () => {
    renderAt("/new", <MarkSeenWhileOpen />);

    await waitFor(() => expect(api.conversations.listAll).toHaveBeenCalled());
    expect(preferences.getLastSeenAt("c1")).toBeNull();
  });
});
