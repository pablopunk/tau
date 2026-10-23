import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PendingFirstMessage } from "./PendingFirstMessage";

describe("<PendingFirstMessage>", () => {
  it("renders a pending user message with its image and sending status", () => {
    render(
      <PendingFirstMessage
        message={{
          text: "Look at this",
          images: [{ mimeType: "image/png", data: "AQID" }],
          files: [{ name: "notes.txt", path: "uploads/notes.txt", size: 5 }],
        }}
      />,
    );

    expect(screen.getByText((content) => content.includes("Look at this"))).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Attached file: "uploads/notes.txt"')),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Attachment 1" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AQID",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sending…");
  });
});
