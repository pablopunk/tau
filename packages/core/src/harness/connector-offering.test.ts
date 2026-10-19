import type { ClaudeConnector, ClaudeConnectorSettings } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createConnectorOffering } from "./connector-offering";
import { resyncWhenConnectorsChange } from "./connector-resync";

const CLI = { provider: "claude-cli", modelId: "opus" };
const OTHER = { provider: "openai", modelId: "gpt" };
const connected = { name: "claude.ai Linear", status: "connected" } as ClaudeConnector;
const pending = { name: "claude.ai Linear", status: "pending" } as ClaudeConnector;
const settings: ClaudeConnectorSettings = { disabled: [] } as unknown as ClaudeConnectorSettings;

function offeringWith(connectors: () => readonly ClaudeConnector[] | null) {
  return createConnectorOffering({ harness: {} as never, settings: async () => settings, connectors });
}

describe("connector offering", () => {
  it("changes nothing while the connector list is unknown", async () => {
    const offering = offeringWith(() => null);
    expect(await offering.modelToolsFor(CLI)).toEqual({});
    expect(await offering.isOffered(CLI)).toBe(false);
  });

  it("still withdraws for a model that is not the Claude CLI, even when unknown", async () => {
    expect(await offeringWith(() => null).modelToolsFor(OTHER)).toEqual({ modelTools: null });
  });

  it("offers with a connected server and withdraws when the known list has none", async () => {
    expect((await offeringWith(() => [connected]).modelToolsFor(CLI)).modelTools).toBeTruthy();
    expect(await offeringWith(() => [pending]).modelToolsFor(CLI)).toEqual({ modelTools: null });
  });
});

describe("resync when connectors change", () => {
  it("resyncs once per new known list, never for an unknown one", async () => {
    const changes = createChangeEmitter();
    let list: readonly ClaudeConnector[] | null = null;
    const resyncAll = vi.fn(async () => undefined);
    resyncWhenConnectorsChange(changes, { claudeConnectors: () => list }, { resyncAll });
    changes.emit({ resource: "providers" });
    list = [connected];
    changes.emit({ resource: "providers" });
    changes.emit({ resource: "providers" });
    changes.emit({ resource: "projects" });
    list = [pending];
    changes.emit({ resource: "providers" });
    await vi.waitFor(() => expect(resyncAll).toHaveBeenCalledTimes(2));
  });
});
