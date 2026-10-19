import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiOfMachine } from "@/machines/machine-apis";
import { ComposerTestWrapper } from "./test-wrapper";
import { useMentionItems } from "./use-mention-items";

const api = apiOfMachine();

vi.mock("@/lib/api", () => ({
  api: { projects: { suggestFiles: vi.fn() }, skills: { list: vi.fn() } },
}));

const suggestFiles = vi.mocked(api.projects.suggestFiles);
const labels = (items: { label: string }[]) => items.map((item) => item.label);

beforeEach(() => {
  suggestFiles.mockReset().mockResolvedValue([{ path: "src/a.ts" }] as never);
});

describe("useMentionItems", () => {
  it("asks for files right away and shows a searching row until they arrive", async () => {
    const { result } = renderHook(() => useMentionItems("p1", ""), { wrapper: ComposerTestWrapper });
    expect(suggestFiles).toHaveBeenCalledWith("p1", "");
    expect(result.current).toContainEqual(
      expect.objectContaining({ label: "Searching files…", disabled: true }),
    );
    await waitFor(() => expect(labels(result.current)).toContain("src/a.ts"));
    expect(labels(result.current)).not.toContain("Searching files…");
  });

  it("keeps the previous files while the next query loads", async () => {
    const { result, rerender } = renderHook(({ query }) => useMentionItems("p1", query), {
      wrapper: ComposerTestWrapper,
      initialProps: { query: "" },
    });
    await waitFor(() => expect(labels(result.current)).toContain("src/a.ts"));
    suggestFiles.mockReturnValue(new Promise(() => {}));
    rerender({ query: "b" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(labels(result.current)).toContain("src/a.ts");
  });
});
