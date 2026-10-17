import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { nestThreads } from "./sidebar-model";
import { ThreadsView } from "./ThreadsView";
import { conversation, project, renderAt } from "./test-support";

const parent = conversation({ id: "1", title: "Parent thread" });
const child = conversation({ id: "2", title: "Child thread", parentId: "1" });
const orphan = conversation({ id: "3", title: "Orphan thread", parentId: "missing" });

describe("nestThreads", () => {
  it("puts children under their parent and keeps orphans as roots", () => {
    const nodes = nestThreads([parent, child, orphan]);
    expect(nodes.map((node) => node.conversation.id)).toEqual(["1", "3"]);
    expect(nodes[0]?.children.map((item) => item.id)).toEqual(["2"]);
    expect(nodes[1]?.children).toEqual([]);
  });
});

describe("<ThreadsView> nesting", () => {
  const renderView = () =>
    renderAt(
      "/",
      <SidebarProvider>
        <ThreadsView
          projects={[project()]}
          conversations={[parent, child]}
          activeConversationId={undefined}
          onProjectRemoved={() => {}}
        />
      </SidebarProvider>,
    );

  it("indents the child under its parent", () => {
    renderView();
    const childRow = screen.getByText("Child thread").closest("li");
    expect(childRow).toHaveAttribute("data-depth", "1");
    expect(screen.getByTestId("thread-tree-1")).toContainElement(childRow);
  });

  it("collapses the children with the parent's toggle", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /Subagents \(1\)/ }));
    expect(screen.queryByText("Child thread")).not.toBeInTheDocument();
  });
});
