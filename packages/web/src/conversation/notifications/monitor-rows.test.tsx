import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MonitorEventRow } from "./MonitorEventRow";
import { NoticeRow } from "./NoticeRow";
import { ProcessExitRow } from "./ProcessExitRow";

const base = { processId: "p", description: "tail log", dropped: 0 };

describe("monitor and exit rows", () => {
  it("shows monitor lines in a pre", () => {
    render(<MonitorEventRow data={{ ...base, lines: ["a", "b"] }} />);
    expect(screen.getByText(/a\s+b/).tagName).toBe("PRE");
  });

  it("says no output for an empty batch and shows the end state", () => {
    render(<MonitorEventRow data={{ ...base, lines: [] }} />);
    expect(screen.getByText(/no output/)).toBeTruthy();
  });

  it("shows the end state and the dropped count", () => {
    render(<MonitorEventRow data={{ ...base, lines: ["x"], dropped: 3, ended: { exitCode: 2 } }} />);
    expect(screen.getByText(/\+3 dropped/)).toBeTruthy();
    expect(screen.getByText(/ended: exit 2/)).toBeTruthy();
  });

  it("collapses more than 5 lines until clicked", async () => {
    const lines = ["l1", "l2", "l3", "l4", "l5", "l6"];
    render(<MonitorEventRow data={{ ...base, lines }} />);
    expect(screen.queryByText(/l6/)).toBeNull();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/l6/)).toBeTruthy();
  });

  it("shows the exit code and tail of a process", () => {
    render(
      <ProcessExitRow
        data={{ processId: "p", name: "build", command: "make", exitCode: 3, logTail: "boom" }}
      />,
    );
    expect(screen.getByText(/exit 3/)).toBeTruthy();
    expect(screen.getByText("boom").tagName).toBe("PRE");
  });

  it("shows a notice line", () => {
    render(<NoticeRow data={{ text: "monitor stopped: tau restarted" }} />);
    expect(screen.getByTestId("notice").textContent).toContain("tau restarted");
  });
});
