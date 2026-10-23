import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { StartConversationInputSchema } from "./entities";
import { routes } from "./rest";
import {
  describeExecutors,
  NATIVE_DISABLED_REASON,
  PI_RUNTIME_CAPABILITIES,
  RUNTIME_UNSUPPORTED_REASON,
  RuntimeDescriptorListSchema,
} from "./runtime";

const base = { projectId: "p1", text: "hi", requestId: "r1" };
const nativeCapabilities = { ...PI_RUNTIME_CAPABILITIES, steer: { supported: false, reason: "later" } };

describe("StartConversationInput executor", () => {
  it.each([
    ["omitted", base],
    ["pi", { ...base, executor: "pi" }],
    ["claude-code", { ...base, executor: "claude-code" }],
  ])("accepts a start body with executor %s", (_name, body) => {
    expect(Value.Check(StartConversationInputSchema, body)).toBe(true);
  });

  it.each(["codex", "", null, 1])("rejects the executor %j", (executor) => {
    expect(Value.Check(StartConversationInputSchema, { ...base, executor })).toBe(false);
  });
});

describe("listRuntimes", () => {
  it("is a plain GET with the descriptor list as response", () => {
    expect(routes.listRuntimes).toMatchObject({ method: "GET", path: "/api/runtimes", status: 200 });
    expect(routes.listRuntimes.response).toBe(RuntimeDescriptorListSchema);
  });

  it("lists pi enabled and claude-code disabled with a reason when native is off", () => {
    const list = describeExecutors(undefined);

    expect(Value.Check(RuntimeDescriptorListSchema, list)).toBe(true);
    expect(list.executors.map((entry) => [entry.executor, entry.enabled])).toEqual([
      ["pi", true],
      ["claude-code", false],
    ]);
    const [, disabled] = list.executors;
    expect(disabled?.reason).toBe(NATIVE_DISABLED_REASON);
    for (const state of Object.values(disabled?.capabilities ?? {})) {
      expect(state).toEqual({ supported: false, reason: RUNTIME_UNSUPPORTED_REASON });
    }
  });

  it("lists the native capability table as given when native is on", () => {
    const list = describeExecutors(nativeCapabilities);

    expect(Value.Check(RuntimeDescriptorListSchema, list)).toBe(true);
    expect(list.executors[1]).toEqual({
      executor: "claude-code",
      enabled: true,
      capabilities: nativeCapabilities,
    });
  });

  it("never claims a capability it cannot name: unsupported entries carry a reason", () => {
    for (const state of Object.values(PI_RUNTIME_CAPABILITIES)) {
      if (!state.supported) expect(state.reason).toBeTruthy();
    }
  });

  it("rejects a descriptor without enabled", () => {
    const [pi] = describeExecutors(undefined).executors;
    const { enabled: _enabled, ...withoutEnabled } = pi ?? {};
    expect(Value.Check(RuntimeDescriptorListSchema, { executors: [withoutEnabled] })).toBe(false);
  });
});
