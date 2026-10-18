import { describe, expect, it, vi } from "vitest";
import { FAKE_LINEAR, FAKE_NEEDS_AUTH, FAKE_SLACK } from "../testing/fake-claude-connectors";
import { createFakeClaudeSdk } from "../testing/fake-claude-sdk";
import { createConnectorProbe } from "./connector-probe";

const fakeSdk = (pendingPolls = 0) =>
  createFakeClaudeSdk({ connectors: [FAKE_LINEAR, FAKE_SLACK, FAKE_NEEDS_AUTH], pendingPolls });

function probeOf(fake: ReturnType<typeof fakeSdk>, now = () => 0) {
  const onChange = vi.fn();
  const sleep = vi.fn(async () => undefined);
  const probe = createConnectorProbe({ sdk: async () => fake.port, onChange, sleep, now });
  return { probe, onChange, sleep };
}

describe("connector probe", () => {
  it("is null before the first probe", () => {
    expect(probeOf(fakeSdk()).probe.current()).toBeNull();
  });

  it("lists the connectors with counts and no schemas, tau excluded", async () => {
    const { probe, onChange } = probeOf(fakeSdk());
    await probe.refresh();
    expect(probe.current()).toEqual([
      { name: "claude.ai Linear", source: "claudeai", status: "connected", toolCount: 3, readOnlyCount: 2 },
      { name: "claude.ai Slack", source: "claudeai", status: "connected", toolCount: 2, readOnlyCount: 1 },
      { name: "claude.ai Notion", source: "claudeai", status: "needs_auth", toolCount: 0, readOnlyCount: 0 },
    ]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("waits while servers are pending", async () => {
    const { probe, sleep } = probeOf(fakeSdk(3));
    await probe.refresh();
    expect(sleep.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(probe.current()?.find((server) => server.name === "claude.ai Linear")?.status).toBe("connected");
  });

  it("stops waiting at the 10 s cap", async () => {
    let clock = 0;
    const { probe, sleep } = probeOf(fakeSdk(1_000_000), () => clock);
    sleep.mockImplementation(async () => {
      clock += 250;
    });
    await probe.refresh();
    expect(sleep).toHaveBeenCalledTimes(40);
    expect(probe.current()?.every((server) => server.status === "pending")).toBe(true);
  });

  it("caches null and never rejects when the SDK fails", async () => {
    const probe = createConnectorProbe({
      sdk: async () => {
        throw new Error("no sdk");
      },
      onChange: () => undefined,
    });
    await expect(probe.refresh()).resolves.toBeNull();
    expect(probe.current()).toBeNull();
  });
});
