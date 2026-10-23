import { AppError } from "@tau/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { ComposerTestWrapper } from "./composer/test-wrapper";
import { compactFailureMessage } from "./composer/use-thread-commands";

vi.mock("@/lib/api", () => ({
  api: {
    skills: { list: vi.fn().mockResolvedValue([{ name: "review", description: "Review code" }]) },
    projects: { suggestFiles: vi.fn().mockResolvedValue([{ path: "src/app.ts", kind: "file" }]) },
  },
}));

beforeEach(() => window.localStorage.clear());

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onStop = vi.fn().mockResolvedValue(undefined);
  const compact = vi.fn().mockResolvedValue(undefined);
  const model = vi.fn();
  render(
    <Composer
      target="new"
      imagesAllowed
      busy={false}
      projectId="p1"
      commands={{ compact, model }}
      onSend={onSend}
      onStop={onStop}
      {...props}
    />,
    { wrapper: ComposerTestWrapper },
  );
  return { onSend, onStop, compact, model, input: screen.getByLabelText("Message") };
}

describe("<Composer> slash menu", () => {
  it("lists commands that match the prefix", async () => {
    const { input } = setup();
    await userEvent.type(input, "/m");
    expect(await screen.findByText("/model")).toBeInTheDocument();
    expect(screen.queryByText("/compact")).not.toBeInTheDocument();
  });

  it("picks with Enter instead of sending", async () => {
    const { input, model, onSend } = setup();
    await userEvent.type(input, "/mod{Enter}");
    expect(model).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  it("closes with Escape instead of stopping the run", async () => {
    const { input, onStop } = setup({ busy: true });
    await userEvent.type(input, "/m");
    await screen.findByText("/model");
    await userEvent.keyboard("{Escape}");
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.queryByText("/model")).not.toBeInTheDocument();
  });

  it("does nothing on Escape when no menu is open, even when busy", async () => {
    const { input, onStop } = setup({ busy: true });
    await userEvent.type(input, "hello{Escape}");
    expect(onStop).not.toHaveBeenCalled();
    expect(input).toHaveValue("hello");
  });

  it("calls compact with the text after the command", async () => {
    const { input, compact, onSend } = setup();
    await userEvent.type(input, "/compact keep the API{Enter}");
    expect(compact).toHaveBeenCalledWith("keep the API");
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("<Composer> mention menu", () => {
  it("groups files and skills and inserts the picked path", async () => {
    const { input } = setup();
    await userEvent.type(input, "see @");
    expect(await screen.findByText("Files")).toBeInTheDocument();
    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("see @review ");
  });

  it("does not open for an @ inside a word", async () => {
    const { input } = setup();
    await userEvent.type(input, "me@");
    await waitFor(() => expect(screen.queryByText("Files")).not.toBeInTheDocument());
  });
});

describe("compactFailureMessage", () => {
  it("explains nothing_to_compact", () => {
    expect(compactFailureMessage(new AppError("nothing_to_compact", "x"))).toBe("Nothing to compact yet");
  });
});
