import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { ComposerTestWrapper } from "./composer/test-wrapper";

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return {
    ...actual,
    useApprovals: () => ({
      data: [
        {
          toolUseId: "t1",
          conversationId: "c1",
          server: "s",
          tool: "do",
          arguments: {},
          requestedAt: 0,
        },
      ],
    }),
  };
});

beforeEach(() => {
  window.localStorage.clear();
});

function setup() {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onStop = vi.fn().mockResolvedValue(undefined);
  render(<Composer target="c1" imagesAllowed busy whenBusy="steer" onSend={onSend} onStop={onStop} />, {
    wrapper: ComposerTestWrapper,
  });
  return { onSend, onStop, input: screen.getByLabelText("Message") };
}

describe("<Composer> while approval is pending", () => {
  it("yields to the approval bar: queue-only, never steer", async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, "queue me");
    expect(screen.getByText("Waiting on approval above — new messages queue behind it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send as steer" })).not.toBeInTheDocument();
    // Alt+Enter cannot reach steer while approval is pending.
    fireEvent.keyDown(input, { key: "Enter", altKey: true });
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ whenBusy: "followUp" }));
  });

  it("still stops the run but never aborts on Escape", async () => {
    const { onStop, input } = setup();
    await userEvent.type(input, "{Escape}");
    expect(onStop).not.toHaveBeenCalled();
  });
});
