import type { ModelInfo } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ModelCombobox } from "./ModelCombobox";

const model = (provider: string, providerName: string, modelId: string): ModelInfo =>
  ({ provider, providerName, modelId, name: modelId }) as ModelInfo;

describe("ModelCombobox", () => {
  it("groups the models under their provider name", async () => {
    Element.prototype.scrollIntoView = () => {};
    const user = userEvent.setup();
    render(
      <ModelCombobox
        models={[model("openai", "OpenAI", "gpt-x"), model("anthropic", "Anthropic", "claude-x")]}
        value={null}
        onChange={() => {}}
        ariaLabel="Model"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Model" }));

    expect(await screen.findByRole("group", { name: "OpenAI" })).toHaveTextContent("openai/gpt-x");
    expect(screen.getByRole("group", { name: "Anthropic" })).toHaveTextContent("anthropic/claude-x");
  });

  it("highlights only one of two same-named models from different providers", async () => {
    Element.prototype.scrollIntoView = () => {};
    const user = userEvent.setup();
    const picked: string[] = [];
    render(
      <ModelCombobox
        models={[model("openai", "OpenAI", "gpt-luna"), model("opencode", "OpenCode Zen", "gpt-luna")]}
        value={null}
        onChange={(ref) => picked.push(ref?.provider ?? "")}
        ariaLabel="Model"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Model" }));
    const [, second] = await screen.findAllByRole("option");
    await user.hover(second as HTMLElement);

    expect(
      screen.getAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true"),
    ).toEqual([second]);
    await user.click(second as HTMLElement);
    expect(picked).toEqual(["opencode"]);
  });
});
