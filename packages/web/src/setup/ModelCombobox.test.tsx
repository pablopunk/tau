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

  it("labels Claude CLI rows with the alias, matches it in search and shows the provider in the trigger", async () => {
    Element.prototype.scrollIntoView = () => {};
    const user = userEvent.setup();
    const models = [
      { ...model("claude-cli", "Claude CLI", "opus"), name: "Opus 5.5" },
      { ...model("claude-cli", "Claude CLI", "sonnet"), name: "Sonnet 5.5" },
    ];
    render(
      <ModelCombobox
        models={models}
        value={{ provider: "claude-cli", modelId: "opus" }}
        onChange={() => {}}
        ariaLabel="Model"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger).toHaveTextContent("Claude CLI · Opus 5.5");
    await user.click(trigger);
    expect(await screen.findByRole("option", { name: /Sonnet 5.5 \(sonnet\)/ })).toBeInTheDocument();
    await user.keyboard("sonnet");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("lists the Claude CLI group before other groups", async () => {
    Element.prototype.scrollIntoView = () => {};
    const user = userEvent.setup();
    render(
      <ModelCombobox
        models={[
          model("openrouter", "OpenRouter", "anthropic/haiku-x"),
          { ...model("claude-cli", "Claude CLI", "haiku"), name: "Haiku 5 (haiku)" },
        ]}
        value={null}
        onChange={() => {}}
        ariaLabel="Model"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    await user.keyboard("haiku");
    const [first] = await screen.findAllByRole("option");
    expect(first).toHaveTextContent("claude-cli/haiku");
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
