import type { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "@/lib/preferences";
import { queryKeys } from "@/lib/queries";
import { apiOfNode } from "@/nodes/node-apis";
import { conversation, renderAt } from "@/sidebar/test-support";
import { NotificationWatcher } from "./NotificationWatcher";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({ api: { conversations: { listAll: vi.fn() } } }));

const listAll = vi.mocked(api.conversations.listAll);
const created: { title: string; options: NotificationOptions; onclick?: () => void }[] = [];

function stubNotification(permission: NotificationPermission) {
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    onclick?: () => void;
    constructor(title: string, options: NotificationOptions) {
      created.push({ title, options, onclick: undefined });
      const record = created.at(-1);
      Object.defineProperty(this, "onclick", {
        set: (handler: () => void) => {
          if (record) record.onclick = handler;
        },
      });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return FakeNotification;
}

beforeEach(() => {
  vi.resetAllMocks();
  created.length = 0;
  vi.spyOn(window, "focus").mockImplementation(() => {});
  window.localStorage.clear();
});

describe("NotificationWatcher", () => {
  async function renderWatcher(path: string, { enabled = true } = {}) {
    stubNotification("granted");
    preferences.setNotificationsEnabled(enabled);
    listAll.mockResolvedValue([conversation({ lastRunEndedAt: 5 })]);
    const view = renderAt(path, <NotificationWatcher />);
    await waitFor(() => expect(view.client.getQueryData(queryKeys.allConversations)).toBeDefined());
    await act(async () => {});
    return view;
  }

  const finishRun = (client: QueryClient) =>
    act(async () => {
      client.setQueryData(queryKeys.allConversations, [
        conversation({ lastRunEndedAt: 99, title: "Done thread" }),
      ]);
    });

  it("never fires on first load, fires when a run ends, with the thread id as tag", async () => {
    const { client } = await renderWatcher("/");
    expect(created).toHaveLength(0);

    await finishRun(client);

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.title).toBe("Done thread");
    expect(created[0]?.options.tag).toBe("c1");
  });

  it("skips the thread that is open and visible", async () => {
    const { client } = await renderWatcher("/p/p1/c/c1");
    await finishRun(client);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(0);
  });

  it("does nothing while the setting is off", async () => {
    const { client } = await renderWatcher("/", { enabled: false });
    await finishRun(client);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(0);
  });

  it("opens the thread when the notification is clicked", async () => {
    const { client } = await renderWatcher("/");
    await finishRun(client);

    await waitFor(() => expect(created).toHaveLength(1));
    await act(async () => created[0]?.onclick?.());

    expect(screen.getByTestId("location")).toHaveTextContent("/p/p1/c/c1");
  });
});
