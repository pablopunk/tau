import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { DeleteArchivedDialog } from "./DeleteArchivedDialog";
import { conversation, renderAt } from "./test-support";

vi.mock("@/lib/api", () => ({ api: { conversations: { deleteArchived: vi.fn() } } }));

const mocked = vi.mocked(api, true);
const archived = [
  conversation({ id: "1", title: "Clean one", archivedAt: 1 }),
  conversation({ id: "2", title: "Clean two", archivedAt: 1 }),
  conversation({
    id: "3",
    title: "Dirty one",
    archivedAt: 1,
    unmergedWarning: "Unmerged work in pi/dirty, not cleaned up",
  }),
];

beforeEach(() => {
  vi.resetAllMocks();
  mocked.conversations.deleteArchived.mockResolvedValue({ deleted: ["1", "2"], kept: [] });
});

describe("DeleteArchivedDialog", () => {
  it("counts what will be deleted and lists threads kept for unmerged work", () => {
    renderAt("/", <DeleteArchivedDialog archived={archived} onClose={() => {}} />);
    expect(screen.getByText(/2 archived threads will be deleted/)).toBeInTheDocument();
    expect(screen.getByText("Dirty one")).toBeInTheDocument();
  });

  it("deletes without force by default", async () => {
    const onClose = vi.fn();
    renderAt("/", <DeleteArchivedDialog archived={archived} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    expect(mocked.conversations.deleteArchived).toHaveBeenCalledWith({ force: false });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("includes unmerged threads once the force box is ticked", async () => {
    renderAt("/", <DeleteArchivedDialog archived={archived} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Also delete threads with unmerged work" }));
    expect(screen.getByText(/3 archived threads will be deleted/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete 3" }));
    expect(mocked.conversations.deleteArchived).toHaveBeenCalledWith({ force: true });
  });
});
