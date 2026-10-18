import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { scriptOf } from "../testing/fake-claude-script";
import { ask, createHarness, FAKE_MODEL, type Harness, systemMessage, userMessage } from "./test-support";

const say = (text: string) => [{ kind: "text" as const, text }];
const THINKING_OFF = { type: "disabled" };
const noOffModel = { ...FAKE_MODEL, thinkingLevelMap: { off: null } } as Model<Api>;

const optionsOf = (harness: Harness, index: number) => {
  const { effort, thinking } = harness.fake.queries[index]?.options ?? {};
  return { effort, thinking };
};

async function turns(harness: Harness, reasonings: (string | undefined)[], model = FAKE_MODEL) {
  const messages: Message[] = [systemMessage(), userMessage("0")];
  for (const [index, reasoning] of reasonings.entries()) {
    const options = { sessionId: "thread-1", ...(reasoning && { reasoning }) } as never;
    const answer = await ask(harness, messages, options, model);
    messages.push(answer.message, userMessage(String(index + 1)));
  }
}

describe("thinking off", () => {
  it("a fresh Off query disables thinking and sends no effort", async () => {
    const harness = createHarness();
    await turns(harness, [undefined]);
    expect(optionsOf(harness, 0)).toEqual({ effort: undefined, thinking: THINKING_OFF });
  });

  it("High, Off, Low: each change resumes with exactly its own options", async () => {
    const harness = createHarness({ script: scriptOf([say("1"), say("2"), say("3")]) });
    await turns(harness, ["high", undefined, "low"]);
    expect(harness.fake.queries).toHaveLength(3);
    expect(optionsOf(harness, 0)).toEqual({ effort: "high", thinking: undefined });
    expect(optionsOf(harness, 1)).toEqual({ effort: undefined, thinking: THINKING_OFF });
    expect(optionsOf(harness, 2)).toEqual({ effort: "low", thinking: undefined });
    expect(harness.fake.queries[1]?.options.resume).toBe(harness.fake.queries[0]?.sessionId);
    expect(harness.fake.queries[2]?.options.resume).toBe(harness.fake.queries[1]?.sessionId);
    expect(harness.fake.queries.flatMap((query) => query.flags)).toEqual([]);
  });

  it("staying Off keeps the live query", async () => {
    const harness = createHarness({ script: scriptOf([say("1"), say("2")]) });
    await turns(harness, [undefined, undefined]);
    expect(harness.fake.queries).toHaveLength(1);
  });

  it("a model that cannot turn thinking off keeps the SDK default", async () => {
    const harness = createHarness();
    await turns(harness, [undefined], noOffModel);
    expect(optionsOf(harness, 0)).toEqual({ effort: undefined, thinking: undefined });
  });

  it("a level with no effort mapping is not read as Off", async () => {
    const harness = createHarness();
    await turns(harness, ["max"]);
    expect(optionsOf(harness, 0)).toEqual({ effort: undefined, thinking: undefined });
  });

  it("a minimal level is still low effort", async () => {
    const harness = createHarness();
    await turns(harness, ["minimal"]);
    expect(optionsOf(harness, 0)).toEqual({ effort: "low", thinking: undefined });
  });

  it("a one-shot query without tools disables thinking too", async () => {
    const harness = createHarness();
    await ask(harness, [systemMessage([]), userMessage("a")]);
    expect(optionsOf(harness, 0)).toEqual({ effort: undefined, thinking: THINKING_OFF });
  });
});
