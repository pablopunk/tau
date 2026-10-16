import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("app shell in fake mode", () => {
  it("renders the header, the provider status and the conversation stub", async () => {
    vi.stubEnv("VITE_FAKE", "1");
    const { App } = await import("./App");
    render(<App />);
    expect(screen.getByRole("heading", { name: "pi-everywhere" })).toBeInTheDocument();
    expect(await screen.findByText("Provider not set up")).toBeInTheDocument();
    expect(screen.getByTestId("conversation")).toHaveTextContent("Conversation shell");
  });
});
