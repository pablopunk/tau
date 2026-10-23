import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NodeApiProvider } from "@/nodes/node-context";
import { StartingThread } from "./StartingThread";

vi.mock("@/lib/queries", () => ({ useAllConversations: () => ({ data: [] }) }));
vi.mock("@/nodes/use-node-name", () => ({ useNodeName: () => undefined }));
vi.mock("@/nodes/use-node-avatar", () => ({
  useNodeAvatar: () => ({ os: undefined, status: "online" }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <NodeApiProvider>
        <SidebarProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SidebarProvider>
      </NodeApiProvider>
    </MemoryRouter>
  );
}

describe("<StartingThread>", () => {
  it("switches to the thread frame without remounting its composer child", () => {
    const composer = <div data-testid="composer" />;
    const { rerender } = render(<StartingThread normalContent={<h2>New thread</h2>} composer={composer} />, {
      wrapper,
    });
    const composerNode = screen.getByTestId("composer");

    rerender(
      <StartingThread
        message={{ text: "hello", images: [{ mimeType: "image/png", data: "AQID" }] }}
        normalContent={<h2>New thread</h2>}
        composer={composer}
      />,
    );

    expect(screen.getByTestId("composer")).toBe(composerNode);
    expect(screen.getByTestId("thread-header-desktop")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "New thread" })).toHaveLength(2);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Attachment 1" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sending…");
  });
});
