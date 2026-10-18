import { AppError } from "@tau/protocol";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { renderAt } from "./test-support";

const unmerged = new AppError("has_unmerged_work", "This thread has unmerged work: hello.txt");

describe("DeleteConversationDialog", () => {
  it("deletes a clean thread with one confirmation", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderAt("/", <DeleteConversationDialog title="T" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete thread" }));
    expect(onConfirm).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("asks again for unmerged work, then deletes with force", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(unmerged).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderAt("/", <DeleteConversationDialog title="T" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete thread" }));
    expect(
      await screen.findByText(/hello\.txt\. Delete it anyway\? This work is lost\./),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
    expect(onConfirm).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
