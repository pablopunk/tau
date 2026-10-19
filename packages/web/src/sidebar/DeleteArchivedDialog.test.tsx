import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { apiOfMachine } from "@/machines/machine-apis";
import { ArchivedConversations } from "./ArchivedConversations";
import { DeleteArchivedDialog } from "./DeleteArchivedDialog";
import { conversation, renderAt } from "./test-support";

const api = apiOfMachine();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { conversations: { deleteArchived: vi.fn() } } }));

const mocked = vi.mocked(api, true);
const archived = [
  conversation({ id: "1", title: "Clean one", archivedAt: 1 }),
  conversation({ id: "2", title: "Clean two", archivedAt: 1 }),
  conversation({
    id: "3",
    title: "Dirty one",
    archivedAt: 1,
    unmergedWarning: "Uncommitted changes in pi/dirty",
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
    expect(screen.getByText("Dirty one: Uncommitted changes in pi/dirty")).toBeInTheDocument();
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

  it("closes immediately without awaiting the request", async () => {
    let resolve!: (v: { deleted: string[]; kept: [] }) => void;
    mocked.conversations.deleteArchived.mockReturnValue(new Promise((r) => (resolve = r)));
    const onClose = vi.fn();
    renderAt("/", <DeleteArchivedDialog archived={archived} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    expect(onClose).toHaveBeenCalled();
    resolve({ deleted: ["1", "2"], kept: [] });
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("summarises kept threads after the dialog unmounts", async () => {
    let resolve!: (v: { deleted: string[]; kept: { id: string; reason: string }[] }) => void;
    mocked.conversations.deleteArchived.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderAt("/", <DeleteArchivedDialog archived={archived} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    unmount();
    resolve({ deleted: ["1", "2"], kept: [{ id: "3", reason: "dirty" }] });
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(vi.mocked(toast.info).mock.calls[0]?.[1]?.description).toContain("Dirty one — dirty");
  });

  it("reports an interrupted delete on transport failure", async () => {
    mocked.conversations.deleteArchived.mockRejectedValue(new TypeError("fetch failed"));
    renderAt("/", <DeleteArchivedDialog archived={archived} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Delete interrupted")),
    );
  });

  it("marks the sidebar button busy and ignores a second start while in flight", async () => {
    let resolve!: (v: { deleted: string[]; kept: [] }) => void;
    mocked.conversations.deleteArchived.mockReturnValue(new Promise((r) => (resolve = r)));
    renderAt(
      "/",
      <SidebarProvider>
        <ArchivedConversations
          conversations={archived}
          activeConversationId={undefined}
          projects={new Map()}
          showProject
        />
      </SidebarProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Archived \(3\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete all archived" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    const button = await screen.findByRole("button", { name: "Delete all archived" });
    await vi.waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    await userEvent.click(button);
    expect(toast.info).toHaveBeenCalledWith("Already deleting…");
    expect(mocked.conversations.deleteArchived).toHaveBeenCalledTimes(1);
    resolve({ deleted: ["1", "2"], kept: [] });
    await vi.waitFor(() => expect(button).toHaveAttribute("aria-disabled", "false"));
  });
});
