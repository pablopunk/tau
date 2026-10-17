import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { preferences } from "@/lib/preferences";
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
  beforeEach(() => window.localStorage.clear());
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

  it("branches the child out of its parent", () => {
    renderView();
    const childRow = screen.getByText("Child thread").closest("li");
    expect(childRow).toHaveAttribute("data-depth", "1");
    expect(screen.getByTestId("thread-tree-1")).toContainElement(childRow);
    expect(childRow?.querySelector("[data-slot=tree-branch]")).toHaveAttribute("data-last", "true");
  });

  it("gives only the last of several children the corner", () => {
    const second = conversation({ id: "4", title: "Second child", parentId: "1" });
    renderAt(
      "/",
      <SidebarProvider>
        <ThreadsView
          projects={[project()]}
          conversations={[parent, child, second]}
          activeConversationId={undefined}
          onProjectRemoved={() => {}}
        />
      </SidebarProvider>,
    );
    const lasts = ["Child thread", "Second child"].map((title) =>
      screen
        .getByText(title)
        .closest("li")
        ?.querySelector("[data-slot=tree-branch]")
        ?.getAttribute("data-last"),
    );
    expect(lasts).toEqual(["false", "true"]);
  });

  it("has no Subagents row and no project label on the child", () => {
    renderView();
    expect(screen.queryByText(/Subagents/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Home")).toHaveLength(1);
  });

  it("collapses the children from the parent row and remembers it", async () => {
    const view = renderView();
    await userEvent.click(screen.getByRole("button", { name: "Collapse subagents of Parent thread" }));
    expect(screen.queryByText("Child thread")).not.toBeInTheDocument();
    expect(preferences.getCollapsedThreads()).toEqual(["1"]);
    view.unmount();
    renderView();
    expect(screen.queryByText("Child thread")).not.toBeInTheDocument();
  });
});
