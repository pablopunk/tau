import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { saveAttachments } from "./images/attachments";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./images/resize-image", () => ({
  readDimensions: vi.fn().mockResolvedValue({ width: 10, height: 10 }),
  resizeAndEncode: vi.fn(),
}));

const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onStop = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <Composer target="t1" imagesAllowed busy={false} onSend={onSend} onStop={onStop} {...props} />,
  );
  return { onSend, onStop, input: screen.getByLabelText("Message"), view };
}

function pasteFiles(input: HTMLElement, files: File[]) {
  fireEvent.paste(input, { clipboardData: { files, types: ["Files"], getData: () => "" } });
}

beforeEach(() => {
  window.localStorage.clear();
  saveAttachments("t1", []);
  vi.mocked(toast.error).mockReset();
});

describe("<Composer> images", () => {
  it("attaches a pasted image, shows a thumbnail and sends it", async () => {
    const { onSend, input } = setup();
    pasteFiles(input, [png()]);
    expect(await screen.findByRole("img", { name: "Attachment 1" })).toBeInTheDocument();
    await userEvent.type(input, "look{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      text: "look",
      images: [{ mimeType: "image/png", data: "AQID" }],
    });
    expect(screen.queryByRole("img", { name: "Attachment 1" })).not.toBeInTheDocument();
  });

  it("sends an image without text", async () => {
    const { onSend, input } = setup();
    pasteFiles(input, [png()]);
    await screen.findByRole("img", { name: "Attachment 1" });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith({ text: "", images: [{ mimeType: "image/png", data: "AQID" }] });
  });

  it("removes an attached image", async () => {
    const { input } = setup();
    pasteFiles(input, [png()]);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Attachment 1" }));
    expect(screen.queryByRole("img", { name: "Attachment 1" })).not.toBeInTheDocument();
  });

  it("attaches with the picker", async () => {
    setup();
    await userEvent.upload(screen.getByLabelText("Choose images"), png());
    expect(await screen.findByRole("img", { name: "Attachment 1" })).toBeInTheDocument();
  });

  it("attaches files dropped on the page", async () => {
    setup();
    const types = ["Files"];
    fireEvent.dragEnter(window, { dataTransfer: { types } });
    const zone = await screen.findByText("Drop images to attach");
    fireEvent.drop(zone.parentElement as HTMLElement, { dataTransfer: { types, files: [png()] } });
    expect(await screen.findByRole("img", { name: "Attachment 1" })).toBeInTheDocument();
  });

  it("offers no attach button and toasts on paste when images are not allowed", async () => {
    const { input } = setup({ imagesAllowed: false });
    expect(screen.queryByRole("button", { name: "Attach images" })).not.toBeInTheDocument();
    pasteFiles(input, [png()]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This model does not accept images."));
  });

  it("toasts for a file type that is not supported", async () => {
    const { input } = setup();
    pasteFiles(input, [new File(["x"], "a.heic", { type: "image/heic" })]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("a.heic")));
  });

  it("keeps images in memory per target when the composer remounts", async () => {
    const { input, view } = setup();
    pasteFiles(input, [png()]);
    await screen.findByRole("img", { name: "Attachment 1" });
    view.unmount();
    setup();
    expect(screen.getByRole("img", { name: "Attachment 1" })).toBeInTheDocument();
  });
});

describe("<Composer> drafts and Esc", () => {
  it("restores the text draft of the same target and not of another", async () => {
    const first = setup({ target: "a" });
    await userEvent.type(first.input, "draft a");
    first.view.unmount();
    const again = setup({ target: "a" });
    expect(again.input).toHaveValue("draft a");
    again.view.unmount();
    expect(setup({ target: "b" }).input).toHaveValue("");
  });

  it("clears the stored draft after sending", async () => {
    const { input } = setup({ target: "c" });
    await userEvent.type(input, "bye{Enter}");
    expect(window.localStorage.getItem("pi-everywhere:draft:c")).toBeNull();
  });

  it("stops a running thread on Esc when busy", async () => {
    const { input, onStop } = setup({ busy: true });
    await userEvent.type(input, "{Escape}");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Esc when idle", async () => {
    const { input, onStop } = setup();
    await userEvent.type(input, "{Escape}");
    expect(onStop).not.toHaveBeenCalled();
  });
});
