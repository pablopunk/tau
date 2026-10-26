import { AppError } from "@tau/protocol";
import { renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { ComposerTestWrapper } from "./test-wrapper";
import { useThreadCommands } from "./use-thread-commands";

const api = apiOfNode();

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/lib/api", () => ({
  api: { conversations: { compact: vi.fn(), archive: vi.fn(), rename: vi.fn() } },
}));

const compact = vi.mocked(api.conversations.compact);
const archive = vi.mocked(api.conversations.archive);
const rename = vi.mocked(api.conversations.rename);
const pickers = { current: null };

function setup() {
  return renderHook(() => useThreadCommands({ conversationId: "c1", projectId: "p1", pickers }), {
    wrapper: ComposerTestWrapper,
  }).result.current;
}

beforeEach(() => {
  compact.mockReset().mockResolvedValue(undefined);
  archive.mockReset().mockReturnValue(new Promise(() => {}));
  rename.mockReset().mockReturnValue(new Promise(() => {}));
  navigate.mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("useThreadCommands compact", () => {
  it("sends the instructions", async () => {
    await setup().commands.compact?.("keep notes");
    expect(compact).toHaveBeenCalledWith("c1", { instructions: "keep notes" });
  });

  it("sends no instructions when none are typed", async () => {
    await setup().commands.compact?.("");
    expect(compact).toHaveBeenCalledWith("c1", {});
  });

  it("toasts on nothing_to_compact", async () => {
    compact.mockRejectedValue(new AppError("nothing_to_compact", "nothing"));
    await setup().commands.compact?.("");
    expect(toast.error).toHaveBeenCalledWith("Nothing to compact yet");
  });
});

describe("useThreadCommands waits for nothing", () => {
  it("leaves the archived thread at once, before the server answers", async () => {
    await setup().commands.archive?.("");
    expect(navigate).toHaveBeenCalledWith("/");
    await waitFor(() => expect(archive).toHaveBeenCalledWith("c1", true));
  });

  it("renames without waiting for the server", async () => {
    await expect(setup().rename("New name")).resolves.toBeUndefined();
    await waitFor(() => expect(rename).toHaveBeenCalledWith("c1", "New name"));
  });
});
