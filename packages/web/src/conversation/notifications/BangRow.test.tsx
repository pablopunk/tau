import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BangRow } from "./BangRow";

describe("BangRow", () => {
  it("shows the bang command without sending it anywhere", () => {
    render(<BangRow data={{ command: "echo hi" }} />);
    expect(screen.getByTestId("bang")).toHaveTextContent("echo hi");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
