import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { saveAttachments } from "./images/attachments";

vi.mock("./images/resize-image", () => ({
  readDimensions: vi.fn().mockResolvedValue({ width: 10, height: 10 }),
  resizeAndEncode: vi.fn(),
}));

const REASON = "Attachments are not available here.";
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(<Composer target="t1" imagesAllowed busy={false} onSend={onSend} {...props} />, {
    wrapper: ComposerTestWrapper,
  });
  return { onSend, input: screen.getByLabelText("Message") };
}

beforeEach(() => {
  window.localStorage.clear();
  saveAttachments("t1", []);
});

describe("<Composer> with attachments blocked", () => {
  it("offers attaching when nothing blocks it", () => {
    setup();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("removes the attach button and shows the reason", () => {
    setup({ attachmentsBlockedReason: REASON });
    expect(screen.queryByRole("button", { name: "Attach files" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(REASON);
  });

  it("refuses a pasted image with the reason and attaches nothing", () => {
    const { input } = setup({ attachmentsBlockedReason: REASON });
    fireEvent.paste(input, { clipboardData: { files: [png()], types: ["Files"], getData: () => "" } });
    expect(screen.getByRole("alert")).toHaveTextContent(REASON);
    expect(screen.queryByRole("img", { name: "Attachment 1" })).not.toBeInTheDocument();
  });

  it("still sends text", async () => {
    const { onSend, input } = setup({ attachmentsBlockedReason: REASON });
    await userEvent.type(input, "hello{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "hello", images: [], files: [] });
  });
});
