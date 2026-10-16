import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useFlipList } from "@/hooks/use-flip-list";
import { BotAvatar, botAvatarLook } from "./bot-avatar";
import { Combobox } from "./combobox";
import { ProjectIcon } from "./project-icon";
import { formatRelativeTime, RelativeTime } from "./relative-time";
import { SegmentedControl } from "./segmented-control";
import { SidebarProvider } from "./sidebar";
import { SidebarThreadRow } from "./sidebar-thread-row";
import { TooltipProvider } from "./tooltip";

describe("formatRelativeTime", () => {
  const now = 10_000_000_000;
  it.each([
    [0, "now"],
    [5 * 60_000, "5m"],
    [3 * 3_600_000, "3h"],
    [2 * 86_400_000, "2d"],
    [14 * 86_400_000, "2w"],
  ])("formats %i ms ago as %s", (elapsed, text) => {
    expect(formatRelativeTime(now - elapsed, now)).toBe(text);
  });

  it("renders a time element", () => {
    render(<RelativeTime at={0} now={5 * 60_000} />);
    expect(screen.getByText("5m")).toHaveAttribute("datetime", "1970-01-01T00:00:00.000Z");
  });
});

describe("SegmentedControl", () => {
  it("chooses an option and never deselects", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="View"
        value="threads"
        onChange={onChange}
        options={[
          { value: "threads", label: "Threads", icon: <i /> },
          { value: "projects", label: "Projects", icon: <i /> },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Threads" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: "Projects" }));
    expect(onChange).toHaveBeenCalledWith("projects");
  });
});

describe("ProjectIcon", () => {
  it("shows the initial letter when there is no image", () => {
    render(<ProjectIcon id="p1" name="alpha" iconUrl="/api/projects/p1/icon?v=auto" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("is decorative so a link around it keeps a clean name", () => {
    const { container } = render(<ProjectIcon id="p" name="demo-project" />);
    expect(container.querySelector('[data-slot="project-icon"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a house for Home", () => {
    const { container } = render(<ProjectIcon id="home" name="Home" home />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("BotAvatar", () => {
  it("derives the same look from an index, and different looks for neighbours", () => {
    expect(botAvatarLook(5)).toEqual(botAvatarLook(5));
    expect(botAvatarLook(5).color).not.toBe(botAvatarLook(6).color);
    expect(botAvatarLook(4).type).toBe(botAvatarLook(4 + 3).type);
  });

  it("renders the badge and the working flag", () => {
    const { container } = render(<BotAvatar avatarIndex={2} working badge={<b>!</b>} />);
    expect(container.querySelector('[data-slot="bot-avatar"]')).toHaveAttribute("data-working", "true");
    expect(screen.getByText("!")).toBeInTheDocument();
  });
});

describe("BotAvatar motion", () => {
  it("is frozen at a fixed turn while idle", () => {
    render(<BotAvatar avatarIndex={1} />);
    expect(screen.getByTestId("bot-canvas")).toHaveAttribute("data-paused", "true");
    expect(screen.getByTestId("bot-canvas")).toHaveAttribute("data-turn", "0");
  });

  it("moves only while working", () => {
    render(<BotAvatar avatarIndex={1} working />);
    expect(screen.getByTestId("bot-canvas")).toHaveAttribute("data-paused", "false");
    expect(screen.getByTestId("bot-canvas")).not.toHaveAttribute("data-turn");
  });
});

describe("Combobox extras", () => {
  it("shows option icons, hints and a group action", async () => {
    const onRefresh = vi.fn();
    render(
      <Combobox
        value={null}
        onChange={() => {}}
        groupActions={{ "On GitHub": <button type="button" onClick={onRefresh}>Refresh</button> }}
        options={[
          { value: "a", label: "Alpha", group: "Projects" },
          { value: "github:o/r", label: "o/r", group: "On GitHub", icon: <i data-testid="lock" />, hint: "local" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByTestId("lock")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /o\/r/ })).toHaveTextContent("local");
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });
});

function row(current: boolean) {
  return (
    <SidebarProvider>
      <TooltipProvider>
        <SidebarThreadRow
          link={<a href="/t/1" />}
          title="Fix login"
          avatar={<span>bot</span>}
          context={<span>Project A</span>}
          time={<RelativeTime at={0} now={60_000} />}
          actions={<button type="button">Archive</button>}
          current={current}
          flipId="1"
        />
      </TooltipProvider>
    </SidebarProvider>
  );
}

describe("SidebarThreadRow", () => {
  it("links, shows title, context, time and actions", () => {
    render(row(false));
    expect(screen.getByRole("link")).toHaveAttribute("href", "/t/1");
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    expect(screen.getByText("Project A")).toBeInTheDocument();
    expect(screen.getByText("1m")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("marks the current row and keeps its context line", () => {
    const { container } = render(row(true));
    expect(container.querySelector("li")).toHaveAttribute("data-current", "true");
    expect(screen.getByText("Project A")).toBeInTheDocument();
  });

  it("moves the project icon onto the avatar spot of the current row and keeps the name", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarThreadRow link={<a href="/t/1" />} title="T" avatar="bot" context="Project A" projectIcon={<i>pi</i>} time="1m" current />
      </SidebarProvider>,
    );
    expect(container.querySelector('[data-slot="thread-project-slot"]')).not.toBeNull();
    expect(screen.getByText("Project A")).toBeInTheDocument();
    expect(container.querySelector("li")).toHaveAttribute("data-current", "true");
  });

  it("fades the project icon in over the avatar when there is no context line", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarThreadRow link={<a href="/t/1" />} title="T" avatar="bot" projectIcon={<i>pi</i>} time="1m" current />
      </SidebarProvider>,
    );
    expect(container.querySelector('[data-slot="thread-project-fade"]')).not.toBeNull();
  });

  it("keeps the actions visible while their menu is open", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarThreadRow link={<a href="/t/1" />} title="T" avatar="a" time="1m" actions={<b>x</b>} actionsOpen />
      </SidebarProvider>,
    );
    expect(container.querySelector("li")).toHaveAttribute("data-actions-open", "true");
  });
});

function List({ ids, resetKey }: { ids: string[]; resetKey: number }) {
  const ref = useRef<HTMLUListElement>(null);
  useFlipList(ref, resetKey);
  return (
    <ul ref={ref}>
      {ids.map((id) => (
        <li key={id} data-flip-id={id} data-top={ids.indexOf(id) * 50}>
          {id}
        </li>
      ))}
    </ul>
  );
}

describe("useFlipList", () => {
  const stubTops = () =>
    vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return { top: Number(this.dataset.top ?? 0) } as DOMRect;
      });

  it("animates a pure reorder but not an added row", () => {
    stubTops();
    const animate = vi.spyOn(Element.prototype, "animate");
    const { rerender } = render(<List ids={["a", "b"]} resetKey={0} />);
    rerender(<List ids={["b", "a"]} resetKey={0} />);
    expect(animate).toHaveBeenCalledTimes(2);
    animate.mockClear();
    rerender(<List ids={["c", "b", "a"]} resetKey={0} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("animates survivors when the reset key changes", () => {
    stubTops();
    const animate = vi.spyOn(Element.prototype, "animate");
    const { rerender } = render(<List ids={["a", "b", "c"]} resetKey={0} />);
    rerender(<List ids={["a", "c"]} resetKey={1} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does nothing under reduced motion", () => {
    stubTops();
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList);
    const animate = vi.spyOn(Element.prototype, "animate");
    const { rerender } = render(<List ids={["a", "b"]} resetKey={0} />);
    rerender(<List ids={["b", "a"]} resetKey={0} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
