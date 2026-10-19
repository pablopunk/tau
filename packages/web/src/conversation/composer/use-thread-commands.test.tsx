import { AppError } from "@tau/protocol";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { ComposerTestWrapper } from "./test-wrapper";
import { useThreadCommands } from "./use-thread-commands";

const api = apiOfNode();

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { conversations: { compact: vi.fn() } } }));

const compact = vi.mocked(api.conversations.compact);
const pickers = { current: null };

function setup() {
  return renderHook(() => useThreadCommands({ conversationId: "c1", projectId: "p1", pickers }), {
    wrapper: ComposerTestWrapper,
  }).result.current;
}

beforeEach(() => {
  compact.mockReset().mockResolvedValue(undefined);
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
