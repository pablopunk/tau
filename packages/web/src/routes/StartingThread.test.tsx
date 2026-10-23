import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NodeApiProvider } from "@/nodes/node-context";
import { HeaderSlotProvider, useStartingThreadHeader } from "./header-slot";
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
          <HeaderSlotProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </HeaderSlotProvider>
        </SidebarProvider>
      </NodeApiProvider>
    </MemoryRouter>
  );
}

function MainHeaderState() {
  const { startingThread } = useStartingThreadHeader();
  return <output data-testid="main-header-state">{startingThread ? "hidden" : "visible"}</output>;
}

describe("<StartingThread>", () => {
  it("switches to the thread frame without remounting its composer child", () => {
    const composer = <div data-testid="composer" />;
    const presentation = (message?: { text: string; images: { mimeType: "image/png"; data: string }[] }) => (
      <>
        <MainHeaderState />
        <StartingThread message={message} normalContent={<h2>New thread</h2>} composer={composer} />
      </>
    );
    const { rerender } = render(presentation(), { wrapper });
    const composerNode = screen.getByTestId("composer");

    rerender(presentation({ text: "hello", images: [{ mimeType: "image/png", data: "AQID" }] }));

    expect(screen.getByTestId("composer")).toBe(composerNode);
    expect(screen.getByTestId("main-header-state")).toHaveTextContent("hidden");
    expect(screen.getByTestId("thread-header-desktop")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "New thread" })).toHaveLength(2);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Attachment 1" })).toBeInTheDocument();
    expect(screen.getByText("Sending…")).toBeInTheDocument();

    rerender(presentation());
    expect(screen.getByTestId("main-header-state")).toHaveTextContent("visible");
  });
});
