import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { conversation, renderAt } from "@/sidebar/test-support";
import {
  isNotificationMarkerText,
  isSubagentNotificationKind,
  parseSubagentNotification,
} from "./notification-entry";
import { SubagentNotificationRow } from "./SubagentNotificationRow";

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useAllConversations: () => ({ data: [conversation({ id: "kid" })] }),
}));

const data = { childId: "kid", status: "failed", title: "Scan", report: "**boom**" } as const;

describe("subagent notifications", () => {
  it("recognises the entry kind, data and hidden marker text", () => {
    expect(isSubagentNotificationKind("app.subagent_notification")).toBe(true);
    expect(parseSubagentNotification(data)).toEqual(data);
    expect(parseSubagentNotification({ childId: 1 })).toBeUndefined();
    expect(isNotificationMarkerText('<subagent-notification id="kid">x')).toBe(true);
    expect(isNotificationMarkerText("hello")).toBe(false);
  });

  it("renders a row that expands to the markdown report", async () => {
    renderAt("/", <SubagentNotificationRow data={data} />);
    expect(screen.getByText(/failed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("boom").tagName).toBe("STRONG");
  });
});
