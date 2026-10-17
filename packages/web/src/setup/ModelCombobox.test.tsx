import type { ModelInfo } from "@pi-everywhere/protocol";
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

    expect(await screen.findByRole("group", { name: "OpenAI" })).toHaveTextContent("gpt-x");
    expect(screen.getByRole("group", { name: "Anthropic" })).toHaveTextContent("claude-x");
  });
});
