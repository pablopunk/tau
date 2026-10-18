import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeConnectorTool } from "./ClaudeConnectorTool";
import { ReadTool } from "./ReadTool";
import type { ToolRendererProps } from "./types";

function stateWithImage(name: string, args: Record<string, unknown>): ToolRendererProps["state"] {
  return {
    call: { id: "c1", name, arguments: args },
    status: "done",
    result: {
      message: { isError: false, content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
      diagnostics: [],
    },
    slot: undefined,
  } as unknown as ToolRendererProps["state"];
}

describe("tool result images", () => {
  it("previews an image read and opens it larger", () => {
    render(<ReadTool state={stateWithImage("read", { path: "/tmp/x.png" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Done|Read/ }));
    const preview = screen.getByRole("button", { name: "Open Result image 1" });
    expect(screen.getByAltText("Result image 1").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    fireEvent.click(preview);
    expect(screen.getByAltText("Result image 1, full size")).toBeTruthy();
  });

  it("previews images from connector results", () => {
    render(
      <ClaudeConnectorTool state={stateWithImage("claude_connector", { server: "Figma", tool: "shot" })} />,
    );
    fireEvent.click(screen.getByText("Figma · shot"));
    expect(screen.getByAltText("Result image 1")).toBeTruthy();
  });
});
