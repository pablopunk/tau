import type { Harness } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import type { SettingsStore } from "../home/settings-store";
import { createFauxSetup } from "../testing/faux-provider";
import { createJudgeModel } from "./judge-model";
import { JUDGE_SYSTEM_PROMPT } from "./judge-prompt";
import { parseVerdict } from "./judge-verdict";

const ask = () => {
  const { models } = createFauxSetup();
  const settings = {
    get: async () => ({ fastModel: { provider: "faux", modelId: "faux-fast" }, fastThinkingLevel: null }),
  } as unknown as SettingsStore;
  const harness = { conversation: async () => undefined } as unknown as Harness;
  return createJudgeModel({ harness, models, settings });
};

describe("the judge on the faux model", () => {
  it("answers not_met until a tool result shows the evidence", async () => {
    const judge = ask();
    const before = await judge("1", { system: JUDGE_SYSTEM_PROMPT, user: "Transcript:\nassistant: done" });
    expect(parseVerdict(before.text)?.verdict).toBe("not_met");
    const after = await judge("1", {
      system: JUDGE_SYSTEM_PROMPT,
      user: "Transcript:\n  < bash result: goal-met",
    });
    expect(parseVerdict(after.text)?.verdict).toBe("met");
  });
});
