import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { localNodeName } from "@/machines/local-node-name";
import { NodeName } from "./node-name";

describe("NodeName", () => {
  it("adds a dim local only for the local node", () => {
    const { rerender } = render(<NodeName name="Mac" local />);
    expect(screen.getByText("Mac")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();
    rerender(<NodeName name="Homelab" />);
    expect(screen.queryByText("local")).toBeNull();
  });

  it("falls back to Local when the node has no name", () => {
    expect(localNodeName(undefined)).toBe("Local");
    expect(localNodeName("  ")).toBe("Local");
    expect(localNodeName("vibemachine")).toBe("vibemachine");
  });
});
