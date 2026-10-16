import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { preferences } from "@/lib/preferences";
import { renderAt } from "@/sidebar/test-support";
import { NotificationSettings } from "./NotificationSettings";

vi.mock("@/lib/api", () => ({ api: { conversations: { listAll: vi.fn() } } }));

const _listAll = vi.mocked(api.conversations.listAll);
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
  window.localStorage.clear();
});

describe("NotificationSettings", () => {
  it("asks permission on click and stores the choice", async () => {
    const fake = stubNotification("granted");
    Object.assign(fake, { permission: "default" });
    const user = userEvent.setup();
    renderAt("/", <NotificationSettings />);

    await user.click(screen.getByRole("switch"));

    expect(fake.requestPermission).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
    expect(preferences.getNotificationsEnabled()).toBe(true);
  });

  it("stays off and explains when permission is denied", async () => {
    stubNotification("denied");
    const user = userEvent.setup();
    renderAt("/", <NotificationSettings />);

    await user.click(screen.getByRole("switch"));

    expect(await screen.findByText(/blocked in your browser/i)).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(preferences.getNotificationsEnabled()).toBe(false);
  });
});
