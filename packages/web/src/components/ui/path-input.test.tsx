import type { PathSuggestion } from "@tau/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PathInput } from "./path-input";

const mocks = vi.hoisted(() => ({ suggest: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: { fs: { suggestDirectories: mocks.suggest } } }));

const suggestion = (name: string, isGitRepo = false): PathSuggestion => ({
  path: `/home/me/src/${name}`,
  display: `~/src/${name}`,
  isGitRepo,
});

function Harness({ onSubmit = vi.fn() }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <PathInput aria-label="Path" value={value} onValueChange={setValue} />
    </form>
  );
}

function mount(onSubmit?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.suggest.mockImplementation(async ({ prefix }: { prefix: string }) =>
    prefix.startsWith("~/src/") && prefix !== "~/src/tau/"
      ? [suggestion("tau", true), suggestion("sandbox")]
      : [],
  );
});

const input = () => screen.getByRole("combobox", { name: "Path" }) as HTMLInputElement;

describe("PathInput", () => {
  it("shows debounced suggestions with ~ and a repo icon while typing", async () => {
    const user = mount();
    await user.type(input(), "~/src/");
    expect(await screen.findByText("~/src/tau")).toBeInTheDocument();
    expect(screen.getByText("~/src/sandbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Git repository")).toBeInTheDocument();
    expect(mocks.suggest).toHaveBeenLastCalledWith({ prefix: "~/src/" });
    expect(mocks.suggest.mock.calls.length).toBeLessThan(6);
  });

  it("does not ask for suggestions for a relative path", async () => {
    const user = mount();
    await user.type(input(), "src");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it("moves with the arrows and accepts with Enter, appending a slash", async () => {
    const user = mount();
    await user.type(input(), "~/src/");
    await screen.findByText("~/src/sandbox");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input().value).toBe("~/src/sandbox/");
  });

  it("accepts the first suggestion with Tab and keeps focus", async () => {
    const user = mount();
    await user.type(input(), "~/src/");
    await screen.findByText("~/src/sandbox");
    await user.keyboard("{Tab}");
    expect(input().value).toBe("~/src/tau/");
    expect(input()).toHaveFocus();
  });

  it("closes with Escape and reopens with ArrowDown", async () => {
    const user = mount();
    await user.type(input(), "~/src/");
    await screen.findByText("~/src/sandbox");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("~/src/sandbox")).not.toBeInTheDocument());
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByText("~/src/sandbox")).toBeInTheDocument();
  });

  it("accepts a suggestion on click", async () => {
    const user = mount();
    await user.type(input(), "~/src/");
    await user.click(await screen.findByText("~/src/sandbox"));
    expect(input().value).toBe("~/src/sandbox/");
    expect(input()).toHaveFocus();
  });

  it("lets Enter submit when the typed path already equals the suggestion", async () => {
    const onSubmit = vi.fn();
    const user = mount(onSubmit);
    await user.type(input(), "~/src/sandbox");
    mocks.suggest.mockResolvedValue([suggestion("sandbox")]);
    await user.type(input(), "{Enter}");
    expect(onSubmit).toHaveBeenCalled();
  });
});
