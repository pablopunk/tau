import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { loadFileAttachments, newFileAttachment, saveFileAttachments } from "./files/attachments";
import { loadAttachments, newAttachment, saveAttachments } from "./images/attachments";

const voice = vi.hoisted(() => ({ onText: (_text: string) => {}, toggle: vi.fn() }));
vi.mock("./composer/use-dictation", () => ({
  useDictation: (onText: (text: string) => void) => {
    voice.onText = onText;
    return { listening: false, preview: "", hint: "", toggle: voice.toggle, glowRef: { current: null } };
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  saveAttachments("new", []);
  saveFileAttachments("new", []);
  voice.toggle.mockClear();
});
afterEach(() => vi.restoreAllMocks());

function heldSend() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, onSend: vi.fn(() => pending) };
}

describe("new-thread draft while starting", () => {
  it.each(["success", "failure"])("locks every draft control until %s", async (outcome) => {
    const image = newAttachment({ mimeType: "image/png", data: "AQID" });
    const file = newFileAttachment({ name: "notes.txt", path: "uploads/notes.txt", size: 5 });
    saveAttachments("new", [image]);
    saveFileAttachments("new", [file]);
    const held = heldSend();
    const user = userEvent.setup();
    render(<Composer target="new" imagesAllowed onSend={held.onSend} />, { wrapper: ComposerTestWrapper });
    const input = screen.getByLabelText("Message");
    await user.type(input, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(input).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeDisabled();
    expect(screen.getByLabelText("Choose files")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove Attachment 1" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["late"], "late.txt", { type: "text/plain" })] },
    });
    fireEvent.paste(input, {
      clipboardData: { files: [new File(["late"], "late.png", { type: "image/png" })] },
    });
    fireEvent.change(input, { target: { value: "late edit" } });
    act(() => voice.onText("late dictation"));
    expect(input).toHaveValue("hello");
    expect(loadAttachments("new")).toEqual([image]);
    expect(loadFileAttachments("new")).toEqual([file]);
    expect(held.onSend).toHaveBeenCalledExactlyOnceWith({
      text: "hello",
      images: [image.image],
      files: [file.ref],
    });
    await act(async () => {
      if (outcome === "success") held.resolve();
      else held.reject(new Error("start failed"));
    });
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    if (outcome === "success") {
      expect(input).toHaveValue("");
      expect(loadAttachments("new")).toEqual([]);
      expect(loadFileAttachments("new")).toEqual([]);
    } else {
      expect(input).toHaveValue("hello");
      expect(loadAttachments("new")).toEqual([image]);
      expect(loadFileAttachments("new")).toEqual([file]);
      expect(screen.getByRole("alert")).toHaveTextContent("start failed");
    }
  });

  it("disables mobile dictation during creation", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const held = heldSend();
    render(<Composer target="new" imagesAllowed onSend={held.onSend} />, { wrapper: ComposerTestWrapper });
    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "hello" } });
    const form = input.closest("form");
    if (!form) throw new Error("Missing form");
    fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "Dictate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    expect(voice.toggle).not.toHaveBeenCalled();
    await act(async () => held.resolve());
  });
});
