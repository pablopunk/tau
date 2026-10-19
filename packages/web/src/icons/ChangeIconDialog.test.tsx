import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { NodeApiProvider } from "@/nodes/node-context";
import { ChangeIconDialog } from "./ChangeIconDialog";
import { letterbox, renderIconPng } from "./render-icon-png";

const api = apiOfNode();

vi.mock("@/lib/api", () => ({
  api: { projects: { iconCandidates: vi.fn(), setIcon: vi.fn(), resetIcon: vi.fn() } },
}));
vi.mock("./render-icon-png", async (original) => ({
  ...(await original<typeof import("./render-icon-png")>()),
  renderIconPng: vi.fn(),
}));

const mocked = vi.mocked(api, true);
const PNG = new Uint8Array([137, 80, 78, 71]);
const project = {
  id: "p2",
  name: "Repo",
  path: "/r",
  createdAt: 1,
  kind: "folder",
  status: "ready",
  isGitRepo: false,
} as const;

const renderDialog = (onClose = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NodeApiProvider>
        <ChangeIconDialog project={project} onClose={onClose} />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  return onClose;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(renderIconPng).mockResolvedValue(PNG);
  mocked.projects.iconCandidates.mockResolvedValue(
    Array.from({ length: 14 }, (_, index) => ({ name: `i${index}.png`, url: `/i${index}.png` })),
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"]) }));
});

describe("ChangeIconDialog", () => {
  it("shows the title and at most 12 found images", async () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Change icon for Repo" })).toBeInTheDocument();
    expect(await screen.findAllByRole("button", { name: /^Open i\d+\.png$/ })).toHaveLength(12);
  });

  it("saves a found image as the rendered PNG and closes", async () => {
    mocked.projects.setIcon.mockResolvedValue();
    const user = userEvent.setup();
    const onClose = renderDialog();
    await user.click(await screen.findByRole("button", { name: "Open i0.png" }));
    expect(mocked.projects.setIcon).toHaveBeenCalledWith("p2", PNG);
    expect(onClose).toHaveBeenCalled();
  });

  it("saves an uploaded file", async () => {
    mocked.projects.setIcon.mockResolvedValue();
    const user = userEvent.setup();
    renderDialog();
    await user.upload(
      screen.getByLabelText("Upload an image"),
      new File(["x"], "a.png", { type: "image/png" }),
    );
    expect(mocked.projects.setIcon).toHaveBeenCalledWith("p2", PNG);
  });

  it("resets to default and cancels", async () => {
    mocked.projects.resetIcon.mockResolvedValue();
    const user = userEvent.setup();
    const onClose = renderDialog();
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(mocked.projects.resetIcon).toHaveBeenCalledWith("p2");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("letterboxes a wide image inside 128 by 128", () => {
    expect(letterbox(256, 128)).toEqual({ x: 0, y: 32, w: 128, h: 64 });
  });
});
