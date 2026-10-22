import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppError, type FileRef } from "@tau/protocol";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Api } from "@/lib/api";
import { NodeApiProvider } from "@/nodes/node-context";
import { Composer } from "./Composer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("./images/resize-image", () => ({
  readDimensions: vi.fn().mockResolvedValue({ width: 10, height: 10 }),
  resizeAndEncode: vi.fn(),
}));

const txt = (name = "notes.txt", text = "hello") => new File([text], name, { type: "text/plain" });
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
const refOf = (file: File): FileRef => ({
  name: file.name,
  path: `uploads/staged-${file.name}`,
  size: file.size,
});

function stubApi(stage: (file: File) => Promise<FileRef>) {
  const uploads = { stage: vi.fn(stage) };
  return { api: { uploads } as unknown as Api, uploads };
}

let nextTarget = 1;

function setup({
  stage = async (file: File) => refOf(file),
  onSend = vi.fn().mockResolvedValue(undefined),
  nodeId,
  api,
  target = `files-${nextTarget++}`,
  ...props
}: {
  stage?: (file: File) => Promise<FileRef>;
  onSend?: ComponentProps<typeof Composer>["onSend"];
  nodeId?: string;
  api?: Api;
  imagesAllowed?: boolean;
  target?: string;
} = {}) {
  const stub = api ? undefined : stubApi(stage);
  const usedApi = api ?? stub?.api;
  if (!usedApi) throw new Error("Composer test needs an api or a stage for the fake");
  const view = render(<Composer target={target} imagesAllowed busy={false} onSend={onSend} {...props} />, {
    wrapper: ({ children }: { children: ReactNode }) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return (
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <NodeApiProvider nodeId={nodeId} api={usedApi}>
              <TooltipProvider>{children}</TooltipProvider>
            </NodeApiProvider>
          </QueryClientProvider>
        </MemoryRouter>
      );
    },
  });
  return {
    onSend,
    uploads: (usedApi.uploads as { stage: ReturnType<typeof vi.fn> }).stage,
    input: screen.getByLabelText("Message"),
    view,
  };
}

function pasteFiles(input: HTMLElement, files: File[]) {
  fireEvent.paste(input, { clipboardData: { files, types: ["Files"], getData: () => "" } });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(toast.error).mockReset();
});

describe("<Composer> generic files", () => {
  it("stages a picked file and shows a chip with name and size", async () => {
    setup();
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    expect(await screen.findByRole("listitem")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("5 B")).toBeInTheDocument();
  });

  it("disables send while staging", async () => {
    let release!: (ref: FileRef) => void;
    const gate = new Promise<FileRef>((resolve) => {
      release = resolve;
    });
    const { input } = setup({ stage: () => gate });
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    expect(await screen.findByText("Staging…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    release(refOf(txt()));
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    await userEvent.type(input, "read{Enter}");
  });

  it("stages dropped non-images even when the model disallows images", async () => {
    const { uploads } = setup({ imagesAllowed: false });
    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
    const zone = await screen.findByText("Drop files to attach");
    fireEvent.drop(zone.parentElement as HTMLElement, {
      dataTransfer: { types: ["Files"], files: [png(), txt()] },
    });
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(uploads).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This model does not accept images."));
  });

  it("never uploads on paste, even for non-images", async () => {
    const { uploads, input } = setup();
    pasteFiles(input, [txt(), png()]);
    await waitFor(() => expect(toast.error).not.toHaveBeenCalled());
    expect(uploads).not.toHaveBeenCalled();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("passes staged refs in the send payload", async () => {
    const { onSend, input } = setup();
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    await screen.findByText("notes.txt");
    await userEvent.type(input, "read{Enter}");
    expect(onSend).toHaveBeenCalledWith({
      text: "read",
      images: [],
      files: [{ name: "notes.txt", path: "uploads/staged-notes.txt", size: 5 }],
    });
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("sends files without text and removes a chip before sending", async () => {
    const { onSend } = setup();
    await userEvent.upload(screen.getByLabelText("Choose files"), txt("a.txt"));
    await userEvent.upload(screen.getByLabelText("Choose files"), txt("b.txt"));
    await screen.findByText("b.txt");
    await userEvent.click(screen.getByRole("button", { name: "Remove a.txt" }));
    expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith({
      text: "",
      images: [],
      files: [{ name: "b.txt", path: "uploads/staged-b.txt", size: 5 }],
    });
  });

  it("restores files after a file_expired send failure instead of losing them", async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new AppError("file_expired", "Stage it again."));
    const { input } = setup({ onSend });
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    await screen.findByText("notes.txt");
    await userEvent.type(input, "read{Enter}");
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Stage it again.");
    expect(input).toHaveValue("read");
  });

  it("persists only name/path/size, never bytes", async () => {
    const target = `persist-${nextTarget++}`;
    setup({ target });
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    await screen.findByText("notes.txt");
    expect(window.localStorage.getItem(`tau:file-attachments:${target}`)).toBe(
      JSON.stringify([{ name: "notes.txt", path: "uploads/staged-notes.txt", size: 5 }]),
    );
  });

  it("stages through the thread's node api", async () => {
    const node = stubApi(async (file) => refOf(file));
    const hub = stubApi(async (file) => refOf(file));
    setup({ api: node.api, nodeId: "n1" });
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    await screen.findByText("notes.txt");
    expect(node.uploads.stage).toHaveBeenCalledTimes(1);
    expect(hub.uploads.stage).not.toHaveBeenCalled();
  });

  it("shows an update message on a node without stageUpload and sends nothing local", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const old = stubApi(async () => {
      throw new AppError("internal", "Request failed (404)");
    });
    const { input } = setup({ api: old.api, onSend });
    await userEvent.upload(screen.getByLabelText("Choose files"), txt());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This node needs an update to attach files."),
    );
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    await userEvent.type(input, "hi{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "hi", images: [], files: [] });
  });
});
