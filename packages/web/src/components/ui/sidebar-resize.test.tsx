import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { preferences } from "@/lib/preferences";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger } from "./sidebar";

function Harness() {
  return (
    <SidebarProvider
      defaultOpen={preferences.getSidebarOpen()}
      onOpenChange={preferences.setSidebarOpen}
      defaultWidth={preferences.getSidebarWidth()}
      onWidthChange={preferences.setSidebarWidth}
    >
      <Sidebar>
        <SidebarRail />
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>
  );
}

const rail = () => screen.getByRole("separator", { name: "Resize sidebar" });
const sidebar = () => document.querySelector<HTMLElement>("[data-slot=sidebar]") as HTMLElement;
const wrapper = () => document.querySelector<HTMLElement>("[data-slot=sidebar-wrapper]") as HTMLElement;
const cssWidth = () => wrapper().style.getPropertyValue("--sidebar-width");

const drag = (clientX: number) => {
  fireEvent.pointerDown(rail(), { button: 0, pointerId: 1, clientX: 256 });
  fireEvent.pointerMove(rail(), { pointerId: 1, clientX });
  fireEvent.pointerUp(rail(), { pointerId: 1, clientX });
};

beforeEach(() => window.localStorage.clear());

describe("sidebar resize rail", () => {
  it("is an accessible vertical separator", () => {
    render(<Harness />);
    expect(rail()).toHaveAttribute("aria-orientation", "vertical");
    expect(rail()).toHaveAttribute("aria-valuenow", "256");
    expect(rail()).toHaveAttribute("aria-valuemin", "200");
    expect(rail()).toHaveAttribute("aria-valuemax", "480");
    expect(rail()).toHaveAttribute("tabindex", "0");
  });

  it("resizes by 16px with the arrow keys and remembers the width", async () => {
    render(<Harness />);
    rail().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(cssWidth()).toBe("272px");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(cssWidth()).toBe("240px");
    expect(preferences.getSidebarWidth()).toBe(240);
  });

  it("clamps keyboard resizing at the maximum", async () => {
    window.localStorage.setItem("tau:sidebar-width", "480");
    render(<Harness />);
    rail().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(cssWidth()).toBe("480px");
  });

  it("follows the pointer while dragging and clamps", () => {
    render(<Harness />);
    drag(333);
    expect(cssWidth()).toBe("333px");
    drag(900);
    expect(cssWidth()).toBe("480px");
    drag(150);
    expect(cssWidth()).toBe("200px");
  });

  it("disables the width transition only while dragging", () => {
    render(<Harness />);
    fireEvent.pointerDown(rail(), { button: 0, pointerId: 1, clientX: 256 });
    expect(sidebar()).toHaveAttribute("data-resizing", "true");
    fireEvent.pointerUp(rail(), { pointerId: 1 });
    expect(sidebar()).toHaveAttribute("data-resizing", "false");
  });

  it("resets to the default width on double click", async () => {
    window.localStorage.setItem("tau:sidebar-width", "400");
    render(<Harness />);
    expect(cssWidth()).toBe("400px");
    await userEvent.dblClick(rail());
    expect(cssWidth()).toBe("256px");
    expect(preferences.getSidebarWidth()).toBe(256);
  });

  it("collapses when dragged below the threshold and expands when dragged back out", () => {
    render(<Harness />);
    drag(100);
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    expect(preferences.getSidebarOpen()).toBe(false);
    drag(300);
    expect(sidebar()).toHaveAttribute("data-state", "expanded");
    expect(cssWidth()).toBe("300px");
  });
});

describe("sidebar trigger", () => {
  it("collapses, remembers it, and survives a remount", async () => {
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    expect(preferences.getSidebarOpen()).toBe(false);
    view.unmount();
    render(<Harness />);
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    await userEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(sidebar()).toHaveAttribute("data-state", "expanded");
  });
});
